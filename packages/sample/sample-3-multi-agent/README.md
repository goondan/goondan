# Sample 3: Multi-Agent Telegram Bot

라우터 에이전트가 전문 에이전트들에게 작업을 위임하는 멀티 에이전트 시스템입니다.

## 개요

이 샘플은 다음을 보여줍니다:

- **멀티 에이전트 아키텍처**: 역할별 전문화된 에이전트 구성
- **에이전트 위임 패턴**: 라우터가 작업을 분석하고 적절한 에이전트에게 위임
- **이벤트 기반 통신**: `agent.delegate` 이벤트를 통한 에이전트 간 협업
- **Swarm 구성**: 여러 에이전트를 하나의 Swarm으로 조직

## 에이전트 구성

```
┌─────────────────────────────────────────────────────────┐
│                       Swarm                             │
│                                                         │
│  ┌─────────────┐                                       │
│  │   Router    │  ← 진입점: 요청 분석 및 위임         │
│  └──────┬──────┘                                       │
│         │                                               │
│    ┌────┴────┬──────────┐                              │
│    ▼         ▼          ▼                              │
│ ┌──────┐ ┌────────┐ ┌──────┐                          │
│ │Coder │ │Reviewer│ │ Docs │                          │
│ └──────┘ └────────┘ └──────┘                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Router (라우터)
- 사용자 요청을 분석
- 적절한 전문 에이전트 선택
- 작업 위임 및 결과 종합

### Coder (개발자)
- 코드 작성 및 수정
- 버그 수정, 리팩토링
- 코드 실행 및 테스트

### Reviewer (리뷰어)
- 코드 품질 검토
- 보안 취약점 분석
- 성능 개선 제안

### Docs (문서화)
- README 작성
- API 문서화
- 코드 주석 추가

## 사전 요구사항

1. **Telegram Bot Token**
   ```bash
   export TELEGRAM_BOT_TOKEN="your-token"
   ```

2. **LLM API Key**
   ```bash
   export ANTHROPIC_API_KEY="your-key"
   ```

## 설치 및 실행

```bash
# 의존성 설치 (루트에서)
pnpm install

# 빌드
pnpm build

# 번들 등록 (처음 한 번만)
goondan bundle add ./bundle.yaml
goondan bundle add github.com/goondan/goondan/packages/base

# CLI로 테스트 (Telegram 없이)
export GOONDAN_DATA_SECRET_KEY=$(openssl rand -hex 32)
goondan run -c goondan.yaml --input "사용 가능한 에이전트 목록 보여줘"

# Telegram 봇으로 실행
export TELEGRAM_BOT_TOKEN="your-bot-token"
export ANTHROPIC_API_KEY="your-api-key"
export GOONDAN_DATA_SECRET_KEY=$(openssl rand -hex 32)
pnpm telegram
```

## 프로젝트 구조

```
sample-3-multi-agent/
├── src/
│   ├── connectors/
│   │   └── telegram/          # Telegram 커넥터
│   └── tools/
│       ├── delegate/          # 에이전트 위임 도구
│       ├── code/              # 코딩 도구
│       └── git/               # Git 도구
├── prompts/
│   ├── router.system.md       # 라우터 프롬프트
│   ├── coder.system.md        # 코더 프롬프트
│   ├── reviewer.system.md     # 리뷰어 프롬프트
│   └── docs.system.md         # 문서화 프롬프트
├── goondan.yaml               # 메인 구성
├── bundle.yaml                # 번들 매니페스트
└── package.json
```

## 위임 도구

### agent.list
사용 가능한 에이전트 목록을 조회합니다.

### agent.delegate
전문 에이전트에게 작업을 위임합니다.

```yaml
agent.delegate:
  agent: "coder"           # coder | reviewer | docs
  task: "유틸리티 함수 작성"
  context: "문자열 처리 관련"
```

### agent.complete
위임받은 작업의 완료를 보고합니다.

## 작업 흐름 예시

### 단일 위임
```
사용자: "README.md를 작성해줘"
  ↓
Router: 문서화 작업 식별, docs에게 위임
  ↓
Docs: README.md 작성 및 완료 보고
  ↓
Router: 결과 종합 후 사용자에게 전달
```

### 복합 위임
```
사용자: "새 기능을 구현하고 리뷰해줘"
  ↓
Router: 개발 + 리뷰 작업 식별
  ↓
Router: coder에게 기능 구현 위임
  ↓
Coder: 코드 작성 및 완료
  ↓
Router: reviewer에게 코드 리뷰 위임
  ↓
Reviewer: 리뷰 수행 및 피드백
  ↓
Router: 모든 결과 종합 후 사용자에게 전달
```

## 확장 포인트

### 새 에이전트 추가

1. `src/tools/delegate/index.ts`의 `AVAILABLE_AGENTS`에 추가
2. `prompts/` 디렉터리에 시스템 프롬프트 작성
3. `goondan.yaml`에 Agent 정의 추가
4. Swarm의 `agents` 목록에 포함

### 위임 로직 커스터마이징

`src/tools/delegate/index.ts`의 `agent.delegate` 핸들러를 수정하여:
- 위임 조건 추가
- 비동기 완료 처리
- 결과 집계 로직

## 현재 제한사항

1. **동기적 위임**: 현재 샘플에서는 위임이 동기적으로 처리됩니다
2. **단방향 통신**: 위임된 에이전트의 결과는 이벤트로 전달되지만, 완전한 콜백 메커니즘은 구현되지 않았습니다
3. **상태 공유**: 에이전트 간 상태 공유는 이벤트를 통해 수동으로 관리해야 합니다

## 프로덕션 고려사항

- 비동기 작업 큐 도입
- 에이전트 간 컨텍스트 공유 메커니즘
- 작업 진행 상황 추적
- 타임아웃 및 재시도 정책
- 로깅 및 모니터링
