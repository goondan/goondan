# packages/core

오케스트레이터 핵심 런타임 패키지입니다.

## 디렉터리
- src: 런타임/Config/LiveConfig/Tool/Extension + Bundle/CLI 코드
- tests: core 단위 테스트

## 참고 사항
- 스펙 변경 시 docs/requirements/index.md(및 관련 requirements/*.md), docs/spec_bundle.md 수정 여부를 함께 검토합니다.
- 변경 사항에 맞는 테스트를 항상 작성/보완하고, 작업 완료 시 빌드 및 테스트를 반드시 실행합니다.
- 타입 단언(`as`, `as unknown as`)은 사용하지 않습니다.
