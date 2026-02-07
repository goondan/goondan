## 14. 활용 예시 패턴

### 14.1 Skill 패턴(Extension 기반)

Skill은 `SKILL.md` 중심 번들을 런타임에 노출하는 Extension 패턴이다.

핵심 동작:

1. 스킬 카탈로그 인덱싱
2. 선택된 스킬 본문 로드
3. 스크립트 실행 연결

권장 파이프라인 포인트:

- `step.tools`: 스킬 관련 도구 노출 제어
- `step.blocks`: 스킬 카탈로그/본문 주입

### 14.2 ToolSearch 패턴

ToolSearch는 LLM이 "다음 Step에서 필요한 도구"를 선택하도록 돕는 메타 도구다.

규칙:

1. 현재 Catalog를 기반으로 검색/요약해야 한다(MUST).
2. 다음 Step부터 노출할 도구 변경은 `step.tools`에서 반영해야 한다(SHOULD).
3. 허용되지 않은 도구를 직접 실행시키는 우회 경로가 되어서는 안 된다(MUST NOT).

### 14.3 컨텍스트 윈도우 최적화 패턴

컨텍스트 윈도우 관리는 Extension 패턴으로 구현한다.

권장 전략:

- sliding window
- turn 요약(compaction)
- 중요 메시지 pinning
- `truncate` + 요약 `llm_message` 재주입

규칙:

1. 메시지 상태는 `base + events` 구조를 유지해야 하며, compaction도 이벤트(`replace`/`remove`/`truncate`)로 표현되어야 한다(MUST).
2. LLM 입력용 축약본은 블록/메시지 형태로 분리해 주입해야 한다(SHOULD).
3. 축약 과정은 traceId 기준으로 추적 가능해야 한다(SHOULD).
4. turn 종료 시 최종 `base + SUM(events)`가 새 base로 커밋되어 다음 turn의 시작점이 되어야 한다(MUST).

### 14.4 Handoff 패턴(도구 호출 기반)

handoff는 도구 호출로 대상 Agent에 작업을 위임하는 패턴이다.

권장 흐름:

1. 원 Agent가 handoff 요청 도구 호출
2. Runtime이 대상 Agent 이벤트 큐에 작업 enqueue
3. 결과를 원 Agent Turn으로 합류(동기 또는 비동기)

규칙:

1. handoff 전후 auth/trace 컨텍스트를 보존해야 한다(MUST).
2. handoff 실패는 구조화된 결과로 반환해야 한다(MUST).
