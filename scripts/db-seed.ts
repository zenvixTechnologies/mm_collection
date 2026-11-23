/**
 * Imports the original catalogue and store data (src/data) into MongoDB.
 *
 * Insert-only and safe to re-run: records that already exist (matched by slug / legacy ID /
 * coupon code / role key) are left untouched, so later admin edits are never overwritten and
 * nothing is duplicated.
 *
 *   npm run db:seed
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("@/server/db/connect");
  const M = await import("@/server/models");
  const { publishedAtFor, toProductDoc } = await import("@/server/catalog/legacy-import");
  const { DEFAULT_ROLE_PERMISSIONS } = await import("@/server/auth/permissions");
  const { categories } = await import("@/data/categories");
  const { products } = await import("@/data/products");
  const { coupons } = await import("@/data/coupons");
  const { offers } = await import("@/data/offers");
  const { mockBanners, mockFeaturedProductIds, mockHomepageSections } = await import("@/data/admin/marketing");
  const { mockShippingSettings, mockStoreSettings } = await import("@/data/admin/settings");

  const mongoose = await connectToDatabase();
  console.log(`Seeding database "${mongoose.connection.name}"\n`);

  const report = (label: string, inserted: number, total: number) =>
    console.log(`${label.padEnd(20)} ${String(inserted).padStart(3)} inserted, ${String(total - inserted).padStart(3)} already existed`);

  /* ---------- Roles ---------- */
  const roleNames = { owner: "Owner", manager: "Manager", staff: "Staff" } as const;
  let inserted = 0;
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const res = await M.Role.updateOne(
      { key },
      {
        $setOnInsert: {
          key,
          name: roleNames[key as keyof typeof roleNames],
          description: key === "owner" ? "Full access to everything." : "",
          permissions: [...permissions],
          isSystem: true,
        },
      },
      { upsert: true },
    );
    inserted += res.upsertedCount;
  }
  report("roles", inserted, 3);

  /* ---------- Categories ---------- */
  inserted = 0;
  for (const [i, c] of categories.entries()) {
    const res = await M.Category.updateOne(
      { slug: c.slug },
      {
        $setOnInsert: {
          slug: c.slug,
          audience: c.audience,
          name: c.name,
          description: c.description,
          image: { url: c.image, alt: c.name },
          visible: true,
          sortOrder: i,
        },
      },
      { upsert: true },
    );
    inserted += res.upsertedCount;
  }
  report("categories", inserted, categories.length);

  const categoryIds = new Map(
    (await M.Category.find({}, { slug: 1 }).lean()).map((c) => [c.slug, c._id]),
  );
  const catId = (slug: string) => {
    const id = categoryIds.get(slug);
    if (!id) throw new Error(`Category "${slug}" is missing`);
    return id;
  };

  /* ---------- Products + opening stock ---------- */
  const anchor = new Date();
  inserted = 0;
  let movements = 0;
  for (const [i, p] of products.entries()) {
    const exists = await M.Product.exists({ $or: [{ legacyId: p.id }, { slug: p.slug }] });
    if (exists) continue;
    const doc = await M.Product.create(toProductDoc(p, catId, publishedAtFor(i, products.length, anchor)));
    // Opening balance in the stock ledger, so every unit on hand has a recorded origin.
    const ledger = doc.variants
      .filter((v) => v.stock > 0)
      .map((v) => ({
        product: doc._id,
        variantSku: v.sku,
        type: "adjustment" as const,
        stockChange: v.stock,
        reservedChange: 0,
        stockAfter: v.stock,
        reservedAfter: 0,
        actor: { type: "system" as const, name: "seed" },
        note: "Opening stock imported from the original catalogue",
      }));
    if (ledger.length) await M.InventoryMovement.insertMany(ledger);
    movements += ledger.length;
    inserted += 1;
  }
  report("products", inserted, products.length);
  console.log(`${"stock ledger".padEnd(20)} ${String(movements).padStart(3)} opening entries`);

  /* ---------- Coupons (the storefront's real codes; admin demo codes are not imported) ---------- */
  inserted = 0;
  for (const c of coupons) {
    const res = await M.Coupon.updateOne(
      { code: c.code },
      {
        $setOnInsert: {
          code: c.code,
          description: c.description,
          type: c.type,
          value: c.type === "flat" ? c.value * 100 : c.value,
          minOrderPaise: c.minOrder * 100,
          maxDiscountPaise: c.maxDiscount ? c.maxDiscount * 100 : null,
          active: true,
        },
      },
      { upsert: true },
    );
    inserted += res.upsertedCount;
  }
  report("coupons", inserted, coupons.length);

  /* ---------- Store settings (single document) ---------- */
  const legacyToId = new Map(
    (await M.Product.find({ legacyId: { $in: mockFeaturedProductIds } }, { legacyId: 1 }).lean()).map((p) => [p.legacyId, p._id]),
  );
  const s = mockStoreSettings;
  const res = await M.StoreSettings.updateOne(
    { key: "store" },
    {
      $setOnInsert: {
        key: "store",
        store: {
          name: s.storeName,
          tagline: s.tagline,
          logo: s.logo,
          email: s.email,
          phone: s.phone,
          whatsapp: s.whatsapp,
          address: s.address,
          hours: s.hours,
          gstin: s.gstin,
        },
        social: s.social,
        policies: s.policies,
        notifications: { ...s.notifications, alertEmails: s.email ? [s.email] : [] },
        shipping: {
          chargesNotice: mockShippingSettings.chargesNotice,
          deliveryEstimate: mockShippingSettings.deliveryEstimate,
          dispatchTime: mockShippingSettings.dispatchTime,
          country: "India",
          couriers: mockShippingSettings.couriers.map((c) => ({
            key: c.id,
            name: c.name,
            trackingUrlTemplate: c.trackingUrlTemplate,
            enabled: c.enabled,
          })),
        },
        checkout: { codEnabled: false, reservationMinutes: 15 },
        homepage: {
          sections: mockHomepageSections.map((h) => ({ key: h.id, label: h.label, description: h.description, visible: h.visible })),
          featuredProducts: mockFeaturedProductIds.map((id) => legacyToId.get(id)).filter(Boolean),
        },
      },
    },
    { upsert: true },
  );
  report("store settings", res.upsertedCount, 1);

  /* ---------- Banners & offers (no natural key: imported only into an empty collection) ---------- */
  if ((await M.HomepageBanner.estimatedDocumentCount()) === 0) {
    await M.HomepageBanner.insertMany(
      mockBanners.map((b, i) => ({
        placement: b.placement,
        eyebrow: b.eyebrow,
        title: b.title,
        subtitle: b.subtitle,
        ctaLabel: b.ctaLabel,
        ctaHref: b.ctaHref,
        image: { url: b.image, alt: b.title },
        active: b.active,
        startsAt: b.startsAt ? new Date(b.startsAt) : null,
        endsAt: b.endsAt ? new Date(b.endsAt) : null,
        sortOrder: i,
      })),
    );
    report("homepage banners", mockBanners.length, mockBanners.length);
  } else report("homepage banners", 0, mockBanners.length);

  if ((await M.Offer.estimatedDocumentCount()) === 0) {
    await M.Offer.insertMany(offers.map((o, i) => ({ title: o.title, subtitle: o.subtitle, code: o.code ?? null, href: o.href, active: true, sortOrder: i })));
    report("offers", offers.length, offers.length);
  } else report("offers", 0, offers.length);

  await disconnectFromDatabase();
  console.log("\nDone.");
}

main().catch(async (err) => {
  const e = err as Error & { cause?: Error; describe?: () => string };
  if (e.describe) e.message = e.describe(); // config problems: names the variable, never its value
  console.error("db:seed failed:", e.message, e.cause ? `— ${e.cause.message}` : "");
  process.exit(1);
});
