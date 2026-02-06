# DevOps Assistant - 시스템 관리 에이전트

시스템 점검, 배포, 로그 분석 등 DevOps 작업을 지원하는 2-에이전트 스웜 샘플입니다.

## 아키텍처

```
사용자 입력
    |
  DevOps Agent (명령 실행/진단)
    |-- bash.exec: 시스템 명령 실행
    |
    +--- 복잡한 작업 ---> Planner (계획 수립)
                             |
                             +--- 실행 위임 ---> DevOps Agent
```

## 구성

| 리소스 | 이름 | 역할 |
|--------|------|------|
| Model | `default-model` | Anthropic Claude Sonnet 4.5 |
| Tool | `bash` | bash 명령어 실행 |
| Tool | `delegate-tool` | 에이전트 간 위임 |
| Extension | `logging` | 작업 로깅 |
| Agent | `devops` | 시스템 명령 실행/진단 (진입점) |
| Agent | `planner` | 작업 계획 수립 |
| Swarm | `devops-swarm` | 2 에이전트 구성 |
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
> 현재 시스템 상태를 점검해줘
(devops가 df, free, uptime 등으로 시스템 상태 확인)

> Docker 컨테이너 목록을 보여주고, 멈춘 컨테이너가 있으면 원인을 분석해줘
(devops가 docker ps -a 실행, 로그 분석)

> 프로젝트 배포 계획을 세워줘
(devops -> planner에게 위임 -> 단계별 계획 수립 -> devops가 실행)

> 최근 에러 로그를 분석해줘
(devops가 로그 파일 검색 및 에러 패턴 분석)
```

## 핵심 개념

- **bash 도구 활용**: 시스템 명령어를 통한 인프라 관리 자동화
- **안전 우선**: 위험한 명령 차단, 읽기 우선 정책, 백업 확인
- **계획-실행 분리**: 복잡한 작업은 planner가 계획 수립, devops가 실행
- **로깅 Extension**: 모든 작업 이력을 logging extension으로 기록

## 다음 단계

- **sample-8-web-researcher**: 웹 데이터 수집/요약 에이전트
- **sample-1-coding-swarm**: Planner/Coder/Reviewer 코딩 협업
