import "server-only";
import type { z } from "zod";
import type { AdminSettingsView, ShippingSettings, StoreSettings as StoreSettingsView } from "@/types/admin";
import { isConfigured } from "@/server/config/env";
import { connectToDatabase } from "@/server/db/connect";
import { badRequest, conflict } from "@/server/http/errors";
import { MediaAsset } from "@/server/models/media-asset.model";
import { StoreSettings } from "@/server/models/store-settings.model";
import type { settingsUpdateBody, shippingUpdateBody } from "@/server/validation/admin-marketing";
import { getRazorpayConfig } from "@/lib/razorpay/server";
import { settingsDoc } from "./admin-homepage.service";
import { audit, type AuditActor } from "./audit.service";
import { refreshHomepage } from "./homepage.service";
import { cleanupImages } from "./media.service";

/**
 * Store settings (the single "store" document). Business rules that must never change from the
 * admin are fixed here, not just hidden in the UI: India only, INR only, no Cash on Delivery, and
 * the customer-facing shipping text is exactly "Shipping Charges Applicable". Environment
 * variables and secrets are never read into or returned from this service (payment status is
 * reported as configured/mode only, with the public key ID masked).
 */

export const SHIPPING_NOTICE = "Shipping Charges Applicable" as const;
const DEFAULT_LOGO = "/brand/logo-320.webp";

/* eslint-disable @typescript-eslint/no-explicit-any -- the settings document is a nested, loosely-typed record */
type Doc = Record<string, any>;

function toView(d: Doc): AdminSettingsView {
  const s = d.store ?? {};
  const settings: StoreSettingsView = {
    storeName: s.name ?? "M&M COLLECTIONS",
    tagline: s.tagline ?? "",
    logo: s.logo || DEFAULT_LOGO,
    email: s.email ?? "",
    phone: s.phone ?? "",
    whatsapp: s.whatsapp ?? "",
    address: s.address ?? "",
    hours: s.hours ?? "",
    gstin: s.gstin ?? "",
    social: { instagram: d.social?.instagram ?? "", facebook: d.social?.facebook ?? "", youtube: d.social?.youtube ?? "" },
    policies: {
      returnWindowDays: d.policies?.returnWindowDays ?? 7,
      exchangeOnly: !!d.policies?.exchangeOnly,
      returnPolicySummary: d.policies?.returnPolicySummary ?? "",
      privacyContact: d.policies?.privacyContact ?? "",
    },
    notifications: {
      newOrder: d.notifications?.newOrder !== false,
      lowStock: d.notifications?.lowStock !== false,
      paymentFailed: d.notifications?.paymentFailed !== false,
      dailySummary: !!d.notifications?.dailySummary,
    },
    seo: { title: d.seo?.title ?? "", description: d.seo?.description ?? "" },
  };
  const shipping: ShippingSettings = {
    chargesNotice: SHIPPING_NOTICE,
    deliveryEstimate: d.shipping?.deliveryEstimate ?? "",
    dispatchTime: d.shipping?.dispatchTime ?? "",
    country: "India",
    couriers: (d.shipping?.couriers ?? []).map((c: Doc) => ({ id: c.key, name: c.name, trackingUrlTemplate: c.trackingUrlTemplate ?? "", enabled: c.enabled !== false })),
  };
  const rp = getRazorpayConfig();
  return {
    settings,
    shipping,
    payments: {
      configured: !!rp,
      mode: rp?.mode ?? null,
      keyIdMasked: rp ? `${rp.keyId.slice(0, 9)}••••${rp.keyId.slice(-2)}` : null,
      webhookConfigured: isConfigured("razorpayWebhook"),
    },
    locked: { currency: "INR", country: "India", codEnabled: false, shippingNotice: SHIPPING_NOTICE },
    version: new Date(d.updatedAt ?? d.createdAt ?? 0).toISOString(),
  };
}

export async function getSettings() {
  return toView((await settingsDoc()) as Doc);
}

/** Only a confirmed admin upload (purpose "logo"), a site path, or the current logo may be used. */
async function checkLogo(logo: string, current: string) {
  if (logo === current || logo === "") return logo || DEFAULT_LOGO;
  if (/^\/[\w\-./]+\.(png|webp|svg|jpg|jpeg|avif)$/i.test(logo)) return logo;
  const asset = await MediaAsset.findOne({ url: logo, purpose: "logo", status: { $in: ["uploaded", "attached"] } }).lean();
  if (!asset) throw badRequest("Upload the logo through the admin panel.");
  await MediaAsset.updateOne({ _id: asset._id }, { $set: { status: "attached" } });
  return logo;
}

/** Writes `set` only if the settings haven't changed since `version` (when given). */
async function guardedUpdate(version: string | undefined, set: Record<string, unknown>) {
  const filter: Record<string, unknown> = { key: "store" };
  if (version) filter.updatedAt = new Date(version);
  // Fixed business rules are re-asserted on every write.
  const res = await StoreSettings.updateOne(filter, { $set: { ...set, "shipping.chargesNotice": SHIPPING_NOTICE, "shipping.country": "India", "checkout.codEnabled": false } }, { runValidators: true });
  if (!res.matchedCount) throw conflict("These settings were changed by someone else. Reload to see the latest, then save again.");
}

export async function updateSettings(input: z.output<typeof settingsUpdateBody>, actor: AuditActor) {
  const before = (await settingsDoc()) as Doc;
  await connectToDatabase();
  const set: Record<string, unknown> = {};
  const FIELD = { storeName: "name", tagline: "tagline", logo: "logo", email: "email", phone: "phone", whatsapp: "whatsapp", address: "address", hours: "hours", gstin: "gstin" } as const;
  let oldLogo: string | null = null;
  for (const [k, v] of Object.entries(input.store ?? {})) {
    if (v === undefined) continue;
    const field = FIELD[k as keyof typeof FIELD];
    if (k === "logo") {
      const logo = await checkLogo(String(v), before.store?.logo ?? DEFAULT_LOGO);
      if (logo !== before.store?.logo) oldLogo = before.store?.logo ?? null;
      set[`store.${field}`] = logo;
    } else set[`store.${field}`] = v;
  }
  for (const section of ["social", "policies", "notifications", "seo"] as const) {
    for (const [k, v] of Object.entries(input[section] ?? {})) if (v !== undefined) set[`${section}.${k}`] = v;
  }

  const changed = Object.keys(set).filter((path) => {
    const old = path.split(".").reduce<any>((o, key) => o?.[key], before);
    return JSON.stringify(old ?? null) !== JSON.stringify(set[path]);
  });
  if (changed.length) {
    await guardedUpdate(input.version, set);
    await audit(actor, "settings.update", { type: "settings", id: "store" }, { fields: changed });
    if (oldLogo) {
      const asset = await MediaAsset.findOne({ url: oldLogo }, { publicId: 1 }).lean();
      if (asset?.publicId) await cleanupImages([asset.publicId as string]);
    }
    refreshHomepage();
  }
  return getSettings();
}

export async function updateShipping(input: z.output<typeof shippingUpdateBody>, actor: AuditActor) {
  const before = (await settingsDoc()) as Doc;
  const couriers = input.couriers.map((c) => ({ key: c.id, name: c.name, trackingUrlTemplate: c.trackingUrlTemplate, enabled: c.enabled }));
  await guardedUpdate(input.version, {
    "shipping.deliveryEstimate": input.deliveryEstimate,
    "shipping.dispatchTime": input.dispatchTime,
    "shipping.couriers": couriers,
  });
  await audit(actor, "settings.shipping", { type: "settings", id: "shipping" }, {
    deliveryEstimate: before.shipping?.deliveryEstimate !== input.deliveryEstimate,
    dispatchTime: before.shipping?.dispatchTime !== input.dispatchTime,
    couriers: couriers.map((c) => `${c.name}${c.enabled ? "" : " (off)"}`),
  });
  return getSettings();
}
