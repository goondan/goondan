# Goondan 스펙 운영 도움말 (v0.0.3)

> 이 문서는 `docs/specs` 문서 간 중복을 줄이고 정합성을 유지하기 위한 운영용 SSOT이다.

---

## 1. 목적

이 문서는 다음을 단일 기준으로 제공한다.

1. 문서 소유권(어떤 개념을 어떤 스펙이 소유하는지)
2. 공통 계약(ObjectRef/ValueSource, 환경변수 해석, 레지스트리 설정)
3. Load/Validate 계약(로딩 단계, fail-fast, 구조화 오류)
4. CLI 도움말 기준(`gdn package` 명령어)

개별 스펙은 이 문서의 계약을 재정의하지 않고 참조를 우선해야 한다(SHOULD).

---

## 2. 문서 소유권 매트릭스

| 주제 | 단일 기준(Owner) | 다른 문서의 역할 |
|------|-------------------|------------------|
| 공통 타입(`ProcessStatus`, `IpcMessage`, `TurnResult`, `ToolContext` 등) | `docs/specs/shared-types.md` | 타입 재정의 대신 링크/요약 |
| 실행 컨텍스트/이벤트 엔벨로프(ExecutionContext, EventEnvelope) | `docs/specs/shared-types.md` | 런타임/파이프라인 문맥 확장 |
| 리소스 Kind 스키마(8종) | `docs/specs/resources.md` | 문맥별 사용 규칙/예시 |
| Config 참조 모델(ObjectRef/ValueSource) | `docs/specs/resources.md` | 번들/커넥션은 문맥 예시만 제공 |
| 로딩/검증/Fail-Fast 계약 | `docs/specs/resources.md` | 번들/패키지/CLI는 진입점별 제약만 추가 |
| Runtime 실행 모델/프로세스/IPC 흐름 | `docs/specs/runtime.md` | API/확장은 외부 시그니처 중심 설명 |
| Runtime 표준 이벤트 이름/페이로드 API 표면 | `docs/specs/api.md` | Runtime은 발행 시점/실행 규칙 소유 |
| 메시지 상태 실행 규칙(`NextMessages = Base + SUM(Events)`) | `docs/specs/runtime.md` | 파이프라인/워크스페이스는 해당 문맥만 기술 |
| 메시지/상태 저장 레이아웃(`base.jsonl`, `events.jsonl`) | `docs/specs/workspace.md` | 런타임/파이프라인은 저장 규칙 재정의 금지 |
| 미들웨어 파이프라인 계약 | `docs/specs/pipeline.md` | 확장/툴 문서는 패턴 중심 설명 |
| Extension API/로딩/상태 모델 | `docs/specs/extension.md` | API/툴 문서는 참조 중심 설명 |
| Tool 시스템 계약 | `docs/specs/tool.md` | API/런타임은 참조 중심 |
| Connector 계약(`ConnectorContext`, `ConnectorEvent`) | `docs/specs/connector.md` | API 문서는 참조 중심 설명 |
| Connection 계약(`ConnectionSpec`, `Ingress*`) | `docs/specs/connection.md` | API 문서는 참조 중심 설명 |
| Package 라이프사이클/레지스트리 API | `docs/specs/bundle_package.md` | CLI는 UX/명령 인터페이스 중심 |
| CLI 명령 인터페이스 | `docs/specs/cli.md` | 도메인 스펙은 의미론/제약 중심 |
| OAuth 범위 문서 | `docs/specs/oauth.md` | 소유 문서(extension/connection) 참조 |

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

### 3.3 Load & Validate 계약

1. 구성 검증은 Runtime 시작 전 로딩 단계에서 수행해야 한다(MUST).
2. 오류가 하나라도 있으면 부분 로드 없이 전체 구성을 거부해야 한다(MUST).
3. 오류는 코드/경로/메시지를 포함한 구조화 형식으로 반환해야 한다(MUST).
4. `apiVersion`은 모든 리소스에서 `goondan.ai/v1`로 명시되어야 한다(MUST).

### 3.4 메시지 상태 책임 분리

1. 실행 규칙(이벤트 적용 순서, 폴딩 시점, 복원 규칙)은 `docs/specs/runtime.md`를 단일 기준으로 따른다(MUST).
2. 저장 규칙(파일 경로, JSONL 레이아웃, 디렉터리 구조)은 `docs/specs/workspace.md`를 단일 기준으로 따른다(MUST).
3. `docs/specs/pipeline.md`는 미들웨어 관점의 사용 계약만 기술하고 저장 레이어 세부를 재정의하지 않는다(SHOULD).

### 3.5 `fooBar` / `fooBarRef` 페어 규칙

1. 동일 객체에 `fooBar`와 `fooBarRef`를 동시에 선언하면 스키마 검증에서 실패해야 한다(MUST).
2. 유효한 입력은 둘 중 하나만 포함해야 하며, `fooBar`는 인라인 값, `fooBarRef`는 참조 값으로 해석한다(SHOULD).
3. `fooBarRef`가 존재할 때 `fooBar`와 자동 문자열 병합을 수행해서는 안 된다(MUST NOT).

---

## 4. 레지스트리 설정 계약

### 4.1 기본 엔드포인트

- 기본 레지스트리 URL: `https://goondan-registry.yechanny.workers.dev`

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
  "registry": "https://goondan-registry.yechanny.workers.dev",
  "registries": {
    "https://goondan-registry.yechanny.workers.dev": {
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

### 5.1 명령어

| 명령어 | 설명 |
|--------|------|
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package install` | 의존성 설치 |
| `gdn package update` | 의존성 최신 버전 갱신 |
| `gdn package publish` | 패키지 발행 |

---

## 6. 문서 수정 체크리스트

스펙 문서를 수정할 때 다음을 확인한다.

1. 공통 타입 변경이면 `shared-types.md`를 먼저 수정했는가.
2. 동일 규칙을 여러 문서에 재정의하지 않고 참조로 유지했는가.
3. `gdn package` 명령어 매트릭스를 `help.md` 외 문서에서 중복 정의하지 않았는가.
4. 레지스트리 기본 URL과 설정 소스(`~/.goondan/config.json`)가 일치하는가.
5. 환경변수 해석 정책이 문서 간 일치하는가.
6. 링크 점검 자동 체크(`7. 링크 자동 점검 체크리스트`)를 실행했는가.

---

## 7. 링크 자동 점검 체크리스트

아래 명령은 문서 PR/머지 전에 자동 실행 가능한 최소 점검 세트다.

### 7.1 로컬 문서 경로 존재 검사

```bash
rg --no-filename -o "docs/[A-Za-z0-9_./-]+\\.md" docs/specs/*.md GUIDE.md \
  | sort -u \
  | while IFS= read -r p; do
  [ -f "$p" ] || echo "MISSING: $p"
done
```

출력이 비어 있어야 한다(MUST).

### 7.2 금지 링크 패턴 검사 (`@docs/`)

```bash
rg -n "@docs/" docs/specs/*.md GUIDE.md | grep -v '^docs/specs/help.md:' || true
```

출력이 비어 있어야 한다(MUST). 문서 경로는 `docs/...` 또는 `/docs/...` 표기를 사용한다.

### 7.3 `관련 문서` 섹션 존재 검사

```bash
for f in docs/specs/*.md; do
  rg -q "^## .*관련 문서$" "$f" || echo "MISSING 관련 문서: $f"
done
```

소유권 참조가 필요한 스펙 문서는 `## 관련 문서` 섹션을 포함해야 한다(SHOULD).

### 7.4 섹션 번호 참조 드리프트 검사 (`§n`)

```bash
rg -n "§[0-9]" docs/specs/*.md GUIDE.md || true
```

출력이 비어 있어야 한다(SHOULD). 섹션 번호 대신 섹션명/앵커 참조를 사용한다.

---

## 관련 문서

- `docs/specs/shared-types.md`
- `docs/specs/resources.md`
- `docs/specs/bundle.md`
- `docs/specs/bundle_package.md`
- `docs/specs/cli.md`
