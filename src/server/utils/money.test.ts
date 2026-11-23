import { describe, expect, it } from "vitest";
import { paiseToRupees, percentOf, rupeesToPaise, sumPaise } from "./money";

describe("money (integer paise)", () => {
  it("converts rupees to paise without float drift", () => {
    expect(rupeesToPaise(1299)).toBe(129900);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(paiseToRupees(129950)).toBe(1299.5);
  });

  it("rejects fractional or negative paise", () => {
    expect(() => paiseToRupees(10.5)).toThrow(RangeError);
    expect(() => sumPaise([100, -1])).toThrow(RangeError);
    expect(() => rupeesToPaise(Number.NaN)).toThrow(RangeError);
  });

  it("rounds percentage discounts down", () => {
    expect(percentOf(129900, 15)).toBe(19485);
    expect(percentOf(999, 10)).toBe(99);
    expect(sumPaise([129900, 159900])).toBe(289800);
  });
});
