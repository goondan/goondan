# Goondan v2 — Simplified Spec

> "Kubernetes for Agent Swarm" — 최소 핵심만 남긴 재설계

---

## 1. 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Bun-native** | 스크립트 런타임은 Bun만 지원. Node.js 호환 레이어 불필요 |
| **Process-per-Agent** | 각 AgentInstance는 독립 Bun 프로세스로 실행. 크래시 격리, 독립 스케일링 |
| **Edit & Restart** | Changeset/SwarmBundleRef 제거. `goondan.yaml` 수정 후 인스턴스 재시작으로 반영 |
| **MessageEnvelope** | AI SDK 메시지를 감싸는 단일 래퍼. 메타데이터로 확장 식별/조작 |
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
| **Extension** | 라이프사이클 훅/파이프라인 인터셉터 | `runtime` 필드 제거 |
| **Connector** | 외부 프로토콜 수신 (HTTP, cron, CLI) | `runtime` 필드 제거 |
| **Connection** | Connector ↔ Swarm 바인딩 | 유지 |
| **Package** | 프로젝트 매니페스트/배포 단위 | 유지 |

**제거된 Kind:**
- `OAuthApp` → Extension 내부 구현으로 이동 (필요시 Extension이 직접 관리)
- `ResourceType` → 제거 (커스텀 Kind 불필요)
- `ExtensionHandler` → 제거

### 2.1 공통 리소스 형식

```yaml
apiVersion: goondan.io/v2
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
toolRef: "Tool/bash-exec"

# 객체 형식
toolRef:
  kind: Tool
  name: bash-exec
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
SwarmSupervisor (메인 프로세스)
  ├── AgentProcess-A  (별도 Bun 프로세스)
  │   └── Turn → Step → Step → ...
  ├── AgentProcess-B  (별도 Bun 프로세스)
  │   └── Turn → Step → ...
  └── ConnectorProcess (별도 Bun 프로세스, 선택)
```

### 3.2 SwarmSupervisor (메인 프로세스)

SwarmSupervisor는 `gdn run` 시 뜨는 **단일 메인 프로세스**:

- `goondan.yaml` 파싱 및 리소스 로딩
- AgentProcess 스폰/감시/재시작
- Connector 프로세스 관리
- 인스턴스 라우팅 (`instanceKey` → AgentProcess 매핑)
- IPC 메시지 브로커 (에이전트 간 delegate/handoff)

```typescript
interface SwarmSupervisor {
  readonly swarmName: string;
  readonly bundleDir: string;
  readonly agents: Map<string, AgentProcessHandle>;

  spawn(agentName: string, instanceKey: string): AgentProcessHandle;
  restart(agentName: string): void;      // kill → re-spawn
  restartAll(): void;                     // goondan.yaml 변경 시
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
- Supervisor와 IPC (Bun의 `process.send`/`process.on("message")` 또는 Unix socket)
- 독립적 Turn/Step 루프 실행
- Extension/Tool 코드를 자체 프로세스에서 로딩

```typescript
interface AgentProcess {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly pid: number;

  // Turn 실행
  processTurn(event: AgentEvent): Promise<TurnResult>;

  // 상태
  readonly status: 'idle' | 'processing' | 'terminated';
  readonly conversationHistory: MessageEnvelope[];
}
```

### 3.4 IPC (Inter-Process Communication)

에이전트 간 통신은 Supervisor를 통한 메시지 패싱:

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
1. AgentA → Supervisor: `{ type: 'delegate', to: 'AgentB', payload: {...} }`
2. Supervisor → AgentB 프로세스로 라우팅
3. AgentB 처리 후 → Supervisor: `{ type: 'delegate_result', to: 'AgentA', ... }`
4. Supervisor → AgentA로 결과 전달

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
  readonly envelopes: MessageEnvelope[];   // 이 Turn의 메시지들
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

## 4. MessageEnvelope

### 4.1 핵심 타입

모든 LLM 메시지는 AI SDK의 메시지 형식(`CoreMessage`)을 사용하되, `MessageEnvelope`로 감싸서 관리:

```typescript
import type { CoreMessage } from 'ai';  // ai-sdk

/**
 * AI SDK 메시지를 감싸는 관리 래퍼.
 * Extension 훅에서 메시지 식별/조작에 사용.
 */
interface MessageEnvelope {
  /** 고유 ID */
  readonly id: string;

  /** AI SDK CoreMessage (system | user | assistant | tool) */
  readonly message: CoreMessage;

  /**
   * Extension/훅이 읽고 쓸 수 있는 메타데이터.
   * 메시지 식별, 필터링, 조작 판단에 활용.
   */
  metadata: Record<string, JsonValue>;

  /** 메시지 생성 시각 */
  readonly createdAt: Date;

  /** 이 메시지를 생성한 주체 */
  readonly source: EnvelopeSource;

  /** Turn 내 순서 번호 */
  readonly seq: number;
}

type EnvelopeSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };
```

### 4.2 메시지 상태 모델 (단순화)

기존의 `BaseMessages + SUM(Events)` 이벤트 소싱 모델을 **단순 배열**로 교체:

```typescript
interface ConversationState {
  /** 전체 대화 히스토리 (MessageEnvelope 배열) */
  envelopes: MessageEnvelope[];

  /** LLM에 보낼 메시지만 추출 (envelope.message 배열) */
  toLlmMessages(): CoreMessage[];
}
```

**영속화:**
- 단일 파일: `messages.jsonl` (MessageEnvelope를 줄 단위로 저장)
- Turn 종료 시 전체 rewrite (또는 append-only + compaction)

### 4.3 Extension 훅에서의 활용

Extension은 파이프라인 훅에서 `MessageEnvelope[]`를 받아 metadata를 기반으로 조작:

```typescript
// 예: compaction extension이 오래된 메시지를 요약으로 대체
api.pipeline.register('turn.pre', async (ctx) => {
  const envelopes = ctx.envelopes;

  // metadata로 "요약 가능" 메시지 식별
  const compactable = envelopes.filter(
    e => e.metadata['compaction.eligible'] === true
  );

  if (compactable.length > 20) {
    // 요약 생성 후 대체
    const summary = await summarize(compactable);
    ctx.envelopes = [
      createSystemEnvelope(summary),
      ...envelopes.filter(e => !e.metadata['compaction.eligible'])
    ];
  }

  return ctx;
});
```

```typescript
// 예: 특정 Extension이 자기가 추가한 메시지만 찾기
const myMessages = envelopes.filter(
  e => e.source.type === 'extension' && e.source.extensionName === 'my-ext'
);
```

---

## 5. 파이프라인 (Extension Hooks)

기존 13개 파이프라인 포인트를 **7개**로 축소:

### 5.1 파이프라인 포인트

| 포인트 | 타입 | 설명 |
|--------|------|------|
| `turn.pre` | Mutator | Turn 시작 전. 메시지 히스토리 조작 가능 |
| `turn.post` | Mutator | Turn 종료 후. 결과 후처리 |
| `step.pre` | Mutator | Step(LLM 호출) 전. 도구/컨텍스트 조작 |
| `step.llmCall` | Middleware | LLM 호출 래핑 (로깅, 재시도, 캐싱) |
| `step.post` | Mutator | Step 완료 후 |
| `toolCall.pre` | Mutator | 도구 실행 전. 입력 검증/변환 |
| `toolCall.post` | Mutator | 도구 실행 후. 결과 변환 |

**제거된 포인트:**
- `step.config` → 설정 변경은 재시작으로 처리
- `step.tools` → `step.pre`에 통합
- `step.blocks` → `step.pre`에 통합
- `step.llmInput` → `step.pre`에 통합
- `step.llmError` → `step.llmCall` 미들웨어 내부 catch로 처리
- `toolCall.exec` → `toolCall.pre`/`toolCall.post`로 충분

### 5.2 파이프라인 컨텍스트

```typescript
interface TurnPipelineContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly inputEvent: AgentEvent;
  envelopes: MessageEnvelope[];        // 조작 가능
  metadata: Record<string, JsonValue>; // Turn 메타데이터
}

interface StepPipelineContext {
  readonly turn: Turn;
  readonly stepIndex: number;
  envelopes: MessageEnvelope[];        // LLM에 보낼 메시지
  toolCatalog: ToolCatalogItem[];      // 노출할 도구 목록
  metadata: Record<string, JsonValue>;
}

interface ToolCallPipelineContext {
  readonly toolName: string;
  readonly toolCallId: string;
  args: JsonObject;                     // 조작 가능
  result?: JsonValue;                   // post에서만 존재
  metadata: Record<string, JsonValue>;
}
```

### 5.3 Extension 등록

```typescript
// extension entry point
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn.pre', async (ctx) => {
    // MessageEnvelope 조작
    return ctx;
  });

  api.pipeline.register('step.llmCall', async (ctx, next) => {
    const start = Date.now();
    const result = await next(ctx);
    console.log(`LLM call took ${Date.now() - start}ms`);
    return result;
  });
}
```

### 5.4 ExtensionApi (축소)

```typescript
interface ExtensionApi {
  /** 파이프라인 훅 등록 */
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

```yaml
kind: Tool
metadata:
  name: bash-exec
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"      # Bun으로 실행
  exports:
    - name: bash.exec
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
```

`runtime` 필드 제거 — 항상 Bun.

### 6.2 Tool Handler

```typescript
export const handlers: Record<string, ToolHandler> = {
  'bash.exec': async (ctx, input) => {
    const { command } = input as { command: string };
    const proc = Bun.spawn(['sh', '-c', command]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  }
};

interface ToolHandler {
  (ctx: ToolContext, input: JsonObject): Promise<JsonValue>;
}

interface ToolContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly envelope: MessageEnvelope;  // 이 도구 호출을 트리거한 메시지
  readonly logger: Console;
}
```

### 6.3 AI SDK 도구 이름 변환

AI SDK는 도구 이름에 점(`.`)을 허용하지 않으므로, 자동 변환:

```
goondan 이름:  bash.exec       →  AI SDK 이름:  bash_exec
goondan 이름:  file.read       →  AI SDK 이름:  file_read
```

역매핑을 통해 LLM 응답의 도구 호출을 원래 이름으로 복원.

---

## 7. Connector / Connection

### 7.1 Connector 리소스

```yaml
kind: Connector
metadata:
  name: telegram
spec:
  entry: "./connectors/telegram/index.ts"
  triggers:
    - type: http
      endpoint: { path: /webhook, method: POST }
  events:
    - name: user_message
      properties:
        chat_id: { type: string }
```

### 7.2 Connector 핸들러

```typescript
export default async function (ctx: ConnectorContext): Promise<void> {
  const { trigger, emit, secrets, logger } = ctx;

  // 외부 페이로드 → ConnectorEvent 정규화
  await emit({
    name: 'user_message',
    message: { type: 'text', text: trigger.body.message.text },
    properties: { chat_id: String(trigger.body.message.chat.id) },
    instanceKey: `telegram:${trigger.body.message.chat.id}`,
  });
};
```

### 7.3 Connection 리소스

```yaml
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
2. gdn restart [--agent <name>]   # 특정 에이전트만 또는 전체
3. Supervisor가 프로세스 kill → 새 설정으로 re-spawn
```

**동작 방식:**
- Supervisor는 파일 시스템 감시(watch) 없음 (명시적 restart만)
- 재시작 시 conversation history 유지 여부는 옵션:
  - `--fresh`: 대화 히스토리 초기화
  - 기본: 기존 `messages.jsonl` 유지, 새 설정으로 계속

```typescript
// CLI
interface RestartOptions {
  agent?: string;     // 특정 에이전트만 재시작. 생략 시 전체
  fresh?: boolean;    // 대화 히스토리 초기화
}
```

### 8.3 Hot Reload (선택적 확장)

향후 `--watch` 모드로 파일 변경 감지 + 자동 재시작 지원 가능:

```bash
gdn run --watch   # goondan.yaml 변경 시 자동 restart
```

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
apiVersion: goondan.io/v2
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
apiVersion: goondan.io/v2
kind: Agent
metadata:
  name: coder
spec:
  modelRef: "Model/claude"
  systemPrompt: |
    You are a coding assistant.
  tools:
    - ref: "Tool/bash-exec"
    - ref: "Tool/file-read"
---
apiVersion: goondan.io/v2
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
                ├── messages.jsonl       # MessageEnvelope 히스토리
                └── extensions/
                    └── <ext-name>.json  # Extension 상태
```

- **SwarmBundleRoot** = 사용자 프로젝트 디렉토리 (그대로)
- **System/Instance State** = `~/.goondan/` 아래 통합

### 10.2 메시지 영속화

```jsonl
{"id":"m1","message":{"role":"user","content":"Hello"},"metadata":{},"createdAt":"...","source":{"type":"user"},"seq":0}
{"id":"m2","message":{"role":"assistant","content":"Hi!"},"metadata":{},"createdAt":"...","source":{"type":"assistant","stepId":"s1"},"seq":1}
```

---

## 11. CLI 명령어 (축소)

```
gdn init [path]                  # 프로젝트 초기화
gdn run [--watch]                # Swarm 실행
gdn restart [--agent <name>] [--fresh]  # 에이전트 재시작

gdn instance list                # 인스턴스 목록
gdn instance delete <key>        # 인스턴스 삭제

gdn package add <ref>            # 의존성 추가
gdn package install              # 의존성 설치
gdn package publish              # 레지스트리 배포

gdn validate                     # 번들 검증
gdn doctor                       # 환경 진단
```

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
| **에이전트 간 통신** | 인-메모리 호출 | IPC (Supervisor 경유) |
| **설정 변경** | SwarmBundleRef + Changeset + Safe Point | **Edit & Restart** |
| **메시지 타입** | 커스텀 `LlmMessage` + 이벤트 소싱 | **MessageEnvelope** (AI SDK `CoreMessage` 래핑) |
| **메시지 상태** | `BaseMessages + SUM(Events)` 모델 | 단순 배열 (`MessageEnvelope[]`) |
| **파이프라인 포인트** | 13개 | **7개** |
| **리소스 Kind** | 11종 | **8종** |
| **OAuth** | 1급 리소스 (OAuthApp Kind) | Extension 내부 구현 |
| **Workspace** | 3-root 분리 | **2-root** (프로젝트 + 시스템) |
| **자기 수정** | Changeset API로 코드 수정 | 외부에서 파일 수정 + restart |
| **CLI** | pause/resume/terminate/logs | **restart + stdout** |
| **apiVersion** | `agents.example.io/v1alpha1` | `goondan.io/v2` |

---

## 13. 마이그레이션 경로

### 13.1 YAML 변환

```yaml
# v1
apiVersion: agents.example.io/v1alpha1
kind: Tool
spec:
  runtime: node          # 제거
  entry: "./tools/x.ts"

# v2
apiVersion: goondan.io/v2
kind: Tool
spec:
  entry: "./tools/x.ts"  # Bun으로 실행
```

### 13.2 메시지 타입 변환

```typescript
// v1: 커스텀 메시지
interface LlmUserMessage {
  readonly id: string;
  readonly role: 'user';
  readonly content: string;
  readonly attachments?: MessageAttachment[];
}

// v2: AI SDK 메시지를 감싸는 Envelope
interface MessageEnvelope {
  readonly id: string;
  readonly message: CoreMessage;     // AI SDK 타입 직접 사용
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: EnvelopeSource;
  readonly seq: number;
}
```

### 13.3 Extension 코드 변환

```typescript
// v1: 복잡한 컨텍스트
api.pipeline.register('step.config', async (ctx) => { ... });
api.pipeline.register('step.tools', async (ctx) => { ... });
api.pipeline.register('step.blocks', async (ctx) => { ... });

// v2: step.pre로 통합
api.pipeline.register('step.pre', async (ctx) => {
  // 도구 목록 조작
  ctx.toolCatalog = ctx.toolCatalog.filter(...);
  // 메시지 조작 (컨텍스트 블록 대체)
  ctx.envelopes.push(createSystemEnvelope('추가 지시사항'));
  return ctx;
});
```
