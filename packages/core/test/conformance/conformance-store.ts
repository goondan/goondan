import { MemoryStore, type StoreLease } from "../../src/index.ts";

/** Fault injection for the shared lease-renewal cases. */
export class FixtureStore extends MemoryStore {
  readonly #renewals = new Map<string, boolean>();

  leaseRenewal(sessionId: string, succeeds: boolean): void {
    this.#renewals.set(sessionId, succeeds);
  }

  override async acquireLease(sessionId: string, owner: string): Promise<StoreLease | null> {
    const held = await super.acquireLease(sessionId, owner);
    if (!held || !this.#renewals.has(sessionId)) return held;
    const lease: StoreLease = {
      token: held.token,
      expiresAt: Date.now() + 100,
      renew: async () => {
        if (!this.#renewals.get(sessionId)) { await held.release(); return false; }
        if (!await held.renew()) return false;
        lease.expiresAt = Date.now() + 100;
        return true;
      },
      release: () => held.release(),
    };
    return lease;
  }
}
