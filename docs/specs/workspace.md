# Goondan Workspace 및 Storage 모델 스펙 (v0.10)

본 문서는 `docs/requirements/10_workspace-model.md`를 기반으로 Goondan Runtime의 **파일시스템 레이아웃과 저장소 모델**을 정의한다.

---

## 1. 개요

Goondan Runtime은 파일시스템을 3개의 분리된 루트로 관리한다.

| 루트 | 역할 | 소유권 |
|------|------|--------|
| **SwarmBundleRoot** | Swarm 정의(YAML + 코드) | 사용자/Git |
| **Instance State Root** | 인스턴스 실행 상태(로그) | Runtime |
| **System State Root** | 전역 상태(OAuth, 캐시) | Runtime |

이 분리는 다음 원칙을 보장한다.

1. **정의/상태 분리**: SwarmBundle 정의는 Git으로 버전 관리되고, 실행 상태는 별도 영역에 저장된다.
2. **인스턴스 독립성**: 각 인스턴스의 상태는 서로 격리된다.
3. **전역 상태 보존**: OAuth 토큰, Bundle Package 캐시 등은 인스턴스 수명과 무관하게 유지된다.

---

## 2. 경로 결정 규칙

### 2.1 goondanHome (System State Root)

`goondanHome`은 Goondan의 전역 상태 루트이다.

**결정 순서** (우선순위 순):

1. CLI 옵션: `--state-root <path>`
2. 환경 변수: `GOONDAN_STATE_ROOT`
3. 기본값: `~/.goondan/`

```typescript
interface GoondanHomeOptions {
  /** CLI에서 전달된 경로 */
  cliStateRoot?: string;
  /** 환경 변수에서 읽은 경로 */
  envStateRoot?: string;
}

function resolveGoondanHome(options: GoondanHomeOptions = {}): string {
  if (options.cliStateRoot) {
    return path.resolve(options.cliStateRoot);
  }
  if (options.envStateRoot || process.env.GOONDAN_STATE_ROOT) {
    return path.resolve(options.envStateRoot || process.env.GOONDAN_STATE_ROOT!);
  }
  return path.join(os.homedir(), '.goondan');
}
```

### 2.2 workspaceId

`workspaceId`는 서로 다른 SwarmBundleRoot(프로젝트) 간 인스턴스 충돌을 방지하는 네임스페이스이다.

**생성 규칙**:

1. SwarmBundleRoot의 **절대 경로**를 정규화한다.
2. 정규화된 경로의 **SHA-256 해시**를 계산한다.
3. 해시의 **처음 12자(hex)**를 workspaceId로 사용한다.

```typescript
import * as crypto from 'crypto';
import * as path from 'path';

function generateWorkspaceId(swarmBundleRoot: string): string {
  const normalized = path.resolve(swarmBundleRoot);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return hash.slice(0, 12);
}

// 예시
// SwarmBundleRoot: /Users/alice/projects/my-agent
// workspaceId: "a1b2c3d4e5f6"
```

**규칙**:

- workspaceId는 **결정론적**이어야 한다(MUST). 동일 경로는 항상 동일 workspaceId를 생성한다.
- workspaceId는 **충돌 가능성이 낮아야** 한다(SHOULD). 12자 hex는 약 48비트 엔트로피를 제공한다.

### 2.3 instanceId

`instanceId`는 SwarmInstance를 식별하는 고유 식별자이다.

**생성 규칙**:

1. Swarm name과 instanceKey를 조합한다.
2. 특수문자는 `-`로 치환한다.

```typescript
function generateInstanceId(swarmName: string, instanceKey: string): string {
  const combined = `${swarmName}-${instanceKey}`;
  // 파일시스템 안전 문자로 정규화
  return combined.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
}

// 예시
// swarmName: "default", instanceKey: "cli"
// instanceId: "default-cli"

// swarmName: "default", instanceKey: "1700000000.000100" (Slack thread_ts)
// instanceId: "default-1700000000-000100"
```

---

## 3. 디렉터리 구조 다이어그램

```
~/.goondan/                              # goondanHome (System State Root)
├── bundles.json                         # Bundle Package 레지스트리
├── bundles/                             # Bundle Package 캐시
│   └── @goondan/
│       └── base/
│           └── 1.0.0/
│               ├── package.yaml
│               └── dist/
│                   ├── tools/
│                   └── extensions/
├── worktrees/                           # Changeset worktree 영역
│   └── <workspaceId>/
│       └── changesets/
│           └── <changesetId>/           # Git worktree root
│               └── (SwarmBundle 복사본)
├── oauth/                               # OAuth 저장소
│   ├── grants/
│   │   └── <subjectHash>.json           # at-rest encrypted
│   └── sessions/
│       ├── <authSessionId>.json         # at-rest encrypted
│       └── index.json                   # 세션 인덱스 (선택)
├── secrets/                             # Secret 저장소 (구현 선택)
│   └── <secretName>.json
├── metrics/                            # System 메트릭
│   └── runtime.jsonl                   # 런타임 메트릭 로그
└── instances/                           # Instance State Root
    └── <workspaceId>/
        └── <instanceId>/
            ├── metadata.json            # 인스턴스 상태(running/paused/terminated)
            ├── swarm/
            │   └── events/
            │       └── events.jsonl     # Swarm event log
            ├── agents/
            │   └── <agentName>/
            │       ├── messages/
            │       │   ├── base.jsonl   # Message base snapshot log
            │       │   └── events.jsonl # Turn message event log
            │       └── events/
            │           └── events.jsonl # Agent event log
            └── metrics/
                └── turns.jsonl          # Turn/Step 메트릭 로그

/path/to/project/                        # SwarmBundleRoot (사용자 프로젝트)
├── goondan.yaml                         # 메인 구성 파일
├── resources/                           # 리소스 분할 (선택)
├── prompts/                             # 프롬프트 파일 (선택)
├── tools/                               # Tool 구현 (선택)
├── extensions/                          # Extension 구현 (선택)
├── connectors/                          # Connector 구현 (선택)
├── bundle.yaml                          # Bundle Package 매니페스트 (선택)
└── .git/                                # Git 저장소 (권장)
```

---

## 4. SwarmBundleRoot 레이아웃

SwarmBundleRoot는 `gdn init`이 생성하는 프로젝트 디렉터리이며, Swarm 정의와 관련 코드를 포함한다.

### 4.1 표준 레이아웃

```
<swarmBundleRoot>/
├── goondan.yaml                 # SHOULD: 단일 파일 구성 (간단 모드)
├── resources/                   # MAY: 리소스 YAML 분할
│   ├── models/
│   │   └── openai-gpt-5.yaml
│   ├── tools/
│   │   └── slack-toolkit.yaml
│   └── agents/
│       └── planner.yaml
├── prompts/                     # MAY: 프롬프트 파일
│   └── planner.system.md
├── tools/                       # MAY: Tool 구현 코드
│   └── slack/
│       ├── tool.yaml
│       └── index.ts
├── extensions/                  # MAY: Extension 구현 코드
│   └── skills/
│       ├── extension.yaml
│       └── index.ts
├── connectors/                  # MAY: Connector 구현 코드
│   └── slack/
│       ├── connector.yaml
│       └── index.ts
├── bundle.yaml                  # MAY: Bundle Package 매니페스트
└── .git/                        # SHOULD: Git 저장소
```

### 4.2 규칙

1. Runtime은 SwarmBundleRoot 하위에 런타임 상태 디렉터리를 생성해서는 안 된다(MUST NOT).
   - 금지 예시: `.goondan/`, `state/`, `logs/`
2. Changeset worktree는 System State Root 하위에 생성해야 한다(SHOULD).
3. SwarmBundleRoot는 Git 저장소로 관리하는 것을 권장한다(SHOULD).

### 4.3 TypeScript 인터페이스

```typescript
interface SwarmBundleRootLayout {
  /** 메인 구성 파일 경로 (상대 경로) */
  configFile: string; // 기본: "goondan.yaml"

  /** 리소스 디렉터리 목록 (상대 경로) */
  resourceDirs?: string[];

  /** 프롬프트 디렉터리 (상대 경로) */
  promptsDir?: string;

  /** Tool 디렉터리 (상대 경로) */
  toolsDir?: string;

  /** Extension 디렉터리 (상대 경로) */
  extensionsDir?: string;

  /** Connector 디렉터리 (상대 경로) */
  connectorsDir?: string;

  /** Bundle Package 매니페스트 (상대 경로) */
  bundleManifest?: string;
}

const DEFAULT_LAYOUT: SwarmBundleRootLayout = {
  configFile: 'goondan.yaml',
  resourceDirs: ['resources'],
  promptsDir: 'prompts',
  toolsDir: 'tools',
  extensionsDir: 'extensions',
  connectorsDir: 'connectors',
  bundleManifest: 'bundle.yaml',
};
```

---

## 5. Instance State Root 레이아웃

Instance State Root는 SwarmInstance/AgentInstance의 실행 상태를 저장한다.

### 5.1 표준 레이아웃

```
<goondanHome>/instances/<workspaceId>/<instanceId>/
├── metadata.json                # MUST: 인스턴스 상태 메타데이터
├── swarm/
│   └── events/
│       └── events.jsonl         # MUST: Swarm event log (append-only)
├── agents/
│   └── <agentName>/
│       ├── messages/
│       │   ├── base.jsonl       # MUST: Message base snapshot log (append-only)
│       │   └── events.jsonl     # MUST: Turn message event log
│       └── events/
│           └── events.jsonl     # MUST: Agent event log (append-only)
├── extensions/                  # MUST: Extension 상태 영속화
│   ├── _shared.json             # MUST: instance.shared 공유 상태
│   └── <extensionName>/
│       └── state.json           # MUST: Extension별 격리 상태
└── metrics/
    └── turns.jsonl              # SHOULD: Turn/Step 메트릭 로그 (append-only)
```

### 5.2 TypeScript 인터페이스

```typescript
interface InstanceStatePaths {
  /** 인스턴스 상태 루트 */
  root: string;

  /** 인스턴스 메타데이터 파일 */
  metadataFile: string;

  /** Swarm 이벤트 로그 */
  swarmEventsLog: string;

  /** Turn/Step 메트릭 로그 */
  metricsLog: string;

  /** Extension 공유 상태 파일 (instance.shared) */
  extensionSharedState: string;

  /** Extension별 상태 경로 생성 */
  extensionState(extensionName: string): string;

  /** Agent별 경로 생성 */
  agent(agentName: string): AgentStatePaths;
}

interface AgentStatePaths {
  /** Agent 상태 루트 */
  root: string;

  /** Message base 스냅샷 로그 */
  messageBaseLog: string;

  /** Turn 메시지 이벤트 로그 */
  messageEventsLog: string;

  /** Agent 이벤트 로그 */
  eventsLog: string;
}

function createInstanceStatePaths(
  goondanHome: string,
  workspaceId: string,
  instanceId: string
): InstanceStatePaths {
  const root = path.join(goondanHome, 'instances', workspaceId, instanceId);
  const extensionsRoot = path.join(root, 'extensions');

  return {
    root,
    metadataFile: path.join(root, 'metadata.json'),
    swarmEventsLog: path.join(root, 'swarm', 'events', 'events.jsonl'),
    metricsLog: path.join(root, 'metrics', 'turns.jsonl'),
    extensionSharedState: path.join(extensionsRoot, '_shared.json'),
    extensionState(extensionName: string): string {
      return path.join(extensionsRoot, extensionName, 'state.json');
    },
    agent(agentName: string): AgentStatePaths {
      const agentRoot = path.join(root, 'agents', agentName);
      return {
        root: agentRoot,
        messageBaseLog: path.join(agentRoot, 'messages', 'base.jsonl'),
        messageEventsLog: path.join(agentRoot, 'messages', 'events.jsonl'),
        eventsLog: path.join(agentRoot, 'events', 'events.jsonl'),
      };
    },
  };
}
```

### 5.3 Instance Metadata 스키마

Runtime은 인스턴스별로 `metadata.json` 파일을 관리해야 한다(MUST).

#### 파일 위치

```
<goondanHome>/instances/<workspaceId>/<instanceId>/metadata.json
```

#### 스키마

```typescript
interface InstanceMetadata {
  /** 인스턴스 상태 */
  status: 'running' | 'paused' | 'terminated';

  /** 마지막 갱신 시각 (ISO8601) */
  updatedAt: string;

  /** 인스턴스 생성 시각 (ISO8601) */
  createdAt: string;

  /** TTL 만료 시각 (선택, ISO8601) */
  expiresAt?: string;
}
```

#### 규칙

1. `metadata.json`에는 최소 `status`와 `updatedAt`을 포함해야 한다(MUST).
2. 인스턴스 pause/resume/terminate/delete 연산은 `metadata.json`을 갱신해야 한다(MUST).
3. `status` 변경 시 해당 라이프사이클 이벤트를 Swarm event log에도 기록해야 한다(SHOULD).

#### 예시

```json
{
  "status": "running",
  "updatedAt": "2026-02-01T12:34:56.789Z",
  "createdAt": "2026-02-01T12:00:00.000Z"
}
```

### 5.4 Extension State 영속화

Runtime은 Extension의 `getState()/setState()` 상태와 `instance.shared` 공유 상태를 인스턴스별로 자동 영속화해야 한다(MUST).

#### 파일 위치

```
# Extension별 격리 상태
<goondanHome>/instances/<workspaceId>/<instanceId>/extensions/<extensionName>/state.json

# Extension 간 공유 상태
<goondanHome>/instances/<workspaceId>/<instanceId>/extensions/_shared.json
```

#### 스키마

```typescript
// Extension별 state.json — getState()/setState()의 영속 저장소
// 내용은 Extension이 setState()에 전달한 TState 객체를 JSON 직렬화한 것
type ExtensionStateFile = JsonObject;

// _shared.json — instance.shared의 영속 저장소
// 네임스페이스(extensionName:key) 사용을 권장(SHOULD)
type SharedStateFile = JsonObject;
```

#### 규칙

1. Runtime은 인스턴스 초기화 시 `extensions/<extensionName>/state.json`이 존재하면 이를 읽어 Extension의 초기 상태로 복원해야 한다(MUST).
2. Runtime은 인스턴스 초기화 시 `extensions/_shared.json`이 존재하면 이를 읽어 `instance.shared`의 초기 값으로 복원해야 한다(MUST).
3. Runtime은 Turn 종료 시점(turn.post 이후)에 변경된 Extension 상태를 디스크에 기록해야 한다(MUST). Step 단위 기록은 구현 선택이다(MAY).
4. `setState()` 호출 시 Runtime은 변경 여부를 추적하고, 변경이 없으면 디스크 쓰기를 생략해야 한다(SHOULD).
5. Extension state 파일은 JSON 형식이며, 직렬화 불가능한 값(함수, Symbol 등)을 포함해서는 안 된다(MUST NOT).
6. 인스턴스 삭제(delete) 시 해당 인스턴스의 `extensions/` 디렉터리도 함께 삭제되어야 한다(MUST).

#### 예시

```json
// extensions/basicCompaction/state.json
{
  "processedSteps": 42,
  "lastCompactionStep": "step-0041",
  "totalTokensSaved": 15230
}

// extensions/_shared.json
{
  "basicCompaction:summary": {
    "lastCompacted": "2026-02-01T12:34:56.789Z"
  },
  "logging:config": {
    "level": "debug"
  }
}
```

---

## 6. Message State Log 스키마

Runtime은 AgentInstance별 메시지 상태를 `base + events` 모델로 분리 기록해야 한다(MUST).

### 6.1 파일 위치

```
<goondanHome>/instances/<workspaceId>/<instanceId>/agents/<agentName>/messages/base.jsonl
<goondanHome>/instances/<workspaceId>/<instanceId>/agents/<agentName>/messages/events.jsonl
```

### 6.2 공통 메시지 타입

```typescript
type LlmMessage =
  | { id: string; role: 'system'; content: string }
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { id: string; role: 'tool'; toolCallId: string; toolName: string; output: JsonValue };

interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}
```

### 6.3 base.jsonl 레코드 스키마

```typescript
interface MessageBaseLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'message.base';

  /** 기록 시각 (ISO8601) */
  recordedAt: string;

  /** 추적 ID (분산 추적용) */
  traceId: string;

  /** 인스턴스 ID */
  instanceId: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** 에이전트 이름 */
  agentName: string;

  /** Turn ID */
  turnId: string;

  /** 최종 기준 메시지 스냅샷 */
  messages: LlmMessage[];

  /** 이번 turn에서 fold된 이벤트 수 */
  sourceEventCount?: number;
}
```

### 6.4 events.jsonl 레코드 스키마

```typescript
type MessageEventType =
  | 'system_message'
  | 'llm_message'
  | 'replace'
  | 'remove'
  | 'truncate';

interface MessageEventLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'message.event';

  /** 기록 시각 (ISO8601) */
  recordedAt: string;

  /** 추적 ID (분산 추적용) */
  traceId: string;

  /** 인스턴스 ID */
  instanceId: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** 에이전트 이름 */
  agentName: string;

  /** Turn ID */
  turnId: string;

  /** Turn 내 이벤트 순번(단조 증가) */
  seq: number;

  /** 이벤트 타입 */
  eventType: MessageEventType;

  /** 이벤트 페이로드 */
  payload: JsonObject;

  /** Step ID (선택) */
  stepId?: string;
}
```

### 6.5 예시

```json
{"type":"message.event","recordedAt":"2026-02-01T12:34:56.789Z","traceId":"trace-a1b2c3","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","seq":1,"eventType":"llm_message","payload":{"message":{"id":"msg-001","role":"user","content":"현재 디렉터리의 파일 목록을 보여줘"}}}
{"type":"message.event","recordedAt":"2026-02-01T12:34:57.123Z","traceId":"trace-a1b2c3","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","seq":2,"eventType":"llm_message","payload":{"message":{"id":"msg-002","role":"assistant","toolCalls":[{"id":"call_001","name":"file.list","arguments":{"path":"."}}]}}}
{"type":"message.event","recordedAt":"2026-02-01T12:34:57.456Z","traceId":"trace-a1b2c3","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","seq":3,"eventType":"llm_message","payload":{"message":{"id":"msg-003","role":"tool","toolCallId":"call_001","toolName":"file.list","output":["README.md","package.json","src/"]}}}
{"type":"message.base","recordedAt":"2026-02-01T12:34:58.789Z","traceId":"trace-a1b2c3","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","messages":[{"id":"msg-001","role":"user","content":"현재 디렉터리의 파일 목록을 보여줘"},{"id":"msg-002","role":"assistant","toolCalls":[{"id":"call_001","name":"file.list","arguments":{"path":"."}}]},{"id":"msg-003","role":"tool","toolCallId":"call_001","toolName":"file.list","output":["README.md","package.json","src/"]}],"sourceEventCount":3}
```

### 6.6 규칙

1. 각 레코드는 **단일 JSON 라인**이어야 한다(MUST).
2. `base.jsonl`은 turn 종료 시 fold 결과를 append해야 한다(MUST).
3. `events.jsonl`은 turn 중 이벤트를 append하고, base 반영 성공 후 비워야 한다(MUST).
4. 파일은 **UTF-8 인코딩**이어야 한다(MUST).
5. `recordedAt`은 **ISO8601 형식**이어야 한다(MUST).

---

## 7. Event Log 스키마

Runtime은 SwarmInstance 및 AgentInstance별로 이벤트를 append-only JSONL로 기록해야 한다(MUST).

### 7.1 Swarm Event Log

#### 파일 위치

```
<goondanHome>/instances/<workspaceId>/<instanceId>/swarm/events/events.jsonl
```

#### 레코드 스키마

```typescript
interface SwarmEventLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'swarm.event';

  /** 기록 시각 (ISO8601) */
  recordedAt: string;

  /** 추적 ID (분산 추적용) */
  traceId: string;

  /** 이벤트 종류 */
  kind: SwarmEventKind;

  /** 인스턴스 ID */
  instanceId: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** Swarm 이름 */
  swarmName: string;

  /** 관련 에이전트 이름 (선택) */
  agentName?: string;

  /** 이벤트 데이터 (선택) */
  data?: JsonObject;
}

type SwarmEventKind =
  | 'swarm.created'
  | 'swarm.started'
  | 'swarm.stopped'
  | 'swarm.paused'
  | 'swarm.resumed'
  | 'swarm.terminated'
  | 'swarm.deleted'
  | 'swarm.error'
  | 'swarm.configChanged'
  | 'agent.created'
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.delegate'
  | 'agent.delegationResult'
  | 'changeset.committed'
  | 'changeset.rejected'
  | 'changeset.activated'
  | string; // 확장 가능
```

#### 예시

```json
{"type":"swarm.event","recordedAt":"2026-02-01T12:00:00.000Z","traceId":"trace-a1b2c3","kind":"swarm.created","instanceId":"default-cli","instanceKey":"cli","swarmName":"default"}
{"type":"swarm.event","recordedAt":"2026-02-01T12:00:01.000Z","traceId":"trace-a1b2c3","kind":"agent.created","instanceId":"default-cli","instanceKey":"cli","swarmName":"default","agentName":"planner"}
{"type":"swarm.event","recordedAt":"2026-02-01T12:30:00.000Z","traceId":"trace-d4e5f6","kind":"changeset.committed","instanceId":"default-cli","instanceKey":"cli","swarmName":"default","data":{"changesetId":"cs-001","baseRef":"git:abc123","newRef":"git:def456"}}
{"type":"swarm.event","recordedAt":"2026-02-01T13:00:00.000Z","traceId":"trace-g7h8i9","kind":"swarm.paused","instanceId":"default-cli","instanceKey":"cli","swarmName":"default"}
```

### 7.2 Agent Event Log

#### 파일 위치

```
<goondanHome>/instances/<workspaceId>/<instanceId>/agents/<agentName>/events/events.jsonl
```

#### 레코드 스키마

```typescript
interface AgentEventLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'agent.event';

  /** 기록 시각 (ISO8601) */
  recordedAt: string;

  /** 추적 ID (분산 추적용) */
  traceId: string;

  /** 이벤트 종류 */
  kind: AgentEventKind;

  /** 인스턴스 ID */
  instanceId: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** 에이전트 이름 */
  agentName: string;

  /** Turn ID (선택) */
  turnId?: string;

  /** Step ID (선택) */
  stepId?: string;

  /** Step 인덱스 (선택) */
  stepIndex?: number;

  /** 이벤트 데이터 (선택) */
  data?: JsonObject;
}

type AgentEventKind =
  | 'turn.started'
  | 'turn.completed'
  | 'turn.error'
  | 'step.started'
  | 'step.completed'
  | 'step.error'
  | 'step.llmCall'
  | 'step.llmResult'
  | 'step.llmError'
  | 'toolCall.started'
  | 'toolCall.completed'
  | 'toolCall.error'
  | 'liveConfig.patchProposed'
  | 'liveConfig.patchApplied'
  | 'auth.required'
  | 'auth.granted'
  | string; // 확장 가능
```

#### 예시

```json
{"type":"agent.event","recordedAt":"2026-02-01T12:34:56.000Z","traceId":"trace-a1b2c3","kind":"turn.started","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123"}
{"type":"agent.event","recordedAt":"2026-02-01T12:34:56.100Z","traceId":"trace-a1b2c3","kind":"step.started","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","stepId":"step-xyz789","stepIndex":0}
{"type":"agent.event","recordedAt":"2026-02-01T12:34:57.000Z","traceId":"trace-a1b2c3","kind":"toolCall.started","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","stepId":"step-xyz789","stepIndex":0,"data":{"toolCallId":"call_001","toolName":"file.list"}}
{"type":"agent.event","recordedAt":"2026-02-01T12:34:57.500Z","traceId":"trace-a1b2c3","kind":"toolCall.completed","instanceId":"default-cli","instanceKey":"cli","agentName":"planner","turnId":"turn-abc123","stepId":"step-xyz789","stepIndex":0,"data":{"toolCallId":"call_001","toolName":"file.list","durationMs":500}}
```

---

## 7.3 Metrics Log 스키마

Runtime은 Turn/Step 단위 메트릭을 append-only JSONL로 기록하는 것을 권장한다(SHOULD).

### Instance Metrics (turns.jsonl)

#### 파일 위치

```
<goondanHome>/instances/<workspaceId>/<instanceId>/metrics/turns.jsonl
```

#### 레코드 스키마

```typescript
interface TurnMetricsLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'metrics.turn';

  /** 기록 시각 (ISO8601) */
  recordedAt: string;

  /** 추적 ID */
  traceId: string;

  /** Turn ID */
  turnId: string;

  /** Step ID (선택) */
  stepId?: string;

  /** 인스턴스 ID */
  instanceId: string;

  /** 에이전트 이름 */
  agentName: string;

  /** 레이턴시 (밀리초) */
  latencyMs: number;

  /** 토큰 사용량 */
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };

  /** Tool 호출 횟수 */
  toolCallCount: number;

  /** 오류 횟수 */
  errorCount: number;
}
```

#### 예시

```json
{"type":"metrics.turn","recordedAt":"2026-02-01T12:34:59.000Z","traceId":"trace-a1b2c3","turnId":"turn-abc123","instanceId":"default-cli","agentName":"planner","latencyMs":3200,"tokenUsage":{"prompt":150,"completion":30,"total":180},"toolCallCount":1,"errorCount":0}
```

### System Runtime Metrics (runtime.jsonl)

#### 파일 위치

```
<goondanHome>/metrics/runtime.jsonl
```

Runtime 전체의 집계 메트릭(인스턴스 생성/종료 수, 전역 오류 등)을 기록한다. 레코드 형식은 구현에 따라 확장 가능하다(MAY).

---

## 8. System State Root 레이아웃

System State Root는 인스턴스 수명과 무관하게 유지되는 전역 상태를 저장한다.

### 8.1 표준 레이아웃

```
<goondanHome>/
├── bundles.json                 # Bundle Package 레지스트리
├── bundles/                     # Bundle Package 캐시
│   └── <scope>/
│       └── <name>/
│           └── <version>/
│               ├── package.yaml
│               └── dist/
├── worktrees/                   # Changeset worktree
│   └── <workspaceId>/
│       └── changesets/
│           └── <changesetId>/
├── oauth/                       # OAuth 저장소
│   ├── grants/
│   │   └── <subjectHash>.json
│   └── sessions/
│       ├── <authSessionId>.json
│       └── index.json
├── secrets/                     # Secret 저장소 (구현 선택)
│   └── <secretName>.json
├── metrics/                     # System 메트릭
│   └── runtime.jsonl            # 런타임 메트릭 로그
└── instances/                   # Instance State Root
```

### 8.2 TypeScript 인터페이스

```typescript
interface SystemStatePaths {
  /** System State 루트 (= goondanHome) */
  root: string;

  /** Bundle Package 레지스트리 파일 */
  bundlesRegistry: string;

  /** Bundle Package 캐시 디렉터리 */
  bundlesCache: string;

  /** Worktrees 디렉터리 */
  worktrees: string;

  /** OAuth 저장소 */
  oauth: OAuthStorePaths;

  /** Secrets 디렉터리 */
  secrets: string;

  /** Metrics 디렉터리 */
  metricsDir: string;

  /** 런타임 메트릭 로그 */
  runtimeMetricsLog: string;

  /** Instances 디렉터리 */
  instances: string;

  /** 특정 Bundle Package 캐시 경로 */
  bundleCachePath(scope: string, name: string, version: string): string;

  /** 특정 Changeset worktree 경로 */
  changesetWorktreePath(workspaceId: string, changesetId: string): string;

  /** 특정 Instance State 경로 */
  instanceStatePath(workspaceId: string, instanceId: string): string;
}

interface OAuthStorePaths {
  /** OAuth 루트 */
  root: string;

  /** Grants 디렉터리 */
  grants: string;

  /** Sessions 디렉터리 */
  sessions: string;

  /** 특정 Grant 파일 경로 */
  grantPath(subjectHash: string): string;

  /** 특정 Session 파일 경로 */
  sessionPath(authSessionId: string): string;
}

function createSystemStatePaths(goondanHome: string): SystemStatePaths {
  return {
    root: goondanHome,
    bundlesRegistry: path.join(goondanHome, 'bundles.json'),
    bundlesCache: path.join(goondanHome, 'bundles'),
    worktrees: path.join(goondanHome, 'worktrees'),
    oauth: {
      root: path.join(goondanHome, 'oauth'),
      grants: path.join(goondanHome, 'oauth', 'grants'),
      sessions: path.join(goondanHome, 'oauth', 'sessions'),
      grantPath(subjectHash: string): string {
        return path.join(goondanHome, 'oauth', 'grants', `${subjectHash}.json`);
      },
      sessionPath(authSessionId: string): string {
        return path.join(goondanHome, 'oauth', 'sessions', `${authSessionId}.json`);
      },
    },
    secrets: path.join(goondanHome, 'secrets'),
    metricsDir: path.join(goondanHome, 'metrics'),
    runtimeMetricsLog: path.join(goondanHome, 'metrics', 'runtime.jsonl'),
    instances: path.join(goondanHome, 'instances'),

    bundleCachePath(scope: string, name: string, version: string): string {
      return path.join(goondanHome, 'bundles', scope, name, version);
    },

    changesetWorktreePath(workspaceId: string, changesetId: string): string {
      return path.join(goondanHome, 'worktrees', workspaceId, 'changesets', changesetId);
    },

    instanceStatePath(workspaceId: string, instanceId: string): string {
      return path.join(goondanHome, 'instances', workspaceId, instanceId);
    },
  };
}
```

---

## 9. OAuth 저장소 및 at-rest Encryption

### 9.1 저장소 구조

```
<goondanHome>/oauth/
├── grants/
│   └── <subjectHash>.json       # OAuthGrantRecord
└── sessions/
    ├── <authSessionId>.json     # AuthSessionRecord
    └── index.json               # 세션 인덱스 (선택)
```

### 9.2 암호화 요구사항

OAuthStore에 저장되는 모든 비밀값은 **at-rest encryption**을 적용해야 한다(MUST).

**암호화 대상 필드**:

- `token.accessToken`
- `token.refreshToken`
- `flow.pkce.codeVerifier`
- `flow.state`

**권장 구현**:

1. **Envelope Encryption**: 데이터 키로 암호화하고, 마스터 키로 데이터 키를 암호화
2. **AES-256-GCM**: 권장 암호화 알고리즘
3. **SOPS 호환 포맷**: `.sops.yaml` 확장자 사용 (선택)

### 9.3 OAuthGrantRecord 스키마

```typescript
interface OAuthGrantRecord {
  apiVersion: 'agents.example.io/v1alpha1';
  kind: 'OAuthGrantRecord';
  metadata: {
    name: string; // "sha256:<subjectHash>"
  };
  spec: {
    provider: string;
    oauthAppRef: ObjectRef;
    subject: string;
    flow: 'authorization_code' | 'device_code';
    scopesGranted: string[];
    token: {
      tokenType: string;
      accessToken: string;      // ENCRYPTED
      refreshToken?: string;    // ENCRYPTED
      expiresAt?: string;       // ISO8601
    };
    createdAt: string;          // ISO8601
    updatedAt: string;          // ISO8601
    revoked: boolean;
    providerData?: JsonObject;
  };
}
```

### 9.4 AuthSessionRecord 스키마

```typescript
interface AuthSessionRecord {
  apiVersion: 'agents.example.io/v1alpha1';
  kind: 'AuthSessionRecord';
  metadata: {
    name: string; // authSessionId
  };
  spec: {
    provider: string;
    oauthAppRef: ObjectRef;
    subjectMode: 'global' | 'user';
    subject: string;
    requestedScopes: string[];
    flow: {
      type: 'authorization_code';
      pkce: {
        method: 'S256';
        codeVerifier: string;   // ENCRYPTED
        codeChallenge: string;
      };
      state: string;            // ENCRYPTED
    };
    status: 'pending' | 'completed' | 'failed' | 'expired';
    createdAt: string;          // ISO8601
    expiresAt: string;          // ISO8601
    resume: {
      swarmRef: ObjectRef;
      instanceKey: string;
      agentName: string;
      origin: JsonObject;
      auth: TurnAuth;
    };
  };
}
```

### 9.5 암호화된 파일 예시

```json
{
  "apiVersion": "agents.example.io/v1alpha1",
  "kind": "OAuthGrantRecord",
  "metadata": {
    "name": "sha256:a1b2c3d4e5f6"
  },
  "spec": {
    "provider": "slack",
    "oauthAppRef": { "kind": "OAuthApp", "name": "slack-bot" },
    "subject": "slack:team:T111",
    "flow": "authorization_code",
    "scopesGranted": ["chat:write", "channels:read"],
    "token": {
      "tokenType": "bearer",
      "accessToken": "ENC[AES256_GCM,data:abc123...]",
      "refreshToken": "ENC[AES256_GCM,data:def456...]",
      "expiresAt": "2026-02-01T10:00:00Z"
    },
    "createdAt": "2026-01-31T09:10:01Z",
    "updatedAt": "2026-01-31T09:10:01Z",
    "revoked": false
  },
  "_encryption": {
    "algorithm": "AES-256-GCM",
    "keyId": "master-key-001",
    "encryptedDataKey": "BASE64..."
  }
}
```

---

## 10. 파일 경로 유틸리티 함수

### 10.1 WorkspacePaths 클래스

```typescript
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export interface WorkspacePathsOptions {
  /** CLI에서 전달된 state root 경로 */
  stateRoot?: string;
  /** SwarmBundle 루트 경로 */
  swarmBundleRoot: string;
}

export class WorkspacePaths {
  readonly goondanHome: string;
  readonly swarmBundleRoot: string;
  readonly workspaceId: string;

  constructor(options: WorkspacePathsOptions) {
    this.goondanHome = this.resolveGoondanHome(options.stateRoot);
    this.swarmBundleRoot = path.resolve(options.swarmBundleRoot);
    this.workspaceId = this.generateWorkspaceId(this.swarmBundleRoot);
  }

  private resolveGoondanHome(stateRoot?: string): string {
    if (stateRoot) {
      return path.resolve(stateRoot);
    }
    if (process.env.GOONDAN_STATE_ROOT) {
      return path.resolve(process.env.GOONDAN_STATE_ROOT);
    }
    return path.join(os.homedir(), '.goondan');
  }

  private generateWorkspaceId(swarmBundleRoot: string): string {
    const hash = crypto.createHash('sha256').update(swarmBundleRoot).digest('hex');
    return hash.slice(0, 12);
  }

  // === System State Paths ===

  get bundlesRegistry(): string {
    return path.join(this.goondanHome, 'bundles.json');
  }

  get bundlesCache(): string {
    return path.join(this.goondanHome, 'bundles');
  }

  bundleCachePath(scope: string, name: string, version: string): string {
    return path.join(this.bundlesCache, scope, name, version);
  }

  get oauthRoot(): string {
    return path.join(this.goondanHome, 'oauth');
  }

  get oauthGrantsDir(): string {
    return path.join(this.oauthRoot, 'grants');
  }

  get oauthSessionsDir(): string {
    return path.join(this.oauthRoot, 'sessions');
  }

  oauthGrantPath(subjectHash: string): string {
    return path.join(this.oauthGrantsDir, `${subjectHash}.json`);
  }

  oauthSessionPath(authSessionId: string): string {
    return path.join(this.oauthSessionsDir, `${authSessionId}.json`);
  }

  get secretsDir(): string {
    return path.join(this.goondanHome, 'secrets');
  }

  secretPath(secretName: string): string {
    return path.join(this.secretsDir, `${secretName}.json`);
  }

  // === Worktree Paths ===

  get worktreesRoot(): string {
    return path.join(this.goondanHome, 'worktrees', this.workspaceId);
  }

  changesetWorktreePath(changesetId: string): string {
    return path.join(this.worktreesRoot, 'changesets', changesetId);
  }

  // === Instance State Paths ===

  get instancesRoot(): string {
    return path.join(this.goondanHome, 'instances', this.workspaceId);
  }

  instancePath(instanceId: string): string {
    return path.join(this.instancesRoot, instanceId);
  }

  instanceMetadataPath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'metadata.json');
  }

  swarmEventsLogPath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'swarm', 'events', 'events.jsonl');
  }

  instanceMetricsLogPath(instanceId: string): string {
    return path.join(this.instancePath(instanceId), 'metrics', 'turns.jsonl');
  }

  agentPath(instanceId: string, agentName: string): string {
    return path.join(this.instancePath(instanceId), 'agents', agentName);
  }

  agentMessageBaseLogPath(instanceId: string, agentName: string): string {
    return path.join(this.agentPath(instanceId, agentName), 'messages', 'base.jsonl');
  }

  agentMessageEventsLogPath(instanceId: string, agentName: string): string {
    return path.join(this.agentPath(instanceId, agentName), 'messages', 'events.jsonl');
  }

  agentEventsLogPath(instanceId: string, agentName: string): string {
    return path.join(this.agentPath(instanceId, agentName), 'events', 'events.jsonl');
  }

  // === SwarmBundle Paths ===

  swarmBundlePath(...segments: string[]): string {
    return path.join(this.swarmBundleRoot, ...segments);
  }

  get configFile(): string {
    return this.swarmBundlePath('goondan.yaml');
  }

  get promptsDir(): string {
    return this.swarmBundlePath('prompts');
  }

  get toolsDir(): string {
    return this.swarmBundlePath('tools');
  }

  get extensionsDir(): string {
    return this.swarmBundlePath('extensions');
  }
}
```

### 10.2 사용 예시

```typescript
// 초기화
const paths = new WorkspacePaths({
  stateRoot: process.env.GOONDAN_STATE_ROOT,
  swarmBundleRoot: '/Users/alice/projects/my-agent',
});

// 경로 조회
console.log(paths.goondanHome);
// => "/Users/alice/.goondan"

console.log(paths.workspaceId);
// => "a1b2c3d4e5f6"

console.log(paths.agentMessageBaseLogPath('default-cli', 'planner'));
// => "/Users/alice/.goondan/instances/a1b2c3d4e5f6/default-cli/agents/planner/messages/base.jsonl"

console.log(paths.changesetWorktreePath('cs-001'));
// => "/Users/alice/.goondan/worktrees/a1b2c3d4e5f6/changesets/cs-001"

console.log(paths.oauthGrantPath('abc123'));
// => "/Users/alice/.goondan/oauth/grants/abc123.json"
```

---

## 11. 파일 작성 유틸리티

### 11.1 Append-only JSONL Writer

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export class JsonlWriter<T> {
  constructor(private readonly filePath: string) {}

  async append(record: T): Promise<void> {
    // 디렉터리 생성
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    // JSON 직렬화 (줄바꿈 없이)
    const line = JSON.stringify(record) + '\n';

    // append 모드로 쓰기
    await fs.appendFile(this.filePath, line, 'utf8');
  }

  async appendMany(records: T[]): Promise<void> {
    if (records.length === 0) return;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fs.appendFile(this.filePath, lines, 'utf8');
  }

  async* read(): AsyncGenerator<T> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      for (const line of content.split('\n')) {
        if (line.trim()) {
          yield JSON.parse(line) as T;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // 파일이 없으면 빈 generator
    }
  }

  async readAll(): Promise<T[]> {
    const records: T[] = [];
    for await (const record of this.read()) {
      records.push(record);
    }
    return records;
  }
}
```

### 11.2 사용 예시

```typescript
// Turn 메시지 이벤트 로그 작성
const messageEventLog = new JsonlWriter<MessageEventLogRecord>(
  paths.agentMessageEventsLogPath('default-cli', 'planner')
);

await messageEventLog.append({
  type: 'message.event',
  recordedAt: new Date().toISOString(),
  traceId: 'trace-a1b2c3',
  instanceId: 'default-cli',
  instanceKey: 'cli',
  agentName: 'planner',
  turnId: 'turn-abc123',
  seq: 1,
  eventType: 'llm_message',
  payload: { message: { id: 'msg-001', role: 'user', content: '안녕하세요' } },
});

// Turn 종료 후 base 스냅샷 로그 작성
const messageBaseLog = new JsonlWriter<MessageBaseLogRecord>(
  paths.agentMessageBaseLogPath('default-cli', 'planner')
);

await messageBaseLog.append({
  type: 'message.base',
  recordedAt: new Date().toISOString(),
  traceId: 'trace-a1b2c3',
  instanceId: 'default-cli',
  instanceKey: 'cli',
  agentName: 'planner',
  turnId: 'turn-abc123',
  messages: [{ id: 'msg-001', role: 'user', content: '안녕하세요' }],
  sourceEventCount: 1,
});

// 이벤트 로그 작성
const eventLog = new JsonlWriter<AgentEventLogRecord>(
  paths.agentEventsLogPath('default-cli', 'planner')
);

await eventLog.append({
  type: 'agent.event',
  recordedAt: new Date().toISOString(),
  kind: 'turn.started',
  instanceId: 'default-cli',
  instanceKey: 'cli',
  agentName: 'planner',
  turnId: 'turn-abc123',
});
```

---

## 12. 디렉터리 초기화

### 12.1 System State 초기화

```typescript
async function initializeSystemState(goondanHome: string): Promise<void> {
  const dirs = [
    path.join(goondanHome, 'bundles'),
    path.join(goondanHome, 'worktrees'),
    path.join(goondanHome, 'oauth', 'grants'),
    path.join(goondanHome, 'oauth', 'sessions'),
    path.join(goondanHome, 'secrets'),
    path.join(goondanHome, 'metrics'),
    path.join(goondanHome, 'instances'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // bundles.json 초기화 (없으면)
  const bundlesRegistry = path.join(goondanHome, 'bundles.json');
  try {
    await fs.access(bundlesRegistry);
  } catch {
    await fs.writeFile(bundlesRegistry, JSON.stringify({ packages: {} }, null, 2));
  }
}
```

### 12.2 Instance State 초기화

```typescript
async function initializeInstanceState(
  paths: WorkspacePaths,
  instanceId: string,
  agents: string[]
): Promise<void> {
  // Swarm events 디렉터리
  await fs.mkdir(
    path.dirname(paths.swarmEventsLogPath(instanceId)),
    { recursive: true }
  );

  // Metrics 디렉터리
  await fs.mkdir(
    path.dirname(paths.instanceMetricsLogPath(instanceId)),
    { recursive: true }
  );

  // metadata.json 초기화
  const metadataPath = paths.instanceMetadataPath(instanceId);
  const metadata: InstanceMetadata = {
    status: 'running',
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  // Agent별 디렉터리
  for (const agentName of agents) {
    await fs.mkdir(
      path.dirname(paths.agentMessageBaseLogPath(instanceId, agentName)),
      { recursive: true }
    );
    await fs.mkdir(
      path.dirname(paths.agentMessageEventsLogPath(instanceId, agentName)),
      { recursive: true }
    );
    await fs.mkdir(
      path.dirname(paths.agentEventsLogPath(instanceId, agentName)),
      { recursive: true }
    );
  }
}
```

---

## 13. 규칙 요약

### MUST 요구사항

1. 3개 루트(SwarmBundleRoot, Instance State Root, System State Root)는 분리되어야 한다.
2. Runtime은 SwarmBundleRoot 하위에 런타임 상태 디렉터리를 생성해서는 안 된다.
3. 메시지 상태는 `messages/base.jsonl` + `messages/events.jsonl`로 분리 기록되어야 한다.
4. `base.jsonl`은 turn 종료 시 fold 결과를 append해야 한다.
5. `events.jsonl`은 turn 중 append되고, base 반영 성공 후 비워져야 한다.
6. Swarm/Agent 이벤트 로그는 append-only JSONL로 기록되어야 한다.
7. OAuth 저장소의 비밀값은 at-rest encryption을 적용해야 한다.
8. 로그/메트릭/컨텍스트 블록에 비밀값을 마스킹 없이 기록해서는 안 된다.
9. 인스턴스 `metadata.json`에는 최소 상태(`running|paused|terminated`)와 갱신 시각을 포함해야 한다.

### SHOULD 권장사항

1. goondanHome 기본값은 `~/.goondan/`이다.
2. workspaceId는 SwarmBundleRoot 절대 경로의 SHA-256 해시 처음 12자를 사용한다.
3. SwarmBundleRoot는 Git 저장소로 관리한다.
4. Changeset worktree는 System State Root 하위에 생성한다.
5. OAuth 암호화는 AES-256-GCM을 사용한다.
6. Turn/Step 단위 메트릭 로그(`metrics/turns.jsonl`)를 기록한다.
7. 인스턴스 라이프사이클 이벤트(pause/resume/terminate/delete)를 이벤트 로그에 남긴다.

### MAY 선택사항

1. Secret 저장소(`secrets/`)는 구현 선택이다.
2. OAuth 세션 인덱스(`sessions/index.json`)는 선택이다.
3. SOPS 호환 포맷(`.sops.yaml`)은 선택이다.

---

## 부록 A. 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `GOONDAN_STATE_ROOT` | System State Root 경로 | `~/.goondan` |
| `GOONDAN_ENCRYPTION_KEY` | OAuth 암호화 마스터 키 | - |
| `GOONDAN_REGISTRY` | Bundle Package 레지스트리 URL | `https://registry.goondan.io` |
| `GOONDAN_REGISTRY_TOKEN` | 레지스트리 인증 토큰 | - |
| `GOONDAN_LOG_LEVEL` | 로그 레벨 (`debug`, `info`, `warn`, `error`) | `info` |

---

## 부록 B. CLI 설정 파일

### B.1 ~/.goondanrc

`gdn` CLI 도구의 전역 설정 파일이다.

**위치**: `~/.goondanrc`

**형식**:
```yaml
# 기본 레지스트리
registry: "https://registry.goondan.io"

# System State Root (선택, 기본: ~/.goondan)
stateRoot: "~/.goondan"

# 로그 레벨
logLevel: "info"

# 색상 출력
color: true

# 레지스트리 인증 토큰
registries:
  "https://registry.goondan.io":
    token: "xxx..."
  "https://my-org-registry.example.com":
    token: "yyy..."

# 스코프별 레지스트리 매핑
scopedRegistries:
  "@myorg": "https://my-org-registry.example.com"
```

### B.2 프로젝트 설정 파일

프로젝트 루트에 `.goondanrc`를 두면 프로젝트별 설정을 오버라이드할 수 있다(MAY).

**우선순위** (높은 것이 우선):
1. CLI 옵션
2. 환경 변수
3. 프로젝트 설정 (`.goondanrc` in project root)
4. 전역 설정 (`~/.goondanrc`)
5. 기본값

---

## 부록 C. 관련 문서

- `docs/requirements/10_workspace-model.md`: 워크스페이스 모델 요구사항
- `docs/specs/cli.md`: CLI 도구(gdn) 스펙
- `docs/specs/api.md`: Runtime/SDK API 스펙
- `docs/specs/bundle.md`: Bundle YAML 스펙
- `docs/specs/bundle_package.md`: Bundle Package 스펙
