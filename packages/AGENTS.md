# packages

`packages`는 Goondan의 배포 경계와 책임 경계를 관리하는 루트다.

## 존재 이유

- `runtime`, `types`, `base`, `cli`, `studio`, `registry`를 독립 패키지로 유지해 변경 영향과 배포 단위를 분리한다.
- 구현 상세는 각 패키지가 소유하고, 이 문서는 패키지 간 경계 원칙만 정의한다.

## 구조적 결정

1. 공통 계약은 `@goondan/types`를 단일 기준으로 둔다.
이유: 패키지 간 타입 드리프트를 막고 계약 변경 파급을 통제하기 위해.
2. `@goondan/base`는 npm이 아니라 goondan 패키지 레지스트리로 배포한다.
이유: 코드뿐 아니라 리소스 매니페스트를 함께 유통해야 하기 때문.
3. npm 배포 대상 `@goondan/*`는 단일 버전 정책을 유지한다.
이유: 운영/디버깅 시 버전 매트릭스 복잡도를 줄이기 위해.

## 불변 규칙

- 패키지는 자신이 소유한 스펙 범위를 넘는 책임을 흡수하지 않는다.
- 공개 npm 패키지는 `publishConfig.access = "public"`을 유지한다.
- 타입 단언(`as`, `as unknown as`) 대신 타입 가드/정확한 타입 모델을 사용한다.

## 참조

- `docs/specs/layers.md`
- `docs/specs/help.md`
- `docs/specs/bundle_package.md`
- `AGENTS.md`
