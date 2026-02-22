# samples/brain-persona/extensions

`extensions` 폴더는 brain-persona 샘플에서 Agent Turn/Step/ToolCall 파이프라인에 개입하는 로컬 Extension 엔트리를 둔다.

## 목적

- 런타임 코어를 수정하지 않고 샘플별 컨텍스트 주입/정책 적용을 실험한다.
- `Agent.spec.extensions`로 선언한 순서대로 등록되는 middleware 동작을 검증한다.

## Extension 목록

| 파일 | 대상 Agent | 훅 | 설명 |
|------|-----------|-----|------|
| `context-injector.ts` | coordinator | turn.pre | `[runtime_catalog]` 힌트를 시스템 메시지로 주입 |
| `worker-lifecycle.ts` | worker | turn.pre, turn.post | turn.pre에서 unconscious를 호출해 맥락 주입, turn.post에서 observer를 트리거해 관측 기록 |
| `date-helper.ts` | worker | step.pre | 매 step마다 `[current_time]` 시스템 메시지로 현재 시각 주입 |
| `idle-monitor.ts` | coordinator | turn.pre | 유휴 시간 감지 시 `[idle_detected]` 시스템 메시지를 주입하여 dream 트리거 유도 |

## 작성 규칙

1. 엔트리 모듈은 `register(api)` named export를 제공해야 한다.
2. 메시지 주입이 필요하면 `ctx.emitMessageEvent()`를 사용하고, metadata에 주입 출처를 남긴다.
3. 샘플 목적상 런타임 내부 필드에 직접 의존하지 말고, `ctx.metadata`/Tool API(`agents__catalog`)를 우선 사용한다.
4. 새 extension 추가/수정 시 `samples/brain-persona/goondan.yaml`, `samples/brain-persona/README.md`, 상위 `AGENTS.md`를 함께 동기화한다.
