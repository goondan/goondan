# 대화형 CLI 런타임

`gdn chat`은 터미널 입력·출력과 로컬 세션을 소유하는 Node 호스트입니다. 모델·도구 반복, 구성 해석, 훅과 저장 시점은 [코어 런타임 계약](core-runtime.md)을 따릅니다.

## 실행

```bash
pnpm build
pnpm gdn chat
pnpm gdn chat --config ./goondan.yaml --bindings ./bindings.mjs
```

`--model`은 기본 모델 이름, `--cwd`는 로컬 도구의 작업 디렉터리, `--session`은 이어갈 대화 식별자, `--state-dir`은 세션 저장 위치를 지정합니다. `--final-only`는 중간 텍스트를 숨기고 최종 출력만 표시합니다.

유휴 상태의 입력은 새 턴을 시작합니다. 실행 중 입력은 같은 대화의 `steer` 입력으로 전달합니다. `/interrupt`와 실행 중 Ctrl+C는 현재 실행을 취소하고 입력 대기로 돌아가며, `/quit`은 런타임을 정리하고 종료합니다. 세션 파일은 원자적으로 교체하며 같은 식별자로 재실행하면 대화를 복원합니다.

기본 호스트는 Router 모델과 `read_file`, `write_file`, `list_dir`, `bash` 도구를 제공합니다. 도구는 `--cwd`를 경로 기준으로 사용하고 CLI 사용자의 OS 권한으로 실행합니다.
