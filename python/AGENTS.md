# Python SDK

이 폴더는 언어 중립적인 Goondan 구성 파일을 Python에서 직접 실행하는 SDK를 소유합니다. TypeScript 구현과 같은 YAML 및 conformance fixture를 사용하며, 한쪽 런타임을 subprocess로 호출하지 않습니다.

공개 API는 `goondan` 패키지에서 제공하고, 언어 간 의미는 루트의 `spec/`과 `fixtures/conformance/`를 기준으로 맞춥니다. Python 전용 편의 기능은 구성 파일의 공통 의미를 유지합니다.
