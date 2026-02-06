# Web Researcher - 웹 리서치 에이전트

웹에서 정보를 수집하고 요약하는 2-에이전트 스웜 샘플입니다.

## 아키텍처

```
사용자 입력
    |
  Researcher (정보 수집)
    |-- http.get: 웹 페이지/API 호출
    |-- json.query: JSON 응답 파싱
    |
    +--- 위임 ---> Summarizer (결과 요약/정리)
```

## 구성

| 리소스 | 이름 | 역할 |
|--------|------|------|
| Model | `default-model` | Anthropic Claude Sonnet 4.5 |
| Tool | `http-fetch` | HTTP GET/POST 요청 |
| Tool | `json-query` | JSON 데이터 파싱/변환 |
| Tool | `delegate-tool` | 에이전트 간 위임 |
| Agent | `researcher` | 웹 정보 수집 (진입점) |
| Agent | `summarizer` | 정보 요약/정리 |
| Swarm | `web-research-swarm` | 2 에이전트 구성 |
| Connector | `cli` | CLI 입출력 |

## 환경 변수

```bash
# Anthropic API 키
export ANTHROPIC_API_KEY="sk-ant-..."
```

## 실행

```bash
gdn run
```

## 사용 예시

```
> 최신 TypeScript 5.x의 주요 기능을 조사해줘
(researcher가 공식 문서/블로그에서 정보 수집 -> summarizer가 요약)

> GitHub의 trending 저장소를 알려줘
(researcher가 GitHub API 호출 -> 결과 정리)

> JSONPlaceholder API에서 사용자 목록을 가져와줘
(researcher가 API 호출 -> json.query로 데이터 추출 -> 직접 응답)
```

## 핵심 개념

- **도구 활용 에이전트**: http-fetch와 json-query를 조합하여 웹 데이터 수집
- **에이전트 위임**: 수집과 요약의 역할 분리로 각 에이전트가 전문 영역에 집중
- **base 패키지 도구**: `@goondan/base`의 공통 도구를 재사용하는 패턴 시연

## 다음 단계

- **sample-9-devops-assistant**: bash 도구를 활용한 시스템 관리 에이전트
- **sample-1-coding-swarm**: 3개 에이전트 협업 (Planner/Coder/Reviewer)
