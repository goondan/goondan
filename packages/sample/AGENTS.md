# Goondan Sample Collection

Goondan Agent Swarm Orchestrator의 샘플 모음입니다.

## 디렉토리 구조

```
packages/sample/
├── sample-1-coding-swarm/      # 코딩 에이전트 스웜 (Planner/Coder/Reviewer)
├── sample-2-telegram-coder/    # Telegram 봇 코딩 에이전트
├── sample-3-self-evolving/     # 자기 진화 에이전트
├── sample-4-compaction/        # 컨텍스트 압축 에이전트
├── sample-5-package-consumer/  # 외부 패키지 사용 예제
├── sample-6-cli-chatbot/      # CLI 채팅봇 (초보자용 최소 구성)
├── sample-7-multi-model/      # 멀티 모델 조합 (라우팅/위임)
├── sample-8-web-researcher/   # 웹 리서치 에이전트 (http-fetch + json-query)
├── sample-9-devops-assistant/ # DevOps 지원 에이전트 (bash + logging)
└── AGENTS.md                   # 이 파일
```

## 구현된 샘플

### sample-1-coding-swarm
코딩 작업을 위한 멀티 에이전트 스웜입니다.
- **Planner**: 작업 계획 및 조율
- **Coder**: 코드 작성/수정
- **Reviewer**: 코드 리뷰 및 품질 검증
- **Connector**: CLI
- **Connection**: cli-to-coding-swarm (egress: replace)

### sample-2-telegram-coder
Telegram 봇으로 동작하는 코딩 에이전트입니다.
- **Connector**: Telegram
- **Connection**: telegram-to-coding-swarm (auth + 3개 rules + egress)
- **Agent**: coding-swarm의 Planner/Coder/Reviewer 재사용
- **인증**: Connection에서 Static Token 기반

### sample-3-self-evolving
스스로 프롬프트와 도구를 개선하는 자기 진화 에이전트입니다.
- **Changeset**: 프롬프트/리소스 파일 수정 가능
- **도구**: self.readPrompt, self.updatePrompt, self.viewChanges
- **정책**: prompts/**, resources/** 허용

### sample-4-compaction
컨텍스트 압축 Extension을 사용하는 에이전트입니다.
- **Extension**: compaction (Token/Turn/Sliding Window 전략)
- **파이프라인**: step.post에서 압축 실행
- **테스트**: 35개 테스트 통과

### sample-5-package-consumer
외부 Bundle Package를 참조하여 사용하는 예제입니다.
- **의존성**: sample-1-coding-swarm 패키지 참조
- **커스텀**: 새 Agent 추가, 프롬프트 오버라이드
- **데모**: 패키지 시스템 활용 방법

### sample-6-cli-chatbot
가장 단순한 CLI 채팅봇입니다. 초보자가 Goondan을 처음 접할 때 권장됩니다.
- **구성**: Model + Agent + Swarm + Connector + Connection (5개 리소스)
- **도구 없음**: LLM 대화만으로 동작
- **최소 파일**: goondan.yaml + 시스템 프롬프트

### sample-7-multi-model
여러 LLM 제공자의 모델을 조합하는 멀티 에이전트 샘플입니다.
- **모델**: Anthropic Claude + OpenAI GPT-4o
- **라우팅**: Router Agent가 작업 성격에 따라 위임
- **에이전트**: router (라우팅) / creative-writer (창작) / analyst (분석)
- **도구**: agent.delegate (작업 위임)

### sample-8-web-researcher
웹에서 정보를 수집하고 요약하는 리서치 에이전트 스웜입니다.
- **도구**: http-fetch (http.get, http.post), json-query (json.query, json.transform)
- **에이전트**: researcher (정보 수집) / summarizer (결과 요약)
- **핵심**: base 패키지 도구 활용, 수집-요약 역할 분리

### sample-9-devops-assistant
시스템 관리, 배포, 로그 분석 등 DevOps 작업을 지원하는 에이전트 스웜입니다.
- **도구**: bash (bash.exec)
- **확장**: logging (작업 이력 기록)
- **에이전트**: devops (명령 실행/진단) / planner (작업 계획)
- **핵심**: 안전 정책 (읽기 우선, 위험 명령 차단), 계획-실행 분리

## 샘플 구조 규칙

각 샘플은 다음 구조를 따릅니다:
```
sample-X-name/
├── goondan.yaml      # 필수: Bundle 정의
├── prompts/          # 시스템 프롬프트 파일들
├── tools/            # 커스텀 도구 구현 (선택)
├── extensions/       # 커스텀 확장 구현 (선택)
├── package.json      # 패키지 정의
├── README.md         # 샘플 설명
└── AGENTS.md         # 폴더 구조 및 규칙
```

## 참조 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/resources.md` - 리소스 정의 스펙
- `/docs/specs/bundle_package.md` - Bundle Package 스펙
