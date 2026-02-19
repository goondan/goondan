# samples/brain-persona/extensions

이 디렉터리는 brain-persona 샘플의 로컬 Extension 실험 경계를 담당한다.

## 존재 이유

- 런타임 코어 수정 없이 샘플 전용 정책/컨텍스트 주입 실험을 수행한다.
- coordinator 중심 대화 정책을 미들웨어로 검증한다.

## 구조적 결정

1. 확장 포인트는 `Agent.spec.extensions` 순서를 기준으로 동작시킨다.
이유: 샘플 정책의 실행 순서를 명시적으로 통제하기 위해.
2. 샘플 Extension은 런타임 내부 구현이 아니라 공개 컨텍스트/API에 의존한다.
이유: 코어 변경에 대한 취약 결합을 피하기 위해.

## 불변 규칙

- 엔트리 계약(`register(api)`)을 유지한다.
- 메시지 주입 시 출처 메타데이터를 남겨 추적 가능성을 유지한다.
- Extension 변경 시 샘플 번들/README/상위 AGENTS를 함께 동기화한다.

## 참조

- `docs/specs/extension.md`
- `samples/brain-persona/AGENTS.md`
- `samples/brain-persona/goondan.yaml`
