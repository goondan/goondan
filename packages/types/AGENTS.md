# @goondan/types

This directory owns the shared type system for Goondan v2.

## Scope

- Implement SSOT contracts from `docs/specs/shared-types.md`.
- Implement config resource contracts from `docs/specs/resources.md`.
- Keep API-facing compatibility with `docs/specs/api.md` and `docs/specs/help.md`.

## Rules

1. Keep changes inside `packages/types/**`.
2. Do not use type assertions (`as`, `as unknown as`).
3. Keep source in `src/` and tests in `test/`.
4. Every behavior change must include or update tests.
5. Utility behavior must follow:
   - ObjectRef parsing: `Kind/name`
   - ValueSource resolution: `value`, `valueFrom.env`, `valueFrom.secretRef`
   - Message state fold: `NextMessages = BaseMessages + SUM(Events)`
   - IPC and ProcessStatus guards
6. npm 공개 배포를 유지하려면 `package.json`의 `publishConfig.access = "public"`을 유지한다.

## Source Files

| File | Responsibility |
|------|----------------|
| `src/json.ts` | JSON primitive types (`JsonPrimitive`, `JsonValue`, `JsonObject`, `JsonArray`) + `isJsonValue`, `isPlainObject` guards |
| `src/references.ts` | ObjectRef, RefItem, Selector, SelectorWithOverrides, RefOrSelector types + parse/format/guard functions (`isObjectRef`, `isObjectRefLike`, `isRefItem`, `isSelectorWithOverrides`, `isRefOrSelector`) |
| `src/value-source.ts` | ValueSource, ValueFrom, SecretRef types + `resolveValueSource`, `isSecretRefPath` |
| `src/message.ts` | CoreMessage (local), MessageSource, Message, MessageEvent, ConversationState + `applyMessageEvent`, `foldMessageEvents`, `createConversationState` |
| `src/events.ts` | EventEnvelope, EventSource, ReplyChannel, TurnAuth, AgentEvent, ProcessStatus, IpcMessage, ShutdownReason + guards (`isEventEnvelope`, `isReplyChannel`, `isAgentEvent`, `isProcessStatus`, `isIpcMessage`, `isIpcMessageType`, `isShutdownReason`) |
| `src/connector.ts` | ConnectorEventMessage, ConnectorEvent, ConnectorContext types + `isConnectorEventMessage`, `isConnectorEvent` guards (SSOT: docs/specs/connector.md 5.2-5.3절) |
| `src/tool.ts` | ExecutionContext, ToolCall, ToolCallResult, ToolContext, ToolHandler |
| `src/turn.ts` | TurnResult |
| `src/resources.ts` | Resource, KnownKind (8종), TypedResource, all Kind-specific spec interfaces (ModelSpec, AgentSpec, SwarmSpec, ToolSpec, ExtensionSpec, ConnectorSpec, ConnectionSpec, PackageSpec), typed resource aliases, ValidationError + guards (`isKnownKind`, `isResource`, `isGoodanResource`, `isModelResource`, `isAgentResource`, `isSwarmResource`, `isToolResource`, `isExtensionResource`, `isConnectorResource`, `isConnectionResource`, `isPackageResource`) |
| `src/index.ts` | Barrel re-export of all modules |
