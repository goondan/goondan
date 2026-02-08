# CLI Runtime 구현

`gdn run` 명령어에서 사용하는 실제 런타임 구현체들이 위치한 디렉토리입니다.

## 아키텍처

```
runtime/
├── index.ts                 # 모든 구현체 re-export
├── types.ts                 # 공유 타입 (RuntimeContext, RevisionState, ProcessConnectorTurnResult)
├── bundle-loader-impl.ts    # BundleLoadResult 기반 BundleLoader 구현
├── llm-caller-impl.ts       # AI SDK 기반 LLM 호출 구현
├── tool-executor-impl.ts    # Tool entry 모듈 동적 로드/실행 구현
├── connector-runner.ts      # Connection 감지, 커넥터 디스패치, 공유 헬퍼
├── telegram-connector.ts    # Telegram Bot API 롱 폴링 커넥터
├── AGENTS.md                # 이 파일
└── __tests__/               # 테스트 코드
    ├── bundle-loader-impl.test.ts
    ├── connector-runner.test.ts
    ├── llm-caller-impl.test.ts
    └── tool-executor-impl.test.ts
```

## 파일 역할

### types.ts
- `RuntimeContext`: Turn 실행에 필요한 런타임 컨텍스트 (turnRunner, toolExecutor, swarmInstanceManager 등)
- `RevisionState`: SwarmBundleRef 리비전 전환 상태 (activeRef, pendingRef, inFlightTurnsByRef)
- `ProcessConnectorTurnResult`: 커넥터 Turn 실행 결과 (response, status)
- 순환 의존성 방지를 위해 `run.ts`와 커넥터 모듈이 공유하는 타입을 별도 파일로 분리

### bundle-loader-impl.ts
- `BundleLoader` 인터페이스의 CLI 전용 구현
- `BundleLoadResult`를 기반으로 `EffectiveConfigLoader`가 필요로 하는 리소스 조회/해석을 제공
- `getResource`, `getSwarmForAgent`, `resolveToolRefs`, `resolveExtensionRefs`, `loadSystemPrompt` 구현

### llm-caller-impl.ts
- `LlmCaller` 인터페이스의 AI SDK(Vercel) 기반 구현
- `ModelResource`의 `provider`에 따라 `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` 동적 import
- Goondan `LlmMessage`/`ToolCatalogItem`을 AI SDK `CoreMessage`/`tool` 형식으로 변환
- **Tool name sanitization**: AI SDK는 tool name에 dot(`.`)을 허용하지 않으므로 (`^[a-zA-Z0-9_-]{1,128}$`), dot을 underscore로 변환하고 매핑 테이블로 원래 이름 복원
- `generateText`로 LLM 호출, 결과를 `LlmResult`로 변환

### tool-executor-impl.ts
- `ToolExecutor` 인터페이스의 구현
- `ToolSpec.entry` 경로에서 모듈 동적 import (ESM)
- export name으로 핸들러 함수를 찾아 실행 (정확한 이름 -> camelCase -> 마지막 세그먼트 -> default)
- 핸들러 호출 시그니처는 `handler(ctx, input)`을 따른다
- `workdir` 옵션: 인스턴스별 워크스페이스 경로를 지정하여 Tool CWD 바인딩에 사용 (미지정 시 `process.cwd()` 폴백)
- 기본 모드에서 `SwarmBundleRef` 세대별 Worker thread를 사용해 코드 로딩을 격리
- Worker 모드에서 `swarmBundle.openChangeset/commitChangeset`와 `agents.delegate/agents.listInstances`는 Main thread API로 RPC 전달된다
- `onAgentsDelegate`/`onAgentsListInstances` 콜백으로 agents API 위임 (run.ts에서 주입)
- `beginTurn/endTurn`으로 세대별 in-flight turn을 추적하고 idle 세대를 정리
- `maxActiveGenerations` 초과 시 오래된 idle 세대 워커를 종료하여 메모리 회수
- 에러 시 `ToolResult.error`로 변환 (예외 전파 금지)

### connector-runner.ts
- **Connection 감지**: `detectConnections(bundle)` — Bundle에서 Connection 리소스를 찾고 참조된 Connector 리소스와 매핑. `DetectConnectionsResult { connections, warnings }` 반환
- **Connector 종류 판별**: v1.0 스펙에 따라 오직 `spec.triggers[0].type`으로만 판별 (`spec.type` 필드는 제거됨)
  - `resolveTriggerType(spec)` — triggers[0].type 추출 (cli, custom, http, cron 등)
- **ConnectorRunner 인터페이스**: `start()`, `shutdown()` 메서드를 가진 커넥터 실행기 인터페이스
- **Factory**: `createConnectorRunner(options)` — trigger type 기반으로 적절한 ConnectorRunner를 생성
  - `cli` → null (run.ts의 interactive mode에서 처리)
  - `custom` → TelegramConnectorRunner (동적 import)
  - `http`, `cron` → 미구현 (null 반환)
  - **run.ts는 개별 connector 구현을 알 필요 없음** — 이 factory만 사용
- **공유 헬퍼**:
  - `isObjectWithKey()`: 타입 가드 (object이고 특정 key 보유 확인)
  - `extractStaticToken()`: Connection auth에서 ValueSource 기반 토큰 추출
  - `toIngressRules()`: Connection rules를 타입 안전한 IngressRule[]로 변환
  - `resolveAgentFromRoute()`: route에서 agentName 또는 agentRef.name 추출
- **swarmRef 필터링**: `detectConnections`는 Connection의 `spec.swarmRef`를 읽어 각 Connection이 바인딩하는 Swarm을 식별. 생략 시 모든 Swarm에 매칭 (하위 호환)

### telegram-connector.ts
- `TelegramConnectorRunner`: Telegram Bot API 롱 폴링 기반 커넥터
- `getUpdates` API로 메시지 수신 (30초 timeout 롱 폴링)
- Core의 `routeEvent()`, `createCanonicalEventFromIngress()` 사용하여 라우팅
- `processConnectorTurn` 콜백으로 Turn 실행 (run.ts에서 주입)
- `sendMessage` API로 응답 전송 (4000자 청크 분할)
- `AbortController` 기반 graceful shutdown

## 참고해야 할 사항

- **타입 단언 금지**: `as`, `as unknown as` 사용 불가. 타입 가드나 `isObjectWithKey` 등의 타입 안전 함수 사용
- **AI SDK 버전**: 현재 `ai@4.x` 기반. `CoreMessage` 타입의 discriminated union 구조에 맞게 메시지 변환
- **의존성**: 이 모듈은 `@goondan/core`의 runtime 모듈(`@goondan/core/runtime`)에 의존
- **스펙 문서**: `/docs/specs/runtime.md`, `/docs/specs/tool.md`, `/docs/specs/connector.md`, `/docs/specs/connection.md` 참조
