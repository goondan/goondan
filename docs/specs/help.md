# Goondan 스펙 운영 도움말 (v2.0)

> 이 문서는 `docs/specs` 문서 간 중복을 줄이고 정합성을 유지하기 위한 운영용 SSOT이다.

---

## 1. 목적

이 문서는 다음을 단일 기준으로 제공한다.

1. 문서 소유권(어떤 개념을 어떤 스펙이 소유하는지)
2. 공통 계약(ObjectRef/ValueSource, 환경변수 해석, 레지스트리 설정)
3. CLI 도움말 기준(`gdn package` 지원/제거 명령어)

개별 스펙은 이 문서의 계약을 재정의하지 않고 참조를 우선해야 한다(SHOULD).

---

## 2. 문서 소유권 매트릭스

| 주제 | 단일 기준(Owner) | 다른 문서의 역할 |
|------|-------------------|------------------|
| 공통 타입(`ProcessStatus`, `IpcMessage`, `TurnResult`, `ToolContext` 등) | `docs/specs/shared-types.md` | 타입 재정의 대신 링크/요약 |
| 리소스 Kind 스키마(8종) | `docs/specs/resources.md` | 문맥별 사용 규칙/예시 |
| Runtime 실행 모델/프로세스/IPC 흐름 | `docs/specs/runtime.md` | API/확장은 외부 시그니처 중심 설명 |
| 미들웨어 파이프라인 계약 | `docs/specs/pipeline.md` | 확장/툴 문서는 패턴 중심 설명 |
| Extension API/로딩/상태 모델 | `docs/specs/extension.md` | API/툴 문서는 참조 중심 설명 |
| Tool 시스템 계약 | `docs/specs/tool.md` | API/런타임은 참조 중심 |
| Connector 계약(`ConnectorContext`, `ConnectorEvent`) | `docs/specs/connector.md` | API 문서는 참조 중심 설명 |
| Connection 계약(`ConnectionSpec`, `Ingress*`) | `docs/specs/connection.md` | API 문서는 참조 중심 설명 |
| Package 라이프사이클/레지스트리 API | `docs/specs/bundle_package.md` | CLI는 UX/명령 인터페이스 중심 |
| CLI 명령 인터페이스 | `docs/specs/cli.md` | 도메인 스펙은 의미론/제약 중심 |

---

## 3. 공통 계약

### 3.1 ObjectRef / ValueSource

- 타입 원형은 `docs/specs/shared-types.md`를 따른다(MUST).
- 리소스 로딩/검증 규칙은 `docs/specs/resources.md`를 따른다(MUST).
- 번들 문맥의 예시는 `docs/specs/bundle.md`를 따른다(SHOULD).

### 3.2 환경변수 해석 정책

`valueFrom.env` 해석은 다음을 따른다.

1. 필수 필드: 환경변수가 없으면 구성 로드 단계에서 오류로 처리한다(MUST).
2. 선택 필드: 환경변수가 없으면 해당 필드를 미설정 상태로 둔다(SHOULD).
3. 경고만 출력하고 빈 문자열로 강제 대체하는 동작은 기본 정책이 되어서는 안 된다(SHOULD NOT).

---

## 4. 레지스트리 설정 계약

### 4.1 기본 엔드포인트

- 기본 레지스트리 URL: `https://registry.goondan.ai`

### 4.2 설정 소스

지원되는 설정 소스:

1. CLI 옵션 (`--config`, `--state-root` 등)
2. 환경 변수 (`GOONDAN_REGISTRY`, `GOONDAN_REGISTRY_TOKEN`)
3. `~/.goondan/config.json`
4. 기본값

우선순위는 위 순서를 따른다(높은 것이 우선)(MUST).

### 4.3 설정 파일 형식

```json
{
  "registry": "https://registry.goondan.ai",
  "registries": {
    "https://registry.goondan.ai": {
      "token": "${GOONDAN_REGISTRY_TOKEN}"
    }
  },
  "scopedRegistries": {
    "@myorg": "https://my-org-registry.example.com"
  }
}
```

---

## 5. CLI 도움말 기준 (`gdn package`)

### 5.1 지원 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package install` | 의존성 설치 |
| `gdn package publish` | 패키지 발행 |

### 5.2 제거된 명령어

| 제거된 명령어 | 대체 방법 |
|---------------|-----------|
| `gdn package remove <ref>` | `goondan.yaml` 직접 수정 후 `gdn package install` |
| `gdn package update [ref]` | `gdn package add <ref>@<version>` |
| `gdn package list` | `goondan.yaml`의 `Package.dependencies` 확인 |
| `gdn package unpublish <ref>` | 레지스트리 UI/API 사용 |
| `gdn package deprecate <ref>` | 레지스트리 UI/API 사용 |
| `gdn package login/logout` | `~/.goondan/config.json`의 `registries` 편집 |
| `gdn package pack` | 제거 |
| `gdn package info <ref>` | 레지스트리 웹 UI/API 사용 |

---

## 6. 문서 수정 체크리스트

스펙 문서를 수정할 때 다음을 확인한다.

1. 공통 타입 변경이면 `shared-types.md`를 먼저 수정했는가.
2. 동일 규칙을 여러 문서에 재정의하지 않고 참조로 유지했는가.
3. `gdn package` 도움말 표는 `cli.md`와 `bundle_package.md`에서 동일한가.
4. 레지스트리 기본 URL과 설정 소스(`~/.goondan/config.json`)가 일치하는가.
5. 환경변수 해석 정책이 문서 간 일치하는가.

---

## 관련 문서

- `docs/specs/shared-types.md`
- `docs/specs/resources.md`
- `docs/specs/bundle.md`
- `docs/specs/bundle_package.md`
- `docs/specs/cli.md`
