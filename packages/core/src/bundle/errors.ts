/**
 * Bundle 관련 오류 타입 정의
 * @see /docs/specs/bundle.md
 */

/**
 * Bundle 오류의 기본 클래스
 */
export class BundleError extends Error {
  readonly errorCause?: unknown;
  /** 사용자에게 다음 행동을 안내하는 메시지 */
  readonly suggestion?: string;
  /** 관련 문서 URL */
  readonly helpUrl?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; suggestion?: string; helpUrl?: string }
  ) {
    super(message);
    this.name = 'BundleError';
    if (options?.cause) {
      this.errorCause = options.cause;
    }
    this.suggestion = options?.suggestion;
    this.helpUrl = options?.helpUrl;

    // Error 프로토타입 체인 복원 (TypeScript ES5 타겟 호환)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ParseError 옵션
 */
export interface ParseErrorOptions {
  /** 원인 오류 */
  cause?: unknown;
  /** 소스 파일 경로 */
  source?: string;
  /** 오류 발생 라인 */
  line?: number;
  /** 오류 발생 컬럼 */
  column?: number;
  /** 다중 문서에서의 문서 인덱스 */
  documentIndex?: number;
  /** 사용자에게 다음 행동을 안내하는 메시지 */
  suggestion?: string;
  /** 관련 문서 URL */
  helpUrl?: string;
}

/**
 * YAML 파싱 오류
 */
export class ParseError extends BundleError {
  /** 소스 파일 경로 */
  readonly source?: string;
  /** 오류 발생 라인 */
  readonly line?: number;
  /** 오류 발생 컬럼 */
  readonly column?: number;
  /** 다중 문서에서의 문서 인덱스 */
  readonly documentIndex?: number;

  constructor(message: string, options: ParseErrorOptions = {}) {
    super(message, { cause: options.cause, suggestion: options.suggestion, helpUrl: options.helpUrl });
    this.name = 'ParseError';
    this.source = options.source;
    this.line = options.line;
    this.column = options.column;
    this.documentIndex = options.documentIndex;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ValidationError 옵션
 */
export interface ValidationErrorOptions {
  /** 원인 오류 */
  cause?: unknown;
  /** JSON Pointer 형식의 경로 */
  path?: string;
  /** 리소스 Kind */
  kind?: string;
  /** 리소스 이름 */
  resourceName?: string;
  /** 예상 값 */
  expected?: string;
  /** 실제 값 */
  actual?: string;
  /** 오류 수준 */
  level?: 'error' | 'warning';
  /** 사용자에게 다음 행동을 안내하는 메시지 */
  suggestion?: string;
  /** 관련 문서 URL */
  helpUrl?: string;
}

/**
 * 리소스 검증 오류
 */
export class ValidationError extends BundleError {
  /** JSON Pointer 형식의 경로 */
  readonly path?: string;
  /** 리소스 Kind */
  readonly kind?: string;
  /** 리소스 이름 */
  readonly resourceName?: string;
  /** 예상 값 */
  readonly expected?: string;
  /** 실제 값 */
  readonly actual?: string;
  /** 오류 수준 */
  readonly level: 'error' | 'warning';

  constructor(message: string, options: ValidationErrorOptions = {}) {
    super(message, { cause: options.cause, suggestion: options.suggestion, helpUrl: options.helpUrl });
    this.name = 'ValidationError';
    this.path = options.path;
    this.kind = options.kind;
    this.resourceName = options.resourceName;
    this.expected = options.expected;
    this.actual = options.actual;
    this.level = options.level ?? 'error';

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ReferenceError 옵션
 */
export interface ReferenceErrorOptions {
  /** 원인 오류 */
  cause?: unknown;
  /** 참조하는 리소스의 Kind */
  sourceKind?: string;
  /** 참조하는 리소스의 이름 */
  sourceName?: string;
  /** 참조 대상 리소스의 Kind */
  targetKind?: string;
  /** 참조 대상 리소스의 이름 */
  targetName?: string;
  /** 사용자에게 다음 행동을 안내하는 메시지 */
  suggestion?: string;
  /** 관련 문서 URL */
  helpUrl?: string;
}

/**
 * 참조 무결성 오류
 */
export class ReferenceError extends BundleError {
  /** 참조하는 리소스의 Kind */
  readonly sourceKind?: string;
  /** 참조하는 리소스의 이름 */
  readonly sourceName?: string;
  /** 참조 대상 리소스의 Kind */
  readonly targetKind?: string;
  /** 참조 대상 리소스의 이름 */
  readonly targetName?: string;

  constructor(message: string, options: ReferenceErrorOptions = {}) {
    super(message, { cause: options.cause, suggestion: options.suggestion, helpUrl: options.helpUrl });
    this.name = 'ReferenceError';
    this.sourceKind = options.sourceKind;
    this.sourceName = options.sourceName;
    this.targetKind = options.targetKind;
    this.targetName = options.targetName;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * BundleError 인스턴스인지 확인
 * @param value 확인할 값
 * @returns BundleError 여부
 */
export function isBundleError(value: unknown): value is BundleError {
  return value instanceof BundleError;
}
