"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { DEMO_USER } from "@/data/orders";
import { EMAIL_RE, isValidMobile, normalizeMobile } from "@/lib/validation";
import { useAuthStore } from "@/store/auth-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";

function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

function PasswordField({
  label,
  name,
  value,
  onChange,
  error,
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Field
        label={label}
        name={name}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        hint={hint}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute top-[34px] right-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:text-ink"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function DemoNotice() {
  return (
    <p className="mb-6 flex gap-2 rounded-xl bg-canvas px-4 py-3 text-[13px] text-muted">
      <Info size={16} className="mt-0.5 shrink-0 text-accent" />
      <span>
        Demo sign-in only: accounts are stored in this browser and are not secure. Try{" "}
        <strong className="text-ink">{DEMO_USER.email}</strong> / <strong className="text-ink">{DEMO_USER.password}</strong>.
      </span>
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    const id = identifier.trim();
    if (!id) errs.identifier = "Enter your email or mobile number.";
    else if (!EMAIL_RE.test(id) && !isValidMobile(id)) errs.identifier = "Enter a valid email or 10-digit mobile number.";
    if (!password) errs.password = "Enter your password.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    window.setTimeout(() => {
      const res = login(id, password, remember);
      setLoading(false);
      if (!res.ok) {
        setErrors({ form: res.error });
        return;
      }
      toast.success("Welcome back!");
      router.push(safeNext(params.get("next")));
    }, 500);
  };

  return (
    <>
      <DemoNotice />
      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.form && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {errors.form}
          </p>
        )}
        <Field
          label="Email or mobile number"
          name="identifier"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={errors.identifier}
        />
        <PasswordField label="Password" name="password" autoComplete="current-password" value={password} onChange={setPassword} error={errors.password} />
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-[18px] w-[18px] accent-accent" />
            Remember me
          </label>
          <button type="button" onClick={() => setForgotOpen(true)} className="font-medium text-accent hover:underline">
            Forgot password?
          </button>
        </div>
        <button type="submit" disabled={loading} className="btn-primary min-h-12 w-full">
          {loading && <Loader2 size={17} className="animate-spin" />} Log in
        </button>
        <p className="text-center text-sm text-muted">
          New to M&amp;M COLLECTIONS?{" "}
          <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-semibold text-ink underline underline-offset-2">
            Create an account
          </Link>
        </p>
      </form>
      <ForgotPassword open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </>
  );
}

function ForgotPassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        setSent(false);
        setEmail("");
      }}
      title="Reset your password"
    >
      <div className="p-5">
        {sent ? (
          <p className="text-sm text-muted" role="status">
            If an account exists for <strong className="text-ink">{email}</strong>, a reset link would be emailed. (Demo store — no email
            is actually sent.)
          </p>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
              setSent(true);
            }}
            className="space-y-4"
          >
            <p className="text-sm text-muted">Enter the email you registered with and we&apos;ll send you a reset link.</p>
            <Field label="Email address" name="reset-email" type="email" value={email} onChange={(e) => (setEmail(e.target.value), setError(""))} error={error} />
            <button type="submit" className="btn-primary w-full">
              Send reset link
            </button>
          </form>
        )}
      </div>
    </Dialog>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const register = useAuthStore((s) => s.register);
  const [f, setF] = useState({ fullName: "", email: "", mobile: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof f | "form", string>>>({});
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (f.fullName.trim().length < 3) errs.fullName = "Please enter your full name.";
    if (!EMAIL_RE.test(f.email.trim())) errs.email = "Enter a valid email address.";
    if (!isValidMobile(f.mobile)) errs.mobile = "Enter a valid 10-digit Indian mobile number.";
    if (f.password.length < 8) errs.password = "Password must be at least 8 characters.";
    else if (!/\d/.test(f.password) || !/[a-zA-Z]/.test(f.password)) errs.password = "Use at least one letter and one number.";
    if (f.confirm !== f.password) errs.confirm = "Passwords don't match.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    window.setTimeout(() => {
      const res = register({ fullName: f.fullName, email: f.email, mobile: normalizeMobile(f.mobile), password: f.password });
      setLoading(false);
      if (!res.ok) return setErrors({ form: res.error });
      toast.success("Account created — welcome to M&M COLLECTIONS!");
      router.push(safeNext(params.get("next")));
    }, 500);
  };

  return (
    <>
      <DemoNotice />
      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.form && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {errors.form}
          </p>
        )}
        <Field label="Full name" name="fullName" autoComplete="name" value={f.fullName} onChange={set("fullName")} error={errors.fullName} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" name="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} error={errors.email} />
          <Field label="Mobile" name="mobile" type="tel" inputMode="tel" autoComplete="tel" value={f.mobile} onChange={set("mobile")} error={errors.mobile} />
        </div>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          value={f.password}
          onChange={(v) => (setF((x) => ({ ...x, password: v })), setErrors((er) => ({ ...er, password: undefined })))}
          error={errors.password}
          hint="At least 8 characters, with a letter and a number"
        />
        <PasswordField
          label="Confirm password"
          name="confirm"
          autoComplete="new-password"
          value={f.confirm}
          onChange={(v) => (setF((x) => ({ ...x, confirm: v })), setErrors((er) => ({ ...er, confirm: undefined })))}
          error={errors.confirm}
        />
        <button type="submit" disabled={loading} className="btn-primary min-h-12 w-full">
          {loading && <Loader2 size={17} className="animate-spin" />} Create account
        </button>
        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-ink underline underline-offset-2">
            Log in
          </Link>
        </p>
      </form>
    </>
  );
}
