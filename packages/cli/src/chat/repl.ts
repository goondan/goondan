import { createInterface } from 'node:readline';
import type { Json, OperationDecision } from '@goondan/core';
import type { ChatHost } from './host.js';

export interface ChatReplIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  terminal: boolean;
}

function isRecord(value: unknown): value is Record<string, Json> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isJson);
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value);
}

function targetedInput(input: string): { agent?: string; value: string } | undefined {
  if (!input.startsWith('/agent ')) return { value: input };
  const separator = input.indexOf(' ', 7);
  if (separator < 0 || separator === input.length - 1) return undefined;
  return { agent: input.slice(7, separator), value: input.slice(separator + 1) };
}

function operationCommand(input: string): { operationId: string; decision: OperationDecision } | undefined {
  const [command, operationId, ...rest] = input.split(' ');
  if (!operationId) return undefined;
  if (command === '/reject') return { operationId, decision: { decision: 'rejected' } };
  if (command === '/cancel') return { operationId, decision: { decision: 'cancelled' } };
  if (command !== '/approve') return undefined;
  if (rest.length === 0) return { operationId, decision: { decision: 'approved' } };
  const parsed: unknown = JSON.parse(rest.join(' '));
  if (!isRecord(parsed)) throw new Error('Approval input patch must be a JSON object');
  return { operationId, decision: { decision: 'approved', inputPatch: parsed } };
}

export async function runChatRepl(host: ChatHost, io: ChatReplIO): Promise<void> {
  const readline = createInterface({ input: io.input, output: io.output, terminal: io.terminal, prompt: '> ' });
  let closing = false;
  let lastCompletion: Promise<unknown> | undefined;
  let actions = Promise.resolve();

  const prompt = (): void => { if (!closing && io.terminal) readline.prompt(); };
  const interrupt = (): void => {
    if (host.interrupt()) io.output.write('\nInterrupted.\n');
  };
  process.on('SIGINT', interrupt);
  if (io.terminal) readline.prompt();

  const handle = async (line: string): Promise<void> => {
    const input = line.trim();
    if (input.length === 0) { prompt(); return; }
    if (input === '/quit' || input === '/exit') { closing = true; readline.close(); return; }
    if (input === '/interrupt') { interrupt(); prompt(); return; }
    if (input === '/operations') {
      const operations = await host.listOperations();
      for (const operation of operations) {
        io.error.write(`${operation.operationId} ${operation.status} ${operation.toolCall.name}\n`);
      }
      if (operations.length === 0) io.error.write('No operations.\n');
      prompt();
      return;
    }
    if (input.startsWith('/approve') || input.startsWith('/reject') || input.startsWith('/cancel')) {
      const command = operationCommand(input);
      if (!command) {
        io.error.write('Usage: /approve <OPERATION_ID> [JSON_PATCH], /reject <OPERATION_ID>, or /cancel <OPERATION_ID>\n');
        prompt();
        return;
      }
      const operation = await host.decideOperation(command.operationId, command.decision);
      io.error.write(`Operation ${operation.operationId}: ${operation.status}\n`);
      prompt();
      return;
    }

    const target = targetedInput(input);
    if (!target) {
      io.error.write('Usage: /agent <AGENT> <INPUT>\n');
      prompt();
      return;
    }
    const submitted = host.submit(target.value, target.agent === undefined ? {} : { agent: target.agent });
    if (submitted.kind === 'joined') {
      if (io.terminal) io.output.write('[accepted]\n');
      prompt();
      return;
    }
    lastCompletion = submitted.completion.then((result) => {
      if (result.streamed) io.output.write('\n');
      if (result.text.length > 0) io.output.write(`${result.text}\n`);
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      io.error.write(`${error instanceof Error ? error.message : String(error)}\n`);
      if (!io.terminal) throw error;
    }).finally(prompt);
  };

  try {
    await new Promise<void>((done) => {
      readline.on('line', (line) => {
        actions = actions.then(() => handle(line)).catch((error: unknown) => {
          io.error.write(`${error instanceof Error ? error.message : String(error)}\n`);
          if (!io.terminal) throw error;
          prompt();
        });
      });
      readline.on('close', done);
    });
    await actions;
    await lastCompletion;
  } finally {
    process.off('SIGINT', interrupt);
    await host.close();
  }
}
