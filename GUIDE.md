# Goondan 사용 가이드

## 설치와 검증

Node.js 18 이상과 pnpm을 준비합니다.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

샘플 구성을 확인하려면 다음 명령을 사용합니다.

```bash
pnpm gdn validate ./samples/smoke-test
pnpm gdn config ./samples/smoke-test
```

## 최소 구성

```yaml
agents:
  assistant:
    model: default
    systemMessage:
      text: 친절하고 정확하게 답하세요.
flow: assistant
```

`version`과 `name`은 각각 `1`과 `goondan`을 기본값으로 사용합니다. `flow`를 생략하면 첫 번째 에이전트가 진입점이 됩니다. 모델과 도구는 YAML에서 코드를 불러오지 않고 호스트가 등록한 이름으로 연결합니다. `params`와 확장의 `options`는 사용자 JSON으로 보존됩니다.

## 에이전트 구성 재사용

```yaml
agents:
  base:
    model: default
    tools: [search, write]
    extensions:
      audit: {}
    hooks:
      modelInput:
        - name: trim-context
          fn: trimContext

  editor:
    inherit: base
    remove:
      tools: [search]
      extensions: [audit]
      hooks:
        modelInput: [trim-context]
    systemMessage:
      text: 원고를 간결하게 편집하세요.

flow: editor
```

`inherit`는 부모 에이전트 하나를 지정합니다. 객체는 재귀 병합하고 배열은 자식 값으로 교체합니다. `remove`는 합성된 도구, 확장과 단계별 훅을 이름으로 제거합니다.

## 여러 에이전트 실행

```yaml
agents:
  analyst:
    model: default
  editor:
    model: default
flow: [analyst, editor]
```

배열형 `flow`는 앞 에이전트의 출력을 다음 에이전트의 입력으로 전달하고 마지막 에이전트의 출력 하나를 반환합니다. 조건 분기와 전달 변환이 필요하면 `flow.in`과 `flow.routes`를 사용합니다.

## 실행

```bash
pnpm gdn run ./goondan.yaml --bindings ./bindings.mjs
pnpm gdn chat --config ./goondan.yaml --bindings ./bindings.mjs
```

TypeScript 바인딩은 Node 호스트에서, Python 바인딩은 Python 호스트에서 등록합니다. `gdn chat`은 로컬 세션, 터미널 입출력과 취소를 관리합니다.

구성·훅·도구·승인의 정확한 의미는 [코어 런타임 계약](docs/specs/core-runtime.md), CLI 동작은 [CLI 계약](docs/specs/cli.md)을 확인하세요.
