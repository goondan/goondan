# goondan 구현 정확성 검증 보고서

## 1. Runtime 실행 모델 (Instance/Turn/Step)
- **스펙 요구사항**: Connector 이벤트를 instanceKey로 SwarmInstance에 라우팅하고, AgentInstance 큐에서 Turn/Step 루프를 수행하며 Step 시작 시 Effective Config 고정, Turn.messages에 LLM/Tool 결과를 누적해 다음 Step에 사용해야 함.
- **구현 위치**: `packages/core/src/runtime/runtime.ts`, `packages/core/src/runtime/swarm-instance.ts`, `packages/core/src/runtime/agent-instance.ts`
- **검증 결과**: ✅ 올바름
- **상세 내용**: `Runtime.handleEvent` → `SwarmInstance` 생성/조회 → `AgentInstance` 큐 처리 흐름이 구현되어 있고, `runTurn`에서 Step 루프와 tool call 처리 후 다음 Step로 진행한다. Step 시작 시 `liveConfigManager.applyAtSafePoint`로 Effective Config를 적용하고, `Turn.messages`/`Turn.toolResults`를 `step.blocks`에 포함해 다음 Step 컨텍스트로 사용한다. LLM 메시지는 `state/instances/<instanceId>/agents/<agent>/messages/llm.jsonl`에 append-only로 기록된다.

## 2. Live Config (동적 구성 오버레이)
- **스펙 요구사항**: LiveConfigManager 단일 작성자 모델, patch proposal/평가/적용, Safe Point(step.config)에서만 적용, patch/status/cursor 파일 관리.
- **구현 위치**: `packages/core/src/live-config/manager.ts`, `packages/core/src/live-config/store.ts`, `packages/core/src/runtime/agent-instance.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: patches/status/cursor 파일 생성 및 append-only 기록, lock 파일 생성/스테일 정리는 구현됨. `applyAtSafePoint`는 step.config에서 적용되나, patch의 `applyAt` 값과 실제 Safe Point 일치 여부는 확인하지 않아 `applyAt`이 다른 값이어도 step.config에서 적용될 수 있음. swarm scope patch가 이미 적용된 경우 다른 agent의 `revision`이 증가하지 않아 `effectiveRevision` 일관성이 깨질 수 있음. lock은 경고만 하고 차단하지 않아 엄밀한 단일 작성자 보장은 약함.

## 3. 파이프라인 포인트
- **스펙 요구사항**: `turn.pre/post`, `step.pre/config/tools/blocks/llmCall/llmError/post`, `toolCall.pre/exec/post`, `workspace.*` 제공 및 순서 보장.
- **구현 위치**: `packages/core/src/runtime/agent-instance.ts`, `packages/core/src/runtime/pipelines.ts`
- **검증 결과**: ✅ 올바름
- **상세 내용**: 표준 포인트가 모두 등록되어 있고 실행 순서도 `step.config → step.tools → step.blocks`를 만족한다. `step.llmError`는 LLM 호출 실패 시 실행되며 재시도 로직도 구현됨. `toolCall.exec`는 래핑(onion) 구조로 동작하고, 컨텍스트에는 `effectiveConfig`, `toolCatalog`, `blocks`, `toolCall/toolResult`가 전달된다.

## 4. OAuth 통합
- **스펙 요구사항**: Authorization Code + PKCE(S256) 필수, at-rest encryption, refresh, ctx.oauth 제공.
- **구현 위치**: `packages/core/src/runtime/oauth.ts`, `packages/core/src/runtime/oauth-store.ts`, `packages/core/src/utils/encryption.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: PKCE(S256) 생성/저장, authorization URL 구성, callback에서 state/만료/subject 검증 및 code_verifier로 토큰 교환, grant 저장과 `auth.granted` 이벤트 enqueue가 구현됨. 토큰/PKCE/state는 AES-256-GCM으로 암호화 저장된다. 다만 refresh single-flight/락은 미구현(스펙 SHOULD), OAuthStore 위치가 스펙의 “system state” 레이아웃과 완전히 일치하지는 않음(현재 `state/oauth`).

## 5. Config Plane 리소스 정의
- **스펙 요구사항**: Model/Tool/Extension/Agent/Swarm/Connector/OAuthApp/MCPServer/Bundle/ResourceType/ExtensionHandler 정의와 검증 규칙 준수.
- **구현 위치**: `packages/core/src/sdk/types.ts`, `packages/core/src/config/validator.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: 핵심 리소스 타입(Model/Tool/Extension/Agent/Swarm/Connector/OAuthApp/MCPServer)은 타입/검증이 구현됨. 그러나 ResourceType/ExtensionHandler는 타입 정의가 없고 validator는 `handlerRef` 유무만 확인하며 실행 메커니즘이 없음. Bundle은 `BundleManifest` 타입은 있으나 validator에 없음. ValueSource 검증도 `valueFrom` 내부에 `env/secretRef` 중 하나가 반드시 있어야 한다는 규칙을 강제하지 않는다.

## 6. Tool 시스템
- **스펙 요구사항**: Tool Registry/Tool Catalog, 동적 tool 등록, OAuthApp auth 연동, errorMessageLimit 적용.
- **구현 위치**: `packages/core/src/tools/registry.ts`, `packages/core/src/runtime/agent-instance.ts`, `packages/core/src/config/validator.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: Tool 리소스 로딩/등록 및 Catalog 생성, tool 실행 시 오류 메시지 길이 제한(기본 1000자) 적용, OAuthApp scope 부분집합 검증은 구현됨. 다만 `api.tools.register`로 동적 등록된 tool은 agent의 Tool Catalog에 자동 노출되지 않으며, 별도의 `step.tools` 변형이나 LiveConfig 패치가 필요해 스펙의 기대와 해석 차이가 생길 수 있음.

## 7. Extension 시스템
- **스펙 요구사항**: `register(api)` 기반 확장 등록, 파이프라인/도구/이벤트 API 제공, Skill 확장 동작.
- **구현 위치**: `packages/core/src/runtime/agent-instance.ts`, `packages/base/src/extensions/skill/index.ts`, `packages/base/src/extensions/compaction/index.ts`
- **검증 결과**: ✅ 올바름
- **상세 내용**: Extension 로딩 및 `register(api)` 호출, `pipelines.mutate/wrap`, `tools.register`, `events.emit`, `liveConfig.proposePatch`, `extState` 제공이 구현됨. Skill 확장은 SKILL.md 스캔, `skills.catalog` 블록 주입, `skills.list/open/run` 도구 제공, `workspace.repoAvailable` 이벤트로 재스캔을 수행한다. Compaction 확장은 `step.post`에서 요약 생성 후 `step.blocks`에 압축 컨텍스트를 삽입한다.

## 8. MCP 통합
- **스펙 요구사항**: stdio/http adapters, stateful/stateless, expose 옵션, 도구/리소스/프롬프트 지원.
- **구현 위치**: `packages/core/src/runtime/runtime.ts`, `packages/core/src/mcp/manager.ts`, `packages/core/src/mcp/adapters/stdio.ts`, `packages/core/src/mcp/adapters/http.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: stdio/http 어댑터, stateful/stateless 및 scope(instance/agent) 처리, MCP tool 목록/호출 연동은 구현됨. 그러나 expose의 `resources/prompts`는 실제 제공 로직이 없고 tools 중심으로만 동작한다.

## 9. Identity-based Reconcile
- **스펙 요구사항**: Tool/Extension/MCPServer/Hook의 identity 기반 reconcile로 순서 변경 시 상태 유지, stateful MCP 연결 유지.
- **구현 위치**: `packages/core/src/runtime/agent-instance.ts`, `packages/core/src/mcp/manager.ts`
- **검증 결과**: ❌ 스펙 불일치
- **상세 내용**: Extension/MCP reconcile은 `arrayEqual`로 순서를 포함해 비교하므로 순서 변경만으로도 재초기화가 발생한다(스펙의 “순서 변경은 상태 재생성 원인 금지” 위배). Hook identity 기준은 구현되지 않았고, Tool identity 기반 reconcile도 별도 없음.

## 10. Hooks
- **스펙 요구사항**: Hook 정의에 priority와 toolCall action 포함, priority 기반 정렬 및 실행.
- **구현 위치**: `packages/core/src/sdk/types.ts`, `packages/core/src/runtime/agent-instance.ts`
- **검증 결과**: ✅ 올바름
- **상세 내용**: HookSpec에 `point/priority/action.toolCall` 구조가 정의돼 있으며, `applyHooks`에서 priority 정렬 후 toolCall을 실행하고 입력 템플릿(`expr`)을 해석한다. (Hook identity 기반 reconcile 부재는 9번 항목 참조)

## 11. Device Code OAuth Flow
- **스펙 요구사항**: 미지원 시 구성 로드/검증 단계에서 거부(MUST).
- **구현 위치**: `packages/core/src/runtime/oauth.ts`, `packages/core/src/config/validator.ts`
- **검증 결과**: ✅ 올바름
- **상세 내용**: validator는 `flow=deviceCode`를 기본적으로 거부하며, 런타임도 `deviceCodeUnsupported` 오류를 반환한다.

## 12. ResourceType/ExtensionHandler 실행 메커니즘
- **스펙 요구사항**: 사용자 정의 kind에 대한 handler 기반 검증/변환/기본값 처리.
- **구현 위치**: `packages/core/src/config/validator.ts`
- **검증 결과**: ❌ 스펙 불일치
- **상세 내용**: validator에 `handlerRef` 필수 체크만 존재하며, 실제 handler 로딩/실행/리소스 변환 메커니즘은 없다.

## 13. Workspace 모델
- **스펙 요구사항**: 워크스페이스 이벤트 및 상태 관리(스펙 상 이벤트 기반 동작 기대).
- **구현 위치**: `packages/core/src/runtime/runtime.ts`, `packages/core/src/runtime/agent-instance.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: `workspace.repoAvailable/worktreeMounted` 이벤트와 파이프라인 포인트는 있으나, 명시적 Workspace 리소스/상태 모델은 구현되지 않았다.

## 14. LLM Message Log
- **스펙 요구사항**: LLM 메시지를 append-only 로그로 저장하고 다음 Turn에 사용.
- **구현 위치**: `packages/core/src/runtime/agent-instance.ts`
- **검증 결과**: ✅ 올바름
- **상세 내용**: `llm.jsonl`에 append-only 기록하고, 다음 Turn 시작 시 이전 메시지를 로드하여 `Turn.messages`로 사용한다.

## 15. ValueSource/SecretRef
- **스펙 요구사항**: value vs valueFrom, env vs secretRef 상호배타, Secret/<name> 형식.
- **구현 위치**: `packages/core/src/sdk/types.ts`, `packages/core/src/config/validator.ts`, `packages/core/src/runtime/oauth.ts`
- **검증 결과**: ⚠️ 부분적 문제
- **상세 내용**: 타입과 기본 해석(`env`, `Secret/<name>` + `stateDir/secrets/<name>.json`)은 구현됐으나, validator가 `valueFrom` 내부에 `env/secretRef` 중 하나 필수 조건과 `secretRef.ref` 형식을 강제하지 않는다.

## 요약
- 올바르게 구현된 기능: 6개
- 부분적 문제가 있는 기능: 7개
- 스펙과 불일치하는 기능: 2개
- 주요 발견 사항: 1) identity 기반 reconcile이 순서 민감 비교로 구현되어 스펙 MUST를 위반함; 2) LiveConfig는 applyAt 처리 및 swarm patch revision 반영에 구조적 한계가 있음; 3) ResourceType/ExtensionHandler 실행 메커니즘과 MCP resources/prompts는 미구현 상태임.
