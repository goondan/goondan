# @goondan/cli

`packages/cli`는 Goondan CLI(`gdn`) 구현 패키지입니다.

## 책임 범위

- 명령 파싱/라우팅 (`run`, `restart`, `validate`, `instance`, `package`, `doctor`)
- CLI 빌드 시 `dist/bin.js` 실행 권한 유지(`chmod +x`)
- 출력 포맷(구조화 오류, suggestion/helpUrl 포함)
- 런타임/레지스트리/검증 계층과의 연동 인터페이스
- `package publish` 시 `pnpm pack` 기반 tarball 생성 및 레지스트리 publish payload 구성
- `package install` 시 tarball 다운로드/무결성 검증/압축 해제 및 lockfile 갱신
- CLI 단위 테스트(vitest)

## 구현 규칙

1. 외부 의존성은 최소화하고, 인자 파싱은 내부 구현을 우선합니다.
2. 명령 입출력은 테스트 가능하도록 의존성 주입 구조를 유지합니다.
3. 오류는 가능한 한 구조화(`code`, `message`, `suggestion`, `helpUrl`)하여 출력합니다.
4. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 명시 타입으로 구현합니다.
5. `docs/specs/cli.md`, `docs/specs/bundle_package.md`, `docs/specs/help.md` 변경 시 구현 영향도를 즉시 반영합니다.
