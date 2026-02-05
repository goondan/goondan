# Compaction Extension Sample

LLM 대화 압축(Compaction) Extension 샘플입니다. 긴 대화를 요약/압축하여 컨텍스트 윈도우를 효율적으로 관리합니다.

## 개요

대화가 길어지면 LLM의 컨텍스트 윈도우 제한에 도달할 수 있습니다. Compaction Extension은 자동으로 오래된 메시지를 요약하여 컨텍스트를 압축하면서도 중요한 정보는 보존합니다.

## Compaction 전략

### 1. Token 기반 (`strategy: token`)

추정 토큰 수가 `maxTokens`를 초과하면 오래된 메시지를 요약합니다.

```yaml
spec:
  config:
    strategy: token
    maxTokens: 8000
    preserveRecent: 5
```

- **maxTokens**: 최대 토큰 수 (기본: 8000)
- **preserveRecent**: 보존할 최근 메시지 수 (기본: 5)

### 2. Turn 기반 (`strategy: turn`)

대화 턴(사용자-어시스턴트 쌍) 수가 `maxTurns`를 초과하면 요약합니다.

```yaml
spec:
  config:
    strategy: turn
    maxTurns: 20
    preserveRecent: 5
```

- **maxTurns**: 최대 턴 수 (기본: 20)
- **preserveRecent**: 보존할 최근 턴 수 (기본: 5)

### 3. Sliding Window (`strategy: sliding`)

항상 최근 N개 메시지만 유지하고 나머지는 요약합니다.

```yaml
spec:
  config:
    strategy: sliding
    windowSize: 10
```

- **windowSize**: 유지할 메시지 창 크기 (기본: 10)

## 사용 방법

### 1. Extension 정의

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: compaction
spec:
  runtime: node
  entry: "./extensions/compaction/index.js"
  config:
    strategy: token
    maxTokens: 8000
    preserveRecent: 5
    enableLogging: true
```

### 2. Agent에 Extension 추가

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: main-agent
spec:
  modelConfig:
    modelRef:
      kind: Model
      name: gpt-4o
  extensions:
    - kind: Extension
      name: compaction
```

## 제공되는 Tool

Extension은 다음 Tool을 자동으로 등록합니다:

### `compaction.getStatus`

현재 압축 상태와 통계를 조회합니다.

```json
{
  "strategy": "token",
  "compactionCount": 3,
  "totalMessagesCompacted": 45,
  "estimatedTokens": 6500,
  "maxTokens": 8000
}
```

### `compaction.getSummaries`

이전 압축에서 생성된 요약 목록을 조회합니다.

```json
{
  "total": 3,
  "summaries": [
    {
      "timestamp": 1706000000000,
      "messageCount": 15,
      "tokensSaved": 2500,
      "summaryPreview": "User discussed project requirements..."
    }
  ]
}
```

### `compaction.forceCompact`

수동으로 압축을 강제 실행합니다.

## 아키텍처

```
extensions/compaction/
├── index.ts           # Extension 엔트리포인트
├── types.ts           # 타입 정의
└── strategies/        # 압축 전략 구현
    ├── index.ts       # 전략 레지스트리
    ├── token.ts       # 토큰 기반 전략
    ├── turn.ts        # 턴 기반 전략
    └── sliding.ts     # 슬라이딩 윈도우 전략
```

## 파이프라인 통합

Extension은 다음 파이프라인 포인트에 등록됩니다:

- **turn.pre**: Turn 처리 전에 메시지 압축 수행
- **step.blocks**: 압축 상태 정보 블록 추가

## 테스트

```bash
pnpm test
```

## 주의사항

1. **요약 품질**: 현재 구현은 간단한 추출 기반 요약을 사용합니다. 프로덕션에서는 별도의 LLM 호출로 고품질 요약을 생성하는 것을 권장합니다.

2. **토큰 추정**: 토큰 수는 대략적인 추정값입니다(4글자 = 1토큰). 정확한 토큰 계산이 필요하면 tiktoken 등의 라이브러리를 사용하세요.

3. **컨텍스트 손실**: 압축 시 일부 세부 정보가 손실될 수 있습니다. `preserveRecent` 값을 적절히 설정하여 중요한 최근 컨텍스트를 보존하세요.

## 라이선스

MIT
