# Goondan Studio/Runtime 진단

## 1) 결론 요약

현재 문제의 본질은 **Runtime 이벤트 계약이 관측 목적에 충분히 구조화되어 있지 않아, Studio가 메시지 로그를 휴리스틱으로 추론**하고 있다는 점이다.  
즉, 증상(시간 이상, 빈 user 메시지 다발, 잘못된 방향 간선, local 응답 오인)은 개별 버그가 아니라 **설계 경계 불일치**에서 발생한다.

## 2) 주요 구조적 문제

1. RuntimeEvent 정보량 부족
- `turn.completed`가 실행 결과를 충분히 담지 못함(실제 step 개수, finish reason, response 요약 부족).
- 근거: `packages/runtime/src/pipeline/registry.ts`

2. 관측 정보의 Message metadata 과적재
- inbound/발신자 정보를 `message.metadata.__goondanInbound`로 저장해 Studio가 다시 파싱함.
- Message 상태 복원 모델과 관측 모델이 섞여 관심사 분리가 깨짐.
- 근거: `packages/runtime/src/runner/runtime-runner.ts`

3. Studio의 라우팅 휴리스틱 의존
- `routeState`(replyTarget/expectsDirectReply)로 assistant target을 추론.
- `contentKind`가 text가 아니면 `system:runtime`으로 분류하는 보정이 실제 흐름 왜곡을 유발.
- 근거: `packages/cli/src/services/studio.ts`

4. Connector 흐름의 비구조화
- connector 이벤트를 구조화 이벤트가 아니라 stdout 패턴 파싱으로 복원.
- 타임스탬프/의미 정확도 저하.
- 근거: `packages/runtime/src/runner/runtime-runner.ts`, `packages/cli/src/services/studio.ts`

5. 타입/스펙 SSOT 드리프트
- 스펙의 `AgentEvent.instanceKey`와 실제 타입 구현 불일치.
- `RuntimeEvent` 타입 소유권이 `@goondan/types`가 아닌 runtime 내부에 존재.
- 근거: `docs/specs/shared-types.md`, `packages/types/src/events.ts`, `packages/runtime/src/events/runtime-events.ts`

## 3) 왜 로그가 이상해 보였는가 (증상 매핑)

- 빈 user 메시지 다발: 내부 tool-result/보정 메시지가 user role로 저장되고 Studio가 외부 user처럼 해석.
- 방향 꼬임: inbound metadata 누락/해석 실패 시 routeState 기반 추론이 이전 문맥에 오염.
- worker/observer/coordinator 간 갑작스런 화살표: `agent.send`와 `agent.request`를 실행 의미로 분리하지 못해 direct reply처럼 렌더링.
- 시간 이상: event/message/log의 timestamp 계약이 약해 fallback 시간(파일 mtime 등) 사용이 섞임.

## 4) 근본 원인 분류

1. 모델링 문제
- 상태 복원용 메시지 모델과 관측용 실행 이벤트 모델의 분리가 불완전.

2. 계약 문제
- Runtime → Studio 데이터 계약이 문서/타입으로 강제되지 않고 구현 관례(metadata key, 로그 포맷)에 의존.

3. 구현 문제
- Studio가 필연적으로 휴리스틱(추론/보정)을 사용하게 되어 오탐/왜곡 발생.

## 5) 재설계 원칙 (v0.0.3, 하위호환 미고려)

1. **Plane 분리 고정**
- `base/events`는 상태 복원 전용, `runtime-events`는 관측 전용으로 엄격 분리.

2. **RuntimeEvent 계약 승격**
- `@goondan/types`를 단일 소유자로 두고, Studio는 이 계약만 소비.
- 최소 필수: `id`, `sequence`, `timestamp`, `traceId`, `instanceKey`, `turnId`, `stepId`, `phase`, `source`, `target`, `payload`.

3. **Runtime이 의미를 직접 발행**
- inbound/connector/turn/step/tool/message-summary 이벤트를 구조화해서 직접 emit.
- Studio의 route/content 휴리스틱 제거.

4. **Connector 이벤트 구조화**
- stdout 파싱 제거(또는 보조화), connector 관측도 runtime-events에 통합.

5. **스펙-타입-구현 일원화**
- `shared-types.md` ↔ `packages/types` ↔ runtime/cli/studio를 단일 계약 체인으로 정렬.

## 6) 즉시 실행 우선순위

1. `RuntimeEvent`를 `packages/types`로 이동/정의 통합.
2. `pipeline`의 turn/step/tool emit payload 확장(실행 재구성 가능 수준).
3. runtime-runner에서 inbound/connector 이벤트를 runtime-events로 직접 발행.
4. Studio service의 routeState/contentKind 기반 추론 제거.
5. 스펙 업데이트: `docs/specs/shared-types.md`, `docs/specs/runtime.md`, `docs/specs/cli.md`, `docs/architecture.md`.

---

이 문서는 “Studio 로그 이상 현상”을 단일 버그가 아닌 **Runtime 관측 계약 재설계 과제**로 정의한 진단 결과다.
