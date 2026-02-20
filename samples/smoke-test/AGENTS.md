# samples/smoke-test

`smoke-test`는 Goondan 전체 스택의 최소 동작 검증을 위한 검증용 샘플이다.

## 존재 이유

- 실제 LLM API 호출(Anthropic claude-sonnet-4-5)이 번들 로딩부터 응답 수신까지 정상 동작하는지 빠르게 확인한다.
- CLI connector를 통한 stdin 이벤트 라우팅, 런타임 이벤트 기록, TraceContext 포함 여부를 회귀 검증한다.

## 구조적 결정

1. 도구/확장 없이 순수 LLM 응답만 검증한다.
이유: 변수를 최소화하여 코어 런타임 경로(번들 로드 -> 이벤트 라우팅 -> LLM 호출 -> 메시지 저장 -> 이벤트 기록)만 검증하기 위해.
2. 단일 에이전트, 단일 Swarm으로 구성한다.
이유: 멀티 에이전트 상호작용은 brain-persona 샘플이 담당하므로 이 샘플은 가장 단순한 경로에 집중.

## 실행 방법

```bash
cd samples/smoke-test
gdn package install
echo '{"name":"stdin_message","text":"What is 2+2?"}' | gdn run --foreground
```

## 참조

- `samples/smoke-test/goondan.yaml`
- `docs/specs/runtime.md`
- `docs/specs/connector.md`
