# Goondan Config Plane 리소스 정의 스펙 (v2.0)

본 문서는 `docs/requirements/06_config-spec.md`(리소스 공통 형식, ObjectRef, Selector+Overrides, ValueSource)와 `docs/requirements/07_config-resources.md`(각 리소스 Kind별 정의)를 기반으로 Config Plane 리소스의 상세 스키마, TypeScript 인터페이스, 검증 규칙을 정의한다.

> **v2.0 주요 변경사항:**
> - `apiVersion`: `agents.example.io/v1alpha1` -> `goondan.ai/v1`
> - Kind 축소: 11종 -> **8종** (OAuthApp, ResourceType, ExtensionHandler 제거)
> - `runtime` 필드 제거: Tool, Extension, Connector 모두 항상 Bun으로 실행
> - Tool: `exports` 배열 기반 하위 도구 선언, 도구 이름 `{ToolName}__{subName}` 형식
> - Connector: `triggers` 필드 제거, 프로토콜 자체 관리
> - Agent: hooks/changesets 제거, 미들웨어 기반 라이프사이클
> - Model: `apiKey` 필드 추가 (ValueSource)
> - ObjectRef: `"Kind/name"` 문자열 축약형

---

## 목차

1. [리소스 공통 형식](#1-리소스-공통-형식)
2. [Metadata 구조](#2-metadata-구조)
3. [ObjectRef 참조 문법](#3-objectref-참조-문법)
4. [Selector + Overrides 조립 문법](#4-selector--overrides-조립-문법)
5. [ValueSource / SecretRef 타입](#5-valuesource--secretref-타입)
6. [리소스 Kind별 스키마](#6-리소스-kind별-스키마)
   - [6.1 Model](#61-model)
   - [6.2 Tool](#62-tool)
   - [6.3 Extension](#63-extension)
   - [6.4 Agent](#64-agent)
   - [6.5 Swarm](#65-swarm)
   - [6.6 Connector](#66-connector)
   - [6.7 Connection](#67-connection)
   - [6.8 Package](#68-package)
7. [공통 타입 정의](#7-공통-타입-정의)
8. [Validation 규칙 요약](#8-validation-규칙-요약)

---

## 1. 리소스 공통 형식

모든 Config Plane 리소스는 다음 필드를 MUST 포함한다.

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
  labels: {}          # 선택
  annotations: {}     # 선택
spec:
  # Kind별 스키마
```

### TypeScript 인터페이스

```typescript
/**
 * 모든 리소스의 기본 형태
 */
interface Resource<T = unknown> {
  /** API 버전. "goondan.ai/v1" */
  apiVersion: string;
  /** 리소스 종류 */
  kind: string;
  /** 메타데이터 */
  metadata: ResourceMetadata;
  /** Kind별 스펙 */
  spec: T;
}

/**
 * v2에서 지원하는 8종의 Kind
 */
type KnownKind =
  | 'Model'
  | 'Agent'
  | 'Swarm'
  | 'Tool'
  | 'Extension'
  | 'Connector'
  | 'Connection'
  | 'Package';
```

### 규칙

1. `apiVersion`은 MUST `goondan.ai/v1`이어야 한다.
2. `kind`는 MUST 8종의 알려진 Kind 중 하나여야 한다: `Model`, `Agent`, `Swarm`, `Tool`, `Extension`, `Connector`, `Connection`, `Package`.
3. `metadata.name`은 MUST 동일 Kind 내에서 고유해야 한다.
4. 단일 YAML 파일에 여러 문서를 `---`로 구분하여 포함할 수 있다 (MAY).
5. 비호환 변경은 `version` 상승(예: `v1` -> `v2`)으로 표현해야 한다 (MUST).
6. Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다 (MUST).

---

## 2. Metadata 구조

### TypeScript 인터페이스

```typescript
/**
 * 리소스 메타데이터
 */
interface ResourceMetadata {
  /** 리소스 이름 (동일 Kind 내 고유) */
  name: string;

  /** 라벨 (선택) - Selector 매칭에 사용 */
  labels?: Record<string, string>;

  /** 어노테이션 (선택) - 임의의 메타데이터 저장 */
  annotations?: Record<string, string>;
}
```

### YAML 예시

```yaml
metadata:
  name: my-resource
  labels:
    tier: base
    env: production
  annotations:
    description: "프로덕션 환경용 리소스"
    author: "team-a"
```

### 규칙

1. `name`은 MUST 비어있지 않은 문자열이어야 한다.
2. `name`은 SHOULD 영문 소문자, 숫자, 하이픈(`-`)으로 구성되며, 영문 소문자로 시작해야 한다.
3. `name`은 SHOULD 63자를 초과하지 않아야 한다.
4. `labels`의 키와 값은 MUST 문자열이어야 한다.
5. `labels`는 MAY Selector에서 리소스 매칭에 사용될 수 있다.
6. `annotations`는 런타임 동작에 영향을 주지 않는 메타 정보 저장용이다.

---

## 3. ObjectRef 참조 문법

ObjectRef는 다른 리소스를 참조하는 방법을 정의한다.

### TypeScript 인터페이스

```typescript
/**
 * 객체 참조의 유니온 타입.
 * 문자열 축약형 "Kind/name" 또는 객체형.
 */
type ObjectRefLike = string | ObjectRef;

/**
 * 객체형 참조
 */
interface ObjectRef {
  /** 리소스 종류 */
  kind: string;
  /** 리소스 이름 */
  name: string;
  /** 패키지 이름 (선택, Package 간 참조 시 사용) */
  package?: string;
  /** API 버전 (선택) */
  apiVersion?: string;
}

/**
 * ObjectRef를 정규화하는 함수
 */
function normalizeObjectRef(ref: ObjectRefLike): ObjectRef {
  if (typeof ref === 'string') {
    // "Kind/name" 형식 파싱
    const slashIndex = ref.indexOf('/');
    if (slashIndex === -1 || slashIndex === 0 || slashIndex === ref.length - 1) {
      throw new Error(`Invalid ObjectRef string: ${ref}`);
    }
    const kind = ref.slice(0, slashIndex);
    const name = ref.slice(slashIndex + 1);
    if (name.includes('/')) {
      throw new Error(`Invalid ObjectRef string (multiple slashes): ${ref}`);
    }
    return { kind, name };
  }
  return ref;
}
```

### YAML 예시

```yaml
# 문자열 축약 형식 (권장)
modelRef: "Model/claude"
toolRef: "Tool/bash"
agentRef: "Agent/coder"

# 객체형 참조
modelRef:
  kind: Model
  name: claude

# 패키지 참조 (다른 Package의 리소스 참조)
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

### 규칙

1. 문자열 축약 형식은 MUST `Kind/name` 패턴을 따라야 한다.
2. 객체형 참조는 MUST `kind`와 `name` 필드를 포함해야 한다.
3. `apiVersion`은 MAY 생략할 수 있으며, 생략 시 `goondan.ai/v1`을 사용한다.
4. 참조된 리소스가 존재하지 않으면 검증 단계에서 오류로 처리해야 한다 (MUST).
5. `package`는 MAY Package 간 참조 시 참조 범위를 명시하는 데 사용할 수 있다.
6. `/`가 없거나 2개 이상이면 검증 오류로 처리해야 한다 (MUST).

---

## 4. Selector + Overrides 조립 문법

Selector는 라벨 기반으로 리소스를 선택하고, Overrides로 선택된 리소스의 일부 설정을 덮어쓸 수 있다.

### TypeScript 인터페이스

```typescript
/**
 * 리소스 선택자
 */
interface Selector {
  /** 선택할 리소스 종류 (선택) */
  kind?: string;
  /** 특정 리소스 이름으로 선택 */
  name?: string;
  /** 라벨 기반 선택 */
  matchLabels?: Record<string, string>;
}

/**
 * Selector + Overrides 블록
 */
interface SelectorWithOverrides {
  /** 리소스 선택자 */
  selector: Selector;
  /** 선택된 리소스에 적용할 덮어쓰기 */
  overrides?: {
    spec?: Record<string, unknown>;
    metadata?: Partial<ResourceMetadata>;
  };
}

/**
 * ObjectRef 또는 Selector+Overrides의 유니온
 */
type RefOrSelector = ObjectRefLike | SelectorWithOverrides;
```

### YAML 예시

```yaml
# 단일 이름 선택
tools:
  - selector:
      kind: Tool
      name: bash

# 라벨 기반 선택 + 오버라이드
tools:
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000

# Agent에서 혼합 사용 (ref + selector)
tools:
  - ref: "Tool/bash"
  - ref: "Tool/file-system"
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000
```

### 병합 규칙

1. `selector` 블록이 있으면 MUST 선택형으로 해석한다.
2. `matchLabels`의 모든 키-값 쌍이 일치하는 리소스만 선택된다 (MUST, AND 조건).
3. 병합 규칙 (SHOULD):
   - **객체**: 재귀적으로 병합
   - **스칼라**: 덮어쓰기
   - **배열**: 전체 교체 (요소 병합 아님)
4. `selector.name`과 `selector.matchLabels`가 동시에 있으면 AND 조건으로 해석한다 (MUST).

---

## 5. ValueSource / SecretRef 타입

환경 변수나 비밀 저장소에서 값을 주입하기 위한 패턴을 정의한다.

### TypeScript 인터페이스

```typescript
/**
 * 값 소스 - 직접 값 또는 외부 소스에서 주입
 */
type ValueSource =
  | { value: string; valueFrom?: never }
  | { value?: never; valueFrom: ValueFrom };

/**
 * 외부 소스에서 값 주입
 */
type ValueFrom =
  | { env: string; secretRef?: never }
  | { env?: never; secretRef: SecretRef };

/**
 * 비밀 저장소 참조
 */
interface SecretRef {
  /** Secret 참조 (예: "Secret/slack-oauth") */
  ref: string;
  /** Secret 내의 키 */
  key: string;
}
```

### YAML 예시

```yaml
# 직접 값
apiKey:
  value: "plain-text-value"

# 환경 변수에서 주입 (권장)
apiKey:
  valueFrom:
    env: "ANTHROPIC_API_KEY"

# 비밀 저장소에서 주입
clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/slack-oauth"
      key: "client_secret"
```

### 규칙

1. `value`와 `valueFrom`은 MUST 동시에 존재할 수 없다.
2. `valueFrom` 내에서 `env`와 `secretRef`는 MUST 동시에 존재할 수 없다.
3. `secretRef.ref`는 MUST `"Secret/<name>"` 형식이어야 한다.
4. Base Config에 비밀값을 직접 포함하지 않도록 SHOULD 한다.
5. 둘 다 없으면 검증 오류로 처리한다 (MUST).

---

## 6. 리소스 Kind별 스키마

### 6.1 Model

Model은 LLM 프로바이더 설정을 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * Model 리소스 스펙
 */
interface ModelSpec {
  /** LLM 제공자 (anthropic, openai, google 등) */
  provider: string;
  /** 모델 이름 (예: "claude-sonnet-4-20250514", "gpt-5") */
  model: string;
  /** API 키 (ValueSource) */
  apiKey?: ValueSource;
  /** 커스텀 엔드포인트 URL (선택) */
  endpoint?: string;
  /** 제공자별 추가 옵션 (선택) */
  options?: Record<string, unknown>;
  /** 모델 기능 선언 (선택) */
  capabilities?: ModelCapabilities;
}

/**
 * 모델 기능 선언
 */
interface ModelCapabilities {
  /** 스트리밍 응답 지원 여부 */
  streaming?: boolean;
  /** Tool Calling 지원 여부 */
  toolCalling?: boolean;
  /** 확장 가능한 기능 플래그 */
  [key: string]: boolean | undefined;
}

type ModelResource = Resource<ModelSpec>;
```

#### YAML 예시

```yaml
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
kind: Model
metadata:
  name: gpt
  labels:
    provider: openai
spec:
  provider: openai
  model: gpt-5
  apiKey:
    valueFrom:
      env: OPENAI_API_KEY
  endpoint: "https://api.openai.com/v1"
  options:
    organization: "org-xxxxx"
  capabilities:
    streaming: true
    toolCalling: true
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `provider` | MUST | string | 비어있지 않은 문자열 |
| `model` | MUST | string | 비어있지 않은 문자열 |
| `apiKey` | MAY | ValueSource | 유효한 ValueSource |
| `endpoint` | MAY | string | 유효한 URL 형식 |
| `options` | MAY | object | 임의의 키-값 쌍 |
| `capabilities` | MAY | object | 모델 기능 플래그 |

**추가 검증 규칙:**
- Agent가 요구하는 capability(`toolCalling`, `streaming` 등)를 모델이 선언하지 않은 경우, Runtime은 로드 단계에서 거부해야 한다 (MUST).
- Runtime은 provider 차이를 추상화한 공통 호출 인터페이스를 제공해야 한다 (MUST).
- provider 전용 옵션은 `spec.options`로 캡슐화해야 한다 (MUST).

---

### 6.2 Tool

Tool은 LLM이 호출할 수 있는 함수를 정의한다. 모든 Tool은 Bun으로 실행된다 (`runtime` 필드 없음).

#### TypeScript 인터페이스

```typescript
/**
 * Tool 리소스 스펙
 */
interface ToolSpec {
  /** 엔트리 파일 경로 (Bundle Root 기준, Bun으로 실행) */
  entry: string;
  /** 에러 메시지 최대 길이 (기본값: 1000) */
  errorMessageLimit?: number;
  /** 내보내는 함수 목록 */
  exports: ToolExport[];
}

/**
 * Tool이 내보내는 함수 정의
 */
interface ToolExport {
  /** 함수 이름 (예: "exec"). LLM에는 "{ToolName}__{name}"로 노출 */
  name: string;
  /** 함수 설명 (LLM에 제공) */
  description: string;
  /** JSON Schema 형식의 파라미터 정의 */
  parameters: JsonSchema;
}

/**
 * JSON Schema 타입 (간략화)
 */
interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  default?: unknown;
}

type ToolResource = Resource<ToolSpec>;
```

#### YAML 예시

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
  labels:
    tier: base
spec:
  entry: "./tools/bash/index.ts"
  errorMessageLimit: 1200
  exports:
    - name: exec                       # LLM에는 "bash__exec"로 노출
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
    - name: script                     # LLM에는 "bash__script"로 노출
      description: "스크립트 파일 실행"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]

---
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: file-system
  labels:
    tier: base
    category: filesystem
spec:
  entry: "./tools/file-system/index.ts"
  exports:
    - name: read                       # LLM에는 "file-system__read"로 노출
      description: "파일을 읽습니다"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
    - name: write                      # LLM에는 "file-system__write"로 노출
      description: "파일에 내용을 씁니다"
      parameters:
        type: object
        properties:
          path: { type: string }
          content: { type: string }
        required: [path, content]
```

#### Tool Handler 구현 형식

entry 모듈은 `handlers: Record<string, ToolHandler>` 형식으로 하위 도구 핸들러를 export해야 한다 (MUST).

```typescript
export const handlers: Record<string, ToolHandler> = {
  'exec': async (ctx, input) => {
    const proc = Bun.spawn(['sh', '-c', input.command]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
  'script': async (ctx, input) => {
    const proc = Bun.spawn(['sh', input.path]);
    const output = await new Response(proc.stdout).text();
    return { stdout: output, exitCode: proc.exitCode };
  },
};

interface ToolHandler {
  (ctx: ToolContext, input: JsonObject): Promise<JsonValue>;
}

interface ToolContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly message: Message;
  readonly logger: Console;
}
```

#### 도구 이름 규칙

LLM에 노출되는 도구 이름은 **`{Tool metadata.name}__{export name}`** 형식이다 (MUST).

```
Tool 리소스: bash          ->  exports: exec, script
LLM 도구 이름:  bash__exec,  bash__script

Tool 리소스: file-system   ->  exports: read, write
LLM 도구 이름:  file-system__read,  file-system__write
```

`__` (더블 언더스코어)는 AI SDK에서 허용되는 문자이므로 별도 변환 없이 그대로 사용한다.

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `entry` | MUST | string | 유효한 파일 경로 |
| `errorMessageLimit` | MAY | number | 양의 정수, 기본값 1000 |
| `exports` | MUST | array | 최소 1개 이상의 export |
| `exports[].name` | MUST | string | 비어있지 않은 문자열, Tool 내 고유 |
| `exports[].description` | MUST | string | 비어있지 않은 문자열 |
| `exports[].parameters` | MUST | object | 유효한 JSON Schema |

**추가 검증 규칙:**
- `runtime` 필드는 존재하지 않는다. 항상 Bun으로 실행한다.
- `exports[].name`은 Tool 리소스 내에서 고유해야 한다 (MUST).
- Tool 리소스 이름과 export name에는 `__`가 포함되어서는 안 된다 (MUST NOT).
- `auth` 필드는 v2에서 제거되었다. OAuth 인증이 필요한 경우 Extension 내부에서 구현한다.

---

### 6.3 Extension

Extension은 라이프사이클 미들웨어 인터셉터를 정의한다. 모든 Extension은 Bun으로 실행된다 (`runtime` 필드 없음).

#### TypeScript 인터페이스

```typescript
/**
 * Extension 리소스 스펙
 */
interface ExtensionSpec {
  /** 엔트리 파일 경로 (Bundle Root 기준, Bun으로 실행) */
  entry: string;
  /** Extension별 설정 (선택, 자유 형식) */
  config?: Record<string, unknown>;
}

type ExtensionResource = Resource<ExtensionSpec>;
```

#### YAML 예시

```yaml
# 로깅 Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: logging
spec:
  entry: "./extensions/logging/index.ts"
  config:
    level: info

---
# Skill Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: skills
spec:
  entry: "./extensions/skills/index.ts"
  config:
    discovery:
      repoSkillDirs: [".claude/skills", ".agents/skills"]

---
# MCP 연동 Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: mcp-github
spec:
  entry: "./extensions/mcp/index.ts"
  config:
    transport:
      type: stdio
      command: ["npx", "-y", "@acme/github-mcp"]
    expose:
      tools: true
      resources: true
      prompts: true

---
# Compaction Extension
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: compaction
spec:
  entry: "./extensions/compaction/index.ts"
  config:
    maxTokens: 8000
    enableLogging: true
```

#### Extension entry 모듈

entry 모듈은 `register(api: ExtensionApi)` 함수를 export해야 한다 (MUST).

```typescript
export function register(api: ExtensionApi): void {
  // 미들웨어 등록
  api.pipeline.register('turn', async (ctx) => {
    const result = await ctx.next();
    return result;
  });

  // 동적 도구 등록
  api.tools.register(catalogItem, handler);

  // 상태 관리
  const state = await api.state.get();
  await api.state.set(newState);
}
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `entry` | MUST | string | 유효한 파일 경로 |
| `config` | MAY | object | Extension별 자유 형식 |

**추가 검증 규칙:**
- `runtime` 필드는 존재하지 않는다. 항상 Bun으로 실행한다.
- Extension은 `api.pipeline.register()`를 통해 `turn`, `step`, `toolCall` 미들웨어를 등록할 수 있다 (MAY).
- Extension은 `api.tools.register()`를 통해 동적으로 도구를 등록할 수 있다 (MAY).
- Extension은 `api.state.get()`/`api.state.set()`을 통해 JSON 기반 상태를 영속화할 수 있다 (MAY).
- OAuth 인증이 필요한 경우 Extension이 직접 관리한다 (OAuthApp Kind 제거).

---

### 6.4 Agent

Agent는 에이전트 실행을 구성하는 중심 리소스이다.

#### TypeScript 인터페이스

```typescript
/**
 * Agent 리소스 스펙
 */
interface AgentSpec {
  /** 모델 설정 */
  modelConfig: AgentModelConfig;
  /** 프롬프트 설정 */
  prompts: AgentPrompts;
  /** 사용할 Tool 목록 */
  tools?: RefOrSelector[];
  /** 사용할 Extension 목록 */
  extensions?: RefOrSelector[];
}

/**
 * 모델 설정
 */
interface AgentModelConfig {
  /** Model 리소스 참조 */
  modelRef: ObjectRefLike;
  /** 모델 파라미터 */
  params?: ModelParams;
}

interface ModelParams {
  /** 샘플링 온도 (0.0 ~ 2.0) */
  temperature?: number;
  /** 최대 토큰 수 */
  maxTokens?: number;
  /** Top-P 샘플링 */
  topP?: number;
  /** 추가 파라미터 */
  [key: string]: unknown;
}

/**
 * 프롬프트 설정
 */
interface AgentPrompts {
  /** 시스템 프롬프트 (인라인) */
  systemPrompt?: string;
  /** 시스템 프롬프트 (파일 참조) */
  systemRef?: string;
}

type AgentResource = Resource<AgentSpec>;
```

#### YAML 예시

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
    params:
      temperature: 0.5

  prompts:
    systemPrompt: |
      You are a coding assistant.
    systemRef: "./prompts/coder.system.md"   # 선택: 외부 파일 참조

  tools:
    - ref: "Tool/bash"
    - ref: "Tool/file-system"
    - selector:
        kind: Tool
        matchLabels:
          tier: base

  extensions:
    - ref: "Extension/logging"
    - ref: "Extension/skills"

---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: reviewer
  labels:
    role: reviewer
spec:
  modelConfig:
    modelRef: "Model/claude"
    params:
      temperature: 0.3
      maxTokens: 4096

  prompts:
    systemRef: "./prompts/reviewer.system.md"

  tools:
    - ref: "Tool/file-system"

  extensions:
    - ref: "Extension/logging"
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `modelConfig.modelRef` | MUST | ObjectRefLike | 유효한 Model 참조 |
| `modelConfig.params.temperature` | MAY | number | 0.0 ~ 2.0 범위 |
| `modelConfig.params.maxTokens` | MAY | number | 양의 정수 |
| `prompts` | MUST | object | `systemPrompt` 또는 `systemRef` 중 하나 이상 |
| `prompts.systemPrompt` | MAY | string | 인라인 프롬프트 |
| `prompts.systemRef` | MAY | string | 파일 경로 |
| `tools` | MAY | array | ObjectRef 또는 Selector 배열 |
| `extensions` | MAY | array | ObjectRef 또는 Selector 배열 |

**추가 검증 규칙:**
- `prompts.systemPrompt`와 `prompts.systemRef`가 모두 존재하면 `systemRef`의 내용이 `systemPrompt` 뒤에 이어 붙여져야 한다 (MUST).
- Agent 리소스에는 `hooks` 필드가 존재하지 않는다. 모든 라이프사이클 개입은 Extension 미들웨어를 통해 구현해야 한다 (MUST).
- Agent 리소스에는 `changesets` 필드가 존재하지 않는다. 설정 변경은 Edit & Restart 모델을 사용한다.

---

### 6.5 Swarm

Swarm은 Agent들의 집합과 실행 정책을 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * Swarm 리소스 스펙
 */
interface SwarmSpec {
  /** 진입점 Agent */
  entryAgent: ObjectRefLike;
  /** 포함된 Agent 목록 */
  agents: RefOrSelector[];
  /** 실행 정책 */
  policy?: SwarmPolicy;
}

/**
 * Swarm 실행 정책
 */
interface SwarmPolicy {
  /** Turn당 최대 Step 수 */
  maxStepsPerTurn?: number;
  /** 인스턴스 라이프사이클 정책 */
  lifecycle?: SwarmLifecyclePolicy;
}

/**
 * 인스턴스 라이프사이클 정책
 */
interface SwarmLifecyclePolicy {
  /** 인스턴스 최대 수명 (초) */
  ttlSeconds?: number;
  /** GC 유예 기간 (초) */
  gcGraceSeconds?: number;
}

type SwarmResource = Resource<SwarmSpec>;
```

#### YAML 예시

```yaml
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
    - ref: "Agent/reviewer"
  policy:
    maxStepsPerTurn: 32
    lifecycle:
      ttlSeconds: 604800
      gcGraceSeconds: 86400
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `entryAgent` | MUST | ObjectRefLike | 유효한 Agent 참조 |
| `agents` | MUST | array | 최소 1개 이상의 Agent 참조 |
| `policy.maxStepsPerTurn` | MAY | number | 양의 정수, 기본값 32 |
| `policy.lifecycle.ttlSeconds` | MAY | number | 양의 정수 (초) |
| `policy.lifecycle.gcGraceSeconds` | MAY | number | 양의 정수 (초) |

**추가 검증 규칙:**
- `entryAgent`는 `agents` 배열에 포함된 Agent를 참조해야 한다 (MUST).
- `policy.maxStepsPerTurn` 값에 도달하면 Turn을 강제 종료해야 한다 (MUST).
- `policy.lifecycle`가 설정되면 Runtime은 인스턴스 TTL 및 GC 정책에 반영해야 한다 (SHOULD).
- v2에서 `changesets`, `liveConfig`, `queueMode` 정책은 제거되었다. 설정 변경은 Edit & Restart 모델을 사용한다.

---

### 6.6 Connector

Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 **독립 프로세스**를 정의한다. Connector는 프로토콜 처리(HTTP 서버, cron 스케줄러, WebSocket 등)를 **자체적으로** 관리한다. 모든 Connector는 Bun으로 실행된다 (`runtime` 필드 없음).

#### TypeScript 인터페이스

```typescript
/**
 * Connector 리소스 스펙
 */
interface ConnectorSpec {
  /** 엔트리 파일 경로 (단일 default export, Bun으로 실행) */
  entry: string;
  /** Connector가 emit할 수 있는 이벤트 스키마 */
  events: EventSchema[];
}

/**
 * 이벤트 스키마 선언
 */
interface EventSchema {
  /** 이벤트 이름 */
  name: string;
  /** 이벤트 속성 타입 선언 */
  properties?: Record<string, EventPropertyType>;
}

interface EventPropertyType {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}

type ConnectorResource = Resource<ConnectorSpec>;
```

#### YAML 예시

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: telegram
spec:
  entry: "./connectors/telegram/index.ts"
  events:
    - name: user_message
      properties:
        chat_id: { type: string }
    - name: command
      properties:
        chat_id: { type: string }
        command: { type: string }

---
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: cli
spec:
  entry: "./connectors/cli/index.ts"
  events:
    - name: user_input
```

#### Connector Handler 구현 형식

entry 모듈은 단일 default export 함수를 제공해야 한다 (MUST). Connector가 프로토콜 처리를 직접 구현한다.

```typescript
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  // Connector가 직접 HTTP 서버를 열어 웹훅 수신
  Bun.serve({
    port: Number(secrets.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      // 외부 페이로드 -> ConnectorEvent 정규화 후 Orchestrator로 전달
      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.message.text },
        properties: { chat_id: String(body.message.chat.id) },
        instanceKey: `telegram:${body.message.chat.id}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Telegram connector listening');
};
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `entry` | MUST | string | 유효한 파일 경로 |
| `events` | MUST | array | 최소 1개 이상의 이벤트 스키마 |
| `events[].name` | MUST | string | Connector 내 고유 |

**추가 검증 규칙:**
- `runtime` 필드는 존재하지 않는다. 항상 Bun으로 실행한다.
- `triggers` 필드는 존재하지 않는다. Connector가 프로토콜 수신을 자체적으로 관리한다.
- Entry 모듈에 단일 default export 함수가 존재해야 한다 (MUST).
- ConnectorEvent는 `instanceKey`를 포함하여 Orchestrator가 적절한 AgentProcess로 라우팅할 수 있게 해야 한다 (MUST).
- Connector는 Connection이 제공한 서명 시크릿을 사용하여 inbound 요청의 서명 검증을 수행해야 한다 (MUST).

---

### 6.7 Connection

Connection은 Connector를 실제 배포 환경에 바인딩하는 리소스이다. 시크릿 제공, ConnectorEvent 기반 ingress 라우팅 규칙, 서명 검증 시크릿 설정을 담당한다.

#### TypeScript 인터페이스

```typescript
/**
 * Connection 리소스 스펙
 */
interface ConnectionSpec {
  /** 참조할 Connector */
  connectorRef: ObjectRefLike;
  /** 바인딩할 Swarm 참조 */
  swarmRef?: ObjectRefLike;
  /** Connector 프로세스에 전달할 시크릿 */
  secrets?: Record<string, ValueSource>;
  /** 인바운드 라우팅 규칙 */
  ingress?: IngressConfig;
  /** 서명 검증 설정 */
  verify?: ConnectionVerify;
}

/**
 * Ingress 설정
 */
interface IngressConfig {
  /** 라우팅 규칙 */
  rules?: IngressRule[];
}

/**
 * Ingress 라우팅 규칙
 */
interface IngressRule {
  /** 매칭 조건 */
  match?: IngressMatch;
  /** 라우팅 설정 */
  route: IngressRoute;
}

/**
 * 이벤트 매칭 조건
 */
interface IngressMatch {
  /** ConnectorEvent.name과 매칭할 이벤트 이름 */
  event?: string;
  /** ConnectorEvent.properties 값과 매칭할 키-값 쌍 */
  properties?: Record<string, string | number | boolean>;
}

/**
 * 라우팅 설정
 */
interface IngressRoute {
  /** 대상 Agent (선택, 생략 시 Swarm entryAgent로 라우팅) */
  agentRef?: ObjectRefLike;
}

/**
 * Connection 서명 검증 설정
 */
interface ConnectionVerify {
  /** Webhook 서명 검증 */
  webhook?: {
    /** 서명 시크릿 (ValueSource 패턴) */
    signingSecret: ValueSource;
  };
}

type ConnectionResource = Resource<ConnectionSpec>;
```

#### YAML 예시

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  secrets:
    botToken:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}  # entryAgent로 라우팅
  verify:
    webhook:
      signingSecret:
        valueFrom:
          env: TELEGRAM_WEBHOOK_SECRET

---
# CLI Connection (가장 단순한 형태)
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: "Connector/cli"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}  # entryAgent로 라우팅
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `connectorRef` | MUST | ObjectRefLike | 유효한 Connector 참조 |
| `swarmRef` | MAY | ObjectRefLike | 유효한 Swarm 참조 (생략 시 Bundle 내 첫 번째 Swarm) |
| `secrets` | MAY | Record<string, ValueSource> | Connector에 전달할 시크릿 |
| `ingress.rules` | MAY | array | IngressRule 배열 |
| `ingress.rules[].match.event` | SHOULD | string | Connector의 events[].name에 선언된 이름 |
| `ingress.rules[].route.agentRef` | MAY | ObjectRefLike | 유효한 Agent 참조 |
| `verify.webhook.signingSecret` | MAY | ValueSource | 서명 시크릿 |

**추가 검증 규칙:**
- `connectorRef`는 유효한 Connector 리소스를 참조해야 한다 (MUST).
- `swarmRef`가 지정된 경우, 유효한 Swarm 리소스를 참조해야 한다 (MUST). 생략 시 Bundle 내 첫 번째 Swarm을 사용한다 (MUST).
- `secrets`는 Connector 프로세스에 환경변수 또는 컨텍스트로 전달되어야 한다 (MUST).
- 서명 검증 실패 시 Connector는 ConnectorEvent를 emit하지 않아야 한다 (MUST).
- 하나의 trigger가 여러 ConnectorEvent를 emit하면 각 event는 독립 Turn으로 처리되어야 한다 (MUST).
- `ingress.rules[].route.agentRef`가 생략되면 Swarm의 `entryAgent`로 라우팅한다 (MUST).
- OAuth 인증이 필요한 경우 Extension 내부에서 구현해야 한다. Connection은 OAuth를 직접 관리하지 않는다 (MUST NOT). `auth` 필드는 v2에서 제거되었다.

---

### 6.8 Package

Package는 프로젝트의 최상위 매니페스트 리소스이다. 의존성, 버전, 레지스트리 정보를 포함한다.

#### TypeScript 인터페이스

```typescript
/**
 * Package 리소스 스펙
 */
interface PackageSpec {
  /** 패키지 버전 (semver) */
  version?: string;
  /** 패키지 설명 */
  description?: string;
  /** 접근 수준 */
  access?: 'public' | 'restricted';
  /** 의존하는 Package 목록 */
  dependencies?: PackageDependency[];
  /** 레지스트리 설정 */
  registry?: PackageRegistry;
}

interface PackageDependency {
  /** 패키지 이름 (예: "@goondan/base") */
  name: string;
  /** 버전 범위 (semver range, 예: "^1.0.0") */
  version: string;
}

interface PackageRegistry {
  /** 레지스트리 URL */
  url: string;
}

type PackageResource = Resource<PackageSpec>;
```

#### YAML 예시

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "1.0.0"
  description: "코딩 에이전트 스웜"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
  registry:
    url: "https://registry.goondan.ai"
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `metadata.name` | MUST | string | 패키지 식별명 (scope 포함 가능: `@scope/name`) |
| `spec.version` | MUST (publish 시) | string | semver 형식 |
| `spec.access` | MAY | string | `'public'` (기본) 또는 `'restricted'` |
| `spec.dependencies` | MAY | array | PackageDependency 배열 |
| `spec.dependencies[].name` | MUST | string | 패키지 이름 |
| `spec.dependencies[].version` | MUST | string | semver 범위 |
| `spec.registry.url` | MAY | string | 유효한 URL |

**위치 규칙:**
1. Package 문서는 `goondan.yaml`의 **첫 번째 YAML 문서**에만 위치할 수 있다 (MUST).
2. 두 번째 이후 문서에 `kind: Package`가 있으면 검증 오류이다 (MUST).
3. 하나의 `goondan.yaml`에는 최대 하나의 Package 문서만 존재할 수 있다 (MUST).
4. `spec.dependencies`는 의존성 DAG를 형성하며, 순환 의존은 로드 단계에서 거부해야 한다 (MUST).

상세 스펙(레지스트리, 의존성 해석, lockfile 등)은 `docs/specs/bundle_package.md`를 참조한다.

---

## 7. 공통 타입 정의

### JSON 기본 타입

```typescript
/** JSON 원시 타입 */
type JsonPrimitive = string | number | boolean | null;

/** JSON 값 */
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** JSON 객체 */
type JsonObject = { [key: string]: JsonValue };

/** JSON 배열 */
type JsonArray = JsonValue[];
```

### 유틸리티 타입

```typescript
/**
 * 리소스 타입 가드
 */
function isResource(value: unknown): value is Resource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'apiVersion' in value &&
    'kind' in value &&
    'metadata' in value &&
    'spec' in value
  );
}

/**
 * Kind별 리소스 타입 가드
 */
function isResourceOfKind<K extends KnownKind>(
  value: unknown,
  kind: K
): value is Resource {
  return isResource(value) && value.kind === kind;
}

/**
 * ObjectRef 판별
 */
function isObjectRef(value: unknown): value is ObjectRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'name' in value
  );
}

/**
 * ObjectRefLike 판별 (문자열 또는 객체)
 */
function isObjectRefLike(value: unknown): value is ObjectRefLike {
  return typeof value === 'string' || isObjectRef(value);
}

/**
 * Selector 판별
 */
function isSelectorWithOverrides(value: unknown): value is SelectorWithOverrides {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selector' in value
  );
}
```

---

## 8. Validation 규칙 요약

### 공통 규칙

| 규칙 | 수준 | 설명 |
|------|------|------|
| apiVersion 필수 | MUST | 모든 리소스에 `goondan.ai/v1`이어야 함 |
| kind 필수 | MUST | 모든 리소스에 8종 Kind 중 하나여야 함 |
| metadata.name 필수 | MUST | 모든 리소스에 name이 있어야 함 |
| name 고유성 | MUST | 동일 Kind 내에서 name이 고유해야 함 |
| ObjectRef 유효성 | MUST | 참조된 리소스가 존재해야 함 |
| ValueSource 상호배타 | MUST | value와 valueFrom은 동시 불가 |
| secretRef 형식 | MUST | `Secret/<name>` 형식 준수 |

### Kind별 규칙

| Kind | 규칙 | 수준 |
|------|------|------|
| Model | provider, model 필수 | MUST |
| Model | Agent 요구 capability와 Model 선언 capability 매칭 | MUST |
| Tool | entry, exports 필수 | MUST |
| Tool | exports 최소 1개 | MUST |
| Tool | exports[].name Tool 내 고유 | MUST |
| Tool | 리소스 이름/export name에 `__` 금지 | MUST NOT |
| Extension | entry 필수 | MUST |
| Agent | modelConfig.modelRef 필수 | MUST |
| Agent | prompts (systemPrompt 또는 systemRef) 필수 | MUST |
| Swarm | entryAgent, agents 필수 | MUST |
| Swarm | entryAgent는 agents에 포함 | MUST |
| Connector | entry, events 필수 | MUST |
| Connector | events[].name Connector 내 고유 | MUST |
| Connection | connectorRef 필수 | MUST |
| Connection | swarmRef 지정 시 유효한 Swarm 참조 | MUST |
| Connection | ingress.rules[].match.event는 Connector events에 선언된 이름 | SHOULD |
| Package | 첫 번째 YAML 문서에만 위치 | MUST |
| Package | publish 시 version (semver) 필수 | MUST |
| Package | dependencies는 DAG (순환 참조 금지) | MUST |

### 검증 오류 형식

검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다 (MUST).

```typescript
interface ValidationError {
  /** 오류 코드 (예: "E_CONFIG_REF_NOT_FOUND") */
  code: string;
  /** 오류 메시지 */
  message: string;
  /** 리소스 내 위치 (예: "resources/agent.yaml#spec.tools[0]") */
  path: string;
  /** 사용자 복구를 위한 제안 */
  suggestion?: string;
  /** 도움말 URL */
  helpUrl?: string;
}
```

오류 예시:

```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/bash 참조를 찾을 수 없습니다.",
  "path": "resources/agent.yaml#spec.tools[0]",
  "suggestion": "kind/name 또는 package 범위를 확인하세요.",
  "helpUrl": "https://docs.goondan.ai/errors/E_CONFIG_REF_NOT_FOUND"
}
```

---

## 관련 문서

- `/docs/requirements/06_config-spec.md` - Config 스펙 요구사항
- `/docs/requirements/07_config-resources.md` - Config 리소스 정의 요구사항
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/bundle_package.md` - Package 스펙
- `/docs/new_spec.md` - Goondan v2 설계 스펙
- `/GUIDE.md` - 개발자 가이드
