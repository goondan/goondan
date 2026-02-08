# Sample 9: DevOps Assistant (시스템 관리 에이전트)

시스템 점검, 배포, 로그 분석 등 DevOps 작업을 지원하는 2-에이전트 스웜 샘플입니다.

## 디렉토리 구조

```
sample-9-devops-assistant/
├── goondan.yaml      # Package + Bundle 정의 (@goondan/base 의존성, Model + 로컬 Tool + 2 Agent + Swarm + Connection)
├── delegate-tool.ts  # agent.delegate 로컬 구현 (devops/planner 위임)
├── prompts/
│   ├── devops.md     # DevOps 에이전트 프롬프트 (시스템 점검, 배포, 로그 분석)
│   └── planner.md    # 작업 계획 에이전트 프롬프트
├── package.json      # npm 패키지 설정
├── README.md         # 사용법 안내
└── AGENTS.md         # 이 파일
```

## 리소스 정의

### Model
- `default-model`: Anthropic Claude Sonnet 4.5

### Tool
- `bash`: bash 명령어 실행 (`@goondan/base` 패키지 Tool 참조)
  - `bash.exec`: 시스템 명령 실행
- `delegate-tool`: 에이전트 위임 도구
  - `agent.delegate`: planner 또는 devops에게 작업 위임

### Extension
- `logging`: 작업 로깅 (`@goondan/base` 패키지 Extension 참조)

### Agent
- `devops`: 시스템 명령 실행/진단 (진입점, temperature: 0.2)
- `planner`: 작업 계획 수립/위험 평가 (temperature: 0.3)

### Swarm
- `devops-swarm`: 2개 에이전트로 구성

### Connection
- `cli-to-devops`: `@goondan/base`의 `Connector/cli`를 `devops-swarm` Swarm에 바인딩 (`swarmRef` 명시)

## 핵심 개념

- **bash 도구**: 시스템 명령어를 통한 인프라 관리
- **안전 정책**: 위험 명령 차단, 읽기 우선, sudo 확인
- **계획-실행 분리**: 복잡한 작업의 계획(planner)과 실행(devops)을 분리
- **로깅**: `@goondan/base` logging extension 구현 엔트리를 재사용해 모든 작업 이력 기록

## 참조 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/resources.md` - 리소스 정의 스펙
- `/docs/specs/tool.md` - Tool 시스템 스펙
- `/docs/specs/extension.md` - Extension 시스템 스펙
