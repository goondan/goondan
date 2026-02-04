# docs/specs

Goondan 구현 스펙 문서 폴더입니다. 요구사항 문서(docs/requirements)를 기반으로 실제 구현에 필요한 상세 스펙을 정의합니다.

## 파일 구조

- `api.md` - Runtime/SDK API 스펙 (Extension, Tool, Connector API)
- `resources.md` - Config Plane 리소스 정의 스펙 (리소스 공통 형식, ObjectRef, Selector, ValueSource, Kind별 스키마)
- `bundle.md` - Bundle YAML 스펙 (리소스 정의, 검증 규칙)
- `bundle_package.md` - Bundle Package 스펙 (Git 기반 패키징/참조)
- `runtime.md` - Runtime 실행 모델 스펙 (Instance/Turn/Step, 라우팅, 메시지 누적, Auth 보존)
- `changeset.md` - Changeset/SwarmBundle 스펙 (SwarmBundleRef, SwarmBundleManager, ChangesetPolicy, Safe Point)
- `connector.md` - Connector 시스템 스펙 (인증, Ingress/Egress, Trigger Handler)
- `extension.md` - Extension 시스템 스펙 (ExtensionApi, 파이프라인, MCP/Skill 패턴)
- `oauth.md` - OAuth 시스템 스펙 (OAuthApp, OAuthStore, PKCE 플로우, Token 관리)
- `pipeline.md` - 라이프사이클 파이프라인(훅) 스펙 (Mutator, Middleware, 파이프라인 포인트)
- `tool.md` - Tool 시스템 스펙 (Registry/Catalog, 핸들러, OAuth 통합)
- `workspace.md` - Workspace 및 Storage 모델 스펙 (3루트 분리, 경로 규칙, 로그 스키마)

## 문서 작성 규칙

1. **버전 표기**: 각 스펙 문서 제목에 버전을 명시합니다 (예: `v0.8`).
2. **요구사항 참조**: 해당 스펙이 기반하는 요구사항 문서를 명시합니다.
3. **TypeScript 인터페이스**: 구현에 사용할 TypeScript 타입/인터페이스를 정의합니다.
4. **YAML 예시**: 리소스 정의 예시를 포함합니다.
5. **규칙 명시**: MUST/SHOULD/MAY 규범적 표현으로 요구 수준을 명확히 합니다.

## 수정 시 주의사항

1. **요구사항 일치**: 스펙은 `docs/requirements/*.md`의 요구사항과 일치해야 합니다.
2. **GUIDE.md 동기화**: 스펙 변경 시 `/GUIDE.md` 반영 여부를 검토합니다.
3. **구현 검증**: 스펙 변경 후 `packages/core` 구현이 스펙을 준수하는지 확인합니다.

## 관련 문서

- `/docs/requirements/index.md` - 요구사항 메인 문서
- `/GUIDE.md` - 개발자 가이드
- `/CLAUDE.md` - 프로젝트 개요 및 작업 규칙
