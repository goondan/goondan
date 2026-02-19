# packages/registry

`@goondan/registry`는 Goondan 패키지 유통을 위한 메타데이터/아티팩트 저장 및 배포 계약을 구현한다.

## 존재 이유

- `gdn package` 생태계의 설치/업데이트/배포 흐름을 안정적으로 지원한다.
- 패키지 무결성, 접근 제어, 버전 라이프사이클을 중앙에서 관리한다.

## 구조적 결정

1. 로컬(Node) 경로와 Cloudflare 운영 경로를 분리해 유지한다.
이유: 개발/테스트 생산성과 운영 배포 안정성을 동시에 확보하기 위해.
2. 레지스트리 계약은 스펙 문서 기준으로 고정한다.
이유: CLI-Registry 간 프로토콜 드리프트를 방지하기 위해.

## 불변 규칙

- 동일 버전 중복 publish는 항상 실패해야 한다.
- 인증/접근 제어(public/restricted) 의미를 환경 간 동일하게 유지한다.
- `@goondan/*` 버전 동기화 정책에서 레지스트리 패키지를 제외하지 않는다.
- 타입 단언(`as`, `as unknown as`) 없이 타입 가드/명시 타입으로 유지한다.

## 참조

- `docs/specs/bundle_package.md`
- `docs/specs/help.md`
- `packages/registry/cloudflare/AGENTS.md`
