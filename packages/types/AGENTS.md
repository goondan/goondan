# packages/types

`@goondan/types`는 Goondan 전 계층이 공유하는 타입 계약의 SSOT 구현을 담당한다.

## 존재 이유

- 런타임, CLI, Studio, 기본 패키지가 동일한 타입 모델을 공유하도록 보장한다.
- 리소스/이벤트/메시지/관측성 관련 계약 드리프트를 방지한다.

## 구조적 결정

1. 타입 계약의 소유권은 `docs/specs/shared-types.md`와 `docs/specs/resources.md`에 맞춘다.
이유: 계약 변경의 출처를 명확히 고정하기 위해.
2. 공통 계약은 이 패키지에 집중하고 다른 패키지는 참조만 한다.
이유: 중복 정의로 인한 해석 차이를 제거하기 위해.
3. RuntimeEvent 타입 계약은 이 패키지가 소유한다 (runtime은 re-export만).
이유: Studio/CLI가 runtime 내부 타입에 의존하지 않고 계약 수준에서만 결합하도록.
4. 에이전트 통신 API 계약(AgentToolRuntime, MiddlewareAgentsApi)은 이 패키지에서 단일 정의한다.
이유: pipeline.md와 tool.md 간 계약 불일치를 원천 차단하기 위해.

## 불변 규칙

- ObjectRef 형식은 `Kind/name` 규칙을 유지한다.
- ValueSource 해석은 `value`, `valueFrom.env`, `valueFrom.secretRef` 의미를 보존한다.
- 메시지 상태 계산은 `NextMessages = BaseMessages + SUM(Events)` 모델을 유지한다.
- TraceContext의 traceId는 인터-에이전트 호출 시에도 재생성하지 않는다 (end-to-end 추적 보장).
- 타입 단언(`as`, `as unknown as`) 없이 타입 가드/정확한 타입 정의로 유지한다.

## 참조

- `docs/specs/shared-types.md`
- `docs/specs/resources.md`
- `docs/specs/api.md`
- `docs/specs/help.md`
