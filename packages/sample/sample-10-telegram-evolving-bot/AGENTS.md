# sample-10-telegram-evolving-bot

Telegram polling 기반 self-evolving bot 샘플 패키지다.

## 책임 범위

- Telegram `getUpdates` long polling으로 텍스트 메시지를 수신한다.
- Connector는 polling + ConnectorEvent emit만 수행한다.
- 실제 응답 생성(LLM 호출), ingress 라우팅, Tool 실행, Telegram 응답 전송은 `gdn run`의 runtime-runner가 담당한다.
- `/evolve`는 Agent가 `local-file-system__evolve` Tool을 호출해 안전 경로 내 파일 변경 제안/적용을 수행한다.
- 적용 전/후 검증과 롤백 흐름을 제공하고 성공 시 runtime replacement restart 신호를 반환한다.

## 파일 구성

- `src/connector-entry.ts`: Connector 본체 - polling 루프 + ConnectorEvent emit (runtime connector entry)
- `src/telegram.ts`: Telegram API 호출/업데이트 파싱
- `src/evolve.ts`: evolution 계획 파싱, 경로 검증, 변경 적용/롤백
- `src/local-tools.ts`: 로컬 파일 Tool (`write`, `remove`, `evolve`) + 재시작 신호(`restartRequested`) 반환
- `src/state.ts`: polling offset 상태 저장 (`.telegram-evolving-bot-state.json`은 offset만 유지)
- `src/types.ts`: ConnectorContext/ConnectorEvent/ConnectorEventMessage를 `@goondan/types`에서 re-export + 로컬 유틸
- `test/evolve.test.ts`, `test/local-tools.test.ts`: 파서/경로 제한/롤백 + 재시작 신호 테스트

## 아키텍처 구분

### Runtime 모드 (gdn run)
- runtime-runner가 Connector entry를 실행
- Connector는 polling + emit만 수행
- runtime-runner가 ingress 매칭 -> Agent 실행 -> Tool 실행 -> Telegram 응답 전송을 처리
- evolve 신호를 감지하면 replacement orchestrator를 기동하고 active pid를 갱신한 뒤 self-shutdown 한다

## 구현 규칙

1. 수정 가능한 경로는 샘플 루트 내 허용 목록(`goondan.yaml`, `src/**/*.ts`, `test/**/*.ts`, `prompts/**/*.md`, `package.json`, `tsconfig.json`, `README.md`, `AGENTS.md`)으로 제한한다.
2. `evolve` 적용 시 변경 전/후 검증을 수행하고, 실패 시 즉시 롤백하며, 성공 시 재시작 신호를 반환해야 한다.
3. Connector 타입(ConnectorContext, ConnectorEvent, ConnectorEventMessage)은 `@goondan/types`에서 SSOT로 관리하며, 로컬 중복 정의를 금지한다.
4. goondan.yaml Connector events의 properties 키와 connector-entry.ts의 emit properties 키가 반드시 일치해야 한다.
5. 테스트는 핵심 파서/적용 로직을 우선 검증한다.
