export interface AnonymousSessionCleanupStore {
  cleanupExpired(before: Date): Promise<number>;
  expirePendingProposals?(before: Date): Promise<number>;
}

export class AnonymousSessionCleanupJob {
  constructor(
    private readonly store: AnonymousSessionCleanupStore,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async runOnce(): Promise<{ deleted: number }> {
    const before = this.clock.now();
    await this.store.expirePendingProposals?.(before);
    return { deleted: await this.store.cleanupExpired(before) };
  }
}
