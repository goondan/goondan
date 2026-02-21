# How to: 멀티 에이전트 패턴

> request, send, spawn을 활용한 에이전트 간 통신 패턴 가이드입니다.

[English version](./multi-agent-patterns.md)

---

## 사전 준비

- 여러 에이전트가 포함된 작동하는 Goondan 스웜
- `@goondan/base`의 `agents` 도구가 에이전트의 `spec.tools`에 포함
- [Tool API 레퍼런스](../reference/tool-api.ko.md) (특히 `AgentToolRuntime`) 숙지
- [런타임 모델](../explanation/runtime-model.ko.md) (IPC 및 Process-per-Agent)에 대한 기본 이해

---

## 개요

Goondan 스웜의 에이전트는 **IPC 기반 이벤트**를 통해 Orchestrator를 경유해서만 통신합니다. 에이전트 간 직접 통신은 없습니다. `@goondan/base`의 `agents` 도구는 에이전트 간 통신을 위한 다섯 가지 연산을 제공합니다:

| 연산 | 패턴 | 설명 |
|------|------|------|
| `agents__request` | 요청-응답 | 메시지를 보내고 응답을 기다림 |
| `agents__send` | 발사 후 망각 | 응답을 기다리지 않고 메시지 전송 |
| `agents__spawn` | 인스턴스 준비 | 새 에이전트 인스턴스 준비 |
| `agents__list` | 발견 | 스폰된 에이전트 인스턴스 목록 조회 |
| `agents__catalog` | 발견 | 스웜에서 사용 가능한 에이전트 목록 조회 |

모든 통신은 Orchestrator를 경유하며, Orchestrator가 `instanceKey`로 이벤트를 라우팅하고 필요할 때 대상 에이전트를 자동으로 스폰합니다.

LLM 도구 호출 외에도, `turn` / `step` 미들웨어에서는 `ctx.agents`로 에이전트를 프로그래매틱하게 호출할 수 있습니다:

| 미들웨어 API | 패턴 | 설명 |
|-------------|------|------|
| `ctx.agents.request` | 요청-응답 | Extension 미들웨어가 요청을 보내고 응답을 기다림 |
| `ctx.agents.send` | 발사 후 망각 | Extension 미들웨어가 비동기 알림 전송 |

현재 `ctx.agents`는 `request`, `send`만 지원합니다. 인스턴스 준비/발견(`spawn`, `list`, `catalog`)은 `agents` 도구 경로를 사용합니다.

---

## 설정: agents 도구 포함

에이전트 간 통신을 활성화하려면 통신이 필요한 각 에이전트에 `agents` 도구를 추가합니다.

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coordinator
spec:
  modelConfig:
    modelRef: "Model/default"
  tools:
    - ref:
        kind: Tool
        name: agents
        package: "@goondan/base"
    # ... 기타 도구
```

이렇게 하면 LLM이 호출할 수 있는 다섯 가지 도구가 노출됩니다: `agents__request`, `agents__send`, `agents__spawn`, `agents__list`, `agents__catalog`.

---

## 패턴 0: 미들웨어 트리거 request/send (`ctx.agents`)

작업 에이전트 LLM이 `agents__request`를 직접 호출하지 않아야 하는 자동 처리(예: turn 전 프리로드, turn 후 감사)가 필요할 때 사용합니다.

```typescript
api.pipeline.register('turn', async (ctx) => {
  const preload = await ctx.agents.request({
    target: 'retriever',
    input: '현재 인바운드 메시지에 필요한 컨텍스트를 찾아주세요',
    timeoutMs: 5000,
  });

  if (preload.response.length > 0) {
    ctx.metadata.preloadedContext = preload.response;
  }

  const result = await ctx.next();

  await ctx.agents.send({
    target: 'observer',
    input: `turn=${ctx.turnId} finish=${result.finishReason}`,
  });

  return result;
});
```

주의사항:

- `turn` / `step` 미들웨어 컨텍스트에서만 사용 가능합니다.
- `toolCall` 컨텍스트에는 `ctx.agents`가 없습니다.
- `request` 타임아웃을 생략하면 기본값은 `60000ms`입니다.
- 런타임은 순환 요청 체인을 감지해 오류를 반환합니다.

---

## 패턴 1: 동기 요청 (request-response)

다른 에이전트의 응답이 필요할 때 `agents__request`를 사용합니다. 호출 에이전트의 Turn은 대상 에이전트가 Turn을 완료하고 결과를 반환할 때까지 일시 중지됩니다.

### 동작 방식

```
에이전트 A (coordinator)              Orchestrator                에이전트 B (researcher)
    |                                      |                           |
    |-- agents__request(researcher, ...) ->|                           |
    |                                      |-- 이벤트 라우팅 -------->|
    |                                      |   (필요시 스폰)          |
    |                                      |                          |-- Turn 처리
    |                                      |                          |-- 결과 반환
    |                                      |<-- 응답 이벤트 ----------|
    |<-- 결과 ------------------------------|                          |
    |                                      |                           |
    |-- Turn 계속                           |                           |
```

### LLM 관점

LLM이 `agents__request` 도구를 호출할 때 사용하는 파라미터:

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `target` | `string` | 예 | 대상 에이전트 이름 (예: `"researcher"`) |
| `input` | `string` | 아니오 | 대상에게 보낼 텍스트 메시지 |
| `instanceKey` | `string` | 아니오 | 대상 인스턴스 키 (기본값: 호출자의 instanceKey) |
| `timeoutMs` | `number` | 아니오 | 타임아웃 밀리초 (기본값: 60000) |
| `metadata` | `object` | 아니오 | 이벤트와 함께 전달할 추가 메타데이터 |

### 시나리오 예시

코디네이터 에이전트가 리서치 작업을 위임:

```
Coordinator:
  "양자 컴퓨팅 동향을 조사해야 합니다.
   researcher 에이전트에게 물어보겠습니다."

  -> agents__request({
       target: "researcher",
       input: "2026년 최신 양자 컴퓨팅 동향을 요약해주세요"
     })

  <- { target: "researcher", response: "주요 동향은 다음과 같습니다: ..." }

  "조사 결과를 바탕으로 분석 결과를 정리하겠습니다..."
```

### 사용 시점

- 호출 에이전트가 추론을 계속하기 위해 응답이 필요할 때
- 결과가 현재 Turn에 피드백되는 작업 위임
- 품질 검토: 에이전트 A가 콘텐츠를 생성하고, 에이전트 B가 검토 후 피드백 반환

---

## 패턴 2: 비동기 전송 (fire-and-forget)

응답을 기다리지 않고 다른 에이전트에 알림을 보내려면 `agents__send`를 사용합니다. 이벤트가 전달 수락되면 도구가 즉시 반환됩니다.

### 동작 방식

```
에이전트 A (coordinator)              Orchestrator                에이전트 B (notifier)
    |                                      |                           |
    |-- agents__send(notifier, ...) ------>|                           |
    |<-- { accepted: true } 즉시 반환 -----|                           |
    |                                      |-- 이벤트 라우팅 -------->|
    |-- Turn 계속                           |   (필요시 스폰)          |
    |                                      |                          |-- Turn 처리
    |                                      |                          |   (독립적으로)
```

### LLM 관점

LLM이 `agents__send` 도구를 호출할 때 사용하는 파라미터:

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `target` | `string` | 예 | 대상 에이전트 이름 |
| `input` | `string` | 아니오 | 보낼 텍스트 메시지 |
| `instanceKey` | `string` | 아니오 | 대상 인스턴스 키 (기본값: 호출자의 instanceKey) |
| `metadata` | `object` | 아니오 | 추가 메타데이터 |

### 시나리오 예시

코디네이터가 작업 완료 후 여러 채널에 알림:

```
Coordinator:
  "작업이 완료되었습니다. 팀에 알리겠습니다."

  -> agents__send({
       target: "notifier",
       input: "service-x 배포가 성공적으로 완료되었습니다"
     })
  <- { accepted: true }

  -> agents__send({
       target: "logger",
       input: "배포 이벤트: service-x가 2026-02-18T10:30:00Z에 배포됨"
     })
  <- { accepted: true }

  "두 에이전트에 알림을 보냈습니다."
```

### 사용 시점

- 여러 에이전트에 알림 브로드캐스트
- 로깅 또는 감사 이벤트 기록
- 결과가 필요 없는 백그라운드 작업 트리거
- 현재 Turn에서 응답이 필요하지 않을 때 블로킹 방지

---

## 패턴 3: 새 인스턴스 스폰

메시지를 보내기 전에 정의된 에이전트의 새 인스턴스를 준비하려면 `agents__spawn`을 사용합니다. 특정 인스턴스 키나 작업 디렉토리를 가진 격리된 인스턴스를 만들 때 유용합니다.

### 동작 방식

```
에이전트 A (coordinator)              Orchestrator
    |                                      |
    |-- agents__spawn(builder, {           |
    |     instanceKey: "task-42"           |
    |   }) ------------------------------>|
    |                                      |-- 인스턴스 준비
    |<-- { spawned: true, instanceKey } ---|
    |                                      |
    |-- agents__request(builder, {         |
    |     instanceKey: "task-42",          |
    |     input: "기능 X를 구현해주세요"     |
    |   }) ------------------------------>|
    |                                      |-- task-42 인스턴스로 라우팅
```

### LLM 관점

LLM이 `agents__spawn` 도구를 호출할 때 사용하는 파라미터:

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `target` | `string` | 예 | 에이전트 이름 (현재 Swarm에 정의되어 있어야 함) |
| `instanceKey` | `string` | 아니오 | 커스텀 인스턴스 키 (생략 시 자동 생성) |
| `cwd` | `string` | 아니오 | 새 인스턴스의 작업 디렉토리 |

### 중요 규칙

- `target`은 현재 Swarm에 정의된 Agent 리소스여야 합니다 -- `spawn`은 새로운 Agent 리소스를 생성하지 않습니다.
- 동일한 `instanceKey`를 가진 인스턴스가 이미 존재하면 재사용됩니다 (중복 생성 안 함).
- `request`나 `send`로 존재하지 않는 인스턴스에 보내면 Orchestrator가 자동으로 스폰하므로, 많은 경우 명시적 `spawn`은 선택사항입니다.

### 사용 시점

- 메시지 전송 전에 특정 인스턴스 키로 인스턴스 사전 생성
- 인스턴스에 커스텀 작업 디렉토리 설정
- 동일 에이전트 타입의 격리된 인스턴스 여러 개 생성 (예: 작업별 builder 하나씩)

---

## 패턴 4: list와 catalog로 에이전트 발견

다른 에이전트와 통신하기 전에 어떤 에이전트가 사용 가능한지, 어떤 인스턴스가 스폰되었는지 확인해야 할 수 있습니다.

### catalog: 정의된 에이전트 목록

`agents__catalog`는 현재 Swarm의 에이전트 정의를 반환합니다.

```
-> agents__catalog()
<- {
     swarmName: "brain",
     entryAgent: "coordinator",
     selfAgent: "coordinator",
     availableAgents: ["coordinator", "researcher", "builder", "reviewer"],
     callableAgents: ["researcher", "builder", "reviewer"]
   }
```

| 필드 | 설명 |
|------|------|
| `availableAgents` | Swarm에 정의된 모든 에이전트 이름 |
| `callableAgents` | 호출자가 통신할 수 있는 에이전트 (자기 자신 제외) |
| `selfAgent` | 호출 에이전트의 이름 |
| `entryAgent` | Swarm의 진입 에이전트 |

### list: 실행 중인 인스턴스 목록

`agents__list`는 스폰된 에이전트 인스턴스 정보를 반환합니다.

```
-> agents__list()
<- {
     count: 2,
     agents: [
       { target: "builder", instanceKey: "task-42", ownerAgent: "coordinator", ... },
       { target: "builder", instanceKey: "task-43", ownerAgent: "coordinator", ... }
     ]
   }
```

기본적으로 `list`는 호출 에이전트가 스폰한 인스턴스만 반환합니다. `includeAll: true`를 전달하면 스웜의 모든 인스턴스를 볼 수 있습니다.

---

## 실전 시나리오: Coordinator + Specialist 패턴

Goondan에서 가장 일반적인 멀티 에이전트 패턴은 **코디네이터**가 **전문가** 에이전트에게 작업을 위임하는 구조입니다. `brain-persona` 샘플의 완전한 예제입니다.

### Swarm 설정

```yaml
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: brain
spec:
  entryAgent: "Agent/coordinator"
  agents:
    - ref: "Agent/coordinator"
    - ref: "Agent/researcher"
    - ref: "Agent/builder"
    - ref: "Agent/reviewer"
  policy:
    maxStepsPerTurn: 24
```

### Agent 설정

**Coordinator** -- 모든 인바운드 이벤트를 수신하고 전문가에게 위임:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coordinator
spec:
  modelConfig:
    modelRef: "Model/fast-model"
  prompts:
    systemRef: "./prompts/coordinator.system.md"
  tools:
    - ref:
        kind: Tool
        name: agents
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: telegram
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: slack
        package: "@goondan/base"
```

**Specialist** -- 단일 도메인에 집중 (예: 리서치):

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: researcher
spec:
  modelConfig:
    modelRef: "Model/default-model"
  prompts:
    systemRef: "./prompts/researcher.system.md"
  tools:
    - ref:
        kind: Tool
        name: agents
        package: "@goondan/base"
```

### 통신 흐름

```
사용자 (Telegram/Slack 경유)
    |
    v
Connector -> Connection ingress -> coordinator
    |
    |  coordinator 수신: "양자 컴퓨팅을 조사하고 요약 문서를 만들어주세요"
    |
    |  Step 1: coordinator가 agents__request(researcher, "양자 컴퓨팅 동향을 조사해주세요") 호출
    |           -> researcher가 Turn 처리, 리서치 결과 반환
    |
    |  Step 2: coordinator가 agents__request(builder, "이 내용을 바탕으로 요약 문서를 작성해주세요: ...") 호출
    |           -> builder가 Turn 처리, 문서 반환
    |
    |  Step 3: coordinator가 agents__request(reviewer, "이 문서를 검토해주세요: ...") 호출
    |           -> reviewer가 Turn 처리, 피드백 반환
    |
    |  Step 4: coordinator가 결과를 종합하고 telegram__send로 최종 응답 전송
    |
    v
사용자가 최종 응답 수신
```

### Connection 라우팅

모든 인바운드 이벤트가 공유 `instanceKey`를 사용하여 단일 대화 스레드를 유지:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-brain
spec:
  connectorRef:
    kind: Connector
    name: telegram-polling
    package: "@goondan/base"
  swarmRef: "Swarm/brain"
  secrets:
    TELEGRAM_BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: telegram_message
        route:
          instanceKey: "brain-persona-shared"
```

`instanceKey: "brain-persona-shared"`는 모든 Telegram 메시지가 동일한 coordinator 인스턴스로 전달되어 대화 연속성을 유지합니다.

---

## 팁

### request와 send 중 선택

| 시나리오 | 사용 |
|----------|------|
| 추론을 계속하기 위해 결과가 필요 | `request` |
| 알림 브로드캐스트 | `send` |
| 작업을 위임하고 결과를 기다림 | `request` |
| 백그라운드 작업 트리거 | `send` |
| 순차 파이프라인 (A -> B -> C -> 결과) | 각 단계에서 `request` |

### 자동 스폰 동작

`agents__spawn`을 항상 명시적으로 호출할 필요는 없습니다. 활성 인스턴스가 없는 대상 에이전트에 `request`나 `send`를 하면 Orchestrator가 자동으로 스폰합니다. 명시적 `spawn`은 다음과 같을 때 사용하세요:

- 커스텀 `instanceKey`가 필요할 때
- 커스텀 작업 디렉토리(`cwd`)가 필요할 때
- 작업 전송 전에 인스턴스를 미리 준비(pre-warm)할 때

### instanceKey 공유

에이전트 A가 `instanceKey`를 지정하지 않고 `agents__request(target: "B")`를 호출하면, 호출자의 `instanceKey`가 기본값으로 사용됩니다. 이는:

- coordinator의 instanceKey가 `"brain-persona-shared"`이면, researcher도 `"brain-persona-shared"`에서 실행됩니다.
- 대부분의 경우 이것이 원하는 동작입니다 -- 스웜 전체에서 단일 대화 컨텍스트를 공유합니다.
- 작업별로 격리된 인스턴스가 필요하면, request에서 고유한 `instanceKey`를 지정하세요.

---

## 함께 보기

- [Tool API 레퍼런스](../reference/tool-api.ko.md) -- 전체 `AgentToolRuntime` API (request/send/spawn/list/catalog)
- [내장 도구 레퍼런스](../reference/builtin-tools.ko.md) -- `agents` 도구 파라미터 상세
- [런타임 모델](../explanation/runtime-model.ko.md) -- IPC 메시지 라우팅과 Process-per-Agent 아키텍처
- [How to: Connector 작성하기](./write-a-connector.ko.md) -- 인바운드 이벤트 파이프라인 구축

---

_How-to 버전: v0.0.3_
