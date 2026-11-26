"use client";

import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ExternalLink, GalleryHorizontalEnd, Image as ImageIcon, LayoutList, Loader2, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { BannerPlacement, HomepageBanner, HomepageSection } from "@/types/admin";
import { istDateKey } from "@/data/admin/mock-utils";
import { getAudience } from "@/data/audiences";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi, errorMessage, AdminApiError } from "@/lib/admin-api";
import { imageDetails } from "@/lib/admin-upload";
import { cn, formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { ProductImage } from "@/components/ui/ProductImage";
import { Badge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { SelectField, Switch, TextField } from "../ui/FormControls";
import { SingleImageUpload } from "../ui/ImageUpload";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { LoadError } from "../ui/QueryState";

interface HomepageData {
  banners: HomepageBanner[];
  featuredProductIds: string[];
  sections: HomepageSection[];
}

const MAX_FEATURED = 8;
const ASPECT: Record<BannerPlacement, string> = { hero: "aspect-[4/5]", promo: "aspect-[21/9]" };
const toDateInput = (iso: string | null) => (iso ? istDateKey(iso) : "");
const fromDateInput = (d: string, end = false) => (d ? new Date(`${d}T${end ? "23:59:00" : "00:00:00"}+05:30`).toISOString() : null);

function bannerState(b: HomepageBanner) {
  const now = Date.now();
  if (!b.active) return { label: "Off", tone: "neutral" as const };
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return { label: `From ${formatDate(b.startsAt)}`, tone: "gold" as const };
  if (b.endsAt && new Date(b.endsAt).getTime() < now) return { label: "Ended", tone: "muted" as const };
  return { label: "Live", tone: "success" as const };
}

/* ---------- banner form ---------- */

function BannerForm({ banner, placement, onDone }: { banner: HomepageBanner | null; placement: BannerPlacement; onDone: (saved: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [b, setB] = useState<HomepageBanner>(
    () =>
      banner ?? {
        id: "",
        placement,
        eyebrow: "",
        title: "",
        subtitle: "",
        ctaLabel: "Shop Now",
        ctaHref: "/shop",
        image: "",
        active: true,
        startsAt: null,
        endsAt: null,
      },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof HomepageBanner>(k: K, v: HomepageBanner[K]) => setB((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!b.title.trim()) errs.title = "Enter a headline.";
    if (!b.image) errs.image = "Upload a banner image.";
    if (!b.ctaHref.startsWith("/") && !b.ctaHref.startsWith("https://")) errs.ctaHref = "Use a store path like /shop or a full https:// link.";
    if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) errs.endsAt = "End date must be after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // The upload registry knows the Cloudinary public ID of images uploaded in this tab.
    const details = imageDetails([b.image], b.title)[0];
    const image = { url: b.image, publicId: details.publicId ?? (b.image === banner?.image ? banner?.imagePublicId : null) ?? null, width: details.width ?? null, height: details.height ?? null };
    const body = {
      placement: b.placement,
      eyebrow: b.eyebrow.trim(),
      title: b.title.trim(),
      subtitle: b.subtitle.trim(),
      ctaLabel: b.ctaLabel.trim(),
      ctaHref: b.ctaHref.trim(),
      image,
      active: b.active,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    };
    setSaving(true);
    try {
      if (banner) await adminApi(`/banners/${banner.id}`, { method: "PATCH", body });
      else await adminApi("/banners", { method: "POST", body });
      toast.success(banner ? "Banner updated" : "Banner added");
      onDone(true);
    } catch (err) {
      const issues = err instanceof AdminApiError ? err.issues : undefined;
      const fieldErrs = Object.fromEntries((issues ?? []).map((i) => [i.path.split(".")[0], i.message]));
      setErrors(Object.keys(fieldErrs).length ? fieldErrs : { form: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <div className="grid gap-5 px-5 py-5 md:grid-cols-[minmax(0,240px)_1fr]">
        <div>
          <p className="field-label">Image</p>
          <SingleImageUpload
            image={b.image || null}
            onChange={(img) => set("image", img ?? "")}
            alt={b.title || "Banner"}
            aspect={ASPECT[b.placement]}
            purpose="banner"
            hint={b.placement === "hero" ? "Portrait, 4:5 · at least 1200px tall" : "Wide, 21:9 · at least 1600px wide"}
          />
          {errors.image && <p className="field-error">{errors.image}</p>}
        </div>
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <SelectField
            label="Placement"
            value={b.placement}
            onChange={(e) => set("placement", e.target.value as BannerPlacement)}
            options={[
              { value: "hero", label: "Hero (top of homepage)" },
              { value: "promo", label: "Promotional strip" },
            ]}
          />
          <TextField label="Eyebrow" maxLength={60} value={b.eyebrow} placeholder="e.g. New Season" onChange={(e) => set("eyebrow", e.target.value)} />
          <TextField className="sm:col-span-2" label="Headline" required maxLength={120} value={b.title} error={errors.title} onChange={(e) => set("title", e.target.value)} data-autofocus />
          <TextField className="sm:col-span-2" label="Supporting text" maxLength={300} value={b.subtitle} error={errors.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
          <TextField label="Button label" maxLength={40} value={b.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} />
          <TextField label="Button link" maxLength={300} value={b.ctaHref} error={errors.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} />
          <TextField label="Show from" type="date" value={toDateInput(b.startsAt)} hint="Optional" onChange={(e) => set("startsAt", fromDateInput(e.target.value))} />
          <TextField label="Show until" type="date" value={toDateInput(b.endsAt)} error={errors.endsAt} hint="Optional" onChange={(e) => set("endsAt", fromDateInput(e.target.value, true))} />
          <Switch className="sm:col-span-2" label="Active" description="Inactive banners are saved but not shown" checked={b.active} onChange={(v) => set("active", v)} />
          {(errors.form || errors.image) && b.image && (
            <p className="field-error sm:col-span-2" role="alert">
              {errors.form ?? errors.image}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => onDone(false)} className="btn-ghost btn-sm" disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {banner ? "Save banner" : "Add banner"}
        </button>
      </div>
    </form>
  );
}

function BannerCard({
  b,
  onEdit,
  onDelete,
  onToggle,
  onMove,
  first,
  last,
  busy,
}: {
  b: HomepageBanner;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (active: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
  busy: boolean;
}) {
  const state = bannerState(b);
  const hero = b.placement === "hero";
  return (
    <li className={cn("card overflow-hidden", hero ? "grid grid-cols-[120px_1fr] sm:grid-cols-[150px_1fr]" : "")}>
      <div className={cn("relative bg-sand", hero ? "min-h-full" : "aspect-[21/9]")}>
        {b.image && <ProductImage src={b.image} alt="" fill sizes={hero ? "150px" : "600px"} unoptimized={b.image.startsWith("blob:")} />}
        {!hero && (
          <div className="absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-royal/85 via-royal/50 to-transparent p-5 text-white">
            {b.eyebrow && <p className="text-[10px] font-semibold tracking-[0.18em] text-gold-light uppercase">{b.eyebrow}</p>}
            <p className="mt-1 max-w-xs font-display text-2xl leading-tight font-semibold">{b.title}</p>
            <span className="mt-3 inline-flex w-fit rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-ink">{b.ctaLabel}</span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {hero && b.eyebrow && <p className="text-[10.5px] font-semibold tracking-[0.16em] text-accent uppercase">{b.eyebrow}</p>}
            <p className={cn("font-semibold", hero && "mt-0.5 font-display text-xl leading-tight")}>{hero ? b.title : b.subtitle || b.title}</p>
          </div>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        {hero && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{b.subtitle}</p>}
        <p className="mt-2 text-xs text-muted">
          Button: <span className="font-medium text-ink">{b.ctaLabel}</span> → {b.ctaHref}
        </p>
        <div className="mt-auto flex items-center justify-end gap-1 pt-3">
          <Switch hideLabel label={`${b.active ? "Turn off" : "Turn on"} “${b.title}”`} checked={b.active} disabled={busy} onChange={onToggle} className="mr-auto" />
          <button type="button" className="icon-btn h-9 w-9 text-muted disabled:opacity-30" disabled={first || busy} onClick={() => onMove(-1)} aria-label={`Show “${b.title}” earlier`}>
            <ArrowLeft size={15} />
          </button>
          <button type="button" className="icon-btn h-9 w-9 text-muted disabled:opacity-30" disabled={last || busy} onClick={() => onMove(1)} aria-label={`Show “${b.title}” later`}>
            <ArrowRight size={15} />
          </button>
          <button type="button" className="icon-btn h-9 w-9 text-muted" onClick={onEdit} aria-label={`Edit “${b.title}”`}>
            <Pencil size={15} />
          </button>
          <button type="button" className="icon-btn h-9 w-9 text-muted hover:bg-danger-soft hover:text-danger" onClick={onDelete} aria-label={`Delete “${b.title}”`}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </li>
  );
}

/* ---------- featured picker ---------- */

function FeaturedPicker({ current, onSave, onDone }: { current: string[]; onSave: (ids: string[]) => Promise<boolean>; onDone: () => void }) {
  const products = useAdminStore((s) => s.products);
  const [picked, setPicked] = useState<string[]>(current);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => p.status === "active" && (!t || p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t))).slice(0, 60);
  }, [products, q]);

  return (
    <>
      <div className="border-b border-line px-5 py-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search active products" aria-label="Search products" className="field-input field-sm pl-10" data-autofocus />
        </div>
        <p className="mt-2 text-xs text-muted">
          {picked.length} of {MAX_FEATURED} selected
        </p>
      </div>
      <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
        {list.map((p) => {
          const on = picked.includes(p.id);
          const full = !on && picked.length >= MAX_FEATURED;
          return (
            <li key={p.id}>
              <label className={cn("flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-canvas", full && "cursor-not-allowed opacity-50")}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => setPicked(on ? picked.filter((x) => x !== p.id) : [...picked, p.id])} className="h-4 w-4" />
                <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-sand">
                  {p.images[0] && <ProductImage src={p.images[0]} alt="" fill sizes="40px" unoptimized={p.images[0].startsWith("blob:")} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted">
                    {getAudience(p.audienceCategory).label} · {formatPrice(p.price)}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button type="button" onClick={onDone} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const ok = await onSave(picked);
            setSaving(false);
            if (ok) onDone();
          }}
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />} Save selection
        </button>
      </div>
    </>
  );
}

/* ---------- page ---------- */

export function HomepageView() {
  const { data, status, error, reload, replace } = useAdminQuery<HomepageData>("/homepage");
  const products = useAdminStore((s) => s.products);
  const banners = data?.banners ?? [];
  const featuredIds = data?.featuredProductIds ?? [];
  const sections = data?.sections ?? [];
  const [form, setForm] = useState<{ open: boolean; banner: HomepageBanner | null; placement: BannerPlacement }>({ open: false, banner: null, placement: "hero" });
  const [picker, setPicker] = useState(false);
  const [deleting, setDeleting] = useState<HomepageBanner | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** Runs one change; on success shows the server's state (or reloads it). */
  const run = async (key: string, fn: () => Promise<HomepageData | null>, message?: string) => {
    setBusy(key);
    try {
      const next = await fn();
      if (next) replace(next);
      else reload();
      if (message) toast.success(message);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const setFeatured = (ids: string[], message = "Featured products updated") =>
    run("featured", async () => (await adminApi<HomepageData>("/homepage/featured", { method: "PUT", body: { productIds: ids } })).data, message);

  const featured = featuredIds.map((id) => products.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const move = (i: number, d: -1 | 1) => {
    const next = [...featuredIds];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void setFeatured(next, "Order updated");
  };

  const bannerSection = (placement: BannerPlacement, title: string, description: string, icon: React.ReactNode) => {
    const list = banners.filter((b) => b.placement === placement);
    return (
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            {icon} {title}
          </span>
        }
        description={description}
        action={
          <button type="button" className="btn-outline btn-sm" onClick={() => setForm({ open: true, banner: null, placement })}>
            <Plus size={15} aria-hidden /> Add
          </button>
        }
      >
        {list.length ? (
          <ul className={cn("grid gap-4", placement === "hero" ? "lg:grid-cols-2" : "md:grid-cols-2")}>
            {list.map((b, i) => (
              <BannerCard
                key={b.id}
                b={b}
                first={i === 0}
                last={i === list.length - 1}
                busy={busy === b.id}
                onEdit={() => setForm({ open: true, banner: b, placement })}
                onDelete={() => setDeleting(b)}
                onToggle={(active) =>
                  void run(b.id, async () => {
                    await adminApi(`/banners/${b.id}`, { method: "PATCH", body: { active } });
                    return null;
                  }, active ? "Banner turned on" : "Banner turned off")
                }
                onMove={(direction) => void run(b.id, async () => (await adminApi<HomepageData>(`/banners/${b.id}/move`, { method: "POST", body: { direction } })).data)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted">No {title.toLowerCase()} yet.</p>
        )}
      </Panel>
    );
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Homepage" }]}
        title="Homepage"
        description="Choose what shoppers see first: hero banners, promotions, featured products and which sections appear."
        actions={
          <Link href="/" target="_blank" className="btn-outline btn-sm">
            <ExternalLink size={15} aria-hidden /> Preview homepage
          </Link>
        }
      />

      {status === "loading" ? (
        <div className="space-y-6" role="status" aria-label="Loading">
          <div className="skeleton h-64 rounded-2xl" />
          <div className="skeleton h-48 rounded-2xl" />
        </div>
      ) : status === "error" ? (
        <div className="card">
          <LoadError title="Couldn't load the homepage settings" message={error} onRetry={reload} />
        </div>
      ) : (
      <div className="space-y-6">
        {bannerSection("hero", "Hero banners", "The large banner at the top. When several are live they rotate.", <ImageIcon size={16} className="text-gold-dark" aria-hidden />)}
        {bannerSection("promo", "Promotional banners", "Wide strips between homepage sections.", <GalleryHorizontalEnd size={16} className="text-gold-dark" aria-hidden />)}

        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles size={16} className="text-gold-dark" aria-hidden /> Featured products
              </span>
            }
            description={`Shown in “Featured Collections”, in this order. Up to ${MAX_FEATURED}.`}
            action={
              <button type="button" className="btn-outline btn-sm" onClick={() => setPicker(true)}>
                <Plus size={15} aria-hidden /> Choose
              </button>
            }
          >
            {featured.length ? (
              <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {featured.map((p, i) => (
                  <li key={p.id} className="group">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-sand">
                      {p.images[0] && <ProductImage src={p.images[0]} alt="" fill sizes="200px" unoptimized={p.images[0].startsWith("blob:")} />}
                      <span className="absolute top-2 left-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-royal/85 px-1.5 text-[11px] font-bold text-gold-light">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => void setFeatured(featuredIds.filter((id) => id !== p.id), "Removed from featured")}
                        disabled={busy === "featured"}
                        className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-ink shadow hover:text-danger"
                        aria-label={`Remove ${p.name} from featured`}
                      >
                        <X size={14} />
                      </button>
                      <div className="absolute inset-x-2 bottom-2 flex justify-between">
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow disabled:opacity-0" aria-label={`Move ${p.name} earlier`}>
                          <ArrowUp size={14} className="-rotate-90" />
                        </button>
                        <button
                          type="button"
                          disabled={i === featured.length - 1}
                          onClick={() => move(i, 1)}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow disabled:opacity-0"
                          aria-label={`Move ${p.name} later`}
                        >
                          <ArrowDown size={14} className="-rotate-90" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted">{formatPrice(p.price)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-6 text-center text-sm text-muted">No featured products — the section will be hidden.</p>
            )}
          </Panel>

          <Panel
            className="self-start"
            title={
              <span className="inline-flex items-center gap-2">
                <LayoutList size={16} className="text-gold-dark" aria-hidden /> Sections
              </span>
            }
            description="Turn homepage sections on or off."
          >
            <ul className="space-y-4">
              {sections.map((s) => (
                <li key={s.id}>
                  <Switch
                    label={s.label}
                    description={s.description}
                    checked={s.visible}
                    disabled={busy === `section-${s.id}`}
                    onChange={(visible) =>
                      void run(`section-${s.id}`, async () => (await adminApi<HomepageData>("/homepage/sections", { method: "PATCH", body: { key: s.id, visible } })).data)
                    }
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      )}

      <Dialog open={form.open} onClose={() => setForm((f) => ({ ...f, open: false }))} title={form.banner ? "Edit banner" : "Add banner"} size="xl">
        {form.open && (
          <BannerForm
            key={form.banner?.id ?? `new-${form.placement}`}
            banner={form.banner}
            placement={form.placement}
            onDone={(saved) => {
              setForm((f) => ({ ...f, open: false }));
              if (saved) reload();
            }}
          />
        )}
      </Dialog>
      <Dialog open={picker} onClose={() => setPicker(false)} title="Choose featured products" size="lg">
        {picker && <FeaturedPicker current={featuredIds} onSave={(ids) => setFeatured(ids)} onDone={() => setPicker(false)} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete banner?"
        description={
          <>
            “<strong className="text-ink">{deleting?.title}</strong>” will be removed from the homepage.
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          void run(id, async () => {
            await adminApi(`/banners/${id}`, { method: "DELETE" });
            return null;
          }, "Banner deleted");
        }}
      />
    </>
  );
}
