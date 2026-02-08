# packages/base - 기본 Tool, Extension, Connector 번들

Goondan의 기본 Tool, Extension, Connector를 제공하는 패키지입니다.

## 디렉토리 구조

```
packages/base/
├── src/
│   ├── tools/           # Tool 구현
│   │   ├── bash/        # bash 명령어 실행 Tool
│   │   │   ├── tool.yaml    # Tool 리소스 정의
│   │   │   └── index.ts     # Tool 핸들러 구현
│   │   ├── http-fetch/  # HTTP 요청 Tool
│   │   │   ├── tool.yaml    # Tool 리소스 정의
│   │   │   ├── index.ts     # Tool 핸들러 구현
│   │   │   └── AGENTS.md    # 폴더별 가이드
│   │   ├── json-query/  # JSON 쿼리/변환 Tool
│   │   │   ├── tool.yaml    # Tool 리소스 정의
│   │   │   ├── index.ts     # Tool 핸들러 구현
│   │   │   └── AGENTS.md    # 폴더별 가이드
│   │   ├── file-system/ # 파일 시스템 읽기/쓰기/목록/존재 확인 Tool
│   │   │   ├── tool.yaml    # Tool 리소스 정의
│   │   │   ├── index.ts     # Tool 핸들러 구현
│   │   │   └── AGENTS.md    # 폴더별 가이드
│   │   └── text-transform/ # 텍스트 변환 Tool (템플릿, 정규식, 포맷)
│   │       ├── tool.yaml    # Tool 리소스 정의
│   │       ├── index.ts     # Tool 핸들러 구현
│   │       └── AGENTS.md    # 폴더별 가이드
│   ├── extensions/      # Extension 구현
│   │   ├── basicCompaction/ # 기본 LLM 대화 압축 Extension
│   │   │   ├── extension.yaml  # Extension 리소스 정의
│   │   │   └── index.ts        # Extension 핸들러 구현
│   │   └── logging/     # 대화 로깅 Extension
│   │       ├── extension.yaml  # Extension 리소스 정의
│   │       ├── index.ts        # Extension 핸들러 구현
│   │       └── AGENTS.md       # 폴더별 가이드
│   ├── connectors/      # Connector 구현
│   │   ├── slack/       # Slack Events API Connector
│   │   │   ├── connector.yaml  # Connector 리소스 정의
│   │   │   ├── index.ts        # Trigger Handler 구현
│   │   │   └── AGENTS.md       # 폴더별 가이드
│   │   ├── telegram/    # Telegram Bot API Connector
│   │   │   ├── connector.yaml  # Connector 리소스 정의
│   │   │   ├── index.ts        # Trigger Handler 구현
│   │   │   └── AGENTS.md       # 폴더별 가이드
│   │   ├── cli/         # CLI (readline) Connector
│   │   │   ├── connector.yaml  # Connector 리소스 정의
│   │   │   ├── index.ts        # Trigger Handler 및 Interactive CLI 구현
│   │   │   └── AGENTS.md       # 폴더별 가이드
│   │   ├── discord/    # Discord Bot API Connector
│   │   │   ├── connector.yaml  # Connector 리소스 정의
│   │   │   ├── index.ts        # Trigger Handler 구현
│   │   │   └── AGENTS.md       # 폴더별 가이드
│   │   └── github/     # GitHub Webhook Connector (push/pull_request/issues/issue_comment)
│   │       ├── connector.yaml  # Connector 리소스 정의
│   │       ├── index.ts        # Trigger Handler 구현
│   │       └── AGENTS.md       # 폴더별 가이드
│   └── index.ts         # 패키지 진입점
├── __tests__/           # 테스트 파일
│   ├── tools/
│   │   ├── bash/
│   │   │   └── index.test.ts
│   │   ├── file-system/
│   │   │   └── index.test.ts
│   │   └── text-transform/
│   │       └── index.test.ts
│   ├── extensions/
│   │   └── basicCompaction/
│   │       └── index.test.ts
│   └── connectors/
│       ├── slack/
│       │   └── index.test.ts
│       ├── telegram/
│       │   └── index.test.ts
│       ├── cli/
│       │   └── index.test.ts
│       ├── discord/
│       │   └── index.test.ts
│       └── github/
│           └── index.test.ts
├── scripts/
│   └── copy-yaml.mjs   # 빌드 시 src/ YAML 파일을 dist/로 복사
├── package.json         # npm 패키지 설정 (build: tsc + copy-yaml)
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

#### logging Extension

LLM 대화를 파일로 로깅하는 Extension.

**설정:**
- `logLevel`: 로그 레벨 (기본: "info")
- `logDir`: 로그 파일 저장 경로 (기본: "./logs")
- `includeTimestamp`: 타임스탬프 포함 여부 (기본: true)
- `maxLogFileSizeMB`: 로그 파일 최대 크기 MB (기본: 10)

**파이프라인 등록:**
- `step.llmCall` (wrap): LLM 요청/응답 로깅
- `turn.post` (mutate): Turn 완료 시 요약 로깅

#### http-fetch Tool

Node.js fetch API 기반 HTTP GET/POST 요청 도구.

**exports:**
- `http.get`: HTTP GET 요청
- `http.post`: HTTP POST 요청

#### json-query Tool

JSONPath 기반 JSON 데이터 추출/변환 도구.

**exports:**
- `json.query`: JSONPath 표현식으로 데이터 추출
- `json.transform`: 데이터 변환 (pick, omit, flatten, keys, values, entries, merge)

#### file-system Tool

Node.js fs/promises 기반 파일 시스템 작업 도구.

**exports:**
- `fs.read`: 파일 읽기 (경로, 인코딩 파라미터, 최대 1MB)
- `fs.write`: 파일 쓰기 (경로, 내용, overwrite/append 모드, 디렉토리 자동 생성)
- `fs.list`: 디렉토리 목록 조회 (경로, 재귀 옵션)
- `fs.exists`: 파일/디렉토리 존재 확인 (타입 반환: file/directory/symlink)

#### text-transform Tool

텍스트 변환 도구 (외부 라이브러리 없이 순수 구현).

**exports:**
- `text.template`: Mustache-like 템플릿 렌더링 ({{변수}}, {{#조건}}, {{^반전}}, 배열 반복)
- `text.regex`: 정규식 매칭(match), 치환(replace), 존재 확인(test)
- `text.format`: 포맷 변환 (JSON <-> YAML <-> CSV)

### Connector 작성 규칙 (v1.0)

1. **connector.yaml**: Connector 리소스 정의 (프로토콜 구현체만)
   - `apiVersion: agents.example.io/v1alpha1`
   - `kind: Connector`
   - `spec.runtime: node`
   - `spec.entry`: Bundle Package Root 기준 상대 경로 (예: `"./connectors/slack/index.js"`)
   - `spec.triggers`: Trigger 프로토콜 선언 목록 (http/cron/cli)
   - `spec.events`: emit할 수 있는 이벤트 스키마 (선택)
   - **주의**: `auth`, `ingress`, `verify`, `egress`는 Connector가 아닌 **Connection** 리소스에 정의
   - **v1.0 변경**: `spec.type` 제거됨 - 더 이상 사용하지 않음

2. **index.ts**: 단일 default export 패턴
   - `export default` 함수 하나만 export
   - 핸들러 시그니처: `(context: ConnectorContext) => Promise<void>`
   - `ConnectorContext` 구조: `{ event, connection, connector, emit, logger, oauth?, verify? }`
   - `event.type === 'connector.trigger'` 확인 후 `event.trigger`에서 페이로드 추출
   - `emit(connectorEvent)`로 ConnectorEvent 발행
   - `context.verify?.webhook?.signingSecret`로 서명 시크릿을 읽어 Connector 내부 검증 로직 수행

3. **ConnectorEvent 발행 규칙**:
   - `type: 'connector.event'` (고정)
   - `name`: 이벤트 이름 (예: `slack.message`, `telegram.message`)
   - `message`: `{ type: 'text', text }` 형태의 정규화된 메시지
   - `properties`: 이벤트 속성 (예: `{ channelId, userId }`)
   - `auth`: 인증 정보 (`{ actor: { id, name }, subjects: { global, user } }`)

4. **타입 import**: `@goondan/core`에서 `ConnectorContext`, `ConnectorEvent`, `HttpTriggerPayload`, `CliTriggerPayload` 등 사용

### Connection과 Connector의 관계

- **Connector**: 프로토콜 수신 선언 + 이벤트 정규화 (runtime, entry, triggers, events)
- **Connection**: 배포 바인딩 (connectorRef, auth, verify, ingress rules)
- Connector는 "어떤 프로토콜로 무엇을 수신하고 어떤 이벤트를 발행할지"를 선언
- Connection은 "인증, 서명 검증, 라우팅"을 정의
- 하나의 Connector에 여러 Connection을 바인딩할 수 있음
- Entry 함수는 Connection마다 호출됨 (동일 trigger event에 대해 각 Connection별 호출)

### package.yaml 리소스 export 규칙

- 패키지는 사용 가능한 **모든 리소스를 export** 해야 한다.
- 인증(OAuthApp, Secret 등)이 필요한 리소스라도 패키지에서 제외하지 않는다.
- 사용처(consumer)에서 필요한 인증 리소스(OAuthApp 등)를 구성하는 것이 올바른 패턴이다.

### 타입 단언 금지

- `as`, `as unknown as` 등의 타입 단언 사용 금지
- 타입 가드 또는 정확한 타입 정의로 해결

## 참고 문서

- `/docs/specs/tool.md`: Tool 시스템 스펙
- `/docs/specs/extension.md`: Extension 시스템 스펙
- `/docs/specs/connector.md`: Connector 시스템 스펙
- `/docs/specs/connection.md`: Connection 시스템 스펙
