# packages/runtime/src/runner

`runner`는 Goondan 런타임의 실행 엔트리와 connector child 프로세스 경계를 담당한다.

## 존재 이유

- 번들 해석 결과를 실제 실행 루프로 연결하고 프로세스 생명주기를 관리한다.
- Connector 연동 경로를 런타임 코어와 분리해 장애 격리를 보장한다.

## 구조적 결정

1. runner는 실행 조립(composition) 계층으로 유지한다.
이유: 정책 로직과 실행 오케스트레이션 경계를 분리하기 위해.
2. 재기동은 replacement runner 전략을 사용한다.
이유: 포트 충돌/중단 시간을 줄이면서 안전한 전환을 보장하기 위해.
3. inbound 컨텍스트는 구조화 메타데이터로 보존한다.
이유: 후속 관측(Studio/로그)에서 발신 맥락을 복원 가능하게 하기 위해.

## 불변 규칙

- provider 전용 메시지 정책은 runner 코어가 아니라 Extension 계층에서 처리한다.
- Tool/감시 기반 재기동 신호 해석은 일관된 계약을 유지한다.
- 타입 단언(`as`, `as unknown as`) 없이 타입 가드로 처리한다.

## 참조

- `packages/runtime/AGENTS.md`
- `docs/specs/runtime.md`
- `docs/specs/connection.md`
- `docs/specs/pipeline.md`
