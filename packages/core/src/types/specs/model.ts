/**
 * Model Spec 타입 정의
 * @see /docs/specs/resources.md - 6.1 Model
 */

import type { Resource } from '../resource.js';

/**
 * Model 리소스 스펙
 */
export interface ModelSpec {
  /** LLM 제공자 (openai, anthropic, google 등) */
  provider: string;
  /** 모델 이름 (예: "gpt-5", "claude-sonnet-4-5") */
  name: string;
  /** 커스텀 엔드포인트 URL (선택) */
  endpoint?: string;
  /** 제공자별 추가 옵션 (선택) */
  options?: Record<string, unknown>;
}

/**
 * Model 리소스 타입
 */
export type ModelResource = Resource<ModelSpec>;
