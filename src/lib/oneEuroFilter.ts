/**
 * One Euro filter (Casiez et al., CHI 2012): a low-pass filter whose cutoff
 * rises with speed. Slow/still hands get heavy smoothing (kills landmark
 * jitter), fast motion gets light smoothing (no lag on a real pinch).
 */
export class OneEuroFilter {
  private prevValue: number | null = null;
  private prevDerivative = 0;
  private prevTime = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly derivativeCutoff = 1,
  ) {}

  filter(value: number, timeMs: number): number {
    if (this.prevValue === null) {
      this.prevValue = value;
      this.prevTime = timeMs;
      return value;
    }

    const dt = Math.max((timeMs - this.prevTime) / 1000, 1e-3);
    this.prevTime = timeMs;

    const derivative = (value - this.prevValue) / dt;
    this.prevDerivative = lerp(
      this.prevDerivative,
      derivative,
      alpha(this.derivativeCutoff, dt),
    );

    const cutoff = this.minCutoff + this.beta * Math.abs(this.prevDerivative);
    this.prevValue = lerp(this.prevValue, value, alpha(cutoff, dt));
    return this.prevValue;
  }

  reset() {
    this.prevValue = null;
    this.prevDerivative = 0;
  }
}

function alpha(cutoffHz: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}
