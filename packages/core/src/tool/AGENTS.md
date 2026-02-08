# Tool 시스템

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위입니다.

## 스펙 문서

- `/docs/specs/tool.md`

## 파일 구조

```
tool/
├── types.ts      # Tool 관련 타입 정의
├── registry.ts   # ToolRegistry - 동적 Tool 등록/관리
├── catalog.ts    # ToolCatalog - LLM에 노출되는 Tool 목록
├── executor.ts   # ToolExecutor - Tool 실행 엔진
├── loader.ts     # ToolLoader - Tool 모듈 로더
├── context.ts    # ToolContextBuilder - 실행 컨텍스트 빌더
├── utils.ts      # 유틸리티 함수 (truncate, result 생성)
└── index.ts      # 모든 기능 re-export
```

## 핵심 개념

### Tool Registry vs Tool Catalog

| 개념 | 설명 |
|------|------|
| **Tool Registry** | Runtime이 보유한 **실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합** |
| **Tool Catalog** | **특정 Step에서 LLM에 노출되는 도구 목록** |

### 주요 클래스

- `ToolRegistry`: 동적 Tool 등록/조회/삭제
- `ToolCatalog`: LLM에 노출되는 Tool 목록 관리
- `ToolExecutor`: Tool 호출 실행, 오류 처리
- `ToolLoader`: Tool 리소스의 entry 파일에서 handlers 로드
- `ToolContextBuilder`: ToolContext 안전 생성

### ToolContext

Tool 핸들러에 전달되는 실행 컨텍스트. 주요 필드:

| 필드 | 타입 | 설명 |
|------|------|------|
| `instance` | `SwarmInstance` | 현재 Swarm 인스턴스 |
| `swarm` | `Resource<SwarmSpec>` | Swarm 리소스 |
| `agent` | `Resource<AgentSpec>` | 현재 Agent 리소스 |
| `turn` | `Turn` | 현재 Turn |
| `step` | `Step` | 현재 Step |
| `toolCatalog` | `ToolCatalogItem[]` | 사용 가능한 Tool 목록 |
| `workdir` | `string` | 인스턴스별 작업 디렉터리 (Tool CWD 바인딩) |
| `agents` | `ToolAgentsApi` | Agent 위임/관리 API |
| `swarmBundle` | `SwarmBundleApi` | Changeset API |
| `oauth` | `OAuthApi` | OAuth API |
| `events` | `EventBus` | 이벤트 버스 |
| `logger` | `Console` | 로거 |

`workdir`는 `{instanceStatePath}/workspace` 경로로, Tool이 파일을 읽고 쓸 때의 기본 작업 디렉터리로 사용됩니다.

## 타입

### ToolHandler

```typescript
type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;
```

### ToolResult

```typescript
interface ToolResult {
  toolCallId: string;
  toolName: string;
  status: 'ok' | 'error' | 'pending';
  output?: JsonValue;
  handle?: string;
  error?: ToolError;
}
```

## 규칙

1. **예외 전파 금지**: Tool 실행 중 오류는 `ToolResult.error`로 변환
2. **errorMessageLimit**: 오류 메시지는 `Tool.spec.errorMessageLimit` 길이로 제한 (기본: 1000)
3. **Catalog 기본 허용**: `catalog`가 전달된 실행에서는 Catalog 밖 Tool 호출을 구조화된 `ToolResult(error)`로 거부
4. **타입 단언 금지**: `as` 사용하지 않고 타입 가드로 처리

## 사용 예시

```typescript
import { ToolRegistry, ToolExecutor, ToolCatalog } from '@goondan/core/tool';

// Registry에 Tool 등록
const registry = new ToolRegistry();
registry.register({
  name: 'calc.add',
  handler: async (ctx, input) => {
    return { result: input.a + input.b };
  },
});

// Executor로 실행
const executor = new ToolExecutor(registry);
const result = await executor.execute(toolCall, context);
```
