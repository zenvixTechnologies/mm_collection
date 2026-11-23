import "server-only";
import type { z } from "zod";
import type { Audience } from "@/types";
import type { InventoryItem, ProductStatus, StockAdjustment } from "@/types/admin";
import { publicProductId } from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest, conflict, notFound } from "@/server/http/errors";
import { InventoryMovement } from "@/server/models/inventory-movement.model";
import { Product } from "@/server/models/product.model";
import type { ADJUST_REASONS, inventoryAdjustBody, thresholdBody } from "@/server/validation/admin-catalog";
import { audit, type AuditActor } from "./audit.service";
import { productRefFilter, refreshStorefront } from "./admin-catalog.shared";

type Reason = (typeof ADJUST_REASONS)[number];

const MOVEMENT_FOR: Record<Reason, "restock" | "return" | "correction" | "damaged" | "sale"> = {
  Restock: "restock",
  Return: "return",
  Correction: "correction",
  Damaged: "damaged",
  Sale: "sale",
};
const REASON_FOR: Record<string, StockAdjustment["reason"]> = {
  restock: "Restock",
  return: "Return",
  correction: "Correction",
  adjustment: "Correction",
  damaged: "Damaged",
  sale: "Sale",
};

interface ProductForInventory {
  _id: { toString(): string };
  legacyId?: string | null;
  name: string;
  slug: string;
  audience: string;
  status: string;
  images?: { url: string }[];
  variants: {
    sku: string;
    size?: string | null;
    color?: { name: string } | null;
    stock: number;
    reserved: number;
    lowStockThreshold?: number | null;
    isActive?: boolean | null;
    pricePaise: number;
  }[];
}

function toItems(p: ProductForInventory): InventoryItem[] {
  const productId = publicProductId(p as never);
  return p.variants
    // Deactivated variants still show while they hold stock, so nothing is lost from view.
    .filter((v) => v.isActive !== false || v.stock > 0 || v.reserved > 0)
    .map((v) => ({
      id: `${productId}:${v.sku}`,
      productId,
      productName: p.name,
      slug: p.slug,
      image: p.images?.[0]?.url ?? null,
      audienceCategory: p.audience as Audience,
      status: p.status as ProductStatus,
      sku: v.sku,
      size: v.size ?? null,
      color: v.color?.name ?? null,
      stock: v.stock,
      reserved: v.reserved,
      available: Math.max(0, v.stock - v.reserved),
      lowStockThreshold: v.lowStockThreshold ?? 0,
      price: v.pricePaise / 100,
    }));
}

const INVENTORY_FIELDS = { legacyId: 1, name: 1, slug: 1, audience: 1, status: 1, images: { $slice: 1 }, variants: 1 } as const;

export async function listInventory({ includeArchived = false } = {}) {
  await connectToDatabase();
  const docs = await Product.find(includeArchived ? {} : { status: { $ne: "archived" } }, INVENTORY_FIELDS)
    .sort({ name: 1 })
    .lean<ProductForInventory[]>();
  return docs.flatMap(toItems);
}

/**
 * Adds, removes or sets a variant's stock. Runs in a transaction with the ledger entry, so the
 * stock and its history can never disagree; concurrent changes (another admin, a checkout
 * reservation) cause a retry on fresh data instead of a lost update. Stock may never go below
 * the units reserved by pending checkouts.
 */
export async function adjustStock(input: z.output<typeof inventoryAdjustBody>, actor: AuditActor): Promise<InventoryItem> {
  const result = await withTransaction(async (session) => {
    const doc = await Product.findOne(productRefFilter(input.productId)).session(session);
    if (!doc) throw notFound("Product not found.");
    const v = doc.variants.find((x) => x.sku === input.variantSku);
    if (!v) throw notFound("Variant not found.");

    const target = input.mode === "add" ? v.stock + input.quantity : input.mode === "remove" ? v.stock - input.quantity : input.quantity;
    if (target < 0) throw badRequest(`Only ${v.stock} in stock — you can't remove ${input.quantity}.`);
    if (target < v.reserved) {
      throw conflict(`${v.reserved} unit${v.reserved === 1 ? " is" : "s are"} reserved by pending checkouts, so stock can't go below ${v.reserved}.`);
    }
    const change = target - v.stock;
    if (change === 0) throw badRequest("That wouldn't change the stock.");

    v.stock = target;
    await doc.save({ session }); // validate hook refreshes inStock

    await InventoryMovement.create(
      [
        {
          product: doc._id,
          variantSku: v.sku,
          type: MOVEMENT_FOR[input.reason],
          stockChange: change,
          reservedChange: 0,
          stockAfter: target,
          reservedAfter: v.reserved,
          actor: { type: "admin", id: actor.adminId ?? undefined, name: actor.name },
          note: input.note ?? `${input.mode === "set" ? "Set" : input.mode === "add" ? "Added" : "Removed"} via inventory`,
        },
      ],
      { session },
    );
    return { item: toItems(doc.toObject() as unknown as ProductForInventory).find((i) => i.sku === v.sku)!, change };
  });

  await audit(actor, "inventory.adjust", { type: "product", id: result.item.productId, label: `${result.item.productName} (${result.item.sku})` }, {
    reason: input.reason,
    change: result.change,
    stockAfter: result.item.stock,
  });
  refreshStorefront();
  return result.item;
}

export async function setLowStockThreshold(input: z.output<typeof thresholdBody>, actor: AuditActor): Promise<InventoryItem> {
  await connectToDatabase();
  const doc = await Product.findOneAndUpdate(
    { ...productRefFilter(input.productId), "variants.sku": input.variantSku },
    { $set: { "variants.$.lowStockThreshold": input.threshold } },
    { new: true, projection: INVENTORY_FIELDS },
  ).lean<ProductForInventory>();
  if (!doc) throw notFound("Variant not found.");
  const item = toItems(doc).find((i) => i.sku === input.variantSku);
  if (!item) throw new AppError(500, "INTERNAL_ERROR", "Variant could not be loaded.");
  await audit(actor, "inventory.threshold", { type: "product", id: item.productId, label: `${item.productName} (${item.sku})` }, { threshold: input.threshold });
  return item;
}

/** Recent manual stock changes (checkout reservations and releases are omitted). */
export async function listMovements({ limit, productId }: { limit: number; productId?: string }): Promise<StockAdjustment[]> {
  await connectToDatabase();
  const filter: Record<string, unknown> = { type: { $in: ["restock", "return", "correction", "adjustment", "damaged", "sale"] } };
  if (productId) {
    const p = await Product.findOne(productRefFilter(productId), { _id: 1 }).lean();
    if (!p) return [];
    filter.product = p._id;
  }
  const rows = await InventoryMovement.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate<{ product: { _id: unknown; legacyId?: string; name: string } | null }>("product", { name: 1, legacyId: 1 })
    .lean();
  return rows.map((m) => ({
    id: String(m._id),
    productId: m.product ? publicProductId(m.product as never) : "",
    productName: m.product?.name ?? "Deleted product",
    sku: m.variantSku,
    change: m.stockChange,
    reason: REASON_FOR[m.type] ?? "Correction",
    stockAfter: m.stockAfter,
    by: m.actor?.name ?? "system",
    at: (m.createdAt as Date).toISOString(),
  }));
}
