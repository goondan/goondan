# CLI Connector (v1.0)

readline 기반으로 CLI 입력을 수신하고 ConnectorEvent로 변환하여 emit하는 Connector입니다.
단일 default export 패턴을 따릅니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (triggers, events 선언)
- `index.ts` - 단일 default export Entry Function 및 Interactive CLI 함수

## 주요 기능

### Entry Function (default export)

- `cliConnector(context: ConnectorContext)` - CLI trigger 이벤트 처리
  - `event.type === 'connector.trigger'` 확인
  - `event.trigger` 타입 가드: `isCliTrigger()`로 CLI trigger 확인
  - `trigger.payload.text`에서 입력 텍스트 추출
  - `:exit`, `:quit` 종료 명령어 처리
  - `emit()` 호출로 ConnectorEvent 발행

### ConnectorEvent 발행

- `name: 'user_input'`
- `message: { type: 'text', text: trimmedText }`
- `properties: { instanceKey }`
- `auth: { actor: { id, name }, subjects: { global, user } }`

### Interactive CLI

- `startInteractiveCli(options)` - readline 기반 대화형 CLI 세션 시작
  - 프롬프트 표시 및 사용자 입력 루프
  - 종료 명령어 자동 감지
  - readline.Interface 반환 (외부에서 close 가능)

### 유틸리티

- `isExitCommand(input)` - 종료 명령어 확인 (`:exit`, `:quit`)

## connector.yaml 구조

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  runtime: node
  entry: "./connectors/cli/index.js"
  triggers:
    - type: cli
  events:
    - name: user_input
      properties:
        instanceKey: { type: string }
```

## 타입 import

- `ConnectorContext`, `ConnectorEvent`, `CliTriggerPayload` from `@goondan/core`

## 참조 문서

- [Connector 스펙](/docs/specs/connector.md)
