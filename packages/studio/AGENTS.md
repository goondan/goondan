# @goondan/studio

`packages/studio`는 Goondan Studio 웹 UI 패키지입니다.

## 책임 범위

- React + Vite 기반 SPA (Single Page Application)
- `gdn studio` 명령이 제공하는 런타임 관측 시각화 UI 구현
- Graph 모드: @xyflow/react(React Flow) + dagre 자동 레이아웃 기반 에이전트/커넥터 노드 그래프, 줌/팬/미니맵/컨트롤, 간선 클릭으로 이력 확인, 실시간 활성 애니메이션
- Flow 모드: 참여자 레인 기반 시퀀스 다이어그램, Tool 호출 인라인 스텝 표시, 아크 화살표
- Flyout (오른쪽 드로어): 간선 이력(Edge History) 상세 조회, 스크림 오버레이
- 1초 주기 폴링으로 인스턴스/시각화 데이터 실시간 반영
- 빌드 시 Vite 결과물을 단일 HTML로 인라인(`scripts/embed.mjs`)하여 `packages/cli/src/studio/assets.ts`에 자동 생성

## 주요 라이브러리

| 라이브러리 | 용도 |
|---|---|
| `@xyflow/react` (React Flow v12) | Graph 뷰 — 노드 그래프 시각화, 줌/팬/미니맵/컨트롤 |
| `@dagrejs/dagre` | Graph 뷰 — 방향 그래프 자동 레이아웃 (LR/TB) |
| `clsx` | className 조합 유틸리티 |
| `date-fns` | 날짜/시간 포맷팅 (tree-shakeable) |

## 아키텍처

```
src/
├── main.tsx                         # React 엔트리
├── App.tsx                          # 메인 레이아웃 + 상태 관리 + ReactFlowProvider
├── App.css                          # 전역 스타일 + React Flow 다크 테마 오버라이드
├── types.ts                         # 프론트엔드 타입 정의
├── api.ts                           # fetch 래퍼 (/api/instances, /api/instances/:key/visualization)
├── components/
│   ├── Sidebar.tsx                  # 좌측 인스턴스 목록 패널
│   ├── TopBar.tsx                   # 상단 타이틀/모드 토글 바
│   ├── GraphView.tsx                # React Flow 기반 Graph 시각화 (dagre 레이아웃)
│   ├── FlowView.tsx                 # SVG 기반 Flow 시퀀스 다이어그램
│   ├── Flyout.tsx                   # 오른쪽 플라이아웃 드로어 + Edge History
│   └── nodes/
│       └── ParticipantNode.tsx      # React Flow 커스텀 노드 (agent/connector 구분)
├── hooks/
│   └── useStudioData.ts             # 데이터 폴링/상태 관리 커스텀 훅
└── utils/
    ├── format.ts                    # date-fns 기반 타임스탬프 포맷 유틸
    └── layout.ts                    # dagre 기반 그래프 레이아웃 계산
scripts/
└── embed.mjs                        # Vite 빌드 → CLI assets.ts 자동 생성
```

## 빌드 규칙

1. `pnpm build`는 `vite build && node scripts/embed.mjs`를 수행합니다.
2. `scripts/embed.mjs`는 Vite 빌드 결과(`dist/index.html` + CSS/JS)를 단일 HTML로 인라인하여 `packages/cli/src/studio/assets.ts`에 `STUDIO_HTML` 상수로 생성합니다.
3. `packages/cli` 빌드 전에 반드시 `packages/studio` 빌드가 선행되어야 합니다.
4. `pnpm dev`로 Vite dev server 실행 시 `/api/*` 요청은 `http://localhost:3000`으로 프록시됩니다 (`gdn studio --port 3000` 병행 필요).

## 구현 규칙

1. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 명시 타입으로 구현합니다.
2. 이 패키지는 `private: true`이며 npm에 배포하지 않습니다.
3. API 응답 타입은 `src/types.ts`에 정의하며 CLI 서비스의 응답 스키마와 동기화합니다.
4. 컴포넌트는 함수형 + hooks 패턴으로 구현합니다.
5. Graph 뷰의 레이아웃 캐시는 `structureKey`(participant/interaction ID 기반)로 관리하여 폴링 시 불필요한 재계산을 방지합니다.
6. React Flow의 `colorMode="dark"` 속성을 사용하고, 추가 다크 테마 오버라이드는 `App.css`에서 관리합니다.
