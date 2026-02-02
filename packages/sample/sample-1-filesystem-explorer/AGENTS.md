# Sample 1: CLI 파일시스템 탐색 에이전트

## 개요

이 샘플은 Goondan을 사용한 가장 기본적인 CLI 에이전트 구현 예시입니다.

## 디렉터리 구조

```
sample-1-filesystem-explorer/
├── bundle.yaml           # 번들 매니페스트
├── goondan.yaml          # 에이전트/스웜/커넥터 설정
├── prompts/              # 시스템 프롬프트
│   └── explorer.system.md
├── src/
│   └── tools/
│       └── filesystem/   # 파일시스템 도구
│           ├── index.ts  # 핸들러 구현
│           └── tool.yaml # 도구 정의
└── dist/                 # 빌드 산출물 (Git 커밋)
```

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `goondan.yaml` | Agent, Swarm, Connector 정의 |
| `bundle.yaml` | 번들 의존성 및 include 목록 |
| `src/tools/filesystem/index.ts` | fs.* 도구 핸들러 |
| `prompts/explorer.system.md` | 에이전트 시스템 프롬프트 |

## 수정 시 주의사항

1. **도구 핸들러 수정**: `src/tools/filesystem/index.ts` 수정 후 반드시 `pnpm build`
2. **도구 정의 수정**: `tool.yaml` 수정 시 exports 이름과 핸들러 키가 일치해야 함
3. **프롬프트 수정**: `prompts/*.md` 수정은 빌드 없이 즉시 반영
4. **의존성 추가**: `bundle.yaml`의 dependencies에 번들 참조 추가

## 빌드 및 테스트

```bash
# 빌드
pnpm build

# 검증
pnpm validate

# 실행
ANTHROPIC_API_KEY=... pnpm run
```

## 연관 문서

- `/GUIDE.md` - 전체 가이드
- `/goondan_spec.md` - 스펙 문서
- `/packages/base/AGENTS.md` - base 번들 구조
