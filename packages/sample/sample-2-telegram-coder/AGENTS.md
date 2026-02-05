# Sample 2: Telegram Coder Agent Swarm

## 개요

Telegram 봇을 통한 원격 코딩 에이전트 스웜 샘플입니다. Goondan의 Connector 시스템을 활용하여 Telegram 메시지를 수신하고 멀티 에이전트 스웜으로 코딩 작업을 수행합니다.

## 디렉토리 구조

```
sample-2-telegram-coder/
├── goondan.yaml          # Bundle 정의
├── prompts/              # 에이전트 시스템 프롬프트
│   ├── planner.system.md
│   ├── coder.system.md
│   └── reviewer.system.md
├── connectors/           # Connector 구현
│   └── telegram/
│       └── index.ts      # Telegram TriggerHandler
├── package.json
├── README.md
└── AGENTS.md             # 이 파일
```

## 핵심 컴포넌트

### goondan.yaml

Bundle 정의 파일로 다음 리소스를 포함합니다:

- **Model**: claude-sonnet-4-5 모델 정의
- **Agent**: planner, coder, reviewer 3개의 에이전트
- **Tool**: delegateToAgent, fileRead, fileWrite, bash 도구
- **Swarm**: coding-swarm 스웜 정의
- **Connector**: telegram Connector (Static Token 인증)

### connectors/telegram/index.ts

Telegram TriggerHandler 구현:

- `onTelegramUpdate`: Telegram Update 이벤트 처리
- `sendTelegramMessage`: 메시지 전송 헬퍼
- `editTelegramMessage`: 메시지 수정 헬퍼

## Connector 스펙 준수 사항

### 인증 (auth)

Static Token 기반 모드 사용:

```yaml
auth:
  staticToken:
    valueFrom:
      env: "TELEGRAM_BOT_TOKEN"
```

### Ingress 규칙

1. `/start` 명령어 매칭 - planner 에이전트로 라우팅
2. `/code` 명령어 매칭 - planner 에이전트로 라우팅
3. 기본 라우팅 - 명령어 없는 일반 메시지

```yaml
ingress:
  - match:
      command: "/start"
    route:
      swarmRef: { kind: Swarm, name: coding-swarm }
      instanceKeyFrom: "$.message.chat.id"
      inputFrom: "$.message.text"
```

### Egress 설정

```yaml
egress:
  updatePolicy:
    mode: updateInThread
    debounceMs: 1500
```

### Trigger Handler

```yaml
triggers:
  - handler: onTelegramUpdate
```

## 개발 규칙

1. **타입 안전성**: 타입 단언(`as`) 대신 타입 가드 사용
2. **스펙 준수**: connector.md의 MUST/SHOULD 규칙 준수
3. **CanonicalEvent**: 모든 외부 이벤트는 CanonicalEvent로 변환하여 ctx.emit()

## 참고 문서

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/packages/core/src/connector/` - Connector 코어 구현
