# Goondan v2 — Simplified Spec

> "Kubernetes for Agent Swarm" — 최소 핵심만 남긴 재설계

---

## 1. 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Bun-native** | 스크립트 런타임은 Bun만 지원. Node.js 호환 레이어 불필요 |
| **Process-per-Agent** | 각 AgentInstance는 독립 Bun 프로세스로 실행. 크래시 격리, 독립 스케일링 |
| **Edit & Restart** | Changeset/SwarmBundleRef 제거. `goondan.yaml` 수정 후 Orchestrator가 에이전트 프로세스 재시작 |
| **Message** | AI SDK 메시지를 감싸는 단일 래퍼. 메타데이터로 메시지 식별/조작 |
| **Middleware Pipeline** | 모든 파이프라인 훅은 Middleware 형태. `next()` 호출 전후로 전처리/후처리 |
| **Declarative YAML** | 리소스 정의는 기존과 동일하게 YAML 선언형 유지 |

---

## 2. 리소스 종류 (Kinds)

기존 11종에서 **8종**으로 축소:

| Kind | 역할 | 변경사항 |
|------|------|----------|
| **Model** | LLM 프로바이더 설정 | 유지 |
| **Agent** | 에이전트 정의 (모델, 프롬프트, 도구, 익스텐션) | 유지 |
| **Swarm** | 에이전트 집합 + 실행 정책 | 유지 (단순화) |
| **Tool** | LLM이 호출하는 함수 | `runtime` 필드 제거 (항상 Bun) |
| **Extension** | 라이프사이클 미들웨어 인터셉터 | `runtime` 필드 제거 |
| **Connector** | 외부 프로토콜 수신 (별도 프로세스, 자체 서버/스케줄러) | `runtime` 필드 제거, 프로토콜 자체 관리 |
| **Connection** | Connector ↔ Swarm 바인딩 | 유지 |
| **Package** | 프로젝트 매니페스트/배포 단위 | 유지 |

**제거된 Kind:**
- `OAuthApp` → Extension 내부 구현으로 이동 (필요시 Extension이 직접 관리)
- `ResourceType` → 제거 (커스텀 Kind 불필요)
- `ExtensionHandler` → 제거

### 2.1 공통 리소스 형식

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
  labels: {}
  annotations: {}
spec:
  # Kind별 스키마
```

### 2.2 참조 (ObjectRef)

```yaml
# 문자열 축약
toolRef: "Tool/bash"

# 객체 형식
toolRef:
  kind: Tool
  name: bash
```

### 2.3 Selector + Overrides

```yaml
tools:
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000
```

---

## 3. 실행 모델

### 3.1 계층 구조

```
Orchestrator (상주 프로세스, gdn run으로 기동)
  ├── AgentProcess-A  (별도 Bun 프로세스)
  │   └── Turn → Step → Step → ...
  ├── AgentProcess-B  (별도 Bun 프로세스)
  │   └── Turn → Step → ...
  └── ConnectorProcess-telegram (별도 Bun 프로세스)
      └── 자체 HTTP 서버/cron 스케줄러 등 프로토콜 직접 관리
```

### 3.2 Orchestrator (오케스트레이터 상주 프로세스)

Orchestrator는 `gdn run` 시 뜨는 **상주 프로세스**로, Swarm의 전체 생명주기를 관리:

- `goondan.yaml` 파싱 및 리소스 로딩
- AgentProcess 스폰/감시/재시작
- Connector 프로세스 스폰/감시 (프로토콜 처리는 Connector 자체에서 수행)
- 인스턴스 라우팅 (`instanceKey` → AgentProcess 매핑)
- IPC 메시지 브로커 (에이전트 간 delegate/handoff)
- **설정 변경 감지 및 에이전트 프로세스 재시작** (자체 판단 또는 명령 수신)

Orchestrator는 에이전트가 모두 종료되어도 살아 있으며, 새로운 이벤트(Connector 수신, CLI 입력 등)가 오면 필요한 AgentProcess를 다시 스폰한다.

```typescript
interface Orchestrator {
  readonly swarmName: string;
  readonly bundleDir: string;
  readonly agents: Map<string, AgentProcessHandle>;

  /** 에이전트 프로세스 스폰 */
  spawn(agentName: string, instanceKey: string): AgentProcessHandle;

  /** 특정 에이전트 프로세스 kill → 새 설정으로 re-spawn */
  restart(agentName: string): void;

  /** goondan.yaml 재로딩 후 모든 에이전트 프로세스 재시작 */
  reloadAndRestartAll(): void;

  /** 오케스트레이터 종료 (모든 자식 프로세스도 종료) */
  shutdown(): void;

  // IPC
  route(message: IpcMessage): void;
}
```

### 3.3 AgentProcess (에이전트 프로세스)

각 AgentInstance는 **독립 Bun 프로세스**로 실행:

```bash
bun run agent-runner.ts \
  --bundle-dir ./my-swarm \
  --agent-name coder \
  --instance-key "user:123"
```

**프로세스 특성:**
- 자체 메모리 공간 (크래시 격리)
- Orchestrator와 IPC (Bun의 `process.send`/`process.on("message")` 또는 Unix socket)
- 독립적 Turn/Step 루프 실행
- Extension/Tool 코드를 자체 프로세스에서 로딩
- 크래시 시 Orchestrator가 감지하고 자동 재스폰 가능

```typescript
interface AgentProcess {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly pid: number;

  // Turn 실행
  processTurn(event: AgentEvent): Promise<TurnResult>;

  // 상태
  readonly status: 'idle' | 'processing' | 'terminated';
  readonly conversationHistory: Message[];
}
```

### 3.4 IPC (Inter-Process Communication)

에이전트 간 통신은 Orchestrator를 통한 메시지 패싱:

```typescript
interface IpcMessage {
  type: 'delegate' | 'delegate_result' | 'event' | 'shutdown';
  from: string;          // agentName
  to: string;            // agentName
  payload: JsonValue;
  correlationId?: string;
}
```

**위임 (Delegate) 흐름:**
1. AgentA → Orchestrator: `{ type: 'delegate', to: 'AgentB', payload: {...} }`
2. Orchestrator → AgentB 프로세스로 라우팅 (필요시 스폰)
3. AgentB 처리 후 → Orchestrator: `{ type: 'delegate_result', to: 'AgentA', ... }`
4. Orchestrator → AgentA로 결과 전달

### 3.5 Turn / Step

기존과 동일한 개념이나, **단일 AgentProcess 내에서** 실행:

**Turn** = 하나의 입력 이벤트 처리 단위
- 입력: `AgentEvent` (사용자 메시지, delegate, etc.)
- 출력: `TurnResult` (응답 메시지, 상태 변화)
- 복수 Step을 포함

**Step** = 단일 LLM 호출
- 도구 호출이 있으면 다음 Step 실행
- 텍스트 응답만 있으면 Turn 종료

```typescript
interface Turn {
  readonly id: string;
  readonly agentName: string;
  readonly inputEvent: AgentEvent;
  readonly messages: Message[];        // 이 Turn의 메시지들
  readonly steps: Step[];
  status: 'running' | 'completed' | 'failed';
  metadata: Record<string, JsonValue>;
}

interface Step {
  readonly id: string;
  readonly index: number;
  readonly toolCatalog: ToolCatalogItem[];
  readonly toolCalls: ToolCall[];
  readonly toolResults: ToolResult[];
  status: 'llm_call' | 'tool_exec' | 'completed';
}
```

---

## 4. Message

### 4.1 핵심 타입

모든 LLM 메시지는 AI SDK의 메시지 형식(`CoreMessage`)을 사용하되, `Message`로 감싸서 관리:

```typescript
import type { CoreMessage } from 'ai';  // ai-sdk

/**
 * AI SDK 메시지를 감싸는 관리 래퍼.
 * Extension 미들웨어에서 메시지 식별/조작에 사용.
 */
interface Message {
  /** 고유 ID */
  readonly id: string;

  /** AI SDK CoreMessage (system | user | assistant | tool) */
  readonly data: CoreMessage;

  /**
   * Extension/미들웨어가 읽고 쓸 수 있는 메타데이터.
   * 메시지 식별, 필터링, 조작 판단에 활용.
   */
  metadata: Record<string, JsonValue>;

  /** 메시지 생성 시각 */
  readonly createdAt: Date;

  /** 이 메시지를 생성한 주체 */
  readonly source: MessageSource;
}

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };
```

### 4.2 메시지 상태 모델 (이벤트 소싱 유지)

기존의 `BaseMessages + SUM(Events)` 이벤트 소싱 모델을 **Message 기반**으로 유지:

```
NextMessages = BaseMessages + SUM(Events)
```

```typescript
/**
 * Message에 대한 이벤트 소싱 이벤트.
 * Extension 미들웨어에서 메시지 추가/교체/삭제를 이벤트로 기록.
 */
type MessageEvent =
  | { type: 'append';   message: Message }
  | { type: 'replace';  targetId: string; message: Message }
  | { type: 'remove';   targetId: string }
  | { type: 'truncate' };

interface ConversationState {
  /** Turn 시작 시점의 확정된 메시지들 */
  readonly baseMessages: Message[];

  /** Turn 진행 중 누적된 이벤트 */
  readonly events: MessageEvent[];

  /** 계산된 현재 메시지 상태: base + events 적용 결과 */
  readonly nextMessages: Message[];

  /** LLM에 보낼 메시지만 추출 (message.data 배열) */
  toLlmMessages(): CoreMessage[];
}
```

**영속화:**
- `messages/base.jsonl` — Turn 종료 시 확정된 Message 목록
- `messages/events.jsonl` — Turn 진행 중 누적된 MessageEvent 로그
- Turn 종료 후: events → base로 폴딩, events 클리어

**이벤트 소싱의 이점:**
- 복구: base + events 재생으로 정확한 상태 복원
- 관찰: 모든 메시지 변경이 이벤트로 추적됨
- Extension 조작: 미들웨어에서 이벤트를 발행하여 메시지 조작 (직접 배열 변경 대신)
- Compaction: 주기적으로 events → base 폴딩으로 정리

### 4.3 Middleware에서의 활용

Extension은 미들웨어에서 `ConversationState`를 받아 metadata 기반으로 이벤트를 발행하여 조작:

```typescript
// 예: compaction extension이 turn 시작 전 오래된 메시지를 요약으로 대체
api.pipeline.register('turn', async (ctx) => {
  const { nextMessages } = ctx.conversationState;

  // metadata로 "요약 가능" 메시지 식별
  const compactable = nextMessages.filter(
    m => m.metadata['compaction.eligible'] === true
  );

  if (compactable.length > 20) {
    const summary = await summarize(compactable);

    // 이벤트 발행으로 메시지 조작 (next() 호출 전 = turn.pre)
    for (const m of compactable) {
      ctx.emitMessageEvent({ type: 'remove', targetId: m.id });
    }
    ctx.emitMessageEvent({
      type: 'append',
      message: createSystemMessage(summary, { 'compaction.summary': true }),
    });
  }

  // Turn 실행
  const result = await ctx.next();

  // next() 호출 후 = turn.post: 결과 후처리
  return result;
});
```

```typescript
// 예: 특정 Extension이 자기가 추가한 메시지만 찾기
const myMessages = nextMessages.filter(
  m => m.source.type === 'extension' && m.source.extensionName === 'my-ext'
);
```

---

## 5. 파이프라인 (Middleware)

모든 파이프라인 훅은 **Middleware** 형태로 통일. `next()` 호출 전후로 전처리(pre)/후처리(post)를 수행:

### 5.1 미들웨어 종류

| 미들웨어 | 설명 |
|----------|------|
| `turn` | Turn 전체를 감싸는 미들웨어. `next()` 전: 메시지 히스토리 조작. `next()` 후: 결과 후처리 |
| `step` | Step(LLM 호출 + 도구 실행)을 감싸는 미들웨어. `next()` 전: 도구/컨텍스트 조작. `next()` 후: 결과 변환, 로깅, 재시도 |
| `toolCall` | 개별 도구 호출을 감싸는 미들웨어. `next()` 전: 입력 검증/변환. `next()` 후: 결과 변환 |

**기존 대비 제거/통합된 포인트:**
- `turn.pre` / `turn.post` → `turn` 미들웨어로 통합
- `step.pre` / `step.post` / `step.llmCall` → `step` 미들웨어로 통합
- `toolCall.pre` / `toolCall.post` → `toolCall` 미들웨어로 통합
- `step.config`, `step.tools`, `step.blocks`, `step.llmInput`, `step.llmError` → `step` 미들웨어 내부에서 처리

### 5.2 미들웨어 컨텍스트

```typescript
interface TurnMiddlewareContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly inputEvent: AgentEvent;
  readonly conversationState: ConversationState;
  emitMessageEvent(event: MessageEvent): void;
  metadata: Record<string, JsonValue>;
  next(): Promise<TurnResult>;
}

interface StepMiddlewareContext {
  readonly turn: Turn;
  readonly stepIndex: number;
  readonly conversationState: ConversationState;
  emitMessageEvent(event: MessageEvent): void;
  toolCatalog: ToolCatalogItem[];
  metadata: Record<string, JsonValue>;
  next(): Promise<StepResult>;
}

interface ToolCallMiddlewareContext {
  readonly toolName: string;
  readonly toolCallId: string;
  args: JsonObject;
  metadata: Record<string, JsonValue>;
  next(): Promise<ToolCallResult>;
}
```

### 5.3 Extension 등록

```typescript
// extension entry point
export function register(api: ExtensionApi): void {
  // Turn 미들웨어
  api.pipeline.register('turn', async (ctx) => {
    // next() 전 = turn.pre: 메시지 히스토리 조작
    const result = await ctx.next();
    // next() 후 = turn.post: 결과 후처리
    return result;
  });

  // Step 미들웨어 (기존 step.pre + step.llmCall + step.post 통합)
  api.pipeline.register('step', async (ctx) => {
    // next() 전 = step.pre: 도구 목록 조작 등
    ctx.toolCatalog = ctx.toolCatalog.filter(t => !t.disabled);

    const start = Date.now();
    const result = await ctx.next();
    console.log(`Step took ${Date.now() - start}ms`);

    // next() 후 = step.post: 결과 검사/변환
    return result;
  });

  // ToolCall 미들웨어
  api.pipeline.register('toolCall', async (ctx) => {
    console.log(`Calling ${ctx.toolName} with`, ctx.args);
    const result = await ctx.next();
    console.log(`${ctx.toolName} returned`, result);
    return result;
  });
}
```

### 5.4 ExtensionApi (축소)

```typescript
interface ExtensionApi {
  /** 미들웨어 등록 */
  pipeline: PipelineRegistry;

  /** 동적 도구 등록 */
  tools: {
    register(item: ToolCatalogItem, handler: ToolHandler): void;
  };

  /** Extension별 상태 (JSON, 영속화) */
  state: {
    get(): Promise<JsonValue>;
    set(value: JsonValue): Promise<void>;
  };

  /** 이벤트 버스 (프로세스 내) */
  events: {
    on(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };

  /** 로거 */
  logger: Console;
}
```

---

## 6. Tool 시스템

### 6.1 Tool 리소스

도구 이름은 `{Tool 리소스 이름}__{하위 도구 이름}` 형식으로 LLM에 노출 (예: `bash__exec`):

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"      # Bun으로 실행
  exports:
    - name: exec                       # LLM에는 "bash__exec"로 노출
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
    - name: script                     # LLM에는 "bash__script"로 노출
      description: "스크립트 파일 실행"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
```

`runtime` 필드 제거 — 항상 Bun.

### 6.2 Tool Handler

```typescript
export const handlers: Record<string, ToolHandler> = {
  'exec': async (ctx, input) => {
    const proc = Bun.spawn(['sh', '-c', input.command]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
  'script': async (ctx, input) => {
    const proc = Bun.spawn(['sh', input.path]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
};

interface ToolHandler {
  (ctx: ToolContext, input: JsonObject): Promise<JsonValue>;
}

interface ToolContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly message: Message;     // 이 도구 호출을 트리거한 메시지
  readonly logger: Console;
}
```

### 6.3 도구 이름 규칙

LLM에 노출되는 도구 이름은 **`{Tool 리소스 이름}__{하위 도구 이름}`** 형식:

```
Tool 리소스: bash          →  exports: exec, script
LLM 도구 이름:  bash__exec,  bash__script

Tool 리소스: file-system   →  exports: read, write
LLM 도구 이름:  file-system__read,  file-system__write
```

`__` (더블 언더스코어)는 AI SDK에서 허용되는 문자이므로 별도 변환 없이 그대로 사용.

---

## 7. Connector / Connection

### 7.1 Connector 리소스

Connector는 **별도 Bun 프로세스**로 실행되며, 프로토콜 수신(HTTP 서버, cron 스케줄러 등)을 **자체적으로** 관리:

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: telegram
spec:
  entry: "./connectors/telegram/index.ts"
  events:
    - name: user_message
      properties:
        chat_id: { type: string }
```

`triggers` 필드 제거 — Connector가 프로토콜 처리를 직접 구현.

### 7.2 Connector 핸들러

```typescript
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  // Connector가 직접 HTTP 서버를 열어 웹훅 수신
  Bun.serve({
    port: Number(secrets.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      // 외부 페이로드 → ConnectorEvent 정규화 후 Orchestrator로 전달
      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.message.text },
        properties: { chat_id: String(body.message.chat.id) },
        instanceKey: `telegram:${body.message.chat.id}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Telegram connector listening on port', Number(secrets.PORT) || 3000);
};
```

### 7.3 Connection 리소스

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  secrets:
    botToken:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
```

---

## 8. 설정 변경 및 재시작 (Changeset 대체)

### 8.1 기존 Changeset 시스템 제거

제거 항목:
- `SwarmBundleRef` (불변 스냅샷 식별자)
- `ChangesetPolicy` (허용 파일, 권한)
- Safe Point (`turn.start`, `step.config`)
- 충돌 감지, 원자적 커밋
- 자기 수정(self-evolving) 에이전트 패턴

### 8.2 새로운 모델: Edit & Restart

```
1. goondan.yaml (또는 개별 리소스 파일) 수정
2. Orchestrator가 설정 변경을 감지하거나 명령을 수신
3. Orchestrator가 해당 에이전트 프로세스 kill → 새 설정으로 re-spawn
```

**동작 방식:**
- Orchestrator는 상주 프로세스로서 에이전트 프로세스의 재시작을 직접 관리
- 재시작 트리거:
  - `--watch` 모드: 파일 변경 감지 시 자동 재시작
  - CLI 명령: `gdn restart` → Orchestrator에 신호 전달
  - Orchestrator 자체 판단 (크래시 감지 등)
- 재시작 시 conversation history 유지 여부는 옵션:
  - `--fresh`: 대화 히스토리 초기화
  - 기본: 기존 메시지 히스토리 유지, 새 설정으로 계속

```typescript
interface RestartOptions {
  agent?: string;     // 특정 에이전트만 재시작. 생략 시 전체
  fresh?: boolean;    // 대화 히스토리 초기화
}
```

### 8.3 Watch 모드

Orchestrator가 `--watch` 플래그로 기동되면 파일 변경을 감시하고 자동 재시작:

```bash
gdn run --watch   # goondan.yaml/리소스 파일 변경 시 해당 에이전트 자동 restart
```

Orchestrator는 어떤 리소스가 변경되었는지 파악하여 영향받는 에이전트 프로세스만 선택적으로 재시작한다.

---

## 9. 프로젝트 구조

### 9.1 최소 프로젝트

```
my-agent/
├── goondan.yaml          # 모든 리소스 정의
└── (tools/, extensions/, connectors/ - 필요시)
```

### 9.2 goondan.yaml 예시

```yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelRef: "Model/claude"
  systemPrompt: |
    You are a coding assistant.
  tools:
    - ref: "Tool/bash"
    - ref: "Tool/file-system"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  agents:
    - ref: "Agent/coder"
  entryAgent: "Agent/coder"
```

---

## 10. Workspace / 상태 저장

### 10.1 디렉토리 구조 (단순화)

기존 3-root 분리를 **2-root**로 축소:

```
~/.goondan/                              # System Root
├── config.json                          # CLI 설정
├── packages/                            # 설치된 패키지
└── workspaces/
    └── <workspaceId>/                   # 프로젝트별
        └── instances/
            └── <instanceKey>/           # 인스턴스별
                ├── metadata.json        # 상태, 생성일시
                ├── messages/
                │   ├── base.jsonl       # 확정된 Message 목록
                │   └── events.jsonl     # Turn 중 누적 MessageEvent 로그
                └── extensions/
                    └── <ext-name>.json  # Extension 상태
```

- **SwarmBundleRoot** = 사용자 프로젝트 디렉토리 (그대로)
- **System/Instance State** = `~/.goondan/` 아래 통합

### 10.2 메시지 영속화

**base.jsonl** (확정된 Message):
```jsonl
{"id":"m1","data":{"role":"user","content":"Hello"},"metadata":{},"createdAt":"...","source":{"type":"user"}}
{"id":"m2","data":{"role":"assistant","content":"Hi!"},"metadata":{},"createdAt":"...","source":{"type":"assistant","stepId":"s1"}}
```

**events.jsonl** (Turn 중 이벤트):
```jsonl
{"type":"append","message":{"id":"m3","data":{"role":"user","content":"Fix the bug"},"metadata":{},"createdAt":"...","source":{"type":"user"}}}
{"type":"append","message":{"id":"m4","data":{"role":"assistant","content":null,"tool_calls":[...]},"metadata":{},"createdAt":"...","source":{"type":"assistant","stepId":"s2"}}}
```

Turn 종료 시: `events.jsonl`의 이벤트를 `base.jsonl`에 폴딩 → `events.jsonl` 클리어

---

## 11. CLI 명령어 (축소)

```
gdn init [path]                  # 프로젝트 초기화
gdn run [--watch]                # Orchestrator 기동 (상주 프로세스)
gdn restart [--agent <name>] [--fresh]  # 실행 중인 Orchestrator에 재시작 신호 전송

gdn instance list                # 인스턴스 목록
gdn instance delete <key>        # 인스턴스 삭제

gdn package add <ref>            # 의존성 추가
gdn package install              # 의존성 설치
gdn package publish              # 레지스트리 배포

gdn validate                     # 번들 검증
gdn doctor                       # 환경 진단
```

- `gdn run`: Orchestrator 상주 프로세스 기동. 에이전트/커넥터 프로세스를 스폰하고 관리
- `gdn restart`: 실행 중인 Orchestrator에 IPC/신호를 보내 에이전트 프로세스 재시작 요청

**제거된 명령어:**
- `gdn instance pause/resume/terminate` → restart로 통합
- `gdn logs` → 각 프로세스의 stdout/stderr로 대체
- `gdn config` → `~/.goondan/config.json` 직접 편집

---

## 12. 기존 대비 변경 요약

| 영역 | v1 (현재) | v2 (신규) |
|------|-----------|-----------|
| **런타임** | Node.js (`runtime: node`) | Bun only (필드 제거) |
| **에이전트 실행** | 단일 프로세스 내 다중 AgentInstance | **프로세스-per-에이전트** |
| **에이전트 간 통신** | 인-메모리 호출 | IPC (Orchestrator 경유) |
| **설정 변경** | SwarmBundleRef + Changeset + Safe Point | **Edit & Restart** (Orchestrator가 관리) |
| **메시지 타입** | 커스텀 `LlmMessage` | **Message** (AI SDK `CoreMessage` 래핑) |
| **메시지 상태** | `BaseMessages + SUM(Events)` | `BaseMessages + SUM(MessageEvents)` (이벤트 소싱 유지) |
| **파이프라인** | 13개 포인트 (Mutator + Middleware) | **3개 미들웨어** (turn / step / toolCall) |
| **리소스 Kind** | 11종 | **8종** |
| **도구 이름** | `bash.exec` (점 구분) | **`bash__exec`** (더블 언더스코어) |
| **Connector** | 시스템이 프로토콜 처리 (http/cron) | **Connector가 자체 프로세스로 프로토콜 직접 관리** |
| **OAuth** | 1급 리소스 (OAuthApp Kind) | Extension 내부 구현 |
| **Workspace** | 3-root 분리 | **2-root** (프로젝트 + 시스템) |
| **자기 수정** | Changeset API로 코드 수정 | 외부에서 파일 수정 + restart |
| **CLI** | pause/resume/terminate/logs | **restart + stdout** |
| **apiVersion** | `agents.example.io/v1alpha1` | **`goondan.ai/v1`** |
