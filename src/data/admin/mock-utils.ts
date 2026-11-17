/**
 * Helpers for building deterministic admin mock data.
 * Everything is seeded and anchored to a fixed "now", so server and client render
 * identical markup (no hydration mismatches) and the demo looks the same on every load.
 */

/** The moment the demo data is anchored to. */
export const MOCK_NOW = new Date("2026-11-14T11:30:00+05:30");

/** Small seeded PRNG (mulberry32). */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p,
  };
}

/** ISO timestamp `days` before MOCK_NOW at a given IST hour/minute. */
export function daysAgo(days: number, hour = 11, minute = 0) {
  const d = new Date(MOCK_NOW.getTime() - days * 86_400_000);
  // Work in IST (+05:30) regardless of the machine's timezone.
  const ist = new Date(d.getTime() + 330 * 60_000);
  ist.setUTCHours(hour, minute, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000).toISOString();
}

export function hoursAfter(iso: string, hours: number) {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

/** yyyy-mm-dd in IST. */
export function istDateKey(iso: string | Date) {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}
