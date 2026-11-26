import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as removeLine, PATCH as patchLine } from "@/app/api/v1/cart/items/[id]/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as mergeCart } from "@/app/api/v1/cart/merge/route";
import { DELETE as clearCartRoute, GET as getCartRoute } from "@/app/api/v1/cart/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { DELETE as unsave } from "@/app/api/v1/wishlist/items/[productId]/route";
import { POST as save } from "@/app/api/v1/wishlist/items/route";
import { POST as mergeWishlist } from "@/app/api/v1/wishlist/merge/route";
import { DELETE as clearWishlistRoute, GET as getWishlistRoute } from "@/app/api/v1/wishlist/route";
import { CUSTOMER_HINT_COOKIE } from "@/server/auth/cookies";
import { GUEST_COOKIE, guestKey } from "@/server/auth/guest";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { Cart, Category, Product, Session, User, Wishlist } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";

const ORIGIN = "http://localhost:3000";
const PW = "Kerala2026";
type Jar = Record<string, string>;
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
let mongo: MongoMemoryServer;
let ipSeq = 0;

function req(path: string, init: { method?: string; body?: unknown; jar?: Jar; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "user-agent": "vitest", "x-forwarded-for": `10.1.0.${++ipSeq % 250}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.clone().json()) as { success: boolean; message: string; data: any; error?: { code: string } };

/* ---------- API helpers ---------- */

async function add(jar: Jar, body: Record<string, unknown>, origin?: string | null) {
  const res = await addLine(req("/api/v1/cart/items", { body, jar, origin }), ctx());
  Object.assign(jar, cookiesOf(res));
  return { res, body: await json(res) };
}
const getCart = async (jar: Jar) => json(await getCartRoute(req("/api/v1/cart", { method: "GET", jar }), ctx()));
const patch = async (jar: Jar, sku: string, quantity: unknown) =>
  patchLine(req(`/api/v1/cart/items/${sku}`, { method: "PATCH", body: { quantity }, jar }), ctx({ id: sku }));
const remove = async (jar: Jar, sku: string) => removeLine(req(`/api/v1/cart/items/${sku}`, { method: "DELETE", jar }), ctx({ id: sku }));

async function signUp(email: string, mobile: string): Promise<Jar> {
  const res = await register(req("/api/v1/auth/register", { body: { fullName: "Test Shopper", email, mobile, password: PW } }), ctx());
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function signIn(email: string, jar: Jar = {}): Promise<Jar> {
  const res = await login(req("/api/v1/auth/login", { body: { identifier: email, password: PW, remember: true }, jar }), ctx());
  expect(res.status).toBe(200);
  return { ...jar, ...cookiesOf(res) };
}

/* ---------- Catalogue fixtures ---------- */

let kurti: string; // women — size × colour variants
let shirt: string; // men
let kidsSet: string; // kids
let bedsheet: string; // home & living — bed sizes, no colours
let soldOut: string;
let hidden: string;

async function seedCatalogue() {
  type Aud = "women" | "men" | "kids" | "home-living";
  const cat = async (slug: string, audience: Aud) => (await Category.create({ slug, audience, name: slug }))._id;
  const base = { pricePaise: 0, mrpPaise: 0, status: "active" as const };
  kurti = (
    await Product.create({
      ...base, legacyId: "p001", slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: await cat("kurtis", "women"),
      variants: [
        { sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 129900, mrpPaise: 189900, stock: 5 },
        { sku: "MM-K1-L-ROSE", size: "L", color: { name: "Rose" }, pricePaise: 139900, mrpPaise: 189900, stock: 2 },
        { sku: "MM-K1-M-IVORY", size: "M", color: { name: "Ivory" }, pricePaise: 129900, mrpPaise: 189900, stock: 3, reserved: 3 },
      ],
    })
  ).legacyId!;
  shirt = (
    await Product.create({
      ...base, slug: "linen-shirt", name: "Linen Shirt", sku: "MM-S1", audience: "men", category: await cat("men-shirts", "men"),
      variants: [{ sku: "MM-S1-40", size: "40", pricePaise: 99900, mrpPaise: 99900, stock: 30 }],
    })
  ).id;
  kidsSet = (
    await Product.create({
      ...base, slug: "kids-set", name: "Kids Set", sku: "MM-KS1", audience: "kids", category: await cat("kids-sets", "kids"),
      variants: [{ sku: "MM-KS1-3-4Y", size: "3-4Y", color: { name: "Blue" }, pricePaise: 59900, mrpPaise: 79900, stock: 4 }],
    })
  ).id;
  bedsheet = (
    await Product.create({
      ...base, slug: "cotton-bedsheet", name: "Cotton Bedsheet", sku: "MM-B1", audience: "home-living", category: await cat("home-bedsheets", "home-living"),
      variants: [
        { sku: "MM-B1-KING", size: "King", pricePaise: 149900, mrpPaise: 199900, stock: 4 },
        { sku: "MM-B1-QUEEN", size: "Queen", pricePaise: 129900, mrpPaise: 179900, stock: 6 },
      ],
    })
  ).id;
  const women = await Category.findOne({ slug: "kurtis" });
  soldOut = (
    await Product.create({
      ...base, slug: "sold-out", name: "Sold Out Saree", sku: "MM-SO", audience: "women", category: women!._id,
      variants: [{ sku: "MM-SO-FREE", size: "Free Size", pricePaise: 299900, mrpPaise: 299900, stock: 0 }],
    })
  ).id;
  hidden = (
    await Product.create({
      ...base, status: "draft" as const, slug: "draft-dress", name: "Draft Dress", sku: "MM-DR", audience: "women", category: women!._id,
      variants: [{ sku: "MM-DR-M", size: "M", pricePaise: 99900, mrpPaise: 99900, stock: 9 }],
    })
  ).id;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-cart-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  resetEnvCache();
  await connectToDatabase();
  for (const m of [Cart, Wishlist, Product, Category, User, Session]) await m.syncIndexes();
  await seedCatalogue();
}, 180_000);

beforeEach(async () => {
  await Promise.all([Cart.deleteMany({}), Wishlist.deleteMany({}), User.deleteMany({}), Session.deleteMany({})]);
  // Restore stock the tests change.
  await Product.updateOne({ slug: "rose-kurti", "variants.sku": "MM-K1-M-ROSE" }, { $set: { "variants.$.stock": 5, status: "active" } });
  resetRateLimits();
});

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* ---------- Tests ---------- */

describe("guest bag", () => {
  it("adds a variant, issues an HttpOnly guest cookie and stores only its hash", async () => {
    const jar: Jar = {};
    const { res, body } = await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 2 });
    expect(res.status).toBe(200);
    const cookie = (res as NextResponse).cookies.get(GUEST_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/v1" });
    expect(body.data).toMatchObject({ itemCount: 2, subtotal: 2598, mrpTotal: 3798, added: 2 });
    expect(body.data.items[0]).toMatchObject({ key: "MM-K1-M-ROSE", productId: "p001", size: "M", color: "Rose", price: 1299, originalPrice: 1899, stock: 5, audience: "women" });

    const stored = await Cart.findOne().lean();
    expect(stored!.guestId).toBe(guestKey(cookie.value));
    expect(stored!.guestId).not.toBe(cookie.value);
    expect(stored!.items).toHaveLength(1);
    expect(stored!.expiresAt).toBeInstanceOf(Date);

    // Persisted: a later request with the same cookie sees the same bag.
    expect((await getCart(jar)).data.itemCount).toBe(2);
    // A browser without the cookie gets an empty bag and no cookie.
    const fresh = await getCartRoute(req("/api/v1/cart", { method: "GET" }), ctx());
    expect((await json(fresh)).data.items).toEqual([]);
    expect(cookiesOf(fresh)[GUEST_COOKIE]).toBeUndefined();
  });

  it("holds Women, Men, Kids and Home & Living products in one bag", async () => {
    const jar: Jar = {};
    await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 1 });
    await add(jar, { productId: shirt, size: "40", color: null, quantity: 1 });
    await add(jar, { productId: kidsSet, size: "3-4Y", color: "Blue", quantity: 1 });
    await add(jar, { productId: bedsheet, size: "King", color: null, quantity: 1 });
    const cart = (await getCart(jar)).data;
    expect(cart.items.map((i: { audience: string }) => i.audience)).toEqual(["women", "men", "kids", "home-living"]);
    expect(cart.subtotal).toBe(1299 + 999 + 599 + 1499);
  });

  it("keeps different sizes and colours as separate lines and merges the same variant", async () => {
    const jar: Jar = {};
    await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 1 });
    await add(jar, { productId: kurti, size: "L", color: "Rose", quantity: 1 });
    await add(jar, { productId: bedsheet, size: "Queen", quantity: 1 });
    const { body } = await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 2 });
    expect(body.data.items.map((i: { key: string; quantity: number; price: number }) => [i.key, i.quantity, i.price])).toEqual([
      ["MM-K1-M-ROSE", 3, 1299],
      ["MM-K1-L-ROSE", 1, 1399],
      ["MM-B1-QUEEN", 1, 1299],
    ]);
  });

  it("updates quantities, removes lines and clears the bag", async () => {
    const jar: Jar = {};
    await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 1 });
    await add(jar, { productId: shirt, size: "40", quantity: 1 });
    const updated = await patch(jar, "MM-K1-M-ROSE", 4);
    expect(updated.status).toBe(200);
    expect((await json(updated)).data.itemCount).toBe(5);
    // Line IDs are case-insensitive SKUs.
    const removed = await remove(jar, "mm-s1-40");
    expect((await json(removed)).data.items).toHaveLength(1);
    expect((await remove(jar, "MM-S1-40")).status).toBe(404);
    const cleared = await clearCartRoute(req("/api/v1/cart", { method: "DELETE", jar }), ctx());
    expect((await json(cleared)).data.items).toEqual([]);
    expect((await Cart.findOne().lean())!.items).toEqual([]);
  });
});

describe("validation and stock", () => {
  it("rejects invalid quantities and malformed bodies", async () => {
    const jar: Jar = {};
    await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 1 });
    for (const q of [0, -1, 1.5, 21, "2", null]) expect((await patch(jar, "MM-K1-M-ROSE", q)).status, String(q)).toBe(400);
    for (const bad of [{ productId: kurti, size: "M", color: "Rose", quantity: 0 }, { productId: "", quantity: 1 }, { productId: "$where", quantity: 1 }]) {
      expect((await add(jar, bad)).res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await patch(jar, "bad sku!", 1)).status).toBe(400);
  });

  it("rejects unknown, hidden and sold-out products and unknown variants", async () => {
    const jar: Jar = {};
    expect((await add(jar, { productId: "p999", quantity: 1 })).res.status).toBe(404);
    expect((await add(jar, { productId: hidden, size: "M", quantity: 1 })).res.status).toBe(404);
    expect((await add(jar, { productId: kurti, size: "XXL", color: "Rose", quantity: 1 })).res.status).toBe(400);
    expect((await add(jar, { productId: kurti, size: "M", color: null, quantity: 1 })).res.status).toBe(400);
    const so = await add(jar, { productId: soldOut, size: "Free Size", quantity: 1 });
    expect(so.res.status).toBe(409);
    expect(so.body.message).toMatch(/out of stock/);
    // Stock fully reserved by pending orders counts as sold out.
    expect((await add(jar, { productId: kurti, size: "M", color: "Ivory", quantity: 1 })).res.status).toBe(409);
  });

  it("never lets quantities exceed available stock", async () => {
    const jar: Jar = {};
    const first = await add(jar, { productId: kurti, size: "L", color: "Rose", quantity: 5 });
    expect(first.body.data).toMatchObject({ added: 2, itemCount: 2 });
    expect(first.body.message).toMatch(/Only 2/);
    const again = await add(jar, { productId: kurti, size: "L", color: "Rose", quantity: 1 });
    expect(again.res.status).toBe(409);
    expect(again.body.message).toMatch(/already have all 2/);
    const tooMany = await patch(jar, "MM-K1-L-ROSE", 3);
    expect(tooMany.status).toBe(409);
    expect((await json(tooMany)).message).toMatch(/Only 2 units/);
  });

  it("reconciles the bag when stock drops or a product is taken off sale", async () => {
    const jar: Jar = {};
    await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 4 });
    await add(jar, { productId: shirt, size: "40", quantity: 1 });
    await Product.updateOne({ slug: "rose-kurti", "variants.sku": "MM-K1-M-ROSE" }, { $set: { "variants.$.stock": 2 } });
    let cart = (await getCart(jar)).data;
    expect(cart.items.find((i: { key: string }) => i.key === "MM-K1-M-ROSE").quantity).toBe(2);
    expect(cart.notices[0]).toMatch(/Only 2 of Rose Kurti \(M \/ Rose\)/);
    expect((await Cart.findOne().lean())!.items.find((i) => i.variantSku === "MM-K1-M-ROSE")!.quantity).toBe(2);

    await Product.updateOne({ slug: "rose-kurti" }, { $set: { status: "archived" } });
    cart = (await getCart(jar)).data;
    expect(cart.items.map((i: { key: string }) => i.key)).toEqual(["MM-S1-40"]);
    expect(cart.notices[0]).toMatch(/no longer available/);
  });

  it("ignores prices, discounts and totals sent by the browser", async () => {
    const jar: Jar = {};
    const { res, body } = await add(jar, {
      productId: kurti, size: "M", color: "Rose", quantity: 2,
      price: 1, originalPrice: 1, pricePaise: 100, discount: 99, subtotal: 1, total: 1,
    });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ subtotal: 2598, mrpTotal: 3798 });
    expect(body.data.items[0].price).toBe(1299);
    const stored = (await Cart.findOne().lean<{ items: Record<string, unknown>[] }>())!;
    expect(Object.keys(stored.items[0]).sort()).toEqual(["addedAt", "product", "quantity", "variantSku"]);
    expect(JSON.stringify(stored)).not.toMatch(/price|total|discount/i);
  });

  it("blocks cross-site writes", async () => {
    const jar: Jar = {};
    expect((await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 1 }, "https://evil.example")).res.status).toBe(403);
    expect((await add(jar, { productId: kurti, size: "M", color: "Rose", quantity: 1 }, null)).res.status).toBe(403);
    expect(await Cart.countDocuments()).toBe(0);
  });

  it("rate limits bag writes", async () => {
    const jar: Jar = {};
    await add(jar, { productId: shirt, size: "40", quantity: 1 });
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) limited = (await patch(jar, "MM-S1-40", (i % 5) + 1)).status === 429;
    expect(limited).toBe(true);
  });
});

describe("concurrency", () => {
  it("concurrent adds never lose an update or exceed stock", async () => {
    const jar: Jar = {};
    await add(jar, { productId: shirt, size: "40", quantity: 1 });
    const results = await Promise.all(Array.from({ length: 8 }, () => add({ ...jar }, { productId: shirt, size: "40", quantity: 1 })));
    expect(results.every((r) => r.res.status === 200)).toBe(true);
    expect((await getCart(jar)).data.itemCount).toBe(9);

    const capped = await Promise.all(Array.from({ length: 6 }, () => add({ ...jar }, { productId: kurti, size: "L", color: "Rose", quantity: 1 })));
    expect(capped.filter((r) => r.res.status === 200)).toHaveLength(2);
    expect(capped.filter((r) => r.res.status === 409).length).toBe(4);
    const cart = (await getCart(jar)).data;
    expect(cart.items.find((i: { key: string }) => i.key === "MM-K1-L-ROSE").quantity).toBe(2);
    expect((await Cart.findOne().lean())!.revision).toBeGreaterThanOrEqual(10);
  });

  it("concurrent quantity changes and removals leave a consistent bag", async () => {
    const jar: Jar = {};
    await add(jar, { productId: shirt, size: "40", quantity: 1 });
    await add(jar, { productId: bedsheet, size: "Queen", quantity: 1 });
    const res = await Promise.all([patch(jar, "MM-S1-40", 3), patch(jar, "MM-S1-40", 5), remove(jar, "MM-B1-QUEEN"), patch(jar, "MM-B1-QUEEN", 2)]);
    expect(res.slice(0, 3).every((r) => r.status === 200)).toBe(true);
    const cart = (await getCart(jar)).data;
    expect([3, 5]).toContain(cart.items.find((i: { key: string }) => i.key === "MM-S1-40").quantity);
    // The bedsheet PATCH either ran before the removal or found the line gone.
    expect([200, 404]).toContain(res[3].status);
    expect(cart.items.some((i: { key: string }) => i.key === "MM-B1-QUEEN")).toBe(false);
  });
});

describe("customer bag", () => {
  it("merges the guest bag into the account after login, combining duplicates within stock", async () => {
    const owner = await signUp("meera@example.in", "9876500001");
    await add(owner, { productId: kurti, size: "L", color: "Rose", quantity: 1 });
    await add(owner, { productId: shirt, size: "40", quantity: 2 });

    // Later, as a guest on another browser…
    const guest: Jar = {};
    await add(guest, { productId: kurti, size: "L", color: "Rose", quantity: 2 }); // 1 + 2 > stock 2
    await add(guest, { productId: bedsheet, size: "King", quantity: 1 });
    await add(guest, { productId: shirt, size: "40", quantity: 1 });
    const guestToken = guest[GUEST_COOKIE];

    // …then signs in there and the storefront calls merge.
    const jar = await signIn("meera@example.in", guest);
    const merged = await json(await mergeCart(req("/api/v1/cart/merge", { body: {}, jar }), ctx()));
    expect(merged.data.items.map((i: { key: string; quantity: number }) => [i.key, i.quantity])).toEqual([
      ["MM-K1-L-ROSE", 2],
      ["MM-S1-40", 3],
      ["MM-B1-KING", 1],
    ]);
    expect(merged.data.notices.join(" ")).toMatch(/Only 2 of Rose Kurti/);
    expect(await Cart.countDocuments({ guestId: guestKey(guestToken) })).toBe(0);

    // Merging again (another tab) adds nothing twice.
    const again = await json(await mergeCart(req("/api/v1/cart/merge", { body: {}, jar }), ctx()));
    expect(again.data.itemCount).toBe(merged.data.itemCount);
  });

  it("skips unavailable guest items during the merge", async () => {
    const guest: Jar = {};
    await add(guest, { productId: kurti, size: "M", color: "Rose", quantity: 1 });
    await add(guest, { productId: bedsheet, size: "Queen", quantity: 1 });
    await Product.updateOne({ slug: "rose-kurti", "variants.sku": "MM-K1-M-ROSE" }, { $set: { "variants.$.stock": 0 } });
    await signUp("ravi@example.in", "9876500002");
    const jar = await signIn("ravi@example.in", guest);
    const merged = await json(await mergeCart(req("/api/v1/cart/merge", { body: {}, jar }), ctx()));
    expect(merged.data.items.map((i: { key: string }) => i.key)).toEqual(["MM-B1-QUEEN"]);
    expect(merged.data.notices.join(" ")).toMatch(/sold out/);
  });

  it("imports a bag saved in the browser, validating every line", async () => {
    const jar = await signUp("anu@example.in", "9876500003");
    const res = await mergeCart(
      req("/api/v1/cart/merge", {
        jar,
        body: {
          items: [
            { productId: kurti, size: "M", color: "Rose", quantity: 2, price: 1 },
            { productId: kurti, size: "M", color: "Rose", quantity: 1 },
            { productId: "p404", size: "M", color: null, quantity: 1 },
            { productId: hidden, size: "M", color: null, quantity: 1 },
            { productId: bedsheet, size: "King", color: null, quantity: 9 },
          ],
        },
      }),
      ctx(),
    );
    const body = await json(res);
    expect(body.data.items.map((i: { key: string; quantity: number; price: number }) => [i.key, i.quantity, i.price])).toEqual([
      ["MM-K1-M-ROSE", 3, 1299],
      ["MM-B1-KING", 4, 1499],
    ]);
    expect(body.data.notices[0]).toMatch(/2 items from your saved bag are no longer available/);
  });

  it("keeps each customer's bag private", async () => {
    const a = await signUp("a@example.in", "9876500004");
    const b = await signUp("b@example.in", "9876500005");
    await add(a, { productId: shirt, size: "40", quantity: 1 });
    await add(b, { productId: bedsheet, size: "King", quantity: 2 });

    expect((await getCart(a)).data.items.map((i: { key: string }) => i.key)).toEqual(["MM-S1-40"]);
    // A can't change or remove B's line — it simply isn't in A's bag.
    expect((await patch(a, "MM-B1-KING", 1)).status).toBe(404);
    expect((await remove(a, "MM-B1-KING")).status).toBe(404);
    await clearCartRoute(req("/api/v1/cart", { method: "DELETE", jar: a }), ctx());
    expect((await getCart(b)).data.items[0]).toMatchObject({ key: "MM-B1-KING", quantity: 2 });
    // Responses never include owner IDs or other customers' data.
    expect(JSON.stringify(await getCart(b))).not.toMatch(/guestId|"user"|@example/);
  });

  it("keeps guest and customer bags separate on the same browser", async () => {
    const guest: Jar = {};
    await add(guest, { productId: shirt, size: "40", quantity: 1 });
    await signUp("c@example.in", "9876500006");
    const jar = await signIn("c@example.in", guest);
    // Signed in, without merging: the account bag is shown, not the guest one.
    expect((await getCart(jar)).data.items).toEqual([]);
    expect((await getCart(guest)).data.itemCount).toBe(1);
  });

  it("asks the browser to refresh when only the signed-in hint is left", async () => {
    const res = await getCartRoute(req("/api/v1/cart", { method: "GET", jar: { [CUSTOMER_HINT_COOKIE]: "1" } }), ctx());
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe("TOKEN_EXPIRED");
  });

  it("falls back to the guest bag for an invalid access token", async () => {
    const guest: Jar = {};
    await add(guest, { productId: shirt, size: "40", quantity: 1 });
    const res = await getCartRoute(req("/api/v1/cart", { method: "GET", jar: { ...guest, mm_at: "forged.token.value" } }), ctx());
    expect((await json(res)).data.itemCount).toBe(1);
  });
});

describe("wishlist", () => {
  const list = async (jar: Jar) => (await json(await getWishlistRoute(req("/api/v1/wishlist", { method: "GET", jar }), ctx()))).data.items;
  const saveP = async (jar: Jar, productId: string) => {
    const res = await save(req("/api/v1/wishlist/items", { body: { productId }, jar }), ctx());
    Object.assign(jar, cookiesOf(res));
    return res;
  };

  it("saves, lists (newest first), prevents duplicates and removes", async () => {
    const jar: Jar = {};
    expect((await saveP(jar, kurti)).status).toBe(200);
    expect(jar[GUEST_COOKIE]).toBeTruthy();
    await saveP(jar, bedsheet);
    await Promise.all([saveP({ ...jar }, kurti), saveP({ ...jar }, kurti), saveP({ ...jar }, kurti)]);
    expect((await list(jar)).map((i: { productId: string }) => i.productId)).toEqual([bedsheet, kurti]);
    expect((await Wishlist.findOne().lean())!.items).toHaveLength(2);

    await unsave(req(`/api/v1/wishlist/items/${kurti}`, { method: "DELETE", jar }), ctx({ productId: kurti }));
    expect((await list(jar)).map((i: { productId: string }) => i.productId)).toEqual([bedsheet]);
    // Removing again is harmless.
    expect((await unsave(req(`/api/v1/wishlist/items/${kurti}`, { method: "DELETE", jar }), ctx({ productId: kurti }))).status).toBe(200);
    await clearWishlistRoute(req("/api/v1/wishlist", { method: "DELETE", jar }), ctx());
    expect(await list(jar)).toEqual([]);
  });

  it("only saves products on sale and hides ones taken off sale", async () => {
    const jar: Jar = {};
    expect((await saveP(jar, hidden)).status).toBe(404);
    expect((await saveP(jar, "nope")).status).toBe(404);
    expect((await saveP(jar, "bad id!")).status).toBe(400);
    // Sold-out products can still be saved.
    expect((await saveP(jar, soldOut)).status).toBe(200);
    await saveP(jar, kurti);
    await Product.updateOne({ slug: "rose-kurti" }, { $set: { status: "archived" } });
    expect((await list(jar)).map((i: { productId: string }) => i.productId)).toEqual([soldOut]);
  });

  it("merges the guest wishlist into the account and imports browser-saved IDs", async () => {
    const guest: Jar = {};
    await saveP(guest, kurti);
    await saveP(guest, shirt);
    const account = await signUp("w@example.in", "9876500007");
    await saveP(account, shirt);
    const jar = await signIn("w@example.in", guest);
    const res = await mergeWishlist(req("/api/v1/wishlist/merge", { body: { productIds: [bedsheet, hidden, "p404", kurti] }, jar }), ctx());
    const ids = (await json(res)).data.items.map((i: { productId: string }) => i.productId).sort();
    expect(ids).toEqual([bedsheet, kurti, shirt].sort());
    expect(await Wishlist.countDocuments({ guestId: { $type: "string" } })).toBe(0);
  });

  it("keeps each customer's wishlist private", async () => {
    const a = await signUp("wa@example.in", "9876500008");
    const b = await signUp("wb@example.in", "9876500009");
    await saveP(b, kurti);
    expect(await list(a)).toEqual([]);
    await unsave(req(`/api/v1/wishlist/items/${kurti}`, { method: "DELETE", jar: a }), ctx({ productId: kurti }));
    expect(await list(b)).toHaveLength(1);
  });
});
