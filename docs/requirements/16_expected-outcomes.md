## 16. 기대 효과

1. **프로세스 격리로 안정성 향상**: Process-per-Agent 모델로 개별 에이전트 크래시가 다른 에이전트에 영향을 미치지 않으며, Orchestrator가 자동 재스폰하여 시스템 가용성을 높인다.

2. **Bun 네이티브 성능**: Bun 런타임 전용 설계로 빠른 프로세스 기동, 네이티브 TypeScript 지원, 효율적인 IPC를 활용하여 에이전트 스웜의 전체 성능을 개선한다.

3. **미들웨어 단순화로 개발 생산성 향상**: 기존 13개 파이프라인 포인트(Mutator + Middleware)를 3개 미들웨어(turn/step/toolCall)로 통합하여, Extension 개발자의 학습 곡선을 낮추고 코드 복잡성을 줄인다. `next()` 전후로 전처리/후처리를 수행하는 일관된 패턴으로 가독성이 높아진다.

4. **Edit & Restart 단순성**: Changeset/SwarmBundleRef/Safe Point 메커니즘을 제거하고, 파일 수정 + Orchestrator 재시작이라는 직관적 모델로 대체하여 설정 변경의 복잡성을 대폭 줄인다. Watch 모드로 개발 중 자동 반영이 가능해 개발 속도가 향상된다.

5. **이벤트 소싱 메시지 모델의 이점 유지**: `NextMessages = BaseMessages + SUM(Events)` 모델로 메시지 단위 편집 유연성과 장애 복원 가능성을 동시에 확보한다. `base.jsonl` + `events.jsonl` 이원화 저장으로 Turn 중 크래시 시에도 정확한 상태 복원이 가능하다.

6. **Connector/Connection 분리로 독립적 진화**: Connector가 별도 프로세스로 프로토콜을 자체 관리하므로, 프로토콜 구현과 배포 바인딩을 독립적으로 발전시킬 수 있다. Connection은 라우팅과 인증 바인딩에만 집중한다.

7. **리소스 Kind 축소로 인지 부하 감소**: 11종에서 8종으로 축소하여(OAuthApp, ResourceType, ExtensionHandler 제거) 개발자가 파악해야 할 개념의 수를 줄인다. OAuth는 Extension 내부 구현으로 이동하여 필요한 Extension만 다루면 된다.

8. **도구 이름 규칙 표준화**: `{리소스명}__{하위도구명}` 더블 언더스코어 규칙으로 도구의 소속과 기능을 명확히 구분하며, AI SDK 호환성을 유지한다.

9. **Workspace 2-root 단순화**: 기존 3-root 분리를 2-root(프로젝트 디렉토리 + `~/.goondan/`)로 축소하여 파일 경로 관리를 단순화하고, 개발자의 프로젝트 구조 이해를 돕는다.

10. **observability 표준화 유지**: traceId, tokenUsage, latency 등 관측성 표준으로 디버깅과 비용 추적이 용이하다. 각 AgentProcess의 stdout/stderr로 로그를 직접 확인할 수 있어 로그 수집이 단순해진다.

11. **패키징 생태계 유지**: DAG 의존성, lockfile 재현성, values 병합 우선순위 등 패키징 요구사항으로 재현 가능한 배포와 생태계 확장을 지원한다.

12. **오류 UX 개선 유지**: 오류 코드 + `suggestion`/`helpUrl` 패턴으로 개발자 경험(DX)과 복구 속도를 개선한다.
