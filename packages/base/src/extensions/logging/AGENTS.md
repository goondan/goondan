# extensions/logging - 대화 로깅 Extension

LLM 대화를 파일로 로깅하는 Extension입니다.

## 파일 구성

- `extension.yaml`: Extension 리소스 정의
- `index.ts`: Extension 핸들러 구현

## 파이프라인 등록

| 포인트 | 타입 | 설명 |
|--------|------|------|
| `step.llmCall` | wrap (middleware) | LLM 요청/응답 로깅 |
| `turn.post` | mutate (mutator) | Turn 완료 시 요약 로깅 |

## 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `logLevel` | string | `"info"` | 로그 레벨 (debug, info, warn, error) |
| `logDir` | string | `"./logs"` | 로그 파일 저장 경로 |
| `includeTimestamp` | boolean | `true` | 타임스탬프 포함 여부 |
| `maxLogFileSizeMB` | number | `10` | 로그 파일 최대 크기 (MB) |

## 로그 형식

```
[2026-02-06T12:00:00.000Z] [LLM_REQUEST] agent=planner messages=5
[2026-02-06T12:00:01.000Z] [LLM_RESPONSE] agent=planner elapsed=1200ms toolCalls=2 content=...
[2026-02-06T12:00:02.000Z] [TURN_COMPLETE] agent=planner turnId=abc123 totalMessages=8
```

## 수정 시 주의사항

1. 로그 기록 실패는 무시 (로깅이 메인 로직을 방해하면 안 됨)
2. 타입 단언(`as`) 금지 - 타입 가드로 해결
3. basicCompaction Extension 패턴 참고
