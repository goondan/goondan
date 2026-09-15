import { createRuntime, textOf, type Json, type LoadedConfig, type RuntimeBindings } from '@goondan/core';
import { FileConversationStore } from './session.js';

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

export class ChatHost {
  readonly #conversationId: string;
  readonly #runtime;
  #active: Promise<ChatTurnResult> | undefined;
  #streamed = false;
  #interrupted = false;

  constructor(options: ChatHostOptions) {
    this.#conversationId = options.sessionId;
    const originalHost = options.bindings.host;
    this.#runtime = createRuntime(options.config, {
      ...options.bindings,
      conversationStore: new FileConversationStore(options.stateDirectory, options.sessionId),
      host: {
        ...originalHost,
        emit: async (event) => {
          await originalHost?.emit?.(event);
          if (event.name === 'step.textDelta' && !options.finalOnly) {
            const delta = event.data['delta'];
            if (typeof delta === 'string') {
              this.#streamed = true;
              options.onTextDelta?.(delta);
            }
          } else if (event.name === 'tool.start') {
            const tool = event.data['tool'];
            if (typeof tool === 'string') options.onStatus?.(`Running tool: ${tool}`);
          } else if (event.name === 'tool.error') {
            const tool = event.data['tool']; const error = event.data['error'];
            if (typeof tool === 'string' && typeof error === 'string') options.onStatus?.(`Tool failed (${tool}): ${error}`);
          }
        },
      },
    });
  }

  get active(): boolean { return this.#active !== undefined; }

  submit(input: Json): { kind: 'steered' } | { kind: 'started'; completion: Promise<ChatTurnResult> } {
    if (this.#active) {
      this.#runtime.steer(this.#conversationId, input);
      return { kind: 'steered' };
    }
    this.#streamed = false;
    this.#interrupted = false;
    const completion = this.#run(input);
    this.#active = completion;
    void completion.finally(() => {
      if (this.#active === completion) this.#active = undefined;
    }).catch(() => {});
    return { kind: 'started', completion };
  }

  interrupt(): boolean {
    const aborted = this.#runtime.abort(this.#conversationId);
    if (aborted) this.#interrupted = true;
    return aborted;
  }

  async close(): Promise<void> {
    const interrupted = this.interrupt();
    await this.#active?.catch(() => undefined);
    if (!interrupted) await this.#runtime.idle();
    await this.#runtime.close();
  }

  async #run(input: Json): Promise<ChatTurnResult> {
    try {
      const result = await this.#runtime.runTurn(input, { conversationId: this.#conversationId });
      return { kind: 'completed', text: textOf(result.output.content), streamed: this.#streamed };
    } catch (error) {
      if (this.#interrupted) throw new DOMException('Chat turn interrupted', 'AbortError');
      throw error;
    }
  }
}
