# @goondan/cli

[Goondan](https://github.com/goondan/goondan) 런타임의 명령줄 호스트입니다. `goondan.yaml`을 그 자리에서 실행하고, 유효 구성을 확인하고, 터미널에서 군단과 대화합니다.

## 설치

```bash
npm install -g @goondan/cli
```

## 명령

```bash
gdn config .                                  # 합성·상속을 마친 유효 구성 출력
gdn run . --bindings ./bindings.ts --input "설명해 주세요."
gdn chat --config . --bindings ./bindings.ts  # 대화형 호스트
```

`config`는 읽기·스키마·참조 검사를 거친 유효 구성을 출력합니다.

`run`은 `--input`을 JSON으로 해석할 수 있으면 JSON 값으로, 아니면 문자열로 실행합니다. `--input-file`도 같은 규칙이고, 둘 다 생략하면 표준 입력을 읽습니다. `--session-id`로 세션을, `--agent`로 단독 실행할 에이전트를 지정합니다.

`chat`은 `--session`으로 세션을 이어 가고 세션마다 JSONL 저널 파일 하나를 씁니다(기본 위치 `~/.goondan/chat/sessions`). 실행 중에 입력하면 현재 턴에 합류하고, `/operations`·`/approve`·`/reject`로 승인 작업을 다루며, `/interrupt`로 턴을 중단합니다.

## 주의

바인딩을 생략한 `chat`은 공식 모델 어댑터와 함께 파일·셸 도구를 켭니다. 이 도구는 `--cwd` 밖의 경로에 접근하고 셸 명령을 실행할 수 있습니다. 런타임은 샌드박스를 제공하지 않으므로, 신뢰 경계에 맞는 별도 프로세스나 샌드박스에서 실행해야 합니다.

모델 요청과 셸 실행에는 기본 시간 제한이 없습니다.

## 문서

- [저장소와 README](https://github.com/goondan/goondan#readme)
- [실행 규격](https://github.com/goondan/goondan/blob/main/spec/goondan.md)

## 라이선스

Apache-2.0
