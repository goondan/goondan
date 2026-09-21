import {
  createGoondan,
  type LoadedConfig,
  type Message,
  type OperationDecision,
  type Part,
  type PendingOperation,
  type RunInput,
  type RuntimeBindings,
} from '@goondan/core';
import { FileJournalStore } from './session.js';

export interface ChatHostOptions {
  config: LoadedConfig;
  bindings: RuntimeBindings;
  sessionId: string;
  stateDirectory: string;
  finalOnly?: boolean;
  onTextDelta?(delta: string): void;
  onStatus?(message: string): void;
}

export interface ChatTurnResult {
  kind: 'completed';
  text: string;
  streamed: boolean;
}

export type ChatSubmission =
  | { kind: 'joined' }
  | { kind: 'started'; completion: Promise<ChatTurnResult> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderPart(part: Part, includeText: boolean): string[] {
  if (part.type === 'text') return includeText && part.text.length > 0 ? [part.text] : [];
  if (part.type === 'json') return [JSON.stringify(part.value, null, 2)];
  if (part.type === 'image') return [`[image ${part.mediaType}] ${part.url}`];
  if (part.type === 'media') return [`[media ${part.mediaType}] ${part.ref}`];
  if (part.type === 'tool.call') return [`[tool call ${part.name}] ${JSON.stringify(part.args)}`];
  return part.content.flatMap((nested) => renderPart(nested, true));
}

export function renderOutputs(outputs: readonly Message[], includeText: boolean): string {
  return outputs
    .map((message) => message.content.flatMap((part) => renderPart(part, includeText)).join('\n'))
    .filter((value) => value.length > 0)
    .join('\n\n');
}

export class ChatHost {
  readonly #sessionId: string;
  readonly #goondan;
  #active: Promise<ChatTurnResult> | undefined;
  #streamed = false;
  #interrupted = false;

  constructor(options: ChatHostOptions) {
    this.#sessionId = options.sessionId;
    const originalHost = options.bindings.host;
    this.#goondan = createGoondan(options.config, {
      ...options.bindings,
      store: new FileJournalStore(options.stateDirectory),
      host: {
        ...originalHost,
        emit: async (event) => {
          await originalHost?.emit?.(event);
          const data = isRecord(event.data) ? event.data : {};
          if (event.type === 'step.textDelta' && !options.finalOnly) {
            const delta = data['delta'];
            if (typeof delta === 'string') {
              this.#streamed = true;
              options.onTextDelta?.(delta);
            }
          } else if (event.type === 'tool.start') {
            const tool = data['tool'];
            if (typeof tool === 'string') options.onStatus?.(`Running tool: ${tool}`);
          } else if (event.type === 'tool.error') {
            const tool = data['tool']; const error = data['error'];
            if (typeof tool === 'string' && typeof error === 'string') options.onStatus?.(`Tool failed (${tool}): ${error}`);
          } else if (event.type === 'operation.created' && event.operationId !== undefined) {
            const operation = data['operation'];
            const tool = typeof operation === 'object' && operation !== null && 'toolCall' in operation
              && typeof operation.toolCall === 'object' && operation.toolCall !== null && 'name' in operation.toolCall
              && typeof operation.toolCall.name === 'string'
              ? operation.toolCall.name
              : 'tool';
            options.onStatus?.(`Approval required: ${event.operationId} (${tool})`);
          }
        },
      },
    });
  }

  get active(): boolean { return this.#active !== undefined; }

  submit(input: RunInput, options: { agent?: string } = {}): ChatSubmission {
    const wasActive = this.#active !== undefined;
    const completion = this.#run(input, options);
    if (wasActive) {
      void completion.catch(() => undefined);
      return { kind: 'joined' };
    }
    this.#streamed = false;
    this.#interrupted = false;
    this.#active = completion;
    void completion.finally(() => {
      if (this.#active === completion) this.#active = undefined;
    }).catch(() => undefined);
    return { kind: 'started', completion };
  }

  async listOperations(): Promise<PendingOperation[]> {
    return await this.#goondan.operations.list(this.#sessionId);
  }

  async decideOperation(operationId: string, decision: OperationDecision): Promise<PendingOperation> {
    return await this.#goondan.operations.decide(this.#sessionId, operationId, decision);
  }

  interrupt(): boolean {
    const aborted = this.#goondan.abort(this.#sessionId);
    if (aborted) this.#interrupted = true;
    return aborted;
  }

  async close(): Promise<void> {
    const interrupted = this.interrupt();
    await this.#active?.catch(() => undefined);
    if (!interrupted) await this.#goondan.idle();
    await this.#goondan.close();
  }

  async #run(input: RunInput, options: { agent?: string }): Promise<ChatTurnResult> {
    try {
      const run = await this.#goondan.run(input, { sessionId: this.#sessionId, agent: options.agent });
      const result = await run.result;
      return { kind: 'completed', text: renderOutputs(result.outputs, !this.#streamed), streamed: this.#streamed };
    } catch (error) {
      if (this.#interrupted) throw new DOMException('Chat turn interrupted', 'AbortError');
      throw error;
    }
  }
}
