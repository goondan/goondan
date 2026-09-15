import type { Model } from '@goondan/core';
import { createAnthropicModel, createOpenAIChatModel, isModelError, type ModelEnv } from '@goondan/models';

/** The providers `gdn chat` can build a model for without a bindings module. */
export type ChatProvider = 'anthropic' | 'openai';

/** The model `gdn chat` uses when the provider is Anthropic and nothing names a model. */
export const DEFAULT_ANTHROPIC_CHAT_MODEL = 'claude-sonnet-5';

const ANTHROPIC_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'];
const OPENAI_ENV = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

const CREDENTIAL_HINT = 'Set the key, point the base URL at a compatible endpoint, or pass --bindings.';

export function isChatProvider(value: string): value is ChatProvider {
  return value === 'anthropic' || value === 'openai';
}

/** What the command line and the environment asked for. */
export interface ChatModelRequest { provider?: ChatProvider; model?: string; baseUrl?: string }

/** The provider and model one chat session uses. */
export interface ChatModelSelection { provider: ChatProvider; model: string; baseUrl?: string }

function envValue(env: ModelEnv, name: string): string | undefined {
  const value = Object.hasOwn(env, name) ? env[name] : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function hasAny(env: ModelEnv, names: readonly string[]): boolean {
  return names.some((name) => envValue(env, name) !== undefined);
}

function selectProvider(flag: ChatProvider | undefined, env: ModelEnv): ChatProvider {
  if (flag !== undefined) return flag;
  const named = envValue(env, 'GOONDAN_CHAT_PROVIDER');
  if (named !== undefined) {
    if (!isChatProvider(named)) throw new Error(`GOONDAN_CHAT_PROVIDER must be anthropic or openai: ${named}`);
    return named;
  }
  if (hasAny(env, ANTHROPIC_ENV)) return 'anthropic';
  if (hasAny(env, OPENAI_ENV)) return 'openai';
  return 'anthropic';
}

/**
 * Picks the provider and model of one chat session. The command line wins over
 * `GOONDAN_CHAT_PROVIDER` and `GOONDAN_CHAT_MODEL`, which win over the credentials present in the
 * environment. Anthropic falls back to `claude-sonnet-5`; an OpenAI-compatible API needs a model.
 */
export function selectChatModel(request: ChatModelRequest, env: ModelEnv): ChatModelSelection {
  const provider = selectProvider(request.provider, env);
  const model = request.model ?? envValue(env, 'GOONDAN_CHAT_MODEL')
    ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_CHAT_MODEL : undefined);
  if (model === undefined) throw new Error('gdn chat --provider openai requires --model or GOONDAN_CHAT_MODEL');
  return request.baseUrl === undefined ? { provider, model } : { provider, model, baseUrl: request.baseUrl };
}

/** Builds the official adapter for a selection and explains a missing credential. */
export function createChatModel(selection: ChatModelSelection, env: ModelEnv): Model {
  const config = { model: selection.model, env, ...(selection.baseUrl === undefined ? {} : { baseUrl: selection.baseUrl }) };
  try {
    return selection.provider === 'anthropic' ? createAnthropicModel(config) : createOpenAIChatModel(config);
  } catch (error) {
    if (isModelError(error) && error.code === 'authentication') {
      throw new Error(`${error.message}. ${CREDENTIAL_HINT}`, { cause: error });
    }
    throw error;
  }
}
