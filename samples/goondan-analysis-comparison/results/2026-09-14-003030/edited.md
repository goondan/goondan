# Goondan 저장소 분석 보고서

## 0. 이 보고서의 조사 범위와 읽는 방법

이번 조사는 **읽기 전용**으로 수행했습니다. 직접 확인한 대상은 루트와 각 패키지의 `AGENTS.md`, `GUIDE.md`, `docs/specs/*`, `packages/core/src/*`, `packages/cli/src/goondan-bin.ts`와 `packages/cli/src/chat/*`, 그리고 샘플·fixture(테스트용 고정 입출력 데이터)입니다. 도구 호출 12회 한도 안에서 진행했으므로 확인하지 못한 영역이 남아 있고, 이 부분은 6절에 별도로 정리했습니다.

보고서는 앞에서부터 순서대로 읽도록 구성했습니다. 먼저 이 저장소가 무엇을 목표로 하는지(1절)와 어떤 조각들로 나뉘어 있는지(2절)를 설명하고, 그 구조 위에서 하나의 요청이 어떻게 흘러가는지(3절)를 단계별로 따라갑니다. 실행 경로를 이해한 뒤에야 어디를 건드려 기능을 늘릴 수 있는지(4절), 지금 무엇이 막혀 있거나 조심해야 하는지(5절)가 자연스럽게 이해되기 때문입니다.

서술 중 **(관찰)** 은 파일에서 직접 읽은 사실, **(해석)** 은 조사자가 관찰로부터 추론한 내용입니다. 실행 검증을 하지 않았거나 문서 본문을 대조하지 못한 지점은 그대로 불확실성으로 남겨 두었습니다.

---

## 1. 이 저장소는 무엇을 하려는 프로젝트인가

### 1-1. 문서가 선언한 목적 (관찰)

루트 `AGENTS.md`는 프로젝트를 `Goondan(군단): Agent Swarm Orchestrator`로 정의하고, 슬로건으로 "Kubernetes for Agent Swarm"을 제시합니다.

이 비유는 `docs/overview.md`에서 구체화됩니다. 이 문서는 Kubernetes 개념과 Goondan 개념을 다음과 같이 대응시킵니다.

- Pod ↔ AgentProcess
- Deployment ↔ Swarm
- Service ↔ Connection
- kubectl ↔ `gdn` CLI

그리고 선언적 구성, 프로세스 격리, 이벤트 소싱을 원칙으로 밝힙니다.

그런데 같은 저장소 안에서 `packages/core/AGENTS.md`와 `docs/specs/core-runtime.md`는 이보다 **좁고 새로운 목표**를 기술합니다. 요지는 "호스트는 Goondan 구성에 모델·도구·함수·확장·저장소를 **이름으로** 연결하여 TypeScript와 Python에서 **같은 에이전트 행동**을 실행한다"는 것이고, 공개 인터페이스는 `loadConfig`와 `createRuntime` 두 개로 압축됩니다.

여기서 말하는 "언어 간 동등성"은 `spec/goondan.schema.json`과 `fixtures/conformance/*`(`basic`, `tool-loop`, `async-approval`, `variant`)를 SSOT(single source of truth, 단일 진실 공급원)로 삼아 검증하도록 설계되어 있습니다. 근거는 `packages/core/AGENTS.md`, `docs/specs/core-runtime.md`의 CORE-NFR-001, 그리고 `fixtures/conformance/basic/{goondan.yaml,case.json,expected.json}`입니다.

### 1-2. 두 세대의 목표가 겹쳐 있다 (해석)

위 관찰을 종합하면 이 저장소에는 서로 다른 두 세대의 목표가 공존합니다.

- **구세대**: 에이전트를 프로세스 단위로 스폰·감시·재시작하는 오케스트레이터. Swarm/Connection/Package 같은 YAML 리소스 문서를 기반으로 동작합니다.
- **신세대**: "순수 하니스(pure harness)" 코어. 여기서 하니스란 실행의 뼈대만 제공하는 얇은 런타임을 뜻하며, YAML 구성이 흐름(flow)과 훅 순서를 소유하고 모델·도구·확장의 실제 구현은 호스트가 주입합니다.

전환이 진행 중이라는 근거는 두 가지입니다. 첫째, 루트 `AGENTS.md`가 "코어 런타임"과 "프로세스 호스트"를 구분해 서술합니다. 둘째, `PURE_HARNESS_MIGRATION_PLAN.md`라는 마이그레이션 계획 문서가 존재합니다.

현재 **기본 실행 경로는 신세대**이고, 구세대는 별도 바이너리로 밀려났습니다. `packages/cli/package.json`의 `bin` 항목이 이를 직접 보여 줍니다.

- `gdn` → `dist/goondan-bin.js` (신세대)
- `gdn-legacy` → `dist/bin.js` (구세대)

이 구분은 이후 3절과 5절을 읽을 때 계속 필요하므로 기억해 두시면 좋습니다.

---

## 2. 저장소 구조: 어떤 조각들이 무엇을 맡는가

패키지 경계는 `packages/AGENTS.md`와 루트 `AGENTS.md`의 표에 정의되어 있으며, 실제 소스와 일치합니다(관찰).

| 구성 요소 | 경로 | 책임 (근거) |
|---|---|---|
| `@goondan/core` | `packages/core/src/` | 기본 런타임. 구성 로딩(`config.ts`), 실행 루프(`runtime.ts`), 공개 타입(`types.ts`), 템플릿(`template.ts`), 인메모리 저장소(`store.ts`). 공개 표면은 `index.ts`의 `loadConfig`/`validateConfig`/`createRuntime`/`GoondanRuntime`/`RuntimeEvents`/`MemoryConversationStore`/`MemoryOperationStore`/`TemplateRenderer`/`defineExtension`/`defineTool` |
| `@goondan/cli` | `packages/cli/src/` | `gdn`(신규: `goondan-bin.ts`, `chat/`)과 `gdn-legacy`(`bin.ts` + `commands/`, `services/`, Optique 파서) |
| `@goondan/types` | `packages/types` | 구세대 호스트 공통 계약(RuntimeEvent, TraceContext, AgentRuntime*)의 SSOT (`packages/AGENTS.md`) |
| `@goondan/runtime` | `packages/runtime/src/{orchestrator,runner,pipeline,config,workspace,events}` | Orchestrator(프로세스 매니저) + AgentProcess. `@goondan/runtime/legacy`, `/runner`로 노출 (`GUIDE.md:52`) |
| `@goondan/studio` | `packages/studio` | React+Vite SPA. RuntimeEvent의 TraceContext로 trace→span 트리 구성 (`packages/cli/AGENTS.md` 결정 5) |
| `@goondan/base` | `packages/base` | 기본 Extension/Connector/Tool 묶음. **npm 아님**, `gdn package publish`로만 배포 (루트 `AGENTS.md` 주의사항) |
| `@goondan/registry` | `packages/registry` | 패키지 레지스트리 (Cloudflare Worker) |
| Python 런타임 | `python/goondan` | 같은 YAML/fixture를 Python에서 직접 실행, subprocess 호출 없음 (`python/AGENTS.md`) |
| 문서 | `AGENTS.md`, `GUIDE.md`, `docs/specs/`(19개), `docs/wiki/`(Diataxis, EN+KO), `docs/architecture.md` | 스펙이 SSOT이며 코드보다 먼저 수정한다는 규칙 (루트 `AGENTS.md` "Constitution of the Job" 3~5) |

### 2-1. 코어 구성 모델 (`packages/core/src/types.ts`)

3절의 실행 경로를 따라가려면 코어가 다루는 구성(config) 구조와 주입 계약을 먼저 알아야 합니다. 모두 `packages/core/src/types.ts`에서 확인한 내용입니다(관찰).

**구성 최상위 형태**

```
GoondanConfig = { version: 1, name, agents: Record<string, AgentSpec>, flow: { in, routes? } }
```

**에이전트 명세(`AgentSpec`)의 필드**

- `model`: 사용할 모델 이름
- `config`: 중첩 구성 참조(다른 구성 파일로 위임)
- `params`: 임의 파라미터
- `input`: `"asis"` 또는 `{fields|template|fn}`
- `systemMessage`
- `tools`: `string` 또는 `ToolUse`
- `extensions`
- `hooks`

**훅 지점 8개**

훅(hook)은 런타임이 특정 값을 만들거나 소비하는 시점에 끼어들어 값을 검사·변형할 수 있는 확장 지점입니다. 코어는 다음 8개 값 이름을 정의합니다.

```
ValueName = "input" | "conversation" | "modelInput" | "modelResult"
          | "toolCall" | "toolResult" | "output" | "error"
```

**주입 계약(`RuntimeBindings`)**

호스트가 코어에 실제 구현을 넘겨주는 창구입니다.

```
RuntimeBindings = { models, tools?, functions?, extensions?, ports?,
                    conversationStore?, operationStore?, host?,
                    logger?, maxSteps?, maxRetries? }
```

**구현해야 하는 인터페이스**

- `Model.generate(input, ctx)`
- `Tool.execute(input, ctx)`
- `ExtensionDefinition.create(...)`
- `GoondanFunction(value, ctx)`
- `ConversationStore`
- `OperationStore`
- `RuntimeHost`

---

## 3. 요청의 실행 경로

이 절은 사용자가 명령을 입력한 순간부터 결과 텍스트가 출력되기까지의 흐름을 순서대로 따라갑니다. 먼저 배치 실행(`gdn run`)을 기준으로 CLI → 구성 로딩 → 턴 실행 순서로 설명하고, 그 다음 대화형 경로(`gdn chat`)와 승인 작업 경로를 다룹니다.

### 3-A. `gdn run`: 배치 실행 진입점

`packages/cli/src/goondan-bin.ts`의 `main()`이 수행하는 일은 다음과 같습니다(관찰).

1. `process.argv.slice(2)`를 `parse()`로 직접 파싱합니다. 지원 플래그는 `--bindings`, `--input`, `--input-file`, `--conversation-id`, `--agent`, `--variant`입니다. `conversationId`의 기본값은 `cli:<base36 timestamp>`입니다.
2. `loadConfig(absolute, { variants })`를 호출합니다. 여기서 서브커맨드가 `validate`나 `config`라면 이 단계에서 종료합니다(각각 검증 결과 출력, YAML 덤프).
3. 바인딩 모듈을 `import(pathToFileURL(...))`로 로드하고, `module.bindings ?? module.default`를 `isBindings`로 검사합니다. `isBindings`의 판정 기준은 `models` 객체의 존재입니다.
4. 입력을 `--input-file` → `--input` → stdin 순서로 읽고 `parseInput`으로 `Json` 값으로 변환합니다. JSON 파싱에 실패하면 원문 문자열을 그대로 사용합니다.
5. `createRuntime(loaded, bindings)`로 런타임을 만들고 `runtime.runTurn(input, { conversationId, agent })`를 호출합니다.
6. 결과의 `output.content`에서 `type === 'text'`인 파트만 stdout으로 출력하고 마지막에 개행을 붙입니다. `finally` 블록에서 `runtime.close()`를 호출합니다.

### 3-B. 구성 로딩 (`packages/core/src/config.ts`)

`loadConfig`는 위 2단계에서 호출되며, 다음 규칙으로 동작합니다(관찰).

- **엔트리 결정**: 입력이 디렉터리면 `<dir>/goondan.yaml`, 파일이면 그 파일을 엔트리로 삼습니다.
- **합성 순서**: `loadYaml`이 `extends` → `resources[]` → 자기 자신 순서로 `merge`(깊은 병합)를 수행합니다. 이때 `resources`와 `extends` 키 자체는 병합 대상에서 제외됩니다.
- **안전장치**: `realpath`를 기준으로 **순환 참조**와 **중복 리소스**를 각각 에러로 차단합니다.
- **경로 정규화**: `template`과 `config` 필드의 값은 선언된 파일의 디렉터리를 기준으로 절대경로로 정규화됩니다(`normalizeDeclaredPaths`, `pathFields`).
- **변형(variant) 오버레이**: `options.variants`에 주어진 이름들이 `<root>/variants/<name>.yaml`을 순서대로 덮어씁니다.
- **검증**: `validateConfig`가 `version === 1`, `name`, `agents`, 그리고 `flow.in`(존재하는 에이전트를 가리켜야 함)을 검사합니다. 또한 `agents.*.extensions.<name>.extension` 키는 "중복"이라며 명시적으로 거부합니다. 맵의 키 자체가 확장 이름이기 때문입니다.
- **템플릿 수집**: 합성에 참여한 모든 디렉터리의 `templates/`를 재귀적으로 수집하고, 구성에서 참조된 `template` 경로를 읽어 `Map`에 등록합니다. 이때 절대경로와 `templates/...` 상대경로 두 가지 키로 모두 등록합니다.

### 3-C. 턴 실행 (`packages/core/src/runtime.ts`)

구성이 준비되면 런타임이 하나의 "턴"을 실행합니다. 내부 호출 흐름은 `runTurn` → `#runTurn` → `#runFlow` → `#runAgent` → `#continueAgent` 순입니다.

#### `runTurn` → `#runTurn`

1. 시작 에이전트는 `options.startAgent ?? options.agent ?? config.flow.in`으로 결정합니다. `startAgent`와 `agent`를 **동시에 지정하면 에러**입니다.
2. `#runFlow(agent, input, options, true)`를 호출합니다. 결과 출력이 1개면 그대로 사용하고, 여러 개면 각 출력의 텍스트를 `\n\n`으로 이어 붙인 `flow-output` 메시지를 만들어 `{ output, outputs, finishReason: "stop", status: "done" }`을 반환합니다. 출력이 0개면 `Flow produced no output` 에러가 발생합니다.

#### `#runAgent`: 에이전트 1턴의 준비

- `AgentSpec.config`가 있으면 해당 경로의 구성을 `loadConfig`로 로드해 **중첩 런타임**(`#nested`)을 만들고, 같은 바인딩으로 실행을 위임합니다.
- `AbortController`를 `conversationId` 키로 `#controllers`에 등록합니다. 이것이 `abort()` 지원의 근거입니다.
- 대화는 `options.conversation ?? store.load(conversationId, agent)`로 확보합니다.
- `#extensions()`가 `conversationId:agent` 키로 확장 인스턴스를 캐시 생성합니다. 확장이 `requires`로 선언한 port(외부 의존성 주입 구멍)가 `bindings.ports`에 없으면 에러이며, `options.validate`로 옵션을 검증합니다.
- `input` 훅 파이프라인을 실행하고, `turn.start` 이벤트를 발생시킵니다. 이어 `#inputMessage`가 `asis`/`fn`/`template` 규칙에 따라 user 메시지를 만들어 대화와 저장소에 append한 뒤 `#continueAgent`로 넘어갑니다.

#### `#continueAgent`: 모델 호출과 도구 실행의 반복 루프

이 루프의 반복 상한은 `bindings.maxSteps ?? 32`입니다.

1. `#drainSteering` — 실행 중에 들어온 `steer()` 입력(진행 중인 턴에 사용자 메시지를 끼워 넣는 기능)을 user 메시지로 삽입합니다.
2. `#drainPending` — `mode: "async"` 훅의 결과를 `#dedupe`로 중복 제거한 뒤 반영합니다.
3. `conversation` 훅 파이프라인을 실행합니다. 값이 교체되면 `store.replace`를 호출합니다.
4. `step += 1` 후 `#modelInput`을 구성합니다. 구성 요소는 선택된 도구 목록(각 `ToolUse.hint` 문자열을 추가), `systemMessage`(text 또는 템플릿 렌더 — 사용 가능한 변수는 `params`, `tools`, `agent.name`, `model`), 대화의 `structuredClone`, 그리고 빈 `options: {}`입니다. 이 값에 `modelInput` 훅이 적용됩니다.
5. `step.start` 이벤트를 낸 뒤 `#model(spec).generate(modelInput, { agent, conversationId, turnId, step, signal, onTextDelta })`를 호출합니다. `onTextDelta`로 들어오는 조각은 `step.textDelta` 이벤트로 흘려보냅니다. 모델이 예외를 던지면 `step.error` 이벤트와 함께 `RuntimeFailure{ where: "model" }`이 발생합니다.
6. `modelResult` 훅을 적용합니다. 결과가 `Retry`면 `continue`하여 **같은 step을 소비하지 않고** 모델을 다시 호출합니다. 그렇지 않으면 사용량을 누적(`addUsage`)하고 assistant 메시지를 대화와 저장소에 append한 뒤 `step.done` 이벤트를 냅니다.
7. `toolCalls()`로 `type: "tool.call"` 파트를 추출합니다. 호출이 있으면 순차적으로 `#executeTool`을 실행합니다. 그중 하나라도 `endsTurn`으로 턴을 끝내면 `#finishToolTurn`으로 마무리하고, 아니면 루프를 계속합니다.
8. 도구 호출이 없으면 `output` 훅을 적용하고, 마지막 메시지를 교체(`store.replace`)한 뒤 `store.finish(status: "done")`와 `turn.done` 이벤트를 거쳐 `{ output, usage, finishReason, status: "done" }`을 반환합니다.
9. 반복 상한을 넘기면 `Maximum steps exceeded: N` 에러가 발생합니다.

#### `#executeTool` / `#runApprovedTool`: 도구 실행과 승인

- `toolCall` 훅의 결과가 `{ result }` 형태면 도구 실행을 **건너뛰고** 결과만 append합니다. 결과가 `ToolExecution`이면 `call`/`execution`을 교체합니다.
- 승인 사유가 있는 경우(`ToolUse.approval === "required"`이거나 훅이 `Approval`을 반환한 경우), 도구를 **실행하지 않고** `PendingOperation`을 저장합니다. 모델에는 `{ status: "pending", operationId }` 형태의 JSON 도구 결과를 돌려주고, 이어서 `humanApproval.created` 이벤트와 `host.requestApproval`을 호출합니다.
- 실제 실행 경로는 다음과 같습니다. 같은 `callId`에 대한 결과가 이미 있으면 중복 실행을 막기 위해 스킵합니다. 그렇지 않으면 `tool.start` 이벤트 → `tool.execute(args, ctx)` 호출로 진행합니다. 이때 ctx에는 `input`, `conversation`, `agent`, `conversationId`, `turnId`, `toolCall`, `execution`, `signal`, `agents.run`이 담깁니다. 실패하면 `tool.error` 이벤트와 `RuntimeFailure{ where: "tool" }`이 발생합니다. 성공하면 `#appendToolResult`가 `toolResult` 훅을 적용한 뒤 `role: "tool"` 메시지로 저장하고 `tool.done` 이벤트를 냅니다. 그리고 `ToolUse.endsTurn === "success"`이고 에러가 아니라면 도구 결과를 그대로 턴 출력으로 승격합니다.

#### `#runFlow`: 여러 에이전트를 잇는 흐름

- 현재 에이전트를 실행한 뒤, **`followRoutes`가 참이고 `options.agent`가 지정되지 않았으며 `flow.routes`가 존재할 때에만** 라우팅을 시도합니다.
- `routes.filter(route => route.from === agent)`로 후보를 고른 뒤, `route.when.fn`이 없거나 `{ output, input, conversation }`에 대해 참을 반환하는 라우트만 매칭합니다. **매칭이 0개면 `No flow route matched from <agent>` 에러**가 발생합니다.
- `route.to === "out"`이면 해당 출력을 최종 결과에 추가합니다. 그 외에는 `carry.message`(`"output"` / `{fn}` / `{template}`)로 다음 입력을 만들고, `carry.conversation`(`"none"` / `"asis"` / `{fn}`)으로 다음 대화를 만들어 `#runFlow`를 재귀 호출합니다. 여러 라우트가 매칭되면 출력이 여러 개 쌓이고, 앞서 본 `#runTurn`에서 하나로 합쳐집니다.

#### `#handleError`: 오류 처리

`error` 훅을 적용한 결과가 `Retry`이고 `retryCount < (maxRetries ?? 3)`이면 `#runAgent`를 다시 호출합니다. 그렇지 않으면 `store.finish(status: "error")`와 `turn.error` 이벤트를 거친 뒤 원래 예외를 다시 던집니다.

### 3-D. `gdn chat`: 대화형 경로

`goondan-bin.ts`는 `argv[0] === 'chat'`을 **가장 먼저** 분기해 `runChat(parseChatOptions(...), io)`를 호출합니다. 구성 요소별 역할은 다음과 같습니다(관찰).

- **`packages/cli/src/chat/command.ts`** — `--cwd`, `--model`, `--session`, `--state-dir`, `--config`, `--bindings`, `--final-only`를 파싱합니다. `--config`가 없으면 `createDefaultChatConfig`가 기본 구성을 만듭니다. 기본 구성은 단일 `assistant` 에이전트, 도구 `read_file`/`write_file`/`list_dir`/`bash`, `flow.in: assistant`로 이루어집니다(`packages/cli/src/chat/default.ts`). `--bindings`가 없으면 `defaultBindings`가 `createRouterModel`을 모든 에이전트의 모델 이름에 매핑하고 `createLocalTools({ cwd })`를 주입합니다.
- **`packages/cli/src/chat/host.ts`** — `ChatHost`가 `createRuntime`을 소유합니다. `conversationStore`를 `FileConversationStore`(`chat/session.ts`, 원자적 파일 교체 방식)로 교체하고, `host.emit`을 래핑해 `step.textDelta`는 stdout 스트리밍으로, `tool.start`/`tool.error`는 stderr 상태 표시로 변환합니다. 실행 중 사용자 입력은 `runtime.steer`로 전달하고, `/interrupt` 명령과 SIGINT는 `runtime.abort`로 연결합니다.
- **`packages/cli/src/chat/repl.ts`** — readline 기반 루프입니다. `/quit`·`/exit`로 종료하고 `/interrupt`를 지원하며, 실행 중 들어온 입력은 `[steered]`로 표시합니다. 스트리밍이 일어나지 않았다면 최종 텍스트를 한 번에 출력합니다.
- **`packages/cli/src/chat/provider.ts`** — Anthropic Messages 호환 SSE 스트리밍 클라이언트입니다. `content_block_delta` 중 `text_delta`는 `onTextDelta`로 전달하고, `input_json_delta`는 누적한 뒤 `type: "tool.call"` 파트로 변환합니다. `stop_reason`은 `finishReason`으로 매핑합니다(`tool_use`→`tool`, `max_tokens`→`length`, `end_turn|stop_sequence`→`stop`).

### 3-E. 승인 작업(operation) 경로

3-C에서 승인이 필요한 도구 호출이 `PendingOperation`으로 저장된다고 설명했습니다. 그 이후의 처리는 다음과 같습니다(관찰).

`decideOperation` / `cancelOperation` / `recoverOperations`가 `OperationStore`의 원자적 `transition`으로 상태를 전이합니다. 작업이 종결되면 `#deliverOperation`이 `deliveryId`로 `claimDelivery`를 잡아 **정확히 한 번** 전달합니다. 전달 방식의 우선순위는 다음 세 가지입니다(`packages/core/src/runtime.ts:375-385`).

1. `host.deliverOperationCompletion`이 있으면 그것을 사용
2. 해당 대화가 실행 중이면 `steer`로 주입
3. 둘 다 아니면 새 `runTurn`을 시작

재시작 시에는 `running` 상태였던 작업을 다시 실행하지 않고 `execution_interrupted`로 실패 종결합니다(`recoverOperations`). 이는 `packages/core/AGENTS.md`의 불변 규칙과 일치합니다.

---

## 4. 확장 지점: 기능을 늘리려면 어디를 건드리는가

앞 절에서 본 대로 코어는 "이름으로 참조하고 호스트가 구현을 주입한다"는 구조를 갖습니다. 따라서 모든 확장은 두 축으로 나뉩니다. 하나는 실제 구현을 이름에 연결하는 `RuntimeBindings`이고, 다른 하나는 순서와 조합을 선언하는 `goondan.yaml`입니다.

### 새 모델 추가

- `Model` 인터페이스(`generate(input, ctx)`)를 구현하고 `bindings.models["<이름>"]`에 등록합니다. 구성에서는 `agents.<name>.model: <이름>`으로 참조합니다. `packages/core/src/runtime.ts`의 `#model`은 해당 이름이 없으면 `Unknown model` 에러를 냅니다.
- 참조 구현: `packages/cli/src/chat/provider.ts`의 `createRouterModel`.

### 새 도구 추가

- `Tool { name, description, input, execute }`를 구현한 뒤 `bindings.tools`에 등록하거나, 확장 인스턴스의 `tools[]`로 제공합니다. 이름이 겹칠 경우 **확장 도구가 전역 도구를 덮어씁니다**(`#tools`의 `available[tool.name] = tool`).
- 에이전트가 `tools: ["name"]` 또는 `tools: [{ tool, hint, approval: "required", endsTurn: "success" }]`로 선택해야 모델에 노출됩니다. 선택 목록에 없는 도구는 모델에 전달되지 않습니다.
- 헬퍼 `defineTool`은 `packages/core/src/extension.ts`에서 export됩니다.
- 참조 구현: `packages/cli/src/chat/tools.ts`의 `createLocalTools` / `createTool`.

### 서브에이전트를 도구로 노출

`tools: [{ agent: "worker" }]`를 쓰면 런타임이 `#tools`에서 도구를 자동으로 합성합니다. 이때 `conversationId`를 `<conversationId>:<turnId>:<agent>`로 분기해 하위 에이전트를 실행합니다.

### 새 확장(Extension) 추가

- `ExtensionDefinition { name, options?.validate, requires?, hooks?, create() }`를 구현해 `bindings.extensions`에 등록하고, 외부 의존성은 `bindings.ports`로 주입합니다. `create`는 `{ hooks, tools, on, dispose }`를 가진 `ExtensionInstance`를 반환합니다.
- 인스턴스 수명은 `conversationId:agent` 단위 캐시이며, `runtime.close()`에서 `dispose()`가 호출됩니다.
- **훅 실행 순서는 확장이 아니라 구성이 소유합니다.** 순서는 `goondan.yaml`의 `agents.<name>.hooks.<valueName>[]` 배열이 결정하며, 확장은 다른 확장의 이름이나 순서를 알 수 없습니다(`packages/core/AGENTS.md` 결정 2).
- `InlineHookSpec`에서 쓸 수 있는 옵션은 `extension`, `fn`, `agent`(문자열 또는 배열, 배열이면 병렬 실행 후 텍스트 결합), `template`, `using`(`input` / `conversation` / `{fn}`), `when.fn`, `mode: "async"`, `optional`, `role`, `timeout`입니다. 훅의 반환값으로는 `Append`, `Retry`, `Fail`, `Approval`, `ToolExecution`, `{result}`를 사용할 수 있습니다.
- 이벤트 구독 방법은 `ExtensionInstance.on[eventName]`, `runtime.events.on(listener)`, `bindings.host.emit` 세 가지입니다.

### 새 함수(function) 추가

`GoondanFunction`을 `bindings.functions`에 등록하면 다음 위치에서 이름으로 참조할 수 있습니다: `input.fn`, `hooks[].fn` / `when.fn` / `using.fn`, `flow.routes[].when.fn`, `carry.message.fn` / `carry.conversation.fn`.

### 새 에이전트 / flow 추가

- `agents.<name>`을 추가하고 `flow.in` 또는 `flow.routes[] = { from, to, when?, carry? }`로 연결합니다. `to: "out"`이 최종 출력 지점입니다.
- 구성이 커지면 세 가지 방법을 쓸 수 있습니다. `AgentSpec.config`로 별도 구성 파일에 위임(중첩 런타임), `extends`/`resources`로 YAML 합성, 그리고 `variants/<name>.yaml` + `--variant`로 환경별 오버레이.

### 저장소·호스트 기능 교체

다음 항목은 모두 주입으로 대체할 수 있습니다.

- `conversationStore`: `load` / `append` / `replace` / `finish`
- `operationStore`: `list` / `get` / `save` / `transition` / `claimDelivery` / `releaseDelivery`
- `host`: `captureOperationContext`, `requestApproval`, `validateOperationInputPatch`, `validateOperation`, `deliverOperationCompletion`, `emit`, `now`, `id`
- `logger`, `maxSteps`, `maxRetries`

이 중 `host.now`와 `host.id`는 결정론적 테스트나 conformance 비교를 위한 훅으로 보입니다(해석).

---

## 5. 제약, 미완성 영역, 주의사항

### 5-1. 문서와 구현의 불일치 (문서 간 충돌)

1절에서 두 세대의 목표가 공존한다고 설명했는데, 그 결과가 문서와 구현의 불일치로 드러납니다. 아래 항목들은 서로 충돌하는 근거를 그대로 병기한 것입니다.

- **두 개의 구성 스키마가 공존합니다.** 코어는 `version: 1` + `agents` + `flow` 형태를 요구합니다(`fixtures/conformance/basic/goondan.yaml`). 그런데 `samples/smoke-test/goondan.yaml`과 `samples/brain-persona/goondan.yaml`은 여전히 `apiVersion: goondan.ai/v1`, `kind: Package|Model|Agent|Swarm|Connection|Extension` 형태의 구세대 리소스 문서입니다. 이 샘플들을 신규 `gdn`의 `loadConfig`에 넣으면 `Unsupported config version: undefined`로 실패할 것으로 보입니다(해석 — 실행 검증은 하지 않았습니다).
- **`gdn run`의 의미가 문서와 코드에서 다릅니다.** `docs/specs/cli.md` 4장은 `gdn run`을 "Orchestrator 기동(상주 프로세스)"으로 설명하며 `--swarm`/`--watch`/`--foreground` 플래그와 `.env` 자동 로딩을 언급하고, `packages/cli/src/commands/run.ts`가 이를 구현합니다. 반면 실제 `gdn` 바이너리인 `packages/cli/src/goondan-bin.ts`의 `run`은 단발성 `runTurn` 실행이며 해당 플래그가 없습니다. `commands/run.ts`는 `gdn-legacy`(`packages/cli/src/bin.ts`) 경로에 연결됩니다. 따라서 CLI 문서를 읽을 때는 `gdn`과 `gdn-legacy`를 반드시 구분해야 합니다.
- 루트 `AGENTS.md`의 문서 네비게이션 표가 참조하는 `STUDIO_PLAN.md`와 `TODO.md`는 이 snapshot에 존재하지 않습니다.
- 루트 `AGENTS.md`는 `docs/specs/chat-runtime.md`를 `gdn chat`의 계약으로 지목합니다. 파일 자체는 존재하지만, 본문 대조는 이번 조사에서 수행하지 못했습니다.

### 5-2. 신규 CLI 진입점의 거친 부분 (관찰)

3-A에서 본 `parse()`의 단순함이 몇 가지 제약으로 이어집니다.

- `parse()`가 `flag`/`value` 쌍을 무조건 요구하므로, `--final-only` 같은 불리언 플래그를 `run`이나 `validate`에서 쓸 수 없습니다. 값이 빠지면 `Missing value for ...`로 실패합니다(`packages/cli/src/goondan-bin.ts`).
- `--help`는 `chat`에서만 별도로 처리되고, 나머지는 첫 인자가 `help|--help|-h`일 때만 동작합니다.
- 오류 처리는 `console.error(message)` 후 `exitCode = 1`로 단순합니다. 구조화 오류(`code`/`suggestion`/`helpUrl`)를 유지하라는 `packages/cli/AGENTS.md`의 불변 규칙은 legacy 경로(`errors.ts`, `formatter.ts`)에만 적용됩니다.
- `run`의 출력은 텍스트 파트만 stdout으로 내보내므로, `json`·`image`·`media` 파트는 유실됩니다.

### 5-3. 코어 런타임의 제약 (관찰 및 일부 해석)

- 기본 저장소는 인메모리(`MemoryConversationStore` / `MemoryOperationStore`)이므로 프로세스가 종료되면 대화와 승인 작업이 사라집니다. 영속성은 호스트의 책임이며, `gdn chat`은 이를 `FileConversationStore`로 대체합니다.
- `maxSteps` 기본값 32 초과, `flow.routes` 미매칭, flow 출력 0개는 모두 **예외로 종료**되며 복구 경로가 없습니다.
- `#runFlow`는 `options.agent`가 지정되면 라우팅을 건너뜁니다. 즉 `gdn run --agent X`는 단일 에이전트 실행이며 flow를 따르지 않습니다. `--agent`와 `startAgent`의 차이를 혼동하기 쉬운 지점입니다.
- 다중 출력 병합은 텍스트 결합(`\n\n`)만 지원하므로, 비텍스트 파트가 포함된 다중 라우트 출력은 손실됩니다.
- `#executeTool(call, state, _remainingCalls)`의 세 번째 인자는 이름 앞에 `_`가 붙어 미사용 상태입니다. 병렬 또는 후속 도구 호출 처리를 위한 자리로 보이지만 현재는 미구현입니다(해석).
- `RuntimeEvents.emit`과 `#emit`이 리스너를 **순차 await**하므로, 느린 리스너나 확장의 `on` 핸들러가 턴 지연을 유발합니다.
- 훅의 `timeout` 구현(`#timeout`)은 타임아웃이나 abort 시 reject만 하고 실행 중인 promise를 취소하지 않습니다. 누수가 발생할 수 있습니다(해석).
- `#dedupe`는 `source`가 `user`나 `model`이 아닌 연속 동일 메시지만 제거하는 좁은 규칙입니다.

### 5-4. `gdn chat` 기본값의 운영상 주의 (관찰 및 일부 해석)

3-D에서 설명한 기본값 두 가지는 운영 관점에서 특히 주의가 필요합니다.

- `packages/cli/src/chat/provider.ts`에 **사내 LLM 라우터 URL(`[REDACTED]`)과 조직 식별 헤더(`[REDACTED]`, `[REDACTED]`)가 하드코딩**되어 있고, 기본 모델은 `claude-sonnet-5`입니다. 외부 사용자는 `--bindings`로 자체 `Model`을 주입해야 합니다. 공개 배포 패키지(`@goondan/cli`, `publishConfig.access: "public"`)에 특정 조직의 엔드포인트가 들어 있는 점은 검토가 필요한 지점입니다(해석).
- 기본 도구 세트에 `write_file`과 `bash`가 포함되어 있고 승인 요구(`approval: "required"`)가 선언되어 있지 않습니다. 따라서 `gdn chat`은 기본적으로 작업 디렉터리에 대한 쓰기 권한과 명령 실행 권한을 모델에 부여합니다(`packages/cli/src/chat/default.ts`).

### 5-5. 전환이 아직 진행 중입니다 (관찰)

- `PURE_HARNESS_MIGRATION_PLAN.md`는 전체 체크박스가 미완(`- [ ]`) 상태이며, `samples/brain-persona`와 프롬프트 주입 확장 레퍼런스의 "코어 주입 v0" 전환이 남아 있음을 명시합니다.
- Python 런타임(`python/goondan`)과 TypeScript 코어의 동등성은 `fixtures/conformance`로 검증하는 설계이지만, 두 구현이 실제로 fixture를 통과하는지는 이번 조사에서 확인하지 못했습니다.

---

## 6. 추가 확인이 필요한 사항

아래 항목은 이번 조사 범위에서 확인하지 못한 부분입니다. 후속 조사가 필요합니다.

1. `docs/specs/chat-runtime.md`, `docs/specs/pipeline.md`, `docs/specs/tool.md`, `docs/specs/extension.md`의 계약이 `packages/core/src/runtime.ts` 구현과 세부까지 일치하는지 (본문 미대조).
2. `packages/runtime`(Orchestrator/AgentProcess)과 `@goondan/types`의 RuntimeEvent/TraceContext가 코어의 `RuntimeEvent`와 동일한 타입인지, 혹은 별개 계약인지. 참고로 `packages/core/src/types.ts`의 `RuntimeEvent`에 `traceId`/`spanId` 필드가 있는지는 확인하지 못했고, 코어의 `#emit`은 `{ name, agent, conversationId, turnId, at, data }`만 생성합니다.
3. 구세대 샘플(`samples/*/goondan.yaml`)이 어떤 진입점으로 실행되도록 의도된 것인지(`gdn-legacy run`으로 추정), 그리고 `goondan.lock.yaml`의 소비 지점.
4. `packages/base`의 Tool/Extension이 신규 코어의 `RuntimeBindings`를 구현하는지, 아니면 구세대 리소스 계약만 구현하는지.
5. `fixtures/conformance/*/case.json`과 `expected.json`이 어떤 테스트 러너에서 소비되는지 (`packages/core/test`, `python/tests` 미확인).
6. `e2e/`(brain-persona.test.ts, scenarios)가 신규 코어 경로와 legacy 경로 중 무엇을 검증하는지.
