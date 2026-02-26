# packages/runtime/src/config

`config`는 goondan.yaml 로딩, ObjectRef 해석/검증, runtime 리소스 정규화를 담당하는 런타임 구성 계층의 SSOT다.

## 존재 이유

- 선언형 YAML을 실행 가능한 `RuntimeResource` 집합으로 변환한다.
- validate와 runtime plan/build가 공유하는 참조(ObjectRef) 해석 규칙을 제공한다.

## 구조적 결정

1. ObjectRef 정규화/추출 규칙은 `object-ref.ts`에 집중한다.
이유: `resources.ts`(validate)와 `runner`(실행)가 같은 해석기를 공유해야 드리프트가 사라진다.
2. 패키지 의존 로딩/락파일 해석은 `bundle-loader.ts`가 담당한다.
이유: 실행 이전에 패키지 범위와 파일 경로를 결정론적으로 확정해야 하기 때문.

## 불변 규칙

- ObjectRef 파싱 로직을 다른 계층에서 중복 구현하지 않는다.
- validate 오류 코드는 `E_CONFIG_*` 체계를 유지한다.
- `RuntimeResource.__package` 범위 해석 규칙을 임의로 변경하지 않는다.

## 참조

- `docs/specs/resources.md`
- `docs/specs/bundle.md`
- `docs/specs/bundle_package.md`
- `packages/runtime/AGENTS.md`
