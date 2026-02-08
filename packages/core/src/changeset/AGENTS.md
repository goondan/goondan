# Changeset 시스템

> @see /docs/specs/changeset.md

이 폴더는 Goondan Changeset 시스템을 구현합니다. Changeset은 LLM이 SwarmBundle(Agent 정의, 프롬프트, 도구 등)을 안전하게 수정할 수 있게 해주는 메커니즘입니다.

## 파일 구조

```
changeset/
├── AGENTS.md       # 이 파일
├── types.ts        # Changeset 관련 타입 정의
├── api.ts          # SwarmBundleApi 생성 함수
├── manager.ts      # SwarmBundleManager 구현
├── policy.ts       # ChangesetPolicy 검증
├── glob.ts         # Glob 패턴 매칭
├── git.ts          # Git 작업 유틸리티
└── index.ts        # 모듈 re-export
```

## 주요 개념

### SwarmBundleRef
- 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자
- Git 기반 구현에서는 `git:<commit-sha>` 형식 사용
- Step 실행 중에는 변경되지 않음 (불변성 보장)

### SwarmBundleManager
- Runtime 내부에서 SwarmBundle 변경을 안전하게 관리하는 컴포넌트
- Changeset 발급, 커밋, 정책 검증, 단일 작성자 규칙 관리
- Canonical Writer: SwarmBundleRoot에 대한 변경은 오직 Manager만 수행

### ChangesetPolicy
- Changeset이 수정할 수 있는 파일 범위를 제한하는 정책
- Swarm 정책: 최대 허용 범위 정의
- Agent 정책: 추가 제약 (더 좁은 범위)
- 파일 변경은 Swarm.allowed AND Agent.allowed 모두 만족해야 허용

### Safe Point
- SwarmBundleRef가 활성화될 수 있는 시점
- 기본: `step.config` (Step 시작 시점)
- Step N에서 commit된 changeset은 Step N+1에서 활성화

## 핵심 워크플로우

```
1. openChangeset()
   - bundleOffset 계산 (git root → SwarmBundleRoot 상대경로)
   - Git worktree 생성 (worktreeDir = goondanHome/worktrees/.../changesetId)
   - workdir = worktreeDir + bundleOffset (모노레포 지원)
   - changesetId, baseRef, workdir 반환

2. LLM이 workdir에서 파일 수정

3. commitChangeset()
   - worktreeDir에서 변경된 파일 감지 (git status)
   - bundleOffset 내 파일만 필터링 & 경로 스트립
   - ChangesetPolicy 검증 (offset 제거된 상대경로)
   - bundleOffset 범위만 스테이징
   - Git commit 생성
   - SwarmBundleRoot에 병합
   - worktree 정리
```

## 모노레포 지원 (bundleOffset)

SwarmBundleRoot가 Git 루트의 하위 디렉터리일 때:
- `bundleOffset`: git root → SwarmBundleRoot 상대경로 (예: "packages/my-swarm")
- `worktreeDir`: git worktree 루트 경로 (전체 monorepo 복사)
- `workdir`: worktreeDir + bundleOffset (tool이 파일을 쓰는 위치)
- commitChangeset은 bundleOffset 하위 변경만 감지/스테이징
- SwarmBundleRoot == git root이면 bundleOffset = "", 기존 동작과 동일

## 구현 규칙

1. **타입 안전성**: `as` 타입 단언 금지
2. **Git 기반**: worktree를 통한 격리된 변경
3. **정책 우선**: 정책 위반 시 거부 (rejected)
4. **단일 작성자**: SwarmBundleRoot 변경은 Manager만 수행
5. **병렬 정본 금지**: Git 외에 별도 상태 파일 금지
6. **bundleOffset**: 모노레포 환경에서 symlink를 resolve하여 정확한 상대경로 계산 (fs.realpath)

## 테스트

테스트 파일들은 `__tests__/changeset/` 폴더에 있습니다:
- `types.test.ts`: 타입 및 유틸리티 함수 테스트
- `glob.test.ts`: Glob 패턴 매칭 테스트
- `policy.test.ts`: ChangesetPolicy 검증 테스트
- `git.test.ts`: Git 작업 테스트
- `manager.test.ts`: SwarmBundleManager 테스트
- `api.test.ts`: SwarmBundleApi 테스트
