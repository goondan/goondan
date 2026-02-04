## 14. Skill 패턴(Extension 기반 구현)

Skill은 SKILL.md 중심 번들로서 다음 기능을 통해 활용된다.

1. 스킬 카탈로그(메타) 제공
2. 선택 시 SKILL.md 전문과 경로 정보 제공
3. bash로 스크립트 실행

이 기능은 Extension으로 구현될 수 있으며 다음 포인트를 활용한다.

* `workspace.repoAvailable`: 스킬 디렉터리 스캔/인덱스 갱신
* `step.blocks`: 카탈로그/열린 스킬 본문 주입
* `skills.list`, `skills.open`: 스킬 목록/전문 로딩 tool 제공
