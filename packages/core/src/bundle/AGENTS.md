# Bundle 시스템

Goondan Bundle 시스템은 YAML 기반 리소스 정의를 파싱, 검증, 참조 해석하고 패키지 관리를 수행합니다.

## 스펙 문서

- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/bundle_package.md` - Bundle Package 스펙
- `/docs/specs/resources.md` - 리소스 타입 스펙 (ObjectRef, ValueSource, Kind별 스키마)

## 디렉토리 구조

```
bundle/
├── errors.ts         # Bundle 에러 (BundleError, ParseError, ValidationError, ReferenceError)
├── parser.ts         # YAML 파싱 (parseYaml, parseMultiDocument)
├── validator.ts      # 리소스 검증 (Kind별 필수 필드, ValueSource, scopes 검증)
├── resolver.ts       # 참조 해석 (ObjectRef 해석, 참조 무결성, 순환 참조 감지)
├── loader.ts         # Bundle 로딩 (파일/디렉토리 로드, 검증 통합)
├── package/          # Package 시스템 (패키지 참조, 다운로드, 캐싱, 의존성 해석)
└── index.ts          # 모든 기능 re-export
```

## 하위 모듈

- `package/` - Bundle Package 시스템 (별도 AGENTS.md 참조)

## 에러 타입 (errors.ts)

- `BundleError` - 기본 에러 클래스 (errorCause로 원인 추적)
- `ParseError` - YAML 파싱 에러 (source, line, column, documentIndex)
- `ValidationError` - 검증 에러 (path, kind, resourceName, expected, actual, level)
- `ReferenceError` - 참조 무결성 에러 (sourceKind, sourceName, targetKind, targetName)
- `isBundleError(value)` - BundleError 타입 가드

## 주요 함수

### 파싱 (parser.ts)
- `parseYaml(content)` - 단일 YAML 문서 파싱
- `parseMultiDocument(content, source?)` - 멀티 문서 YAML 파싱
- `DEFAULT_API_VERSION` - 기본 apiVersion 상수 (`agents.example.io/v1alpha1`)

### 검증 (validator.ts)
- `validateResource(resource)` - 단일 리소스 검증 (Kind별 필수 필드)
- `validateResources(resources)` - 리소스 목록 일괄 검증
- `validateNameUniqueness(resources)` - 동일 Kind 내 이름 유일성 검증
- `validateObjectRef(ref, index)` - ObjectRef 참조 대상 존재 검증
- `validateValueSource(vs, path, ctx)` - ValueSource mutual exclusivity 검증
- `validateScopesSubset(toolScopes, oauthAppScopes, ctx)` - Tool scopes가 OAuthApp scopes의 부분집합인지 검증

### 참조 해석 (resolver.ts)
- `resolveObjectRef(ref, index)` - ObjectRef를 리소스로 해석 (string/object 형식 지원)
- `resolveAllReferences(resources)` - 모든 리소스의 참조 무결성 검증
- `detectCircularReferences(resources)` - 순환 참조 감지
- `createResourceIndex(resources)` - `Kind/name` 키로 리소스 인덱스 생성

### 로딩 (loader.ts)
- `loadBundleFromString(content, source?)` - 문자열에서 로드 (파싱+검증+참조해석)
- `loadBundleFromFile(filePath)` - 파일에서 로드 (async)
- `loadBundleFromDirectory(dirPath, options?)` - 디렉토리에서 로드 (glob 패턴, async)

### BundleLoadResult 인터페이스
- `resources` - 파싱된 리소스 배열
- `errors` - 발생한 에러 배열
- `sources` - 로드된 소스 파일 경로
- `isValid()` - 오류(warning 제외) 없이 로드되었는지 확인
- `getResourcesByKind(kind)` - 특정 Kind의 리소스들 조회
- `getResource(kind, name)` - 특정 리소스 조회

## Kind별 검증 규칙

| Kind | 필수 필드 | 추가 검증 |
|------|----------|----------|
| Model | spec.provider, spec.name | - |
| Tool | spec.runtime, spec.entry, spec.exports (min 1) | runtime ∈ {node, python, deno}, exports[].name/description/parameters 필수 |
| Extension | spec.runtime, spec.entry | runtime ∈ {node, python, deno} |
| Agent | spec.modelConfig.modelRef, spec.prompts (system xor systemRef) | system/systemRef 상호 배타 |
| Swarm | spec.entrypoint, spec.agents (min 1) | policy.maxStepsPerTurn > 0, queueMode = 'serial', lifecycle 양수 검증 |
| Connector | spec.runtime (='node'), spec.entry, spec.triggers (min 1) | http: endpoint.path ('/'로 시작), endpoint.method; cron: schedule; events 이름 유일성 |
| Connection | spec.connectorRef | auth.oauthAppRef/staticToken 상호 배타 |
| OAuthApp | spec.provider, spec.flow, spec.subjectMode, spec.scopes (min 1) | authorizationCode: endpoints.authorizationUrl, redirect.callbackPath |
| ResourceType | spec.group, spec.names, spec.versions (min 1), spec.handlerRef | - |
| ExtensionHandler | spec.runtime, spec.entry, spec.exports (min 1) | - |

## 개발 규칙

1. `as` 타입 단언 금지 - 타입 가드와 정확한 타입 정의 사용
2. 모든 파싱/검증 에러는 `BundleError` 상속 클래스 사용
3. 기본 apiVersion: `agents.example.io/v1alpha1`
4. ValidationError는 level이 'warning'인 경우 isValid()에서 무시됨
5. ObjectRef는 `"Kind/name"` 문자열 또는 `{kind, name}` 객체 형식 지원

## 테스트

테스트 파일 위치: `packages/core/__tests__/bundle/`
- errors.test.ts (8 tests)
- parser.test.ts (11 tests)
- validator.test.ts (54 tests) - Connector(triggers/events), Swarm(queueMode/lifecycle) 검증 포함
- resolver.test.ts (14 tests)
- loader.test.ts (17 tests)
- index.test.ts (21 tests)
