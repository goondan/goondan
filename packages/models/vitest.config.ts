import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The adapters import @goondan/core for types only. The end-to-end runtime test
// runs against the core sources so the suite does not depend on a prior core build.
export default defineConfig({
  resolve: {
    alias: {
      "@goondan/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
