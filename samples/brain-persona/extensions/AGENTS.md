# samples/brain-persona/extensions

`extensions` 폴더는 brain-persona 샘플에서 Agent Turn/Step/ToolCall 파이프라인에 개입하는 로컬 Extension 엔트리를 둔다.

## 목적

- 런타임 코어를 수정하지 않고 샘플별 컨텍스트 주입/정책 적용을 실험한다.
- `Agent.spec.extensions`로 선언한 순서대로 등록되는 middleware 동작을 검증한다.

## Extension 목록

| 파일 | 대상 Agent | 훅 | 설명 |
|------|-----------|-----|------|
| `worker-lifecycle.ts` | worker | turn.pre, turn.post | turn.pre에서 unconscious를 호출해 맥락 주입, turn.post에서 observer에 구조화 관측 이벤트(JSON + legacy summary) 전송 및 `ctx.inputEvent.metadata/source` 기반 `coordinatorInstanceKey` 전달 |
| `date-helper.ts` | worker | step.pre | 매 step마다 `[current_time]` 시스템 메시지로 현재 시각 주입 (`ctx.inputEvent.source/metadata` 타임스탬프 우선) |
| `idle-monitor.ts` | coordinator | turn.pre | 유휴 시간 감지 시 `[idle_detected]` 시스템 메시지를 주입하여 dream 트리거 유도 |

coordinator의 시스템 프롬프트 + `[runtime_catalog]` 합성은 로컬 파일이 아니라 `@goondan/base` `Extension/context-message`(config: `includeSwarmCatalog=true`)가 담당한다.

## 작성 규칙

1. 엔트리 모듈은 `register(api)` named export를 제공해야 한다.
2. 메시지 주입이 필요하면 `ctx.emitMessageEvent()`를 사용하고, metadata에 주입 출처를 남긴다.
3. 샘플 목적상 런타임 내부 필드에 직접 의존하지 말고, `ctx.inputEvent.source`/`ctx.inputEvent.metadata`/Tool API(`agents__catalog`)를 우선 사용한다.
4. 새 extension 추가/수정 시 `samples/brain-persona/goondan.yaml`, `samples/brain-persona/README.md`, 상위 `AGENTS.md`를 함께 동기화한다.
