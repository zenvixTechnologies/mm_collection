"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { customerApi } from "@/lib/customer-api";
import { PasswordField } from "./AuthForms";

/** Opened from the reset email: /reset-password?token=… */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return (
      <div className="space-y-5 text-center">
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          This reset link is incomplete or invalid. Please use the link from your email, or request a new one.
        </p>
        <Link href="/login" className="btn-primary w-full">
          Back to log in
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-5 text-center" role="status">
        <CheckCircle2 size={40} className="mx-auto text-success" aria-hidden />
        <p className="text-muted">Your password has been reset and you&apos;ve been signed out on all devices. Log in with your new password.</p>
        <Link href="/login" className="btn-primary min-h-12 w-full">
          Log in
        </Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    else if (!/\d/.test(password) || !/[a-zA-Z]/.test(password)) errs.password = "Use at least one letter and one number.";
    if (confirm !== password) errs.confirm = "Passwords don't match.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      await customerApi("/auth/reset-password", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {errors.form && (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          {errors.form}
        </p>
      )}
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(v) => (setPassword(v), setErrors((x) => ({ ...x, password: undefined })))}
        error={errors.password}
        hint="At least 8 characters, with a letter and a number"
      />
      <PasswordField
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        value={confirm}
        onChange={(v) => (setConfirm(v), setErrors((x) => ({ ...x, confirm: undefined })))}
        error={errors.confirm}
      />
      <button type="submit" disabled={loading} className="btn-primary min-h-12 w-full">
        {loading && <Loader2 size={17} className="animate-spin" />} Reset password
      </button>
      <p className="text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-ink underline underline-offset-2">
          Log in
        </Link>
      </p>
    </form>
  );
}
