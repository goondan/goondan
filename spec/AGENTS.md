# Goondan 규격

이 폴더는 TypeScript와 Python 호스트가 공유하는 Goondan YAML 규격을 소유합니다.

- `goondan.md`는 선언의 의미, 기본값, 합성 순서, 실행 결과와 오류를 규범적으로 설명합니다.
- `goondan.schema.json`은 YAML을 JSON으로 해석했을 때의 필드 구조와 허용 값을 정의합니다.

구성 필드나 실행 의미를 바꿀 때에는 두 파일을 함께 검토하고, TypeScript와 Python 구성 로더 및 공통 conformance fixture를 같은 규격에 맞춥니다. 문서에는 현재 유효한 선언과 동작을 기록하며 구현 내부 구조, 실험 결과와 변경 회고를 포함하지 않습니다.
