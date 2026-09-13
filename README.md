# Goondan

Goondan은 여러 에이전트의 구성과 실행을 하나의 YAML 계약으로 표현하는 런타임입니다. TypeScript와 Python 구현은 같은 구성과 conformance fixture를 공유하며, 각 언어의 호스트 프로세스에서 직접 실행됩니다.

## 구성 요소

- `packages/core`: TypeScript 런타임 `@goondan/core`
- `python/goondan`: Python 런타임 `goondan`
- `packages/cli`: Node 기반 `gdn` CLI와 대화형 호스트
- `spec/goondan.schema.json`: 구성 스키마
- `fixtures/conformance`: 언어 간 공통 실행 사례
- `samples`: 실행 가능한 구성 예시

## 시작하기

```bash
pnpm install
pnpm build
pnpm test
pnpm gdn validate ./samples/goondan-analysis-comparison/single
```

자세한 사용법은 [GUIDE.md](GUIDE.md), 실행 계약은 [core-runtime.md](docs/specs/core-runtime.md), 터미널 호스트 계약은 [chat-runtime.md](docs/specs/chat-runtime.md)를 확인하세요.
