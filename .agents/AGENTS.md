# .agents

에이전트 로컬 운영 자산(스킬 등)을 보관하는 루트 폴더입니다.

## 구조
- `.agents/skills/` : SKILL.md 기반 스킬 번들 저장소

## 규칙
1. 스킬은 `.agents/skills/<skill-name>/SKILL.md` 구조를 따른다.
2. 스킬 디렉터리 규칙은 `.agents/skills/AGENTS.md`를 따른다.
3. 호환을 위해 `.claude/skills`는 `.agents/skills`를 가리키는 심볼릭 링크로 유지한다.
4. `codex-cli-subagent` 기본 실행 프리셋은 `gpt-5.3-codex` + `model_reasoning_effort=xhigh`를 사용한다.
