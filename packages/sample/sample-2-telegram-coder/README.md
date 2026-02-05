# Sample 2: Telegram Coder Agent Swarm

Telegram 봇을 통한 원격 코딩 에이전트 스웜 샘플입니다.

## 개요

이 샘플은 Goondan의 Connector 시스템을 활용하여 Telegram 봇으로 코딩 작업을 수행하는 멀티 에이전트 스웜을 구현합니다.

## 에이전트 구성

### Planner Agent
- 역할: 작업 계획 및 조율
- 사용자 요청을 분석하고 적절한 에이전트에게 위임

### Coder Agent
- 역할: 코드 작성 및 수정
- 파일 읽기/쓰기, Bash 명령어 실행

### Reviewer Agent
- 역할: 코드 리뷰 및 품질 검토
- 코드 품질, 보안, 성능 검토

## Telegram Connector

### 인증
- `TELEGRAM_BOT_TOKEN` 환경변수에서 Bot Token을 가져옵니다.

### 지원 명령어
- `/start` - 봇 시작 및 안내
- `/code` - 코딩 작업 시작
- 일반 메시지 - 대화 형식으로 작업 요청

### Egress 설정
- `updateInThread` 모드로 동일 대화에 응답
- 1.5초 디바운스로 빈번한 업데이트 방지

## 설정

### 1. Telegram Bot 생성

1. Telegram에서 [@BotFather](https://t.me/botfather)와 대화
2. `/newbot` 명령으로 봇 생성
3. Bot Token 복사

### 2. 환경 변수 설정

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token-here"
```

### 3. Webhook 설정 (선택)

```bash
# Webhook URL 설정
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/webhook/telegram"}'
```

## 실행

```bash
# 의존성 설치
pnpm install

# 개발 모드 실행
pnpm dev

# 프로덕션 실행
pnpm start
```

## 디렉토리 구조

```
sample-2-telegram-coder/
├── goondan.yaml          # Bundle 정의 (Connector, Agent, Swarm)
├── prompts/
│   ├── planner.system.md # Planner 에이전트 시스템 프롬프트
│   ├── coder.system.md   # Coder 에이전트 시스템 프롬프트
│   └── reviewer.system.md # Reviewer 에이전트 시스템 프롬프트
├── connectors/
│   └── telegram/
│       └── index.ts      # Telegram Connector TriggerHandler 구현
├── package.json
└── README.md
```

## 사용 예시

### 파일 생성 요청

```
사용자: /code hello.ts 파일을 만들어줘. "Hello, World!"를 출력하는 TypeScript 코드.

봇: 작업을 시작합니다.

[Planner] 코드 작성 작업을 Coder 에이전트에게 위임합니다.
[Coder] hello.ts 파일을 생성했습니다.

// hello.ts
console.log("Hello, World!");

작업이 완료되었습니다.
```

### 코드 리뷰 요청

```
사용자: hello.ts 파일을 리뷰해줘.

봇: 작업을 시작합니다.

[Planner] 코드 리뷰 작업을 Reviewer 에이전트에게 위임합니다.
[Reviewer] 코드 리뷰 결과:

### 요약
간단하고 명확한 Hello World 코드입니다.

### 장점
- 코드가 간결하고 목적이 명확함

### 개선점
- 없음 (단순 예제 코드)

### 점수: 8/10

리뷰가 완료되었습니다.
```

## 참고 문서

- [Connector 스펙](/docs/specs/connector.md)
- [Bundle 스펙](/docs/specs/bundle.md)
- [Telegram Bot API](https://core.telegram.org/bots/api)
