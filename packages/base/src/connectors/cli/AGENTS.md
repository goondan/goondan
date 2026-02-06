# CLI Connector

readline 기반으로 CLI 입력을 수신하고 응답을 console.log로 출력하는 Connector입니다.

## 파일 구조

- `connector.yaml` - Connector 리소스 정의 (YAML)
- `index.ts` - Trigger 핸들러 및 Interactive CLI 함수 구현

## 주요 기능

### Trigger Handler

- `onCliInput` - CLI 입력 이벤트 처리
  - payload에서 `text`, `instanceKey` 추출
  - Ingress 규칙 매칭 (JSONPath 기반)
  - CanonicalEvent 생성 및 발행
  - `:exit`, `:quit` 종료 명령어 처리

### Interactive CLI

- `startInteractiveCli` - readline 기반 대화형 CLI 세션 시작
  - 프롬프트 표시 및 사용자 입력 루프
  - 종료 명령어 자동 감지
  - readline.Interface 반환 (외부에서 close 가능)

### 유틸리티

- `isExitCommand` - 종료 명령어 확인 (`:exit`, `:quit`)

## 사용법

### connector.yaml 설정

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  runtime: node
  entry: "./connectors/cli/index.js"
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
  egress:
    updatePolicy:
      mode: append
  triggers:
    - handler: onCliInput
```

### Ingress 규칙

- `route.swarmRef` - 대상 Swarm
- `route.instanceKeyFrom` - 인스턴스 키 추출 (JSONPath, 기본: 'cli-default')
- `route.inputFrom` - 입력 텍스트 추출 (JSONPath)
- `route.agentName` - 특정 에이전트로 라우팅 (선택)

## 참조 문서

- [Connector 스펙](/docs/specs/connector.md) - Section 9. CLI Connector 구현 예시
