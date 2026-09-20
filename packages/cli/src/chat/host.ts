import { createGoondan, textOf, type Json, type LoadedConfig, type RuntimeBindings } from '@goondan/core';
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

  submit(input: Json, options: { agent?: string } = {}): { kind: 'steered' } | { kind: 'started'; completion: Promise<ChatTurnResult> } {
    if (this.#active) {
      this.#goondan.steer(this.#sessionId, input, options);
      return { kind: 'steered' };
    }
    if (options.agent !== undefined) throw new Error('A steer target requires an active turn');
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

  async #run(input: Json): Promise<ChatTurnResult> {
    try {
      const result = await this.#goondan.run(input, { sessionId: this.#sessionId });
      return { kind: 'completed', text: textOf(result.output.content), streamed: this.#streamed };
    } catch (error) {
      if (this.#interrupted) throw new DOMException('Chat turn interrupted', 'AbortError');
      throw error;
    }
  }
}
