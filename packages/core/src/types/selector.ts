/**
 * Selector 타입 정의
 * @see /docs/specs/resources.md - 4. Selector + Overrides 조립 문법
 */

import type { ResourceMetadata } from './resource.js';
import type { ObjectRefLike } from './object-ref.js';

/**
 * 리소스 선택자
 */
export interface Selector {
  /** 선택할 리소스 종류 (선택) */
  kind?: string;
  /** 특정 리소스 이름으로 선택 */
  name?: string;
  /** 라벨 기반 선택 */
  matchLabels?: Record<string, string>;
}

/**
 * Selector + Overrides 블록
 */
export interface SelectorWithOverrides {
  /** 리소스 선택자 */
  selector: Selector;
  /** 선택된 리소스에 적용할 덮어쓰기 */
  overrides?: {
    spec?: Record<string, unknown>;
    metadata?: Partial<ResourceMetadata>;
  };
}

/**
 * ObjectRef 또는 Selector+Overrides의 유니온
 */
export type RefOrSelector = ObjectRefLike | SelectorWithOverrides;
