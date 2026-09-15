export {};

declare module "nunjucks" {
  /**
   * Nunjucks exposes its template parser at runtime but does not declare it. The parsed tree is
   * `unknown` on purpose: `template-syntax.ts` walks it with type guards and rebuilds the typed
   * template AST this package uses, so no part of the untyped tree leaks into the runtime.
   */
  export const parser: {
    parse(source: string, extensions?: readonly unknown[], options?: { trimBlocks?: boolean; lstripBlocks?: boolean }): unknown;
  };
}
