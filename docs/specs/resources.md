# Goondan Config Plane 리소스 정의 스펙 (v0.9)

본 문서는 `docs/requirements/06_config-spec.md`(리소스 공통 형식, ObjectRef, Selector+Overrides, ValueSource)와 `docs/requirements/07_config-resources.md`(각 리소스 Kind별 정의)를 기반으로 Config Plane 리소스의 상세 스키마, TypeScript 인터페이스, 검증 규칙을 정의한다.

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
   - [6.7 OAuthApp](#67-oauthapp)
   - [6.8 ResourceType](#68-resourcetype)
   - [6.9 ExtensionHandler](#69-extensionhandler)
   - [6.10 Connection](#610-connection)
7. [공통 타입 정의](#7-공통-타입-정의)
8. [Validation 규칙 요약](#8-validation-규칙-요약)

---

## 1. 리소스 공통 형식

모든 Config Plane 리소스는 다음 필드를 MUST 포함한다.

```yaml
apiVersion: agents.example.io/v1alpha1
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
  /** API 버전 (예: "agents.example.io/v1alpha1") */
  apiVersion: string;
  /** 리소스 종류 */
  kind: string;
  /** 메타데이터 */
  metadata: ResourceMetadata;
  /** Kind별 스펙 */
  spec: T;
}

/**
 * 알려진 Kind의 유니온 타입
 */
type KnownKind =
  | 'Model'
  | 'Tool'
  | 'Extension'
  | 'Agent'
  | 'Swarm'
  | 'Connector'
  | 'Connection'
  | 'OAuthApp'
  | 'ResourceType'
  | 'ExtensionHandler'
  | 'Bundle';
```

### 규칙

1. `apiVersion`은 MUST 유효한 API 버전 문자열이어야 한다 (예: `agents.example.io/v1alpha1`).
2. `kind`는 MUST 알려진 Kind 또는 ResourceType으로 등록된 사용자 정의 Kind이어야 한다.
3. `metadata.name`은 MUST 동일 Kind 내에서 고유해야 한다.
4. 단일 YAML 파일에 여러 문서를 `---`로 구분하여 포함할 수 있다 (MAY).

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

  /** 네임스페이스 (선택, 향후 확장) */
  namespace?: string;
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
3. `labels`의 키와 값은 MUST 문자열이어야 한다.
4. `labels`는 MAY Selector에서 리소스 매칭에 사용될 수 있다.

---

## 3. ObjectRef 참조 문법

ObjectRef는 다른 리소스를 참조하는 방법을 정의한다.

### TypeScript 인터페이스

```typescript
/**
 * 객체 참조의 유니온 타입
 */
type ObjectRefLike = string | ObjectRef;

/**
 * 객체형 참조
 */
interface ObjectRef {
  /** API 버전 (선택) */
  apiVersion?: string;
  /** 리소스 종류 */
  kind: string;
  /** 리소스 이름 */
  name: string;
}

/**
 * ObjectRef를 정규화하는 함수
 */
function normalizeObjectRef(ref: ObjectRefLike): ObjectRef {
  if (typeof ref === 'string') {
    // "Kind/name" 형식 파싱
    const [kind, name] = ref.split('/');
    if (!kind || !name) {
      throw new Error(`Invalid ObjectRef string: ${ref}`);
    }
    return { kind, name };
  }
  return ref;
}
```

### YAML 예시

```yaml
# 문자열 축약 형식
tools:
  - Tool/fileRead
  - Tool/webSearch

# 객체형 참조
tools:
  - kind: Tool
    name: fileRead
  - kind: Tool
    name: webSearch

# 전체 참조 (apiVersion 포함)
tools:
  - apiVersion: agents.example.io/v1alpha1
    kind: Tool
    name: fileRead
```

### 규칙

1. 문자열 축약 형식은 MUST `Kind/name` 패턴을 따라야 한다.
2. 객체형 참조는 MUST `kind`와 `name` 필드를 포함해야 한다.
3. `apiVersion`은 MAY 생략할 수 있으며, 생략 시 현재 문서의 apiVersion을 사용한다.
4. 참조된 리소스가 존재하지 않으면 검증 단계에서 오류로 처리해야 한다 (MUST).

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
      name: fileRead

# 라벨 기반 선택 + 오버라이드
tools:
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000

# 여러 라벨 조건
extensions:
  - selector:
      kind: Extension
      matchLabels:
        category: mcp
        env: production
    overrides:
      spec:
        config:
          attach:
            mode: stateful
```

### 병합 규칙

```typescript
/**
 * 깊은 병합 함수
 */
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result = { ...base };

  for (const key in override) {
    const baseVal = base[key];
    const overrideVal = override[key];

    if (
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      // 객체: 재귀 병합
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      ) as T[typeof key];
    } else if (overrideVal !== undefined) {
      // 스칼라 또는 배열: 덮어쓰기
      result[key] = overrideVal as T[typeof key];
    }
  }

  return result;
}
```

### 규칙

1. `selector` 블록이 있으면 MUST 선택형으로 해석한다.
2. `matchLabels`의 모든 키-값 쌍이 일치하는 리소스만 선택된다 (MUST).
3. 병합 규칙 (SHOULD):
   - 객체: 재귀적으로 병합
   - 스칼라: 덮어쓰기
   - 배열: 전체 교체 (요소 병합 아님)
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

/**
 * ValueSource 해석 함수
 */
function resolveValueSource(
  source: ValueSource,
  ctx: {
    env: Record<string, string | undefined>;
    secrets: Record<string, Record<string, string>>;
  }
): string {
  if ('value' in source && source.value !== undefined) {
    return source.value;
  }

  if ('valueFrom' in source && source.valueFrom !== undefined) {
    const { valueFrom } = source;

    if ('env' in valueFrom && valueFrom.env !== undefined) {
      const envValue = ctx.env[valueFrom.env];
      if (envValue === undefined) {
        throw new Error(`Environment variable not found: ${valueFrom.env}`);
      }
      return envValue;
    }

    if ('secretRef' in valueFrom && valueFrom.secretRef !== undefined) {
      const { ref, key } = valueFrom.secretRef;
      // "Secret/name" 형식 파싱
      const match = ref.match(/^Secret\/(.+)$/);
      if (!match) {
        throw new Error(`Invalid secretRef format: ${ref}`);
      }
      const secretName = match[1];
      const secret = ctx.secrets[secretName];
      if (!secret) {
        throw new Error(`Secret not found: ${secretName}`);
      }
      const secretValue = secret[key];
      if (secretValue === undefined) {
        throw new Error(`Secret key not found: ${key} in ${secretName}`);
      }
      return secretValue;
    }
  }

  throw new Error('Invalid ValueSource: neither value nor valueFrom provided');
}
```

### YAML 예시

```yaml
# 직접 값
client:
  clientId:
    value: "my-client-id"

# 환경 변수에서 주입
client:
  clientId:
    valueFrom:
      env: "SLACK_CLIENT_ID"

# 비밀 저장소에서 주입
client:
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
5. 런타임은 `Secret`을 예약된 kind로 취급하고, 비밀 저장소 엔트리를 가리키는 것으로 해석해야 한다 (MUST).

---

## 6. 리소스 Kind별 스키마

### 6.1 Model

Model은 LLM 모델 설정을 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * Model 리소스 스펙
 */
interface ModelSpec {
  /** LLM 제공자 (openai, anthropic, google 등) */
  provider: string;
  /** 모델 이름 (예: "gpt-5", "claude-sonnet-4-5") */
  name: string;
  /** 커스텀 엔드포인트 URL (선택) */
  endpoint?: string;
  /** 제공자별 추가 옵션 (선택) */
  options?: Record<string, unknown>;
}

type ModelResource = Resource<ModelSpec>;
```

#### YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: openai-gpt-5
  labels:
    provider: openai
spec:
  provider: openai
  name: gpt-5
  endpoint: "https://api.openai.com/v1"
  options:
    organization: "org-xxxxx"

---
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: anthropic-claude
  labels:
    provider: anthropic
spec:
  provider: anthropic
  name: claude-sonnet-4-5
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `provider` | MUST | string | 비어있지 않은 문자열 |
| `name` | MUST | string | 비어있지 않은 문자열 |
| `endpoint` | MAY | string | 유효한 URL 형식 |
| `options` | MAY | object | 임의의 키-값 쌍 |

---

### 6.2 Tool

Tool은 LLM이 호출할 수 있는 함수 엔드포인트를 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * Tool 리소스 스펙
 */
interface ToolSpec {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (Bundle Root 기준) */
  entry: string;
  /** 에러 메시지 최대 길이 (기본값: 1000) */
  errorMessageLimit?: number;
  /** OAuth 인증 설정 (선택) */
  auth?: ToolAuth;
  /** 내보내는 함수 목록 */
  exports: ToolExport[];
}

/**
 * Tool 수준 인증 설정
 */
interface ToolAuth {
  /** 참조할 OAuthApp */
  oauthAppRef: ObjectRef;
  /** 필요한 스코프 (OAuthApp.spec.scopes의 부분집합) */
  scopes?: string[];
}

/**
 * Tool이 내보내는 함수 정의
 */
interface ToolExport {
  /** 함수 이름 (예: "slack.postMessage") */
  name: string;
  /** 함수 설명 (LLM에 제공) */
  description: string;
  /** JSON Schema 형식의 파라미터 정의 */
  parameters: JsonSchema;
  /** export 수준 인증 설정 (선택, Tool 수준보다 좁게만 가능) */
  auth?: {
    scopes?: string[];
  };
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
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: slackToolkit
  labels:
    tier: base
    category: communication
spec:
  runtime: node
  entry: "./tools/slack/index.js"
  errorMessageLimit: 1200

  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
    scopes: ["chat:write", "channels:read"]

  exports:
    - name: slack.postMessage
      description: "Slack 채널에 메시지를 전송합니다"
      parameters:
        type: object
        properties:
          channel:
            type: string
            description: "채널 ID"
          text:
            type: string
            description: "메시지 내용"
          threadTs:
            type: string
            description: "스레드 타임스탬프 (선택)"
        required: ["channel", "text"]
      auth:
        scopes: ["chat:write"]

    - name: slack.getChannels
      description: "사용 가능한 채널 목록을 조회합니다"
      parameters:
        type: object
        properties:
          limit:
            type: number
            description: "최대 결과 수"
            default: 100
      auth:
        scopes: ["channels:read"]
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `runtime` | MUST | enum | `"node"`, `"python"`, `"deno"` 중 하나 |
| `entry` | MUST | string | 유효한 파일 경로 |
| `errorMessageLimit` | MAY | number | 양의 정수, 기본값 1000 |
| `auth.oauthAppRef` | MAY | ObjectRef | 유효한 OAuthApp 참조 |
| `auth.scopes` | MAY | string[] | OAuthApp.spec.scopes의 부분집합 |
| `exports` | MUST | array | 최소 1개 이상의 export |
| `exports[].name` | MUST | string | 비어있지 않은 문자열 |
| `exports[].description` | MUST | string | 비어있지 않은 문자열 |
| `exports[].parameters` | MUST | object | 유효한 JSON Schema |
| `exports[].auth.scopes` | MAY | string[] | Tool.auth.scopes의 부분집합 |

**추가 검증 규칙:**
- `auth.scopes`가 선언된 경우, OAuthApp.spec.scopes의 부분집합인지 검증해야 한다 (MUST).
- `exports[].auth.scopes`가 선언된 경우, Tool.auth.scopes의 부분집합인지 검증해야 한다 (MUST).
- 스코프는 "추가 권한 요청"이 아닌 "범위 제한"의 의미로 사용된다 (MUST).

---

### 6.3 Extension

Extension은 런타임 라이프사이클에 개입하는 확장 로직을 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * Extension 리소스 스펙
 */
interface ExtensionSpec {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (Bundle Root 기준) */
  entry: string;
  /** Extension별 설정 (선택) */
  config?: Record<string, unknown>;
}

/**
 * MCP 연동 Extension의 config 구조
 */
interface McpExtensionConfig {
  /** MCP 서버 연결 방식 */
  transport: McpTransport;
  /** 연결 유지 방식 */
  attach: McpAttach;
  /** 노출할 기능 */
  expose: McpExpose;
}

interface McpTransport {
  /** stdio 또는 http */
  type: 'stdio' | 'http';
  /** stdio 모드에서 실행할 명령어 */
  command?: string[];
  /** http 모드에서 연결할 URL */
  url?: string;
}

interface McpAttach {
  /** stateful (연결 유지) 또는 stateless (요청마다 연결) */
  mode: 'stateful' | 'stateless';
  /** 연결 범위 */
  scope: 'instance' | 'agent';
}

interface McpExpose {
  /** MCP 도구 노출 여부 */
  tools?: boolean;
  /** MCP 리소스 노출 여부 */
  resources?: boolean;
  /** MCP 프롬프트 노출 여부 */
  prompts?: boolean;
}

type ExtensionResource = Resource<ExtensionSpec>;
```

#### YAML 예시

```yaml
# 일반 Extension
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
  labels:
    category: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.js"
  config:
    discovery:
      repoSkillDirs: [".claude/skills", ".agent/skills"]

---
# MCP 연동 Extension
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: mcp-github
  labels:
    category: mcp
spec:
  runtime: node
  entry: "./extensions/mcp/index.js"
  config:
    transport:
      type: stdio
      command: ["npx", "-y", "@modelcontextprotocol/server-github"]
    attach:
      mode: stateful
      scope: instance
    expose:
      tools: true
      resources: true
      prompts: true

---
# Compaction Extension
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: compaction
spec:
  runtime: node
  entry: "./extensions/compaction/index.js"
  config:
    maxTokens: 8000
    enableLogging: true
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `runtime` | MUST | enum | `"node"`, `"python"`, `"deno"` 중 하나 |
| `entry` | MUST | string | 유효한 파일 경로 |
| `config` | MAY | object | Extension별 자유 형식 |

**MCP Extension config 추가 검증:**
- `transport.type=stdio`인 경우 `command`가 필수 (MUST).
- `transport.type=http`인 경우 `url`이 필수 (MUST).

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
  /** 훅 목록 */
  hooks?: HookSpec[];
  /** Changeset 정책 (선택) */
  changesets?: AgentChangesetPolicy;
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
  system?: string;
  /** 시스템 프롬프트 (파일 참조) */
  systemRef?: string;
}

/**
 * 훅 정의
 */
interface HookSpec {
  /** 훅 ID (선택, reconcile용) */
  id?: string;
  /** 파이프라인 포인트 */
  point: PipelinePoint;
  /** 실행 우선순위 (낮을수록 먼저 실행) */
  priority?: number;
  /** 실행할 액션 */
  action: HookAction;
}

type PipelinePoint =
  | 'turn.pre'
  | 'turn.post'
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

interface HookAction {
  /** Tool 호출 액션 */
  toolCall?: {
    /** 호출할 도구 이름 */
    tool: string;
    /** 입력 파라미터 (정적 값 또는 표현식) */
    input: Record<string, unknown | ExprValue>;
  };
}

interface ExprValue {
  /** JSONPath 표현식 */
  expr: string;
}

/**
 * Agent 수준 Changeset 정책
 */
interface AgentChangesetPolicy {
  allowed?: {
    /** 허용되는 파일 패턴 */
    files?: string[];
  };
}

type AgentResource = Resource<AgentSpec>;
```

#### YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
  labels:
    role: planner
spec:
  modelConfig:
    modelRef: { kind: Model, name: openai-gpt-5 }
    params:
      temperature: 0.5
      maxTokens: 4096

  prompts:
    # 파일 참조 방식
    systemRef: "./prompts/planner.system.md"
    # 또는 인라인 방식
    # system: |
    #   너는 planner 에이전트다.
    #   사용자의 요청을 분석하고 작업 계획을 수립하라.

  tools:
    # 직접 참조
    - { kind: Tool, name: fileRead }
    - { kind: Tool, name: webSearch }
    # Selector + Overrides
    - selector:
        kind: Tool
        matchLabels:
          tier: base
      overrides:
        spec:
          errorMessageLimit: 2000

  extensions:
    - { kind: Extension, name: skills }
    - { kind: Extension, name: compaction }
    - { kind: Extension, name: mcp-github }

  hooks:
    - id: notify-on-turn-complete
      point: turn.post
      priority: 0
      action:
        toolCall:
          tool: slack.postMessage
          input:
            channel: { expr: "$.turn.origin.channel" }
            threadTs: { expr: "$.turn.origin.threadTs" }
            text: { expr: "$.turn.summary" }

    - point: step.llmError
      priority: 10
      action:
        toolCall:
          tool: log.error
          input:
            error: { expr: "$.error.message" }

  changesets:
    allowed:
      files:
        - "prompts/**"
        - "resources/**"
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `modelConfig.modelRef` | MUST | ObjectRef | 유효한 Model 참조 |
| `modelConfig.params.temperature` | MAY | number | 0.0 ~ 2.0 범위 |
| `modelConfig.params.maxTokens` | MAY | number | 양의 정수 |
| `prompts` | MUST | object | `system` 또는 `systemRef` 중 하나 필수 |
| `prompts.system` | MAY | string | 인라인 프롬프트 |
| `prompts.systemRef` | MAY | string | 파일 경로 |
| `tools` | MAY | array | ObjectRef 또는 Selector 배열 |
| `extensions` | MAY | array | ObjectRef 또는 Selector 배열 |
| `hooks[].point` | MUST | enum | 유효한 PipelinePoint |
| `hooks[].priority` | MAY | number | 정수, 기본값 0 |
| `hooks[].action.toolCall.tool` | MUST | string | 도구 이름 |
| `changesets.allowed.files` | MAY | string[] | glob 패턴 배열 |

**추가 검증 규칙:**
- `prompts.system`과 `prompts.systemRef`가 동시에 존재하면 오류 (MUST).
- `changesets.allowed.files`는 Swarm의 `allowed.files` 범위 내여야 한다 (MUST).

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
  entrypoint: ObjectRefLike;
  /** 포함된 Agent 목록 */
  agents: ObjectRefLike[];
  /** 실행 정책 */
  policy?: SwarmPolicy;
}

/**
 * Swarm 실행 정책
 */
interface SwarmPolicy {
  /** Turn당 최대 Step 수 */
  maxStepsPerTurn?: number;
  /** Changeset 정책 */
  changesets?: SwarmChangesetPolicy;
  /** Live Config 정책 */
  liveConfig?: LiveConfigPolicy;
}

/**
 * Swarm 수준 Changeset 정책
 */
interface SwarmChangesetPolicy {
  /** Changeset 기능 활성화 여부 */
  enabled?: boolean;
  /** 적용 시점 */
  applyAt?: PipelinePoint[];
  /** 허용 범위 */
  allowed?: {
    /** 허용되는 파일 패턴 */
    files?: string[];
  };
  /** revision 변경 이벤트 발행 여부 */
  emitRevisionChangedEvent?: boolean;
}

/**
 * Live Config 정책
 */
interface LiveConfigPolicy {
  /** Live Config 활성화 여부 */
  enabled?: boolean;
  /** 적용 시점 */
  applyAt?: PipelinePoint[];
  /** 허용되는 patch 경로 */
  allowedPaths?: {
    /** Agent 기준 상대 경로 */
    agentRelative?: string[];
    /** Swarm 기준 상대 경로 */
    swarmRelative?: string[];
  };
}

type SwarmResource = Resource<SwarmSpec>;
```

#### YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
  labels:
    env: production
spec:
  entrypoint: { kind: Agent, name: planner }

  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: executor }
    - { kind: Agent, name: reviewer }

  policy:
    maxStepsPerTurn: 32

    changesets:
      enabled: true
      applyAt:
        - step.config
      allowed:
        files:
          - "resources/**"
          - "prompts/**"
          - "tools/**"
          - "extensions/**"
      emitRevisionChangedEvent: true

    liveConfig:
      enabled: true
      applyAt:
        - step.config
      allowedPaths:
        agentRelative:
          - "/spec/tools"
          - "/spec/extensions"
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `entrypoint` | MUST | ObjectRef | 유효한 Agent 참조 |
| `agents` | MUST | array | 최소 1개 이상의 Agent 참조 |
| `policy.maxStepsPerTurn` | MAY | number | 양의 정수, 기본값 32 |
| `policy.changesets.enabled` | MAY | boolean | 기본값 false |
| `policy.changesets.applyAt` | MAY | array | PipelinePoint 배열 |
| `policy.changesets.allowed.files` | MAY | array | glob 패턴 배열 |

**추가 검증 규칙:**
- `entrypoint`는 `agents` 배열에 포함되어야 한다 (MUST).
- `changesets.applyAt`에는 `step.config`가 포함되어야 한다 (SHOULD).

---

### 6.6 Connector

Connector는 외부 채널과의 통신 프로토콜(타입)을 정의한다. 인증, 라우팅(ingress), 응답(egress) 설정은 Connection 리소스에서 관리한다.

#### TypeScript 인터페이스

```typescript
/**
 * Connector 리소스 스펙
 */
interface ConnectorSpec {
  /** Connector 타입 (slack, cli, github, custom 등) */
  type: string;
  /** 런타임 환경 (custom 타입용) */
  runtime?: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (custom 타입용) */
  entry?: string;
  /** Trigger 핸들러 목록 (custom 타입용) */
  triggers?: TriggerConfig[];
}

/**
 * Trigger 설정
 */
interface TriggerConfig {
  /** 핸들러 함수 이름 */
  handler: string;
}

type ConnectorResource = Resource<ConnectorSpec>;
```

#### YAML 예시

```yaml
# Slack Connector
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: slack
spec:
  type: slack

---
# CLI Connector
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli

---
# Custom Connector (Trigger Handler 사용)
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: custom-webhook
spec:
  type: custom
  runtime: node
  entry: "./connectors/webhook/index.js"

  triggers:
    - handler: onWebhook
    - handler: onCron
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `type` | MUST | string | 비어있지 않은 문자열 |
| `runtime` | MAY | enum | custom 타입에서 필수 |
| `entry` | MAY | string | custom 타입에서 필수 |
| `triggers[].handler` | MAY | string | entry 모듈의 export 함수명 |

**추가 검증 규칙:**
- `type=custom`인 경우 `runtime`과 `entry`가 필수 (MUST).
- `triggers[].handler`는 모듈 한정자(`exports.`, 파일 경로)를 포함해서는 안 된다 (MUST).
- 지정된 handler export가 존재하지 않으면 구성 로드 단계에서 오류 (MUST).

---

### 6.7 OAuthApp

OAuthApp은 외부 시스템 OAuth 인증을 위한 클라이언트 및 엔드포인트를 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * OAuthApp 리소스 스펙
 */
interface OAuthAppSpec {
  /** OAuth 제공자 식별자 */
  provider: string;
  /** OAuth 플로우 타입 */
  flow: 'authorizationCode' | 'deviceCode';
  /** Subject 모드 */
  subjectMode: 'global' | 'user';
  /** 클라이언트 자격 증명 */
  client: OAuthClient;
  /** OAuth 엔드포인트 */
  endpoints: OAuthEndpoints;
  /** 요청할 스코프 목록 */
  scopes: string[];
  /** 리다이렉트 설정 */
  redirect: OAuthRedirect;
  /** 제공자별 옵션 */
  options?: Record<string, unknown>;
}

/**
 * OAuth 클라이언트 자격 증명
 */
interface OAuthClient {
  /** 클라이언트 ID */
  clientId: ValueSource;
  /** 클라이언트 시크릿 */
  clientSecret: ValueSource;
}

/**
 * OAuth 엔드포인트
 */
interface OAuthEndpoints {
  /** 인가 URL */
  authorizationUrl: string;
  /** 토큰 URL */
  tokenUrl: string;
  /** 토큰 취소 URL (선택) */
  revokeUrl?: string;
  /** 사용자 정보 URL (선택) */
  userInfoUrl?: string;
}

/**
 * OAuth 리다이렉트 설정
 */
interface OAuthRedirect {
  /** 콜백 경로 */
  callbackPath: string;
}

type OAuthAppResource = Resource<OAuthAppSpec>;
```

#### YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: slack-bot
  labels:
    provider: slack
spec:
  provider: slack
  flow: authorizationCode
  subjectMode: global

  client:
    clientId:
      valueFrom:
        env: "SLACK_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef:
          ref: "Secret/slack-oauth"
          key: "client_secret"

  endpoints:
    authorizationUrl: "https://slack.com/oauth/v2/authorize"
    tokenUrl: "https://slack.com/api/oauth.v2.access"
    revokeUrl: "https://slack.com/api/auth.revoke"

  scopes:
    - "chat:write"
    - "channels:read"
    - "users:read"

  redirect:
    callbackPath: "/oauth/callback/slack-bot"

  options:
    slack:
      tokenMode: "bot"

---
apiVersion: agents.example.io/v1alpha1
kind: OAuthApp
metadata:
  name: github-user
spec:
  provider: github
  flow: authorizationCode
  subjectMode: user

  client:
    clientId:
      valueFrom:
        env: "GITHUB_CLIENT_ID"
    clientSecret:
      valueFrom:
        secretRef:
          ref: "Secret/github-oauth"
          key: "client_secret"

  endpoints:
    authorizationUrl: "https://github.com/login/oauth/authorize"
    tokenUrl: "https://github.com/login/oauth/access_token"

  scopes:
    - "repo"
    - "read:user"

  redirect:
    callbackPath: "/oauth/callback/github"
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `provider` | MUST | string | 비어있지 않은 문자열 |
| `flow` | MUST | enum | `"authorizationCode"` 또는 `"deviceCode"` |
| `subjectMode` | MUST | enum | `"global"` 또는 `"user"` |
| `client.clientId` | MUST | ValueSource | 유효한 ValueSource |
| `client.clientSecret` | MUST | ValueSource | 유효한 ValueSource |
| `endpoints.authorizationUrl` | MUST | string | 유효한 URL (authorizationCode 시) |
| `endpoints.tokenUrl` | MUST | string | 유효한 URL |
| `scopes` | MUST | array | 최소 1개 이상의 스코프 |
| `redirect.callbackPath` | MUST | string | `/`로 시작하는 경로 (authorizationCode 시) |

**추가 검증 규칙:**
- `flow=authorizationCode`인 경우 `endpoints.authorizationUrl`과 `redirect.callbackPath`가 필수 (MUST).
- `flow=deviceCode`는 런타임이 지원하지 않으면 구성 로드 단계에서 거부 (MUST).
- Runtime은 `flow=authorizationCode`에 대해 Authorization Code + PKCE(S256)를 필수 지원해야 한다 (MUST).

---

### 6.8 ResourceType

ResourceType은 사용자 정의 Kind의 등록을 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * ResourceType 리소스 스펙
 */
interface ResourceTypeSpec {
  /** API 그룹 */
  group: string;
  /** 이름 정의 */
  names: ResourceTypeNames;
  /** 버전 목록 */
  versions: ResourceTypeVersion[];
  /** 핸들러 참조 */
  handlerRef: ObjectRef;
}

interface ResourceTypeNames {
  /** Kind 이름 (단수형) */
  kind: string;
  /** 복수형 이름 */
  plural: string;
  /** 약어 (선택) */
  shortNames?: string[];
}

interface ResourceTypeVersion {
  /** 버전 이름 */
  name: string;
  /** 제공 여부 */
  served: boolean;
  /** 저장 버전 여부 */
  storage: boolean;
}

type ResourceTypeResource = Resource<ResourceTypeSpec>;
```

#### YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: ResourceType
metadata:
  name: rag.acme.io/Retrieval
spec:
  group: rag.acme.io

  names:
    kind: Retrieval
    plural: retrievals
    shortNames:
      - ret

  versions:
    - name: v1alpha1
      served: true
      storage: true
    - name: v1beta1
      served: true
      storage: false

  handlerRef:
    kind: ExtensionHandler
    name: retrieval-handler

---
apiVersion: agents.example.io/v1alpha1
kind: ResourceType
metadata:
  name: memory.acme.io/Memory
spec:
  group: memory.acme.io

  names:
    kind: Memory
    plural: memories

  versions:
    - name: v1alpha1
      served: true
      storage: true

  handlerRef:
    kind: ExtensionHandler
    name: memory-handler
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `group` | MUST | string | 도메인 형식 (예: `rag.acme.io`) |
| `names.kind` | MUST | string | PascalCase 형식 |
| `names.plural` | MUST | string | 소문자 복수형 |
| `versions` | MUST | array | 최소 1개 이상 |
| `versions[].name` | MUST | string | 버전 형식 (예: `v1alpha1`) |
| `versions[].served` | MUST | boolean | |
| `versions[].storage` | MUST | boolean | |
| `handlerRef` | MUST | ObjectRef | 유효한 ExtensionHandler 참조 |

**추가 검증 규칙:**
- `versions` 중 정확히 하나만 `storage: true`여야 한다 (MUST).
- `handlerRef`가 유효한 ExtensionHandler를 참조해야 한다 (MUST).

---

### 6.9 ExtensionHandler

ExtensionHandler는 사용자 정의 Kind의 검증/변환 로직을 정의한다.

#### TypeScript 인터페이스

```typescript
/**
 * ExtensionHandler 리소스 스펙
 */
interface ExtensionHandlerSpec {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 */
  entry: string;
  /** export하는 함수 목록 */
  exports: ExtensionHandlerExport[];
}

type ExtensionHandlerExport = 'validate' | 'default' | 'materialize';

type ExtensionHandlerResource = Resource<ExtensionHandlerSpec>;
```

#### YAML 예시

```yaml
apiVersion: agents.example.io/v1alpha1
kind: ExtensionHandler
metadata:
  name: retrieval-handler
spec:
  runtime: node
  entry: "./extensions/retrieval/handler.js"
  exports:
    - validate
    - default
    - materialize

---
apiVersion: agents.example.io/v1alpha1
kind: ExtensionHandler
metadata:
  name: memory-handler
spec:
  runtime: node
  entry: "./extensions/memory/handler.js"
  exports:
    - validate
    - default
```

#### Handler 함수 인터페이스

```typescript
/**
 * validate: 리소스 검증
 */
type ValidateFunction = (
  resource: Resource<unknown>
) => Promise<ValidationResult>;

interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

interface ValidationError {
  path: string;
  message: string;
}

/**
 * default: 기본값 적용
 */
type DefaultFunction = (
  resource: Resource<unknown>
) => Promise<Resource<unknown>>;

/**
 * materialize: 런타임 리소스로 변환
 */
type MaterializeFunction = (
  resource: Resource<unknown>,
  ctx: MaterializeContext
) => Promise<unknown>;

interface MaterializeContext {
  runtime: unknown;
  config: unknown;
}
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `runtime` | MUST | enum | `"node"`, `"python"`, `"deno"` 중 하나 |
| `entry` | MUST | string | 유효한 파일 경로 |
| `exports` | MUST | array | `validate`, `default`, `materialize` 중 최소 1개 |

---

### 6.10 Connection

Connection은 Connector와 Swarm 사이의 바인딩을 정의한다. 인증, 라우팅 규칙(ingress), 응답 설정(egress)을 포함한다.

#### TypeScript 인터페이스

```typescript
/**
 * Connection 리소스 스펙
 */
interface ConnectionSpec {
  /** 참조할 Connector */
  connectorRef: ObjectRefLike;
  /** 인증 설정 */
  auth?: ConnectorAuth;
  /** 라우팅 규칙 (ingress) */
  rules?: ConnectionRule[];
  /** Egress 설정 */
  egress?: EgressConfig;
}

/**
 * Connection 라우팅 규칙 (IngressRule과 동일 구조)
 */
type ConnectionRule = IngressRule;

/**
 * Connector 인증 설정
 */
type ConnectorAuth =
  | { oauthAppRef: ObjectRef; staticToken?: never }
  | { oauthAppRef?: never; staticToken: ValueSource };

/**
 * Ingress 규칙
 */
interface IngressRule {
  /** 매칭 조건 */
  match?: IngressMatch;
  /** 라우팅 설정 */
  route: IngressRoute;
}

interface IngressMatch {
  /** 명령어 매칭 (예: "/swarm") */
  command?: string;
  /** 이벤트 타입 매칭 */
  eventType?: string;
  /** 채널 매칭 */
  channel?: string;
}

interface IngressRoute {
  /** 대상 Swarm */
  swarmRef: ObjectRefLike;
  /** instanceKey 추출 표현식 (JSONPath) */
  instanceKeyFrom?: string;
  /** 입력 텍스트 추출 표현식 (JSONPath) */
  inputFrom?: string;
}

/**
 * Egress 설정
 */
interface EgressConfig {
  /** 업데이트 정책 */
  updatePolicy?: UpdatePolicy;
}

interface UpdatePolicy {
  /** 업데이트 모드 */
  mode: 'replace' | 'updateInThread' | 'newMessage';
  /** 디바운스 시간 (밀리초) */
  debounceMs?: number;
}

type ConnectionResource = Resource<ConnectionSpec>;
```

#### YAML 예시

```yaml
# CLI Connection
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  rules:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"

---
# Slack Connection with auth + egress
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: slack-to-default
spec:
  connectorRef: { kind: Connector, name: slack }
  auth:
    oauthAppRef: { kind: OAuthApp, name: slack-bot }
  rules:
    - match:
        command: "/agent"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.event.thread_ts"
        inputFrom: "$.event.text"
  egress:
    updatePolicy:
      mode: updateInThread
      debounceMs: 1500
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `connectorRef` | MUST | ObjectRefLike | 유효한 Connector 참조 |
| `auth.oauthAppRef` | MAY | ObjectRef | 유효한 OAuthApp 참조 |
| `auth.staticToken` | MAY | ValueSource | 유효한 ValueSource |
| `auth` | MUST | - | oauthAppRef와 staticToken은 동시에 존재할 수 없음 |
| `rules` | MAY | array | ConnectionRule 배열 |
| `rules[].route.swarmRef` | MUST | ObjectRef | 유효한 Swarm 참조 |
| `egress.updatePolicy.mode` | MAY | enum | 유효한 모드 |

**추가 검증 규칙:**
- `connectorRef`는 유효한 Connector 리소스를 참조해야 한다 (MUST).
- `auth.oauthAppRef`와 `auth.staticToken`은 동시에 존재할 수 없다 (MUST).
- `rules[].route.swarmRef`는 유효한 Swarm 리소스를 참조해야 한다 (MUST).

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
| apiVersion 필수 | MUST | 모든 리소스에 apiVersion이 있어야 함 |
| kind 필수 | MUST | 모든 리소스에 kind가 있어야 함 |
| metadata.name 필수 | MUST | 모든 리소스에 name이 있어야 함 |
| name 고유성 | MUST | 동일 Kind 내에서 name이 고유해야 함 |
| ObjectRef 유효성 | MUST | 참조된 리소스가 존재해야 함 |
| ValueSource 상호배타 | MUST | value와 valueFrom은 동시 불가 |
| secretRef 형식 | MUST | `Secret/<name>` 형식 준수 |

### Kind별 규칙

| Kind | 규칙 | 수준 |
|------|------|------|
| Model | provider, name 필수 | MUST |
| Tool | entry, exports 필수 | MUST |
| Tool | exports 최소 1개 | MUST |
| Tool | auth.scopes는 OAuthApp.scopes 부분집합 | MUST |
| Extension | entry 필수 | MUST |
| Agent | modelConfig.modelRef 필수 | MUST |
| Agent | prompts (system 또는 systemRef) 필수 | MUST |
| Agent | changesets.allowed는 Swarm 범위 내 | MUST |
| Swarm | entrypoint, agents 필수 | MUST |
| Swarm | entrypoint는 agents에 포함 | MUST |
| Connector | type 필수 | MUST |
| Connector | custom 타입에서 runtime, entry 필수 | MUST |
| Connection | connectorRef 필수 | MUST |
| Connection | oauthAppRef와 staticToken 동시 불가 | MUST |
| Connection | rules[].route.swarmRef 유효한 Swarm 참조 | MUST |
| OAuthApp | flow, subjectMode 필수 | MUST |
| OAuthApp | authorizationCode 시 authorizationUrl, callbackPath 필수 | MUST |
| OAuthApp | deviceCode 미지원 시 거부 | MUST |
| ResourceType | handlerRef가 유효한 ExtensionHandler 참조 | MUST |
| ResourceType | versions 중 하나만 storage: true | MUST |
| ExtensionHandler | exports 최소 1개 | MUST |

### 검증 함수 예시

```typescript
interface ValidationContext {
  resources: Map<string, Resource>;
  errors: ValidationError[];
}

interface ValidationError {
  resource: string;
  path: string;
  message: string;
  level: 'error' | 'warning';
}

function validateResources(
  resources: Resource[],
  ctx: ValidationContext
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const resource of resources) {
    // 공통 검증
    if (!resource.apiVersion) {
      errors.push({
        resource: `${resource.kind}/${resource.metadata?.name ?? 'unknown'}`,
        path: '/apiVersion',
        message: 'apiVersion is required',
        level: 'error',
      });
    }

    // Kind별 검증
    switch (resource.kind) {
      case 'Tool':
        errors.push(...validateTool(resource as ToolResource, ctx));
        break;
      case 'Agent':
        errors.push(...validateAgent(resource as AgentResource, ctx));
        break;
      case 'OAuthApp':
        errors.push(...validateOAuthApp(resource as OAuthAppResource, ctx));
        break;
      // ... 기타 Kind별 검증
    }
  }

  return errors;
}

function validateTool(
  tool: ToolResource,
  ctx: ValidationContext
): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = `Tool/${tool.metadata.name}`;

  if (!tool.spec.entry) {
    errors.push({
      resource: name,
      path: '/spec/entry',
      message: 'entry is required',
      level: 'error',
    });
  }

  if (!tool.spec.exports || tool.spec.exports.length === 0) {
    errors.push({
      resource: name,
      path: '/spec/exports',
      message: 'at least one export is required',
      level: 'error',
    });
  }

  // auth.scopes 검증
  if (tool.spec.auth?.oauthAppRef && tool.spec.auth?.scopes) {
    const oauthAppRef = normalizeObjectRef(tool.spec.auth.oauthAppRef);
    const oauthAppKey = `OAuthApp/${oauthAppRef.name}`;
    const oauthApp = ctx.resources.get(oauthAppKey) as OAuthAppResource | undefined;

    if (oauthApp) {
      const allowedScopes = new Set(oauthApp.spec.scopes);
      for (const scope of tool.spec.auth.scopes) {
        if (!allowedScopes.has(scope)) {
          errors.push({
            resource: name,
            path: '/spec/auth/scopes',
            message: `scope "${scope}" is not a subset of OAuthApp scopes`,
            level: 'error',
          });
        }
      }
    }
  }

  return errors;
}
```

---

## 관련 문서

- `/docs/requirements/06_config-spec.md` - Config 스펙 요구사항
- `/docs/requirements/07_config-resources.md` - Config 리소스 정의 요구사항
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/GUIDE.md` - 개발자 가이드
