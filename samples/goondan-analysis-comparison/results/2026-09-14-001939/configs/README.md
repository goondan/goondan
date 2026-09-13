# Goondan 저장소 분석 비교 실험

이 샘플은 같은 저장소 분석을 다음 두 조건으로 실행하여 최종 보고서의 전달력을 비교합니다.

| 조건 | 구성 | 최종 출력 |
|---|---|---|
| 단일 분석 | `single/goondan.yaml` | 분석 에이전트의 보고서 |
| 분석 후 편집 | `edited/goondan.yaml` | 분석 결과를 다듬은 편집 에이전트의 보고서 |

두 조건은 `common/goondan.yaml`의 분석 에이전트 정의와 `prompt.txt`의 입력을 함께 사용합니다. 분석 에이전트는 `read_file`, `list_dir`, `bash`를 사용할 수 있으며 읽기 전용으로 저장소를 조사합니다. 편집 에이전트에는 도구가 없으며 앞 단계의 분석 결과만 다듬습니다. 분석 에이전트의 조사 예산은 도구 호출 12회이며, 10번째 호출까지 확보한 근거를 정리하여 반드시 보고서로 마무리합니다. 제한된 조사로 확인하지 못한 세부 사항은 추가 확인이 필요한 항목으로 보고합니다.

## 실행 조건

공정한 비교를 위해 현재 Git에서 추적하거나 무시하지 않는 소스 파일을 동일한 snapshot으로 준비합니다. 각 조건은 서로 다른 새 세션으로 실행하며 모델은 `claude-opus-5`로 고정합니다. 결과 파일은 snapshot 밖에 저장합니다.

저장소 루트에서 다음과 같이 구성을 검증합니다.

```bash
pnpm gdn validate samples/goondan-analysis-comparison/single
pnpm gdn validate samples/goondan-analysis-comparison/edited
```

`gdn chat --final-only`는 모델의 중간 스트리밍을 숨기고 flow의 최종 출력만 표준 출력으로 보냅니다. 상태 메시지는 표준 오류로 분리됩니다. 기본 chat 바인딩은 구성에 선언된 모든 `agent.model` 키를 `--model`로 선택한 모델 제공자에 연결하므로, 두 에이전트의 `comparison-model`은 모두 `claude-opus-5`로 실행됩니다. `<SNAPSHOT>`과 결과 경로를 실제 절대 경로로 바꾸어 실행합니다.

```bash
pnpm gdn chat \
  --cwd <SNAPSHOT> \
  --config samples/goondan-analysis-comparison/single \
  --model claude-opus-5 \
  --session <UNIQUE_SINGLE_SESSION> \
  --final-only \
  < samples/goondan-analysis-comparison/prompt.txt \
  > <RESULTS>/single.md

pnpm gdn chat \
  --cwd <SNAPSHOT> \
  --config samples/goondan-analysis-comparison/edited \
  --model claude-opus-5 \
  --session <UNIQUE_EDITED_SESSION> \
  --final-only \
  < samples/goondan-analysis-comparison/prompt.txt \
  > <RESULTS>/edited.md
```

두 실행에서 동일한 세션 상태가 재사용되지 않도록 실행할 때마다 새로운 `--session` 값을 지정합니다. 실행 상태도 snapshot 밖에 격리하려면 두 명령에 서로 다른 `--state-dir <RESULTS>/state/<CONDITION>`을 추가합니다. `gdn chat`은 표준 입력을 줄 단위로 처리하므로 `prompt.txt`는 한 줄 입력으로 유지합니다.

비교할 때에는 사실의 정확성과 근거 보존 여부를 먼저 확인한 뒤, 핵심 논지가 앞에서부터 자연스럽게 이어지는지, 용어와 문장이 독자의 이해를 돕는지 평가합니다.
