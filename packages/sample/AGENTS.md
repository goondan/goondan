# packages/sample

`packages/sample`은 Goondan 샘플 패키지 모음을 관리하는 루트다.

## 목적

- 실행 가능한 예제 패키지를 통해 런타임/스펙 사용 패턴을 빠르게 검증한다.
- 각 샘플은 독립 실행 가능해야 하며, 최소한의 설정으로 재현 가능해야 한다.

## 공통 규칙

1. 샘플별 구현은 `sample-*/` 하위로 분리하고, 각 샘플 폴더에 `AGENTS.md`를 둔다.
2. 샘플 코드 수정 시 타입 단언(`as`, `as unknown as`)을 사용하지 않는다.
3. 민감값은 코드에 하드코딩하지 않고 환경 변수로 주입한다.
4. 샘플 패키지는 `build`, `typecheck`, `test` 스크립트를 제공한다.
5. 샘플의 검증 로직은 네트워크 없이도 단위 테스트 가능하도록 분리한다.

## 현재 샘플

- `sample-10-telegram-evolving-bot`: Telegram polling Connector + runtime-runner 기반 Agent 실행(ingress 라우팅/Tool 실행/Telegram 응답) + `/evolve` 적용(검증/백업/롤백 + runtime replacement restart 신호 반환)
