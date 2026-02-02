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
- `agent.delegate`: 전문 에이전트에게 작업 위임
- `agent.complete`: 위임받은 작업 완료 보고
- `AVAILABLE_AGENTS`: 에이전트 정보 (name, description, capabilities)

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
   - 이벤트 발행 형식 유지 (`agent.delegated`, `agent.completed`)
   - 에러 핸들링 및 사용자 피드백 제공
   - delegationId 생성 규칙 유지

3. **프롬프트 수정 시**
   - 역할과 책임 범위 명확히 정의
   - 사용 가능한 도구 목록 정확히 기술
   - 완료 보고 (`agent.complete`) 사용법 포함

4. **Swarm 구성 수정 시**
   - entrypoint는 항상 router로 유지
   - 모든 에이전트가 agents 목록에 포함되어야 함
   - maxStepsPerTurn이 충분히 커야 다단계 위임 가능

## 멀티 에이전트 아키텍처

```
User Message
     │
     ▼
┌─────────┐
│ Router  │ ──── agent.list (에이전트 확인)
└────┬────┘
     │ agent.delegate
     ▼
┌─────────┐     ┌──────────┐     ┌──────┐
│ Coder   │     │ Reviewer │     │ Docs │
└────┬────┘     └────┬─────┘     └──┬───┘
     │               │              │
     └───────────────┴──────────────┘
                     │
                     ▼ agent.complete
               ┌─────────┐
               │ Router  │
               └────┬────┘
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

- 비동기 작업 처리 (작업 큐)
- 에이전트 간 직접 통신
- 작업 결과 캐싱
- 복합 작업의 병렬 처리
- 작업 진행 상황 실시간 알림
