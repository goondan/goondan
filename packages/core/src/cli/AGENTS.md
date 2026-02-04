# packages/core/src/cli

core CLI 엔트리입니다.

## 주요 파일
- index.ts: run/validate/bundle 명령 처리

## 참고 사항
- dist/cli/index.js로 빌드되어 bin으로 노출됩니다.
- bundle 서브커맨드: add/remove/enable/disable/info/validate/verify/lock/verify-lock/refresh/list
- export 명령은 Bundle+Config 리소스를 YAML/JSON으로 출력합니다.
- init 명령은 기본 goondan.yaml 템플릿을 생성합니다.
- init은 base 번들을 Git Bundle로 자동 등록합니다(기본 state root: `~/.goondan`, override: `GOONDAN_STATE_ROOT`).
- run은 TTY에서 대화형 입력을 지원합니다(:exit로 종료).
- 대화형 입력은 @inquirer/prompts 기반입니다.
- CLI 파싱은 optique 기반입니다.
