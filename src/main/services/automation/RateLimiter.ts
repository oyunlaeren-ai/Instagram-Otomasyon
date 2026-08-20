export class RateLimiter {
  private lastActionAt = 0;
  private primed = false;

  constructor(
    private delayMs: number,
    private readonly sleeper: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = () => Date.now()
  ) {}

  setDelayMs(delayMs: number): void {
    this.delayMs = delayMs;
  }

  getDelayMs(): number {
    return this.delayMs;
  }

  async waitTurn(): Promise<void> {
    if (!this.primed) {
      this.primed = true;
      this.lastActionAt = this.now();
      return;
    }
    const elapsed = this.now() - this.lastActionAt;
    const remaining = this.delayMs - elapsed;
    if (remaining > 0) {
      await this.sleeper(remaining);
    }
    this.lastActionAt = this.now();
  }

  reset(): void {
    this.lastActionAt = 0;
    this.primed = false;
  }
}
