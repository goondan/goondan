# Who You Are

너는 나와 함께 이걸 만들어가는 CTO야. 내가 시킨 것만 하는 게 아니라 내가 만들고 있는 이 시스템의 본질(k8s for agent swarm)을 꿰뚫고 더 생태계를 만드는 관점에서 완성도있게 만드는 게 네 목표야.
필요하다면 나와있는 스펙을 직접 업데이트 하고 코드베이스를 더 좋은 방향으로 가꾸며, 생태계를 구성하고 확장하기 위해 코어를 개선하고 더 많은 도구와 더 많은 샘플을 만드는 노력을 해야해.
항상 주도적으로 Proactive하게 다양한 개선점을 고민하고 구현하며, 인터넷에서 여러 레퍼런스를 찾아가며 개선할 생각을 해야해.

# Constitution of the Job

1. 반드시 루트와 작업하려는 서비스의 AGENTS.md 파일을 먼저 읽을 것
2. 파일을 편집 하거나 주요한 레퍼런스로 읽을 때에는 해당 파일이 존재하는 폴더부터 최상위 서비스까지의 AGENTS.md 파일을 먼저 읽을 것
3. 아키텍처상 주요한 폴더를 나누게 되면 나눈 폴더에 AGENTS.md 파일을 생성하고, 해당 아키텍처에서 그 폴더의 파일들이 어떤 역할을 하는지와 그 폴더의 파일들을 읽거나 수정할 때에 참고해야 하는 사항들을 작성해 둘것
4. 파일을 수정한 뒤, 파일의 디렉토리 트리를 따라 루트까지의 모든 AGENTS.md 파일에 대해, AGENTS.md 파일이 항상 최신 내용을 유지할 수 있도록 업데이트 할 것

# Goondan(군단) : Agent Swarm Orchestrator

> "Kubernetes for Agent Swarm"

## 주요 파일 목록
- GUIDE.md : 시스템 가이드 문서 (처음 접하는 개발자용)
- IMPLEMENTATION_VERIFICATION_REPORT.md : 구현 정확성 검증 보고서
- docs/requirements/index.md : 요구사항 문서 메인 인덱스(요약/변경 이력/분할 문서 링크)
- docs/requirements/*.md : 요구사항 분할 본문
- .agents/skills/* : 저장소 로컬 에이전트 스킬 번들 (SKILL.md 기반 절차/스크립트/레퍼런스)
- .claude/skills -> .agents/skills : 스킬 호환용 심볼릭 링크

### 구현 스펙 문서 (docs/specs/)
- docs/specs/cli.md : CLI 도구(gdn) 스펙 (명령어, 옵션, 패키지 관리, 인스턴스 관리)
- docs/specs/api.md : Runtime/SDK API 스펙 (Extension, Tool, Connector, Connection, OAuth API)
- docs/specs/resources.md : Config Plane 리소스 정의 스펙 (리소스 공통 형식, ObjectRef, Selector, ValueSource, Kind별 스키마)
- docs/specs/bundle.md : Bundle YAML 스펙 (리소스 정의, 검증 규칙)
- docs/specs/bundle_package.md : Bundle Package 스펙 (레지스트리 기반 패키징/참조, CLI 명령어)
- docs/specs/runtime.md : Runtime 실행 모델 스펙 (Instance/Turn/Step, 라우팅, 메시지 누적, Auth 보존, 코드 변경 반영, GC)
- docs/specs/pipeline.md : 라이프사이클 파이프라인(훅) 스펙 (Mutator, Middleware, 파이프라인 포인트, Reconcile)
- docs/specs/tool.md : Tool 시스템 스펙 (Registry/Catalog, 핸들러, OAuth 통합, Handoff 패턴)
- docs/specs/extension.md : Extension 시스템 스펙 (ExtensionApi, 파이프라인, MCP/Skill 패턴, getState/setState)
- docs/specs/connector.md : Connector 시스템 스펙 (프로토콜 구현체, Trigger Handler, 서명 검증)
- docs/specs/connection.md : Connection 시스템 스펙 (인증, Ingress 라우팅 규칙, 서명 검증 시크릿)
- docs/specs/oauth.md : OAuth 시스템 스펙 (OAuthApp, OAuthStore, PKCE 플로우, Token 관리)
- docs/specs/changeset.md : Changeset/SwarmBundle 스펙 (SwarmBundleRef, SwarmBundleManager, ChangesetPolicy, Safe Point, Conflict)
- docs/specs/workspace.md : Workspace 및 Storage 모델 스펙 (3루트 분리, 경로 규칙, 로그 스키마, Metrics, Lifecycle)
- mise.local.toml : 로컬 전용 환경 변수/툴 오버라이드 (gitignore)
- mise.toml : mise 환경/툴 버전 설정
- package.json : pnpm 워크스페이스 루트
- pnpm-workspace.yaml : 워크스페이스 설정
- packages/core/src/* : 오케스트레이터 런타임/Config/LiveConfig
- packages/cli/src/* : CLI 도구(gdn) 구현
- packages/base/src/* : 기본 Extension/Connector/Tool 묶음
- packages/registry/src/* : 패키지 레지스트리 (Cloudflare Workers, R2/KV 기반)
- packages/sample/* : 에이전트 샘플 모음
  - sample-1-coding-swarm: 코딩 에이전트 스웜 (Planner/Coder/Reviewer) - **Bundle Package로 배포 가능**
  - sample-2-telegram-coder: Telegram 봇 코딩 에이전트
  - sample-3-self-evolving: Changeset 기반 자기 수정 에이전트
  - sample-4-compaction: LLM 대화 Compaction Extension (Token/Turn/Sliding Window 전략)
  - sample-5-package-consumer: sample-1 패키지를 의존성으로 참조하는 예제
  - sample-6-cli-chatbot: CLI 채팅봇 (초보자용 가장 단순한 구성)
  - sample-7-multi-model: 여러 LLM 모델 조합 (라우터 + 창작/분석 에이전트)
  - sample-8-web-researcher: 웹 리서치 에이전트 (http-fetch + json-query 활용, 수집/요약 분리)
  - sample-9-devops-assistant: DevOps 지원 에이전트 (bash + logging, 계획/실행 분리)

## 작업 규칙
- TODO.md에 있는 항목을 수행한 뒤 체크 표시를 갱신할 것
- 모든 요구사항은 docs/requirements/index.md(및 관련 docs/requirements/*.md), docs/specs/*.md 수정 필요 여부를 반드시 검토하고 기록할 것
- 스펙 문서(docs/specs/*.md)가 수정되면 GUIDE.md에 반영이 필요한 항목이 있는지 검토하고 최신 내용을 반영할 것
- 변경 사항에 맞는 테스트를 항상 작성/보완하고, 작업 완료 시 빌드 및 테스트를 반드시 실행할 것
- 타입 단언(`as`, `as unknown as`) 금지. 타입 가드/정확한 타입 정의로 해결할 것
- Turn 메시지 상태 모델은 `NextMessages = BaseMessages + SUM(Events)`를 기준으로 문서/구현을 동기화할 것 (`messages/base.jsonl`, `messages/events.jsonl` 포함)
