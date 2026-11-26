import "server-only";
import type { ClientSession, Types } from "mongoose";
import { AppError } from "@/server/http/errors";
import { InventoryMovement } from "@/server/models/inventory-movement.model";
import { Product } from "@/server/models/product.model";
import { logger } from "@/server/utils/logger";

/**
 * Checkout stock holds, on the same data the admin inventory uses: each variant's `stock`
 * (units on hand) and `reserved` (units held by unpaid orders), with every change written to the
 * append-only InventoryMovement ledger. Available to sell = stock − reserved.
 *
 * Reservation lifecycle (one order):
 *   checkout      → reserved += qty                  ledger "reservation"  (order pending_payment)
 *   paid          → reserved −= qty, stock −= qty     ledger "sale"         (payment phase — not here)
 *   expired /     → reserved −= qty                  ledger "release"      (order expired/cancelled/
 *   cancelled                                                                payment_failed, unpaid)
 *
 * All functions here must run inside the caller's MongoDB transaction (`session`), together with
 * the order write, so stock, ledger and order can never disagree.
 */

export interface StockVariant {
  sku: string;
  stock: number;
  reserved: number;
  isActive?: boolean | null;
}

export interface StockActor {
  type: "customer" | "system" | "admin";
  id?: Types.ObjectId | string | null;
  name: string;
}

/** `inStock` after a change: any active variant with something left to sell. */
function inStockAfter(variants: StockVariant[], sku: string, reservedAfter: number) {
  return variants.some((v) => v.isActive !== false && v.stock - (v.sku === sku ? reservedAfter : v.reserved) > 0);
}

/**
 * Holds `quantity` units of one variant for an order. `variants` must be the product's variants
 * as read in the same transaction. The update only matches the exact stock/reserved values that
 * were checked, so a concurrent change can never be overwritten (it makes this fail instead).
 */
export async function reserveVariant(
  session: ClientSession,
  args: { productId: Types.ObjectId; variants: StockVariant[]; sku: string; quantity: number; orderId: Types.ObjectId; actor: StockActor },
) {
  const v = args.variants.find((x) => x.sku === args.sku);
  if (!v || v.isActive === false || v.stock - v.reserved < args.quantity) {
    throw new AppError(409, "CART_CHANGED", "An item in your order just sold out. Please review your bag and try again.");
  }
  const reservedAfter = v.reserved + args.quantity;
  const res = await Product.updateOne(
    { _id: args.productId, variants: { $elemMatch: { sku: v.sku, stock: v.stock, reserved: v.reserved } } },
    { $inc: { "variants.$.reserved": args.quantity }, $set: { inStock: inStockAfter(args.variants, v.sku, reservedAfter) } },
    { session },
  );
  if (res.modifiedCount !== 1) {
    throw new AppError(409, "CART_CHANGED", "Stock for an item in your order just changed. Please try again.");
  }
  v.reserved = reservedAfter; // keep the caller's copy in step (several lines may share a product)
  await InventoryMovement.insertMany(
    [
      {
        product: args.productId,
        variantSku: v.sku,
        type: "reservation",
        stockChange: 0,
        reservedChange: args.quantity,
        stockAfter: v.stock,
        reservedAfter,
        order: args.orderId,
        actor: args.actor,
        note: "Held for checkout",
      },
    ],
    { session },
  );
}

/**
 * Releases the units an unpaid order held (never more than are still reserved). Returns how
 * many units were released.
 */
export async function releaseVariant(
  session: ClientSession,
  args: { productId: Types.ObjectId; sku: string; quantity: number; orderId: Types.ObjectId; actor: StockActor; note: string },
) {
  const product = await Product.findById(args.productId, { variants: 1 }).session(session).lean<{ variants: StockVariant[] }>();
  const v = product?.variants.find((x) => x.sku === args.sku);
  if (!product || !v) {
    logger.warn("stock.release_missing_variant", { orderId: String(args.orderId), sku: args.sku });
    return 0;
  }
  const units = Math.min(args.quantity, v.reserved);
  if (units < args.quantity) logger.warn("stock.release_short", { orderId: String(args.orderId), sku: args.sku, held: v.reserved, wanted: args.quantity });
  if (units <= 0) return 0;
  const reservedAfter = v.reserved - units;
  const res = await Product.updateOne(
    { _id: args.productId, variants: { $elemMatch: { sku: v.sku, reserved: v.reserved } } },
    { $inc: { "variants.$.reserved": -units }, $set: { inStock: inStockAfter(product.variants, v.sku, reservedAfter) } },
    { session },
  );
  if (res.modifiedCount !== 1) throw new AppError(409, "CONFLICT", "Stock changed while releasing a reservation. Please retry.");
  await InventoryMovement.insertMany(
    [
      {
        product: args.productId,
        variantSku: v.sku,
        type: "release",
        stockChange: 0,
        reservedChange: -units,
        stockAfter: v.stock,
        reservedAfter,
        order: args.orderId,
        actor: args.actor,
        note: args.note,
      },
    ],
    { session },
  );
  return units;
}

/**
 * Payment confirmed: the units this order held become a sale — reserved −= qty and stock −= qty
 * (ledger "sale"), and the product's sold count goes up. Fails rather than selling units the
 * order doesn't hold.
 */
export async function sellReservedVariant(
  session: ClientSession,
  args: { productId: Types.ObjectId; sku: string; quantity: number; orderId: Types.ObjectId; actor: StockActor },
) {
  const product = await Product.findById(args.productId, { variants: 1 }).session(session).lean<{ variants: StockVariant[] }>();
  const v = product?.variants.find((x) => x.sku === args.sku);
  if (!product || !v || v.reserved < args.quantity || v.stock < args.quantity) {
    throw new AppError(409, "CONFLICT", "Reserved stock for this order is missing — it needs staff attention.");
  }
  const stockAfter = v.stock - args.quantity;
  const reservedAfter = v.reserved - args.quantity;
  const after = product.variants.map((x) => (x.sku === v.sku ? { ...x, stock: stockAfter, reserved: reservedAfter } : x));
  const res = await Product.updateOne(
    { _id: args.productId, variants: { $elemMatch: { sku: v.sku, stock: v.stock, reserved: v.reserved } } },
    {
      $inc: { "variants.$.stock": -args.quantity, "variants.$.reserved": -args.quantity, soldCount: args.quantity },
      $set: { inStock: after.some((x) => x.isActive !== false && x.stock - x.reserved > 0) },
    },
    { session },
  );
  if (res.modifiedCount !== 1) throw new AppError(409, "CONFLICT", "Stock changed while confirming the payment. Please retry.");
  await InventoryMovement.insertMany(
    [
      {
        product: args.productId,
        variantSku: v.sku,
        type: "sale",
        stockChange: -args.quantity,
        reservedChange: -args.quantity,
        stockAfter,
        reservedAfter,
        order: args.orderId,
        actor: args.actor,
        note: "Payment confirmed — reserved units sold",
      },
    ],
    { session },
  );
}

/**
 * A payment that arrived after the order's hold was released: sell the units again from what is
 * available now, if every line still can be (callers check first with `canSellAvailable`).
 */
export async function canSellAvailable(session: ClientSession, lines: { productId: Types.ObjectId; sku: string; quantity: number }[]) {
  for (const l of lines) {
    const p = await Product.findById(l.productId, { variants: 1 }).session(session).lean<{ variants: StockVariant[] }>();
    const v = p?.variants.find((x) => x.sku === l.sku);
    if (!v || v.stock - v.reserved < l.quantity) return false;
  }
  return true;
}

export async function sellAvailableVariant(
  session: ClientSession,
  args: { productId: Types.ObjectId; sku: string; quantity: number; orderId: Types.ObjectId; actor: StockActor },
) {
  const product = await Product.findById(args.productId, { variants: 1 }).session(session).lean<{ variants: StockVariant[] }>();
  const v = product?.variants.find((x) => x.sku === args.sku);
  if (!product || !v || v.stock - v.reserved < args.quantity) throw new AppError(409, "CONFLICT", "Not enough stock to fulfil a late payment.");
  const stockAfter = v.stock - args.quantity;
  const after = product.variants.map((x) => (x.sku === v.sku ? { ...x, stock: stockAfter } : x));
  const res = await Product.updateOne(
    { _id: args.productId, variants: { $elemMatch: { sku: v.sku, stock: v.stock, reserved: v.reserved } } },
    { $inc: { "variants.$.stock": -args.quantity, soldCount: args.quantity }, $set: { inStock: after.some((x) => x.isActive !== false && x.stock - x.reserved > 0) } },
    { session },
  );
  if (res.modifiedCount !== 1) throw new AppError(409, "CONFLICT", "Stock changed while confirming the payment. Please retry.");
  await InventoryMovement.insertMany(
    [
      {
        product: args.productId,
        variantSku: v.sku,
        type: "sale",
        stockChange: -args.quantity,
        reservedChange: 0,
        stockAfter,
        reservedAfter: v.reserved,
        order: args.orderId,
        actor: args.actor,
        note: "Paid after the reservation expired — sold from available stock",
      },
    ],
    { session },
  );
}

/**
 * A paid order cancelled before it shipped: its sold units go back on the shelf — stock += qty,
 * ledger "return", sold count down. Runs in the caller's transaction with the status change, so it
 * happens exactly once (the cancellation is a one-way status move).
 */
export async function restockVariant(
  session: ClientSession,
  args: { productId: Types.ObjectId; sku: string; quantity: number; orderId: Types.ObjectId; actor: StockActor; note: string },
) {
  const product = await Product.findById(args.productId, { variants: 1, soldCount: 1 }).session(session).lean<{ variants: StockVariant[]; soldCount?: number }>();
  const v = product?.variants.find((x) => x.sku === args.sku);
  if (!product || !v) {
    logger.warn("stock.restock_missing_variant", { orderId: String(args.orderId), sku: args.sku });
    return 0;
  }
  const stockAfter = v.stock + args.quantity;
  const after = product.variants.map((x) => (x.sku === v.sku ? { ...x, stock: stockAfter } : x));
  const res = await Product.updateOne(
    { _id: args.productId, variants: { $elemMatch: { sku: v.sku, stock: v.stock } } },
    {
      $inc: { "variants.$.stock": args.quantity, soldCount: -Math.min(args.quantity, product.soldCount ?? 0) },
      $set: { inStock: after.some((x) => x.isActive !== false && x.stock - x.reserved > 0) },
    },
    { session },
  );
  if (res.modifiedCount !== 1) throw new AppError(409, "CONFLICT", "Stock changed while cancelling the order. Please retry.");
  await InventoryMovement.insertMany(
    [
      {
        product: args.productId,
        variantSku: v.sku,
        type: "return",
        stockChange: args.quantity,
        reservedChange: 0,
        stockAfter,
        reservedAfter: v.reserved,
        order: args.orderId,
        actor: args.actor,
        note: args.note,
      },
    ],
    { session },
  );
  return args.quantity;
}
