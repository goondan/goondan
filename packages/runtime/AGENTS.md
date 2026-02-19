# packages/runtime

`@goondan/runtime`은 Orchestrator 실행 모델과 상태 저장, 파이프라인, Tool 실행, 리소스 로딩의 코어를 담당한다.

## 존재 이유

- 선언형 번들을 실제 실행 상태로 변환하고 유지하는 런타임 엔진을 제공한다.
- 메시지 상태와 관측 이벤트를 일관된 모델로 영속화한다.

## 구조적 결정

1. 대화 상태는 event-sourcing(`base/events`) 모델을 사용하고 관측 스트림(`runtime-events`)을 분리한다.
이유: 상태 복원과 관측성 요구를 분리해 신뢰성과 디버깅 성능을 동시에 확보하기 위해.
2. 확장 지점은 turn/step/toolCall 미들웨어 파이프라인으로 통일한다.
이유: 런타임 코어 수정 없이 정책/동작 확장을 가능하게 하기 위해.
3. Bundle 로딩은 로컬 + dependency 패키지 병합 모델을 사용한다.
이유: 패키지 재사용성과 실행 일관성을 유지하기 위해.

## 불변 규칙

- reconcile 루프 기반 desired state 보정 원칙을 유지한다.
- Tool 실행은 catalog 허용 범위와 입력 스키마 검증을 통과한 호출만 허용한다.
- workspace 식별은 인스턴스 키 기반 결정론적 매핑을 유지한다.
- 공개 API는 루트 export 경계에서 관리한다.

## 참조

- `docs/specs/runtime.md`
- `docs/specs/pipeline.md`
- `docs/specs/tool.md`
- `docs/specs/workspace.md`
- `docs/specs/bundle.md`
