# goondan Python 패키지

이 패키지는 Goondan 구성 파일을 Python 프로세스에서 직접 실행합니다. 공개 인터페이스와 실행 동작은 TypeScript의 `@goondan/core`, `spec/goondan.schema.json`, `fixtures/conformance/`와 같은 의미를 유지합니다.

## 모듈

`goondan/` 패키지는 TypeScript `packages/core/src`와 같은 단위로 모듈을 나눕니다. 이름이 밑줄로 시작하는 모듈은 패키지 내부용이며, 호스트가 쓰는 이름은 `__init__.py`가 다시 내보냅니다.

| 모듈 | 소유 범위 |
|---|---|
| `types.py` | 공개 데이터클래스, 프로토콜, 타입 별칭, `HookContext`와 `ModelContext`, 그리고 `GoondanError`, `GoondanConfigError`, `GoondanExecutionError`, `GoondanAbortError` |
| `_json.py` | 패키지 전체가 함께 쓰는 JSON 텍스트 직렬화. `JSON.stringify`와 같은 결과를 내도록 수 표기는 ECMAScript `Number::toString`을 따르고 문자열은 ASCII로 이스케이프하지 않습니다. |
| `_yaml.py` | YAML 해석 규칙, 중복 키·앵커·별칭 판정, `YamlDocumentError` |
| `_schema.py` | `goondan.schema.json` 해석기, 스키마 단계 검사, 오류 항목의 정렬과 JSON Pointer 렌더링 |
| `_values.py` | 단계 값의 형식 판정, 제어 결과, 메시지 추가와 중복 제거, 출력과 도구 결과의 텍스트 |
| `config.py` | YAML 로딩, `extends`와 `resources` 합성, variant, 상속과 제거, 참조와 바인딩 단계 검사 |
| `template.py` | 미리 읽은 맵만 쓰는 렌더러, 구성을 읽을 때 확정하는 정적 `include` 닫힘, 렉서 통과와 AST 허용 목록으로 강제하는 공통 식 문법 |
| `store.py` | 메모리 대화 저장소와 메모리 작업 저장소 |
| `runtime.py` | `Goondan`과 `create_goondan`, 확장 인스턴스, 값별 훅, 모델과 도구 반복, 병렬 route와 fan-in, 세션과 작업 실행 |
| `goondan.schema.json` | `spec/goondan.schema.json`의 패키지 사본. `_schema.py`가 `importlib.resources`로 읽습니다. |
| `models/` | Anthropic과 OpenAI 공식 모델 어댑터. 규칙과 모듈 구성은 `goondan/models/AGENTS.md`를 따릅니다. |

모듈은 순환 없이 한 방향으로 가져옵니다. `_schema.py`와 `store.py`는 패키지의 다른 모듈을 가져오지 않습니다. `_json.py`는 `types.py`를, `_yaml.py`는 `_schema.py`를, `_values.py`는 `_json.py`와 `_schema.py`를, `template.py`는 `_json.py`, `_schema.py`, `types.py`를 가져옵니다. `config.py`는 `_schema.py`, `_yaml.py`, `types.py`를 가져오고 `template.py`는 템플릿을 읽을 때만 지연 가져오기로 씁니다. `runtime.py`는 `_schema.py`, `_values.py`, `config.py`, `store.py`, `template.py`, `types.py`를 가져옵니다. `types.py`는 `Goondan` 타입 표기용 `TYPE_CHECKING` 가져오기와 오류 메시지를 만들 때의 지연 가져오기 외에는 다른 모듈을 가져오지 않습니다. `models/`는 코어 모듈 가운데 `types.py`와 `_json.py`만 가져오므로 어댑터를 설치하지 않아도 런타임은 그대로 동작합니다.

## 실행 범위와 호스트 API

군단 객체는 에이전트를 선언 이름으로 식별합니다. `stateful: true`인 에이전트는 세션 식별자와 에이전트 이름의 조합마다 대화와 확장 인스턴스를 유지하고, `stateful: false`인 에이전트는 실행마다 빈 대화와 새 확장 인스턴스를 사용합니다. 호스트가 사용하는 이름은 `run(value, session_id=..., agent=..., start_agent=...)`, `abort`, `steer`, `idle`, `close`, `sessions.delete`이며, `agent`와 `start_agent`는 함께 지정할 수 없습니다. 구성을 읽을 때 확정한 템플릿을 그대로 렌더링하는 `render(template, variables)`도 공개합니다.

`runtime.py`는 일치한 route 분기를 동시에 실행합니다. stateful fan-in은 출발 집합의 실행과 대기 입력이 끝난 뒤 route 선언 순서로 메시지를 합쳐 한 번 실행하고, stateless 에이전트는 도달한 입력마다 독립 실행합니다. 같은 세션의 턴과 같은 파생 세션의 stateful 실행은 각각 도착 순서대로 실행합니다. `_RunRecord` 트리는 턴 결과의 `runs`와 `usage`가 되며 각 항목에 인스턴스 식별자를 기록합니다. route 오류는 에이전트 실행 밖에서 발생하므로 이벤트를 알리지 않고 `error` 단계에도 닿지 않습니다. 모델 호출은 `_call_model`이 `generate(model_input, ctx)`를 먼저 찾고 없으면 모델 입력 하나만 받는 호출 가능 객체로 부르며, `max_steps`는 그 실행 자신의 호출만 셉니다. 실패한 도구 구현의 코드는 언제나 `["tool_error"]`이고, 두 번째 코드를 붙이는 것은 모델 실패뿐입니다.

## 승인 작업

비동기 승인은 공개 `OperationStore` 계약의 상태 전이와 delivery claim을 기준으로 복구합니다. `InMemoryOperationStore`는 메모리 호스트의 기본 구현이고, 작업 기록의 시각 값은 1970-01-01T00:00:00Z부터 지난 밀리초 수입니다. 공개 요청은 `list_operations`, `decide_operation`, `cancel_operation`, `recover_operations` 네 가지입니다.

최초 도구 호출에는 `pending` 결과를 연결하고, 종결 결과는 같은 대화의 별도 `operation_completion` 입력으로 전달합니다. 승인 입력 수정은 호스트 검증을 거쳐 `inputPatch`와 `resolvedToolCall`에 기록하며 원래 `toolCall`을 보존합니다. 호스트가 completion 전달 함수를 제공하면 호스트가 안정적인 `deliveryId`로 durable inbound를 처리합니다.

## 이름과 값의 규약

Python 공개 이름에는 snake_case를 사용합니다. 직렬화되는 메시지, 모델 입력, 도구 호출, 결과와 오류의 필드 이름은 언어 중립 스펙의 camelCase를 그대로 사용합니다.

도구 구현은 내용 부분 배열, `content`를 가진 도구 결과 매핑, 그 밖의 임의 JSON 값 가운데 하나를 반환합니다. 부분 배열은 결과의 내용이 되고, 매핑은 도구 결과 자체이므로 `isError`, `keep`, `meta`가 결과에 그대로 남으며, 나머지 값은 하나의 `json` 부분이 됩니다. 어느 경우에도 `callId`, `name`, `args`는 실행한 호출의 값으로 런타임이 채우고, 만들어진 결과는 `toolResult` 훅 이전에 형식 검사를 거칩니다.

## 의존성과 패키징

런타임 자체는 Jinja2와 PyYAML만 요구합니다. `goondan.models`는 요청을 httpx로 보내므로 `goondan[models]` 선택 의존성으로 설치하며, 어댑터를 쓰지 않는 호스트는 설치하지 않아도 됩니다. `test` 선택 의존성은 `goondan[models]`를 포함하므로 httpx 버전 범위는 `models` 한 곳에만 둡니다.

휠은 `[tool.hatch.build.targets.wheel]`이 결정합니다. `packages`가 `goondan` 패키지를 담고, `artifacts`가 `goondan/goondan.schema.json`을 명시해 `_schema.py`가 읽는 스키마를 항상 함께 싣고, `exclude`가 `AGENTS.md`를 뺍니다. 패키징을 바꿨으면 `uv build --wheel`로 만든 휠의 파일 목록에 `goondan/goondan.schema.json`이 있는지 확인합니다.

## 검사

저장소 루트의 `pnpm test:python`은 `python/goondan`에서 `uv run --extra test --extra models python -m pytest`를 실행합니다. 같은 명령을 직접 실행해도 됩니다.

`tests/test_conformance.py`는 루트의 모든 공통 검사 사례를 자동으로 읽으므로 사례가 추가되면 Python 검사에도 바로 포함됩니다. `tests/test_schema_sync.py`는 패키지 사본이 `spec/goondan.schema.json`과 바이트 단위로 같은지 확인하므로, 스펙 스키마를 고쳤으면 루트에서 `pnpm schema:sync`로 사본을 갱신합니다. `tests/test_models_*.py`는 어댑터를 다루며 실제 제공자를 호출하지 않습니다.
