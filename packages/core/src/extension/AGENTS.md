# Extension 시스템

Extension은 런타임 라이프사이클의 특정 지점(파이프라인 포인트)에 개입하여 동작을 확장하는 실행 로직 묶음입니다.

## 스펙 문서

- `/docs/specs/extension.md` - Extension 시스템 스펙

## 파일 구조

```
extension/
├── types.ts           # Extension 시스템 타입 정의 (PipelinePoint, Context, ExtensionApi 등)
├── event-bus.ts       # EventBus 구현 (이벤트 발행/구독, glob 패턴 지원)
├── state-store.ts     # StateStore 구현 (Extension별 상태, 공유 상태)
├── pipeline-registry.ts # PipelineRegistry 클래스 (Mutator/Middleware 등록/실행)
├── tool-registry.ts   # ToolRegistry 클래스 (동적 Tool 등록/해제/실행)
├── api.ts             # createExtensionApi 팩토리 (ExtensionApi 생성)
├── loader.ts          # ExtensionLoader 클래스 (Extension 모듈 로드/초기화)
└── index.ts           # 모듈 re-export (충돌 방지 별칭 포함)
```

## 주요 컴포넌트

### ExtensionApi
Extension의 `register()` 함수에 전달되는 API 인터페이스:
- `extension`: Extension 리소스 정의
- `pipelines`: Mutator/Middleware 등록 API
- `tools`: 동적 Tool 등록 API
- `events`: 이벤트 버스
- `swarmBundle`: Changeset API
- `liveConfig`: Live Config API
- `oauth`: OAuth API
- `extState()`: Extension별 격리 상태
- `instance.shared`: 인스턴스 공유 상태

### PipelineRegistry
파이프라인 핸들러 등록 및 실행:
- `mutate(point, handler, options)`: Mutator 등록 (순차 실행)
- `wrap(point, handler, options)`: Middleware 등록 (Onion 구조)
- `runMutators(point, ctx)`: Mutator 실행
- `runMiddleware(point, ctx, core)`: Middleware 실행

### EventBus
이벤트 발행/구독 시스템:
- `emit(type, payload)`: 이벤트 발행
- `on(type, handler)`: 구독 (glob 패턴 지원: `workspace.*`)
- `once(type, handler)`: 일회성 구독
- `off(type, handler)`: 구독 해제

### StateStore
상태 관리:
- `getExtensionState(name)`: Extension별 격리 상태
- `getSharedState()`: 인스턴스 공유 상태
- `clearExtensionState(name)`: Extension 상태 초기화
- `clearAll()`: 모든 상태 초기화

### ToolRegistry
동적 Tool 관리:
- `register(toolDef)`: Tool 등록
- `unregister(name)`: Tool 해제
- `get(name)`: Tool 조회
- `list()`: 모든 Tool 목록
- `execute(name, ctx, input)`: Tool 실행

### ExtensionLoader
Extension 모듈 로드:
- `loadExtensions(extensions)`: 순차 로드 및 초기화
- `unloadAll()`: 모든 Extension 언로드

## 파이프라인 포인트

### Mutator 포인트 (순차 실행)
- `turn.pre`, `turn.post`: Turn 레벨
- `step.pre`, `step.config`, `step.tools`, `step.blocks`, `step.post`: Step 레벨
- `step.llmError`: LLM 에러 처리
- `toolCall.pre`, `toolCall.post`: Tool 호출 레벨
- `workspace.repoAvailable`, `workspace.worktreeMounted`: Workspace 레벨

### Middleware 포인트 (Onion 래핑)
- `step.llmCall`: LLM 호출 래핑
- `toolCall.exec`: Tool 실행 래핑

## 개발 규칙

1. **타입 단언 금지**: `as` 사용 금지. 통합 핸들러 타입과 타입 가드로 처리.
2. **충돌 방지**: tool, pipeline 모듈과 타입 이름 충돌 시 `Ext` 접두사 사용.
3. **비동기 안전**: EventBus 핸들러는 비동기 실행, 오류 격리.
4. **테스트 위치**: `__tests__/extension/` 폴더에 테스트 작성.

## 테스트 현황

- `types.test.ts`: 14개 테스트
- `event-bus.test.ts`: 14개 테스트
- `state-store.test.ts`: 12개 테스트
- `pipeline-registry.test.ts`: 17개 테스트
- `tool-registry.test.ts`: 17개 테스트
- `api.test.ts`: 18개 테스트
- `loader.test.ts`: 13개 테스트

총 105개 테스트 통과
