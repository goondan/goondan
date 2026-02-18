# Goondan 공통 타입 스펙 (v0.0.3)

`docs/specs` 전반에서 반복되는 타입 정의의 단일 기준(SSOT)을 정의한다.
다른 스펙 문서(`api`, `runtime`, `pipeline`, `tool`, `connection`, `resources`)는 이 문서를 우선 참조해야 하며, 동일 타입의 재정의를 지양한다.

---

## 1. 공통 JSON 타입

```typescript
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
```

---

## 2. 리소스 참조 타입

```typescript
/**
 * ObjectRef 문자열 축약 또는 객체형
 * - 문자열: "Kind/name"
 * - 객체형: { kind, name, package?, apiVersion? }
 */
type ObjectRefLike = string | ObjectRef;

interface ObjectRef {
  kind: string;
  name: string;
  package?: string;
  apiVersion?: string;
}

/** ref 래퍼 형태 (YAML에서 권장) */
interface RefItem {
  ref: ObjectRefLike;
}
```

---

## 3. ValueSource / SecretRef

```typescript
type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: ValueFrom };

type ValueFrom =
  | { env: string; secretRef?: never }
  | { env?: never; secretRef: SecretRef };

interface SecretRef {
  ref: string; // "Secret/<name>"
  key: string;
}
```

---

## 4. 메시지 이벤트 소싱 타입

```typescript
import type { CoreMessage } from 'ai';

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };

interface Message {
  readonly id: string;
  readonly data: CoreMessage;
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: MessageSource;
}

type MessageEvent =
  | { type: 'append'; message: Message }
  | { type: 'replace'; targetId: string; message: Message }
  | { type: 'remove'; targetId: string }
  | { type: 'truncate' };

interface ConversationState {
  readonly baseMessages: Message[];
  readonly events: MessageEvent[];
  readonly nextMessages: Message[];
  toLlmMessages(): CoreMessage[];
}
```

---

## 5. 통합 이벤트 / IPC 타입

```typescript
interface EventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly traceId?: string;
  readonly metadata?: JsonObject;
}

interface EventSource {
  readonly kind: 'agent' | 'connector';
  readonly name: string;
  readonly [key: string]: JsonValue | undefined;
}

interface ReplyChannel {
  readonly target: string;
  readonly correlationId: string;
}

interface TurnAuth {
  readonly principal?: {
    type: string;
    id: string;
    [key: string]: JsonValue | undefined;
  };
  readonly [key: string]: JsonValue | undefined;
}

interface AgentEvent extends EventEnvelope {
  readonly input?: string;
  readonly instanceKey?: string;
  readonly source: EventSource;
  readonly auth?: TurnAuth;
  readonly replyTo?: ReplyChannel;
}

type ProcessStatus =
  | 'spawning'
  | 'idle'
  | 'processing'
  | 'draining'
  | 'terminated'
  | 'crashed'
  | 'crashLoopBackOff';

interface IpcMessage {
  type: 'event' | 'shutdown' | 'shutdown_ack';
  from: string;
  to: string;
  payload: JsonValue;
}

type ShutdownReason = 'restart' | 'config_change' | 'orchestrator_shutdown';
```

---

## 6. Tool 실행 타입

```typescript
interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: JsonObject;
}

interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: JsonValue;
  readonly status: 'ok' | 'error';
  readonly error?: {
    name?: string;
    message: string;
    code?: string;
    suggestion?: string;
    helpUrl?: string;
  };
}

interface AgentRuntimeRequestOptions {
  timeoutMs?: number;
}

interface AgentRuntimeRequestResult {
  eventId: string;
  target: string;
  response?: JsonValue;
  correlationId: string;
}

interface AgentRuntimeSendResult {
  eventId: string;
  target: string;
  accepted: boolean;
}

interface AgentRuntimeSpawnOptions {
  instanceKey?: string;
  cwd?: string;
}

interface AgentRuntimeSpawnResult {
  target: string;
  instanceKey: string;
  spawned: boolean;
  cwd?: string;
}

interface AgentRuntimeListOptions {
  includeAll?: boolean;
}

interface SpawnedAgentInfo {
  target: string;
  instanceKey: string;
  ownerAgent: string;
  ownerInstanceKey: string;
  createdAt: string;
  cwd?: string;
}

interface AgentRuntimeListResult {
  agents: SpawnedAgentInfo[];
}

interface AgentRuntimeCatalogResult {
  swarmName: string;
  entryAgent: string;
  selfAgent: string;
  availableAgents: string[];
  callableAgents: string[];
}

interface AgentToolRuntime {
  request(
    target: string,
    event: AgentEvent,
    options?: AgentRuntimeRequestOptions
  ): Promise<AgentRuntimeRequestResult>;
  send(target: string, event: AgentEvent): Promise<AgentRuntimeSendResult>;
  spawn(target: string, options?: AgentRuntimeSpawnOptions): Promise<AgentRuntimeSpawnResult>;
  list(options?: AgentRuntimeListOptions): Promise<AgentRuntimeListResult>;
  catalog(): Promise<AgentRuntimeCatalogResult>;
}

interface ToolContext extends ExecutionContext {
  readonly toolCallId: string;
  readonly message: Message;
  readonly workdir: string;
  readonly logger: Console;
  readonly runtime?: AgentToolRuntime;
}
```

---

## 7. Turn 결과 타입

```typescript
interface TurnResult {
  readonly turnId: string;
  readonly responseMessage?: Message;
  readonly finishReason: 'text_response' | 'max_steps' | 'error';
  readonly error?: {
    message: string;
    code?: string;
  };
}
```

---

## 8. 규범 규칙

1. `docs/specs` 내 공통 타입은 이 문서를 기준으로 유지해야 한다(MUST).
2. 개별 스펙 문서는 공통 타입을 재정의하기보다 링크/참조를 우선해야 한다(SHOULD).
3. 불가피하게 재기재할 경우, 타입 구조와 필드명을 이 문서와 동일하게 유지해야 한다(MUST).
4. `ConversationState` 계약은 `NextMessages = BaseMessages + SUM(Events)`를 따라야 한다(MUST).
5. `IpcMessage`는 `event`/`shutdown`/`shutdown_ack` 3종만 허용한다(MUST).
6. `ToolContext`에는 `workdir`를 포함해야 한다(MUST).

---

## 관련 문서

- `docs/specs/runtime.md`
- `docs/specs/api.md`
- `docs/specs/pipeline.md`
- `docs/specs/resources.md`
- `docs/specs/tool.md`
- `docs/specs/connection.md`
