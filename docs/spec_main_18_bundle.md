## 18. Bundle(구성+코드 번들) 및 Bundle 리소스(선택)

Bundle은 YAML + 소스코드(프롬프트/툴/확장/커넥터 구현)를 함께 담는 폴더 트리이며, SwarmBundle은 Swarm을 정의하는 Bundle이다.

(기존 v0.8의 Bundle(확장 묶음) 설명은 “Bundle을 Git 기반으로 받아 include로 리소스 YAML을 합치는 방식”으로 그대로 유지할 수 있다.
필요하면 여기서 `kind: Bundle` 리소스를 사용해 의존 번들을 조립하는 메커니즘을 제공한다.)
