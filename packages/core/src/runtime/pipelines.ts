type Mutator<T> = (ctx: T) => Promise<T | void> | T | void;
type Wrapper<T> = <R>(next: (ctx: T) => Promise<R>) => (ctx: T) => Promise<R>;

export class PipelineManager<T = unknown> {
  private mutators: Map<string, Mutator<T>[]>;
  private wrappers: Map<string, Wrapper<T>[]>;

  constructor(points: string[] = []) {
    this.mutators = new Map();
    this.wrappers = new Map();
    for (const point of points) {
      this.mutators.set(point, []);
      this.wrappers.set(point, []);
    }
  }

  ensure(point: string): void {
    if (!this.mutators.has(point)) {
      this.mutators.set(point, []);
      this.wrappers.set(point, []);
    }
  }

  mutate(point: string, fn: Mutator<T>): void {
    this.ensure(point);
    this.mutators.get(point)?.push(fn);
  }

  wrap(point: string, fn: Wrapper<T>): void {
    this.ensure(point);
    this.wrappers.get(point)?.push(fn);
  }

  async runMutators(point: string, ctx: T): Promise<T> {
    this.ensure(point);
    let current = ctx;
    for (const fn of this.mutators.get(point) || []) {
      const next = await fn(current);
      if (next !== undefined) {
        current = next;
      }
    }
    return current;
  }

  async runWrapped<R>(point: string, ctx: T, coreFn: (ctx: T) => Promise<R>): Promise<R> {
    this.ensure(point);
    let runner = coreFn;
    const wrappers = this.wrappers.get(point) || [];
    for (let i = wrappers.length - 1; i >= 0; i -= 1) {
      const wrapper = wrappers[i];
      if (wrapper) {
        runner = wrapper(runner);
      }
    }
    return runner(ctx);
  }
}
