# Goondan Wiki Plan

## 목표 개요
Goondan의 실 사용자(End-user, Tool Maker, Extension Maker)를 위한 `docs/wiki/` 폴더 하위 Diátaxis 구조 한/영 병행 위키 생성

---

## 해결하고자 하는 문제 (니즈)와 현 상태

| 문제 | 현재 상태 |
|------|----------|
| 실 사용자가 참고할 수 있는 위키가 없음 | `GUIDE.md`(설치/실행 위주), `docs/specs/*.md`(내부 구현 스펙)만 존재 |
| Tool Maker/Extension Maker를 위한 단계별 가이드 부재 | 스펙 문서가 있지만 학습/실전 관점의 재구성 없음 |
| End-user 진입 장벽 | 최소 동작까지의 경로가 불명확 |

---

## 솔루션 (목표)

`docs/wiki/` 하위에 **Diátaxis 4분할** 구조로 한/영 병행 위키 생성:
- **tutorials/** – 단계별 따라하기 (학습 목적)
- **how-to/** – 특정 문제 해결 실용 가이드
- **explanation/** – 핵심 개념 이해
- **reference/** – API/스키마/CLI 정보 조회

독자 우선순위: **Tool Maker** = **Extension Maker** > End-user (getting started 수준)

---

## 비목표

### 하면 안 되는 것
- `docs/specs/*.md` 내용 변경 또는 삭제 (내부 스펙은 그대로 유지)
- `GUIDE.md` 삭제 또는 병합
- 스펙에 없는 기능 발명/추가 설명

### 범위 밖 (추후 가능)
- Connector Maker를 위한 전용 심층 가이드 (이번엔 how-to 수준)
- 인터랙티브 playground / 코드 실행 환경
- 자동화된 번역 파이프라인
- API 자동 생성 도구 (TypeDoc 등)

---

## 확정된 주요 의사결정 사항

| 항목 | 결정 |
|------|------|
| 문서 구조 | Diátaxis (tutorials / how-to / explanation / reference) |
| 언어 | 한국어 + 영어 별도 파일 (`.md` = EN, `.ko.md` = KO) |
| 기존 문서 관계 | 위키는 사용자 관점 재작성; specs는 내부용 유지 |
| End-user 콘텐츠 | 포함 (getting started 수준) |
| Connector 심층 가이드 | how-to 수준만 포함 (전용 가이드는 범위 밖) |

---

## 파일 구조 (완성 목표)

```
docs/wiki/
├── README.md                          # 위키 개요 + 독자별 진입점 (EN)
├── README.ko.md                       # (KO)
│
├── tutorials/
│   ├── 01-getting-started.md          # End-user: gdn init → run 완성 (EN)
│   ├── 01-getting-started.ko.md       # (KO)
│   ├── 02-build-your-first-tool.md    # Tool Maker: 첫 Tool 만들기 (EN)
│   ├── 02-build-your-first-tool.ko.md # (KO)
│   ├── 03-build-your-first-extension.md      # Extension Maker: 첫 Extension (EN)
│   └── 03-build-your-first-extension.ko.md   # (KO)
│
├── how-to/
│   ├── run-a-swarm.md                 # swarm 실행·재기동·삭제 (EN)
│   ├── run-a-swarm.ko.md              # (KO)
│   ├── write-a-tool.md                # Tool 작성 체크리스트 (EN)
│   ├── write-a-tool.ko.md             # (KO)
│   ├── write-an-extension.md          # Extension 작성 체크리스트 (EN)
│   ├── write-an-extension.ko.md       # (KO)
│   ├── write-a-connector.md           # Connector 작성 방법 (EN)
│   ├── write-a-connector.ko.md        # (KO)
│   ├── use-builtin-tools.md           # 내장 Tool 활용 (EN)
│   ├── use-builtin-tools.ko.md        # (KO)
│   ├── multi-agent-patterns.md        # 멀티 에이전트 패턴 (EN)
│   └── multi-agent-patterns.ko.md     # (KO)
│
├── explanation/
│   ├── core-concepts.md               # ObjectRef·instanceKey·Kind 개요 (EN)
│   ├── core-concepts.ko.md            # (KO)
│   ├── tool-system.md                 # Tool 시스템 심층 이해 (EN)
│   ├── tool-system.ko.md              # (KO)
│   ├── extension-pipeline.md          # Extension·Pipeline 구조 이해 (EN)
│   ├── extension-pipeline.ko.md       # (KO)
│   ├── runtime-model.md               # 런타임 실행 모델 이해 (EN)
│   └── runtime-model.ko.md            # (KO)
│
└── reference/
    ├── resources.md                   # 8종 Kind YAML 스키마 참조 (EN)
    ├── resources.ko.md                # (KO)
    ├── builtin-tools.md               # 내장 Tool 카탈로그 (EN)
    ├── builtin-tools.ko.md            # (KO)
    ├── tool-api.md                    # ToolHandler·ToolContext·ToolCallResult API (EN)
    ├── tool-api.ko.md                 # (KO)
    ├── extension-api.md               # ExtensionApi·pipeline·state·events API (EN)
    ├── extension-api.ko.md            # (KO)
    ├── connector-api.md               # ConnectorContext API (EN)
    ├── connector-api.ko.md            # (KO)
    ├── cli-reference.md               # gdn CLI 명령어 레퍼런스 (EN)
    └── cli-reference.ko.md            # (KO)
```
총 파일 수: **34개** (EN 17 + KO 17)

---

## 상세 실행 계획

### 작업 분류 및 의존 관계

> 각 작업은 manager-mode 서브에이전트 1명에게 할당. 병렬 가능한 작업은 동시 실행.

---

#### Phase 0: 공통 인프라 (의존 없음)
| ID | 작업 | 산출물 |
|----|------|--------|
| T0 | `docs/wiki/` 구조 생성 + `README.md/.ko.md` 작성 | README 2종 + 폴더 구조 |

---

#### Phase 1: explanation/ 문서 (T0 의존, 상호 독립)
> explanation은 how-to/tutorials의 기반 개념이므로 먼저 작성

| ID | 작업 | 산출물 |
|----|------|--------|
| T1-A | `explanation/core-concepts.md/.ko.md` | 2종 |
| T1-B | `explanation/tool-system.md/.ko.md` | 2종 |
| T1-C | `explanation/extension-pipeline.md/.ko.md` | 2종 |
| T1-D | `explanation/runtime-model.md/.ko.md` | 2종 |

---

#### Phase 2: reference/ 문서 (T0 의존, 상호 독립)
> reference는 튜토리얼/how-to에서 링크 참조되므로 함께 작성

| ID | 작업 | 산출물 |
|----|------|--------|
| T2-A | `reference/resources.md/.ko.md` | 2종 |
| T2-B | `reference/builtin-tools.md/.ko.md` | 2종 |
| T2-C | `reference/tool-api.md/.ko.md` | 2종 |
| T2-D | `reference/extension-api.md/.ko.md` | 2종 |
| T2-E | `reference/connector-api.md/.ko.md` + `reference/cli-reference.md/.ko.md` | 4종 |

---

#### Phase 3: how-to/ 문서 (T1-*, T2-* 의존, 상호 독립)

| ID | 작업 | 산출물 |
|----|------|--------|
| T3-A | `how-to/run-a-swarm.md/.ko.md` + `how-to/use-builtin-tools.md/.ko.md` | 4종 |
| T3-B | `how-to/write-a-tool.md/.ko.md` | 2종 |
| T3-C | `how-to/write-an-extension.md/.ko.md` | 2종 |
| T3-D | `how-to/write-a-connector.md/.ko.md` + `how-to/multi-agent-patterns.md/.ko.md` | 4종 |

---

#### Phase 4: tutorials/ 문서 (T1-*, T2-*, T3-* 의존)

| ID | 작업 | 산출물 |
|----|------|--------|
| T4-A | `tutorials/01-getting-started.md/.ko.md` | 2종 |
| T4-B | `tutorials/02-build-your-first-tool.md/.ko.md` | 2종 |
| T4-C | `tutorials/03-build-your-first-extension.md/.ko.md` | 2종 |

---

#### Phase 5: 검증 및 마무리 (T4-* 의존)

| ID | 작업 | 산출물 |
|----|------|--------|
| T5-A | 전체 위키 코드 리뷰 (내용 정확성, 링크 정합성, 한/영 일관성) | 리뷰 리포트 |
| T5-B | `AGENTS.md` 업데이트 (docs/wiki/ 폴더) | AGENTS.md |

---

## 상세 검증 계획

### 콘텐츠 정확성 검증
- [ ] 모든 YAML 예제가 `docs/specs/resources.md` 스키마와 일치
- [ ] 모든 TypeScript 코드 예제가 `docs/specs/tool.md`, `extension.md`, `connector.md` API와 일치
- [ ] 내장 Tool 목록이 `packages/base/src/` 실제 구현과 일치
- [ ] CLI 명령어가 `docs/specs/cli.md` 및 실제 `gdn --help`와 일치

### 링크 정합성 검증
- [ ] 모든 내부 링크(`[...](../reference/...)`)가 실제 파일에 연결됨
- [ ] specs 문서 크로스 링크가 존재하는 섹션을 가리킴
- [ ] EN/KO 상호 참조 링크 정합성

### 독자별 완성도 체크리스트
- [ ] End-user: 설치 → `gdn init` → `.env` → `gdn run` 완전 동작 가능한 예제
- [ ] Tool Maker: 빈 프로젝트에서 첫 Tool 등록·실행 가능한 튜토리얼
- [ ] Extension Maker: `register(api)` → `pipeline.register()` → 동작 확인 튜토리얼
- [ ] 한/영 대응 파일 쌍 누락 없음 (34개 파일 전체)

---

*Plan created: 2026-02-18*
*Status: Awaiting user approval*
