import { createInterface } from 'node:readline';
import type { ChatHost } from './host.js';

export interface ChatReplIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  terminal: boolean;
}

export async function runChatRepl(host: ChatHost, io: ChatReplIO): Promise<void> {
  const readline = createInterface({ input: io.input, output: io.output, terminal: io.terminal, prompt: '> ' });
  let closing = false;
  let lastCompletion: Promise<unknown> | undefined;

  const interrupt = (): void => {
    if (host.interrupt()) io.output.write('\nInterrupted.\n');
  };
  process.on('SIGINT', interrupt);
  if (io.terminal) readline.prompt();

  try {
    await new Promise<void>((resolve) => {
      readline.on('line', (line) => {
        const input = line.trim();
        if (input.length === 0) { if (io.terminal) readline.prompt(); return; }
        if (input === '/quit' || input === '/exit') { closing = true; readline.close(); return; }
        if (input === '/interrupt') { interrupt(); if (io.terminal) readline.prompt(); return; }

        const submitted = host.submit(input);
        if (submitted.kind === 'steered') {
          if (io.terminal) { io.output.write('[steered]\n'); readline.prompt(); }
          return;
        }
        lastCompletion = submitted.completion.then((result) => {
          if (result.streamed) io.output.write('\n');
          else io.output.write(`${result.text}\n`);
        }).catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          io.error.write(`${error instanceof Error ? error.message : String(error)}\n`);
          if (!io.terminal) throw error;
        }).finally(() => { if (!closing && io.terminal) readline.prompt(); });
      });
      readline.on('close', resolve);
    });
    await lastCompletion;
  } finally {
    process.off('SIGINT', interrupt);
    await host.close();
  }
}
