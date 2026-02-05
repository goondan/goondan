/**
 * ValueSource / SecretRef 타입 정의
 * @see /docs/specs/resources.md - 5. ValueSource / SecretRef 타입
 */

/**
 * 비밀 저장소 참조
 */
export interface SecretRef {
  /** Secret 참조 (예: "Secret/slack-oauth") */
  ref: string;
  /** Secret 내의 키 */
  key: string;
}

/**
 * 외부 소스에서 값 주입
 * - env: 환경 변수에서 읽기
 * - secretRef: 비밀 저장소에서 읽기
 */
export type ValueFrom =
  | { env: string; secretRef?: never }
  | { env?: never; secretRef: SecretRef };

/**
 * 값 소스 - 직접 값 또는 외부 소스에서 주입
 * - value: 직접 값 지정
 * - valueFrom: 외부 소스에서 읽기
 *
 * MUST: value와 valueFrom은 동시에 존재할 수 없음
 */
export type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: ValueFrom };
