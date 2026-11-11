"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Mail } from "lucide-react";
import { useState } from "react";

export function Newsletter() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    setDone(true);
  };

  return (
    <div className="rounded-3xl border border-gold-light bg-sand px-6 py-12 text-center sm:px-12 sm:py-16">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-gold-dark ring-1 ring-gold-light">
        <Mail size={22} />
      </span>
      <h2 className="mt-5 font-display text-3xl font-semibold sm:text-4xl">Join the M&amp;M circle</h2>
      <p className="mx-auto mt-2 max-w-md text-muted">
        Be first to see new arrivals and festive offers. Get <strong className="text-ink">10% off</strong> your first order.
      </p>
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto mt-8 flex max-w-md flex-col items-center gap-2 rounded-2xl bg-white px-6 py-5"
            role="status"
          >
            <CheckCircle2 className="text-success" size={28} />
            <p className="font-semibold">You&apos;re on the list!</p>
            <p className="text-sm text-muted">
              Use code <strong className="text-ink">WELCOME10</strong> on your first order.
            </p>
          </motion.div>
        ) : (
          <motion.form key="form" exit={{ opacity: 0 }} onSubmit={submit} noValidate className="mx-auto mt-8 max-w-md">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label htmlFor="newsletter-email" className="sr-only">
                Email address
              </label>
              <input
                id="newsletter-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Your email address"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "newsletter-error" : undefined}
                className="field-input rounded-full"
              />
              <button type="submit" className="btn-primary min-h-12 shrink-0 px-7">
                Subscribe
              </button>
            </div>
            {error && (
              <p id="newsletter-error" className="field-error text-left sm:pl-4" role="alert">
                {error}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">No spam. Unsubscribe anytime.</p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
