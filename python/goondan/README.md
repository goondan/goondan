# goondan

Goondan은 에이전트 구성과 연결을 YAML로 선언하고, TypeScript와 Python 호스트가 같은 구성을 같은 의미로 실행하는 런타임입니다. 이 패키지는 그 Python 호스트입니다.

실행 의미는 [`spec/goondan.md`](https://github.com/goondan/goondan/blob/main/spec/goondan.md)가 규범으로 정하고, 두 호스트가 같은 기대 결과로 통과해야 하는 공통 실행 사례로 검증합니다.

## 설치

```bash
pip install goondan
```

공식 Anthropic·OpenAI 어댑터를 함께 쓰려면 `models` 추가 의존을 설치합니다.

```bash
pip install "goondan[models]"
```

## 사용

YAML에는 에이전트와 연결, 그리고 모델·도구·함수·확장의 **이름**만 선언합니다. 이름에 해당하는 구현은 호스트가 주입합니다.

```yaml
# goondan.yaml
name: hello
agents:
  assistant:
    model: main
    systemMessage: 질문에 짧게 답합니다.
routes: [assistant]
```

```python
import asyncio
from goondan import create_goondan, load_config
from goondan.models import anthropic_model


async def main():
    goondan = create_goondan(
        config=load_config("."),
        models={"main": anthropic_model(model="claude-sonnet-5")},
    )
    try:
        run = await goondan.run("Goondan을 설명해 주세요.", session_id="example")
        result = await run.result
        print(result["output"])
    finally:
        await goondan.close()


asyncio.run(main())
```

`run`은 입력이 세션 저널에 기록되면 실행 핸들을 돌려줍니다. 핸들의 `session_id`, `turn_id`, `input_id`로 진행을 추적하고, 결과가 필요할 때 `result`를 기다립니다.

## 범위

런타임의 책임은 모델 루프, route 실행, 입력 대기열, 저널, 승인 작업과 취소입니다. 도구는 호스트 프로세스 안에서 실행되는 함수이며, 런타임은 샌드박스, 자격 증명 관리, 비용 통제와 관측 백엔드를 제공하지 않습니다. 격리가 필요하면 호스트가 도구 구현 바깥에 연결합니다.

## 문서

- [저장소와 README](https://github.com/goondan/goondan#readme)
- [실행 규격](https://github.com/goondan/goondan/blob/main/spec/goondan.md)
- [모델 어댑터 규격](https://github.com/goondan/goondan/blob/main/spec/model-adapters.md)

## 라이선스

Apache-2.0
