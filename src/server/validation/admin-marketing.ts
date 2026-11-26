import "server-only";
import { z } from "zod";
import { objectId, pagination } from "./common";

/**
 * Admin coupons, offers, homepage banners and store settings. Money is always integer paise.
 */

const text = (max: number) => z.string().trim().max(max);
const paise = z.number().int("Amount must be in whole paise.").min(0).max(10_000_000_00);
const ref = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid reference.");
const slugRef = z.string().trim().toLowerCase().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid category.");
const isoDate = z.coerce.date({ error: "Use a valid date." });

/* ---------- Coupons ---------- */

export const COUPON_STATES = ["live", "scheduled", "expired", "used_up", "disabled"] as const;

export const couponListQuery = pagination.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: text(40).optional().transform((v) => v || undefined),
  state: z.enum(COUPON_STATES).optional(),
});

/** Coupon fields without defaults — so a partial update only ever contains what was sent. */
const couponCore = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,40}$/, "Use 3–40 letters, numbers, - or _ (no spaces)."),
  description: text(200),
  type: z.enum(["percent", "flat"]),
  /** Percent (1–90) for percentage coupons; paise for flat coupons. */
  value: z.number().int("Use a whole number.").min(1),
  minOrderPaise: paise,
  maxDiscountPaise: paise.min(100, "The cap must be at least ₹1.").nullable(),
  startsAt: isoDate,
  endsAt: isoDate.nullable(),
  usageLimit: z.number().int().min(1).max(10_000_000).nullable(),
  perCustomerLimit: z.number().int().min(1).max(1000).nullable(),
  active: z.boolean(),
  listed: z.boolean(),
  products: z.array(ref).max(200),
  categories: z.array(slugRef).max(100),
  excludedProducts: z.array(ref).max(200),
  excludedCategories: z.array(slugRef).max(100),
});

const couponFields = couponCore.extend({
  description: couponCore.shape.description.default(""),
  minOrderPaise: couponCore.shape.minOrderPaise.default(0),
  maxDiscountPaise: couponCore.shape.maxDiscountPaise.default(null),
  endsAt: couponCore.shape.endsAt.default(null),
  usageLimit: couponCore.shape.usageLimit.default(null),
  perCustomerLimit: couponCore.shape.perCustomerLimit.default(null),
  active: couponCore.shape.active.default(true),
  listed: couponCore.shape.listed.default(true),
  products: couponCore.shape.products.default([]),
  categories: couponCore.shape.categories.default([]),
  excludedProducts: couponCore.shape.excludedProducts.default([]),
  excludedCategories: couponCore.shape.excludedCategories.default([]),
});

function couponRules(c: Partial<z.output<typeof couponFields>>, ctx: z.RefinementCtx) {
  if (c.type === "percent" && c.value !== undefined && c.value > 90) ctx.addIssue({ code: "custom", path: ["value"], message: "Percentage discounts can be at most 90%." });
  if (c.type === "flat" && c.value !== undefined && c.value < 100) ctx.addIssue({ code: "custom", path: ["value"], message: "A flat discount must be at least ₹1." });
  if (c.type === "flat" && c.maxDiscountPaise) ctx.addIssue({ code: "custom", path: ["maxDiscountPaise"], message: "A maximum discount only applies to percentage coupons." });
  if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End date must be after the start date." });
  const overlap = (a?: string[], b?: string[]) => (a ?? []).some((x) => (b ?? []).includes(x));
  if (overlap(c.products, c.excludedProducts)) ctx.addIssue({ code: "custom", path: ["excludedProducts"], message: "A product can't be both included and excluded." });
  if (overlap(c.categories, c.excludedCategories)) ctx.addIssue({ code: "custom", path: ["excludedCategories"], message: "A category can't be both included and excluded." });
}

export const couponCreateBody = couponFields.superRefine(couponRules);
/** Partial update (e.g. just { active: false }); the merged result is re-checked by the service. */
export const couponUpdateBody = couponCore.partial().superRefine(couponRules);
export const couponFullCheck = couponCreateBody;
export const couponParams = z.object({ id: objectId });
export const couponUsageQuery = pagination.extend({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/* ---------- Offers (announcement bar) ---------- */

const internalOrHttps = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^\/(?!\/)[\w\-./?=&#%]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "Use a store path like /shop or a full https:// link.");

export const offerBody = z.object({
  title: text(120).min(1, "Enter a headline."),
  subtitle: text(200).default(""),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{0,40}$/, "Codes use letters and numbers only.")
    .transform((v) => v || null)
    .nullable()
    .default(null),
  href: internalOrHttps.default("/shop"),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
/** Partial offer update (no defaults, so omitted fields stay as they are). */
export const offerUpdateBody = z
  .object({
    title: text(120).min(1, "Enter a headline."),
    subtitle: text(200),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{0,40}$/, "Codes use letters and numbers only.").transform((v) => v || null).nullable(),
    href: internalOrHttps,
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
  })
  .partial();
export const offerParams = z.object({ id: objectId });

export { internalOrHttps };

/* ---------- Homepage banners ---------- */

const bannerImage = z.object({
  url: z.url("Upload a banner image.").max(500).refine((u) => u.startsWith("https://"), "Images must be served over https."),
  publicId: z.string().trim().max(300).nullable().optional(),
  width: z.number().int().positive().max(20000).nullable().optional(),
  height: z.number().int().positive().max(20000).nullable().optional(),
});

const bannerCore = z.object({
  placement: z.enum(["hero", "promo"]),
  eyebrow: text(60),
  title: text(120).min(1, "Enter a headline."),
  subtitle: text(300),
  ctaLabel: text(40),
  ctaHref: internalOrHttps,
  image: bannerImage,
  active: z.boolean(),
  startsAt: isoDate.nullable(),
  endsAt: isoDate.nullable(),
});

function bannerRules(b: Partial<z.output<typeof bannerCore>>, ctx: z.RefinementCtx) {
  if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End date must be after the start date." });
}

export const bannerCreateBody = bannerCore
  .extend({
    eyebrow: bannerCore.shape.eyebrow.default(""),
    subtitle: bannerCore.shape.subtitle.default(""),
    ctaLabel: bannerCore.shape.ctaLabel.default("Shop Now"),
    ctaHref: bannerCore.shape.ctaHref.default("/shop"),
    active: bannerCore.shape.active.default(true),
    startsAt: bannerCore.shape.startsAt.default(null),
    endsAt: bannerCore.shape.endsAt.default(null),
  })
  .superRefine(bannerRules);
export const bannerUpdateBody = bannerCore.partial().superRefine(bannerRules);
export const bannerParams = z.object({ id: objectId });
export const bannerMoveBody = z.object({ direction: z.union([z.literal(-1), z.literal(1)]) });

export const featuredBody = z.object({
  productIds: z
    .array(ref)
    .max(8, "Choose up to 8 products.")
    .refine((ids) => new Set(ids).size === ids.length, "Each product can be featured once."),
});

export const HOMEPAGE_SECTION_KEYS = ["audience", "categories", "featured", "promo", "why", "testimonials", "newsletter"] as const;
export const sectionBody = z.object({ key: z.enum(HOMEPAGE_SECTION_KEYS), visible: z.boolean() });

/* ---------- Store settings ---------- */

const optionalEmail = z.union([z.literal(""), z.email("Enter a valid email address.").max(254)]);
const indianPhone = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || /^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(v) || /^0\d{2,4}[\s-]?\d{6,8}$/.test(v), "Enter an Indian phone number, e.g. +91 98765 43210.");
const social = (host: RegExp, name: string) =>
  z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || (/^https:\/\//.test(v) && host.test(new URL(v).hostname)), `Use a full https:// ${name} link.`);
const safeUrl = (v: string) => {
  try {
    return !!new URL(v);
  } catch {
    return false;
  }
};

export const settingsUpdateBody = z
  .object({
    /** settings.version from GET — the update is refused (409) if settings changed since. */
    version: z.string().max(40).optional(),
    store: z
      .object({
        storeName: text(80).min(2, "Enter the store name."),
        tagline: text(120),
        logo: text(500),
        email: z.email("Enter a valid email address.").max(254),
        phone: indianPhone,
        whatsapp: indianPhone,
        address: text(300),
        hours: text(120),
        gstin: z
          .string()
          .trim()
          .toUpperCase()
          .refine((v) => v === "" || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), "Enter a valid 15-character GSTIN."),
      })
      .partial()
      .optional(),
    social: z
      .object({
        instagram: social(/(^|\.)instagram\.com$/, "Instagram"),
        facebook: social(/(^|\.)(facebook|fb)\.com$/, "Facebook"),
        youtube: social(/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"),
      })
      .partial()
      .optional(),
    policies: z
      .object({
        returnWindowDays: z.number().int().min(0).max(60),
        exchangeOnly: z.boolean(),
        returnPolicySummary: text(1000),
        privacyContact: optionalEmail,
      })
      .partial()
      .optional(),
    notifications: z.object({ newOrder: z.boolean(), lowStock: z.boolean(), paymentFailed: z.boolean(), dailySummary: z.boolean() }).partial().optional(),
    seo: z.object({ title: text(70), description: text(160) }).partial().optional(),
  })
  .refine((b) => b.store || b.social || b.policies || b.notifications || b.seo, "Nothing to update.");

export const shippingUpdateBody = z.object({
  version: z.string().max(40).optional(),
  deliveryEstimate: text(120).min(3, "Describe the delivery time."),
  dispatchTime: text(120).min(3, "Describe the dispatch time."),
  couriers: z
    .array(
      z.object({
        id: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "Invalid courier."),
        name: text(60).min(2, "Enter the courier name."),
        trackingUrlTemplate: z
          .string()
          .trim()
          .max(300)
          .refine((v) => v === "" || (v.startsWith("https://") && v.includes("{awb}") && safeUrl(v.replace("{awb}", "X"))), "Use an https:// link containing {awb}."),
        enabled: z.boolean(),
      }),
    )
    .min(1, "Add at least one courier.")
    .max(20)
    .refine((list) => list.some((c) => c.enabled), "Keep at least one courier enabled.")
    .refine((list) => new Set(list.map((c) => c.id)).size === list.length, "Courier IDs must be unique."),
});
