# Goondan Workspace 및 Storage 모델 스펙 (v2.0)

> 이 문서는 Goondan v2 Workspace 및 Storage 모델의 유일한 source of truth이다.

---

## 1. 개요

### 1.1 배경 및 설계 동기

Goondan v2의 워크스페이스는 **2-root** 구조를 채택한다. v1에서는 SwarmBundleRoot, Instance State Root, System State Root의 3루트 구조를 사용했으나, Changeset/SwarmBundleRef 시스템의 제거와 Edit & Restart 모델 도입에 맞추어 **프로젝트 디렉터리(Project Root)**와 **시스템 상태 디렉터리(System Root, `~/.goondan/`)**로 단순화했다.

이 분리는 다음 설계 철학에 기반한다:

- **정의와 상태의 물리적 분리**: 프로젝트 정의(`goondan.yaml` + 코드)는 Git으로 버전 관리되고, 실행 상태(메시지 히스토리, Extension 상태)는 시스템 영역에 저장된다. 이를 통해 프로젝트 디렉터리가 깨끗하게 유지되며, 실행 상태가 Git 커밋에 혼입되는 것을 방지한다.
- **인스턴스 독립성**: 각 인스턴스의 상태는 서로 격리되어 있어 한 인스턴스의 오류가 다른 인스턴스에 영향을 주지 않는다.
- **전역 상태 보존**: 패키지 캐시, CLI 설정 등은 인스턴스 수명과 무관하게 유지된다.
- **결정론적 매핑**: Project Root의 절대 경로에서 workspaceId를 결정론적으로 생성하여, 동일 프로젝트는 항상 동일한 상태 디렉터리를 참조한다.

### 1.2 워크스페이스 구성 요약

| 루트 | 역할 | 소유권 |
|------|------|--------|
| **Project Root** | 사용자 프로젝트 정의 (goondan.yaml + 코드) | 사용자/Git |
| **System Root** | 전역 설정, 패키지, 인스턴스 상태 | Runtime |

### 1.3 v1 대비 변경사항

| 항목 | v1 | v2 |
|------|------|------|
| 루트 수 | 3-root (SwarmBundleRoot, Instance State Root, System State Root) | **2-root** (Project Root, System Root) |
| Instance State | `~/.goondan/instances/` 하위 복잡한 구조 | `~/.goondan/workspaces/<id>/instances/<key>/` 단순화 |
| 로그/메트릭 | 파일 기반 이벤트/메트릭 로그 | **프로세스 stdout/stderr** |
| OAuth 저장소 | 전용 디렉터리 (`oauth/grants/`, `oauth/sessions/`) | Extension 내부 구현으로 이동 |
| Changeset worktree | `worktrees/<workspaceId>/changesets/` | **제거** |
| Secrets | `secrets/<secretName>.json` | **제거** (환경 변수 기반) |

---

## 2. 핵심 규칙

이 섹션은 Workspace 구현자가 반드시 따라야 할 규범적 규칙들을 요약한다.

### 2.1 루트 분리 규칙

1. 워크스페이스는 **Project Root**와 **System Root** 두 개의 루트로 분리되어야 한다(MUST).
2. 두 루트는 물리적으로 분리되어야 한다(MUST). Runtime은 Project Root 하위에 실행 상태 디렉터리를 생성해서는 안 된다(MUST NOT).
3. Project Root는 프로젝트 정의(구성 + 코드)를 포함한다.
4. System Root는 인스턴스 실행 상태와 시스템 전역 설정을 포함한다.

### 2.2 Project Root 규칙

1. `gdn init`은 Project Root를 생성해야 한다(MUST).
2. `goondan.yaml`은 프로젝트의 모든 리소스를 정의해야 한다(MUST). 단일 파일 또는 복수 파일 분할을 모두 지원해야 한다(MUST).
3. Tool/Extension/Connector의 entry 파일은 Project Root 하위에 위치해야 한다(MUST).

### 2.3 System Root 규칙

1. `~/.goondan/`을 System Root 기본 경로로 사용해야 한다(SHOULD). 환경 변수 또는 설정으로 변경 가능해야 한다(MAY).
2. System Root는 `config.json`, `packages/`, `workspaces/`를 포함해야 한다(MUST).
3. `workspaceId`는 프로젝트 디렉터리 경로로부터 결정론적으로 생성되어야 한다(MUST).
4. 인스턴스 상태는 `workspaces/<workspaceId>/instances/<instanceKey>/` 하위에 저장되어야 한다(MUST).

### 2.4 메시지 영속화 규칙

1. 메시지 상태는 `messages/base.jsonl` + `messages/events.jsonl`로 분리 기록되어야 한다(MUST).
2. Turn 종료 시점에는 모든 Turn 미들웨어 종료 후 최종 계산된 `BaseMessages + SUM(Events)`를 새 base로 기록해야 한다(MUST).
3. Turn 종료 시 기존 base에 delta append가 가능하면 전체 rewrite 대신 delta append를 우선 사용해야 한다(SHOULD). Mutation 발생 시에만 rewrite해야 한다(SHOULD).
4. `events.jsonl`은 Turn 최종 base 반영이 성공한 뒤에만 비울 수 있다(MUST).
5. Runtime 재시작 시 `events.jsonl`이 비어 있지 않으면 마지막 base와 합성하여 복원해야 한다(MUST).
6. Turn 경계는 `turnId`로 구분되며, 서로 다른 Turn의 이벤트를 혼합 적용해서는 안 된다(MUST NOT).

### 2.5 보안 규칙

1. access token, refresh token, client secret 등 비밀값은 평문 저장이 금지된다(MUST). at-rest encryption을 적용해야 한다(MUST).
2. 로그/메트릭/컨텍스트 블록에 비밀값을 마스킹 없이 기록해서는 안 된다(MUST).
3. Tool/Extension은 System Root의 비밀값 저장소 파일을 직접 읽거나 수정해서는 안 된다(MUST).
4. 감사 추적을 위해 인스턴스 라이프사이클 이벤트(delete 등)를 로그에 남겨야 한다(SHOULD).

### 2.6 Extension 상태 규칙

1. 각 Extension의 상태는 `extensions/<ext-name>.json` 파일에 JSON 형식으로 저장되어야 한다(MUST).
2. Extension 상태의 읽기/쓰기는 `ExtensionApi.state.get()`/`ExtensionApi.state.set()`을 통해 수행되어야 한다(MUST).
3. Extension 상태 파일은 인스턴스 `delete` 시 함께 제거되어야 한다(MUST).
4. Extension state 파일은 JSON 형식이며, 직렬화 불가능한 값(함수, Symbol 등)을 포함해서는 안 된다(MUST NOT).

---

## 3. 경로 결정 규칙

### 3.1 goondanHome (System Root)

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

### 3.2 workspaceId

`workspaceId`는 서로 다른 Project Root(프로젝트) 간 인스턴스 충돌을 방지하는 네임스페이스이다.

**생성 규칙**:

1. Project Root의 **절대 경로**를 정규화한다.
2. 정규화된 경로의 **SHA-256 해시**를 계산한다.
3. 해시의 **처음 12자(hex)**를 workspaceId로 사용한다.

```typescript
import * as crypto from 'crypto';
import * as path from 'path';

function generateWorkspaceId(projectRoot: string): string {
  const normalized = path.resolve(projectRoot);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return hash.slice(0, 12);
}

// 예시
// Project Root: /Users/alice/projects/my-agent
// workspaceId: "a1b2c3d4e5f6"
```

**규칙**:

- workspaceId는 **결정론적**이어야 한다(MUST). 동일 경로는 항상 동일 workspaceId를 생성한다.
- workspaceId는 **충돌 가능성이 낮아야** 한다(SHOULD). 12자 hex는 약 48비트 엔트로피를 제공한다.

---

## 4. 디렉터리 구조 다이어그램

```
~/.goondan/                              # System Root (goondanHome)
├── config.json                          # CLI/시스템 설정
├── packages/                            # 설치된 패키지
│   └── <packageName>@<version>/
│       ├── goondan.yaml
│       └── dist/
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

/path/to/project/                        # Project Root (사용자 프로젝트)
├── goondan.yaml                         # 모든 리소스 정의
├── tools/                               # Tool entry 파일 (필요시)
├── extensions/                          # Extension entry 파일 (필요시)
├── connectors/                          # Connector entry 파일 (필요시)
└── .git/                                # Git 저장소 (권장)
```

---

## 5. Project Root 레이아웃

Project Root는 `gdn init`이 생성하는 프로젝트 디렉터리이며, Swarm 정의와 관련 코드를 포함한다.

### 5.1 표준 레이아웃

```
<projectRoot>/
├── goondan.yaml              # MUST: 모든 리소스 정의 (또는 분할 YAML)
├── tools/                    # MAY: Tool entry 파일
│   └── bash/
│       └── index.ts
├── extensions/               # MAY: Extension entry 파일
│   └── compaction/
│       └── index.ts
├── connectors/               # MAY: Connector entry 파일
│   └── telegram/
│       └── index.ts
├── prompts/                  # MAY: 프롬프트 파일
│   └── default.system.md
├── .env                      # MAY: 환경 변수 파일
├── .env.local                # MAY: 로컬 환경 변수 파일 (gitignore)
└── .git/                     # SHOULD: Git 저장소
```

### 5.2 규칙

1. Runtime은 Project Root 하위에 런타임 상태 디렉터리를 생성해서는 안 된다(MUST NOT).
   - 금지 예시: `.goondan/`, `state/`, `logs/`
2. `gdn init`은 Project Root를 생성해야 한다(MUST).
3. `goondan.yaml`은 프로젝트의 모든 리소스(Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)를 정의해야 한다(MUST). 단일 파일 또는 복수 파일 분할을 모두 지원해야 한다(MUST).
4. Tool/Extension/Connector의 entry 파일은 Project Root 하위에 위치해야 한다(MUST).
5. Project Root에는 `.git/` 등 버전 관리 디렉터리를 포함할 수 있다(MAY).
6. Project Root는 Git 저장소로 관리하는 것을 권장한다(SHOULD).

### 5.3 goondan.yaml 예시

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

## 6. System Root 레이아웃

System Root(`~/.goondan/`)는 CLI 설정, 패키지, 인스턴스 상태를 통합 관리한다.

### 6.1 표준 레이아웃

```
~/.goondan/                              # System Root
├── config.json                          # CLI/시스템 설정
├── packages/                            # 설치된 패키지
│   └── <packageName>@<version>/
│       ├── goondan.yaml
│       └── dist/
│           ├── tools/
│           └── extensions/
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

### 6.2 규칙

1. `~/.goondan/`을 System Root 기본 경로로 사용해야 한다(SHOULD). 환경 변수 또는 설정으로 변경 가능해야 한다(MAY).
2. System Root는 `config.json`, `packages/`, `workspaces/`를 포함해야 한다(MUST).
3. `workspaceId`는 프로젝트 디렉터리 경로로부터 결정론적으로 생성되어야 한다(MUST).
4. 인스턴스 상태는 `workspaces/<workspaceId>/instances/<instanceKey>/` 하위에 저장되어야 한다(MUST).

### 6.3 config.json 스키마

```typescript
interface SystemConfig {
  /** 기본 패키지 레지스트리 URL */
  registry?: string;

  /** 로그 레벨 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /** 레지스트리 인증 정보 */
  registries?: Record<string, { token: string }>;

  /** 스코프별 레지스트리 매핑 */
  scopedRegistries?: Record<string, string>;
}
```

**예시:**

```json
{
  "registry": "https://registry.goondan.io",
  "logLevel": "info",
  "registries": {
    "https://registry.goondan.io": {
      "token": "xxx..."
    }
  },
  "scopedRegistries": {
    "@myorg": "https://my-org-registry.example.com"
  }
}
```

---

## 7. Instance State 레이아웃

### 7.1 경로 구조

```
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/
├── metadata.json                # MUST: 인스턴스 상태 메타데이터
├── messages/
│   ├── base.jsonl               # MUST: 확정된 Message 목록
│   └── events.jsonl             # MUST: Turn 중 누적 MessageEvent 로그
└── extensions/
    └── <ext-name>.json          # MUST: Extension 상태
```

### 7.2 metadata.json 스키마

Runtime은 인스턴스별로 `metadata.json` 파일을 관리해야 한다(MUST).

```typescript
interface InstanceMetadata {
  /** 인스턴스 상태 */
  status: 'idle' | 'processing';

  /** Agent 이름 */
  agentName: string;

  /** 인스턴스 키 */
  instanceKey: string;

  /** 인스턴스 생성 시각 (ISO8601) */
  createdAt: string;

  /** 마지막 갱신 시각 (ISO8601) */
  updatedAt: string;
}
```

**규칙:**

1. `metadata.json`에는 최소 상태(`idle` | `processing`), Agent 이름, instanceKey, 생성 일시, 최종 갱신 시각을 포함해야 한다(MUST).
2. 인스턴스 `delete` 연산은 `metadata.json`을 포함한 인스턴스 디렉터리 전체를 제거해야 한다(MUST).

**예시:**

```json
{
  "status": "idle",
  "agentName": "coder",
  "instanceKey": "user:123",
  "createdAt": "2026-02-01T12:00:00.000Z",
  "updatedAt": "2026-02-01T12:34:56.789Z"
}
```

### 7.3 messages/ 디렉터리

메시지 상태는 `base.jsonl`과 `events.jsonl`로 분리 저장된다.

#### 7.3.1 Message Base Log (`base.jsonl`)

Runtime은 인스턴스별 확정 메시지 스냅샷을 `base.jsonl`에 기록해야 한다(MUST).

**레코드 형식:**

각 라인은 하나의 `Message`를 JSON 직렬화한 것이다.

```jsonl
{"id":"m1","data":{"role":"user","content":"Hello"},"metadata":{},"createdAt":"2026-02-01T12:00:00Z","source":{"type":"user"}}
{"id":"m2","data":{"role":"assistant","content":"Hi!"},"metadata":{},"createdAt":"2026-02-01T12:00:01Z","source":{"type":"assistant","stepId":"s1"}}
```

**규칙:**

1. Turn 종료 시점에는 모든 Turn 미들웨어 종료 후 최종 계산된 `BaseMessages + SUM(Events)`를 새 base로 기록해야 한다(MUST).
2. `base.jsonl`의 내용은 다음 Turn 시작 시 로드되는 현재 확정 메시지 목록이어야 한다(MUST).
3. Turn 종료 시 기존 base에 delta append가 가능하면 전체 rewrite 대신 delta append를 우선 사용해야 한다(SHOULD). Mutation(replace/remove/truncate)이 발생한 경우에만 rewrite해야 한다(SHOULD).

#### 7.3.2 Message Event Log (`events.jsonl`)

Runtime은 Turn 중 발생하는 MessageEvent를 `events.jsonl`에 append-only로 기록해야 한다(MUST).

**레코드 형식:**

```jsonl
{"type":"append","message":{"id":"m3","data":{"role":"user","content":"Fix the bug"},"metadata":{},"createdAt":"2026-02-01T12:01:00Z","source":{"type":"user"}}}
{"type":"replace","targetId":"m1","message":{"id":"m1-v2","data":{"role":"user","content":"Updated"},"metadata":{},"createdAt":"2026-02-01T12:01:01Z","source":{"type":"extension","extensionName":"compaction"}}}
```

**규칙:**

1. Runtime은 이벤트 append 순서를 `SUM(Events)`의 적용 순서로 사용해야 한다(MUST).
2. `events.jsonl`은 Turn 최종 base 반영이 성공한 뒤에만 비울 수 있다(MUST).
3. Runtime 재시작 시 `events.jsonl`이 비어 있지 않으면 마지막 base와 합성하여 복원해야 한다(MUST).
4. Turn 경계는 `turnId`로 구분되며, 서로 다른 Turn의 이벤트를 혼합 적용해서는 안 된다(MUST NOT).

#### 7.3.3 Turn 종료 시 폴드-커밋

**규칙:**

1. Turn이 정상 종료되면 `events.jsonl`의 이벤트를 `base.jsonl`에 폴딩(fold)해야 한다(MUST).
2. 폴딩 완료 후 `events.jsonl`을 클리어해야 한다(MUST).
3. 폴딩 중 오류가 발생하면 복원을 위해 해당 Turn의 `events.jsonl`을 유지해야 한다(SHOULD).

### 7.4 extensions/ 디렉터리

**규칙:**

1. 각 Extension의 상태는 `extensions/<ext-name>.json` 파일에 JSON 형식으로 저장되어야 한다(MUST).
2. Extension 상태의 읽기/쓰기는 `ExtensionApi.state.get()`/`ExtensionApi.state.set()`을 통해 수행되어야 한다(MUST).
3. Extension 상태 파일은 인스턴스 `delete` 시 함께 제거되어야 한다(MUST).
4. Runtime은 인스턴스 초기화 시 `extensions/<ext-name>.json`이 존재하면 이를 읽어 Extension의 초기 상태로 복원해야 한다(MUST).
5. Runtime은 Turn 종료 시점에 변경된 Extension 상태를 디스크에 기록해야 한다(MUST).
6. `setState()` 호출 시 Runtime은 변경 여부를 추적하고, 변경이 없으면 디스크 쓰기를 생략해야 한다(SHOULD).
7. Extension state 파일은 JSON 형식이며, 직렬화 불가능한 값(함수, Symbol 등)을 포함해서는 안 된다(MUST NOT).

**예시:**

```json
// extensions/basicCompaction.json
{
  "processedSteps": 42,
  "lastCompactionStep": "step-0041",
  "totalTokensSaved": 15230
}
```

---

## 8. packages/ 디렉터리

**규칙:**

1. `gdn package install`로 설치된 패키지는 `~/.goondan/packages/` 하위에 저장되어야 한다(MUST).
2. 패키지 디렉터리 이름은 `<packageName>@<version>` 형식을 따라야 한다(SHOULD).
3. 패키지 내 리소스는 `goondan.yaml`에서 참조할 수 있어야 한다(MUST).

**레이아웃 예시:**

```
~/.goondan/packages/
├── @goondan/base@1.0.0/
│   ├── goondan.yaml
│   └── dist/
│       ├── tools/
│       └── extensions/
└── @myorg/custom-tools@2.1.0/
    ├── goondan.yaml
    └── dist/
```

---

## 9. TypeScript 인터페이스

### 9.1 WorkspacePaths 클래스

```typescript
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export interface WorkspacePathsOptions {
  /** CLI에서 전달된 state root 경로 */
  stateRoot?: string;
  /** Project Root 경로 */
  projectRoot: string;
}

export class WorkspacePaths {
  readonly goondanHome: string;
  readonly projectRoot: string;
  readonly workspaceId: string;

  constructor(options: WorkspacePathsOptions) {
    this.goondanHome = this.resolveGoondanHome(options.stateRoot);
    this.projectRoot = path.resolve(options.projectRoot);
    this.workspaceId = this.generateWorkspaceId(this.projectRoot);
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

  private generateWorkspaceId(projectRoot: string): string {
    const hash = crypto.createHash('sha256').update(projectRoot).digest('hex');
    return hash.slice(0, 12);
  }

  // === System Root Paths ===

  get configFile(): string {
    return path.join(this.goondanHome, 'config.json');
  }

  get packagesDir(): string {
    return path.join(this.goondanHome, 'packages');
  }

  packagePath(name: string, version: string): string {
    return path.join(this.packagesDir, `${name}@${version}`);
  }

  // === Workspace Paths ===

  get workspaceRoot(): string {
    return path.join(this.goondanHome, 'workspaces', this.workspaceId);
  }

  get instancesRoot(): string {
    return path.join(this.workspaceRoot, 'instances');
  }

  // === Instance State Paths ===

  instancePath(instanceKey: string): string {
    const safeKey = instanceKey.replace(/[^a-zA-Z0-9_:-]/g, '-').slice(0, 128);
    return path.join(this.instancesRoot, safeKey);
  }

  instanceMetadataPath(instanceKey: string): string {
    return path.join(this.instancePath(instanceKey), 'metadata.json');
  }

  instanceMessageBasePath(instanceKey: string): string {
    return path.join(this.instancePath(instanceKey), 'messages', 'base.jsonl');
  }

  instanceMessageEventsPath(instanceKey: string): string {
    return path.join(this.instancePath(instanceKey), 'messages', 'events.jsonl');
  }

  instanceExtensionStatePath(instanceKey: string, extensionName: string): string {
    return path.join(this.instancePath(instanceKey), 'extensions', `${extensionName}.json`);
  }

  // === Project Root Paths ===

  projectPath(...segments: string[]): string {
    return path.join(this.projectRoot, ...segments);
  }

  get projectConfigFile(): string {
    return this.projectPath('goondan.yaml');
  }
}
```

### 9.2 사용 예시

```typescript
// 초기화
const paths = new WorkspacePaths({
  stateRoot: process.env.GOONDAN_STATE_ROOT,
  projectRoot: '/Users/alice/projects/my-agent',
});

// 경로 조회
console.log(paths.goondanHome);
// => "/Users/alice/.goondan"

console.log(paths.workspaceId);
// => "a1b2c3d4e5f6"

console.log(paths.instanceMessageBasePath('user:123'));
// => "/Users/alice/.goondan/workspaces/a1b2c3d4e5f6/instances/user:123/messages/base.jsonl"

console.log(paths.instanceExtensionStatePath('user:123', 'compaction'));
// => "/Users/alice/.goondan/workspaces/a1b2c3d4e5f6/instances/user:123/extensions/compaction.json"

console.log(paths.packagePath('@goondan/base', '1.0.0'));
// => "/Users/alice/.goondan/packages/@goondan/base@1.0.0"
```

---

## 10. 디렉터리 초기화

### 10.1 System Root 초기화

```typescript
async function initializeSystemRoot(goondanHome: string): Promise<void> {
  const dirs = [
    path.join(goondanHome, 'packages'),
    path.join(goondanHome, 'workspaces'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // config.json 초기화 (없으면)
  const configPath = path.join(goondanHome, 'config.json');
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, JSON.stringify({}, null, 2));
  }
}
```

### 10.2 Instance State 초기화

```typescript
async function initializeInstanceState(
  paths: WorkspacePaths,
  instanceKey: string,
  agentName: string
): Promise<void> {
  // messages 디렉터리
  await fs.mkdir(
    path.dirname(paths.instanceMessageBasePath(instanceKey)),
    { recursive: true }
  );

  // extensions 디렉터리
  const extDir = path.join(paths.instancePath(instanceKey), 'extensions');
  await fs.mkdir(extDir, { recursive: true });

  // metadata.json 초기화
  const metadata: InstanceMetadata = {
    status: 'idle',
    agentName,
    instanceKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    paths.instanceMetadataPath(instanceKey),
    JSON.stringify(metadata, null, 2)
  );
}
```

---

## 11. 보안 및 데이터 보존

**규칙:**

1. access token, refresh token, client secret 등 비밀값은 평문 저장이 금지된다(MUST). at-rest encryption을 적용해야 한다(MUST).
2. 로그/메트릭/컨텍스트 블록에 비밀값을 마스킹 없이 기록해서는 안 된다(MUST).
3. 감사 추적을 위해 인스턴스 라이프사이클 이벤트(delete 등)를 로그에 남겨야 한다(SHOULD).
4. Tool/Extension은 System Root의 비밀값 저장소 파일을 직접 읽거나 수정해서는 안 된다(MUST).

---

## 12. 프로세스별 로깅

v2에서는 별도의 이벤트 로그/메트릭 로그 파일을 제거하고, 각 프로세스의 stdout/stderr를 활용한다.

**규칙:**

1. Orchestrator, AgentProcess, ConnectorProcess는 각각 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
2. Orchestrator는 자식 프로세스의 stdout/stderr을 수집하여 통합 로그 출력을 제공할 수 있어야 한다(MAY).
3. 로그에는 프로세스 식별 정보(agentName, instanceKey 등)와 `traceId`를 포함해야 한다(SHOULD).

---

## 13. 규칙 요약

> 상세 규범적 규칙은 [2. 핵심 규칙](#2-핵심-규칙) 섹션을 참조한다. 이하는 빠른 참조용 요약이다.

### MUST 요구사항

1. 2개 루트(Project Root, System Root)는 물리적으로 분리되어야 한다.
2. Runtime은 Project Root 하위에 런타임 상태 디렉터리를 생성해서는 안 된다.
3. 메시지 상태는 `messages/base.jsonl` + `messages/events.jsonl`로 분리 기록되어야 한다.
4. `base.jsonl`은 Turn 종료 시 fold 결과를 기록해야 한다.
5. `events.jsonl`은 Turn 중 append되고, base 반영 성공 후 비워져야 한다.
6. Extension 상태는 `extensions/<ext-name>.json`에 JSON으로 저장되어야 한다.
7. 비밀값은 평문 저장이 금지되며, 로그/메트릭에 마스킹 없이 기록해서는 안 된다.
8. `metadata.json`에는 최소 상태, Agent 이름, instanceKey, 생성/갱신 시각을 포함해야 한다.
9. workspaceId는 Project Root 절대 경로의 SHA-256 해시로 결정론적으로 생성되어야 한다.
10. Turn 경계는 `turnId`로 구분되며, 서로 다른 Turn의 이벤트를 혼합 적용해서는 안 된다.
11. Extension state 파일은 직렬화 불가능한 값(함수, Symbol 등)을 포함해서는 안 된다.
12. Tool/Extension은 System Root의 비밀값 저장소 파일을 직접 읽거나 수정해서는 안 된다.

### SHOULD 권장사항

1. goondanHome 기본값은 `~/.goondan/`이다.
2. Project Root는 Git 저장소로 관리한다.
3. Turn 종료 시 delta append를 우선 사용하고, mutation 시에만 rewrite한다.
4. 인스턴스 라이프사이클 이벤트를 로그에 남긴다.
5. 각 프로세스는 stdout/stderr로 구조화된 로그를 출력한다.
6. `setState()` 호출 시 Runtime은 변경 여부를 추적하고, 변경이 없으면 디스크 쓰기를 생략한다.

### MAY 선택사항

1. Orchestrator가 자식 프로세스 stdout/stderr을 통합 수집한다.
2. System Root 경로를 환경 변수로 변경 가능하게 한다.
3. Project Root에 `.git/` 등 버전 관리 디렉터리를 포함할 수 있다.

---

## 부록 A. 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `GOONDAN_STATE_ROOT` | System Root 경로 | `~/.goondan` |
| `GOONDAN_REGISTRY` | Package 레지스트리 URL | `https://registry.goondan.io` |
| `GOONDAN_REGISTRY_TOKEN` | 레지스트리 인증 토큰 | - |
| `GOONDAN_LOG_LEVEL` | 로그 레벨 (`debug`, `info`, `warn`, `error`) | `info` |

---

## 부록 B. 관련 문서

- `docs/specs/runtime.md`: Runtime 실행 모델 스펙
- `docs/specs/cli.md`: CLI 도구(gdn) 스펙
- `docs/specs/bundle.md`: Bundle YAML 스펙
- `docs/specs/bundle_package.md`: Package 스펙
- `docs/specs/extension.md`: Extension 시스템 스펙

---

**문서 버전**: v2.0
**최종 수정**: 2026-02-12
