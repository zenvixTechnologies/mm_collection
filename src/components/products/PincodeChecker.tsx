"use client";

import { CheckCircle2, Loader2, MapPin, XCircle } from "lucide-react";
import { useState } from "react";

type Result = { ok: true; message: string; cod: boolean } | { ok: false; message: string };

/**
 * DEMO delivery estimate — uses simple PIN code prefix rules, not a real courier API.
 * Kerala (67–69) ships fastest from our Alappuzha store; other Indian PINs take longer.
 */
function estimate(pin: string): Result {
  const n = Number(pin);
  if (!/^[1-9]\d{5}$/.test(pin)) return { ok: false, message: "Enter a valid 6-digit PIN code." };
  if (pin.startsWith("99") || n < 110000) return { ok: false, message: "Sorry, we don't deliver to this PIN code yet." };
  const prefix = Number(pin.slice(0, 2));
  const days = prefix >= 67 && prefix <= 69 ? [2, 3] : prefix >= 56 && prefix <= 64 ? [3, 5] : [4, 7];
  const from = new Date(Date.now() + days[0] * 86400000);
  const to = new Date(Date.now() + days[1] * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return { ok: true, message: `Estimated delivery: ${fmt(from)} – ${fmt(to)}`, cod: prefix !== 79 };
}

export function PincodeChecker() {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    window.setTimeout(() => {
      setResult(estimate(pin));
      setLoading(false);
    }, 450);
  };

  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <MapPin size={16} className="text-accent" /> Check delivery
      </p>
      <form onSubmit={check} className="flex gap-2">
        <label htmlFor="pincode" className="sr-only">
          PIN code
        </label>
        <input
          id="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="Enter PIN code"
          className="field-input h-11"
          aria-describedby="pincode-result"
        />
        <button type="submit" className="btn-outline min-h-11 px-5" disabled={loading || pin.length === 0}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Check"}
        </button>
      </form>
      <div id="pincode-result" aria-live="polite" className="mt-2 min-h-5 text-[13px]">
        {result &&
          (result.ok ? (
            <div className="space-y-1 text-success">
              <p className="flex items-center gap-1.5">
                <CheckCircle2 size={14} /> {result.message}
              </p>
              <p className="pl-5 text-muted">{result.cod ? "Cash on Delivery available" : "Prepaid orders only for this PIN"}</p>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-danger">
              <XCircle size={14} /> {result.message}
            </p>
          ))}
      </div>
    </div>
  );
}
