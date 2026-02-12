import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRegistryNodeServer } from "../src/server.js";

export interface TestRegistryServer {
  url: string;
  token: string;
  close: () => Promise<void>;
}

export async function startTestRegistryServer(tokens: string[] = ["test-token"]): Promise<TestRegistryServer> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "goondan-registry-"));
  const server = createRegistryNodeServer({
    storageRoot,
    authTokens: tokens,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unable to resolve registry server address");
  }

  const { port } = address;
  const url = `http://127.0.0.1:${port}`;
  const token = tokens[0] ?? "";

  return {
    url,
    token,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });

      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
