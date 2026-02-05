# packages/base - 기본 Tool, Extension, Connector 번들

Goondan의 기본 Tool, Extension, Connector를 제공하는 패키지입니다.

## 디렉토리 구조

```
packages/base/
├── src/
│   ├── tools/           # Tool 구현
│   │   └── bash/        # bash 명령어 실행 Tool
│   │       ├── tool.yaml    # Tool 리소스 정의
│   │       └── index.ts     # Tool 핸들러 구현
│   ├── extensions/      # Extension 구현
│   │   └── basicCompaction/ # 기본 LLM 대화 압축 Extension
│   │       ├── extension.yaml  # Extension 리소스 정의
│   │       └── index.ts        # Extension 핸들러 구현
│   ├── connectors/      # Connector 구현
│   │   ├── slack/       # Slack Events API Connector
│   │   │   ├── connector.yaml  # Connector 리소스 정의
│   │   │   ├── index.ts        # Trigger Handler 구현
│   │   │   └── AGENTS.md       # 폴더별 가이드
│   │   └── telegram/    # Telegram Bot API Connector
│   │       ├── connector.yaml  # Connector 리소스 정의
│   │       ├── index.ts        # Trigger Handler 구현
│   │       └── AGENTS.md       # 폴더별 가이드
│   └── index.ts         # 패키지 진입점
├── __tests__/           # 테스트 파일
│   ├── tools/
│   │   └── bash/
│   │       └── index.test.ts
│   ├── extensions/
│   │   └── basicCompaction/
│   │       └── index.test.ts
│   └── connectors/
│       ├── slack/
│       │   └── index.test.ts
│       └── telegram/
│           └── index.test.ts
├── package.json         # npm 패키지 설정
├── package.yaml         # Bundle Package 정의
├── vitest.config.ts     # Vitest 테스트 설정
└── tsconfig.json        # TypeScript 설정
```

## 파일 작성 규칙

### Tool 작성 규칙

1. **tool.yaml**: Tool 리소스 정의
   - `apiVersion: agents.example.io/v1alpha1`
   - `kind: Tool`
   - `spec.runtime: node`
   - `spec.entry`: Bundle Package Root 기준 상대 경로 (예: `"./tools/bash/index.js"`)
   - `spec.exports`: 최소 1개 이상의 export 정의

2. **index.ts**: Tool 핸들러 구현
   - `handlers` 객체를 export해야 함
   - 각 export.name에 대응하는 핸들러가 `handlers` 객체에 포함되어야 함
   - 핸들러 시그니처: `(ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue`

3. **타입 import**: `@goondan/core`에서 `ToolHandler`, `ToolContext`, `JsonValue` 타입 사용

### Extension 작성 규칙

1. **extension.yaml**: Extension 리소스 정의
   - `apiVersion: agents.example.io/v1alpha1`
   - `kind: Extension`
   - `spec.runtime: node`
   - `spec.entry`: Bundle Package Root 기준 상대 경로 (예: `"./extensions/basicCompaction/index.js"`)
   - `spec.config`: Extension별 설정

2. **index.ts**: Extension 핸들러 구현
   - `register(api: ExtensionApi)` 함수를 export해야 함
   - `api.pipelines.mutate(point, handler)`로 Mutator 등록
   - `api.pipelines.wrap(point, handler)`로 Middleware 등록
   - `api.tools.register(toolDef)`로 동적 Tool 등록
   - `api.events.emit(type, payload)`로 이벤트 발행

3. **타입 import**: `@goondan/core`에서 `ExtensionApi`, `ExtStepContext`, `ExtLlmMessage` 등 타입 사용

#### basicCompaction Extension

LLM 대화가 토큰/문자 수 제한을 초과할 때 자동으로 이전 대화를 요약하여 컨텍스트 윈도우를 관리하는 Extension.

**설정:**
- `maxTokens`: 최대 토큰 수 (기본: 8000)
- `maxChars`: 최대 문자 수 (기본: 32000)
- `compactionPrompt`: 압축 프롬프트 (빈 값이면 기본 프롬프트 사용)

**토큰 추정:** characters / 4 (간단한 근사치)

**파이프라인 등록:**
- `step.llmCall` (wrap): LLM 호출 전 토큰 수 확인, 초과 시 이전 대화 요약
- `step.blocks` (mutate): 압축 상태 블록 추가

### Connector 작성 규칙

1. **connector.yaml**: Connector 리소스 정의
   - `apiVersion: agents.example.io/v1alpha1`
   - `kind: Connector`
   - `spec.type`: Connector 타입 (slack, telegram, github, custom 등)
   - `spec.runtime: node`
   - `spec.entry`: Bundle Package Root 기준 상대 경로 (예: `"./connectors/slack/index.js"`)
   - `spec.auth`: 인증 설정 (oauthAppRef 또는 staticToken)
   - `spec.triggers`: Trigger Handler 목록
   - `spec.ingress`: Ingress 규칙 (match/route 쌍)
   - `spec.egress`: Egress 설정 (updatePolicy)

2. **index.ts**: Trigger Handler 구현
   - Trigger handler 함수를 export해야 함 (예: `onSlackEvent`)
   - 핸들러 시그니처: `(event: TriggerEvent, connection: JsonObject, ctx: TriggerContext) => Promise<void>`
   - `ctx.emit()`으로 canonical event 발행
   - `ctx.oauth.getAccessToken()`으로 OAuth 토큰 획득 (OAuthApp 기반 모드)

3. **auth.subjects 설정**: Turn의 인증 컨텍스트 설정
   - `subjects.global`: 전역 토큰 조회용 식별자 (예: `slack:team:{teamId}`)
   - `subjects.user`: 사용자별 토큰 조회용 식별자 (예: `slack:user:{teamId}:{userId}`)

### 타입 단언 금지

- `as`, `as unknown as` 등의 타입 단언 사용 금지
- 타입 가드 또는 정확한 타입 정의로 해결

## 참고 문서

- `/docs/specs/tool.md`: Tool 시스템 스펙
- `/docs/specs/extension.md`: Extension 시스템 스펙
- `/docs/specs/connector.md`: Connector 시스템 스펙
