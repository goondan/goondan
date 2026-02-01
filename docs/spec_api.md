# Goondan Runtime/SDK API 스펙 (v0.8)

본 문서는 `goondan_spec.md`를 기반으로 런타임과 확장(Extension/Tool/Connector)의 **실행 API**를 정의한다. 구성 스펙은 `docs/spec_config.md`를 따른다.

## 1. 공통 타입 요약

- `JsonObject`: JSON 호환 객체
- `ObjectRefLike`: `Kind/name` 문자열 또는 `{ kind, name }` 객체
- `Resource<TSpec>`: Config Plane 리소스 공통 형태

## 2. Extension API

### 2.1 엔트리포인트

Extension 모듈은 `register(api)` 함수를 **반드시** 제공해야 한다.

```ts
export async function register(api: ExtensionApi): Promise<void>
```

### 2.2 ExtensionApi

```ts
interface ExtensionApi<State = JsonObject, Config = JsonObject> {
  extension: Resource<ExtensionSpec<Config>>;
  pipelines: PipelineApi<StepContext>;
  tools: { register: (toolDef: DynamicToolDefinition) => void };
  events: EventBus;
  liveConfig: LiveConfigApi;
  extState: () => State;
}
```

- `pipelines.mutate(point, fn)`: 파이프라인 단계별 컨텍스트 변형
- `pipelines.wrap(point, fn)`: LLM/tool 실행을 미들웨어로 래핑
- `tools.register`: 동적 Tool 등록
- `events.emit/on`: 런타임 이벤트 버스
- `liveConfig.proposePatch`: Live Config patch 제안
- `extState()`: 확장별 상태 저장소

### 2.3 Pipeline Point

`PipelinePoint`는 다음 값을 가진다.

```
turn.pre | turn.post
step.pre | step.config | step.tools | step.blocks | step.llmCall | step.post
toolCall.pre | toolCall.exec | toolCall.post
workspace.repoAvailable | workspace.worktreeMounted
```

## 3. Tool API

Tool 모듈은 `handlers` 맵 또는 default export로 핸들러를 제공한다.

```ts
export type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;

export const handlers = {
  "tool.name": async (ctx, input) => { ... }
}
```

예: fileRead 도구 (base)
```ts
export const handlers = {
  "file.read": async (_ctx, input) => {
    // input: { path, encoding?, maxBytes? }
  }
}
```

### 3.1 ToolContext

```ts
interface ToolContext {
  instance: unknown;
  swarm: Resource<SwarmSpec>;
  agent: Resource<AgentSpec>;
  turn: Turn;
  step: Step;
  toolCatalog: ToolCatalogItem[];
  liveConfig: LiveConfigApi;
  oauth: { getAccessToken: (request) => Promise<JsonObject> };
  events: EventBus;
  logger: Console;
}
```

- `toolCatalog`는 현재 Step에서 노출된 도구 목록이다.
- `liveConfig.proposePatch`로 다음 Step의 toolset 확장 제안이 가능하다.

### 3.2 ToolCatalogItem

```ts
interface ToolCatalogItem {
  name: string;
  description?: string;
  parameters?: JsonObject;
  tool?: Resource<ToolSpec> | null;
  export?: ToolExportSpec | null;
  source?: JsonObject;
}
```

## 4. Connector API

Connector는 외부 이벤트를 Runtime에 전달하는 어댑터이다.

```ts
interface ConnectorAdapter {
  handleEvent(payload: JsonObject): Promise<void>;
  postMessage?: (input: {
    channel: string;
    text: string;
    threadTs?: string;
    origin?: JsonObject;
    auth?: JsonObject;
  }) => Promise<unknown>;
}
```

Runtime은 다음 형태의 이벤트 입력을 받는다.

```ts
runtime.handleEvent({
  swarmRef: ObjectRefLike,
  instanceKey: string,
  agentName?: string,
  input: string,
  origin?: JsonObject,
  auth?: JsonObject,
  metadata?: JsonObject
})
```

## 5. Live Config API

```ts
interface LiveConfigApi {
  proposePatch(proposal: LiveConfigPatchProposal): Promise<JsonValue> | JsonValue;
}
```

Patch proposal 스키마는 `goondan_spec.md`의 §12.4를 따른다.

```json
{
  "scope": "agent",
  "target": { "kind": "AgentInstance", "name": "planner" },
  "applyAt": "step.config",
  "patch": {
    "type": "json6902",
    "ops": [
      { "op": "add", "path": "/spec/tools/-", "value": { "kind": "Tool", "name": "toolSearch" } }
    ]
  },
  "source": { "type": "tool", "name": "toolSearch.find" },
  "reason": "다음 Step부터 Tool 활성화"
}
```

## 6. Bundle API (확장 등록)

Bundle은 Tool/Extension/Connector를 **묶어서 등록**하기 위한 매니페스트이다.

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Bundle
metadata:
  name: base
spec:
  dependencies:
    - github.com/goondan/foo-bar@v0.2.0
  include:
    - tools/fileRead/tool.yaml
    - extensions/skills/extension.yaml
```

- `spec.dependencies`는 Bundle Ref 목록이다.
- `spec.include`는 최종 Config에 포함할 YAML 파일 목록이다.
- 번들 로더는 `spec.entry` 경로를 **Bundle Root 기준으로 해석**한다.
- `spec.include`는 다운로드 범위를 제한하지 않으며, Bundle Root 전체를 내려받는다.

## 7. CLI (core)

```bash
# init (goondan.yaml 생성)
 goondan init [--force]

# 실행
 goondan run -c <config.yaml> -b <bundle.yaml> --input "hello"
 goondan run --new

# config 검증
 goondan validate -c <config.yaml> --strict

# config export
 goondan export -c <config.yaml> -b <bundle.yaml> --format yaml

 # 번들 등록
 goondan bundle add <bundle.yaml>
 goondan bundle add github.com/goondan/goondan/base
 goondan bundle enable <name>
 goondan bundle disable <name>
 goondan bundle info <name|path>
 goondan bundle validate <name|path> [--strict]
 goondan bundle verify <name|path>
 goondan bundle lock [--output <path>] [--all]
 goondan bundle verify-lock [--lock <path>]
 goondan bundle refresh <name>
 goondan bundle list
 goondan bundle remove <name>
```

- `run`은 Swarm을 초기화하고 단일 Turn을 실행한다.
- `run --new`는 새로운 SwarmInstance 키를 생성하여 실행한다.
- `init`은 기본 goondan.yaml 템플릿을 생성한다.
- `init`은 base 번들을 Git Bundle로 자동 등록한다.
- `run`에서 `-c/--config`가 없으면 cwd의 `goondan.yaml`을 기본으로 사용한다.
- CLI 인자 파싱은 optique 기반으로 구성한다.
- `validate --strict`는 entry 존재/중복 리소스 체크까지 수행한다.
- `export`는 Bundle+Config를 합친 리소스를 YAML/JSON으로 출력한다.
- `bundle` 명령은 `state/bundles.json`에 등록 정보를 저장하며, enable/disable 플래그로 로딩 여부를 제어한다.
- `bundle validate`는 기본적으로 스키마 수준만 검사하고, `--strict`로 참조 검증/entry 존재 여부/중복 리소스 체크까지 수행한다.
- `bundle verify/refresh`는 등록된 fingerprint를 비교/갱신하여 번들 무결성을 확인한다.
- `bundle lock/verify-lock`는 번들들의 고정 fingerprint 스냅샷을 생성/검증한다.
- `bundle add <bundleRef>`는 Git 기반 Bundle을 내려받아 캐시에 설치한다.
- `bundle add <path>`는 로컬 `bundle.yaml` 경로를 등록한다.
- npm은 선택적 호스팅 채널로만 사용할 수 있으며, 필수 요건은 아니다.
- `--mock` 옵션으로 외부 LLM 없이도 실행 가능하다.
