# specs/

각 리소스 Kind별 Spec 인터페이스를 정의하는 폴더입니다.

## 스펙 문서

각 파일은 `/docs/specs/resources.md`의 해당 섹션을 기반으로 구현되었습니다:

| 파일 | 스펙 문서 섹션 |
|------|---------------|
| `model.ts` | 6.1 Model |
| `tool.ts` | 6.2 Tool |
| `extension.ts` | 6.3 Extension |
| `agent.ts` | 6.4 Agent |
| `swarm.ts` | 6.5 Swarm |
| `connector.ts` | 6.6 Connector (v1.0: runtime/entry/triggers/events) |
| `connection.ts` | 6.10 Connection (v1.0: connectorRef/auth/verify/ingress) |
| `oauth-app.ts` | 6.7 OAuthApp |
| `resource-type.ts` | 6.8 ResourceType |
| `extension-handler.ts` | 6.9 ExtensionHandler |

## 공통 패턴

각 파일은 다음 패턴을 따릅니다:

```typescript
// 1. Spec 인터페이스 정의
export interface FooSpec {
  // ...
}

// 2. 관련 서브 타입 정의
export interface FooSubType {
  // ...
}

// 3. Resource 타입 별칭
export type FooResource = Resource<FooSpec>;
```

## v0.10 변경사항

### model.ts
- `ModelCapabilities` 인터페이스 추가 (streaming, toolCalling, 확장 가능한 boolean 플래그)
- `ModelSpec.capabilities?` 필드 추가 (인라인 → 별도 인터페이스)

### swarm.ts
- `SwarmLifecyclePolicy` 인터페이스 추가 (autoPauseIdleSeconds, ttlSeconds, gcGraceSeconds)
- `SwarmPolicy.queueMode?: 'serial'` 추가
- `SwarmPolicy.lifecycle?: SwarmLifecyclePolicy` 추가 (인라인 → 별도 인터페이스)
- `SwarmPolicy.retry?` / `SwarmPolicy.timeout?` 추가

### object-ref.ts (types/ 상위)
- `ObjectRef.package?: string` 추가 (Bundle Package 간 참조)

## v1.0 변경사항 (Connector/Connection)

- `connector.ts`: `type` 필드 삭제, `runtime/entry/triggers(TriggerDeclaration)/events(EventSchema)` 추가
- `connection.ts`: `rules/egress` 삭제, `verify(ConnectionVerify)/ingress(IngressConfig)` 추가
  - IngressMatch: `command/eventType/channel` -> `event/properties`
  - IngressRoute: `instanceKeyFrom/inputFrom/agentName` -> `agentRef`
  - `swarmRef?: ObjectRefLike` 필드를 ConnectionSpec 최상위로 복원 (Connection이 바인딩할 Swarm 명시, 선택 필드)
  - ConnectorAuth, IngressRule 등이 connection.ts로 이동

## Tool 타입 변경 (v0.0.2)

### tool/types.ts
- `ToolContext.delegate?` 메서드 제거
- `ToolContext.agents: ToolAgentsApi` 필드 추가 (필수)
- `ToolAgentsApi` 인터페이스: `delegate(agentName, task, context?)`, `listInstances()`
- `AgentDelegateResult` 인터페이스: `{ success, agentName, instanceId, response?, error? }`
- `AgentInstanceInfo` 인터페이스: `{ instanceId, agentName, status }`

## 의존성

- `../resource.ts`: Resource, ResourceMetadata
- `../object-ref.ts`: ObjectRef, ObjectRefLike
- `../selector.ts`: RefOrSelector
- `../value-source.ts`: ValueSource
- `../json-schema.ts`: JsonSchema

## 테스트

테스트 파일 위치: `__tests__/types/specs/`
