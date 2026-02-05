/**
 * Bundle Package 에러 정의
 * @see /docs/specs/bundle_package.md
 */

/**
 * 기본 Package 에러
 */
export class PackageError extends Error {
  override name = 'PackageError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Error 클래스 상속 시 prototype chain 복구
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 패키지 참조 파싱 에러 옵션
 */
export interface PackageRefParseErrorOptions extends ErrorOptions {
  input: string;
  expectedFormat?: string;
}

/**
 * 패키지 참조 파싱 에러
 */
export class PackageRefParseError extends PackageError {
  override name = 'PackageRefParseError';

  /** 원본 입력 문자열 */
  readonly input: string;
  /** 예상 형식 */
  readonly expectedFormat?: string;

  constructor(message: string, options: PackageRefParseErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.input = options.input;
    this.expectedFormat = options.expectedFormat;
  }
}

/**
 * 패키지 Fetch 에러 옵션
 */
export interface PackageFetchErrorOptions extends ErrorOptions {
  packageRef: string;
  url?: string;
  statusCode?: number;
  registry?: string;
}

/**
 * 패키지 Fetch 에러
 */
export class PackageFetchError extends PackageError {
  override name = 'PackageFetchError';

  /** 패키지 참조 */
  readonly packageRef: string;
  /** 요청 URL */
  readonly url?: string;
  /** HTTP 상태 코드 */
  readonly statusCode?: number;
  /** 레지스트리 URL */
  readonly registry?: string;

  constructor(message: string, options: PackageFetchErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.packageRef = options.packageRef;
    this.url = options.url;
    this.statusCode = options.statusCode;
    this.registry = options.registry;
  }
}

/**
 * 패키지 무결성 에러 옵션
 */
export interface PackageIntegrityErrorOptions extends ErrorOptions {
  packageRef: string;
  expected: string;
  actual: string;
}

/**
 * 패키지 무결성 에러
 */
export class PackageIntegrityError extends PackageError {
  override name = 'PackageIntegrityError';

  /** 패키지 참조 */
  readonly packageRef: string;
  /** 예상 해시 */
  readonly expected: string;
  /** 실제 해시 */
  readonly actual: string;

  constructor(message: string, options: PackageIntegrityErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.packageRef = options.packageRef;
    this.expected = options.expected;
    this.actual = options.actual;
  }
}

/**
 * 패키지 Not Found 에러 옵션
 */
export interface PackageNotFoundErrorOptions extends ErrorOptions {
  packageRef: string;
  registry?: string;
  availableVersions?: string[];
}

/**
 * 패키지 Not Found 에러
 */
export class PackageNotFoundError extends PackageError {
  override name = 'PackageNotFoundError';

  /** 패키지 참조 */
  readonly packageRef: string;
  /** 레지스트리 URL */
  readonly registry?: string;
  /** 사용 가능한 버전 목록 */
  readonly availableVersions?: string[];

  constructor(message: string, options: PackageNotFoundErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.packageRef = options.packageRef;
    this.registry = options.registry;
    this.availableVersions = options.availableVersions;
  }
}

/**
 * 의존성 해석 에러 옵션
 */
export interface DependencyResolutionErrorOptions extends ErrorOptions {
  packageRef: string;
  dependencyChain?: string[];
  conflictingVersions?: string[];
}

/**
 * 의존성 해석 에러
 */
export class DependencyResolutionError extends PackageError {
  override name = 'DependencyResolutionError';

  /** 패키지 참조 */
  readonly packageRef: string;
  /** 의존성 체인 */
  readonly dependencyChain?: string[];
  /** 충돌하는 버전 목록 */
  readonly conflictingVersions?: string[];

  constructor(message: string, options: DependencyResolutionErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.packageRef = options.packageRef;
    this.dependencyChain = options.dependencyChain;
    this.conflictingVersions = options.conflictingVersions;
  }
}

/**
 * PackageError 타입 가드
 */
export function isPackageError(value: unknown): value is PackageError {
  return value instanceof PackageError;
}
