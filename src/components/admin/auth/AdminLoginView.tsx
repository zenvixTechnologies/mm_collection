"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DEMO_ADMIN } from "@/data/admin/settings";
import { useHydrated } from "@/hooks/use-hydrated";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";

/** Only allow redirects back into the admin panel. */
function safeNext(next: string | null) {
  return next && next.startsWith("/admin") && !next.startsWith("/admin/login") ? next : "/admin";
}

const ease = [0.22, 1, 0.36, 1] as const;

/** Faint diamond lattice echoing the logo's gold ornament. */
const LATTICE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'%3E%3Cpath d='M22 0 44 22 22 44 0 22Z' fill='none' stroke='%23c9a54c' stroke-opacity='0.09' stroke-width='1'/%3E%3C/svg%3E\")";

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

  const fillDemo = () => {
    setEmail(DEMO_ADMIN.email);
    setPassword(DEMO_ADMIN.password);
    setError(null);
  };

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[1.05fr_1fr]">
      {/* ───────────── Brand panel (desktop) ───────────── */}
      <aside className="relative hidden overflow-hidden bg-royal lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute -top-40 -right-40 h-120 w-120 rounded-full border border-gold/15" aria-hidden />

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="relative flex items-center gap-3"
        >
          <span className="rounded-full bg-white p-1.5 shadow-[0_0_0_4px_rgb(201_165_76/0.18)] ring-2 ring-gold/70">
            <Image src="/brand/logo-192.webp" alt="M&M COLLECTIONS logo" width={48} height={48} unoptimized priority />
          </span>
          <div className="leading-none">
            <p className="font-display text-2xl font-bold text-white">
              M<span className="text-gold-gradient">&amp;</span>M COLLECTIONS
            </p>
            <p className="mt-1 text-[10px] font-bold tracking-[0.34em] text-gold-light/80">ADMIN STUDIO</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease }}
          className="relative max-w-md"
        >
          <h1 className="font-display text-5xl leading-[1.08] font-semibold text-white">
            Everything your store needs, <span className="text-gold-gradient">in one place.</span>
          </h1>
          <p className="mt-5 text-[15px] leading-7 text-white/60">
            Manage products, orders, customers and the homepage — all from one dashboard.
          </p>
        </motion.div>

        <p className="relative text-xs text-white/40">© M&amp;M COLLECTIONS · Admin Studio</p>
      </aside>

      {/* ───────────── Form side ───────────── */}
      <main className="relative flex flex-col">
        {/* Mobile brand header */}
        <div className="relative overflow-hidden bg-royal px-4 pt-6 pb-16 sm:px-8 lg:hidden">
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: LATTICE }} aria-hidden />
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full border border-gold/20" aria-hidden />
          <Link
            href="/"
            className="relative inline-flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white"
          >
            <ArrowLeft size={15} aria-hidden /> Back to store
          </Link>
          <div className="relative mt-6 flex items-center gap-3">
            <span className="rounded-full bg-white p-1 ring-2 ring-gold/70">
              <Image src="/brand/logo-192.webp" alt="" width={40} height={40} unoptimized priority />
            </span>
            <div className="leading-none">
              <p className="font-display text-xl font-bold text-white">
                M<span className="text-gold-gradient">&amp;</span>M COLLECTIONS
              </p>
              <p className="mt-1 text-[9px] font-bold tracking-[0.34em] text-gold-light/80">ADMIN STUDIO</p>
            </div>
          </div>
        </div>

        <div className="hidden px-8 pt-8 lg:block">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
            <ArrowLeft size={15} aria-hidden /> Back to store
          </Link>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 sm:px-8 lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease }}
            className="-mt-10 w-full max-w-105 rounded-3xl border border-line bg-white p-6 shadow-[0_24px_60px_-28px_rgb(42_15_17/0.35)] sm:p-9 lg:mt-0"
          >
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent/10">
              <Lock size={20} aria-hidden />
            </div>
            <p className="eyebrow">Admin sign in</p>
            <h2 className="mt-3 font-display text-4xl font-semibold text-ink">Welcome back</h2>
            <p className="mt-2 text-sm text-muted">Sign in to manage M&amp;M COLLECTIONS.</p>

            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
              <div>
                <label htmlFor="admin-email" className="field-label">
                  Email address
                </label>
                <div className="relative">
                  <Mail
                    size={17}
                    className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle"
                    aria-hidden
                  />
                  <input
                    id="admin-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field-input pl-11"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "admin-login-error" : undefined}
                    placeholder="you@mmcollections.in"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="admin-password" className="field-label">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    size={17}
                    className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle"
                    aria-hidden
                  />
                  <input
                    id="admin-password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="field-input pr-12 pl-11"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "admin-login-error" : undefined}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-sand hover:text-ink"
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    key="err"
                    id="admin-login-error"
                    role="alert"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <p className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
                      <AlertCircle size={16} className="mt-px shrink-0" aria-hidden />
                      {error}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <button type="submit" disabled={busy} className="btn-primary group h-12 w-full">
                {busy ? (
                  <>
                    <Loader2 size={17} className="animate-spin" aria-hidden /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </>
                )}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3 text-[11px] font-semibold tracking-[0.18em] text-subtle uppercase">
              <span className="h-px flex-1 bg-line" aria-hidden />
              Preview access
              <span className="h-px flex-1 bg-line" aria-hidden />
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-gold-light bg-gold-soft p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-gold-dark ring-1 ring-gold-light">
                <Sparkles size={17} aria-hidden />
              </span>
              <div className="min-w-0 flex-1 text-[13px] leading-5">
                <p className="font-semibold text-ink">Demo admin</p>
                <p className="truncate text-muted">
                  {DEMO_ADMIN.email} · {DEMO_ADMIN.password}
                </p>
              </div>
              <button
                type="button"
                onClick={fillDemo}
                className="shrink-0 rounded-full border border-gold/40 bg-white px-3.5 py-1.5 text-xs font-semibold text-gold-dark transition-colors hover:border-gold hover:bg-gold-light/40"
              >
                Use
              </button>
            </div>
          </motion.div>
        </div>

        <p className="px-4 py-6 text-center text-xs text-subtle">
          Frontend preview — real admin authentication will be added with the backend.
        </p>
      </main>
    </div>
  );
}
