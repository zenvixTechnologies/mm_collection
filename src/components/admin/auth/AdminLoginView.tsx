"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Eye, EyeOff, Info, Lock } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DEMO_ADMIN } from "@/data/admin/settings";
import { useHydrated } from "@/hooks/use-hydrated";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";

/** Only allow redirects back into the admin panel. */
function safeNext(next: string | null) {
  return next && next.startsWith("/admin") && !next.startsWith("/admin/login") ? next : "/admin";
}

export function AdminLoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useHydrated();
  const user = useAdminSession((s) => s.user);
  const login = useAdminSession((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (hydrated && user) router.replace(next);
  }, [hydrated, user, router, next]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    // Small delay so the demo feels like a real sign-in round trip.
    window.setTimeout(() => {
      const res = login(email, password);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Welcome back to M&M Admin Studio");
      router.replace(next);
    }, 450);
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-royal lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full border border-gold/20"
          aria-hidden
        />
        <div className="pointer-events-none absolute -top-24 -right-24 h-[380px] w-[380px] rounded-full border border-gold/15" aria-hidden />
        <div className="pointer-events-none absolute -bottom-48 -left-32 h-[460px] w-[460px] rounded-full bg-accent/20 blur-3xl" aria-hidden />

        <div className="relative flex items-center gap-3">
          <span className="rounded-full bg-white p-1.5 ring-2 ring-gold/70">
            <Image src="/brand/logo-192.webp" alt="M&M COLLECTIONS logo" width={48} height={48} unoptimized priority />
          </span>
          <div className="leading-none">
            <p className="font-display text-2xl font-bold text-white">
              M<span className="text-gold-gradient">&amp;</span>M COLLECTIONS
            </p>
            <p className="mt-1 text-[10px] font-bold tracking-[0.34em] text-gold-light/80">ADMIN STUDIO</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="eyebrow text-gold-light">Behind the boutique</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.05] font-semibold text-white">
            Everything your store needs, <span className="text-gold-gradient">in one place.</span>
          </h1>
          <p className="mt-5 text-[15px] leading-7 text-white/70">
            Manage products, orders, customers and the homepage with the same care your shoppers see on the storefront.
          </p>
        </div>

        <div className="relative">
          <div className="gold-rule opacity-50" aria-hidden />
          <p className="mt-4 text-xs text-white/50">Women · Men · Kids — delivered across India</p>
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-col bg-white px-4 py-8 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
          <ArrowLeft size={15} aria-hidden /> Back to store
        </Link>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="m-auto w-full max-w-sm py-10"
        >
          <Image src="/brand/logo-192.webp" alt="" width={64} height={64} unoptimized className="mx-auto mb-6 lg:hidden" />
          <p className="eyebrow">Admin sign in</p>
          <h2 className="mt-3 font-display text-4xl font-semibold">Welcome back</h2>
          <p className="mt-2 text-sm text-muted">Sign in to manage M&amp;M COLLECTIONS.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <div>
              <label htmlFor="admin-email" className="field-label">
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field-input"
                aria-invalid={error ? true : undefined}
                placeholder="you@mmcollections.in"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="field-label">
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input pr-12"
                  aria-invalid={error ? true : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-sand hover:text-ink"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              <Lock size={16} aria-hidden />
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 flex gap-3 rounded-xl border border-gold-light bg-gold-soft px-4 py-3 text-[13px] leading-5 text-ink">
            <Info size={16} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
            <div>
              <p className="font-semibold">Demo access</p>
              <p className="text-muted">
                {DEMO_ADMIN.email} · {DEMO_ADMIN.password}
              </p>
              <button
                type="button"
                onClick={() => {
                  setEmail(DEMO_ADMIN.email);
                  setPassword(DEMO_ADMIN.password);
                }}
                className="mt-1 font-semibold text-accent hover:underline"
              >
                Fill in demo details
              </button>
            </div>
          </div>
        </motion.div>
        <p className="text-center text-xs text-subtle">Frontend preview — real admin authentication will be added with the backend.</p>
      </div>
    </div>
  );
}
