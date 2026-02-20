import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import type { ProviderConfig } from './types.js';

const PROVIDERS: ReadonlyMap<string, ProviderConfig> = new Map([
  [
    'anthropic',
    {
      name: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      models: {
        fast: 'claude-haiku-4-5',
        default: 'claude-sonnet-4-5',
      },
    },
  ],
  [
    'openai',
    {
      name: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: {
        fast: 'gpt-5-nano',
        default: 'gpt-5.2',
      },
    },
  ],
  [
    'google',
    {
      name: 'google',
      apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
      models: {
        fast: 'gemini-3-flash-preview',
        default: 'gemini-3.1-pro-preview',
      },
    },
  ],
]);

/**
 * 프로바이더 설정을 반환한다.
 * @throws 지원하지 않는 프로바이더인 경우
 */
export function getProviderConfig(name: string): ProviderConfig {
  const config = PROVIDERS.get(name);
  if (!config) {
    const supported = Array.from(PROVIDERS.keys()).join(', ');
    throw new Error(
      `Unknown provider "${name}". Supported providers: ${supported}`,
    );
  }
  return config;
}

/** 등록된 모든 프로바이더 이름 목록 */
export function listProviders(): readonly string[] {
  return Array.from(PROVIDERS.keys());
}

/**
 * judge용 LanguageModel을 생성한다 (sonnet-tier / default 모델 사용).
 * API 키는 환경변수에서 읽는다.
 * @throws API 키가 설정되지 않은 경우
 */
export function createJudgeModel(providerName: string): LanguageModel {
  const config = getProviderConfig(providerName);
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `API key not found. Set the ${config.apiKeyEnv} environment variable.`,
    );
  }

  const model = config.models.default;

  switch (config.name) {
    case 'anthropic':
      return createAnthropic({ apiKey }).languageModel(model);
    case 'openai':
      return createOpenAI({ apiKey }).languageModel(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey }).languageModel(model);
    default:
      throw new Error(`No model factory for provider "${config.name}"`);
  }
}
