# Goondan 구성 계층 역할 개요 (v2.0)

이 문서는 `runtime`, `types`, `@goondan/base`, `@goondan/cli`, `@goondan/registry`의 역할과 관계를 **추상 계층 관점**에서 정리한다.
세부 API/스키마/명령 규격은 각 소유 스펙 문서를 따른다.

---

## 1. 목적

이 문서의 목적은 다음과 같다.

1. `runtime`, `types`, `base`, `cli`, `registry`의 책임 경계를 팀 단위로 동일하게 이해한다.
2. 기능 추가 시 어느 계층에 구현해야 하는지 빠르게 판단한다.
3. 문서/코드 리뷰에서 계층 침범 여부를 점검하는 기준을 제공한다.

---

## 2. 계층별 역할

### 2.1 `runtime`

`runtime`은 런타임 커널 계층이다.

- Orchestrator/AgentProcess/ConnectorProcess 실행 모델
- Turn/Step/ToolCall 실행 파이프라인
- Config 로딩/검증, IPC/이벤트 흐름, 상태/저장소 연동 규칙
- 실행 엔진 엔트리(`@goondan/runtime/runner`)와 runtime-runner 유틸리티(`runtime-routing`, `turn-policy`, `runtime-restart-signal`)

즉, 시스템이 "어떻게 실행되는가"를 담당하는 엔진 역할을 맡는다.
메시지 windowing/compaction 정책이나 provider-specific 대화 정규화는 runtime 코어 책임이 아니다.

### 2.2 `types`

`types`는 공통 타입 계약 계층이다.

- Runtime, Base, CLI, 향후 Tool/Extension 구현이 함께 참조하는 타입 정의
- 실행 컨텍스트, 이벤트/메시지, Tool 계약 등 공용 타입 표면
- 문서/구현 간 타입 정합성의 단일 기준

즉, 시스템이 "어떤 데이터 계약으로 상호작용하는가"를 담당한다.

### 2.3 `@goondan/base`

`base`는 기본 기능 번들 계층이다.

- 재사용 가능한 Tool/Extension/Connector의 기본 구현 제공
- 메시지 정책 Extension(`message-window`, `message-compaction`) 같은 선택형 정책 제공
- 실전에서 바로 사용할 수 있는 표준 빌딩 블록 제공
- 프로젝트가 빠르게 시작할 수 있는 기본 동작 세트 제공

즉, `runtime` 실행 모델과 `types` 계약 위에서 동작하는 "기본 구현 라이브러리" 역할을 맡는다.

### 2.4 `@goondan/cli`

`cli`는 운영/개발자 인터페이스 계층이다.

- 프로젝트 초기화, 실행, 재시작, 검증, 진단 등 운영 명령 제공
- 런타임 동작을 사람이 제어 가능한 명령 형태로 노출
- `@goondan/runtime/runner`를 기동하고 startup handshake/active pid 관리 수행
- 로컬 개발 흐름(초기화/검증/운영)을 일관된 UX로 제공

즉, 시스템의 "조작면(control plane entrypoint)" 역할을 맡는다.

### 2.5 `@goondan/registry`

`registry`는 패키지 유통/배포 계층이다.

- Package 메타데이터/아티팩트 배포 및 조회 경로 제공
- 버전, dist-tag, 접근 제어(공개/제한) 관점의 배포 정책 반영
- 설치/발행 흐름에서 참조되는 원격 패키지 소스 역할 수행

즉, 생태계 확장을 위한 "패키지 배포면(distribution plane)" 역할을 맡는다.

---

## 3. 관계 모델

의존 방향은 다음 원칙을 따른다.

- `runtime`은 실행 엔진 계층
- `types`는 공통 타입 계약 계층
- `base`는 `runtime` + `types` 위에 올라가는 기능 번들 계층
- `cli`는 `runtime`을 제어하고 `types`를 참조하는 인터페이스 계층
- `registry`는 패키지 유통/배포를 담당하는 저장소 계층

개념적으로는 다음 흐름으로 이해할 수 있다.

```text
사용자/운영자
   ↓
CLI (@goondan/cli)
   ↓
Runtime Kernel (runtime)
   ↔
Shared Contracts (types)
   ↓
기본/사용자 구현 Tool·Extension·Connector (@goondan/base 포함)
   ↔
Package Registry (@goondan/registry)
```

---

## 4. 협력 방식

### 4.1 개발 시점

- `base`는 기본 구현을 제공하고,
- 프로젝트는 이를 그대로 사용하거나 교체/확장한다.

### 4.2 실행 시점

- `runtime`은 로드된 Tool/Extension/Connector를 동일 실행 모델로 구동한다.
- `types`는 실행 경로에서 교환되는 데이터 구조의 계약을 제공한다.
- `base`는 그 실행 모델과 타입 계약 위에서 동작하는 구현 묶음으로 참여한다.
- `registry`는 배포된 Package의 조회/다운로드 소스로 참여한다.

### 4.3 운영 시점

- `cli`가 실행/재시작/검증/진단을 담당하고,
- 실제 런타임 제어와 상태 전이는 `runtime`이 담당한다.
- `cli`의 설치/발행 워크플로우는 `registry`와 연동된다.

---

## 5. 책임 경계 가이드

### 5.1 `runtime`에 둘 내용

- 실행 모델, 상태 전이, 런타임 정책, 실행 흐름 제어
- runtime-runner, connector child 프로세스 orchestration, ingress 라우팅, Tool 런타임 연결
- 메시지 정책(windowing/compaction)이나 provider 전용 포맷 보정 로직은 두지 않음

### 5.2 `types`에 둘 내용

- 여러 계층이 공유하는 타입 계약(실행 컨텍스트, 이벤트/메시지, Tool/Turn 결과 등)

### 5.3 `base`에 둘 내용

- 기본 Tool/Extension/Connector 구현

### 5.4 `cli`에 둘 내용

- 사용자 명령 UX, 출력 포맷, 운영 워크플로우
- runtime runner 프로세스 기동/재기동/목록/로그 제어, startup 오류 표면화

### 5.5 `registry`에 둘 내용

- 패키지 유통 API, 아티팩트 저장/조회, 배포 정책 적용

---

## 관련 문서

- `docs/specs/runtime.md`
- `docs/specs/shared-types.md`
- `docs/specs/bundle_package.md`
- `docs/specs/help.md`
- `docs/specs/tool.md`
- `docs/specs/extension.md`
- `docs/specs/connector.md`
- `docs/specs/cli.md`
