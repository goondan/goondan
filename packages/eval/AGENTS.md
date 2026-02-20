# packages/eval

AI 에이전트 시스템의 출력 품질을 정량적으로 평가하는 Eval 프레임워크.

## 핵심 책임

- 시나리오 기반 평가: `EvalScenario` 정의 → `gdn run` 실행 → LLM judge 채점 → `EvalReport` 생성
- 멀티 프로바이더 지원: anthropic/openai/google 간 provider/model 자동 치환
- gdn 프로세스 harness: 임시 디렉토리에 샘플 복사, YAML 치환, foreground 모드 실행, 결과 파싱

## 구조적 결정

- **LLM-as-judge**: 정형화된 Q&A가 아닌, rubric 기반 비정형 평가. judge는 sonnet-tier 모델 사용
- **순차 실행**: gdn 프로세스 충돌 방지를 위해 시나리오를 직렬 실행
- **YAML 정규식 치환**: YAML 파서 의존 없이 provider/model/apiKeyFrom 필드를 문자열 치환 (Model 리소스 구조가 단순하므로 충분)
- **AI SDK 직접 사용**: `@goondan/runtime`에 의존하지 않고 `ai` + provider 패키지 직접 사용 (eval은 런타임과 독립)

## 반드시 지켜야 할 규칙

- `as` 타입 단언 절대 금지 — LLM 응답 파싱 등 모든 외부 입력은 타입 가드로 검증
- AI SDK의 `generateText`에서 `maxTokens`가 아닌 `maxOutputTokens` 사용 (v6 API)
- `process.env` 접근 시 undefined 체크 필수

## 참조

- 계획 문서: `PLAN.md` (Task 2)
- AI SDK 사용 패턴: `packages/runtime/src/runner/runtime-runner.ts`
