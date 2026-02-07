---
name: codex-subagent
description: codex를 bash에서 서브에이전트처럼 호출해야 할 때 사용한다. 하위 구현/리뷰 작업을 codex 에게 위임하고 결과 파일로 회수할 때 이 스킬을 사용한다. 당신이 Claude일 경우 이 스킬을 사용하여 codex를 높은 지능을 가진 지성체로 취급, 고난도의 논리가 필요한 것을 물어보거나 작업하게 시킬 수 있다.
---

# Codex CLI Subagent

## 사용법
1. 하위 작업 프롬프트 파일을 만든다.
2. `codex exec`로 비대화형 실행한다.
3. 산출물 파일을 읽어 상위 작업에 병합한다.

## 기본 프리셋
- 기본 모델: `gpt-5.3-codex`
- 기본 reasoning effort: `xhigh`
- CLI 설정 키: `-c 'model_reasoning_effort="xhigh"'`

### 1) 프롬프트 파일 예시
```md
# Context
- Repo: /path/to/repo
- Files: src/a.ts, src/b.ts

# Task
Fix only the targeted bug.

# Constraints
- Do not touch unrelated files.
- Keep API unchanged.

# Validation Commands
- pnpm -r test --filter core
```

### 2) 구현 위임 실행
```bash
codex exec \
  -C /path/to/repo \
  -m gpt-5.3-codex \
  -c 'model_reasoning_effort="xhigh"' \
  --sandbox workspace-write \
  -a never \
  --output-last-message .tmp/subagent-last.md \
  - < .tmp/subagent-task.md
```

### 3) 리뷰 위임 실행
```bash
codex exec review \
  -C /path/to/repo \
  -m gpt-5.3-codex \
  -c 'model_reasoning_effort="xhigh"' \
  --sandbox read-only \
  -a never \
  --output-last-message .tmp/subagent-review.md
```

## 규칙
- 항상 `-C`로 작업 루트를 고정한다.
- 항상 `--output-last-message`로 회수 파일을 고정한다.
- 위험 플래그(`--dangerously-bypass-approvals-and-sandbox`)는 기본 금지한다.
