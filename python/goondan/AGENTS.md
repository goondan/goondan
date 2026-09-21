# goondan Python 패키지

이 패키지는 Goondan 구성 파일을 Python 프로세스에서 직접 실행합니다. 공개 인터페이스와 실행 동작은 TypeScript의 `@goondan/core`, `spec/goondan.schema.json`, `fixtures/conformance/`와 같은 의미를 유지합니다.

## 모듈

`goondan/` 패키지는 TypeScript `packages/core/src`와 대응하는 책임으로 모듈을 나눕니다. 이름이 밑줄로 시작하는 모듈은 패키지 내부용이며, 호스트가 쓰는 이름은 `__init__.py`가 다시 내보냅니다.

| 모듈 | 소유 범위 |
|---|---|
| `types.py` | 공개 데이터클래스, 프로토콜, 컨텍스트, 정의 도우미와 오류 클래스 |
| `_json.py` | 두 호스트가 같은 결과를 만드는 JSON 직렬화와 값 처리 |
| `_yaml.py` | YAML 해석 규칙, 중복 키·앵커·별칭 판정 |
| `_schema.py` | `goondan.schema.json` 해석기, 스키마 검사와 오류 정렬 |
| `_values.py` | 단계 값 형식, 메시지 보강, 제어 결과와 도구 반환값 정규화 |
| `config.py` | YAML 로딩, `resources` 합성, 상속과 제거, 참조·바인딩 검사 |
| `template.py` | 구성 로딩 시 읽은 맵만 쓰는 렌더러와 정적 include 해석 |
| `store.py` | `Store` 프로토콜의 오류와 `InMemoryStore` |
| `fold.py` | 버전이 붙은 저널 이벤트를 상태 뷰로 재생하는 순수 `fold` |
| `runtime.py` | `Goondan`과 `create_goondan`, 입력 대기열, 훅, 모델·도구 반복, route, 승인 작업, 임대와 이벤트 |
| `goondan.schema.json` | `spec/goondan.schema.json`의 패키지 사본 |
| `models/` | Anthropic과 OpenAI 공식 모델 어댑터 |

모듈은 순환 없이 한 방향으로 가져옵니다. `models/`는 코어 모듈 가운데 `types.py`와 `_json.py`만 가져오므로 어댑터를 설치하지 않아도 런타임은 동작합니다.

## 실행 범위와 호스트 API

군단 객체는 에이전트를 선언 이름으로 식별합니다. `stateful: true`인 에이전트는 세션과 에이전트 이름의 조합마다 대화와 확장 인스턴스를 유지합니다. `stateful: false`인 에이전트는 실행마다 빈 대화와 새 확장 인스턴스를 사용하며 실행 기록은 같은 세션 저널에 남깁니다.

호스트 API는 `run(value, session_id=None, meta=None, agent=..., start_agent=...)`, `abort`, `idle`, `close`, `sessions.delete`, `operations.list`, `operations.decide`입니다. `run`은 수락된 입력의 `session_id`, `turn_id`, `input_id`와 턴 결과 awaitable인 `result`를 가진 핸들을 반환합니다. 진행 중인 세션에 추가로 호출한 `run`은 대상 stateful 인스턴스의 입력 대기열에 합류합니다. `agent`와 `start_agent`는 함께 지정할 수 없습니다.

`session_id`, `turn_id`, `instance`, `execution_id`, `input_id`는 각각 다른 범위를 나타냅니다. 하위 실행의 직접 원인은 `parent_execution_id`, 승인 작업에서 시작한 실행의 원인은 `operation_id`입니다. 직렬화되는 필드는 camelCase를 유지합니다.

`runtime.py`는 일치한 route 분기를 동시에 실행합니다. stateful fan-in은 출발 집합의 실행과 대기 입력이 끝난 뒤 route 선언 순서로 메시지를 합쳐 한 번 실행하고, stateless 에이전트는 도달한 입력마다 독립 실행합니다. 함수 노드는 인스턴스와 대기열 없이 메시지 배열을 변환하고 `route.function` 저널 이벤트를 기록합니다. `$output` route가 없거나 일치하지 않아도 턴은 빈 `outputs`로 성공할 수 있습니다.

## 저널과 승인 작업

세션마다 append 전용 저널 스트림 하나를 둡니다. `Store`는 `append`, `scan`, `head`, `watch`, `acquire_lease`, `delete_session`을 제공하고, 런타임은 `expected`, `write_id`, 임대와 펜싱 토큰으로 상태 변경을 보호합니다. 대화, 승인 작업, 턴과 에이전트 실행 상태는 `fold`의 결과입니다.

현재 지원 범위는 세션당 활성 작성자 하나입니다. 만료되는 임대는 모델 호출, 도구 호출과 승인 대기를 포함한 턴 전체에서 갱신하고, 갱신을 잃으면 실행을 끝낸 뒤 늦은 쓰기를 펜싱으로 거부합니다.

승인 작업의 공개 요청은 `operations.list`와 `operations.decide`입니다. 작업 알림은 `operation.*` 저널·실행 이벤트로 전달하고, 완료 입력은 대상 인스턴스의 입력 대기열에 넣습니다. 세션을 처음 열 때 저널을 재생하여 열린 실행과 턴을 정리하고 승인된 작업과 완료 전달을 자동으로 복구합니다. `inputPatch`는 결정할 때와 실행 직전에 현재 도구 입력 스키마로 검사합니다.

## 훅과 구현 규약

훅 시점은 `onInput`, `onPrompt`, `onStep`, `onModelInput`, `onModelResult`, `onToolCall`, `onToolResult`, `onOutput`, `onError`입니다. `onPrompt` 결과와 `onStep`의 대화 변경은 저널에 기록하고, `onModelInput` 변경은 해당 모델 호출에만 적용합니다.

도구 구현은 내용 부분 배열, `content`를 가진 결과 매핑, 그 밖의 JSON 값 가운데 하나를 반환합니다. 런타임은 `callId`, `name`, `args`를 실행한 호출의 값으로 채우고 정규화한 결과를 `onToolResult`에 전달합니다.

저널 이벤트는 append 직후 같은 봉투로 실행 이벤트 수신자에게 전달합니다. 저장하지 않는 진행 이벤트는 `observational: true`를 가집니다. 에이전트 실행은 `agent.*`, 군단 턴은 `turn.*` 이벤트를 사용합니다.

Python 공개 이름에는 snake_case를 사용합니다. 직렬화되는 메시지, 모델 입력, 도구 호출, 결과, 저널 이벤트와 오류 필드에는 camelCase를 사용합니다.

## 의존성과 패키징

런타임 자체는 Jinja2와 PyYAML만 요구합니다. `goondan.models`는 요청을 httpx로 보내므로 `goondan[models]` 선택 의존성으로 설치합니다.

휠은 `[tool.hatch.build.targets.wheel]`이 결정합니다. 패키징을 바꿨으면 `uv build --wheel`로 만든 휠의 파일 목록에 `goondan/goondan.schema.json`이 있는지 확인합니다.

## 검사

저장소 루트의 `pnpm test:python`은 `python/goondan`에서 `uv run --extra test --extra models python -m pytest`를 실행합니다. `tests/test_conformance.py`는 루트의 공통 사례를 실행하고, `tests/test_schema_sync.py`는 패키지 스키마 사본이 규격과 같은지 확인합니다. 모델 어댑터 검사는 실제 제공자를 호출하지 않습니다.
