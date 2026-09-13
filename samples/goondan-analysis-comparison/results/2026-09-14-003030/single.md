# Goondan 저장소 분석 보고서

> 조사 범위: 읽기 전용. 루트 `AGENTS.md`, `packages/AGENTS.md`, `packages/core/AGENTS.md`, `packages/cli/AGENTS.md`, `docs/specs/core-runtime.md`, `docs/specs/chat-runtime.md`, `spec/goondan.schema.json`, `packages/core/src/*`, `packages/cli/src/goondan-bin.ts`, `packages/cli/src/chat/*`, `fixtures/conformance/*`, `samples/*`를 직접 확인했습니다. 확인하지 못한 영역은 마지막 절에 따로 정리했습니다.

---

## 1. 저장소가 해결하려는 문제와 주요 목적

**관찰된 사실**

- 루트 `AGENTS.md`는 프로젝트를 `Goondan(군단) : Agent Swarm Orchestrator`, 슬로건을 `"Kubernetes for Agent Swarm"`으로 정의합니다.
- `docs/specs/core-runtime.md` 1절: "호스트는 Goondan 구성에 모델·도구·함수·확장·저장소를 연결하여 TypeScript와 Python에서 같은 에이전트 행동을 실행합니다."
- 구성 형식의 규범적 정의는 `spec/goondan.schema.json`(`$id: https://goondan.dev/schema/config-v1.json`)이며, 필수 최상위 필드는 `version`, `name`, `agents`, `flow`입니다.
- 언어 간 동등성은 `fixtures/conformance/`(`basic`, `tool-loop`, `variant`, `async-approval`)의 `goondan.yaml` + `case.json` + `expected.json` 3종 파일로 고정하며, TypeScript(`packages/core/test/conformance.test.ts`)와 Python(`python/goondan/tests/test_conformance.py`, `python/goondan/AGENTS.md`에 명시)이 같은 fixture를 읽습니다.

**해석**

핵심 문제는 "에이전트의 행동(프롬프트, 도구, 훅 순서, 에이전트 간 흐름)을 코드가 아니라 선언적 구성 파일이 소유하게 하고, 그 구성을 여러 언어 런타임에서 동일하게 실행"하는 것입니다. 즉 이 저장소는 에이전트 프레임워크라기보다 **에이전트 실행 계약(구성 스키마 + 런타임 의미론)** 을 SSOT로 두고, 그 계약을 TS/Python 런타임, CLI 호스트, 프로세스 오케스트레이터, 패키지 레지스트리로 둘러싼 구조입니다.

---

## 2. 핵심 구성 요소와 책임

### 2.1 패키지 지도 (`packages/AGENTS.md`, 루트 `AGENTS.md`, `pnpm-workspace.yaml`)

| 구성 요소 | 책임 | 근거 |
|---|---|---|
| `packages/core` (`@goondan/core`) | `goondan.yaml`을 실행하는 기본 TS 런타임. 공개 API는 `loadConfig` / `createRuntime`에 집중 | `packages/core/src/index.ts`, `packages/core/AGENTS.md` |
| `python/goondan` | 같은 구성 계약의 Python 런타임 (단일 파일 `goondan/runtime.py`) | `python/goondan/AGENTS.md` |
| `packages/cli` (`@goondan/cli`) | 진입점 두 개: `gdn`(=`dist/goondan-bin.js`, 코어 호스트), `gdn-legacy`(=`dist/bin.js`, 프로세스 오케스트레이터) | `packages/cli/package.json`의 `bin` |
| `packages/types`, `packages/runtime` | 레거시 프로세스 호스트의 공통 타입과 Orchestrator + AgentProcess | 루트 `AGENTS.md` 패키지 표, `packages/AGENTS.md` |
| `packages/base` | 기본 Extension/Connector/Tool 묶음. **npm이 아니라 군단 레지스트리로만 배포** | 루트 `AGENTS.md` "중요 주의사항", `packages/base/src/{tools,extensions,connectors}` |
| `packages/studio`, `packages/registry`, `packages/eval` | Trace 시각화 UI, 레지스트리 서버(Cloudflare Worker), 평가 | 루트 `AGENTS.md` 패키지 표 |
| `spec/`, `fixtures/conformance/` | 언어 중립 JSON Schema와 공통 실행 사례 | `spec/goondan.schema.json` |

### 2.2 `@goondan/core` 내부 (총 ~740줄, 파일 7개)

- `src/types.ts` — 공개 타입 SSOT. 핵심 계약:
  - `RuntimeBindings = { models, tools?, functions?, extensions?, ports?, conversationStore?, operationStore?, host?, logger?, maxSteps?, maxRetries? }`
  - `Model.generate(input, ctx)`, `Tool.execute(input, ctx)`, `ConversationStore{load,append,replace,finish}`, `OperationStore{list,get,save,transition,claimDelivery,releaseDelivery}`, `RuntimeHost`, `ExtensionDefinition`, `GoondanFunction`
  - 훅 값 8종: `ValueName = "input" | "conversation" | "modelInput" | "modelResult" | "toolCall" | "toolResult" | "output" | "error"`
  - `RuntimeEventName` 15종 (`turn.*`, `step.*`, `tool.*`, `humanApproval.created`, `hook.*`)
- `src/config.ts` — `loadConfig(path, {variants})` / `validateConfig(raw)`. `extends` → `resources[]` → 자기 문서 순서로 재귀 병합(`merge`), 객체는 키별 재귀 병합·배열/스칼라는 교체, 순환/중복 참조는 오류(`Circular config resource`, `Duplicate config resource`), `template`·`config` 필드는 선언 파일 기준 절대 경로로 정규화(`normalizeDeclaredPaths`, `pathFields`), `variants/<name>.yaml`은 합성 후 순서대로 병합.
- `src/runtime.ts` — 실행 의미 전부(플로우, 훅 파이프라인, 모델·도구 반복, 승인 operation, 이벤트).
- `src/store.ts` — 인메모리 기본 구현 `MemoryConversationStore`, `MemoryOperationStore`.
- `src/template.ts` — `TemplateRenderer` (nunjucks 기반, 생성 시 `validate()` 호출).
- `src/extension.ts` — `defineExtension`, `defineTool` (타입 헬퍼, 각 1줄).

### 2.3 CLI (`packages/cli/src`)

- `goondan-bin.ts` — `gdn` 진입점. 지원 명령은 `run`, `chat`, `validate`, `config`, `help`뿐이며 자체 인자 파서를 갖습니다.
- `chat/command.ts` — `parseChatOptions` + `runChat`. 구성/바인딩 선택 및 기본값 조립.
- `chat/default.ts` — 구성 파일 없이 동작하는 기본 구성(`name: goondan-cli-chat`, 에이전트 `assistant`, 도구 4종, `flow.in: assistant`).
- `chat/provider.ts` — Anthropic Messages 형식 SSE 스트리밍 `Model` 구현(`createRouterModel`, `DEFAULT_CHAT_MODEL = 'claude-sonnet-5'`).
- `chat/tools.ts` — 로컬 도구 `read_file`, `write_file`, `list_dir`, `bash` (`createLocalTools`).
- `chat/session.ts` — `FileConversationStore` (세션 JSON을 tmp 파일 + `rename`으로 원자적 교체).
- `chat/host.ts` — `ChatHost`: 런타임 생성, 이벤트→터미널 표시, `submit`/`interrupt`/`close`.
- `chat/repl.ts` — `runChatRepl`: readline 루프, `/quit`, `/exit`, `/interrupt`, SIGINT.
- `commands/*`, `services/*`, `parser.ts`, `router.ts` — `gdn-legacy` 계열(Optique 기반 파서, Orchestrator 기동, 인스턴스/로그/패키지/Studio 서비스).

---

## 3. 요청 실행 경로: CLI → 모델 → 도구 → flow 완료 → 최종 출력

아래는 `gdn chat`(대화형)과 `gdn run`(일회성)의 공통 경로입니다. 괄호 안은 근거 경로입니다.

### 3.1 진입과 구성 로딩

**`gdn run` 경로** (`packages/cli/src/goondan-bin.ts`)
1. `main()`이 `argv[0] === 'chat'`을 먼저 분기하고, 그 외는 `parse(argv)`로 `{command, directory, bindings, input, inputFile, conversationId, agent, variants}`를 만듭니다. `conversationId` 기본값은 `cli:<base36 timestamp>`, `bindings` 기본값은 `goondan.bindings.js`입니다.
2. `loadConfig(resolve(directory), { variants })` 호출 → `validate`/`config` 명령이면 여기서 종료(`Valid config: <name>` 출력 또는 YAML 덤프).
3. `run`이면 바인딩 모듈을 `import(pathToFileURL(...))` 후 `module.bindings ?? module.default`를 `isBindings`(= `models` 객체 보유)로 검사.
4. 입력은 `--input` → `--input-file` → stdin 순으로 읽고 `parseInput`이 JSON 파싱 실패 시 원문 문자열로 사용합니다.
5. `createRuntime(loaded, candidate)` → `runtime.runTurn(input, { conversationId, agent })`.

**`gdn chat` 경로** (`packages/cli/src/chat/command.ts`)
1. `parseChatOptions`가 `--cwd/--model/--session/--state-dir/--config/--bindings/--final-only`를 처리. `session` 기본값은 `randomUUID()`, `stateDirectory` 기본값은 `~/.goondan/chat`(`chat/default.ts`의 `defaultChatStateDirectory`).
2. `--config`가 있으면 `loadConfig(options.config)`, 없으면 `createDefaultChatConfig(cwd, model)`.
3. `--bindings`가 있으면 모듈 로드, 없으면 `defaultBindings`: 구성에 등장하는 **모든 `agent.model` 이름에 같은 router provider 인스턴스를 매핑**하고 `tools`에 `createLocalTools({cwd})`를 넣습니다.
4. `new ChatHost({...})`가 `createRuntime`을 호출하며 `conversationStore`를 `FileConversationStore`로 덮어쓰고, `host.emit`을 래핑해 `step.textDelta`→stdout, `tool.start`/`tool.error`→stderr로 표시합니다 (`chat/host.ts`).
5. `runChatRepl`이 한 줄 입력마다 `host.submit(line)` 호출. **진행 중인 턴이 있으면 새 턴을 시작하지 않고 `runtime.steer(conversationId, input)`로 넘기고 `[steered]`를 출력합니다.**

### 3.2 flow 진입 (`GoondanRuntime.runTurn`, `packages/core/src/runtime.ts`)

```
runTurn(input, options)
 └ #runTurn: agent = options.startAgent ?? options.agent ?? loaded.config.flow.in
    └ #runFlow(agent, input, options, followRoutes=true)
```
- `options.agent`와 `options.startAgent`를 동시에 주면 즉시 오류(`RunOptions cannot include both agent and startAgent`).
- `runTurn`은 실행 중 promise를 `#activeRuns`에 `conversationId` 키로 등록합니다(승인 완료 전달 경로에서 사용).

### 3.3 에이전트 턴 준비 (`#runAgent`)

1. `spec.config`가 있으면 해당 경로의 구성을 `loadConfig`로 읽어 **중첩 런타임**을 만들고(`#nested` 캐시, 같은 bindings 공유) 그 런타임의 `runTurn`에 위임합니다.
2. `AbortController`를 만들어 `#controllers[conversationId]`에 저장(외부 `signal`이 있으면 연결). → `abort(conversationId)`와 Ctrl+C의 근거.
3. 대화 로드: `options.conversation ?? store.load(conversationId, agent)`.
4. `#state(...)`가 `TurnState`를 만들며 이때 `#extensions(agent, spec, conversationId)`가 **에이전트×대화 조합 키(`${conversationId}:${agent}`)** 로 확장 인스턴스를 생성/캐시합니다. `definition.requires`의 각 포트가 `bindings.ports`에 없으면 `Extension <name> requires port <port>` 오류.
5. `#input(state)` → `input` 훅 파이프라인 적용, 이어서 `turn.start` 이벤트 발행.
6. `#inputMessage(state)`로 만든 입력 메시지를 대화에 push하고 `store.append`로 즉시 저장.

### 3.4 모델·도구 반복 (`#continueAgent`) — 실행 경로의 심장

`while (state.step < (bindings.maxSteps ?? 32))` 루프:

1. `#drainSteering(state)` — `steer()`로 큐에 쌓인 입력을 user 메시지로 변환해 대화에 추가·저장.
2. `#drainPending(state)` — `mode: async` 훅의 결과(`append`)를 회수해 중복 제거 후 대화에 반영.
3. `conversation` 훅 파이프라인 → 값이 바뀌면 `store.replace`로 전체 교체.
4. `state.step += 1` 후 `#modelInput(state)`:
   - `systemMessage`의 `text` 또는 `template`을 `TemplateRenderer`로 렌더(변수: `params`, `tools`, `agent.name`, `model`).
   - `#tools(state)`가 사용 가능한 도구 목록을 계산: `bindings.tools` + 확장이 제공한 `instance.tools`를 합친 뒤 `agent.tools[]`에 선언된 것만 선택. 미등록 이름은 `Unknown tool: <name>` 오류. `{agent: <name>}` 항목은 **다른 에이전트를 도구로 감싼 어댑터**로 즉석 생성합니다(하위 대화 ID = `${conversationId}:${turnId}:${target}`).
   - `modelInput` 훅 파이프라인 적용.
5. `step.start` 이벤트 → `#model(spec).generate(modelInput, ctx)`. `ctx.onTextDelta`는 `step.textDelta` 이벤트를 발행하고, 이것이 `ChatHost`를 통해 터미널 스트리밍이 됩니다. 실패 시 `step.error` 발행 후 `RuntimeFailure({where: "model", codes: ["model_error"|"aborted"]})`.
6. `modelResult` 훅 파이프라인. 결과가 `{retry: true, target}`이면 `continue`로 모델 재호출.
7. 모델 메시지를 대화에 push + `store.append`, 사용량 누적, `step.done` 발행.
8. `toolCalls(modelResult)`가 비어있지 않으면 각 호출을 순서대로 `#executeTool`:
   - `toolCall` 훅 파이프라인. 훅이 `{result}`를 주면 도구를 실행하지 않고 그 결과만 붙입니다. `{call, execution}`이면 호출을 치환.
   - 승인 필요 판정: `toolCall` 훅이 `{approval:{reason}}`을 반환했거나 `tools[]` 항목에 `approval: required`가 있으면 → `operationId` 생성, `host.captureOperationContext`, `PendingOperation` 저장, **모델에는 `{status: "pending", operationId}` JSON 도구 결과를 즉시 연결**, `humanApproval.created` 이벤트, `host.requestApproval` 호출 후 도구는 실행하지 않고 반환.
   - 승인 불필요하면 `#runApprovedTool`: 같은 `callId`의 결과가 이미 있으면 skip(중복 방지) → `tool.start` → `tool.execute(args, ctx)` (ctx에 `signal`, `agents.run` 포함) → 실패 시 `tool.error` 후 `RuntimeFailure({where:"tool", toolCall})` → 성공 시 `#appendToolResult`(내부에서 `toolResult` 훅 적용·저장) → `tool.done`.
   - 해당 `tools[]` 항목에 `endsTurn: "success"`가 있고 결과가 에러가 아니면 assistant 메시지(`meta.endedByTool`)를 만들어 반환 → 루프를 빠져나가 `#finishToolTurn`으로 턴 종료.
   - 도구 결과가 붙었으면 `continue`로 다음 모델 호출.
9. 도구 호출이 없으면 **턴 종료 경로**: `output` 훅 파이프라인 → 대화 마지막 메시지를 교체 → `store.replace` → `store.finish({status:"done", turnId, output})` → `turn.done` 이벤트 → `{output, usage, finishReason, status:"done"}` 반환.
10. 루프를 다 소진하면 `Maximum steps exceeded: 32`.

오류 시 `#handleError`: `error` 훅 파이프라인 → `{retry:true}`이고 `retryCount < (maxRetries ?? 3)`이면 `#runAgent`를 다시 호출, 아니면 `store.finish({status:"error"})` + `turn.error` 이벤트 후 rethrow.

### 3.5 flow 라우팅과 최종 출력 (`#runFlow`)

1. `#runAgent` 결과를 받은 뒤, `followRoutes`가 false이거나 **`options.agent`가 지정되었거나** `flow.routes`가 없으면 `[result.output]`만 반환(= 라우팅 생략).
2. 그 외에는 `flow.routes`에서 `route.from === agent`인 것만 고르고, 각 `route.when.fn`을 `functions`에서 찾아 `{output, input, conversation}`으로 호출해 통과한 것만 남깁니다. **매칭이 0개면 `No flow route matched from <agent>` 오류.**
3. 매칭된 각 라우트에 대해:
   - `route.to === "out"` → 현재 출력을 결과 목록에 추가(플로우 종료점).
   - 그 외 → `#carry(route.carry?.message, ...)`로 다음 입력을 만들고(`"output"`=텍스트 그대로 / `{fn}` / `{template}`), `#carryConversation(route.carry?.conversation, ...)`로 대화를 전달(`"none"`=미전달 / `"asis"` / `{fn}`), `#runFlow(route.to, ...)`를 **재귀 호출**하여 하위 출력을 모두 이어붙입니다.
4. `#runTurn`으로 돌아와 `outputs.length === 0`이면 `Flow produced no output`, 1개면 그 메시지, 여러 개면 각 출력 텍스트를 `\n\n`으로 이은 `source: "flow"` assistant 메시지를 만들어 `{output, outputs, finishReason:"stop", status:"done"}`을 반환합니다.

### 3.6 CLI에서의 최종 출력

- `gdn run`: `result.output.content`의 `type === 'text'` 파트만 stdout에 쓰고 개행 후 `finally`에서 `runtime.close()` (`goondan-bin.ts`).
- `gdn chat`: `ChatHost.#run`이 출력 파트를 문자열로 합치고 `{kind:'completed', text, streamed}`를 반환. `repl.ts`는 **스트리밍이 있었으면 개행만, 없었으면 `text`를 한 번 출력**해 중복 출력을 피합니다. 종료 시 `host.close()`가 `interrupt()` → 진행 중 턴 대기 → `runtime.close()`(모든 컨트롤러 abort, 확장 `dispose`, 중첩 런타임 close)를 수행합니다.

### 3.7 비동기 승인 완료의 재진입 경로

`decideOperation`/`cancelOperation` → `OperationStore.transition` → 승인이면 `#startOperation` → `#executeOperation`(`host.validateOperation` → `running` 전이 → 도구 실행 → `toolResult` 훅 → `completed` 전이) → `#deliverOperation`:
- `host.deliverOperationCompletion`이 있으면 호스트에 위임,
- 없고 해당 대화가 `#activeRuns`에 있으면 `steer()`로 진행 중 턴에 주입,
- 둘 다 아니면 `runTurn(completion, {conversationId, agent})`으로 **새 턴을 시작**합니다.
`claimDelivery`/`deliveryStatus`로 중복 전달을 막고, `recoverOperations`는 재시작 시 `running` 작업을 `failed`(`execution_interrupted`)로 종결합니다.

---

## 4. 확장 지점

실행 경로에 직접 연결되는 확장 지점만 정리합니다.

### 4.1 새 모델 추가

- 구현: `Model` 인터페이스의 `generate(input: ModelInput, ctx): Promise<ModelResult>` 하나만 구현 (`packages/core/src/types.ts`). `ctx.onTextDelta(delta)`를 호출해야 `step.textDelta` → 터미널 스트리밍이 동작합니다.
- 등록: bindings 모듈이 `export const bindings: RuntimeBindings`(또는 default)로 `models: Record<string, Model>`를 내보내고, 구성의 `agents.<name>.model` 문자열이 그 키를 가리킵니다. `#model()`이 못 찾으면 `Unknown model: <name>`.
- 참고 구현: `packages/cli/src/chat/provider.ts`의 `createRouterModel`(SSE 누적 → `Part`/`Usage`/`finishReason` 변환).

### 4.2 새 도구 추가

- 구현: `Tool = { name, description, input: Record<string, Json>, execute(input, ctx) }`. `ctx`에는 `toolCall`, `execution`, `signal`, `conversation`, `agents.run`이 들어옵니다. `defineTool`로 타입만 고정할 수 있습니다(`packages/core/src/extension.ts`).
- 등록 경로 3가지:
  1. `bindings.tools`에 이름으로 등록 후 `agents.<name>.tools: [<tool-name>]`.
  2. 확장 인스턴스의 `tools: Tool[]` — `#tools()`가 `bindings.tools` 위에 덮어씁니다(같은 이름이면 확장 우선).
  3. `tools: [{agent: "other"}]` — 다른 에이전트를 도구로 노출.
- 도구별 선언 옵션: `hint`(시스템 프롬프트 힌트 `#hint`), `approval: required`(승인 경유), `endsTurn: success`(성공 시 턴 종료).
- 참고 구현: `packages/cli/src/chat/tools.ts` (출력·읽기·쓰기 한도와 `bash` 타임아웃, `ctx.signal` 취소 처리 포함).

### 4.3 새 에이전트 추가

- `goondan.yaml`의 `agents.<name>`에 `model` 또는 `config` 중 하나를 선언(스키마의 `oneOf`, `spec/goondan.schema.json`). 사용 가능 필드: `description`, `params`, `input`(`"asis"` | `{fields|template|fn}`), `systemMessage`(단일/배열, `text|template|cache`), `tools`, `extensions`, `hooks`.
- 재사용: `config: <경로>`로 다른 구성을 하위 에이전트로 중첩(`#runAgent`의 `#nested`).
- 훅으로 확장: `hooks.<valueName>[]`의 인라인 훅은 `{extension}` 또는 `fn → agent → template` 순서로 값을 만들며, `using`(`input`/`conversation`/`{fn}`), `when: {fn}`, `mode: sync|async`, `optional`, `role`, `timeout`을 지원합니다(`#pipeline`, `#hook`). **훅 실행 순서는 구성의 배열 순서이며, 확장은 다른 확장의 이름·순서를 모릅니다**(`packages/core/AGENTS.md` 결정 2, `docs/specs/core-runtime.md` CORE-NFR-002).

### 4.4 새 flow 추가

- `flow.in`에 진입 에이전트, `flow.routes[]`에 `{from, to, when?: {fn}, carry?}`를 선언. `to: "out"`이 종료점입니다(`#runFlow`).
- 분기는 `when.fn`을 `bindings.functions`에 등록해 구현하고, 데이터 전달은 `carry.message`(`"output"`|`{fn}`|`{template}`)와 `carry.conversation`(`"none"`|`"asis"`|`{fn}`)으로 제어합니다.

### 4.5 그 밖의 바인딩 훅

| 확장 지점 | 용도 |
|---|---|
| `functions` | 훅의 `fn`, `when.fn`, `using.fn`, `carry.*.fn`, `input.fn`이 이름으로 참조 |
| `extensions` (`ExtensionDefinition`) | `create()`로 인스턴스 생성, `hooks`/`tools`/`on`(이벤트 구독)/`dispose` 제공, `requires`로 필요한 포트 선언 |
| `ports` | 확장이 요구하는 외부 자원 주입. 누락 시 에이전트 실행 실패 |
| `conversationStore` | 대화 영속화 교체 (`FileConversationStore`가 실제 예시) |
| `operationStore` | 승인 operation 영속화 교체 |
| `host` | `captureOperationContext`, `requestApproval`, `validateOperation(InputPatch)`, `deliverOperationCompletion`, `emit`, `now`, `id` |
| `logger`, `maxSteps`, `maxRetries` | 로깅과 반복/재시도 상한 |
| `runtime.events.on(listener)` | 구독 해제 함수를 돌려주는 이벤트 구독 (`RuntimeEvents`) |
| 구성 합성 | `extends`, `resources[]`, `variants/<name>.yaml` + `loadConfig(dir, {variants})` |

---

## 5. 확인된 제약, 미완성 영역, 주의할 점

### 5.1 문서와 구현의 충돌 (명시적으로 짚습니다)

1. **비동기 승인 구현 여부.** `docs/specs/core-runtime.md` 6절 "Current Implementation Gap"은 "현재 TypeScript와 Python 구현은 승인 결정을 Promise로 기다리거나 대기 상태를 반환하며 … `pending` 도구 결과, 별도 후속 입력과 작업 ID 기반 중복 방지를 아직 구현하지 않았습니다"라고 적고 있습니다. 그러나 `packages/core/src/runtime.ts`의 `#executeTool`은 `{status:"pending", operationId}` 도구 결과를 실제로 연결하고, `#deliverOperation`이 `deliveryId`/`claimDelivery`로 중복 전달을 막으며 별도 입력(`operation_completion`)으로 반영합니다. `python/goondan/AGENTS.md`도 구현되었다고 서술합니다. → **스펙 문서의 Gap 절이 낡았을 가능성**이 높지만, 두 경로가 상충하므로 작업 전 최신 상태를 확인해야 합니다.
2. **동일 스펙 문서 5절 자체가 "미해결 사항"을 남겨둠.** "승인 저장소와 호스트의 공개 API 이름은 미해결 사항", "턴 종료 도구의 선언 방식, 설정 상속 규칙과 flow 문법도 별도 합의 후 이 절에 추가"라고 적혀 있으나, 코드에는 이미 `endsTurn: "success"`, `extends`/`resources`, `flow.routes`가 구현·스키마화되어 있습니다.
3. **스키마 파일명 불일치.** `python/goondan/AGENTS.md`는 `spec/config.schema.json`을 참조하지만 실제 파일은 `spec/goondan.schema.json`뿐입니다.
4. **문서 네비게이션의 존재하지 않는 파일.** 루트 `AGENTS.md` 표는 `STUDIO_PLAN.md`와 `TODO.md`를 안내하지만 루트 디렉터리 목록에는 두 파일이 없습니다.
5. **두 가지 구성 형식 공존.** `fixtures/conformance/*`와 `packages/{core,cli}/test/fixtures/*`는 신형 `version: 1` 구성이지만, `samples/smoke-test/goondan.yaml`, `samples/brain-persona/goondan.yaml`, `packages/base/goondan.yaml`은 레거시 `apiVersion: goondan.ai/v1` + `kind: Package|Model|Agent|Swarm|Connection` 매니페스트입니다. → **현재 `samples/`는 `gdn run`(코어 경로)이 아니라 `gdn-legacy` 경로용**입니다. 코어 실행 경로를 학습할 때는 `fixtures/conformance/basic`이 가장 정확한 예시입니다. `PURE_HARNESS_MIGRATION_PLAN.md`가 루트에 남아 있는 점도 전환이 진행 중임을 시사합니다(내용은 이번 조사에서 확인하지 않음).

### 5.2 코드에서 확인한 제약

- **`gdn`의 인자 파서가 매우 단순.** `goondan-bin.ts`의 `parse()`는 모든 플래그를 `[flag, value]` 쌍으로 소비하므로 boolean 플래그를 쓸 수 없고, 값이 없으면 `Missing value for <flag>`로 실패합니다. `--variant`만 배열 누적을 지원합니다. 즉 `gdn run`은 Optique 기반 `parser.ts`(레거시 전용)를 쓰지 않습니다.
- **`gdn run --agent`는 flow 라우팅을 비활성화합니다.** `#runFlow`의 `options.agent !== undefined` 조건 때문에 단일 에이전트 출력만 나옵니다. 라우팅을 유지하려면 `startAgent`를 써야 하지만, **CLI에는 `startAgent`를 넘기는 플래그가 없습니다**(`goondan-bin.ts`는 `--agent`만 전달).
- **플로우 라우트 미매칭은 성공이 아니라 예외.** `routes`를 선언한 뒤 `to: "out"` 기본 경로를 빠뜨리면 `No flow route matched from <agent>`로 턴이 실패합니다.
- **기본 상한.** `maxSteps` 32, `maxRetries` 3 (`bindings`로만 조정 가능, 구성 YAML에는 해당 키가 없습니다).
- **`bindings.models`는 "모델 이름 → 구현" 평면 맵.** 프로바이더·인증·모델 파라미터 개념이 코어에 없어 전부 바인딩 구현체 책임입니다. `chat`의 `defaultBindings`는 구성에 나오는 모든 모델 이름을 **하나의 router provider로 덮어씁니다** — 멀티 모델 구성을 `gdn chat --config`로 그대로 실행하면 모델이 전부 동일해집니다.
- **기본 chat provider는 사내 엔드포인트에 하드코딩.** `ROUTER_URL = '[REDACTED]'` (`chat/provider.ts`). `docs/specs/chat-runtime.md`도 "사내 네트워크와 Router 정책에 따라 접근"이라고 명시합니다. 외부 환경에서는 `--bindings`로 교체해야 합니다. 같은 문서가 참조 구현으로 개발자 로컬 절대경로(`/Users/channy/workspace/harnex`)를 가리키는 점도 재현 불가능한 참조입니다.
- **chat 세션 저장의 의미 축소.** `FileConversationStore.finish()`는 **의도적으로 아무 것도 하지 않습니다**(빈 구현). 또한 `load`/`append`/`replace`가 `conversationId`를 무시하고 파일 경로(세션 ID)만으로 동작하므로, 같은 프로세스에서 서브 대화 ID(`${conversationId}:${turnId}:${target}` 등)를 쓰는 경우 **에이전트 이름만으로 대화가 구분**됩니다.
- **로컬 도구는 샌드박스가 아닙니다.** `bash`는 `shell: true`로 사용자 권한 그대로 실행되며(`chat/tools.ts`), `docs/specs/chat-runtime.md`도 "작업 디렉터리는 경로 해석 기준이며 OS 샌드박스는 아닙니다"라고 명시합니다.
- **`tools[]` 선언의 조용한 무시 가능성.** `#tools()`는 `tool`도 `agent`도 없는 객체 항목(예: `hint`만 있는 항목)을 그냥 건너뜁니다. 스키마의 `oneOf`가 1차 방어선이지만 `validateConfig`는 `tools` 배열 항목을 검사하지 않습니다(`packages/core/src/config.ts`의 `validateAgent`는 `model`, `params`, `hooks`, `extensions`만 검사).
- **`{agent: ...}` 도구의 입력 스키마가 느슨함.** `input: { type: "object" }`만 넘기므로 하위 에이전트 호출 인자에 대한 모델 측 스키마 가이드가 없습니다.
- **`validateConfig`와 JSON Schema의 엄격도 차이.** 스키마는 `additionalProperties: false`이지만 `validateConfig`는 `{...value}` 스프레드로 미지의 키를 통과시킵니다. → `gdn validate`만으로는 스키마 위반을 모두 잡지 못할 수 있습니다(스키마 검증을 코드에서 수행하는 지점은 이번 조사에서 확인하지 못했습니다).
- **구성 합성의 엄격한 규칙.** 같은 합성 그래프에서 같은 실제 파일을 두 번 참조하면 `Duplicate config resource`로 **오류**입니다(중복 허용이 아님). 순환도 오류. 배열·스칼라는 병합되지 않고 뒤 값으로 전체 교체됩니다.
- **훅 실패 정책의 비직관적 기본값.** `#pipeline`은 `spec.optional ?? Boolean(spec.agent)`를 쓰므로, `agent` 훅은 **명시하지 않아도 optional로 동작**합니다.
- **이벤트 리스너는 순차 await.** `RuntimeEvents.emit`이 리스너를 `for ... await`로 직렬 실행하므로 느린 리스너가 턴 진행을 지연시킵니다.
- **성능/가독성 트레이드오프.** `runtime.ts`는 486줄이지만 한 줄에 여러 문장을 담은 고밀도 스타일이라, 코드 리뷰 시 줄 단위 diff로는 변경 파악이 어렵습니다(해석).

### 5.3 작업 시 지켜야 할 규칙 (문서 근거)

- 파일을 수정하려면 해당 폴더부터 루트까지의 모든 `AGENTS.md`를 먼저 읽고, 수정 후 최신화해야 합니다(루트 `AGENTS.md` Constitution 1·2·4).
- 타입 단언(`as`, `as unknown as`) 금지 — 실제로 `runtime.ts`/`config.ts`는 `isMessage`, `isToolResult`, `isModelInput` 등 타입 가드 함수로 구성되어 있습니다.
- `@goondan/*` npm 패키지는 단일 버전 정책(현재 `0.0.3-alpha29`)이며, `packages/base/goondan.yaml`의 `spec.version`과 맞춰 배포합니다.
- `@goondan/base`는 npm이 아니라 `gdn package publish`로만 배포합니다.
- 0.0.x 단계이므로 하위 호환보다 아키텍처 정합성을 우선한다고 루트 `AGENTS.md`가 명시합니다.

---

## 6. 추가 확인이 필요한 사항

이번 12회 호출 예산 안에서 **확인하지 못한** 항목입니다. 추정으로 단정하지 않았습니다.

1. `gdn-legacy` 경로 전체(`packages/cli/src/bin.ts`, `parser.ts`, `router.ts`, `services/runtime.ts`, `packages/runtime`의 Orchestrator/AgentProcess) — 레거시 `apiVersion: goondan.ai/v1` 매니페스트가 어떻게 로드·실행되는지.
2. `spec/goondan.schema.json`을 실제로 검증에 사용하는 코드 경로 존재 여부(`gdn validate`는 `validateConfig`만 호출하는 것으로 확인).
3. `packages/core/src/runtime.ts`에서 출력이 잘린 구간의 세부: `#appendToolResult` 본문, `#inputMessage`, `#callFunction`, `#timeout`, `#emit`, `prewarm` 전체 구현.
4. `packages/base`의 실제 도구·확장·커넥터 목록과 신형 구성에서의 사용 가능 여부.
5. `python/goondan/goondan/runtime.py`의 구현 내용과 TS와의 실제 동등성(conformance 테스트는 실행하지 않았습니다).
6. `packages/studio`, `packages/registry`, `packages/eval`, `e2e/`의 동작.
7. `PURE_HARNESS_MIGRATION_PLAN.md`의 전환 계획 내용 — 위 5.1-5의 두 구성 형식 공존이 언제 정리되는지.
