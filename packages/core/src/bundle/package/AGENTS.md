# Bundle Package 시스템

Goondan Bundle Package 시스템은 패키지 레지스트리, Git, 로컬 경로를 통해 Bundle Package를 참조하고 다운로드/캐싱/의존성 해석을 수행합니다.

## 스펙 문서

- `/docs/specs/bundle_package.md` - Bundle Package 스펙

## 디렉토리 구조

```
package/
├── types.ts          # Package 관련 타입 (PackageRef, PackageSpec, ResolvedDependency 등)
├── errors.ts         # Package 관련 에러 (PackageError, PackageRefParseError 등)
├── ref-parser.ts     # 패키지 참조 문자열 파싱/포맷팅
├── cache.ts          # 패키지 캐싱 (PackageCache)
├── git.ts            # Git 저장소 다운로드 (GitFetcher)
├── manager.ts        # PackageManager 구현
├── resolver.ts       # DependencyResolver 구현 (의존성 해석)
└── index.ts          # 모든 기능 re-export
```

## 핵심 타입

### PackageRef
패키지 참조 정보를 담는 구조체입니다. 세 가지 타입을 지원합니다:

- `registry`: 레지스트리 패키지 (`@goondan/base@1.0.0`)
- `git`: Git 저장소 (`git+https://github.com/goondan/tools.git#v1.0.0`)
- `local`: 로컬 경로 (`file:../shared-extensions`)

### PackageSpec
`kind: Package` 리소스의 spec 구조입니다:

```yaml
spec:
  dependencies:
    - "@goondan/utils@^1.0.0"
  resources:
    - tools/fileRead.yaml
  dist:
    - dist/
```

### PackageManager
패키지 참조 해석, 다운로드, 캐싱을 담당합니다.

### DependencyResolver
패키지의 의존성을 재귀적으로 해석하고 로드 순서를 결정합니다.

## 참조 형식

### 레지스트리 참조
```
@goondan/base
@goondan/base@1.0.0
@goondan/base@^1.0.0
simple-package@2.0.0
```

### Git 참조
```
git+https://github.com/goondan/tools.git
git+https://github.com/goondan/tools.git#v1.0.0
git+ssh://git@github.com/company/tools.git#main
github:goondan/slack-tools#v1.0.0
```

### 로컬 참조
```
file:../shared-extensions
file:/absolute/path/to/package
link:../linked-package
```

## 캐시 규칙

- 기본 캐시 경로: `~/.goondan/packages/`
- 레지스트리: `<cacheDir>/@scope/name/version/`
- Git: `<cacheDir>/git/<owner>-<repo>-<ref>/`
- 로컬: 캐시하지 않고 원본 경로 사용

## 의존성 해석 순서

1. 의존성 트리를 재귀적으로 탐색
2. 순환 의존성 감지 시 에러
3. 중복 의존성은 한 번만 포함
4. 위상 정렬로 의존성 → 현재 순서 결정

## 개발 규칙

1. `as` 타입 단언 금지
2. 모든 에러는 `PackageError` 상속 클래스 사용
3. 타입 가드 함수 제공 (`isPackageRef`, `isPackageSpec` 등)
