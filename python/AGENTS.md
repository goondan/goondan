# Python SDK

이 폴더는 언어 중립적인 Goondan 구성 파일을 Python에서 직접 실행하는 SDK를 소유합니다. TypeScript 구현과 같은 YAML 및 공통 실행 사례를 사용하며, 한쪽 런타임을 subprocess로 호출하지 않습니다.

공개 API는 `goondan` 패키지가 제공하고, 공식 모델 어댑터는 `goondan[models]` 선택 의존성으로 설치하는 `goondan.models` 하위 패키지가 제공합니다. 언어 간 의미는 루트의 `spec/`과 `fixtures/`를 기준으로 맞추며, Python 전용 편의 기능도 구성 파일의 공통 의미를 유지합니다.

검증은 저장소 루트에서 `pnpm test:python`으로, 또는 `python/goondan`에서 `uv run --extra test python -m pytest`로 실행합니다.
