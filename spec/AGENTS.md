# Goondan 규격

이 폴더는 TypeScript와 Python 호스트가 공유하는 Goondan 규격을 소유합니다.

- `goondan.md`는 YAML 선언의 의미, 기본값, 합성 순서, 값 처리 단계와 훅, 승인 작업, 흐름, 실행 결과와 이벤트, 템플릿 문법, 구성 오류와 실행 오류를 규범적으로 설명합니다.
- `goondan.schema.json`은 합성을 마친 구성 문서와 유효 구성을 JSON으로 해석했을 때의 필드 구조와 허용 값을 정의합니다. 합성에 참여하는 개별 YAML 파일은 부분 구성일 수 있으므로 이 스키마를 파일마다 적용하지 않습니다.
- `model-adapters.md`는 공식 모델 어댑터(TypeScript `@goondan/models`, Python `goondan.models`)가 모델 입력과 결과를 제공자 요청과 응답으로 바꾸는 규칙을 설명합니다. 제공자와 무관한 모델 입력과 결과의 규칙은 `goondan.md`의 "모델 입력과 결과"에 둡니다.

구성 필드나 실행 의미를 바꿀 때에는 `goondan.md`와 `goondan.schema.json`을 함께 검토하고, TypeScript와 Python 구성 로더와 `fixtures/conformance`의 공통 실행 사례를 같은 규격에 맞춥니다. `goondan.md`의 각 절은 하나 이상의 conformance 사례로 검증합니다. 모델 어댑터의 요청과 응답 변환을 바꿀 때에는 `model-adapters.md`와 `fixtures/models`의 사례를 함께 고칩니다. 문서에는 현재 유효한 선언과 동작을 기록하며 구현 내부 구조, 실험 결과와 변경 회고를 포함하지 않습니다.
