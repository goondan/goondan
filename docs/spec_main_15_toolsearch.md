## 15. 대표 도구 패턴: ToolSearch

ToolSearch는 LLM이 tool catalog를 탐색/요약할 수 있도록 제공되는 **Tool**이다.
ToolSearch는 “다음 Step부터 사용할 도구/확장/프롬프트 변경”이 필요할 때, 도구 카탈로그를 로드 하는 시점에 도구 목록을 조작하여 검색된 도구를 추가한다.
