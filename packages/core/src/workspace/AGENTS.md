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
├── logs.ts           # 로거 클래스들 (JsonlWriter, LlmMessageLogger 등)
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

## 주요 클래스

### WorkspacePaths

경로 생성 유틸리티 클래스:

```typescript
const paths = new WorkspacePaths({
  stateRoot: '/custom/state',
  swarmBundleRoot: '/path/to/project',
});

paths.secretsDir          // /custom/state/secrets
paths.agentMessagesLogPath('inst-1', 'planner')  // /.../agents/planner/messages/llm.jsonl
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

const logger = manager.createLlmMessageLogger('inst-1', 'planner');
const store = manager.getSecretsStore();
```

### SecretsStore

시크릿 저장소:

```typescript
const store = new SecretsStore('/path/to/secrets');
await store.set('api-key', { value: 'secret-value' });
const entry = await store.get('api-key');
```

### JsonlWriter / Loggers

Append-only JSONL 로거:

```typescript
const logger = new LlmMessageLogger('/path/to/llm.jsonl');
await logger.log({
  instanceId: 'inst-1',
  instanceKey: 'cli',
  agentName: 'planner',
  turnId: 'turn-001',
  message: { role: 'user', content: 'Hello' },
});
```

## 규칙

1. **타입 단언 금지**: `as` 사용 금지, 타입 가드 사용
2. **경로 traversal 방지**: 시크릿 이름 검증 필수
3. **UTF-8 인코딩**: 모든 로그 파일은 UTF-8
4. **ISO8601 시간 형식**: recordedAt 등 시간 필드는 ISO8601

## 테스트

```bash
pnpm --filter @goondan/core test -- __tests__/workspace/
```

## 의존성

- `types/json.ts` - JsonObject, JsonValue 타입
- Node.js `crypto`, `fs/promises`, `os`, `path` 모듈
