"use client";

import { useSearchParams } from "next/navigation";
import { Bell, CreditCard, FileText, Info, KeyRound, RotateCcw, Store, UserCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { StoreSettings } from "@/types/admin";
import { cn } from "@/lib/utils";
import { useAdminSession, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Badge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Switch, TextAreaField, TextField } from "../ui/FormControls";
import { SingleImageUpload } from "../ui/ImageUpload";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";

type Section = "store" | "policies" | "notifications" | "payments" | "account";

const SECTIONS: { value: Section; label: string; icon: typeof Store }[] = [
  { value: "store", label: "Store details", icon: Store },
  { value: "policies", label: "Policies", icon: FileText },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "payments", label: "Payments", icon: CreditCard },
  { value: "account", label: "My account", icon: UserCircle },
];

function SaveBar({ dirty, onReset }: { dirty: boolean; onReset: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex items-center justify-end gap-2 border-t border-line bg-white/95 px-5 py-3 backdrop-blur">
      {dirty && <span className="mr-auto text-xs text-muted">Unsaved changes</span>}
      <button type="button" className="btn-ghost btn-sm" disabled={!dirty} onClick={onReset}>
        Discard
      </button>
      <button type="submit" className="btn-primary btn-sm" disabled={!dirty}>
        Save changes
      </button>
    </div>
  );
}

function useDraft() {
  const settings = useAdminStore((s) => s.settings);
  const update = useAdminStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<StoreSettings>(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update(draft);
    toast.success("Settings saved");
  };
  return { draft, setDraft, dirty, submit, reset: () => setDraft(settings) };
}

function StoreDetails() {
  const { draft: d, setDraft, dirty, submit, reset } = useDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setDraft({ ...d, [k]: v });
  return (
    <form
      onSubmit={(e) => {
        const errs: Record<string, string> = {};
        if (!d.storeName.trim()) errs.storeName = "Enter the store name.";
        if (!/^\S+@\S+\.\S+$/.test(d.email)) errs.email = "Enter a valid email.";
        setErrors(errs);
        if (Object.keys(errs).length) {
          e.preventDefault();
          return;
        }
        submit(e);
      }}
      noValidate
    >
      <Panel title="Brand" description="Name, tagline and logo used across the store and emails.">
        <div className="grid gap-5 md:grid-cols-[160px_1fr]">
          <div>
            <p className="field-label">Logo</p>
            <SingleImageUpload image={d.logo || null} onChange={(img) => set("logo", img ?? "")} alt="Store logo" aspect="aspect-square" hint="Square PNG or WebP" contain />
          </div>
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <TextField label="Store name" required value={d.storeName} error={errors.storeName} onChange={(e) => set("storeName", e.target.value)} />
            <TextField label="GSTIN" value={d.gstin} inputClassName="font-mono uppercase" onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
            <TextField className="sm:col-span-2" label="Tagline" value={d.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </div>
        </div>
      </Panel>
      <Panel className="mt-6" title="Contact details" description="Shown on the Contact page, footer and order emails.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Email" type="email" value={d.email} error={errors.email} onChange={(e) => set("email", e.target.value)} />
          <TextField label="Phone" type="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
          <TextField label="WhatsApp" type="tel" value={d.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
          <TextField label="Store hours" value={d.hours} onChange={(e) => set("hours", e.target.value)} />
          <TextAreaField className="sm:col-span-2" label="Store address" rows={2} value={d.address} onChange={(e) => set("address", e.target.value)} />
        </div>
      </Panel>
      <Panel className="mt-6" title="Social media">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["instagram", "facebook", "youtube"] as const).map((k) => (
            <TextField key={k} label={k[0].toUpperCase() + k.slice(1)} type="url" value={d.social[k]} onChange={(e) => set("social", { ...d.social, [k]: e.target.value })} />
          ))}
        </div>
        <SaveBar dirty={dirty} onReset={reset} />
      </Panel>
    </form>
  );
}

function Policies() {
  const { draft: d, setDraft, dirty, submit, reset } = useDraft();
  const p = d.policies;
  const set = <K extends keyof StoreSettings["policies"]>(k: K, v: StoreSettings["policies"][K]) => setDraft({ ...d, policies: { ...p, [k]: v } });
  return (
    <form onSubmit={submit}>
      <Panel title="Returns & exchanges" description="Summarised on product pages and at checkout. The full text lives on the policy pages.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Return window (days)" type="number" min={0} max={60} value={p.returnWindowDays} onChange={(e) => set("returnWindowDays", Math.max(0, Number(e.target.value)))} />
          <div className="flex items-end pb-2">
            <Switch className="w-full" label="Exchange only" description="No refunds — exchanges or store credit" checked={p.exchangeOnly} onChange={(v) => set("exchangeOnly", v)} />
          </div>
          <TextAreaField className="sm:col-span-2" label="Return policy summary" rows={3} value={p.returnPolicySummary} onChange={(e) => set("returnPolicySummary", e.target.value)} />
          <TextField className="sm:col-span-2" label="Privacy contact email" type="email" value={p.privacyContact} onChange={(e) => set("privacyContact", e.target.value)} />
        </div>
        <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
          {[
            ["Shipping policy", "/shipping-policy"],
            ["Return & refund policy", "/return-policy"],
            ["Privacy policy", "/privacy-policy"],
            ["Terms & conditions", "/terms"],
          ].map(([label, href]) => (
            <li key={href}>
              <a href={href} target="_blank" className="flex items-center justify-between rounded-xl border border-line px-4 py-3 hover:border-gold hover:bg-gold-soft/50">
                {label} <span className="text-xs text-muted">{href} ↗</span>
              </a>
            </li>
          ))}
        </ul>
        <SaveBar dirty={dirty} onReset={reset} />
      </Panel>
    </form>
  );
}

function Notifications() {
  const { draft: d, setDraft, dirty, submit, reset } = useDraft();
  const n = d.notifications;
  const items: { key: keyof StoreSettings["notifications"]; label: string; description: string }[] = [
    { key: "newOrder", label: "New orders", description: "An email and a bell notification for every paid order" },
    { key: "lowStock", label: "Low stock", description: "When a product reaches its alert level" },
    { key: "paymentFailed", label: "Failed payments", description: "When a customer's payment doesn't go through" },
    { key: "dailySummary", label: "Daily summary", description: "Yesterday's sales and orders, every morning at 9 AM" },
  ];
  return (
    <form onSubmit={submit}>
      <Panel title="Email & in-app alerts" description={`Sent to ${d.email}.`}>
        <ul className="space-y-5">
          {items.map((it) => (
            <li key={it.key}>
              <Switch label={it.label} description={it.description} checked={n[it.key]} onChange={(v) => setDraft({ ...d, notifications: { ...n, [it.key]: v } })} />
            </li>
          ))}
        </ul>
        <SaveBar dirty={dirty} onReset={reset} />
      </Panel>
    </form>
  );
}

function Payments() {
  return (
    <Panel title="Razorpay" description="Payment gateway for UPI, cards and net banking (India only).">
      <dl className="divide-y divide-line rounded-xl border border-line text-sm">
        {[
          ["Status", <Badge key="s" tone="success">Connected</Badge>],
          ["Mode", <Badge key="m" tone="gold">Test mode</Badge>],
          ["Key ID", <span key="k" className="font-mono text-xs">rzp_test_••••••••••</span>],
          ["Methods", "UPI · Cards · Net banking"],
          ["Currency", "INR (₹) only"],
          ["Cash on delivery", "Not offered"],
        ].map(([k, v]) => (
          <div key={k as string} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex gap-3 rounded-xl bg-canvas px-4 py-3 text-[13px] leading-5 text-muted">
        <KeyRound size={16} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
        <p>
          API keys are read from the server environment (<code className="font-mono text-ink">RAZORPAY_KEY_ID</code>, <code className="font-mono text-ink">RAZORPAY_KEY_SECRET</code>) and are never
          shown in the browser. Switching to live mode means replacing them with <code className="font-mono text-ink">rzp_live_</code> keys after account approval.
        </p>
      </div>
    </Panel>
  );
}

function Account() {
  const user = useAdminSession((s) => s.user);
  const resetDemo = useAdminStore((s) => s.resetDemo);
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  return (
    <>
      <Panel title="Profile">
        <div className="flex items-center gap-4">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-full font-display text-2xl font-semibold text-royal"
            style={{ backgroundImage: "linear-gradient(135deg, #e8cd7e 0%, #c9a54c 48%, #b08a32 100%)" }}
            aria-hidden
          >
            {user.avatarInitials}
          </span>
          <div>
            <p className="font-display text-2xl font-semibold">{user.name}</p>
            <p className="text-sm text-muted">{user.email}</p>
            <Badge tone="gold" className="mt-1.5">
              {user.role}
            </Badge>
          </div>
        </div>
      </Panel>
      <Panel className="mt-6" title="Change password">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.next.length < 8) return setError("Use at least 8 characters.");
            if (pw.next !== pw.again) return setError("The new passwords don't match.");
            setError(null);
            setPw({ current: "", next: "", again: "" });
            toast.info("Password changes will work once admin accounts move to the backend.");
          }}
          className="grid gap-4 sm:grid-cols-3"
          noValidate
        >
          <TextField label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <TextField label="New password" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <TextField label="Repeat new password" type="password" autoComplete="new-password" value={pw.again} error={error ?? undefined} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
          <div className="sm:col-span-3">
            <button type="submit" className="btn-dark btn-sm" disabled={!pw.current || !pw.next}>
              Update password
            </button>
          </div>
        </form>
      </Panel>
      <Panel className="mt-6" title="Demo data" description="Everything in this admin runs on sample data in your browser.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">Undo every change you&apos;ve made and restore the original sample products, orders and settings.</p>
          <button type="button" className="btn-outline btn-sm shrink-0" onClick={() => setConfirm(true)}>
            <RotateCcw size={15} aria-hidden /> Reset demo data
          </button>
        </div>
      </Panel>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Reset demo data?"
        description="All products, orders, coupons, banners and settings go back to the original sample data."
        confirmLabel="Reset"
        onConfirm={() => {
          resetDemo();
          toast.success("Demo data restored");
        }}
      />
    </>
  );
}

const VIEWS: Record<Section, () => ReactNode> = {
  store: () => <StoreDetails />,
  policies: () => <Policies />,
  notifications: () => <Notifications />,
  payments: () => <Payments />,
  account: () => <Account />,
};

export function SettingsView() {
  const params = useSearchParams();
  const initial = params.get("tab") as Section | null;
  const [section, setSection] = useState<Section>(initial && initial in VIEWS ? initial : "store");
  // The account tab is also reachable from the profile menu while already on this page.
  const [lastParam, setLastParam] = useState(initial);
  if (initial !== lastParam) {
    setLastParam(initial);
    if (initial && initial in VIEWS) setSection(initial);
  }

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Settings" }]} title="Store settings" description="Store information, contact details, logo, policies and your admin account." />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-1 lg:px-0">
          {SECTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSection(s.value)}
              aria-current={section === s.value ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors lg:rounded-xl",
                section === s.value ? "bg-ink text-white" : "bg-white text-ink hover:bg-sand lg:bg-transparent",
              )}
            >
              <s.icon size={17} aria-hidden />
              {s.label}
            </button>
          ))}
          <p className="mt-4 hidden gap-2 px-3 text-xs leading-5 text-muted lg:flex">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden /> Changes are kept for this browser session only (demo).
          </p>
        </nav>
        <div className="min-w-0">{VIEWS[section]()}</div>
      </div>
    </>
  );
}
