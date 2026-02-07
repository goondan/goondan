# .agents/skills

저장소 로컬 스킬 번들을 보관하는 폴더입니다. 이 폴더의 하위 스킬은 런타임 Skill Extension에서 탐색 가능한 형태(`SKILL.md`)를 기준으로 관리합니다.

## 목적
- Codex/Claude 등 에이전트가 반복 작업을 안정적으로 수행할 수 있도록 재사용 가능한 절차를 제공합니다.
- 기본 원칙은 `SKILL.md` 단일 파일 중심의 최소 구성입니다.

## 구조 규칙
- 각 스킬 폴더는 반드시 `SKILL.md`를 포함해야 합니다.
- `SKILL.md` frontmatter는 `name`, `description`만 사용합니다.
- 선택 리소스는 꼭 필요한 경우에만 추가합니다.
  - `agents/openai.yaml`
  - `scripts/`
  - `references/`
  - `assets/`

## 수정 규칙
1. 스킬 추가/수정 후 `python3 /Users/channy/.codex/skills/.system/skill-creator/scripts/quick_validate.py <skill-dir>`로 검증합니다.
2. 실행 스크립트를 추가하면 최소 1회는 실제 실행(또는 dry-run 경로)으로 동작을 확인합니다.
3. 스킬 동작/경로 규칙이 바뀌면 `.agents/AGENTS.md`와 루트 `AGENTS.md`를 함께 최신화합니다.
4. `.claude/skills`는 `.agents/skills`를 가리키는 심볼릭 링크로 유지합니다.
