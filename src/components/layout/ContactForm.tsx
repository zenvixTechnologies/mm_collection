"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { EMAIL_RE, isValidMobile } from "@/lib/validation";
import { Field } from "@/components/ui/Field";

const TOPICS = ["Order status", "Sizing help", "Returns & exchanges", "Product question", "Store visit", "Other"];

export function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", phone: "", topic: TOPICS[0], message: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof f, string>>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (f.name.trim().length < 2) errs.name = "Please enter your name.";
    if (!EMAIL_RE.test(f.email.trim())) errs.email = "Enter a valid email address.";
    if (f.phone && !isValidMobile(f.phone)) errs.phone = "Enter a valid 10-digit mobile number.";
    if (f.message.trim().length < 10) errs.message = "Please tell us a little more (at least 10 characters).";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setState("sending");
    window.setTimeout(() => setState("sent"), 700);
  };

  if (state === "sent") {
    return (
      <div className="flex flex-col items-center rounded-2xl bg-success-soft px-6 py-12 text-center" role="status">
        <CheckCircle2 size={36} className="text-success" />
        <h2 className="mt-4 text-xl font-semibold">Thanks, {f.name.split(" ")[0]}!</h2>
        <p className="mt-1 max-w-sm text-sm text-muted">
          Your message has been received. We usually reply within a few hours during store hours. (Demo store — the
          message isn&apos;t actually sent.)
        </p>
        <button
          type="button"
          className="btn-outline mt-6"
          onClick={() => {
            setF({ name: "", email: "", phone: "", topic: TOPICS[0], message: "" });
            setState("idle");
          }}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
      <Field label="Your name" name="c-name" autoComplete="name" value={f.name} onChange={set("name")} error={errors.name} />
      <Field label="Email" name="c-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} error={errors.email} />
      <Field label="Mobile" name="c-phone" type="tel" autoComplete="tel" optional value={f.phone} onChange={set("phone")} error={errors.phone} />
      <div>
        <label htmlFor="c-topic" className="field-label">
          Topic
        </label>
        <select id="c-topic" value={f.topic} onChange={set("topic")} className="field-input">
          {TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-message" className="field-label">
          Message<span className="text-accent" aria-hidden> *</span>
        </label>
        <textarea
          id="c-message"
          rows={5}
          value={f.message}
          onChange={set("message")}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "c-message-error" : undefined}
          className="field-input h-auto py-3"
          placeholder="How can we help? Include your order ID if it's about an order."
        />
        {errors.message && (
          <p id="c-message-error" className="field-error" role="alert">
            {errors.message}
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        <button type="submit" disabled={state === "sending"} className="btn-primary min-h-12 px-10">
          {state === "sending" && <Loader2 size={16} className="animate-spin" />} Send message
        </button>
      </div>
    </form>
  );
}
