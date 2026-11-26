"use client";

import { useSearchParams } from "next/navigation";
import { Bell, CreditCard, FileText, Info, KeyRound, Loader2, RotateCcw, Store, UserCircle } from "lucide-react";
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import type { AdminSettingsView, StoreSettings } from "@/types/admin";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { cn } from "@/lib/utils";
import { adminApi, errorMessage, AdminApiError } from "@/lib/admin-api";
import { useAdminSession, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Badge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Switch, TextAreaField, TextField } from "../ui/FormControls";
import { SingleImageUpload } from "../ui/ImageUpload";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { LoadError } from "../ui/QueryState";

/** The loaded settings and a way to show the server's saved copy, shared by every section. */
const SettingsContext = createContext<{ view: AdminSettingsView; replace: (v: AdminSettingsView) => void; canWrite: boolean } | null>(null);
const useSettings = () => useContext(SettingsContext)!;

type Section = "store" | "policies" | "notifications" | "payments" | "account";

const SECTIONS: { value: Section; label: string; icon: typeof Store }[] = [
  { value: "store", label: "Store details", icon: Store },
  { value: "policies", label: "Policies", icon: FileText },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "payments", label: "Payments", icon: CreditCard },
  { value: "account", label: "My account", icon: UserCircle },
];

function SaveBar({ dirty, onReset, saving }: { dirty: boolean; onReset: () => void; saving?: boolean }) {
  const { canWrite } = useSettings();
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex items-center justify-end gap-2 border-t border-line bg-white/95 px-5 py-3 backdrop-blur">
      {!canWrite ? (
        <span className="mr-auto text-xs text-muted">Only the store owner can change settings.</span>
      ) : (
        dirty && <span className="mr-auto text-xs text-muted">Unsaved changes</span>
      )}
      <button type="button" className="btn-ghost btn-sm" disabled={!dirty || saving} onClick={onReset}>
        Discard
      </button>
      <button type="submit" className="btn-primary btn-sm" disabled={!dirty || saving || !canWrite}>
        {saving && <Loader2 size={14} className="animate-spin" aria-hidden />} Save changes
      </button>
    </div>
  );
}

type Part = "store" | "policies" | "notifications";

/** Edits a copy of the saved settings; saving sends only this section's fields. */
function useDraft(part: Part) {
  const { view, replace } = useSettings();
  const settings = view.settings;
  const [draft, setDraft] = useState<StoreSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const body = () => {
    if (part === "policies") return { policies: draft.policies };
    if (part === "notifications") return { notifications: draft.notifications };
    const { storeName, tagline, logo, email, phone, whatsapp, address, hours, gstin } = draft;
    return { store: { storeName, tagline, logo, email, phone, whatsapp, address, hours, gstin }, social: draft.social, seo: draft.seo };
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setServerErrors({});
    try {
      const { data } = await adminApi<AdminSettingsView>("/settings", { method: "PATCH", body: { version: view.version, ...body() } });
      replace(data);
      setDraft(data.settings);
      toast.success("Settings saved");
    } catch (err) {
      const issues = err instanceof AdminApiError ? err.issues : undefined;
      setServerErrors(Object.fromEntries((issues ?? []).map((i) => [i.path.split(".").pop() ?? i.path, i.message])));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return { draft, setDraft, dirty, submit, saving, serverErrors, reset: () => setDraft(settings) };
}

function StoreDetails() {
  const { draft: d, setDraft, dirty, submit, reset, saving, serverErrors } = useDraft("store");
  const [localErrors, setErrors] = useState<Record<string, string>>({});
  const errors = { ...serverErrors, ...localErrors };
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
        void submit(e);
      }}
      noValidate
    >
      <Panel title="Brand" description="Name, tagline and logo used across the store and emails.">
        <div className="grid gap-5 md:grid-cols-[160px_1fr]">
          <div>
            <p className="field-label">Logo</p>
            <SingleImageUpload image={d.logo || null} onChange={(img) => set("logo", img ?? "")} alt="Store logo" aspect="aspect-square" hint="Square PNG or WebP" contain purpose="logo" />
          </div>
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <TextField label="Store name" required maxLength={80} value={d.storeName} error={errors.storeName} onChange={(e) => set("storeName", e.target.value)} />
            <TextField label="GSTIN" maxLength={15} value={d.gstin} error={errors.gstin} inputClassName="font-mono uppercase" onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
            <TextField className="sm:col-span-2" label="Tagline" maxLength={120} value={d.tagline} onChange={(e) => set("tagline", e.target.value)} />
            {errors.logo && <p className="field-error sm:col-span-2">{errors.logo}</p>}
          </div>
        </div>
      </Panel>
      <Panel className="mt-6" title="Contact details" description="Shown on the Contact page, footer and order emails.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Email" type="email" value={d.email} error={errors.email} onChange={(e) => set("email", e.target.value)} />
          <TextField label="Phone" type="tel" value={d.phone} error={errors.phone} onChange={(e) => set("phone", e.target.value)} />
          <TextField label="WhatsApp" type="tel" value={d.whatsapp} error={errors.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
          <TextField label="Store hours" maxLength={120} value={d.hours} onChange={(e) => set("hours", e.target.value)} />
          <TextAreaField className="sm:col-span-2" label="Store address" rows={2} maxLength={300} value={d.address} onChange={(e) => set("address", e.target.value)} />
        </div>
      </Panel>
      <Panel className="mt-6" title="Social media">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["instagram", "facebook", "youtube"] as const).map((k) => (
            <TextField key={k} label={k[0].toUpperCase() + k.slice(1)} type="url" value={d.social[k]} error={errors[k]} onChange={(e) => set("social", { ...d.social, [k]: e.target.value })} />
          ))}
        </div>
      </Panel>
      <Panel className="mt-6" title="Search engines" description="Default title and description for search results and link previews.">
        <div className="grid gap-4">
          <TextField
            label="Default page title"
            maxLength={70}
            value={d.seo?.title ?? ""}
            hint={`${(d.seo?.title ?? "").length}/70 characters`}
            onChange={(e) => set("seo", { title: e.target.value, description: d.seo?.description ?? "" })}
          />
          <TextAreaField
            label="Default description"
            rows={2}
            maxLength={160}
            value={d.seo?.description ?? ""}
            hint={`${(d.seo?.description ?? "").length}/160 characters`}
            onChange={(e) => set("seo", { title: d.seo?.title ?? "", description: e.target.value })}
          />
        </div>
        <SaveBar dirty={dirty} onReset={reset} saving={saving} />
      </Panel>
    </form>
  );
}

function Policies() {
  const { draft: d, setDraft, dirty, submit, reset, saving, serverErrors } = useDraft("policies");
  const p = d.policies;
  const set = <K extends keyof StoreSettings["policies"]>(k: K, v: StoreSettings["policies"][K]) => setDraft({ ...d, policies: { ...p, [k]: v } });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <Panel title="Returns & exchanges" description="Summarised on product pages and at checkout. The full text lives on the policy pages.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Return window (days)" type="number" min={0} max={60} value={p.returnWindowDays} onChange={(e) => set("returnWindowDays", Math.max(0, Number(e.target.value)))} />
          <div className="flex items-end pb-2">
            <Switch className="w-full" label="Exchange only" description="No refunds — exchanges or store credit" checked={p.exchangeOnly} onChange={(v) => set("exchangeOnly", v)} />
          </div>
          <TextAreaField className="sm:col-span-2" label="Return policy summary" rows={3} maxLength={1000} value={p.returnPolicySummary} onChange={(e) => set("returnPolicySummary", e.target.value)} />
          <TextField className="sm:col-span-2" label="Privacy contact email" type="email" value={p.privacyContact} error={serverErrors.privacyContact} onChange={(e) => set("privacyContact", e.target.value)} />
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
        <SaveBar dirty={dirty} onReset={reset} saving={saving} />
      </Panel>
    </form>
  );
}

function Notifications() {
  const { draft: d, setDraft, dirty, submit, reset, saving } = useDraft("notifications");
  const n = d.notifications;
  const items: { key: keyof StoreSettings["notifications"]; label: string; description: string }[] = [
    { key: "newOrder", label: "New orders", description: "An email and a bell notification for every paid order" },
    { key: "lowStock", label: "Low stock", description: "When a product reaches its alert level" },
    { key: "paymentFailed", label: "Failed payments", description: "When a customer's payment doesn't go through" },
    { key: "dailySummary", label: "Daily summary", description: "Yesterday's sales and orders, every morning at 9 AM" },
  ];
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Panel title="Email & in-app alerts" description={`Sent to ${d.email}.`}>
        <ul className="space-y-5">
          {items.map((it) => (
            <li key={it.key}>
              <Switch label={it.label} description={it.description} checked={n[it.key]} onChange={(v) => setDraft({ ...d, notifications: { ...n, [it.key]: v } })} />
            </li>
          ))}
        </ul>
        <SaveBar dirty={dirty} onReset={reset} saving={saving} />
      </Panel>
    </form>
  );
}

function Payments() {
  const { payments, locked } = useSettings().view;
  return (
    <Panel title="Razorpay" description="Payment gateway for UPI, cards and net banking (India only).">
      <dl className="divide-y divide-line rounded-xl border border-line text-sm">
        {[
          ["Status", payments.configured ? <Badge key="s" tone="success">Connected</Badge> : <Badge key="s" tone="danger">Not configured</Badge>],
          ["Mode", payments.mode === "live" ? <Badge key="m" tone="success">Live mode</Badge> : payments.mode === "test" ? <Badge key="m" tone="gold">Test mode</Badge> : "—"],
          ["Key ID", <span key="k" className="font-mono text-xs">{payments.keyIdMasked ?? "—"}</span>],
          ["Webhook", payments.webhookConfigured ? <Badge key="w" tone="success">Secret set</Badge> : <Badge key="w" tone="warning">Secret not set</Badge>],
          ["Methods", "UPI · Cards · Net banking"],
          ["Currency", `${locked.currency} (₹) only`],
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
          shown in the browser or changed from here. Switching to live mode means replacing them with <code className="font-mono text-ink">rzp_live_</code> keys after account approval and setting{" "}
          <code className="font-mono text-ink">RAZORPAY_ALLOW_LIVE=true</code>.
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
            if (pw.next.length < 12) return setError("Use at least 12 characters, including a letter and a number.");
            if (pw.next !== pw.again) return setError("The new passwords don't match.");
            setError(null);
            void adminApi<{ otherSessionsSignedOut: number }>("/auth/change-password", {
              method: "POST",
              body: { currentPassword: pw.current, newPassword: pw.next },
            })
              .then(({ data }) => {
                setPw({ current: "", next: "", again: "" });
                toast.success(
                  data.otherSessionsSignedOut
                    ? `Password updated. Signed out of ${data.otherSessionsSignedOut} other device${data.otherSessionsSignedOut === 1 ? "" : "s"}.`
                    : "Password updated.",
                );
              })
              .catch((err) => setError(errorMessage(err)));
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
      <Panel className="mt-6" title="Dashboard sample data" description="The dashboard overview, notifications and activity feed still use sample data in your browser.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">Restore the original sample dashboard data. Products, orders, customers, payments, coupons, banners and settings live in the database and aren&apos;t affected.</p>
          <button type="button" className="btn-outline btn-sm shrink-0" onClick={() => setConfirm(true)}>
            <RotateCcw size={15} aria-hidden /> Reset demo data
          </button>
        </div>
      </Panel>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Reset demo data?"
        description="Only the sample dashboard data in this browser is reset. Nothing in the database changes."
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
  const { data, status, error, reload, replace } = useAdminQuery<AdminSettingsView>("/settings");
  const canWrite = useAdminSession((s) => s.can("settings:write"));
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
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden /> India only · INR only · Cash on Delivery off · &ldquo;Shipping Charges Applicable&rdquo; — fixed for every store.
          </p>
        </nav>
        <div className="min-w-0">
          {section === "account" ? (
            <Account />
          ) : status === "loading" ? (
            <div className="skeleton h-96 rounded-2xl" role="status" aria-label="Loading" />
          ) : status === "error" || !data ? (
            <div className="card">
              <LoadError title="Couldn't load settings" message={error} onRetry={reload} />
            </div>
          ) : (
            <SettingsContext.Provider value={{ view: data, replace, canWrite }}>
              <div key={data.version}>{VIEWS[section]()}</div>
            </SettingsContext.Provider>
          )}
        </div>
      </div>
    </>
  );
}
