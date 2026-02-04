## 부록 A. 실행 모델 및 훅 위치 다이어그램

### A-1. Instance → Turn → Step 라이프사이클과 파이프라인 포인트(ASCII)

```
[External Event via Connector]
          │
          ▼
   [SwarmInstance (instanceKey)]
          │
          ▼
   [AgentInstance Event Queue]
          │  (dequeue 1 event)
          ▼
     ┌───────────────┐
     │   Turn Start   │
     └───────────────┘
          │
          │ turn.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │            Step Loop (0..N)           │
   └───────────────────────────────────────┘
          │
          │ step.pre        (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.config     (Mutator)             │
   │  - activate SwarmBundleRef + load cfg │
   └───────────────────────────────────────┘
          │
          │ step.tools      (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.tools      (Mutator)             │
   │  - build/transform Tool Catalog       │
   └───────────────────────────────────────┘
          │
          │ step.blocks     (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ step.blocks     (Mutator)             │
   │  - build/transform Context Blocks     │
   └───────────────────────────────────────┘
          │
          │ step.llmCall    (Middleware)
          ▼
   ┌───────────────────────────────────────┐
   │ step.llmCall    (Middleware onion)    │
   │  EXT.before → CORE LLM → EXT.after    │
   └───────────────────────────────────────┘
          │
          ├──── tool calls exist? ────┐
          │                           │
          ▼                           ▼
 (for each tool call)            (no tool call)
          │
          │ toolCall.pre   (Mutator)
          ▼
   ┌───────────────────────────────────────┐
   │ toolCall.exec   (Middleware onion)    │
   │  EXT.before → CORE exec → EXT.after   │
   └───────────────────────────────────────┘
          │
          │ toolCall.post  (Mutator)
          ▼
          │ step.post      (Mutator)
          ▼
     ┌───────────────────────┐
     │ Continue Step loop?   │
     └───────────────────────┘
          │yes                      │no
          └───────────┐             └─────────────┐
                      ▼                           ▼
                  (next Step)               turn.post (Mutator)
                                                │
                                                ▼
                                             Turn End
                                                │
                                                ▼
                                        wait next event…
```
