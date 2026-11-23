import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "./index";
import { Cart, Category, Coupon, Order, Product, StoreSettings } from "./index";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-models-test");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
}, 180_000);

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

const variant = (sku: string, over: Record<string, unknown> = {}) => ({
  sku,
  size: "M",
  color: { name: "Ivory", hex: "#F4EFE6" },
  pricePaise: 129900,
  mrpPaise: 189900,
  stock: 5,
  ...over,
});

async function category(slug = "kurtis") {
  return Category.findOneAndUpdate(
    { slug },
    { $setOnInsert: { slug, audience: "women", name: "Kurtis" } },
    { upsert: true, new: true },
  );
}

type RawDoc<M> = M extends mongoose.Model<infer T> ? T : never;
type ProductInput = Partial<RawDoc<typeof Product>>;

const product = async (over: Record<string, unknown> = {}): Promise<ProductInput> => ({
  slug: "test-kurti",
  name: "Test Kurti",
  sku: "MM-KUR-1",
  audience: "women",
  category: (await category())!._id,
  pricePaise: 129900,
  mrpPaise: 189900,
  variants: [variant("MM-KUR-1-M-IVO")],
  ...over,
}) as ProductInput;

describe("collections", () => {
  it("creates one collection per model with indexes", async () => {
    const names = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name);
    expect(names).toHaveLength(Object.keys(models).length);
    expect(names).toEqual(expect.arrayContaining(["products", "orders", "coupon_redemptions", "webhook_events"]));
    const productIndexes = await Product.collection.indexes();
    expect(productIndexes.map((i) => i.name)).toEqual(expect.arrayContaining(["slug_1", "variants.sku_1", "product_text"]));
  });
});

describe("Product", () => {
  it("accepts a valid product and rejects fractional paise and MRP below price", async () => {
    await expect(Product.create(await product())).resolves.toBeTruthy();
    await expect(Product.validate(await product({ slug: "a", sku: "A", pricePaise: 10.5 }))).rejects.toThrow(/whole paise/);
    await expect(
      new Product(await product({ slug: "b", sku: "B", variants: [variant("B-1", { mrpPaise: 100 })] })).validate(),
    ).rejects.toThrow(/MRP/);
  });

  it("enforces variant SKU uniqueness within and across products", async () => {
    await expect(
      new Product(await product({ slug: "c", sku: "C", variants: [variant("DUP"), variant("DUP")] })).validate(),
    ).rejects.toThrow(/unique/);
    await expect(Product.create(await product({ slug: "d", sku: "D", variants: [variant("MM-KUR-1-M-IVO")] }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("supports non-clothing variants like bed sizes without a colour", async () => {
    const cat = await category("home-bedsheets");
    const p = await Product.create(
      await product({
        slug: "bedsheet",
        sku: "MM-HBS-1",
        audience: "home-living",
        category: cat!._id,
        variants: [variant("MM-HBS-1-KING", { size: "King", color: null }), variant("MM-HBS-1-QUEEN", { size: "Queen", color: null })],
        attributes: { threadCount: "300" },
      }),
    );
    expect(p.variants).toHaveLength(2);
  });
});

describe("Cart, Coupon, Order, StoreSettings", () => {
  it("allows one cart per guest and many guest carts overall", async () => {
    await Cart.create({ guestId: "g1" });
    await Cart.create({ guestId: "g2" });
    await expect(Cart.create({ guestId: "g1" })).rejects.toMatchObject({ code: 11000 });
  });

  it("validates coupons", async () => {
    await expect(new Coupon({ code: "BIG", type: "percent", value: 150 }).validate()).rejects.toThrow(/exceed 100/);
    await expect(new Coupon({ code: "SAVE15", type: "percent", value: 15, maxDiscountPaise: 75000 }).validate()).resolves.toBeUndefined();
  });

  it("stores shipping as null (charges applicable) and requires Indian addresses", async () => {
    const base = {
      orderNumber: "MMTEST01",
      customer: { fullName: "Asha K", email: "asha@example.in", mobile: "9876543210" },
      shippingAddress: { house: "1", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682016" },
      items: [
        { product: new mongoose.Types.ObjectId(), variantSku: "X", name: "X", slug: "x", unitPricePaise: 100, mrpPaise: 100, quantity: 1, lineTotalPaise: 100 },
      ],
      subtotalPaise: 100,
      mrpTotalPaise: 100,
      discountPaise: 0,
      totalPaise: 100,
    };
    const order = await Order.create(base);
    expect(order.shippingPaise).toBeNull();
    expect(order.status).toBe("pending_payment");
    await expect(
      new Order({ ...base, orderNumber: "MMTEST02", shippingAddress: { ...base.shippingAddress, state: "Texas" } }).validate(),
    ).rejects.toThrow();
  });

  it("keeps COD disabled in settings", async () => {
    await expect(new StoreSettings({ checkout: { codEnabled: true } }).validate()).rejects.toThrow();
    const s = await StoreSettings.create({});
    expect(s.shipping?.chargesNotice).toBe("Shipping Charges Applicable");
  });
});
