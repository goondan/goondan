# sample-10-telegram-evolving-bot

Telegram polling 기반 self-evolving bot 샘플 패키지다.

## 책임 범위

- Telegram `getUpdates` long polling으로 텍스트 메시지를 수신한다.
- 기본 대화는 Anthropic Claude Sonnet 4.5 모델 호출로 처리한다.
- `/evolve` 명령으로 안전 경로 내 파일 변경 제안/적용을 수행한다.
- 적용 전/후 검증, 백업, 롤백 흐름을 제공한다.

## 파일 구성

- `src/connector-entry.ts`: polling 루프, 대화 처리, `/evolve` 플로우 진입점 (runtime connector 기본 엔트리)
- `src/main.ts`: standalone 실행용 얇은 래퍼 (connector-entry 호출)
- `src/telegram.ts`: Telegram API 호출/업데이트 파싱
- `src/anthropic.ts`: Anthropic Messages API 호출
- `src/evolve.ts`: 명령 파서, 경로 검증, 변경 적용/롤백
- `src/config.ts`: 환경 변수/경로 설정 로더
- `src/state.ts`: offset + 대화 히스토리 상태 저장
- `test/anthropic.test.ts`: Anthropic 요청 payload/응답 파싱 검증
- `test/evolve.test.ts`: 핵심 파서/경로 제한/롤백 테스트

## 구현 규칙

1. 수정 가능한 경로는 샘플 루트 내 허용 목록(`goondan.yaml`, `src/**/*.ts`, `test/**/*.ts`, `package.json`, `tsconfig.json`, `README.md`, `AGENTS.md`)으로 제한한다.
2. `/evolve` 적용 시 기존 파일은 백업 디렉토리에 저장하고 실패 시 즉시 롤백한다.
3. 환경 변수(`TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`) 없이는 기동하지 않는다.
4. 테스트는 핵심 파서/적용 로직을 우선 검증한다.
