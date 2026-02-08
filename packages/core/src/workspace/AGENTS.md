# Workspace 모듈

Goondan Runtime의 파일시스템 레이아웃과 저장소 모델을 구현합니다.

## 스펙 문서

- `/docs/specs/workspace.md` - Workspace 및 Storage 모델 스펙

## 파일 구조

```
workspace/
├── types.ts          # 타입 정의 (GoondanHomeOptions, InstanceStatePaths, LogRecord 등)
├── config.ts         # 설정 유틸리티 (resolveGoondanHome, generateWorkspaceId 등)
├── paths.ts          # WorkspacePaths 클래스 (경로 생성/해석)
├── secrets.ts        # SecretsStore 클래스 (시크릿 CRUD)
├── logs.ts           # 로거 클래스들 (JsonlWriter, MessageBaseLogger, MessageEventLogger 등)
├── manager.ts        # WorkspaceManager 클래스 (워크스페이스 관리)
├── index.ts          # re-export
└── AGENTS.md         # 이 파일
```

## 핵심 개념

### 3루트 분리

1. **SwarmBundleRoot**: Swarm 정의 (YAML + 코드) - 사용자/Git 소유
2. **Instance State Root**: 인스턴스 실행 상태 (로그) - Runtime 소유
3. **System State Root**: 전역 상태 (OAuth, 캐시) - Runtime 소유

### 경로 결정 규칙

1. **goondanHome**: CLI 옵션 > 환경변수 > ~/.goondan
2. **workspaceId**: SwarmBundleRoot 절대경로의 SHA-256 해시 (12자)
3. **instanceId**: swarmName + instanceKey (특수문자 치환, 128자 제한)

### 메시지 상태 모델 (base + events)

`NextMessages = BaseMessages + SUM(Events)` 공식을 따르며:
- `messages/base.jsonl`: Turn 종료 시 fold된 메시지 스냅샷 (MessageBaseLogRecord)
- `messages/events.jsonl`: Turn 중 append되는 이벤트 (MessageEventLogRecord), base 반영 후 비움

## 주요 클래스

### WorkspacePaths

경로 생성 유틸리티 클래스:

```typescript
const paths = new WorkspacePaths({
  stateRoot: '/custom/state',
  swarmBundleRoot: '/path/to/project',
});

paths.secretsDir                                          // /custom/state/secrets
paths.agentMessageBaseLogPath('inst-1', 'planner')        // /.../agents/planner/messages/base.jsonl
paths.agentMessageEventsLogPath('inst-1', 'planner')      // /.../agents/planner/messages/events.jsonl
paths.instanceMetadataPath('inst-1')                      // /.../inst-1/metadata.json
paths.instanceMetricsLogPath('inst-1')                    // /.../inst-1/metrics/turns.jsonl
paths.extensionSharedStatePath('inst-1')                  // /.../inst-1/extensions/_shared.json
paths.extensionStatePath('inst-1', 'basicCompaction')     // /.../extensions/basicCompaction/state.json
```

### WorkspaceManager

워크스페이스 관리 클래스:

```typescript
const manager = WorkspaceManager.create({
  stateRoot: '/custom/state',
  swarmBundleRoot: '/path/to/project',
});

await manager.initializeSystemState();
await manager.initializeInstanceState('inst-1', ['planner', 'executor']);

const baseLogger = manager.createMessageBaseLogger('inst-1', 'planner');
const eventLogger = manager.createMessageEventLogger('inst-1', 'planner');
const messageStateLogger = manager.createTurnMessageStateLogger('inst-1', 'planner');
const recovery = await manager.recoverTurnMessageState('inst-1', 'planner');
const metricsLogger = manager.createTurnMetricsLogger('inst-1');
const store = manager.getSecretsStore();

// metadata/lifecycle
await manager.markInstancePaused('inst-1');
await manager.markInstanceRunning('inst-1');
await manager.markInstanceTerminated('inst-1');
const lifecycleHooks = manager.createSwarmInstanceLifecycleHooks();

// extension state persistence/restore
const stateStore = await manager.createPersistentStateStore('inst-1');
stateStore.setExtensionState('basicCompaction', { processedSteps: 1 });
```

### SecretsStore

시크릿 저장소:

```typescript
const store = new SecretsStore('/path/to/secrets');
await store.set('api-key', { value: 'secret-value' });
const entry = await store.get('api-key');
```

### MessageBaseLogger / MessageEventLogger

메시지 base+events 분리 로거:

```typescript
const baseLogger = new MessageBaseLogger('/path/to/base.jsonl');
await baseLogger.log({
  traceId: 'trace-id',
  instanceId: 'inst-1',
  instanceKey: 'cli',
  agentName: 'planner',
  turnId: 'turn-001',
  messages: [{ id: 'msg-001', role: 'user', content: 'Hello' }],
  sourceEventCount: 1,
});

const eventLogger = new MessageEventLogger('/path/to/events.jsonl');
await eventLogger.log({
  traceId: 'trace-id',
  instanceId: 'inst-1',
  instanceKey: 'cli',
  agentName: 'planner',
  turnId: 'turn-001',
  seq: 1,
  eventType: 'llm_message',
  payload: { message: { id: 'msg-001', role: 'user', content: 'Hello' } },
});
await eventLogger.clear(); // base 반영 후 비우기

// Runtime 재시작 복구용: 마지막 base + 잔존 events 로드
const recovered = await manager.recoverTurnMessageState('inst-1', 'planner');
```

## 규칙

1. **타입 단언 금지**: `as` 사용 금지, 타입 가드 사용
2. **경로 traversal 방지**: 시크릿 이름 검증 필수
3. **UTF-8 인코딩**: 모든 로그 파일은 UTF-8
4. **ISO8601 시간 형식**: recordedAt 등 시간 필드는 ISO8601
5. **traceId 필수**: 모든 로그 레코드에 traceId 포함 (분산 추적용)

## 테스트

```bash
pnpm --filter @goondan/core test -- __tests__/workspace/
```

## 의존성

- `types/json.ts` - JsonObject, JsonValue 타입
- Node.js `crypto`, `fs/promises`, `os`, `path` 모듈
