import "server-only";

/**
 * All money on the server is integer paise (₹1 = 100 paise) — the unit Razorpay uses — so sums,
 * discounts and refunds never suffer floating-point drift. Convert to rupees only for display.
 */

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new RangeError("Amount must be a finite number.");
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  assertPaise(paise);
  return paise / 100;
}

export function assertPaise(value: number): asserts value is number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Amount must be a non-negative whole number of paise.");
}

/** `percent`% of `amount`, rounded down to whole paise so a discount never exceeds the stated rate. */
export function percentOf(amountPaise: number, percent: number): number {
  assertPaise(amountPaise);
  if (!(percent >= 0 && percent <= 100)) throw new RangeError("Percent must be between 0 and 100.");
  return Math.floor((amountPaise * percent) / 100);
}

export function sumPaise(values: number[]): number {
  return values.reduce((total, v) => {
    assertPaise(v);
    return total + v;
  }, 0);
}
