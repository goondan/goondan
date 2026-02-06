# Multi-Model - 여러 LLM 조합

여러 LLM 제공자의 모델을 조합하여 작업 성격에 맞는 에이전트에게 위임하는 샘플입니다.

## 아키텍처

```
사용자 입력
    |
  Router (Anthropic Claude)
    |
    +--- 창작 요청 ---> Creative Writer (OpenAI GPT-4o, temp: 0.9)
    |
    +--- 분석 요청 ---> Analyst (Anthropic Claude, temp: 0.2)
```

## 구성

| 리소스 | 이름 | 모델 | 역할 |
|--------|------|------|------|
| Model | `anthropic-model` | Claude Sonnet 4.5 | 라우팅/분석 |
| Model | `openai-model` | GPT-4o | 창작 |
| Agent | `router` | Anthropic | 요청 분류 및 위임 |
| Agent | `creative-writer` | OpenAI | 창작/글쓰기 |
| Agent | `analyst` | Anthropic | 분석/추론 |

## 환경 변수

```bash
# Anthropic API 키
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI API 키
export OPENAI_API_KEY="sk-..."
```

## 실행

```bash
gdn run
```

## 사용 예시

```
> 크리스마스를 주제로 감성적인 시를 써줘
(creative-writer에게 위임)

> 한국과 일본의 IT 산업을 비교 분석해줘
(analyst에게 위임)

> 안녕하세요!
(router가 직접 응답)
```
