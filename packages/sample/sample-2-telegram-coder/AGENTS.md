# Sample 2: Telegram Coder Agent Swarm

## 개요

Telegram 봇을 통한 원격 코딩 에이전트 스웜 샘플입니다. **@goondan/base** 패키지의 telegram connector를 사용하여 Telegram 메시지를 수신하고 멀티 에이전트 스웜으로 코딩 작업을 수행합니다.

## 디렉토리 구조

```
sample-2-telegram-coder/
├── goondan.yaml          # Package + Bundle 정의 (@goondan/base 의존성)
├── prompts/              # 에이전트 시스템 프롬프트
│   ├── planner.system.md
│   ├── coder.system.md
│   └── reviewer.system.md
├── tools/                # 로컬 Tool 구현
│   ├── delegate/         # delegate.to-agent 도구
│   ├── file-read/        # file.read 도구
│   └── file-write/       # file.write 도구
├── .goondan/             # 설치된 패키지 (symlink)
│   └── packages/
│       └── @goondan/base -> ~/.goondan/bundles/@goondan/base/0.0.1
├── package.json
├── README.md
└── AGENTS.md             # 이 파일
```

## 핵심 컴포넌트

### goondan.yaml (Package 섹션)

Package 정의:

```yaml
spec:
  dependencies:
    - "@goondan/base@0.0.1"  # telegram connector 포함
```

### goondan.yaml (Bundle 섹션)

Bundle 정의로 다음 리소스를 포함합니다:

- **Model**: claude-sonnet-4-5 모델 정의
- **Agent**: planner, coder, reviewer 3개의 에이전트
- **Tool**:
  - `delegate-to-agent`: 다른 에이전트에게 작업 위임 (로컬 정의)
  - `file-read`: 파일 읽기 (로컬 정의)
  - `file-write`: 파일 쓰기 (로컬 정의)
  - `bash`: bash 명령어 실행 (**@goondan/base에서 자동 로드**)
- **Swarm**: coding-swarm 스웜 정의
- **Connector**: 로컬 정의 없이 `@goondan/base`의 `Connector/telegram` 참조
- **Connection**: telegram-to-coding-swarm (Connector와 Swarm 간 배포 바인딩, swarmRef/auth/ingress 설정)

## @goondan/base 패키지 사용

### 의존성 설치

```bash
gdn package install
```

### Connection 설정 (v1.0)

v1.0에서 Connector와 Connection은 분리됩니다. Connector는 프로토콜 수신과 이벤트 스키마를 선언하고, Connection에서 auth/ingress를 설정합니다:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: telegram-to-coding-swarm
spec:
  connectorRef: { kind: Connector, name: telegram, package: "@goondan/base" }
  swarmRef: { kind: Swarm, name: coding-swarm }
  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"
  ingress:
    rules:
      - match:
          event: telegram.message
        route:
          agentRef: { kind: Agent, name: planner }
      - route: {}
```

> **주의**: v1.0에서 Connection의 route에는 `agentRef`만 허용됩니다 (선택적). `swarmRef`, `instanceKeyFrom`, `inputFrom`은 삭제되었습니다. match.event 값은 Connector의 events[].name과 일치해야 합니다.

## Ingress 규칙

1. `telegram.message` 이벤트 매칭 - planner 에이전트로 라우팅
2. catch-all 라우팅 - entrypoint로 라우팅

## 개발 규칙

1. **패키지 의존성**: @goondan/base 패키지의 리소스 활용
2. **오버라이드**: 필요한 설정만 오버라이드하여 재사용성 극대화
3. **스펙 준수**: connector.md, bundle_package.md 규칙 준수

## 참고 문서

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/connection.md` - Connection 시스템 스펙
- `/docs/specs/bundle_package.md` - Package 스펙
- `/packages/base/` - @goondan/base 패키지
