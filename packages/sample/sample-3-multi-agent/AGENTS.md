# Sample 3: Multi-Agent Telegram Bot

멀티 에이전트 텔레그램 봇 샘플입니다.

## 디렉터리 구조

```
sample-3-multi-agent/
├── src/
│   ├── connectors/telegram/   # Telegram 봇 커넥터 (Sample 2와 동일)
│   └── tools/
│       ├── delegate/          # 에이전트 위임 도구 (핵심)
│       ├── code/              # 코딩 도구 (Sample 2와 동일)
│       └── git/               # Git 도구 (Sample 2와 동일)
├── prompts/
│   ├── router.system.md       # 라우터 에이전트 프롬프트
│   ├── coder.system.md        # 코더 에이전트 프롬프트
│   ├── reviewer.system.md     # 리뷰어 에이전트 프롬프트
│   └── docs.system.md         # 문서화 에이전트 프롬프트
├── goondan.yaml               # 멀티 에이전트 구성
├── bundle.yaml                # 번들 매니페스트
└── package.json
```

## 핵심 파일

### src/tools/delegate/index.ts
- `agent.list`: 사용 가능한 에이전트 목록 조회
- `agent.delegate`: 전문 에이전트에게 작업 위임 (비동기 이벤트 큐 방식)
- `AVAILABLE_AGENTS`: 에이전트 정보 (name, description, capabilities)

**스펙 기반 동작 (docs/requirements/05_core-concepts.md §5.1, docs/requirements/09_runtime-model.md §9.2):**
- AgentInstance는 이벤트 큐를 가진다 (MUST)
- 큐의 이벤트 하나가 Turn의 입력이 된다 (MUST)
- 위임 흐름:
  1. `agent.delegate` 호출 → 대상 에이전트 큐에 작업 enqueue
  2. 대상 에이전트 Turn 완료 → 결과가 원래 에이전트 큐에 enqueue
  3. 원래 에이전트의 새 Turn에서 결과 처리

### goondan.yaml
멀티 에이전트 구성의 핵심:
- **Model**: anthropic claude-sonnet-4-5 (공유)
- **Agent 4개**:
  - `router`: 진입점, 작업 분석 및 위임
  - `coder`: 코드 작성/수정 전문
  - `reviewer`: 코드 리뷰 전문
  - `docs`: 문서화 전문
- **Swarm**: entrypoint=router, 모든 에이전트 포함
- **Connector**: telegram

### prompts/*.system.md
각 에이전트의 역할과 동작 방식을 정의:
- `router.system.md`: 요청 분석, 위임 전략, 결과 종합
- `coder.system.md`: 코딩 원칙, 도구 사용법
- `reviewer.system.md`: 리뷰 관점, 피드백 형식
- `docs.system.md`: 문서화 유형, 품질 기준

## 작업 시 참고사항

1. **에이전트 추가 시**
   - `AVAILABLE_AGENTS`에 새 에이전트 정보 추가
   - `tool.yaml`의 enum에 에이전트 이름 추가
   - 프롬프트 파일 작성
   - `goondan.yaml`에 Agent 정의 추가
   - Swarm의 agents 목록에 포함

2. **위임 로직 수정 시**
   - 이벤트 발행 형식 유지 (`agent.delegate`, `agent.delegationResult`)
   - 에러 핸들링 및 사용자 피드백 제공
   - delegationId 생성 규칙 유지
   - §9.1.1: turn.auth는 handoff 시 변경 없이 전달 (MUST)

3. **프롬프트 수정 시**
   - 역할과 책임 범위 명확히 정의
   - 사용 가능한 도구 목록 정확히 기술
   - Turn 완료 시 자동으로 결과가 반환됨 (명시적 complete 불필요)

4. **Swarm 구성 수정 시**
   - entrypoint는 항상 router로 유지
   - 모든 에이전트가 agents 목록에 포함되어야 함
   - maxStepsPerTurn이 충분히 커야 다단계 위임 가능

## 멀티 에이전트 아키텍처 (비동기 이벤트 큐 방식)

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│ Router Turn 1                                           │
│   └─ agent.delegate → coder 큐에 작업 enqueue           │
│   └─ "작업 위임 완료" 응답                               │
└────┬────────────────────────────────────────────────────┘
     │ (비동기)
     ▼
┌─────────────────────────────────────────────────────────┐
│ Coder Turn                                              │
│   └─ code.write, code.execute                          │
│   └─ Turn 완료 → delegationResult 이벤트 발행           │
└────┬────────────────────────────────────────────────────┘
     │ (비동기)
     ▼
┌─────────────────────────────────────────────────────────┐
│ Router Turn 2                                           │
│   └─ [위임 결과 - coder] 입력 수신                       │
│   └─ 최종 응답 생성                                     │
└────┬────────────────────────────────────────────────────┘
     │
     ▼
User Response
```

## 빌드 및 테스트

```bash
# 빌드
pnpm build

# 타입 체크
pnpm typecheck

# 실행 (TELEGRAM_BOT_TOKEN 필요)
pnpm run
```

## 확장 아이디어

- 복합 작업의 병렬 위임 (여러 에이전트 동시 실행)
- 에이전트 간 직접 통신 (라우터 거치지 않음)
- 작업 결과 캐싱
- 작업 진행 상황 실시간 알림
- 위임 체인 추적 (delegation DAG)
