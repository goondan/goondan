# Telegram Connector

Telegram Bot API를 통해 메시지를 수신하고 응답을 전송하는 Connector입니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (YAML)
- `index.ts` - Trigger 핸들러 및 Telegram API 함수 구현

## 주요 기능

### Trigger Handler

- `onUpdate` - Telegram Webhook 업데이트 처리
  - 메시지 수신 및 명령어 파싱
  - Ingress 규칙 매칭
  - CanonicalEvent 생성 및 발행

### Telegram API 함수

- `sendMessage` - 메시지 전송
- `editMessage` - 메시지 수정
- `deleteMessage` - 메시지 삭제
- `setWebhook` - Webhook URL 설정
- `getWebhookInfo` - Webhook 정보 조회
- `deleteWebhook` - Webhook 삭제

## 사용법

### connector.yaml 설정

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: telegram
spec:
  type: telegram
  runtime: node
  entry: "./connectors/telegram/index.js"
  auth:
    staticToken:
      valueFrom:
        env: "TELEGRAM_BOT_TOKEN"
  ingress:
    - match:
        command: "/start"
      route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.message.chat.id"
        inputFrom: "$.message.text"
  egress:
    updatePolicy:
      mode: newMessage
  triggers:
    - handler: onUpdate
```

### Ingress 규칙

- `match.command` - 봇 명령어 매칭 (예: "/start", "/help")
- `match.channel` - 특정 채팅 ID 매칭
- `route.swarmRef` - 대상 Swarm
- `route.instanceKeyFrom` - 인스턴스 키 추출 (JSONPath)
- `route.inputFrom` - 입력 텍스트 추출 (JSONPath)
- `route.agentName` - 특정 에이전트로 라우팅 (선택)

## 참조 문서

- [Connector 스펙](/docs/specs/connector.md)
- [Telegram Bot API](https://core.telegram.org/bots/api)
