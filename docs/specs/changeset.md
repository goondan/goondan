# Goondan Changeset/SwarmBundle 스펙 (v0.9)

본 문서는 `docs/requirements/index.md`(특히 5.4, 6.4, 7.4.1, 7.5.1, 9.4)를 기반으로 Changeset/SwarmBundle 시스템의 **구현 스펙**을 정의한다.

---

## 목차

1. [SwarmBundle 개념과 구조](#1-swarmbundle-개념과-구조)
2. [SwarmBundleRef (불변 식별자)](#2-swarmbundleref-불변-식별자)
3. [SwarmBundleManager 역할](#3-swarmbundlemanager-역할)
4. [swarmBundle.openChangeset](#4-swarmbundleopenchangeset)
5. [swarmBundle.commitChangeset](#5-swarmbundlecommitchangeset)
6. [ChangesetPolicy 검증](#6-changesetpolicy-검증)
7. [Safe Point 활성화 규칙](#7-safe-point-활성화-규칙)
8. [Canonical Writer 규칙](#8-canonical-writer-규칙)
9. [emitRevisionChangedEvent 처리](#9-emitrevisionchangedevent-처리)
10. [Changeset 실패 시 이벤트 로그 기록](#10-changeset-실패-시-이벤트-로그-기록)
11. [TypeScript 인터페이스](#11-typescript-인터페이스)
12. [구현 알고리즘](#12-구현-알고리즘)

---

## 1. SwarmBundle 개념과 구조

### 1.1 정의

**SwarmBundle**은 Swarm(및 그에 포함된 Agent/Tool/Extension/Connector/OAuthApp 등)을 정의하는 **Bundle**이다. Bundle은 YAML 리소스와 소스코드(도구/확장/커넥터/프롬프트/기타 파일)를 함께 포함하는 **폴더 트리**이다.

SwarmBundle의 YAML/소스코드를 수정하면 **에이전트의 행동(동작과 통합)이 수정**된다.

### 1.2 SwarmBundleRoot 레이아웃

`gdn init`이 생성하는 프로젝트가 SwarmBundleRoot이다.

```text
<swarmBundleRoot>/
  goondan.yaml                   # SHOULD: 단일 파일 구성(간단 모드)
  resources/                     # MAY: 리소스 분할
  prompts/                       # MAY
  tools/                         # MAY
  extensions/                    # MAY
  connectors/                    # MAY
  bundle.yaml                    # MAY: Bundle Package를 함께 두는 경우
  .git/                          # SHOULD: Git 기반 changeset 권장
```

### 1.3 규칙

- SwarmBundleRoot의 콘텐츠는 Changeset에 의해 변경될 수 있어야 한다(MUST).
- Runtime은 SwarmBundleRoot 하위에 런타임 상태 디렉터리를 생성해서는 안 된다(MUST NOT).
- Changeset worktree는 System State Root(`<goondanHome>`) 하위에 생성해야 한다(SHOULD).

---

## 2. SwarmBundleRef (불변 식별자)

### 2.1 정의

**SwarmBundleRef**는 특정 SwarmBundle 스냅샷을 식별하는 **불변 식별자**이다(opaque string).

### 2.2 Git 기반 구현

Git 기반 구현에서는 SwarmBundleRoot의 Git commit SHA(또는 tag/branch ref)를 SwarmBundleRef로 사용하는 것을 권장한다(SHOULD).

```
git:<commit-sha>
```

예시:
```
git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t
```

### 2.3 규칙

- 동일 SwarmBundleRef는 동일한 Bundle 콘텐츠를 재현 가능해야 한다(MUST).
- Step은 시작 시점에 특정 SwarmBundleRef로 핀되어야 한다(MUST).
- SwarmBundleRef는 Step 실행 중 변경되어서는 안 된다(MUST).

### 2.4 TypeScript 타입

```typescript
/**
 * SwarmBundleRef는 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자이다.
 * Git 기반 구현에서는 "git:<commit-sha>" 형식을 사용한다.
 */
type SwarmBundleRef = string;

/**
 * SwarmBundleRef를 파싱한 결과
 */
interface ParsedSwarmBundleRef {
  type: 'git';
  commitSha: string;
}

function parseSwarmBundleRef(ref: SwarmBundleRef): ParsedSwarmBundleRef {
  if (ref.startsWith('git:')) {
    return { type: 'git', commitSha: ref.slice(4) };
  }
  throw new Error(`Invalid SwarmBundleRef format: ${ref}`);
}
```

---

## 3. SwarmBundleManager 역할

### 3.1 정의

**SwarmBundleManager**는 Runtime 내부에서 SwarmBundle 변경을 안전하게 관리하는 컴포넌트이다.

### 3.2 책임

1. **Changeset 발급**: `openChangeset`으로 changesetId와 Git worktree 경로를 발급
2. **Changeset 커밋**: `commitChangeset`으로 Git commit을 생성하고 활성 Ref를 업데이트
3. **정책 검증**: ChangesetPolicy(allowed.files)를 검사하여 허용되지 않은 변경을 거부
4. **단일 작성자**: SwarmBundleRoot에 대한 변경(Ref 이동/commit)은 오직 SwarmBundleManager만 수행

### 3.3 TypeScript 인터페이스

```typescript
interface SwarmBundleManager {
  /**
   * 현재 활성 SwarmBundleRef를 반환한다.
   */
  getActiveRef(): Promise<SwarmBundleRef>;

  /**
   * 새 Changeset을 열고 Git worktree를 생성한다.
   */
  openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult>;

  /**
   * Changeset의 변경 사항을 Git commit으로 만들고 활성 Ref를 업데이트한다.
   */
  commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult>;

  /**
   * 열린 Changeset을 정리(폐기)한다.
   */
  discardChangeset(changesetId: string): Promise<void>;
}
```

---

## 4. swarmBundle.openChangeset

### 4.1 정의

`swarmBundle.openChangeset`은 LLM이 SwarmBundle을 수정하기 위해 호출하는 도구이다. Git worktree를 생성하고 changesetId와 workdir 경로를 반환한다.

### 4.2 입력 타입

```typescript
interface OpenChangesetInput {
  /**
   * Changeset을 여는 이유 (선택)
   */
  reason?: string;
}
```

### 4.3 출력 타입

```typescript
interface OpenChangesetResult {
  /**
   * Changeset 고유 식별자
   */
  changesetId: string;

  /**
   * 기준 SwarmBundleRef (Changeset이 기반으로 하는 스냅샷)
   */
  baseRef: SwarmBundleRef;

  /**
   * Git worktree 경로 (쓰기 가능)
   */
  workdir: string;

  /**
   * 수정 힌트 (선택)
   */
  hint?: OpenChangesetHint;
}

interface OpenChangesetHint {
  /**
   * workdir 내에서 Bundle 루트의 상대 경로 (보통 ".")
   */
  bundleRootInWorkdir: string;

  /**
   * 수정을 권장하는 파일/디렉터리 패턴
   */
  recommendedFiles: string[];
}
```

### 4.4 출력 예시

```json
{
  "changesetId": "cs-000123",
  "baseRef": "git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
  "workdir": "/Users/user/.goondan/worktrees/abc123/changesets/cs-000123/",
  "hint": {
    "bundleRootInWorkdir": ".",
    "recommendedFiles": [
      "goondan.yaml",
      "resources/**",
      "prompts/**",
      "tools/**",
      "extensions/**"
    ]
  }
}
```

### 4.5 Git worktree 생성 규칙

1. **경로 규칙**: workdir은 System State Root 하위에 생성한다(MUST).
   ```
   <goondanHome>/worktrees/<workspaceId>/changesets/<changesetId>/
   ```

2. **중첩 금지**: workdir은 `<changesetId>/` 디렉터리 자체이며, 그 하위에 `workdir/` 같은 추가 중첩 디렉터리를 두지 않는다(MUST NOT).

3. **SwarmBundleRoot 분리**: workdir은 SwarmBundleRoot 하위에 생성되어서는 안 된다(MUST NOT).

4. **쓰기 가능**: workdir은 쓰기 가능해야 한다(MUST).

5. **기준 Ref 초기화**: workdir은 baseRef의 콘텐츠로 초기화되어야 한다(MUST).

### 4.6 Git 명령어 예시

```bash
# workspaceId: SwarmBundleRoot 경로 해시
WORKSPACE_ID=$(echo -n "/path/to/swarm-bundle-root" | sha256sum | cut -c1-16)

# changesetId 생성
CHANGESET_ID="cs-$(date +%s)-$(uuidgen | cut -c1-8)"

# worktree 경로
WORKTREE_PATH="${GOONDAN_HOME}/worktrees/${WORKSPACE_ID}/changesets/${CHANGESET_ID}"

# Git worktree 생성 (현재 HEAD 기준)
cd /path/to/swarm-bundle-root
git worktree add "${WORKTREE_PATH}" HEAD

# baseRef 기록
BASE_REF="git:$(git rev-parse HEAD)"
```

### 4.7 규칙

- Open된 changeset은 commit되기 전까지 실행에 영향을 주지 않는다(MUST).
- 동시에 여러 changeset을 열 수 있으나, commit 시 충돌 해결은 구현 선택이다(MAY).

---

## 5. swarmBundle.commitChangeset

### 5.1 정의

`swarmBundle.commitChangeset`은 열린 Changeset의 변경 사항을 Git commit으로 만들고, SwarmBundleRoot의 활성 Ref를 업데이트한다.

### 5.2 입력 타입

```typescript
interface CommitChangesetInput {
  /**
   * 커밋할 Changeset의 ID
   */
  changesetId: string;

  /**
   * Git commit 메시지 (선택)
   */
  message?: string;
}
```

### 5.3 출력 타입

```typescript
interface CommitChangesetResult {
  /**
   * 처리 결과 상태
   * - ok: 성공적으로 커밋됨
   * - rejected: ChangesetPolicy 위반으로 거부됨
   * - failed: 기타 오류로 실패함
   */
  status: 'ok' | 'rejected' | 'failed';

  /**
   * Changeset ID
   */
  changesetId: string;

  /**
   * 기준 SwarmBundleRef
   */
  baseRef: SwarmBundleRef;

  /**
   * 새로 생성된 SwarmBundleRef (status가 ok인 경우에만)
   */
  newRef?: SwarmBundleRef;

  /**
   * 변경 요약 (status가 ok인 경우에만)
   */
  summary?: CommitSummary;

  /**
   * 오류 정보 (status가 rejected 또는 failed인 경우)
   */
  error?: CommitError;
}

interface CommitSummary {
  /**
   * 변경된 파일 목록
   */
  filesChanged: string[];

  /**
   * 추가된 파일 목록
   */
  filesAdded: string[];

  /**
   * 삭제된 파일 목록
   */
  filesDeleted: string[];
}

interface CommitError {
  /**
   * 오류 코드
   */
  code: string;

  /**
   * 오류 메시지
   */
  message: string;

  /**
   * 위반된 파일 목록 (rejected인 경우)
   */
  violatedFiles?: string[];
}
```

### 5.4 출력 예시 (성공)

```json
{
  "status": "ok",
  "changesetId": "cs-000123",
  "baseRef": "git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
  "newRef": "git:9b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u",
  "summary": {
    "filesChanged": ["prompts/planner.system.md"],
    "filesAdded": ["tools/newTool/index.ts"],
    "filesDeleted": []
  }
}
```

### 5.5 출력 예시 (거부)

```json
{
  "status": "rejected",
  "changesetId": "cs-000123",
  "baseRef": "git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
  "error": {
    "code": "POLICY_VIOLATION",
    "message": "ChangesetPolicy에 의해 허용되지 않은 파일이 변경되었습니다.",
    "violatedFiles": ["goondan.yaml", ".gitignore"]
  }
}
```

### 5.6 Git commit 생성 규칙

1. **변경 감지**: worktree에서 `git status`로 변경된 파일을 감지한다.
2. **정책 검증**: 변경된 파일이 ChangesetPolicy의 allowed.files와 일치하는지 검사한다.
3. **스테이징**: 정책을 통과하면 모든 변경 사항을 스테이징한다.
4. **커밋 생성**: Git commit을 생성한다.
5. **Ref 업데이트**: SwarmBundleRoot의 활성 브랜치에 변경 사항을 반영한다.
6. **정리**: worktree를 제거한다.

### 5.7 Git 명령어 예시

```bash
# worktree 경로
WORKTREE_PATH="${GOONDAN_HOME}/worktrees/${WORKSPACE_ID}/changesets/${CHANGESET_ID}"

# 변경된 파일 목록 가져오기
cd "${WORKTREE_PATH}"
CHANGED_FILES=$(git status --porcelain | awk '{print $2}')

# 정책 검증 (구현에서 수행)
# validatePolicy($CHANGED_FILES, $ALLOWED_PATTERNS)

# 모든 변경 사항 스테이징
git add -A

# 커밋 생성
git commit -m "${COMMIT_MESSAGE:-"Changeset ${CHANGESET_ID}"}"

# 새 commit SHA 기록
NEW_REF="git:$(git rev-parse HEAD)"

# SwarmBundleRoot로 변경 사항 반영 (cherry-pick 또는 merge)
cd /path/to/swarm-bundle-root
git fetch "${WORKTREE_PATH}" HEAD:changeset-${CHANGESET_ID}
git merge --ff-only changeset-${CHANGESET_ID}

# worktree 정리
git worktree remove "${WORKTREE_PATH}"
git branch -d changeset-${CHANGESET_ID}
```

### 5.8 status 값 정의

| status | 의미 | 조건 |
|--------|------|------|
| `ok` | 성공적으로 커밋됨 | 정책 검증 통과, Git 작업 성공 |
| `rejected` | 정책 위반으로 거부됨 | ChangesetPolicy의 allowed.files 위반 |
| `failed` | 기타 오류로 실패함 | Git 오류, 파일시스템 오류, 병합 충돌 등 |

---

## 6. ChangesetPolicy 검증

### 6.1 정의

**ChangesetPolicy**는 Changeset이 수정할 수 있는 파일 범위를 제한하는 정책이다.

### 6.2 Swarm ChangesetPolicy

Swarm의 ChangesetPolicy는 **최대 허용 범위**를 정의한다.

```yaml
kind: Swarm
metadata:
  name: default
spec:
  policy:
    changesets:
      enabled: true
      applyAt: ["step.config"]
      allowed:
        files:
          - "resources/**"
          - "prompts/**"
          - "tools/**"
          - "extensions/**"
      emitRevisionChangedEvent: true
```

### 6.3 Agent ChangesetPolicy

Agent의 ChangesetPolicy는 Swarm 정책에 대한 **추가 제약(더 좁게)**을 정의한다.

```yaml
kind: Agent
metadata:
  name: planner
spec:
  changesets:
    allowed:
      files:
        - "prompts/**"
        - "resources/**"
```

### 6.4 검증 알고리즘

Changeset commit 시 변경된 파일이 정책을 만족하는지 검증한다.

```typescript
interface ChangesetPolicy {
  enabled?: boolean;
  applyAt?: string[];
  allowed?: {
    files?: string[];
  };
  emitRevisionChangedEvent?: boolean;
}

interface PolicyValidationResult {
  valid: boolean;
  violatedFiles: string[];
}

function validateChangesetPolicy(
  changedFiles: string[],
  swarmPolicy: ChangesetPolicy | undefined,
  agentPolicy: ChangesetPolicy | undefined
): PolicyValidationResult {
  const violatedFiles: string[] = [];

  // changesets가 비활성화되어 있으면 모든 변경 거부
  if (swarmPolicy?.enabled === false) {
    return { valid: false, violatedFiles: changedFiles };
  }

  // Swarm allowed.files 패턴
  const swarmPatterns = swarmPolicy?.allowed?.files ?? [];

  // Agent allowed.files 패턴 (추가 제약)
  const agentPatterns = agentPolicy?.allowed?.files ?? swarmPatterns;

  for (const file of changedFiles) {
    // Swarm 정책 검사 (최대 허용 범위)
    const matchesSwarm = swarmPatterns.length === 0 ||
      swarmPatterns.some(pattern => matchGlob(file, pattern));

    // Agent 정책 검사 (추가 제약)
    const matchesAgent = agentPatterns.length === 0 ||
      agentPatterns.some(pattern => matchGlob(file, pattern));

    // 두 정책 모두 만족해야 함
    if (!matchesSwarm || !matchesAgent) {
      violatedFiles.push(file);
    }
  }

  return {
    valid: violatedFiles.length === 0,
    violatedFiles
  };
}
```

### 6.5 Glob 매칭 규칙

파일 경로 glob 매칭은 다음 규칙을 따른다.

| 패턴 | 설명 | 예시 |
|------|------|------|
| `*` | 단일 디렉터리 내 임의 문자열 | `*.md` -> `README.md` |
| `**` | 임의 깊이의 디렉터리 | `prompts/**` -> `prompts/a/b/c.md` |
| `?` | 단일 문자 | `file?.txt` -> `file1.txt` |
| `[abc]` | 문자 집합 | `file[123].txt` -> `file1.txt` |

```typescript
import { minimatch } from 'minimatch';

function matchGlob(filePath: string, pattern: string): boolean {
  return minimatch(filePath, pattern, {
    dot: true,        // .으로 시작하는 파일도 매칭
    matchBase: false  // 전체 경로 매칭
  });
}
```

### 6.6 정책 중첩 규칙

- Swarm.allowed.files가 "최대 허용 범위"이다(MUST).
- Agent.allowed.files는 "해당 Agent의 추가 제약"으로 해석한다(MUST).
- Agent가 생성/커밋하는 changeset은 **Swarm.allowed + Agent.allowed 모두를 만족**해야 허용된다(MUST).

---

## 7. Safe Point 활성화 규칙

### 7.1 정의

**Safe Point**는 SwarmBundleRef가 활성화될 수 있는 시점이다.

### 7.2 표준 Safe Point

Runtime은 최소 `step.config` Safe Point를 제공해야 한다(MUST).

```yaml
spec:
  policy:
    changesets:
      applyAt:
        - step.config
```

### 7.2.1 추가 Safe Point (선택)

구현은 `turn.start` Safe Point를 추가 제공할 수 있다(MAY).  
`turn.start` Safe Point를 사용하는 구현은 Turn 시작 시 `activeSwarmRef`를 고정하고,
Turn 종료 전까지 같은 Ref를 유지해야 한다(SHOULD).

### 7.3 step.config에서 activeSwarmRef 결정

Step 시작 시 `step.config` 파이프라인 포인트에서 다음을 수행한다.

1. **현재 활성 Ref 조회**: SwarmBundleManager에서 현재 활성 Ref를 조회한다.
2. **activeSwarmRef 확정**: 이번 Step의 `activeSwarmRef`를 스냅샷으로 확정한다.
3. **Effective Config 로드**: 해당 Ref 기준으로 Effective Config를 로드/조립한다.

```typescript
async function stepConfig(ctx: StepContext): Promise<StepContext> {
  // 1. 현재 활성 Ref 조회
  const activeRef = await swarmBundleManager.getActiveRef();

  // 2. Step의 activeSwarmRef 확정
  ctx.step.activeSwarmRef = activeRef;

  // 3. Effective Config 로드
  ctx.effectiveConfig = await loadEffectiveConfig(activeRef);

  return ctx;
}
```

### 7.4 Step 실행 중 불변성 보장

Step이 시작된 이후에는 Step 종료 전까지 다음이 변경되어서는 안 된다(MUST).

- `activeSwarmRef` (SwarmBundleRef)
- `effectiveConfig` (Effective Config)

### 7.5 "다음 Step부터 반영" 규칙

Step N 중 commit된 changeset으로 생성된 SwarmBundleRef는, Step N+1의 `step.config`에서 활성화되는 것이 기본 규칙이다(MUST).

```
Step N:
  - LLM이 swarmBundle.openChangeset 호출 -> workdir 수신
  - LLM이 bash로 workdir 파일 수정
  - LLM이 swarmBundle.commitChangeset 호출 -> newRef 생성
  - Step N은 기존 activeSwarmRef로 계속 실행

Step N+1:
  - step.config에서 newRef를 activeSwarmRef로 활성화
  - 새 Effective Config 로드
  - Step N+1부터 새 SwarmBundle 기반으로 실행
```

`turn.start` Safe Point를 사용하는 구현에서는 위 규칙을 Turn 경계로 확장할 수 있다(MAY):

- Turn T 중 commit된 Ref는 Turn T+1 시작 시 활성화
- Turn T가 종료되기 전에는 Ref 전환 금지

### 7.6 예외 사항

Step N 시작 전에 이미 활성 Ref가 업데이트된 경우, Step N에서 그 Ref를 활성화하는 것은 자연스럽게 허용된다.

---

## 8. Canonical Writer 규칙

### 8.1 정의

**Canonical Writer(정본 단일 작성자)** 규칙은 SwarmBundleRoot에 대한 변경 권한을 단일 주체로 제한한다.

### 8.2 규칙

1. **정본은 Git**: Git 기반 구현에서 정본은 SwarmBundleRoot의 Git history/refs이다.
2. **병렬 정본 금지**: Runtime은 Git과 별개로 `changesets.jsonl`, `changeset-status.jsonl`, `cursor.yaml`, `head.ref`, `base.ref` 같은 "병렬 정본" 파일을 요구하지 않는다(MUST NOT).
3. **단일 작성자**: SwarmBundleRoot에 대한 변경(Ref 이동/commit)은 Runtime 내부 SwarmBundleManager만이 수행할 수 있어야 한다(MUST).

### 8.3 의의

- 변경 이력의 일관성 보장
- 동시성 충돌 방지
- Git의 강력한 이력 관리 기능 활용

### 8.4 구현 고려사항

```typescript
class SwarmBundleManager {
  private lockFile: string;

  async acquireLock(): Promise<void> {
    // 락 파일을 통한 단일 작성자 보장
    // 구현: flock, lockfile, advisory lock 등
  }

  async releaseLock(): Promise<void> {
    // 락 해제
  }

  async commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult> {
    await this.acquireLock();
    try {
      // Git 작업 수행
      return await this.doCommit(input);
    } finally {
      await this.releaseLock();
    }
  }
}
```

---

## 9. emitRevisionChangedEvent 처리

### 9.1 정의

`emitRevisionChangedEvent`가 `true`인 경우, Runtime은 revision 변경 요약을 다음 Step 입력 또는 블록에 포함시키는 것을 권장한다(SHOULD).

### 9.2 설정

```yaml
spec:
  policy:
    changesets:
      emitRevisionChangedEvent: true
```

### 9.3 구현

```typescript
interface RevisionChangedEvent {
  type: 'swarmBundle.revisionChanged';
  previousRef: SwarmBundleRef;
  newRef: SwarmBundleRef;
  changesetId: string;
  summary: CommitSummary;
  timestamp: string;
}

// step.config에서 revision 변경 감지
async function stepConfig(ctx: StepContext): Promise<StepContext> {
  const newRef = await swarmBundleManager.getActiveRef();
  const previousRef = ctx.previousActiveSwarmRef;

  if (previousRef && previousRef !== newRef) {
    // revision 변경됨
    const event: RevisionChangedEvent = {
      type: 'swarmBundle.revisionChanged',
      previousRef,
      newRef,
      changesetId: ctx.lastCommittedChangesetId,
      summary: ctx.lastCommitSummary,
      timestamp: new Date().toISOString()
    };

    // 이벤트 발행
    ctx.events.emit('swarmBundle.revisionChanged', event);

    // 다음 Step 블록에 변경 요약 주입
    if (swarmPolicy.changesets?.emitRevisionChangedEvent) {
      ctx.blocks.push({
        type: 'swarmBundle.revisionChanged',
        data: event
      });
    }
  }

  ctx.step.activeSwarmRef = newRef;
  return ctx;
}
```

### 9.4 블록 예시

```json
{
  "type": "swarmBundle.revisionChanged",
  "data": {
    "previousRef": "git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
    "newRef": "git:9b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u",
    "changesetId": "cs-000123",
    "summary": {
      "filesChanged": ["prompts/planner.system.md"],
      "filesAdded": [],
      "filesDeleted": []
    },
    "timestamp": "2026-02-05T10:30:00.000Z"
  }
}
```

---

## 10. Changeset 실패 시 이벤트 로그 기록

### 10.1 규칙

Changeset commit 실패 또는 거부 여부는 tool 결과로 충분히 관측 가능해야 한다(MUST). 별도의 status log 파일은 요구하지 않지만, Instance event log에 기록하는 것을 권장한다(SHOULD).

### 10.2 이벤트 로그 형식

```typescript
interface ChangesetEventRecord {
  type: 'agent.event';
  kind: 'changeset.committed' | 'changeset.rejected' | 'changeset.failed';
  recordedAt: string;  // ISO8601 timestamp
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId?: string;
  stepId?: string;
  stepIndex?: number;
  data: {
    changesetId: string;
    baseRef: SwarmBundleRef;
    newRef?: SwarmBundleRef;
    status: 'ok' | 'rejected' | 'failed';
    summary?: CommitSummary;
    error?: CommitError;
  };
}
```

### 10.3 이벤트 로그 예시 (성공)

```json
{
  "type": "agent.event",
  "kind": "changeset.committed",
  "recordedAt": "2026-02-05T10:30:00.000Z",
  "instanceId": "default-cli",
  "instanceKey": "cli",
  "agentName": "planner",
  "turnId": "turn-abc",
  "stepId": "step-xyz",
  "stepIndex": 3,
  "data": {
    "changesetId": "cs-000123",
    "baseRef": "git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
    "newRef": "git:9b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u",
    "status": "ok",
    "summary": {
      "filesChanged": ["prompts/planner.system.md"],
      "filesAdded": [],
      "filesDeleted": []
    }
  }
}
```

### 10.4 이벤트 로그 예시 (거부)

```json
{
  "type": "agent.event",
  "kind": "changeset.rejected",
  "recordedAt": "2026-02-05T10:30:00.000Z",
  "instanceId": "default-cli",
  "instanceKey": "cli",
  "agentName": "planner",
  "turnId": "turn-abc",
  "stepId": "step-xyz",
  "stepIndex": 3,
  "data": {
    "changesetId": "cs-000123",
    "baseRef": "git:3d2a1b4c5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
    "status": "rejected",
    "error": {
      "code": "POLICY_VIOLATION",
      "message": "ChangesetPolicy에 의해 허용되지 않은 파일이 변경되었습니다.",
      "violatedFiles": ["goondan.yaml"]
    }
  }
}
```

### 10.5 Step 진행 정책

Changeset commit 실패 시 Step 자체는 계속 진행하는 정책을 권장한다(SHOULD). fail-fast는 구현 선택이다.

---

## 11. TypeScript 인터페이스

### 11.1 전체 타입 정의

```typescript
// ============================================================
// SwarmBundleRef
// ============================================================

/**
 * SwarmBundleRef는 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자이다.
 */
type SwarmBundleRef = string;

// ============================================================
// OpenChangeset
// ============================================================

interface OpenChangesetInput {
  reason?: string;
}

interface OpenChangesetResult {
  changesetId: string;
  baseRef: SwarmBundleRef;
  workdir: string;
  hint?: OpenChangesetHint;
}

interface OpenChangesetHint {
  bundleRootInWorkdir: string;
  recommendedFiles: string[];
}

// ============================================================
// CommitChangeset
// ============================================================

interface CommitChangesetInput {
  changesetId: string;
  message?: string;
}

interface CommitChangesetResult {
  status: 'ok' | 'rejected' | 'failed';
  changesetId: string;
  baseRef: SwarmBundleRef;
  newRef?: SwarmBundleRef;
  summary?: CommitSummary;
  error?: CommitError;
}

interface CommitSummary {
  filesChanged: string[];
  filesAdded: string[];
  filesDeleted: string[];
}

interface CommitError {
  code: string;
  message: string;
  violatedFiles?: string[];
}

// ============================================================
// ChangesetPolicy
// ============================================================

interface ChangesetPolicy {
  enabled?: boolean;
  applyAt?: string[];
  allowed?: {
    files?: string[];
  };
  emitRevisionChangedEvent?: boolean;
}

// ============================================================
// SwarmBundleManager
// ============================================================

interface SwarmBundleManager {
  getActiveRef(): Promise<SwarmBundleRef>;
  openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult>;
  commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult>;
  discardChangeset(changesetId: string): Promise<void>;
}

// ============================================================
// SwarmBundleApi (Extension/Tool 컨텍스트용)
// ============================================================

interface SwarmBundleApi {
  openChangeset: (input?: OpenChangesetInput) => Promise<OpenChangesetResult>;
  commitChangeset: (input: CommitChangesetInput) => Promise<CommitChangesetResult>;
}

// ============================================================
// Events
// ============================================================

interface RevisionChangedEvent {
  type: 'swarmBundle.revisionChanged';
  previousRef: SwarmBundleRef;
  newRef: SwarmBundleRef;
  changesetId: string;
  summary: CommitSummary;
  timestamp: string;
}

interface ChangesetEventRecord {
  type: 'agent.event';
  kind: 'changeset.committed' | 'changeset.rejected' | 'changeset.failed';
  recordedAt: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId?: string;
  stepId?: string;
  stepIndex?: number;
  data: {
    changesetId: string;
    baseRef: SwarmBundleRef;
    newRef?: SwarmBundleRef;
    status: 'ok' | 'rejected' | 'failed';
    summary?: CommitSummary;
    error?: CommitError;
  };
}
```

---

## 12. 구현 알고리즘

### 12.1 openChangeset 알고리즘

```typescript
async function openChangeset(
  swarmBundleRoot: string,
  goondanHome: string,
  workspaceId: string,
  input?: OpenChangesetInput
): Promise<OpenChangesetResult> {
  // 1. changesetId 생성
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const changesetId = `cs-${timestamp}-${randomSuffix}`;

  // 2. worktree 경로 결정
  const workdir = path.join(
    goondanHome,
    'worktrees',
    workspaceId,
    'changesets',
    changesetId
  );

  // 3. worktree 부모 디렉터리 생성
  await fs.mkdir(path.dirname(workdir), { recursive: true });

  // 4. 현재 HEAD의 commit SHA 조회
  const headSha = await execGit(swarmBundleRoot, ['rev-parse', 'HEAD']);
  const baseRef: SwarmBundleRef = `git:${headSha.trim()}`;

  // 5. Git worktree 생성
  await execGit(swarmBundleRoot, ['worktree', 'add', workdir, 'HEAD']);

  // 6. 힌트 생성
  const hint: OpenChangesetHint = {
    bundleRootInWorkdir: '.',
    recommendedFiles: [
      'goondan.yaml',
      'resources/**',
      'prompts/**',
      'tools/**',
      'extensions/**'
    ]
  };

  // 7. 결과 반환
  return {
    changesetId,
    baseRef,
    workdir,
    hint
  };
}
```

### 12.2 commitChangeset 알고리즘

```typescript
async function commitChangeset(
  swarmBundleRoot: string,
  goondanHome: string,
  workspaceId: string,
  swarmPolicy: ChangesetPolicy | undefined,
  agentPolicy: ChangesetPolicy | undefined,
  input: CommitChangesetInput
): Promise<CommitChangesetResult> {
  const { changesetId, message } = input;

  // 1. worktree 경로 결정
  const workdir = path.join(
    goondanHome,
    'worktrees',
    workspaceId,
    'changesets',
    changesetId
  );

  // 2. worktree 존재 확인
  if (!await fs.pathExists(workdir)) {
    return {
      status: 'failed',
      changesetId,
      baseRef: 'unknown',
      error: {
        code: 'CHANGESET_NOT_FOUND',
        message: `Changeset ${changesetId}를 찾을 수 없습니다.`
      }
    };
  }

  // 3. baseRef 조회
  const baseRefOutput = await execGit(workdir, ['rev-parse', 'HEAD~1']);
  const baseRef: SwarmBundleRef = `git:${baseRefOutput.trim()}`;

  // 4. 변경된 파일 목록 조회
  const statusOutput = await execGit(workdir, ['status', '--porcelain']);
  const changedFiles = parseGitStatus(statusOutput);

  // 5. 변경 사항이 없으면 early return
  if (changedFiles.length === 0) {
    return {
      status: 'ok',
      changesetId,
      baseRef,
      newRef: baseRef,
      summary: {
        filesChanged: [],
        filesAdded: [],
        filesDeleted: []
      }
    };
  }

  // 6. ChangesetPolicy 검증
  const validation = validateChangesetPolicy(
    changedFiles.map(f => f.path),
    swarmPolicy,
    agentPolicy
  );

  if (!validation.valid) {
    return {
      status: 'rejected',
      changesetId,
      baseRef,
      error: {
        code: 'POLICY_VIOLATION',
        message: 'ChangesetPolicy에 의해 허용되지 않은 파일이 변경되었습니다.',
        violatedFiles: validation.violatedFiles
      }
    };
  }

  // 7. Git 작업 수행
  try {
    // 7.1. 모든 변경 사항 스테이징
    await execGit(workdir, ['add', '-A']);

    // 7.2. 커밋 생성
    const commitMessage = message || `Changeset ${changesetId}`;
    await execGit(workdir, ['commit', '-m', commitMessage]);

    // 7.3. 새 commit SHA 조회
    const newSha = await execGit(workdir, ['rev-parse', 'HEAD']);
    const newRef: SwarmBundleRef = `git:${newSha.trim()}`;

    // 7.4. SwarmBundleRoot로 변경 사항 반영
    const branchName = `changeset-${changesetId}`;
    await execGit(swarmBundleRoot, ['fetch', workdir, `HEAD:${branchName}`]);
    await execGit(swarmBundleRoot, ['merge', '--ff-only', branchName]);

    // 7.5. 정리
    await execGit(swarmBundleRoot, ['worktree', 'remove', workdir]);
    await execGit(swarmBundleRoot, ['branch', '-d', branchName]);

    // 8. 성공 결과 반환
    return {
      status: 'ok',
      changesetId,
      baseRef,
      newRef,
      summary: categorizeChangedFiles(changedFiles)
    };

  } catch (error) {
    return {
      status: 'failed',
      changesetId,
      baseRef,
      error: {
        code: 'GIT_ERROR',
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// Git status 출력 파싱
interface GitStatusEntry {
  status: 'A' | 'M' | 'D' | 'R' | '?';
  path: string;
}

function parseGitStatus(output: string): GitStatusEntry[] {
  return output
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const status = line.substring(0, 2).trim() as GitStatusEntry['status'];
      const path = line.substring(3);
      return { status, path };
    });
}

// 변경 파일 분류
function categorizeChangedFiles(entries: GitStatusEntry[]): CommitSummary {
  const filesAdded: string[] = [];
  const filesChanged: string[] = [];
  const filesDeleted: string[] = [];

  for (const entry of entries) {
    switch (entry.status) {
      case 'A':
      case '?':
        filesAdded.push(entry.path);
        break;
      case 'M':
      case 'R':
        filesChanged.push(entry.path);
        break;
      case 'D':
        filesDeleted.push(entry.path);
        break;
    }
  }

  return { filesChanged, filesAdded, filesDeleted };
}
```

### 12.3 Safe Point 활성화 알고리즘

```typescript
interface StepContext {
  step: {
    id: string;
    index: number;
    activeSwarmRef?: SwarmBundleRef;
  };
  previousActiveSwarmRef?: SwarmBundleRef;
  effectiveConfig?: EffectiveConfig;
  blocks: Block[];
  events: EventBus;
  lastCommittedChangesetId?: string;
  lastCommitSummary?: CommitSummary;
}

async function executeStepConfig(
  ctx: StepContext,
  swarmBundleManager: SwarmBundleManager,
  swarmPolicy: ChangesetPolicy | undefined
): Promise<StepContext> {
  // 1. 이전 activeSwarmRef 저장
  ctx.previousActiveSwarmRef = ctx.step.activeSwarmRef;

  // 2. 현재 활성 Ref 조회
  const newRef = await swarmBundleManager.getActiveRef();

  // 3. revision 변경 감지
  if (ctx.previousActiveSwarmRef && ctx.previousActiveSwarmRef !== newRef) {
    const event: RevisionChangedEvent = {
      type: 'swarmBundle.revisionChanged',
      previousRef: ctx.previousActiveSwarmRef,
      newRef,
      changesetId: ctx.lastCommittedChangesetId || 'unknown',
      summary: ctx.lastCommitSummary || {
        filesChanged: [],
        filesAdded: [],
        filesDeleted: []
      },
      timestamp: new Date().toISOString()
    };

    // 이벤트 발행
    ctx.events.emit('swarmBundle.revisionChanged', event);

    // emitRevisionChangedEvent가 true면 블록에 주입
    if (swarmPolicy?.emitRevisionChangedEvent) {
      ctx.blocks.push({
        type: 'swarmBundle.revisionChanged',
        data: event
      });
    }
  }

  // 4. activeSwarmRef 확정
  ctx.step.activeSwarmRef = newRef;

  // 5. Effective Config 로드
  ctx.effectiveConfig = await loadEffectiveConfig(newRef);

  // 6. 컨텍스트 반환
  return ctx;
}
```

---

## 참고 문서

- @docs/requirements/05_core-concepts.md - SwarmBundle, Changeset, SwarmBundleRef 정의
- @docs/requirements/06_config-spec.md - Changeset Open/Commit 규격
- @docs/requirements/07_config-resources.md - ChangesetPolicy (Swarm/Agent)
- @docs/requirements/09_runtime-model.md - Changeset 적용 의미론
- @docs/requirements/10_workspace-model.md - 워크스페이스 레이아웃
- @docs/specs/api.md - Runtime/SDK API 스펙
- @docs/specs/bundle.md - Bundle YAML 스펙
