# 내장 Tool 레퍼런스

> `@goondan/base` 패키지에서 제공하는 Tool 카탈로그 (v0.0.3)

[English version](./builtin-tools.md)

---

## 개요

Goondan은 `@goondan/base` 패키지에 내장 Tool 세트를 제공합니다. 별도 설치 없이 Agent의 `spec.tools` 목록에 참조만 추가하면 바로 사용할 수 있습니다.

모든 Tool 이름은 **더블 언더스코어 네이밍** 규칙을 따릅니다: `{리소스명}__{export명}`. 예를 들어, `bash` Tool의 `exec` export는 LLM에 `bash__exec`로 노출됩니다. 자세한 내용은 [Tool 시스템](../explanation/tool-system.ko.md)을 참조하세요.

**크로스 링크:**
- [How-to: 내장 Tool 활용](../how-to/use-builtin-tools.ko.md) -- 실전 사용 패턴
- [Explanation: Tool 시스템](../explanation/tool-system.ko.md) -- 아키텍처 심층 이해
- [Reference: Tool API](./tool-api.ko.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult` 인터페이스

---

## 목차

| Tool 리소스 | Exports | 설명 |
|-------------|---------|------|
| [bash](#bash) | `exec`, `script` | 셸 명령 실행 |
| [file-system](#file-system) | `read`, `write`, `list`, `mkdir` | 파일 읽기/쓰기/목록 |
| [http-fetch](#http-fetch) | `get`, `post` | HTTP 요청 (SSRF 방지: http/https만 허용) |
| [json-query](#json-query) | `query`, `pick`, `count`, `flatten` | JSON 데이터 쿼리 |
| [text-transform](#text-transform) | `replace`, `slice`, `split`, `join`, `trim`, `case` | 텍스트 변환 |
| [agents](#agents) | `request`, `send`, `spawn`, `list`, `catalog` | 에이전트 간 통신 |
| [self-restart](#self-restart) | `request` | 오케스트레이터 재시작 신호 |
| [telegram](#telegram) | `send`, `edit`, `delete`, `react`, `setChatAction`, `downloadFile` | Telegram 메시징 |
| [slack](#slack) | `send`, `read`, `edit`, `delete`, `react`, `downloadFile` | Slack 메시징 |

---

## bash

셸 명령 실행 Tool. 기본적으로 에이전트 인스턴스의 작업 디렉토리(`ctx.workdir`)에서 명령을 실행합니다.

**리소스 이름:** `bash`
**오류 메시지 제한:** 1200자

### bash__exec

인스턴스 작업 디렉토리에서 셸 명령을 실행합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `command` | string | 예 | -- | 실행할 셸 명령 |
| `cwd` | string | 아니오 | `ctx.workdir` | 작업 디렉토리 (상대 경로는 `ctx.workdir` 기준) |
| `timeoutMs` | number | 아니오 | `30000` | 명령 타임아웃 (밀리초) |
| `env` | object | 아니오 | `process.env` | 추가 환경 변수 (string/number/boolean 값) |

**반환값:**

```json
{
  "command": "ls -la",
  "cwd": "/path/to/workdir",
  "durationMs": 42,
  "stdout": "total 8\n...",
  "stderr": "",
  "exitCode": 0,
  "signal": null,
  "timedOut": false
}
```

### bash__script

스크립트 파일을 선택적 인수와 함께 실행합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `path` | string | 예 | -- | 스크립트 파일 경로 (`ctx.workdir` 기준 상대 경로) |
| `args` | string[] | 아니오 | `[]` | 스크립트에 전달할 인수 |
| `shell` | string | 아니오 | `/bin/bash` | 사용할 셸 인터프리터 |
| `timeoutMs` | number | 아니오 | `30000` | 스크립트 타임아웃 (밀리초) |
| `env` | object | 아니오 | `process.env` | 추가 환경 변수 |

**반환값:**

```json
{
  "path": "/path/to/script.sh",
  "shell": "/bin/bash",
  "args": ["arg1"],
  "durationMs": 120,
  "stdout": "...",
  "stderr": "",
  "exitCode": 0,
  "signal": null,
  "timedOut": false
}
```

---

## file-system

에이전트 인스턴스 워크스페이스 내 파일 시스템 작업을 수행합니다.

**리소스 이름:** `file-system`
**오류 메시지 제한:** 2000자

### file-system__read

작업 디렉토리에서 파일 내용을 읽습니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `path` | string | 예 | -- | 파일 경로 (`ctx.workdir` 기준 상대 또는 절대) |
| `maxBytes` | number | 아니오 | `100000` | 최대 읽기 바이트 수 (0보다 커야 함) |

**반환값:**

```json
{
  "path": "/absolute/path/to/file.txt",
  "size": 1234,
  "truncated": false,
  "content": "파일 내용..."
}
```

### file-system__write

파일에 내용을 씁니다. 상위 디렉토리는 자동으로 생성됩니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `path` | string | 예 | -- | 파일 경로 (`ctx.workdir` 기준 상대 또는 절대) |
| `content` | string | 예 | -- | 작성할 내용 |
| `append` | boolean | 아니오 | `false` | 덮어쓰기 대신 기존 파일에 추가 |

**반환값:**

```json
{
  "path": "/absolute/path/to/file.txt",
  "size": 42,
  "written": true,
  "append": false
}
```

### file-system__list

디렉토리 항목을 나열합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `path` | string | 아니오 | `"."` | 디렉토리 경로 (`ctx.workdir` 기준 상대 또는 절대) |
| `recursive` | boolean | 아니오 | `false` | 하위 디렉토리 재귀 탐색 |
| `includeDirs` | boolean | 아니오 | `true` | 결과에 디렉토리 포함 |
| `includeFiles` | boolean | 아니오 | `true` | 결과에 파일 포함 |

**반환값:**

```json
{
  "path": "/absolute/path/to/dir",
  "recursive": false,
  "count": 3,
  "entries": [
    { "name": "src", "path": "/absolute/path/to/dir/src", "type": "dir" },
    { "name": "README.md", "path": "/absolute/path/to/dir/README.md", "type": "file", "size": 1024 }
  ]
}
```

### file-system__mkdir

작업 디렉토리에 디렉토리를 생성합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `path` | string | 예 | -- | 디렉토리 경로 (`ctx.workdir` 기준 상대 또는 절대) |
| `recursive` | boolean | 아니오 | `true` | 필요 시 상위 디렉토리도 함께 생성 |

**반환값:**

```json
{
  "path": "/absolute/path/to/new-dir",
  "created": true,
  "recursive": true
}
```

---

## http-fetch

SSRF 방지가 내장된 HTTP 요청 Tool. `http:`와 `https:` 프로토콜만 허용됩니다.

**리소스 이름:** `http-fetch`
**최대 응답 바이트:** 500,000

### http-fetch__get

HTTP GET 요청을 수행합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `url` | string | 예 | -- | 요청 URL (http/https만 허용) |
| `headers` | object | 아니오 | `{}` | 요청 헤더 |
| `timeoutMs` | number | 아니오 | `30000` | 요청 타임아웃 (밀리초) |
| `maxBytes` | number | 아니오 | `500000` | 최대 응답 본문 바이트 수 |

**반환값:**

```json
{
  "url": "https://api.example.com/data",
  "method": "GET",
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": "{\"key\": \"value\"}",
  "truncated": false,
  "durationMs": 150
}
```

### http-fetch__post

HTTP POST 요청을 수행합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `url` | string | 예 | -- | 요청 URL (http/https만 허용) |
| `body` | object | 아니오 | -- | JSON 요청 본문 (자동으로 `Content-Type: application/json` 설정) |
| `bodyString` | string | 아니오 | -- | 문자열 요청 본문 (`body`가 없을 때 사용) |
| `headers` | object | 아니오 | `{}` | 요청 헤더 |
| `timeoutMs` | number | 아니오 | `30000` | 요청 타임아웃 (밀리초) |
| `maxBytes` | number | 아니오 | `500000` | 최대 응답 본문 바이트 수 |

**반환값:** `http-fetch__get`과 동일한 구조이며 `"method": "POST"`입니다.

---

## json-query

JSON 데이터 쿼리 Tool. 모든 연산은 JSON 문자열로 된 `data` 파라미터를 받습니다.

**리소스 이름:** `json-query`

### json-query__query

점 표기법 경로로 JSON 데이터를 쿼리합니다 (배열 인덱스를 위한 대괄호 표기법 지원).

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `data` | string | 예 | -- | 쿼리할 JSON 문자열 |
| `path` | string | 아니오 | `"."` | 점 표기법 경로 (예: `users[0].name`, `.items.count`) |

**반환값:**

```json
{
  "path": "users[0].name",
  "found": true,
  "value": "Alice"
}
```

### json-query__pick

JSON 객체에서 특정 키를 추출합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `data` | string | 예 | -- | JSON 문자열 (객체여야 함) |
| `keys` | string[] | 예 | -- | 추출할 키 배열 |

**반환값:**

```json
{
  "keys": ["name", "email"],
  "result": {
    "name": "Alice",
    "email": "alice@example.com"
  }
}
```

### json-query__count

JSON 경로의 요소 수를 셉니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `data` | string | 예 | -- | JSON 문자열 |
| `path` | string | 아니오 | `"."` | 카운트할 점 표기법 경로 |

**반환값:**

```json
{
  "path": ".items",
  "count": 5,
  "type": "array"
}
```

`type` 필드는 해석된 타입을 나타냅니다: `"array"`, `"object"` (키 수), `"string"` (문자 수), `"null"`, 또는 원시 타입(`"number"`, `"boolean"`)은 count `1`입니다.

### json-query__flatten

중첩된 JSON 배열을 평탄화합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `data` | string | 예 | -- | JSON 문자열 (배열이어야 함) |
| `depth` | number | 아니오 | `1` | 최대 평탄화 깊이 |

**반환값:**

```json
{
  "depth": 1,
  "count": 4,
  "result": [1, 2, 3, 4]
}
```

---

## text-transform

텍스트 변환 유틸리티.

**리소스 이름:** `text-transform`

### text-transform__replace

텍스트 내 문자열을 치환합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `text` | string | 예 | -- | 입력 텍스트 |
| `search` | string | 예 | -- | 검색할 문자열 |
| `replacement` | string | 아니오 | `""` | 치환 문자열 |
| `all` | boolean | 아니오 | `false` | 모든 발생을 치환 (첫 번째만이 아닌) |

**반환값:**

```json
{
  "original": "hello world hello",
  "result": "hi world hello",
  "replacements": 1
}
```

### text-transform__slice

시작/끝 위치로 부분 문자열을 추출합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `text` | string | 예 | -- | 입력 텍스트 |
| `start` | number | 아니오 | `0` | 시작 인덱스 (포함) |
| `end` | number | 아니오 | 문자열 끝 | 끝 인덱스 (미포함) |

**반환값:**

```json
{
  "original": "hello world",
  "result": "hello",
  "start": 0,
  "end": 5,
  "length": 5
}
```

### text-transform__split

구분자로 텍스트를 분할합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `text` | string | 예 | -- | 입력 텍스트 |
| `delimiter` | string | 아니오 | `"\n"` | 구분자 문자열 |
| `maxParts` | number | 아니오 | 무제한 | 최대 분할 개수 |

**반환값:**

```json
{
  "delimiter": "\n",
  "count": 3,
  "parts": ["line1", "line2", "line3"]
}
```

### text-transform__join

문자열 배열을 구분자로 결합합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `parts` | array | 예 | -- | 결합할 string/number/boolean 값 배열 |
| `delimiter` | string | 아니오 | `"\n"` | 구분자 문자열 |

**반환값:**

```json
{
  "delimiter": ", ",
  "count": 3,
  "result": "a, b, c"
}
```

### text-transform__trim

텍스트 양쪽의 공백을 제거합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `text` | string | 예 | -- | 입력 텍스트 |
| `mode` | string | 아니오 | `"both"` | 트림 모드: `"both"`, `"start"`, `"end"` |

**반환값:**

```json
{
  "original": "  hello  ",
  "result": "hello",
  "mode": "both",
  "trimmedLength": 4
}
```

### text-transform__case

텍스트 대소문자를 변환합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `text` | string | 예 | -- | 입력 텍스트 |
| `to` | string | 예 | -- | 변환 대상: `"upper"` 또는 `"lower"` |

**반환값:**

```json
{
  "original": "Hello World",
  "result": "HELLO WORLD",
  "to": "upper"
}
```

---

## agents

에이전트 간 통신 Tool. 에이전트가 다른 에이전트에게 작업을 위임하고, 메시지를 보내고, 인스턴스를 생성하고, 실행 중인 에이전트를 조회하고, 에이전트 카탈로그를 확인할 수 있습니다.

**리소스 이름:** `agents`
**오류 메시지 제한:** 1500자

> `ToolContext.runtime`이 사용 가능해야 합니다. 이 Tool은 통합 이벤트 모델(`AgentEvent`)을 사용하여 IPC를 통해 Orchestrator와 통신합니다.

### agents__request

다른 에이전트에게 요청 이벤트를 보냅니다. 기본은 응답 대기(`async=false`)이며, `async=true`를 주면 즉시 반환하고 응답은 호출자 메시지 inbox에 큐잉됩니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `target` | string | 예 | -- | 대상 에이전트 이름 |
| `input` | string | 예 | -- | 보낼 메시지 텍스트 |
| `instanceKey` | string | 아니오 | 호출자의 `instanceKey` | 대상 인스턴스 키 |
| `eventType` | string | 아니오 | `"agent.request"` | 커스텀 이벤트 타입 |
| `timeoutMs` | number | 아니오 | `60000` | 응답 타임아웃 (밀리초) |
| `async` | boolean | 아니오 | `false` | `false`: 블로킹 응답, `true`: 즉시 ack + 응답 큐잉 |
| `metadata` | object | 아니오 | -- | 이벤트에 첨부할 추가 메타데이터 |

**반환값:**

```json
{
  "target": "researcher",
  "eventId": "agent_event_abc123",
  "correlationId": "corr_xyz789",
  "accepted": true,
  "async": false,
  "response": "연구 결과입니다..."
}
```

`async=true`일 때 호출 시점의 `response`는 `null`일 수 있으며, 실제 응답은 `metadata.__goondanInterAgentResponse`를 가진 user 메시지로 주입됩니다.

### agents__send

다른 에이전트에게 fire-and-forget 이벤트를 보냅니다. 응답을 기다리지 않고 즉시 반환됩니다. 대상 에이전트가 실행 중이 아니면 자동으로 스폰됩니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `target` | string | 예 | -- | 대상 에이전트 이름 |
| `input` | string | 예 | -- | 보낼 메시지 텍스트 |
| `instanceKey` | string | 아니오 | 호출자의 `instanceKey` | 대상 인스턴스 키 |
| `eventType` | string | 아니오 | `"agent.send"` | 커스텀 이벤트 타입 |
| `metadata` | object | 아니오 | -- | 이벤트에 첨부할 추가 메타데이터 |

**반환값:**

```json
{
  "target": "logger",
  "eventId": "agent_event_abc123",
  "accepted": true
}
```

### agents__spawn

현재 Swarm에 이미 정의된 에이전트 리소스의 인스턴스를 스폰(또는 준비)합니다. 새로운 에이전트 정의를 생성하지 않으며, `goondan.yaml`에 선언된 에이전트의 인스턴스만 초기화합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `target` | string | 예 | -- | 에이전트 이름 (현재 Swarm에 정의되어 있어야 함) |
| `instanceKey` | string | 아니오 | -- | 스폰된 에이전트의 커스텀 인스턴스 키 |
| `cwd` | string | 아니오 | -- | 스폰된 에이전트의 작업 디렉토리 |

**반환값:**

```json
{
  "target": "worker",
  "instanceKey": "worker-task-42",
  "spawned": true,
  "cwd": null
}
```

### agents__list

현재 런타임에서 스폰된 에이전트 인스턴스를 나열합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `includeAll` | boolean | 아니오 | `false` | 모든 인스턴스 포함 (호출자가 스폰한 것만이 아닌) |

**반환값:**

```json
{
  "count": 2,
  "agents": [
    {
      "target": "worker",
      "instanceKey": "worker-task-1",
      "ownerAgent": "coordinator",
      "ownerInstanceKey": "coordinator",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "cwd": null
    }
  ]
}
```

### agents__catalog

선택된 Swarm에서 사용 가능하고 호출 가능한 에이전트를 조회합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| _(없음)_ | -- | -- | -- | 파라미터 없음 |

**반환값:**

```json
{
  "swarmName": "my-swarm",
  "entryAgent": "coordinator",
  "selfAgent": "coordinator",
  "availableCount": 3,
  "callableCount": 2,
  "availableAgents": ["coordinator", "researcher", "writer"],
  "callableAgents": ["researcher", "writer"]
}
```

---

## self-restart

오케스트레이터에 셀프 재시작 신호를 보냅니다. 에이전트가 설정 갱신이 필요하다고 판단하는 자기 진화(self-evolution) 시나리오에 사용됩니다.

**리소스 이름:** `self-restart`

### self-restart__request

런타임 재시작 신호를 통해 오케스트레이터 재시작을 요청합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `reason` | string | 아니오 | `"tool:self-restart"` | 재시작 요청 사유 |

**반환값:**

```json
{
  "ok": true,
  "restartRequested": true,
  "restartReason": "설정 업데이트"
}
```

> Tool 반환 후, 런타임은 재시작 신호를 감지하고 우아한 종료(Connector 종료 포함)를 수행한 뒤 대체 오케스트레이터 프로세스를 기동합니다.

---

## telegram

Telegram Bot API Tool. 메시지 전송, 편집, 삭제, 반응, 채팅 액션, 파일 다운로드를 지원합니다.

**리소스 이름:** `telegram`

**토큰 해석 순서:**
1. `token` 파라미터 (제공된 경우)
2. 환경 변수: `TELEGRAM_BOT_TOKEN`, `BOT_TOKEN`, `TELEGRAM_TOKEN`, `BRAIN_TELEGRAM_BOT_TOKEN`

**공통 선택 파라미터** (모든 export에서 사용 가능):

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `token` | string | 환경 변수 탐색 | 봇 토큰 오버라이드 |
| `timeoutMs` | number | `15000` | API 요청 타임아웃 |
| `apiBaseUrl` | string | `https://api.telegram.org` | 커스텀 API 베이스 URL |

### telegram__send

Telegram 채팅에 메시지를 보냅니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `chatId` | string | 예 | -- | 대상 채팅 ID (문자열 또는 정수) |
| `text` | string | 예 | -- | 메시지 텍스트 |
| `parseMode` | string | 아니오 | -- | 파싱 모드: `"Markdown"`, `"MarkdownV2"`, `"HTML"` (대소문자 무관 별칭 허용) |
| `disableNotification` | boolean | 아니오 | -- | 무음 전송 |
| `disableWebPagePreview` | boolean | 아니오 | -- | 링크 미리보기 비활성화 |
| `replyToMessageId` | number | 아니오 | -- | 답장할 메시지 ID |
| `allowSendingWithoutReply` | boolean | 아니오 | -- | 참조 메시지가 삭제되어도 답장 허용 |

**반환값:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "date": 1700000000,
  "text": "안녕하세요!"
}
```

### telegram__edit

Telegram 메시지의 텍스트를 편집합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `chatId` | string | 예 | -- | 채팅 ID |
| `messageId` | number | 예 | -- | 편집할 메시지 ID |
| `text` | string | 예 | -- | 새 메시지 텍스트 |
| `parseMode` | string | 아니오 | -- | 파싱 모드 |
| `disableWebPagePreview` | boolean | 아니오 | -- | 링크 미리보기 비활성화 |

**반환값:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "edited": true
}
```

### telegram__delete

Telegram 채팅에서 메시지를 삭제합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `chatId` | string | 예 | -- | 채팅 ID |
| `messageId` | number | 예 | -- | 삭제할 메시지 ID |

**반환값:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "deleted": true
}
```

### telegram__react

Telegram 메시지에 반응을 설정하거나 지웁니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `chatId` | string | 예 | -- | 채팅 ID |
| `messageId` | number | 예 | -- | 메시지 ID |
| `emoji` | string | 조건부* | -- | 단일 이모지 반응 |
| `emojis` | string[] | 조건부* | -- | 복수 이모지 반응 |
| `clear` | boolean | 아니오 | `false` | 모든 반응 제거 |
| `isBig` | boolean | 아니오 | -- | 큰 반응 애니메이션 표시 |

*`emoji`, `emojis`, 또는 `clear=true` 중 하나를 제공해야 합니다.

**반환값:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "cleared": false,
  "emojis": ["thumbsup"],
  "reactionCount": 1
}
```

### telegram__setChatAction

봇 채팅 액션(예: "입력 중..." 표시기)을 설정합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `chatId` | string | 예 | -- | 채팅 ID |
| `action` | string | 아니오 | `"typing"` | 채팅 액션 (`status`의 별칭) |
| `status` | string | 아니오 | `"typing"` | 채팅 액션 (`action`의 별칭) |

지원 액션: `typing`, `upload-photo`, `record-video`, `upload-video`, `record-voice`, `upload-voice`, `upload-document`, `choose-sticker`, `find-location`, `record-video-note`, `upload-video-note`

**반환값:**

```json
{
  "ok": true,
  "chatId": "123456",
  "status": "typing",
  "action": "typing"
}
```

### telegram__downloadFile

파일 ID로 Telegram 파일을 다운로드합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `fileId` | string | 조건부* | -- | Telegram 파일 ID |
| `file_id` | string | 조건부* | -- | 파일 ID 대체 키 |
| `maxBytes` | number | 아니오 | `3000000` | 최대 다운로드 크기 (1--20,000,000) |
| `includeBase64` | boolean | 아니오 | `true` | base64 인코딩 콘텐츠 포함 |
| `includeDataUrl` | boolean | 아니오 | `true` | 데이터 URL 포함 |
| `savePath` | string | 아니오 | -- | 파일 저장 경로 (`ctx.workdir` 기준 상대) |
| `outputPath` | string | 아니오 | -- | 저장 경로 대체 키 |

*`fileId` 또는 `file_id` 중 하나를 제공해야 합니다.

**반환값:**

```json
{
  "ok": true,
  "fileId": "ABC123",
  "fileUniqueId": "XYZ",
  "filePath": "photos/file_0.jpg",
  "fileSize": 12345,
  "downloadUrl": "https://api.telegram.org/file/bot.../photos/file_0.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 12345,
  "savedPath": null,
  "base64": "...",
  "dataUrl": "data:image/jpeg;base64,..."
}
```

---

## slack

Slack API Tool. 메시지 전송, 읽기, 편집, 삭제, 반응, 파일 다운로드를 지원합니다.

**리소스 이름:** `slack`

**토큰 해석 순서:**
1. `token` 파라미터 (제공된 경우)
2. 환경 변수: `SLACK_BOT_TOKEN`, `SLACK_TOKEN`, `BRAIN_SLACK_BOT_TOKEN`

**공통 선택 파라미터** (모든 export에서 사용 가능):

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `token` | string | 환경 변수 탐색 | 봇 토큰 오버라이드 |
| `timeoutMs` | number | `15000` | API 요청 타임아웃 |
| `apiBaseUrl` | string | `https://slack.com/api` | 커스텀 API 베이스 URL |

### slack__send

Slack 채널에 메시지를 보냅니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `channelId` | string | 예 | -- | 대상 채널 ID (별칭: `channel`) |
| `text` | string | 예 | -- | 메시지 텍스트 |
| `threadTs` | string | 아니오 | -- | 스레드 타임스탬프 (스레드 답장) |
| `mrkdwn` | boolean | 아니오 | -- | Markdown 포매팅 활성화 |
| `unfurlLinks` | boolean | 아니오 | -- | 링크 펼침 활성화 |
| `unfurlMedia` | boolean | 아니오 | -- | 미디어 펼침 활성화 |
| `replyBroadcast` | boolean | 아니오 | -- | 스레드 답장을 채널에 브로드캐스트 |

**반환값:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "text": "안녕하세요!"
}
```

### slack__read

Slack 채널 또는 스레드의 메시지를 읽습니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `channelId` | string | 예 | -- | 채널 ID (별칭: `channel`) |
| `messageTs` | string | 아니오 | -- | 타임스탬프로 특정 메시지 조회 (별칭: `ts`, `timestamp`) |
| `threadTs` | string | 아니오 | -- | 스레드 답장 읽기 |
| `latest` | string | 아니오 | -- | 최신 메시지 타임스탬프 상한 |
| `oldest` | string | 아니오 | -- | 가장 오래된 메시지 타임스탬프 하한 |
| `inclusive` | boolean | 아니오 | 자동 | 경계 메시지 포함 |
| `limit` | number | 아니오 | `20` (`messageTs` 설정 시 `1`) | 최대 반환 메시지 수 (1--1000) |
| `cursor` | string | 아니오 | -- | 페이지네이션 커서 |

**반환값:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "method": "conversations.history",
  "messageTs": null,
  "threadTs": null,
  "count": 5,
  "found": null,
  "messages": [ ... ],
  "hasMore": false,
  "nextCursor": null
}
```

### slack__edit

Slack 메시지를 편집합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `channelId` | string | 예 | -- | 채널 ID (별칭: `channel`) |
| `messageTs` | string | 예 | -- | 편집할 메시지 타임스탬프 (별칭: `ts`, `timestamp`) |
| `text` | string | 예 | -- | 새 메시지 텍스트 |
| `mrkdwn` | boolean | 아니오 | -- | Markdown 포매팅 활성화 |

**반환값:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "edited": true
}
```

### slack__delete

Slack 메시지를 삭제합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `channelId` | string | 예 | -- | 채널 ID (별칭: `channel`) |
| `messageTs` | string | 예 | -- | 삭제할 메시지 타임스탬프 (별칭: `ts`, `timestamp`) |

**반환값:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "deleted": true
}
```

### slack__react

Slack 메시지에 하나 이상의 반응을 추가합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `channelId` | string | 예 | -- | 채널 ID (별칭: `channel`) |
| `messageTs` | string | 예 | -- | 메시지 타임스탬프 (별칭: `ts`, `timestamp`) |
| `emoji` | string | 조건부* | -- | 단일 이모지 이름 (`:콜론:` 유무 모두 가능) |
| `emojis` | string[] | 조건부* | -- | 복수 이모지 이름 |

*`emoji` 또는 `emojis` 중 하나를 제공해야 합니다.

**반환값:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "emojis": ["thumbsup", "wave"],
  "reactionCount": 2
}
```

### slack__downloadFile

봇 토큰 인증으로 Slack 파일을 다운로드합니다.

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `url` | string | 조건부* | -- | 파일 다운로드 URL (별칭: `fileUrl`, `downloadUrl`) |
| `maxBytes` | number | 아니오 | `3000000` | 최대 다운로드 크기 (1--20,000,000) |
| `includeBase64` | boolean | 아니오 | `true` | base64 인코딩 콘텐츠 포함 |
| `includeDataUrl` | boolean | 아니오 | `true` | 데이터 URL 포함 |
| `savePath` | string | 아니오 | -- | 파일 저장 경로 (`ctx.workdir` 기준 상대) |
| `outputPath` | string | 아니오 | -- | 저장 경로 대체 키 |

*`url`, `fileUrl`, `downloadUrl` 중 하나를 제공해야 합니다.

**반환값:**

```json
{
  "ok": true,
  "url": "https://files.slack.com/...",
  "contentType": "image/png",
  "contentLength": 54321,
  "sizeBytes": 54321,
  "etag": "\"abc123\"",
  "contentDisposition": "attachment; filename=\"image.png\"",
  "savedPath": null,
  "base64": "...",
  "dataUrl": "data:image/png;base64,..."
}
```

---

## YAML 사용 예제

내장 Tool을 에이전트에서 사용하려면 `goondan.yaml`에서 참조하세요:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompt:
    system: "당신은 유용한 어시스턴트입니다."
  tools:
    - ref: Tool/bash
    - ref: Tool/file-system
    - ref: Tool/http-fetch
    - ref: Tool/agents
```

참조된 Tool의 모든 export가 등록됩니다. LLM은 `bash__exec`, `bash__script`, `file-system__read`, `file-system__write` 등의 이름으로 도구를 확인합니다.

---

_문서 버전: v0.0.3_
