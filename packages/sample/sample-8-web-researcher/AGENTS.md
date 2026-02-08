# Sample 8: Web Researcher (웹 리서치 에이전트)

웹에서 정보를 수집하고 요약하는 2-에이전트 스웜 샘플입니다.

## 디렉토리 구조

```
sample-8-web-researcher/
├── goondan.yaml      # Package + Bundle 정의 (@goondan/base 의존성, Model + 로컬 Tool + 2 Agent + Swarm + Connection)
├── delegate-tool.ts  # agent.delegate 로컬 구현 (summarizer 위임)
├── prompts/
│   ├── researcher.md # 웹 리서치 전문 프롬프트
│   └── summarizer.md # 요약 전문 프롬프트
├── package.json      # npm 패키지 설정
├── README.md         # 사용법 안내
└── AGENTS.md         # 이 파일
```

## 리소스 정의

### Model
- `default-model`: Anthropic Claude Sonnet 4.5

### Tool
- `http-fetch`: HTTP GET/POST 요청 (`@goondan/base` 패키지 Tool 참조)
  - `http.get`: GET 요청
  - `http.post`: POST 요청
- `json-query`: JSON 데이터 처리 (`@goondan/base` 패키지 Tool 참조)
  - `json.query`: JSONPath로 값 추출
  - `json.transform`: JSON 변환 (pick, omit, flatten 등)
- `delegate-tool`: 에이전트 위임 도구
  - `agent.delegate`: summarizer에게 작업 위임

### Agent
- `researcher`: 웹 정보 수집 전문 (진입점, temperature: 0.3)
- `summarizer`: 정보 요약/정리 전문 (temperature: 0.4)

### Swarm
- `web-research-swarm`: 2개 에이전트로 구성

### Connection
- `cli-to-web-research`: `@goondan/base`의 `Connector/cli`를 `web-research-swarm` Swarm에 바인딩 (`swarmRef` 명시)

## 핵심 개념

- **도구 조합**: http-fetch + json-query로 웹 데이터 수집 파이프라인 구성
- **역할 분리**: 수집(researcher)과 요약(summarizer)을 분리하여 각 에이전트가 전문 역할 수행
- **base 패키지 활용**: `@goondan/base`의 공통 도구/커넥터 구현 엔트리를 재사용하는 패턴

## 참조 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/resources.md` - 리소스 정의 스펙
- `/docs/specs/tool.md` - Tool 시스템 스펙
