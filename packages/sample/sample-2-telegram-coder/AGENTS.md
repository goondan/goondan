# Sample 2: Telegram Coder Agent Swarm

## 개요

Telegram 봇을 통한 원격 코딩 에이전트 스웜 샘플입니다. **@goondan/base** 패키지의 telegram connector를 사용하여 Telegram 메시지를 수신하고 멀티 에이전트 스웜으로 코딩 작업을 수행합니다.

## 디렉토리 구조

```
sample-2-telegram-coder/
├── goondan.yaml          # Bundle 정의
├── package.yaml          # Bundle Package 정의 (@goondan/base 의존성)
├── prompts/              # 에이전트 시스템 프롬프트
│   ├── planner.system.md
│   ├── coder.system.md
│   └── reviewer.system.md
├── tools/                # 로컬 Tool 구현
│   ├── delegate/         # delegate.toAgent 도구
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

### package.yaml

Bundle Package 정의 파일:

```yaml
spec:
  dependencies:
    - "@goondan/base@0.0.1"  # telegram connector 포함
```

### goondan.yaml

Bundle 정의 파일로 다음 리소스를 포함합니다:

- **Model**: claude-sonnet-4-5 모델 정의
- **Agent**: planner, coder, reviewer 3개의 에이전트
- **Tool**:
  - `delegate-to-agent`: 다른 에이전트에게 작업 위임 (로컬 정의)
  - `file-read`: 파일 읽기 (로컬 정의)
  - `file-write`: 파일 쓰기 (로컬 정의)
  - `bash`: bash 명령어 실행 (**@goondan/base에서 자동 로드**)
- **Swarm**: coding-swarm 스웜 정의
- **Connector**: telegram (기본 entry는 @goondan/base에서 제공, ingress만 오버라이드)

## @goondan/base 패키지 사용

### 의존성 설치

```bash
gdn package install
```

### Connector 오버라이드

@goondan/base의 telegram connector를 기반으로, `annotations.base`로 상속을 표시하고 ingress/auth만 설정:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: telegram
  annotations:
    base: "@goondan/base"
spec:
  type: telegram
  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"
  ingress:
    - match:
        command: "/start"
      route:
        swarmRef: { kind: Swarm, name: coding-swarm }
        instanceKeyFrom: "$.message.chat.id"
        inputFrom: "$.message.text"
        agentRef: { kind: Agent, name: planner }
```

> **주의**: entry 경로를 직접 하드코딩하지 않는다. `annotations.base`를 통해 패키지 시스템이 자동으로 resolve한다. ingress의 `agentRef`는 ObjectRef 형식을 사용한다 (문자열 `agentName`이 아님).

## Ingress 규칙

1. `/start` 명령어 매칭 - planner 에이전트로 라우팅
2. `/code` 명령어 매칭 - planner 에이전트로 라우팅
3. 기본 라우팅 - 명령어 없는 일반 메시지

## Egress 설정

```yaml
egress:
  updatePolicy:
    mode: updateInThread
    debounceMs: 1500
```

## 개발 규칙

1. **패키지 의존성**: @goondan/base 패키지의 리소스 활용
2. **오버라이드**: 필요한 설정만 오버라이드하여 재사용성 극대화
3. **스펙 준수**: connector.md, bundle_package.md 규칙 준수

## 참고 문서

- `/docs/specs/connector.md` - Connector 시스템 스펙
- `/docs/specs/bundle_package.md` - Bundle Package 스펙
- `/packages/base/` - @goondan/base 패키지
