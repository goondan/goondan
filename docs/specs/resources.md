# Goondan Config Plane 리소스 정의 스펙 (v2.0)

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

## 1. 개요

### 1.1 배경과 설계 철학

Goondan Config Plane은 에이전트 스웜을 구성하는 모든 리소스를 **선언적 YAML**로 정의하는 체계이다. Kubernetes의 리소스 모델에서 영감을 받아, 모든 구성 요소를 `apiVersion`, `kind`, `metadata`, `spec`의 4필드 구조로 통일한다. 이를 통해:

- **일관성**: 8종의 Kind(Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package) 모두 동일한 구조를 따르므로, 도구와 검증기를 범용으로 구현할 수 있다.
- **참조 무결성**: ObjectRef와 Selector 문법으로 리소스 간 관계를 명확히 선언하고, 로드 단계에서 모든 참조의 유효성을 검증한다.
- **보안 분리**: 민감값(API 키, 토큰)은 ValueSource/SecretRef 패턴으로 외부 소스에서 주입하여, 구성 파일에 비밀값이 직접 노출되지 않도록 한다.
- **확장 가능한 버전 관리**: `apiVersion` 필드를 통해 비호환 변경을 명시적으로 관리하고, 하위 호환을 유지한다.

### 1.2 설계 원칙

1. **단일 식별**: 모든 리소스는 `kind + metadata.name` 조합(동일 package 범위 내)으로 고유하게 식별된다.
2. **Fail-Fast 검증**: 구성 검증은 Runtime 시작 전 "로드 단계"에서 수행하며, 하나라도 오류가 있으면 부분 로드 없이 전체를 거부한다.
3. **선언적 참조**: 리소스 간 관계는 ObjectRef(`Kind/name` 또는 `ref`) 또는 Selector로 선언하며, 런타임이 참조를 해석한다.
4. **Bun 네이티브**: Tool, Extension, Connector의 `runtime` 필드를 제거하고, 모든 실행 환경을 Bun으로 통일하여 복잡도를 낮춘다.

---

## 2. 핵심 규칙

본 섹션은 리소스 정의 시 구현자가 반드시 준수해야 하는 규범적 규칙을 요약한다. RFC 2119 스타일(`MUST`, `SHOULD`, `MAY`)을 사용한다.

### 2.1 리소스 공통

1. 모든 리소스는 `apiVersion`, `kind`, `metadata`, `spec`를 포함해야 한다 (MUST).
2. `apiVersion`은 `goondan.ai/v1`이어야 한다 (MUST).
3. `metadata.name`은 동일 package 범위에서 `kind + name` 조합으로 고유해야 한다 (MUST).
4. 단일 YAML 파일에서 다중 문서(`---`)를 지원해야 한다 (MUST).

### 2.2 버전 정책

1. 비호환 변경은 `version` 상승(예: `v1` -> `v2`)으로 표현해야 한다 (MUST).
2. Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다 (MUST).
3. Deprecated 리소스/필드는 최소 1개 이상의 하위 버전에서 경고를 제공해야 한다 (SHOULD).

### 2.3 참조 문법

1. ObjectRef 문자열 축약형은 `Kind/name` 형식이어야 한다 (MUST).
2. 객체형 ObjectRef는 최소 `kind`, `name`을 포함해야 한다 (MUST).
3. namespace 개념 대신 `package` 필드로 참조 범위를 명시해야 한다 (SHOULD).
4. 참조된 리소스가 존재하지 않으면 검증 단계에서 오류로 처리해야 한다 (MUST).

### 2.4 Selector + Overrides

1. 블록에 `selector`가 있으면 선택형 조립으로 해석해야 한다 (MUST).
2. 선택된 리소스에 `overrides`를 적용할 수 있어야 한다 (MUST).
3. 기본 병합 규칙은 객체 재귀 병합, 스칼라 덮어쓰기, 배열 교체를 따른다 (SHOULD).

### 2.5 ValueSource

1. `value`와 `valueFrom`은 동시에 존재할 수 없다 (MUST).
2. `valueFrom`에서 `env`와 `secretRef`는 동시에 존재할 수 없다 (MUST).
3. 비밀값(access token, refresh token, client secret 등)은 Base Config에 직접 포함하지 않아야 한다 (SHOULD).

### 2.6 구성 검증

1. 구성 검증은 Runtime 시작 전 "로드 단계"에서 수행되어야 한다 (MUST).
2. 오류가 하나라도 있으면 부분 로드 없이 전체 구성을 거부해야 한다 (MUST).
3. 검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다 (MUST).
4. 오류 객체는 사용자 복구를 위한 `suggestion`과 선택적 `helpUrl` 필드를 포함하는 것을 권장한다 (SHOULD).

---

## 3. 리소스 공통 형식

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

### 지원 Kind

v2에서 지원하는 Kind는 8종이다:

| Kind | 역할 |
|------|------|
| **Model** | LLM 프로바이더 설정 |
| **Agent** | 에이전트 정의 (모델, 프롬프트, 도구, 익스텐션) |
| **Swarm** | 에이전트 집합 + 실행 정책 |
| **Tool** | LLM이 호출하는 함수 |
| **Extension** | 라이프사이클 미들웨어 인터셉터 |
| **Connector** | 외부 프로토콜 수신 (별도 프로세스, 자체 프로토콜 관리) |
| **Connection** | Connector - Swarm 바인딩 |
| **Package** | 프로젝트 매니페스트/배포 단위 |

### 규칙

1. `apiVersion`은 MUST `goondan.ai/v1`이어야 한다.
2. `kind`는 MUST 8종의 알려진 Kind 중 하나여야 한다: `Model`, `Agent`, `Swarm`, `Tool`, `Extension`, `Connector`, `Connection`, `Package`.
3. `metadata.name`은 MUST 동일 Kind 내에서 고유해야 한다.
4. 단일 YAML 파일에 여러 문서를 `---`로 구분하여 포함할 수 있다 (MAY).
5. 비호환 변경은 `version` 상승(예: `v1` -> `v2`)으로 표현해야 한다 (MUST).
6. Runtime은 지원하지 않는 `apiVersion`을 로드 단계에서 명시적 오류로 거부해야 한다 (MUST).
7. Deprecated 리소스/필드는 최소 1개 이상의 하위 버전에서 경고를 제공해야 한다 (SHOULD).

---

## 4. Metadata 구조

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

## 5. ObjectRef 참조 문법

ObjectRef는 다른 리소스를 참조하는 방법을 정의한다.

### TypeScript 인터페이스

```typescript
import type { ObjectRefLike, ObjectRef } from './shared-types';

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

## 6. Selector + Overrides 조립 문법

Selector는 라벨 기반으로 리소스를 선택하고, Overrides로 선택된 리소스의 일부 설정을 덮어쓸 수 있다.

### TypeScript 인터페이스

```typescript
import type {
  Selector,
  SelectorWithOverrides,
  RefItem,
  RefOrSelector,
} from './shared-types';
```

`Selector`/`SelectorWithOverrides`/`RefItem`/`RefOrSelector` 원형은 `docs/specs/shared-types.md` 2절을 따른다.

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

## 7. ValueSource / SecretRef 타입

환경 변수나 비밀 저장소에서 값을 주입하기 위한 패턴을 정의한다.

### TypeScript 인터페이스

```typescript
import type { ValueSource, ValueFrom, SecretRef } from './shared-types';
```

`ValueSource`/`ValueFrom`/`SecretRef` 원형은 `docs/specs/shared-types.md` 3절을 따른다.

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

## 8. 리소스 Kind별 스키마

### 8.1 Model

Model은 LLM 프로바이더 설정을 정의한다. Runtime은 provider 차이를 추상화한 공통 호출 인터페이스를 제공하여, 에이전트가 특정 프로바이더에 종속되지 않도록 한다.

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
- 모델이 스트리밍을 지원하는 경우, Runtime은 스트리밍 응답을 표준 이벤트/콜백으로 전달할 수 있어야 한다 (SHOULD).
- provider 전용 옵션은 `spec.options`로 캡슐화해야 한다 (MUST).

---

### 8.2 Tool

Tool은 LLM이 호출할 수 있는 함수를 정의한다. 모든 Tool은 Bun으로 실행된다 (`runtime` 필드 없음).

#### TypeScript 인터페이스

`ToolSpec`/`ToolExportSpec`/Tool 핸들러 계약 원형은 `docs/specs/tool.md` 4~7절을 따른다.

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

// ToolContext 원형은 docs/specs/shared-types.md 6절을 따른다.
// ToolHandler 실행 계약의 상세는 docs/specs/tool.md 7절을 따른다.
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

### 8.3 Extension

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

### 8.4 Agent

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
| `tools` | MAY | array | ObjectRef/RefItem/Selector 배열 |
| `extensions` | MAY | array | ObjectRef/RefItem/Selector 배열 |

**추가 검증 규칙:**
- `prompts.systemPrompt`와 `prompts.systemRef`가 모두 존재하면 `systemRef`의 내용이 `systemPrompt` 뒤에 이어 붙여져야 한다 (MUST).
- Agent 리소스에는 `hooks` 필드가 존재하지 않는다. 모든 라이프사이클 개입은 Extension 미들웨어를 통해 구현해야 한다 (MUST).
- Agent 리소스에는 `changesets` 필드가 존재하지 않는다. 설정 변경은 Edit & Restart 모델을 사용한다.

---

### 8.5 Swarm

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
  /** Graceful Shutdown 정책 */
  shutdown?: SwarmShutdownPolicy;
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

/**
 * Graceful Shutdown 정책
 */
interface SwarmShutdownPolicy {
  /** 유예 기간 (초). 기본값: 300 */
  gracePeriodSeconds?: number;
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
    shutdown:
      gracePeriodSeconds: 300
```

#### Validation 규칙

| 필드 | 필수 | 타입 | 규칙 |
|------|------|------|------|
| `entryAgent` | MUST | ObjectRefLike | 유효한 Agent 참조 |
| `agents` | MUST | array | 최소 1개 이상의 Agent 참조 |
| `policy.maxStepsPerTurn` | MAY | number | 양의 정수, 기본값 32 |
| `policy.lifecycle.ttlSeconds` | MAY | number | 양의 정수 (초) |
| `policy.lifecycle.gcGraceSeconds` | MAY | number | 양의 정수 (초) |
| `policy.shutdown.gracePeriodSeconds` | MAY | number | 양의 정수 (초), 기본값 300 |

**추가 검증 규칙:**
- `entryAgent`는 `agents` 배열에 포함된 Agent를 참조해야 한다 (MUST).
- `policy.maxStepsPerTurn` 값에 도달하면 Turn을 강제 종료해야 한다 (MUST).
- `policy.lifecycle`가 설정되면 Runtime은 인스턴스 TTL 및 GC 정책에 반영해야 한다 (SHOULD).
- v2에서 `changesets`, `liveConfig`, `queueMode` 정책은 제거되었다. 설정 변경은 Edit & Restart 모델을 사용한다.

---

### 8.6 Connector

Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 **독립 프로세스**를 정의한다. Connector는 프로토콜 처리(HTTP 서버, cron 스케줄러, WebSocket 등)를 **자체적으로** 관리한다. 모든 Connector는 Bun으로 실행된다 (`runtime` 필드 없음).

#### TypeScript 인터페이스

`ConnectorSpec`, `EventSchema`, `EventPropertyType`, `ConnectorContext`, `ConnectorEvent` 원형은 `docs/specs/connector.md` 3.2절과 5.2~5.3절을 따른다.

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

### 8.7 Connection

Connection은 Connector를 실제 배포 환경에 바인딩하는 리소스이다. 시크릿 제공, ConnectorEvent 기반 ingress 라우팅 규칙, 서명 검증 시크릿 설정을 담당한다.

#### TypeScript 인터페이스

`ConnectionSpec`, `IngressConfig`, `IngressRule`, `IngressMatch`, `IngressRoute`, `ConnectionVerify` 원형은 `docs/specs/connection.md` 3.2절을 따른다.

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

### 8.8 Package

Package는 프로젝트의 최상위 매니페스트 리소스이다. 의존성, 버전, 레지스트리 정보를 포함한다.

#### TypeScript 인터페이스

`PackageSpec`/`PackageDependency`/`PackageRegistry` 원형은 `docs/specs/bundle_package.md` 5.1절을 따른다.

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

## 9. 공통 타입 참조

이 문서에서 사용되는 공통 타입은 `docs/specs/shared-types.md`를 단일 기준(SSOT)으로 사용한다.

- JSON 타입: `JsonPrimitive`, `JsonValue`, `JsonObject`, `JsonArray`
- 참조 타입: `ObjectRefLike`, `ObjectRef`, `RefItem`, `Selector`, `SelectorWithOverrides`, `RefOrSelector`
- 비밀값 타입: `ValueSource`, `ValueFrom`, `SecretRef`
- 메시지/도구 타입: `Message`, `ToolContext`

리소스 스키마 문서(`resources.md`)는 타입의 원형 정의를 중복 선언하기보다, 각 Kind의 필드 규칙과 검증 규칙에 집중해야 한다.

---

## 10. Validation 규칙 요약

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

검증 오류는 위치와 코드가 포함된 구조화된 형식으로 반환해야 한다 (MUST). 오류 객체는 사용자 복구를 위한 `suggestion`과 선택적 `helpUrl` 필드를 포함하는 것을 권장한다 (SHOULD).

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

- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/bundle_package.md` - Package 스펙
- `/GUIDE.md` - 개발자 가이드
