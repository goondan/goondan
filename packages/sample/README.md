# Goondan Sample

이 폴더는 core CLI와 base 번들을 이용해 Swarm을 실행하는 최소 예시입니다.

## 빠른 실행
1) 빌드
```
pnpm -r build
```

2) 번들 등록 없이 실행
```
node ../core/dist/cli/index.js run -c ./goondan.yaml -b ../base/bundle.yaml --mock --input "hello"
```

## 번들 등록 흐름
1) base 번들 등록
```
node ../core/dist/cli/index.js bundle add ../base/bundle.yaml --state-root ./state
```

2) 번들 상태 확인/조절
```
node ../core/dist/cli/index.js bundle info base --state-root ./state
node ../core/dist/cli/index.js bundle validate base --state-root ./state
node ../core/dist/cli/index.js bundle verify base --state-root ./state
node ../core/dist/cli/index.js bundle refresh base --state-root ./state
node ../core/dist/cli/index.js bundle lock --state-root ./state
node ../core/dist/cli/index.js bundle verify-lock --state-root ./state
node ../core/dist/cli/index.js bundle disable base --state-root ./state
node ../core/dist/cli/index.js bundle enable base --state-root ./state
```

3) 등록된 번들로 실행
```
node ../core/dist/cli/index.js run -c ./goondan.yaml --state-root ./state --mock --input "hello"
```

## config export
```
node ../core/dist/cli/index.js export -c ./goondan.yaml -b ../base/bundle.yaml --format yaml
```

## config validate (strict)
```
node ../core/dist/cli/index.js validate -c ./goondan.yaml -b ../base/bundle.yaml --strict
```
