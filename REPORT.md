# 작업 보고서 (2026-02-01)

## 1) 개요
Goondan 생태계를 “k8s for agent swarm” 관점에서 확장/운영 가능하도록 정리했습니다. 핵심은 **확장 묶음(Bundle) 등록/검증/무결성 관리**, **CLI 기반 운영**, **SDK 타입 정비**, **샘플/문서 보강**입니다.

## 2) 수행 내역
### 2.1 분류 정리 및 구조 정돈
- compaction은 Extension, tool-search는 Tool로 정정
- 빈 디렉터리 제거 및 관련 AGENTS/TODO/goondan_spec 반영

### 2.2 SDK 타입 강화 및 core 타입 정리
- `Record<string, unknown>` 제거, `sdk/types.ts` 중심 타입 체계로 통합
- Tool/Extension/LiveConfig/Runtime API 타입 안정화

### 2.3 Bundle 시스템 구축
- Bundle 로더/레지스트리 구현 및 CLI 연동
- 번들 등록/활성화/비활성화/정보조회/검증/무결성/lockfile 생성 흐름 추가

### 2.4 CLI 고도화
- run/validate/export/bundle 서브커맨드 추가
- `validate --strict`로 entry 존재 및 중복 리소스 검사 지원
- `export`로 bundle+config 병합 리소스 YAML/JSON 출력
- `bundle verify/refresh/lock/verify-lock`으로 무결성/재현성 강화

### 2.5 샘플 패키지 추가
- `packages/sample`에 최소 실행 구성 및 CLI 스크립트 제공
- bundle 등록/검증/무결성/실행 플로우 예시 제공

### 2.6 문서/스펙 업데이트
- `docs/spec_api.md` 신설 및 CLI/Bundle API 문서화
- `goondan_spec.md`에 Bundle 개념 추가
- AGENTS 최신화 (root/docs/core/base/sample)

## 3) CTO 관점에서의 생각과 판단
- **확장 생태계의 핵심은 배포/등록/검증/무결성**이라고 판단했습니다. 그래서 번들 시스템에 lock/verify/refresh를 붙여 “패키지 매니저 없이도 신뢰할 수 있는 확장 등록”을 목표로 했습니다.
- **운영 UX는 CLI에서 시작**한다고 보고, run/validate/export/bundle 서브커맨드를 강화했습니다. 특히 `export`는 인프라/CI/CD 파이프라인에 바로 붙일 수 있는 포맷으로 설계했습니다.
- **SDK 타입 정돈은 확장 생태계 확산의 기반**이므로, core/base 전체에서 느슨한 Record 타입을 제거하고 명시적 타입을 제공했습니다.
- **샘플은 생태계 확장의 첫 번째 온보딩 포인트**이므로, 가장 적은 구성으로도 번들 등록/실행이 되도록 구조화했습니다.

## 4) 주요 변경 파일
- 번들/CLI
  - `packages/core/src/bundles/loader.ts`
  - `packages/core/src/bundles/registry.ts`
  - `packages/core/src/cli/index.ts`
  - `packages/core/src/cli/AGENTS.md`
- SDK 타입
  - `packages/core/src/sdk/types.ts`
- 문서/스펙
  - `docs/spec_api.md`
  - `goondan_spec.md`
- 샘플
  - `packages/sample/goondan.yaml`
  - `packages/sample/package.json`
  - `packages/sample/README.md`
  - `packages/sample/AGENTS.md`
- base 번들
  - `packages/base/bundle.yaml`
- 분류 정리
  - `packages/base/src/extensions/compaction/index.ts`
  - `packages/base/src/tools/tool-search/index.ts`
  - `packages/base/src/index.ts`
  - `packages/base/tests/compaction.test.ts`

## 5) 검증 방법
### 5.1 타입 체크
```
pnpm -C /Users/channy/workspace/goondan exec tsc -p packages/core/tsconfig.json --noEmit
pnpm -C /Users/channy/workspace/goondan exec tsc -p packages/base/tsconfig.json --noEmit
```

### 5.2 빌드
```
pnpm -C /Users/channy/workspace/goondan/packages/core build
pnpm -C /Users/channy/workspace/goondan/packages/base build
```

### 5.3 샘플 실행/검증
```
# bundle 등록
pnpm -C packages/sample bundle:add

# bundle 검증/무결성
pnpm -C packages/sample bundle:validate
pnpm -C packages/sample bundle:verify
pnpm -C packages/sample bundle:lock
pnpm -C packages/sample bundle:verify-lock

# config strict 검증
pnpm -C packages/sample validate:strict

# 실행
pnpm -C packages/sample run
pnpm -C packages/sample run:registered

# export
pnpm -C packages/sample export
```

## 6) 남은 개선 아이디어 (제안)
- Bundle manifest에 `resources[].spec.entry`의 runtime/플랫폼 별 매핑 규칙 확장
- CI에서 `bundle lock` 생성 → `bundle verify-lock` 강제 정책 추가
- sample을 2개 이상(예: MCP 연동, OAuth 흐름)로 확장

## 7) 추가 작업 (mise, npm 배포)
- mise.toml에 Node 버전(24.5.0) 등록으로 버전 고정
- @goondan/core, @goondan/base `pnpm publish` 시도: 빌드 완료 후 **NPM_TOKEN 만료/권한 문제로 배포 실패**
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **변경 없음**

## 8) 추가 작업 (로컬 env 파일 정리)
- `.envrc`/`.envrc.example` 제거, `mise.local.toml`로 로컬 env를 받도록 전환
- `.gitignore`에 `mise.local.toml` 추가
- `.nvmrc` 제거 (mise 단일 기준 유지)
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **변경 없음**

## 9) 추가 작업 (루트 스크립트 정비)
- 루트 `package.json`에 패키지 빌드/배포용 스크립트 추가 (core/base publish 포함)
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 검토: **변경 없음**

## 10) 추가 작업 (Bundle Git 요구사항 문서화)
- `docs/spec_bundle.md` 신설: Git 기반 번들 요구사항, include 규칙, 상세 예시 정리
- `goondan_spec.md` §18 업데이트: Git 기반 Bundle 개념 및 include 의미 반영
- `docs/spec_api.md` / `docs/scenario_example1.md`에서 번들 등록 예시를 Git 참조로 정정
- `AGENTS.md`, `docs/AGENTS.md` 문서 목록 최신화
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **goondan_spec.md 변경**, **docs/spec_config.md 변경 없음**
- 관련 validator 영향: **변경 없음** (Bundle 스펙 문서화 단계)

## 11) 추가 작업 (Bundle include 스키마/베이스 마이그레이션)
- Bundle 스키마 갱신: `BundleManifest.spec`를 dependencies/include 중심으로 변경
- bundle 로더 갱신: include YAML 로딩, include/dependencies 검증, entry 경로 절대화
- CLI 갱신: bundle info에서 include/dependencies 출력, include 기반 리소스 집계
- base 번들 마이그레이션: bundle.yaml include 전환, 리소스 YAML 추가, npm files 포함
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **변경 없음**

## 12) 추가 작업 (Git 번들 다운로드/캐시/의존성 해석)
- Git Bundle 설치 로직 추가: `packages/core/src/bundles/git.ts` (ref 파싱, 캐시 디렉터리, git clone/fetch/checkout)
- Bundle 로더에서 dependencies 재귀 해석 + include YAML 로딩 유지
- CLI init/bundle add에서 Git Bundle 등록 지원 및 기본 base 스펙을 Git으로 전환
- bundle info/validate/run/export에서 stateRootDir 전달로 dependency 해석 활성화
- `docs/spec_api.md`의 init 설명을 Git Bundle 기준으로 정정
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **변경 없음**

## 13) 추가 작업 (빌드 오류 수정 및 core/base 빌드)
- git bundle ref 파싱 엄격화 및 타입 오류 수정: `packages/core/src/bundles/git.ts`
- dependency 로딩 타입 오류 수정: `packages/core/src/bundles/loader.ts`
- core/base 빌드 완료: `pnpm -C packages/core build`, `pnpm -C packages/base build`
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **변경 없음**

## 14) 추가 작업 (Git-only dist 커밋 전환)
- base 번들 include를 dist로 전환하고 dist를 Git에 커밋하도록 `.gitignore` 예외 추가
- base 빌드 스크립트에 dist 정리 + YAML 복사 스크립트 추가
- base 패키징 정리(불필요한 index 엔트리 제거, files 범위 축소)
- 문서/스펙에서 base Git 경로 및 dist include 예시 갱신
- goondan_spec.md / docs/spec_config.md 변경 필요 여부 재검토: **goondan_spec.md 변경**, **docs/spec_config.md 변경 없음**
