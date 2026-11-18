"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DEMO_ADMIN } from "@/data/admin/settings";
import { useHydrated } from "@/hooks/use-hydrated";
import { useAdminSession } from "@/store/admin-store";
import { cn } from "@/lib/utils";
import { toast } from "@/store/ui-store";

/** Only allow redirects back into the admin panel. */
function safeNext(next: string | null) {
  return next && next.startsWith("/mm-hub") && !next.startsWith("/mm-hub/login") ? next : "/mm-hub";
}

const ease = [0.22, 1, 0.36, 1] as const;

/** Faint diamond lattice echoing the logo's gold ornament. */
const LATTICE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'%3E%3Cpath d='M22 0 44 22 22 44 0 22Z' fill='none' stroke='%23c9a54c' stroke-opacity='0.09' stroke-width='1'/%3E%3C/svg%3E\")";

/**
 * Logo + "M&M COLLECTIONS" + "ADMIN STUDIO", centered.
 * Entrance plays in sequence: logo settles in → title rises → "ADMIN STUDIO" tightens → gold line draws.
 * The large (desktop) version also gets a slowly turning gold ring around the logo.
 * Everything is skipped when the visitor prefers reduced motion.
 */
function Brand({ tone, size }: { tone: "dark" | "light"; size: "lg" | "md" }) {
  const lg = size === "lg";
  const still = useReducedMotion();
  const enter = (delay: number) => ({ duration: 0.7, delay: lg ? delay : delay * 0.6, ease });
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        {lg && (
          <motion.span
            className="pointer-events-none absolute -inset-4 rounded-full border border-dashed border-gold/40"
            initial={still ? false : { opacity: 0, scale: 0.8 }}
            animate={still ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 360 }}
            transition={
              still
                ? undefined
                : { opacity: enter(0.35), scale: enter(0.35), rotate: { duration: 40, ease: "linear", repeat: Infinity } }
            }
            aria-hidden
          />
        )}
        <motion.span
          className={cn(
            "relative block rounded-full bg-white ring-2 ring-gold/70",
            lg ? "p-2.5 shadow-[0_0_0_8px_rgb(201_165_76/0.12),0_20px_50px_-12px_rgb(0_0_0/0.5)]" : "p-2 shadow-[0_10px_30px_-10px_rgb(42_15_17/0.35)]",
          )}
          initial={still ? false : { opacity: 0, scale: 0.6, rotate: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.05 }}
        >
          <Image src="/brand/logo-192.webp" alt="M&M COLLECTIONS logo" width={lg ? 120 : 76} height={lg ? 120 : 76} unoptimized priority />
        </motion.span>
      </div>
      <motion.p
        className={cn(
          "font-display leading-none font-bold",
          lg ? "mt-8 text-[2.5rem] whitespace-nowrap xl:text-5xl" : "mt-5 text-3xl sm:text-4xl",
          tone === "dark" ? "text-white" : "text-royal",
        )}
        initial={still ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter(0.3)}
      >
        M<span className="text-gold-gradient">&amp;</span>M COLLECTIONS
      </motion.p>
      <motion.p
        className={cn(
          "font-bold",
          lg ? "mt-4 text-xs tracking-[0.5em]" : "mt-2.5 text-[11px] tracking-[0.42em]",
          tone === "dark" ? "text-gold-light/85" : "text-gold-dark",
        )}
        initial={still ? false : { opacity: 0, letterSpacing: "0.9em" }}
        animate={{ opacity: 1, letterSpacing: lg ? "0.5em" : "0.42em" }}
        transition={enter(0.5)}
      >
        ADMIN STUDIO
      </motion.p>
      <motion.span
        className={cn("gold-rule block", lg ? "mt-7 w-40" : "mt-5 w-28")}
        initial={still ? false : { scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={enter(0.7)}
        aria-hidden
      />
    </div>
  );
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
  const reduceMotion = useReducedMotion();

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
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-2">
      {/* ───────────── Left: logo + title (desktop) ───────────── */}
      <aside className="relative hidden overflow-hidden bg-royal lg:flex lg:flex-col lg:items-center lg:justify-center lg:p-12">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: LATTICE }} aria-hidden />
        {/* Warm glow that slowly "breathes" behind the logo */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 h-160 w-160 -translate-x-1/2 -translate-y-1/2" aria-hidden>
          <motion.div
            className="h-full w-full rounded-full bg-[radial-gradient(closest-side,rgb(201_165_76/0.18),transparent)]"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: [0.75, 1, 0.75], scale: [0.96, 1.04, 0.96] }}
            transition={reduceMotion ? undefined : { duration: 7, ease: "easeInOut", repeat: Infinity }}
          />
        </div>
        <div className="relative">
          <Brand tone="dark" size="lg" />
        </div>
        <p className="absolute inset-x-0 bottom-8 text-center text-xs text-white/40">© M&amp;M COLLECTIONS</p>
      </aside>

      {/* ───────────── Right: sign-in ───────────── */}
      <div className="relative flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 lg:hidden" style={{ backgroundImage: LATTICE }} aria-hidden />
        <div
          className="pointer-events-none absolute -top-56 left-1/2 h-155 w-[min(980px,160vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(201_165_76/0.22),transparent)] lg:hidden"
          aria-hidden
        />

        <header className="relative px-4 pt-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
            <ArrowLeft size={15} aria-hidden /> Back to store
          </Link>
        </header>

        <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-10">
          {/* Phones / tablets: brand sits above the form */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="mb-8 lg:hidden"
          >
            <Brand tone="light" size="md" />
          </motion.div>

          {/* ───────────── Sign-in card ───────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease }}
            className="w-full max-w-100 rounded-3xl border border-line bg-white p-6 shadow-[0_24px_60px_-28px_rgb(42_15_17/0.35)] sm:p-8"
          >
            <div className="text-center">
              <h1 className="font-display text-3xl font-semibold text-ink">Welcome back</h1>
              <p className="mt-1.5 text-sm text-muted">Sign in to manage your store.</p>
            </div>

            <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
              <div>
                <label htmlFor="admin-email" className="field-label">
                  Email address
                </label>
                <div className="relative">
                  <Mail size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle" aria-hidden />
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
                  <Lock size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle" aria-hidden />
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

            {/* Demo access — one quiet line instead of a separate panel */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl bg-gold-soft px-4 py-3 text-center text-[13px]">
              <span className="text-muted">
                Demo: {DEMO_ADMIN.email} · {DEMO_ADMIN.password}
              </span>
              <button type="button" onClick={fillDemo} className="font-semibold text-gold-dark underline-offset-4 hover:underline">
                Fill in
              </button>
            </div>
          </motion.div>
        </main>

        <footer className="relative px-4 pb-6 text-center text-xs text-subtle">
          Frontend preview — real admin authentication will be added with the backend.
        </footer>
      </div>
    </div>
  );
}
