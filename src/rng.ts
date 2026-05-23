export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  boolean(chance = 0.5) {
    return this.float() < chance;
  }

  choice<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot choose from an empty list");

    return items[this.integer(0, items.length - 1)]!;
  }

  float() {
    this.#state += 0x6d2b79f5;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  integer(min: number, max: number) {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  sample<T>(items: readonly T[], maxCount: number): T[] {
    const copy = [...items];
    const count = Math.min(maxCount, copy.length);
    const selected: T[] = [];

    for (let index = 0; index < count; index++) {
      const pickedIndex = this.integer(0, copy.length - 1);
      const [picked] = copy.splice(pickedIndex, 1);
      selected.push(picked!);
    }

    return selected;
  }
}
