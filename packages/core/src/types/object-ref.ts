/**
 * ObjectRef 타입 정의
 * @see /docs/specs/resources.md - 3. ObjectRef 참조 문법
 */

/**
 * 객체형 참조
 */
export interface ObjectRef {
  /** API 버전 (선택) */
  apiVersion?: string;
  /** 리소스 종류 */
  kind: string;
  /** 리소스 이름 */
  name: string;
  /** 패키지 이름 (선택, Bundle Package 간 참조 시 사용) */
  package?: string;
}

/**
 * 객체 참조의 유니온 타입
 * - string: "Kind/name" 형식
 * - ObjectRef: 객체형 참조
 */
export type ObjectRefLike = string | ObjectRef;
