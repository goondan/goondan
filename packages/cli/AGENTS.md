# packages/cli

`@goondan/cli`는 Goondan 운영자가 런타임과 패키지 생태계를 제어하는 표준 인터페이스(`gdn`)를 제공한다.

## 존재 이유

- 실행/검증/관측/패키지 유통 워크플로를 단일 진입점으로 통합한다.
- 런타임 운영 절차를 재현 가능하고 자동화 가능한 형태로 고정한다.

## 구조적 결정

1. CLI는 런타임을 관리형 프로세스로 다루고 lifecycle을 명시적으로 제어한다.
이유: 실행 안정성과 장애 복구 절차를 예측 가능하게 만들기 위해.
2. 명령 파싱/라우팅은 타입 안전한 명령 모델을 유지한다.
이유: 명령 확장 시 회귀 위험을 줄이고 오류 표면을 일관화하기 위해.
3. Studio 제공은 CLI의 운영 API와 동일한 상태 소스를 사용한다.
이유: 터미널 출력과 UI 관측 결과의 해석 차이를 줄이기 위해.

## 불변 규칙

- `run`의 인스턴스 식별은 `Swarm.spec.instanceKey ?? Swarm.metadata.name` 규칙을 유지한다.
- `run`/`runtime-runner`는 로컬 `kind: Package` + `metadata.name` 문서를 필수로 요구한다.
- 인스턴스 관리 명령은 managed runtime-runner 기준으로 동작한다.
- 오류 출력은 구조화 정보(`code`, `message`, `suggestion`, `helpUrl`)를 유지한다.
- npm 공개 배포 대상 정책(`publishConfig.access = "public"`)을 유지한다.

## 참조

- `docs/specs/cli.md`
- `docs/specs/runtime.md`
- `docs/specs/bundle_package.md`
- `docs/specs/help.md`
- `packages/runtime/AGENTS.md`
