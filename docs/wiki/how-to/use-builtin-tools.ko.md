# How to: 내장 Tool 활용하기

> `@goondan/base`에 포함된 Tool을 에이전트에서 활용하는 방법.

[English version](./use-builtin-tools.md)

---

## 사전 요구사항

- 동작하는 Goondan 프로젝트 (자세한 내용은 [How to: Swarm 실행하기](./run-a-swarm.ko.md) 참고)
- `@goondan/base`가 의존성으로 추가됨

---

## 프로젝트에 `@goondan/base` 추가

프로젝트에 `@goondan/base` 의존성이 아직 없다면 추가합니다:

```bash
gdn package add @goondan/base
```

또는 `goondan.yaml`에 직접 선언할 수 있습니다:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-project
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
```

이후 설치합니다:

```bash
gdn package install
```

---

## Agent에서 내장 Tool 참조하기

Agent에 내장 Tool 접근 권한을 부여하려면 Agent의 `spec.tools` 목록에 `ref` 항목을 추가합니다. 외부 패키지의 Tool이므로 `package` 필드를 포함하는 **객체 ref** 형태를 사용합니다:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompt:
    system: "당신은 유능한 어시스턴트입니다."
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: http-fetch
        package: "@goondan/base"
```

각 Tool 참조는 해당 Tool의 **모든 export**를 등록합니다. 예를 들어 `Tool/bash`를 참조하면 LLM에 `bash__exec`와 `bash__script` 모두 노출됩니다.

> Tool 이름은 **더블 언더스코어 네이밍** 규칙을 따릅니다: `{리소스명}__{export명}`. 자세한 내용은 [Tool 시스템](../explanation/tool-system.ko.md)을 참고하세요.

---

## Tool별 활용 가이드

### bash -- 셸 명령 실행

에이전트 작업 디렉터리에서 셸 명령을 실행합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: bash
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `bash__exec`, `bash__script`

**주요 용도:** 시스템 명령 실행, 스크립트 실행, CLI 도구와 상호작용.

```
에이전트 프롬프트: "프로젝트의 모든 TypeScript 파일을 나열해줘."
Tool 호출:        bash__exec({ command: "find . -name '*.ts'" })
```

> 전체 파라미터 및 반환값은 [레퍼런스: bash](../reference/builtin-tools.ko.md#bash)를 참고하세요.

---

### file-system -- 파일 시스템 작업

에이전트 워크스페이스 내에서 파일 읽기, 쓰기, 목록 조회, 디렉터리 생성을 수행합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: file-system
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `file-system__read`, `file-system__write`, `file-system__list`, `file-system__mkdir`

**주요 용도:** 프로젝트 파일 읽기, 코드/설정 파일 생성, 디렉터리 구조 탐색.

```
에이전트 프롬프트: "package.json의 내용을 읽어줘."
Tool 호출:        file-system__read({ path: "package.json" })
```

```
에이전트 프롬프트: "새 설정 파일을 만들어줘."
Tool 호출:        file-system__write({ path: "config.json", content: "{\"key\": \"value\"}" })
```

> 자세한 내용은 [레퍼런스: file-system](../reference/builtin-tools.ko.md#file-system)을 참고하세요.

---

### http-fetch -- HTTP 요청

HTTP GET/POST 요청을 수행합니다. SSRF 방지 기능이 내장되어 있으며 http/https 프로토콜만 허용됩니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: http-fetch
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `http-fetch__get`, `http-fetch__post`

**주요 용도:** API 데이터 조회, 외부 서비스 호출, 웹 콘텐츠 가져오기.

```
에이전트 프롬프트: "서울의 최신 날씨 데이터를 가져와줘."
Tool 호출:        http-fetch__get({ url: "https://api.weather.com/v1/seoul" })
```

```
에이전트 프롬프트: "웹훅에 데이터를 전송해줘."
Tool 호출:        http-fetch__post({ url: "https://hooks.example.com/notify", body: { "message": "done" } })
```

> 자세한 내용은 [레퍼런스: http-fetch](../reference/builtin-tools.ko.md#http-fetch)를 참고하세요.

---

### json-query -- JSON 데이터 쿼리

JSON 데이터 구조를 쿼리, 선택, 개수 세기, 평탄화합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: json-query
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `json-query__query`, `json-query__pick`, `json-query__count`, `json-query__flatten`

**주요 용도:** API 응답에서 특정 필드 추출, 항목 개수 세기, 데이터 재구조화.

```
에이전트 프롬프트: "첫 번째 사용자의 이름을 가져와줘."
Tool 호출:        json-query__query({ data: "[{\"name\":\"Alice\"},{\"name\":\"Bob\"}]", path: "[0].name" })
```

> 자세한 내용은 [레퍼런스: json-query](../reference/builtin-tools.ko.md#json-query)를 참고하세요.

---

### text-transform -- 텍스트 변환

텍스트를 치환, 자르기, 분할, 결합, 트리밍, 대소문자 변환합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: text-transform
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `text-transform__replace`, `text-transform__slice`, `text-transform__split`, `text-transform__join`, `text-transform__trim`, `text-transform__case`

**주요 용도:** 텍스트 서식 지정, 부분 문자열 추출, 입력 정리, 대소문자 변환.

```
에이전트 프롬프트: "제목을 대문자로 변환해줘."
Tool 호출:        text-transform__case({ text: "hello world", to: "upper" })
```

> 자세한 내용은 [레퍼런스: text-transform](../reference/builtin-tools.ko.md#text-transform)를 참고하세요.

---

### agents -- 에이전트 간 통신

에이전트가 작업을 위임하고, fire-and-forget 메시지를 보내고, 인스턴스를 스폰하고, 실행 중인 에이전트를 조회하고, 에이전트 카탈로그를 쿼리할 수 있게 합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: agents
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `agents__request`, `agents__send`, `agents__spawn`, `agents__list`, `agents__catalog`

**주요 용도:** 멀티 에이전트 위임, 워커 스폰, 사용 가능한 에이전트 조회.

```
에이전트 프롬프트: "리서처에게 양자 컴퓨팅 정보를 찾아달라고 요청해줘."
Tool 호출:        agents__request({ target: "researcher", input: "양자 컴퓨팅에 대한 최근 논문을 찾아줘" })
```

```
에이전트 프롬프트: "로거에게 작업 완료를 알려줘."
Tool 호출:        agents__send({ target: "logger", input: "작업 X가 성공적으로 완료됨" })
```

```
에이전트 프롬프트: "이 작업을 위한 새 워커 인스턴스를 생성해줘."
Tool 호출:        agents__spawn({ target: "worker", instanceKey: "worker-task-42" })
```

> 대상 에이전트는 현재 Swarm에 정의되어 있어야 합니다. Orchestrator는 대상 AgentProcess가 아직 실행 중이 아니면 자동으로 스폰합니다. 자세한 내용은 [레퍼런스: agents](../reference/builtin-tools.ko.md#agents)를 참고하세요.

---

### self-restart -- Orchestrator 재시작 신호

Orchestrator에 자체 재시작을 요청하는 신호를 보냅니다. 에이전트가 설정 갱신이 필요하다고 판단하는 자기 진화(self-evolution) 시나리오에 사용됩니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: self-restart
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `self-restart__request`

**주요 용도:** 에이전트가 설정을 업데이트하고 Orchestrator가 다시 로드해야 할 때.

```
에이전트 프롬프트: "새 설정을 적용하기 위해 시스템을 재시작해줘."
Tool 호출:        self-restart__request({ reason: "에이전트에 의해 설정이 업데이트됨" })
```

Tool이 반환된 후, 런타임이 재시작 신호를 감지하고 Graceful Shutdown(Connector 종료 포함)을 수행한 뒤 대체 Orchestrator 프로세스를 기동합니다.

> 자세한 내용은 [레퍼런스: self-restart](../reference/builtin-tools.ko.md#self-restart)를 참고하세요.

---

### telegram -- Telegram 메시징

Telegram Bot API를 통해 메시지 전송, 편집, 삭제, 리액션, 채팅 액션 설정, 파일 다운로드를 수행합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: telegram
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `telegram__send`, `telegram__edit`, `telegram__delete`, `telegram__react`, `telegram__setChatAction`, `telegram__downloadFile`

**환경 변수:** `.env`에 `TELEGRAM_BOT_TOKEN` (또는 `BOT_TOKEN`, `TELEGRAM_TOKEN`)을 설정하세요.

**주요 용도:** Telegram 메시지에 응답, 알림 전송, 대화 관리.

```
에이전트 프롬프트: "Telegram 채팅에 인사를 보내줘."
Tool 호출:        telegram__send({ chatId: "123456", text: "Goondan에서 안녕하세요!" })
```

```
에이전트 프롬프트: "타이핑 표시기를 보여줘."
Tool 호출:        telegram__setChatAction({ chatId: "123456", action: "typing" })
```

**Telegram Connector와 함께 사용하면** 에이전트가 Telegram에서 메시지를 수신하고 이 Tool로 응답할 수 있습니다. 최소 Connection 설정:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-connection
spec:
  connectorRef:
    kind: Connector
    name: telegram-polling
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  secrets:
    TELEGRAM_BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: telegram_message
        route:
          instanceKey: "my-bot"
```

> 자세한 내용은 [레퍼런스: telegram](../reference/builtin-tools.ko.md#telegram)을 참고하세요.

---

### slack -- Slack 메시징

Slack API를 통해 메시지 전송, 읽기, 편집, 삭제, 리액션 추가, 파일 다운로드를 수행합니다.

**참조:**

```yaml
tools:
  - ref:
      kind: Tool
      name: slack
      package: "@goondan/base"
```

**LLM에 노출되는 이름:** `slack__send`, `slack__read`, `slack__edit`, `slack__delete`, `slack__react`, `slack__downloadFile`

**환경 변수:** `.env`에 `SLACK_BOT_TOKEN` (또는 `SLACK_TOKEN`)을 설정하세요.

**주요 용도:** Slack 메시지에 응답, 채널 히스토리 읽기, 알림 전송.

```
에이전트 프롬프트: "Slack 채널에 메시지를 보내줘."
Tool 호출:        slack__send({ channelId: "C01ABC23DEF", text: "빌드가 성공적으로 완료되었습니다!" })
```

```
에이전트 프롬프트: "채널의 최근 5개 메시지를 읽어줘."
Tool 호출:        slack__read({ channelId: "C01ABC23DEF", limit: 5 })
```

**Slack Connector와 함께 사용하면** 에이전트가 Slack 이벤트를 수신하고 응답할 수 있습니다. 최소 Connection 설정:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: slack-connection
spec:
  connectorRef:
    kind: Connector
    name: slack
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  config:
    SLACK_WEBHOOK_PORT:
      value: "8787"
  ingress:
    rules:
      - match:
          event: message_im
        route:
          instanceKey: "my-bot"
      - match:
          event: app_mention
        route:
          instanceKey: "my-bot"
```

> 자세한 내용은 [레퍼런스: slack](../reference/builtin-tools.ko.md#slack)을 참고하세요.

---

## 전체 예제: 멀티 Tool 에이전트

여러 내장 Tool을 사용하는 에이전트의 전체 `goondan.yaml` 예시:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: multi-tool-demo
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompt:
    system: |
      당신은 셸 명령, 파일 시스템 작업, HTTP 요청,
      텍스트 처리 도구를 사용할 수 있는 다재다능한 어시스턴트입니다.
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: http-fetch
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: json-query
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: text-transform
        package: "@goondan/base"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
```

실행:

```bash
gdn run
```

---

## 관련 문서

- [레퍼런스: 내장 Tool](../reference/builtin-tools.ko.md) -- 모든 Tool의 전체 파라미터 테이블 및 반환값
- [레퍼런스: Tool API](../reference/tool-api.ko.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult` 인터페이스
- [설명: Tool 시스템](../explanation/tool-system.ko.md) -- 더블 언더스코어 네이밍, 실행 모델, 레지스트리 vs 카탈로그
- [How to: Swarm 실행하기](./run-a-swarm.ko.md) -- 프로젝트 설정 및 실행
- [레퍼런스: 리소스](../reference/resources.ko.md) -- Agent 및 Tool YAML 스키마

---

_위키 버전: v0.0.3_
