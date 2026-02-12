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
