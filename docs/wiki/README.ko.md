# Goondan 위키

> **Kubernetes for Agent Swarm** -- AI 에이전트 스웜을 오케스트레이션하는 프레임워크 (v0.0.3)

[English version](./README.md)

---

## Goondan이란?

Goondan은 AI 에이전트 스웜을 위한 선언형 오케스트레이션 프레임워크입니다. 에이전트, 도구, 확장, 연결을 하나의 `goondan.yaml` 파일에 정의하면, Goondan이 프로세스 관리, 에이전트 간 통신, 외부 채널 연동을 처리합니다.

주요 특성:

- **선언형 구성** -- 8종 리소스 Kind(`Model`, `Agent`, `Swarm`, `Tool`, `Extension`, `Connector`, `Connection`, `Package`)를 YAML로 정의
- **Process-per-Agent** -- 각 에이전트가 독립 Bun 프로세스로 실행되어 크래시가 전파되지 않음
- **미들웨어 파이프라인** -- 3종 미들웨어(`turn` / `step` / `toolCall`)의 Onion 모델
- **Edit & Restart** -- YAML 수정 후 재시작하면 영향받는 에이전트만 변경 사항을 반영하고, 대화 히스토리는 유지
- **패키지 생태계** -- 도구, 확장, 커넥터를 레지스트리를 통해 공유하고 재사용

---

## 이 위키의 대상 독자

이 위키는 세 가지 독자 유형을 기준으로 구성되어 있습니다. 자신에게 맞는 유형을 선택하고 권장 경로를 따라가세요.

### End-user (Swarm 운영자)

커스텀 도구나 확장을 작성하지 않고 에이전트 스웜을 **설정하고 실행**하려는 분.

**여기서 시작하세요:**

1. [시작하기](./tutorials/01-getting-started.ko.md) -- 설치, 초기화, 첫 스웜 실행
2. [Swarm 실행하기](./how-to/run-a-swarm.ko.md) -- 실행, 재시작, 조회, 삭제
3. [내장 도구 사용하기](./how-to/use-builtin-tools.ko.md) -- `@goondan/base` 도구 활용 (bash, file-system, http-fetch 등)

### Tool Maker

에이전트가 LLM tool call로 호출할 수 있는 **커스텀 도구를 만들려는** 분.

**여기서 시작하세요:**

1. [시작하기](./tutorials/01-getting-started.ko.md) -- 기본 환경이 동작하는지 먼저 확인
2. [첫 Tool 만들기](./tutorials/02-build-your-first-tool.ko.md) -- 단계별 튜토리얼
3. [Tool 작성하기 (How-to)](./how-to/write-a-tool.ko.md) -- 프로덕션 도구 작성 체크리스트
4. [Tool 시스템 (Explanation)](./explanation/tool-system.ko.md) -- 도구 아키텍처 심층 이해
5. [Tool API 레퍼런스](./reference/tool-api.ko.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult`

### Extension Maker

런타임 파이프라인에 개입하는 **확장을 만들려는** 분 (메시지 관리, 로깅, 도구 필터링 등).

**여기서 시작하세요:**

1. [시작하기](./tutorials/01-getting-started.ko.md) -- 기본 환경이 동작하는지 먼저 확인
2. [첫 Extension 만들기](./tutorials/03-build-your-first-extension.ko.md) -- 단계별 튜토리얼
3. [Extension 작성하기 (How-to)](./how-to/write-an-extension.ko.md) -- 프로덕션 확장 작성 체크리스트
4. [Extension 파이프라인 (Explanation)](./explanation/extension-pipeline.ko.md) -- 미들웨어 아키텍처 심층 이해
5. [Extension API 레퍼런스](./reference/extension-api.ko.md) -- `ExtensionApi`, pipeline, state, events

---

## 위키 구조

이 위키는 [Diataxis](https://diataxis.fr/) 문서화 프레임워크를 따르며, 독자의 목적에 따라 콘텐츠를 네 가지 카테고리로 구성합니다.

### Tutorials -- _학습 지향_

처음부터 동작하는 결과물까지 안내하는 단계별 가이드입니다.

| 문서 | 설명 |
|------|------|
| [시작하기](./tutorials/01-getting-started.ko.md) | Goondan 설치, `gdn init`으로 프로젝트 생성, 첫 스웜 실행 |
| [첫 Tool 만들기](./tutorials/02-build-your-first-tool.ko.md) | 커스텀 도구를 처음부터 만들고 `goondan.yaml`에 등록 |
| [첫 Extension 만들기](./tutorials/03-build-your-first-extension.ko.md) | `register(api)`로 미들웨어 확장을 만들고 파이프라인에 연결 |

### How-to 가이드 -- _작업 지향_

특정 작업을 위한 간결한 레시피입니다. 이미 동작하는 프로젝트가 있다고 가정합니다.

| 문서 | 설명 |
|------|------|
| [Swarm 실행하기](./how-to/run-a-swarm.ko.md) | 스웜 인스턴스 실행, 재시작, 조회, 삭제 |
| [Tool 작성하기](./how-to/write-a-tool.ko.md) | 프로덕션 품질의 도구 작성 체크리스트 |
| [Extension 작성하기](./how-to/write-an-extension.ko.md) | 프로덕션 품질의 확장 작성 체크리스트 |
| [Connector 작성하기](./how-to/write-a-connector.ko.md) | 외부 프로토콜을 Goondan에 연결하는 커넥터 구축 |
| [내장 도구 사용하기](./how-to/use-builtin-tools.ko.md) | `@goondan/base` 도구 활용 (bash, file-system, agents, http-fetch 등) |
| [멀티 에이전트 패턴](./how-to/multi-agent-patterns.ko.md) | 에이전트 간 통신 패턴 (request/send/spawn) |

### Explanation -- _이해 지향_

왜 이렇게 동작하는지를 설명하는 개념 문서입니다.

| 문서 | 설명 |
|------|------|
| [핵심 개념](./explanation/core-concepts.ko.md) | 리소스 Kind, ObjectRef, instanceKey, Bundle, Package, 선언형 구성 모델 |
| [Tool 시스템](./explanation/tool-system.ko.md) | 더블 언더스코어 네이밍, ToolContext, AgentProcess 내부 도구 실행 |
| [Extension 파이프라인](./explanation/extension-pipeline.ko.md) | 미들웨어 Onion 모델, turn/step/toolCall 계층, ConversationState 이벤트 소싱 |
| [런타임 모델](./explanation/runtime-model.ko.md) | Orchestrator, Process-per-Agent, IPC, OTel TraceContext, Reconciliation Loop, Graceful Shutdown |

### Reference -- _정보 지향_

API, 스키마, CLI 명령어에 대한 정확하고 포괄적인 참조 문서입니다.

| 문서 | 설명 |
|------|------|
| [리소스](./reference/resources.ko.md) | 8종 리소스 Kind의 YAML 스키마 (`apiVersion: goondan.ai/v1`) |
| [내장 도구](./reference/builtin-tools.ko.md) | `@goondan/base` 도구 카탈로그 (파라미터 및 예제 포함) |
| [Tool API](./reference/tool-api.ko.md) | `ToolHandler`, `ToolContext`, `ToolCallResult` TypeScript 인터페이스 |
| [Extension API](./reference/extension-api.ko.md) | `ExtensionApi` -- `pipeline`, `tools`, `state`, `events`, `logger` |
| [Connector API](./reference/connector-api.ko.md) | `ConnectorContext`, `ConnectorEvent`, 커넥터 엔트리 모듈 |
| [CLI 레퍼런스](./reference/cli-reference.ko.md) | `gdn` 명령어: `run`, `restart`, `validate`, `instance`, `package`, `logs`, `doctor` |

---

## 다른 문서와의 관계

| 문서 | 목적 | 대상 독자 |
|------|------|-----------|
| [GUIDE.md](../../GUIDE.md) | 빠른 시작 가이드 (설치, 초기화, 실행) | 처음 접하는 사용자 |
| [docs/architecture.md](../architecture.md) | 시스템 설계 개요 (다이어그램, 설계 패턴) | 아키텍트, 기여자 |
| [docs/specs/*.md](../specs/) | 구현 스펙 (인터페이스, 스키마, 규칙의 SSOT) | 코어 기여자 |
| **이 위키** | 사용자 관점 문서 (튜토리얼, how-to, explanation, 레퍼런스) | End-user, Tool Maker, Extension Maker |

위키는 스펙 및 아키텍처 문서의 정보를 **사용자 관점으로 재구성**한 것입니다. 스펙을 대체하지 않으며, 구현 상세는 스펙이 유일한 source of truth로 유지됩니다.

---

## 기여 방법

위키 페이지를 추가하거나 수정할 때:

- 영문 파일은 `.md`, 한국어 번역은 `.ko.md`로 같은 디렉토리에 배치
- 교차 참조는 상대 경로 사용 (예: `./tutorials/01-getting-started.ko.md`)
- 스펙 내용을 그대로 복사하지 말고, 사용자 관점으로 요약한 뒤 상세는 스펙으로 링크
- 예제는 `docs/specs/resources.md`에 정의된 `goondan.yaml` 스키마와 일치하도록 유지

---

_위키 버전: v0.0.3_
