import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminLogin } from "@/app/api/v1/admin/auth/login/route";
import { DELETE as deleteRoute, GET as getRoute, PUT as updateRoute } from "@/app/api/v1/admin/products/[id]/route";
import { POST as createRoute } from "@/app/api/v1/admin/products/route";
import { POST as confirmRoute } from "@/app/api/v1/admin/uploads/confirm/route";
import { POST as signRoute } from "@/app/api/v1/admin/uploads/sign/route";
import { POST as addToCart } from "@/app/api/v1/cart/items/route";
import { GET as publicProductRoute } from "@/app/api/v1/products/[ref]/route";
import { ColourGallery, SelectedColourProvider } from "@/components/products/SelectedColour";
import { MAX_COLOR_IMAGES, colorsWithoutPhotos, galleryFor } from "@/lib/gallery";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Admin, Category, InventoryMovement, MediaAsset, Product, Role } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { loadCatalogSnapshot } from "@/server/services/catalog.service";
import { cleanupOrphanImages } from "@/server/services/media.service";
import type { Product as StoreProduct } from "@/types";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Colour-specific product photos: the gallery rules, the admin API, storage and image cleanup.
 * Throwaway in-memory replica set and a fake Cloudinary: nothing leaves the machine.
 */

const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
type Jar = Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
type As = "owner" | "manager" | "staff";
const admins = {} as Record<As, Jar>;
let rs: MongoMemoryReplSet;
let seq = 0;

const cloud = { destroyed: [] as string[], resource: {} as Rec };
const fetchSpy = vi.fn(async (input: unknown, init: RequestInit = {}) => {
  const url = String(input);
  if (url.includes("api.cloudinary.com") && url.includes("/resources/image/upload/")) return Response.json(cloud.resource);
  if (url.endsWith("/image/destroy")) {
    cloud.destroyed.push(new URLSearchParams(String(init.body)).get("public_id")!);
    return Response.json({ result: "ok" });
  }
  throw new Error(`Unexpected network call: ${url}`);
});

function req(path: string, init: { method?: string; body?: unknown; jar?: Jar | null } = {}) {
  seq += 1;
  const headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": `10.4.${Math.floor(seq / 250) % 250}.${seq % 250}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
async function call(res: Response | Promise<Response>) {
  const r = (await res) as NextResponse;
  return { status: r.status, body: (await r.json()) as { message: string; data: Rec } };
}

/** An uploaded image as the admin form sends it. */
const img = (name: string) => ({ url: `https://res.cloudinary.com/testcloud/image/upload/v1/mm-collections/products/top/${name}.jpg`, publicId: `mm-collections/products/top/${name}` });
const urls = (...names: string[]) => names.map((n) => img(n).url);
const names = (list: string[]) => list.map((u) => /\/([^/]+)\.jpg$/.exec(u)![1]);

const variants = (colors: string[]) => colors.flatMap((c) => ["S", "M"].map((size) => ({ size, color: { name: c, hex: "#222222" }, initialStock: 4, lowStockThreshold: 2 })));
const body = (over: Rec = {}) => ({
  name: "Women's Top",
  slug: "womens-top",
  sku: "MM-WT-1",
  audience: "women",
  category: "tops",
  images: [img("common-1"), img("common-2")],
  pricePaise: 79900,
  mrpPaise: 99900,
  variants: variants(["Black", "White", "Pink"]),
  status: "active",
  ...over,
});
const galleries = () => [
  { color: "Black", images: [img("black-1"), img("black-2"), img("black-3")] },
  { color: "White", images: [img("white-1"), img("white-2")] },
  { color: "Pink", images: [img("pink-1")] },
];

const create = (over: Rec = {}, as: As | null = "owner") => call(createRoute(req("/api/v1/admin/products", { method: "POST", body: body(over), jar: as && admins[as] }), ctx()));
const update = (over: Rec = {}, as: As | null = "owner") => call(updateRoute(req("/api/v1/admin/products/womens-top", { method: "PUT", body: body(over), jar: as && admins[as] }), ctx({ id: "womens-top" })));
const adminGet = async () => (await call(getRoute(req("/api/v1/admin/products/womens-top", { jar: admins.owner }), ctx({ id: "womens-top" })))).body.data;
const stored = async () => (await Product.findOne({ slug: "womens-top" }).lean())!;
const storedGalleries = async () => (await stored()).colorImages.map((g) => [g.color, names(g.images.map((i) => i.url!))]);
const storefront = async () => (await loadCatalogSnapshot()).products.find((p) => p.slug === "womens-top")!;
const shown = (p: StoreProduct, color: string | null) => names(galleryFor(p, color).images);

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-gallery-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "testcloud");
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "gallery-secret-never-shown");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) await Role.create({ key, name: key, permissions: [...permissions] });
  vi.stubGlobal("fetch", fetchSpy);
  for (const key of ["owner", "manager", "staff"] as const) {
    const role = await Role.findOne({ key });
    await Admin.create({ name: `${key} admin`, email: `${key}@t.in`, passwordHash: await hashPassword(PW), role: role!._id });
    const res = await adminLogin(req("/api/v1/admin/auth/login", { method: "POST", body: { identifier: `${key}@t.in`, password: PW } }), ctx());
    expect(res.status).toBe(200);
    admins[key] = Object.fromEntries((res as NextResponse).cookies.getAll().map((c) => [c.name, c.value]));
  }
  await Category.create({ slug: "tops", audience: "women", name: "Tops" });
}, 240_000);

beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), MediaAsset.deleteMany({}), InventoryMovement.deleteMany({}), models.Cart.deleteMany({})]);
  cloud.destroyed = [];
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* ---------- Which photos a colour shows ---------- */

describe("gallery rules", () => {
  const product = {
    images: ["c1", "c2"],
    colors: ["Black", "White", "Pink"].map((name) => ({ name, hex: "#000000" })),
    colorImages: [
      { color: "Black", images: ["b1", "b2", "b3"] },
      { color: "White", images: ["w1", "w2"] },
    ],
  };

  it("shows only the chosen colour's photos, however often it changes", () => {
    for (const [color, images] of [["Black", ["b1", "b2", "b3"]], ["White", ["w1", "w2"]], ["Black", ["b1", "b2", "b3"]], ["White", ["w1", "w2"]]] as const) {
      expect(galleryFor(product, color)).toEqual({ images, source: "color", notice: null });
    }
  });

  it("falls back to general photos for a colour without its own, and says so", () => {
    expect(galleryFor(product, "Pink")).toEqual({ images: ["c1", "c2"], source: "general", notice: "No photos of Pink yet. These are general product photos and may show another colour." });
  });

  it("shows general photos, unlabelled, before a colour is chosen", () => {
    expect(galleryFor(product, null)).toEqual({ images: ["c1", "c2"], source: "general", notice: null });
  });

  it("handles products with only general photos", () => {
    const old = { images: ["c1"], colors: product.colors, colorImages: undefined };
    for (const c of ["Black", "White", "Pink"]) expect(galleryFor(old, c)).toMatchObject({ images: ["c1"], source: "general", notice: expect.stringContaining(`No photos of ${c} yet`) });
    // One colour only: the shared photos can't be of another colour, so no warning.
    expect(galleryFor({ ...old, colors: [product.colors[0]] }, "Black")).toEqual({ images: ["c1"], source: "general", notice: null });
  });

  it("matches colour names without regard to case, and lists colours still without photos", () => {
    expect(galleryFor(product, "black").images).toEqual(["b1", "b2", "b3"]);
    expect(colorsWithoutPhotos(product)).toEqual(["Pink"]);
  });

  it("renders a single colour's own photos on the first (server) render, with none of the others", () => {
    const one = { id: "p", name: "Top", images: urls("common-1"), colors: [{ name: "Black", hex: "#000000" }], colorImages: [{ color: "Black", images: urls("black-1", "black-2") }] } as unknown as StoreProduct;
    const html = renderToStaticMarkup(createElement(SelectedColourProvider as FunctionComponent<{ product: StoreProduct }>, { product: one }, createElement(ColourGallery, { product: one })));
    expect(html).toContain("black-1.jpg");
    expect(html).toContain("black-2.jpg");
    expect(html).not.toContain("common-1.jpg");
    expect(html).toContain("Image 1 of 2");
  });
});

/* ---------- Admin: managing each colour's photos ---------- */

describe("admin colour galleries", () => {
  it("saves a gallery per colour, in order, with Cloudinary IDs, and shows them on the storefront", async () => {
    const r = await create({ colorImages: galleries() });
    expect(r.status, r.body.message).toBe(201);
    expect(await storedGalleries()).toEqual([["Black", ["black-1", "black-2", "black-3"]], ["White", ["white-1", "white-2"]], ["Pink", ["pink-1"]]]);
    expect((await stored()).colorImages[0].images[0].publicId).toBe(img("black-1").publicId);
    const p = await storefront();
    expect([shown(p, "Black"), shown(p, "White"), shown(p, "Pink"), shown(p, null)]).toEqual([["black-1", "black-2", "black-3"], ["white-1", "white-2"], ["pink-1"], ["common-1", "common-2"]]);
    // Product cards still use the first general photo.
    expect(names(p.images)).toEqual(["common-1", "common-2"]);
    const admin = await adminGet();
    expect(admin.colorImages.map((g: Rec) => g.color)).toEqual(["Black", "White", "Pink"]);
    expect(admin.imageMeta.map((m: Rec) => m.publicId)).toContain(img("pink-1").publicId);
    const api = await call(publicProductRoute(req("/api/v1/products/womens-top"), ctx({ ref: "womens-top" })));
    expect(names(api.body.data.product.colorImages[1].images)).toEqual(["white-1", "white-2"]);
    expect(JSON.stringify(api.body)).not.toContain("publicId");
  });

  it("reorders, changes the main photo, adds and removes — deleting only what was removed", async () => {
    await create({ colorImages: galleries() });
    const before = await stored();
    const r = await update({
      colorImages: [
        { color: "Black", images: [img("black-3"), img("black-1")] }, // new main photo; black-2 removed
        { color: "White", images: [img("white-1"), img("white-2"), img("white-3")] },
        { color: "Pink", images: [img("pink-1")] },
      ],
    });
    expect(r.status, r.body.message).toBe(200);
    expect(await storedGalleries()).toEqual([["Black", ["black-3", "black-1"]], ["White", ["white-1", "white-2", "white-3"]], ["Pink", ["pink-1"]]]);
    expect(cloud.destroyed).toEqual([img("black-2").publicId]);
    // Prices, stock and stock history are untouched by photo edits.
    const after = await stored();
    expect(after.variants.map((v) => [v.sku, v.stock, v.reserved, v.pricePaise])).toEqual(before.variants.map((v) => [v.sku, v.stock, v.reserved, v.pricePaise]));
    expect(await InventoryMovement.countDocuments()).toBe(6);
  });

  it("clears one colour when its photos are all removed, without touching the others", async () => {
    await create({ colorImages: galleries() });
    await update({ colorImages: galleries().filter((g) => g.color !== "White") });
    expect(await storedGalleries()).toEqual([["Black", ["black-1", "black-2", "black-3"]], ["Pink", ["pink-1"]]]);
    expect(cloud.destroyed.sort()).toEqual([img("white-1").publicId, img("white-2").publicId]);
    expect(shown(await storefront(), "White")).toEqual(["common-1", "common-2"]);
  });

  it("leaves colour photos alone when a save doesn't mention them", async () => {
    await create({ colorImages: galleries() });
    const r = await update({ name: "Renamed Top" }); // no colorImages at all, like an old admin tab
    expect(r.status).toBe(200);
    expect(await storedGalleries()).toHaveLength(3);
    expect(cloud.destroyed).toEqual([]);
  });

  it("keeps a hidden colour's photos, off the storefront, and brings them back", async () => {
    await create({ colorImages: galleries() });
    await update({ variants: variants(["Black", "White"]), colorImages: galleries().slice(0, 2) });
    expect(await storedGalleries()).toContainEqual(["Pink", ["pink-1"]]);
    expect(cloud.destroyed).toEqual([]);
    expect((await storefront()).colorImages!.map((g) => g.color)).toEqual(["Black", "White"]);
    // The admin still receives them, so adding Pink back sends them again rather than nothing.
    expect((await adminGet()).colorImages.map((g: Rec) => g.color).sort()).toEqual(["Black", "Pink", "White"]);
    await update({ colorImages: galleries() });
    expect(shown(await storefront(), "Pink")).toEqual(["pink-1"]);
    expect(cloud.destroyed).toEqual([]);
  });

  it("refuses photos assigned wrongly, and accepts nothing from outside our Cloudinary account", async () => {
    await create({ colorImages: galleries() });
    const bad: [string, Rec[]][] = [
      ["a colour the product doesn't have", [{ color: "Green", images: [img("g")] }]],
      ["two lists for one colour", [{ color: "Black", images: [img("x")] }, { color: "black", images: [img("y")] }]],
      ["one photo in two colours", [{ color: "Black", images: [img("shared")] }, { color: "White", images: [img("shared")] }]],
      ["the same photo twice", [{ color: "Black", images: [img("x"), img("x")] }]],
      ["more than the limit", [{ color: "Black", images: Array.from({ length: MAX_COLOR_IMAGES + 1 }, (_, i) => img(`n${i}`)) }]],
      ["another website", [{ color: "Black", images: [{ url: "https://evil.example/a.jpg" }] }]],
      ["another Cloudinary account", [{ color: "Black", images: [{ url: "https://res.cloudinary.com/other/image/upload/v1/a.jpg" }] }]],
      ["a script URL", [{ color: "Black", images: [{ url: "javascript:alert(1)" }] }]],
    ];
    for (const [label, colorImages] of bad) {
      resetRateLimits();
      expect([label, (await update({ colorImages })).status]).toEqual([label, 400]);
    }
    expect(await storedGalleries()).toHaveLength(3);
    expect(cloud.destroyed).toEqual([]);
  });

  it("still needs a general photo to publish, and a colour photo can double as one", async () => {
    expect((await create({ images: [], colorImages: galleries() })).status).toBe(400);
    expect((await create({ images: [img("black-1")], colorImages: galleries() })).status).toBe(201);
    // Removing it from the general photos keeps the image: Black still uses it.
    await update({ images: [img("common-1")], colorImages: galleries() });
    expect(cloud.destroyed).toEqual([]);
  });

  it("lets only admins with products:write change photos", async () => {
    await create({ colorImages: galleries() });
    expect((await update({ colorImages: [] }, "staff")).status).toBe(403);
    expect((await update({ colorImages: [] }, null)).status).toBe(401);
    expect((await create({ slug: "x", sku: "MM-X-1", colorImages: [] }, "staff")).status).toBe(403);
    expect((await update({ colorImages: galleries() }, "manager")).status).toBe(200);
    expect(await storedGalleries()).toHaveLength(3);
  });

  it("deleting a product removes its colour photos too", async () => {
    await create({ colorImages: galleries() });
    const r = await call(deleteRoute(req("/api/v1/admin/products/womens-top", { method: "DELETE", jar: admins.owner }), ctx({ id: "womens-top" })));
    expect(r.status).toBe(200);
    expect(cloud.destroyed).toHaveLength(8);
    expect(cloud.destroyed).toContain(img("white-2").publicId);
  });
});

/* ---------- Uploads and the cleanup job ---------- */

describe("uploads and cleanup", () => {
  it("uses the existing signed upload: authorised admins only, no secret exposed", async () => {
    const sign = (jar: Jar | null) => call(signRoute(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "product", ref: "womens-top" }, jar }), ctx()));
    expect((await sign(null)).status).toBe(401);
    expect((await sign(admins.staff)).status).toBe(403);
    const r = await sign(admins.manager);
    expect(r.status).toBe(200);
    expect(r.body.data.publicId).toMatch(/^mm-collections\/products\/womens-top\//);
    expect(JSON.stringify(r.body)).not.toContain("gallery-secret-never-shown");
  });

  it("rejects and deletes an upload that is too large or not an allowed image", async () => {
    for (const bad of [{ format: "png", bytes: 6 * 1024 * 1024 }, { format: "gif", bytes: 100 }]) {
      const { publicId } = (await call(signRoute(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "product" }, jar: admins.owner }), ctx()))).body.data;
      cloud.resource = { public_id: publicId, width: 10, height: 10, secure_url: "https://res.cloudinary.com/testcloud/x", ...bad };
      expect((await call(confirmRoute(req("/api/v1/admin/uploads/confirm", { method: "POST", body: { publicId }, jar: admins.owner }), ctx()))).status).toBe(400);
      expect(cloud.destroyed).toContain(publicId);
    }
  });

  it("the daily cleanup never deletes a photo a colour gallery uses", async () => {
    await create({ colorImages: galleries() });
    const old = new Date(Date.now() - 25 * 3600_000);
    const ids = ["black-1", "white-2", "pink-1", "never-saved"].map((n) => img(n).publicId);
    await MediaAsset.collection.insertMany(ids.map((publicId) => ({ publicId, purpose: "product", status: "uploaded", createdAt: old, updatedAt: old })));
    await cleanupOrphanImages();
    expect(cloud.destroyed).toEqual([img("never-saved").publicId]);
    expect(await MediaAsset.countDocuments({ status: "attached" })).toBe(3);
  });
});

/* ---------- Existing products ---------- */

describe("existing products without colour photos", () => {
  /** Written straight to the collection, in the shape stored before colour photos existed. */
  async function legacy() {
    await create();
    await Product.collection.updateOne({ slug: "womens-top" }, { $unset: { colorImages: "" } });
  }

  it("load unchanged on the storefront and in admin", async () => {
    await legacy();
    const p = await storefront();
    expect(p.colorImages).toEqual([]);
    expect(names(p.images)).toEqual(["common-1", "common-2"]);
    expect(shown(p, "White")).toEqual(["common-1", "common-2"]);
    expect(galleryFor(p, "White").notice).toContain("No photos of White yet");
    expect(colorsWithoutPhotos(p)).toEqual(["Black", "White", "Pink"]);
    expect((await adminGet()).colorImages).toEqual([]);
  });

  it("can gain photos one colour at a time, keeping the general photos", async () => {
    await legacy();
    expect((await update({ colorImages: [{ color: "White", images: [img("white-1")] }] })).status).toBe(200);
    const p = await storefront();
    expect([shown(p, "White"), shown(p, "Black")]).toEqual([["white-1"], ["common-1", "common-2"]]);
    expect(names(p.images)).toEqual(["common-1", "common-2"]);
    expect(cloud.destroyed).toEqual([]);
  });

  it("leave the bag's behaviour as it was: it shows the general photo", async () => {
    await create({ colorImages: galleries() });
    const id = String((await stored())._id);
    const res = await call(addToCart(req("/api/v1/cart/items", { method: "POST", body: { productId: id, size: "S", color: "White", quantity: 1 } }), ctx()));
    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({ color: "White", image: img("common-1").url });
  });
});
