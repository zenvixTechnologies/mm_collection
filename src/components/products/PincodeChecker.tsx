"use client";

import { CheckCircle2, Loader2, MapPin, XCircle } from "lucide-react";
import { useState } from "react";
import { DELIVERY_DISCLAIMER, DELIVERY_ZONES } from "@/lib/policies";

type Result = { ok: true; message: string } | { ok: false; message: string };

const [KERALA, SOUTH_INDIA, REST_OF_INDIA] = DELIVERY_ZONES;

/** Skips Saturdays and Sundays, since delivery timelines are quoted in business days. */
function addBusinessDays(start: Date, days: number) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

/**
 * DEMO delivery estimate — uses simple PIN code prefix rules, not a real courier API.
 * Kerala (67–69) ships fastest from our Alappuzha store; South India is Telangana / Andhra Pradesh (50–53),
 * Karnataka (56–59) and Tamil Nadu / Puducherry (60–64); everywhere else is Rest of India.
 */
function estimate(pin: string): Result {
  const n = Number(pin);
  if (!/^[1-9]\d{5}$/.test(pin)) return { ok: false, message: "Enter a valid 6-digit PIN code." };
  if (pin.startsWith("99") || n < 110000) return { ok: false, message: "Sorry, we don't deliver to this PIN code yet." };
  const prefix = Number(pin.slice(0, 2));
  const zone =
    prefix >= 67 && prefix <= 69
      ? KERALA
      : (prefix >= 50 && prefix <= 53) || (prefix >= 56 && prefix <= 64)
        ? SOUTH_INDIA
        : REST_OF_INDIA;
  const today = new Date();
  const from = addBusinessDays(today, zone.minDays);
  const to = addBusinessDays(today, zone.maxDays);
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return { ok: true, message: `Estimated delivery: ${fmt(from)} – ${fmt(to)}` };
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
              <p className="pl-5 text-muted">Shipping Charges Applicable · Prepaid orders (UPI / card / net banking)</p>
              <p className="pl-5 text-muted">{DELIVERY_DISCLAIMER}</p>
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
