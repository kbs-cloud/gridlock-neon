export class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  public next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
}
