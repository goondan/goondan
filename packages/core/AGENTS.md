# @goondan/core

Goondan Agent Swarm Orchestrator의 코어 패키지입니다.

## 디렉토리 구조

```
src/
├── types/        # [구현완료] 공통 타입 정의 (Resource, ObjectRef, Selector, ValueSource 등)
│   ├── json.ts           # JSON 기본 타입
│   ├── json-schema.ts    # JSON Schema 타입
│   ├── resource.ts       # Resource, ResourceMetadata, KnownKind
│   ├── object-ref.ts     # ObjectRef, ObjectRefLike
│   ├── selector.ts       # Selector, SelectorWithOverrides, RefOrSelector
│   ├── value-source.ts   # ValueSource, ValueFrom, SecretRef
│   ├── utils.ts          # 유틸리티 함수 (타입 가드, deepMerge, resolveValueSource)
│   └── specs/            # Kind별 Spec 인터페이스 (Model, Tool, Extension, Connection 등)
├── bundle/       # [구현완료] Bundle YAML 파싱, 검증 및 Package 시스템
│   ├── errors.ts         # Bundle 에러 타입
│   ├── parser.ts         # YAML 파싱
│   ├── validator.ts      # 리소스 검증
│   ├── resolver.ts       # 참조 해석
│   ├── loader.ts         # Bundle 로딩 (dependency 자동 로드 지원, file: 프로토콜 지원, pnpm workspace 검색 fallback)
│   ├── __tests__/        # Bundle 로더 테스트
│   └── package/          # Package 시스템 (참조 파싱, 캐싱, 의존성 해석)
├── runtime/      # [구현완료] 런타임 실행 모델 (SwarmInstance, AgentInstance, Turn, Step)
│   ├── types.ts              # Runtime 타입 (LlmMessage, ToolCall, TurnOrigin, TurnAuth 등)
│   ├── swarm-instance.ts     # SwarmInstance 클래스, SwarmInstanceManager (lifecycle metadata hooks 지원)
│   ├── agent-instance.ts     # AgentInstance 클래스, AgentEventQueue
│   ├── turn-runner.ts        # Turn 실행 로직, TurnRunner (turn 종료 시 base/events 반영 훅 지원)
│   ├── step-runner.ts        # Step 실행 로직, StepRunner (step.pre 포함)
│   ├── effective-config.ts   # EffectiveConfig 계산, normalizeByIdentity
│   ├── message-builder.ts    # LLM 메시지 빌더
│   └── index.ts              # 모든 기능 re-export
├── pipeline/     # 파이프라인 시스템 (Mutator, Middleware)
├── tool/         # [구현완료] Tool 시스템 (Registry, Catalog, Handler)
│   ├── types.ts          # Tool 관련 타입 (ToolHandler, ToolContext, ToolResult 등)
│   ├── registry.ts       # ToolRegistry - 동적 Tool 등록/관리
│   ├── catalog.ts        # ToolCatalog - LLM에 노출되는 Tool 목록
│   ├── executor.ts       # ToolExecutor - Tool 실행 엔진
│   ├── loader.ts         # ToolLoader - Tool 모듈 로더
│   ├── context.ts        # ToolContextBuilder - 실행 컨텍스트 빌더
│   ├── utils.ts          # 유틸리티 (truncate, result 생성)
│   └── index.ts          # 모든 기능 re-export
├── extension/    # [구현완료] Extension 시스템 (ExtensionApi, 파이프라인 등록)
│   ├── types.ts           # Extension 타입 (PipelinePoint, Context, ExtensionApi 등)
│   ├── event-bus.ts       # EventBus 구현 (이벤트 발행/구독)
│   ├── state-store.ts     # StateStore 구현 (Extension별/공유 상태, 복원/영속화 옵션)
│   ├── pipeline-registry.ts # PipelineRegistry (Mutator/Middleware 등록/실행)
│   ├── tool-registry.ts   # ToolRegistry (동적 Tool 등록/해제)
│   ├── api.ts             # createExtensionApi 팩토리
│   ├── loader.ts          # ExtensionLoader (모듈 로드/초기화)
│   └── index.ts           # 모든 기능 re-export
├── connector/    # [구현완료] Connector/Connection 시스템 (v1.0: Entry Function, ConnectorEvent, Ingress)
│   ├── types.ts          # ConnectorContext, ConnectorEvent, ConnectorTriggerEvent 등 런타임 타입
│   ├── ingress.ts        # IngressMatcher, matchIngressRule, routeEvent (ConnectorEvent 기반)
│   ├── trigger.ts        # loadConnectorEntry, createConnectorContext, validateConnectorEntry
│   └── index.ts          # 모든 기능 re-export
├── oauth/        # OAuth 시스템 (OAuthApp, OAuthStore, Token 관리)
├── changeset/    # Changeset 시스템 (SwarmBundleRef, ChangesetPolicy)
├── workspace/    # Workspace 시스템 (3루트 분리, 경로 규칙, metadata/state 영속화 유틸)
└── index.ts      # 메인 엔트리포인트
```

## 스펙 문서 참조

각 모듈은 `/docs/specs/` 하위의 스펙 문서를 기반으로 구현됩니다:

- `types/` → `/docs/specs/resources.md`
- `bundle/` → `/docs/specs/bundle.md`, `/docs/specs/bundle_package.md`
- `runtime/` → `/docs/specs/runtime.md`
- `pipeline/` → `/docs/specs/pipeline.md`
- `tool/` → `/docs/specs/tool.md`
- `extension/` → `/docs/specs/extension.md`
- `connector/` → `/docs/specs/connector.md`, `/docs/specs/connection.md`
- `oauth/` → `/docs/specs/oauth.md`
- `changeset/` → `/docs/specs/changeset.md`
- `workspace/` → `/docs/specs/workspace.md`

## 개발 규칙

1. **TDD 방식**: 테스트 코드를 먼저 작성하고, 테스트를 통과하는 코드를 구현합니다.
2. **타입 안전성**: `as` 타입 단언 금지. 타입 가드와 정확한 타입 정의로 해결합니다.
   - `Resource<unknown>`의 spec 접근: `getSpec(resource)` 헬퍼 사용 (types/utils.ts)
   - `NodeJS.ErrnoException` 체크: `isNodeError(err)` 타입 가드 사용
   - `JSON.parse` 결과: 타입 가드 함수로 검증 후 사용
   - 제네릭 파이프라인 핸들러 등록: TypeScript 구조적 한계로 내부 변환 시 허용
3. **스펙 준수**: 스펙 문서의 MUST/SHOULD/MAY 규칙을 엄격히 준수합니다.
4. **의존성 순서**:
   - `types/`는 다른 모듈에 의존하지 않음
   - `bundle/`은 `types/`에만 의존
   - 다른 모듈들은 `types/`, `bundle/`에 의존 가능

## 테스트

```bash
pnpm test           # 테스트 실행
pnpm test:watch     # 워치 모드
pnpm test:coverage  # 커버리지 리포트
```

## 빌드

```bash
pnpm build          # TypeScript 컴파일
pnpm typecheck      # 타입 체크만
```

## 구현 현황

| 모듈 | 상태 | 테스트 |
|------|------|--------|
| types/ | 완료 | 169개 테스트 통과 |
| bundle/ | 완료 | 247개 테스트 통과 |
| runtime/ | 완료 | 150개 테스트 통과 |
| pipeline/ | 완료 | 108개 테스트 통과 |
| tool/ | 완료 | 94개 테스트 통과 |
| extension/ | 완료 | 105개 테스트 통과 |
| connector/ | 완료 | 131개 테스트 통과 |
| oauth/ | 완료 | 107개 테스트 통과 |
| changeset/ | 완료 | 99개 테스트 통과 |
| workspace/ | 완료 | 147개 테스트 통과 |
