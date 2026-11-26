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
  type: "customer" | "system";
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
