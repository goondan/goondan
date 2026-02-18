# packages/base

`@goondan/base` 패키지는 Goondan v2 런타임에서 바로 사용할 수 있는 기본 Tool/Extension/Connector 구현과 리소스 샘플 매니페스트를 제공한다.

## 배포 정책

- `@goondan/base`는 npm 배포 대상이 아니다.
- 따라서 `npm publish`/`pnpm publish`로 `@goondan/base`를 배포하지 않는다.

## 책임 범위

- Tool 기본 구현: `bash`, `wait`(seconds), `file-system`, `agents`(request/send/spawn/list/catalog), `self-restart`(request), `http-fetch`, `json-query`, `text-transform`, `telegram`(send/edit/delete/react/setChatAction/downloadFile, parseMode normalize), `slack`(send/read/edit/delete/react/downloadFile)
- Extension 기본 구현: `logging`, `message-window`, `message-compaction`, `tool-search` (`message-window`/`message-compaction`은 tool-call/tool-result 짝 정합성을 유지하도록 고아 tool-result를 정리)
- Extension 타입 계약: `turn`/`step` 미들웨어 컨텍스트의 `ctx.agents`(request/send) 표면을 런타임과 동일하게 유지
- Connector 기본 구현: `cli`, `webhook`, `telegram-polling`(bot-origin 메시지 무시로 self-feedback 방지, photo/image document file_id 메타 전달), `slack`(webhook port/path configurable, 첨부 image/file 참조 텍스트 보강), `discord`, `github`
- 리소스 매니페스트 헬퍼: Tool/Extension/Connector/Connection 샘플 생성
- `vitest` 기반 단위 테스트

## 구현 기준

1. `docs/specs/tool.md`, `docs/specs/extension.md`, `docs/specs/connector.md`, `docs/specs/connection.md` 계약을 우선 반영한다.
2. 공통 타입 계약은 `docs/specs/shared-types.md`를 따른다.
3. Tool 이름 규칙은 `{resource}__{export}`를 유지한다.
4. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 정확한 타입 정의로 구현한다.
5. 테스트는 네트워크 의존 없이 로컬 재현 가능해야 한다.
6. 이 패키지는 npm 배포를 수행하지 않는다.

## 디렉토리 가이드

- `goondan.yaml`: 로컬 의존성/검증 기준 Package 메타데이터 매니페스트
- `build-manifest.mjs`: 빌드 후 `dist/goondan.yaml`(리소스 포함 배포 manifest) 생성 스크립트 (`goondan.yaml`의 Package name/version을 소스로 사용)
- `src/types.ts`: base 패키지의 공통 타입 및 가드
- `src/tools/*`: Tool 핸들러 구현 (`handlers` export)
- `src/extensions/*`: Extension 등록 함수 및 미들웨어
- `src/connectors/*`: Connector entry/skeleton 예시
- `src/manifests/*`: 샘플 리소스 생성 헬퍼
- `test/*`: Tool/Extension 동작 검증 테스트
