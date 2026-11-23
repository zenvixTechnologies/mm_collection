import "server-only";
import type { ClientSession, Types } from "mongoose";
import type { AdminProduct, AdminVariant, ProductStatus } from "@/types/admin";
import { publicProductId, toStoreProduct, type ProductLean } from "@/server/catalog/mapper";
import { skuCode } from "@/server/catalog/legacy-import";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { badRequest, conflict, notFound } from "@/server/http/errors";
import { paginationMeta } from "@/server/http/response";
import { Category } from "@/server/models/category.model";
import { Coupon } from "@/server/models/coupon.model";
import { InventoryMovement } from "@/server/models/inventory-movement.model";
import { Product } from "@/server/models/product.model";
import { StoreSettings } from "@/server/models/store-settings.model";
import type { ProductBody } from "@/server/validation/admin-catalog";
import { skipFor } from "@/server/validation/common";
import type { z } from "zod";
import type { productListQuery } from "@/server/validation/admin-catalog";
import { audit, type AuditActor } from "./audit.service";
import { duplicateKeyMessage, productRefFilter, refreshStorefront } from "./admin-catalog.shared";

/* ---------- Mapping ---------- */

interface AdminProductLean extends ProductLean {
  status: ProductStatus;
  updatedAt: Date;
  images?: { url: string; publicId?: string | null; width?: number | null; height?: number | null; alt?: string | null }[];
  variants: (ProductLean["variants"][number] & { lowStockThreshold?: number | null })[];
}

type SlugOf = (id: Types.ObjectId) => string | undefined;

export async function categorySlugIndex(session?: ClientSession) {
  const cats = await Category.find({}, { slug: 1 }).session(session ?? null).lean();
  const bySlug = new Map(cats.map((c) => [c.slug, c._id]));
  const byId = new Map(cats.map((c) => [c._id.toString(), c.slug]));
  return { slugOf: ((id) => byId.get(id.toString())) as SlugOf, idOf: (slug: string) => bySlug.get(slug) };
}

export function toAdminProduct(doc: AdminProductLean, slugOf: SlugOf): AdminProduct {
  const base = toStoreProduct(doc, slugOf);
  const variants: AdminVariant[] = doc.variants.map((v) => ({
    sku: v.sku,
    size: v.size ?? null,
    color: v.color ? { name: v.color.name, hex: v.color.hex ?? "#CCCCCC" } : null,
    stock: v.stock,
    reserved: v.reserved,
    available: Math.max(0, v.stock - v.reserved),
    lowStockThreshold: v.lowStockThreshold ?? 0,
    isActive: v.isActive !== false,
    pricePaise: v.pricePaise,
    mrpPaise: v.mrpPaise,
  }));
  const active = variants.filter((v) => v.isActive);
  return {
    ...base,
    // Admins manage units on hand; the storefront shows what is available to buy.
    stock: active.reduce((n, v) => n + v.stock, 0),
    reserved: active.reduce((n, v) => n + v.reserved, 0),
    lowStockThreshold: active.reduce((n, v) => n + v.lowStockThreshold, 0),
    status: doc.status,
    updatedAt: doc.updatedAt.toISOString(),
    variants,
    imageMeta: (doc.images ?? []).map((i) => ({ url: i.url, publicId: i.publicId ?? null, width: i.width ?? null, height: i.height ?? null, alt: i.alt ?? "" })),
  };
}

/* ---------- Reads ---------- */

export async function listAdminProducts(q: z.output<typeof productListQuery>) {
  await connectToDatabase();
  const cats = await categorySlugIndex();
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.audience) filter.audience = q.audience;
  if (q.category) {
    const id = cats.idOf(q.category);
    filter.$or = id ? [{ category: id }, { tags: id }] : [{ _id: null }];
  }
  if (q.q) {
    const term = q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$and = [{ $or: [{ name: { $regex: term, $options: "i" } }, { sku: { $regex: term, $options: "i" } }, { "variants.sku": { $regex: term, $options: "i" } }] }];
  }
  const [docs, total] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1, _id: 1 }).skip(skipFor(q)).limit(q.limit).lean<AdminProductLean[]>(),
    Product.countDocuments(filter),
  ]);
  return { items: docs.map((d) => toAdminProduct(d, cats.slugOf)), meta: paginationMeta(q.page, q.limit, total) };
}

export async function getAdminProduct(ref: string) {
  await connectToDatabase();
  const [doc, cats] = await Promise.all([Product.findOne(productRefFilter(ref)).lean<AdminProductLean>(), categorySlugIndex()]);
  if (!doc) throw notFound("Product not found.");
  return toAdminProduct(doc, cats.slugOf);
}

/* ---------- Writes ---------- */

const variantKey = (size: string | null | undefined, color: { name: string } | null | undefined) =>
  `${size ?? ""}|${color?.name.trim().toLowerCase() ?? ""}`;

function resolveCategories(body: ProductBody, idOf: (slug: string) => Types.ObjectId | undefined, audienceOf: Map<string, string>) {
  const category = idOf(body.category);
  if (!category) throw badRequest("That sub-category doesn't exist.");
  if (audienceOf.get(body.category) !== body.audience) throw badRequest("The sub-category belongs to a different main category.");
  const tags = body.tags.filter((t) => t !== body.category).map((t) => {
    const id = idOf(t);
    if (!id || audienceOf.get(t) !== body.audience) throw badRequest(`"${t}" isn't a ${body.audience} sub-category.`);
    return id;
  });
  return { category, tags };
}

async function categoryLookup(session?: ClientSession) {
  const cats = await Category.find({}, { slug: 1, audience: 1 }).session(session ?? null).lean();
  return {
    idOf: (slug: string) => cats.find((c) => c.slug === slug)?._id,
    audienceOf: new Map(cats.map((c) => [c.slug, c.audience as string])),
    slugOf: ((id: Types.ObjectId) => cats.find((c) => c._id.equals(id))?.slug) as SlugOf,
  };
}

function generatedSku(productSku: string, size: string | null, color: { name: string } | null) {
  return [productSku, size && skuCode(size), color && skuCode(color.name)].filter(Boolean).join("-");
}

function scalarFields(body: ProductBody) {
  return {
    name: body.name,
    slug: body.slug,
    sku: body.sku,
    audience: body.audience,
    shortDescription: body.shortDescription,
    description: body.description,
    images: body.images.map((i) => ({ url: i.url, publicId: i.publicId ?? undefined, width: i.width ?? undefined, height: i.height ?? undefined, alt: i.alt ?? body.name })),
    fabric: body.fabric,
    care: body.care,
    status: body.status,
    featured: body.featured,
    newArrival: body.newArrival,
    bestSeller: body.bestSeller,
  };
}

function openingMovements(productId: Types.ObjectId, variants: { sku: string; stock: number }[], actor: AuditActor, note: string) {
  return variants
    .filter((v) => v.stock > 0)
    .map((v) => ({
      product: productId,
      variantSku: v.sku,
      type: "restock" as const,
      stockChange: v.stock,
      reservedChange: 0,
      stockAfter: v.stock,
      reservedAfter: 0,
      actor: { type: "admin" as const, id: actor.adminId ?? undefined, name: actor.name },
      note,
    }));
}

export async function createProduct(body: ProductBody, actor: AuditActor): Promise<AdminProduct> {
  try {
    const created = await withTransaction(async (session) => {
      const cats = await categoryLookup(session);
      const { category, tags } = resolveCategories(body, cats.idOf, cats.audienceOf);
      const variants = body.variants.map((v) => ({
        sku: v.sku ?? generatedSku(body.sku, v.size, v.color),
        size: v.size,
        color: v.color,
        pricePaise: body.pricePaise,
        mrpPaise: body.mrpPaise,
        stock: v.initialStock ?? 0,
        reserved: 0,
        lowStockThreshold: v.lowStockThreshold,
        isActive: true,
      }));
      const [doc] = await Product.create(
        [
          {
            ...scalarFields(body),
            category,
            tags,
            variants,
            pricePaise: body.pricePaise,
            mrpPaise: body.mrpPaise,
            shipping: body.weightGrams ? { weightGrams: body.weightGrams } : undefined,
            publishedAt: body.status === "active" ? new Date() : null,
          },
        ],
        { session },
      );
      const ledger = openingMovements(doc._id, doc.variants, actor, "Opening stock (new product)");
      if (ledger.length) await InventoryMovement.insertMany(ledger, { session });
      return doc._id;
    });
    const product = await getAdminProduct(created.toString());
    await audit(actor, "product.create", { type: "product", id: product.id, label: product.name }, { status: product.status, variants: product.variants?.length });
    refreshStorefront();
    return product;
  } catch (err) {
    duplicateKeyMessage(err);
    throw err;
  }
}

/**
 * Updates product details and its variant list. Existing variants keep their stock and
 * reservations untouched (stock changes only through inventory adjustments); new combinations
 * get their opening stock; removed combinations are deactivated, never deleted, so their stock
 * history and any pending reservations stay intact.
 */
export async function updateProduct(ref: string, body: ProductBody, actor: AuditActor) {
  try {
    const result = await withTransaction(async (session) => {
      const doc = await Product.findOne(productRefFilter(ref)).session(session);
      if (!doc) throw notFound("Product not found.");
      const cats = await categoryLookup(session);
      const { category, tags } = resolveCategories(body, cats.idOf, cats.audienceOf);
      const before = { status: doc.status, pricePaise: doc.pricePaise, mrpPaise: doc.mrpPaise, name: doc.name };
      const oldImages = doc.images.map((i) => i.publicId).filter(Boolean) as string[];

      const existing = new Map(doc.variants.map((v) => [variantKey(v.size, v.color), v]));
      const seen = new Set<string>();
      const added: { sku: string; stock: number }[] = [];
      for (const input of body.variants) {
        const key = variantKey(input.size, input.color);
        seen.add(key);
        const current = existing.get(key);
        if (current) {
          current.isActive = true;
          current.pricePaise = body.pricePaise;
          current.mrpPaise = body.mrpPaise;
          current.lowStockThreshold = input.lowStockThreshold;
          if (input.color && current.color) current.color.hex = input.color.hex;
        } else {
          const sku = input.sku ?? generatedSku(body.sku, input.size, input.color);
          doc.variants.push({
            sku,
            size: input.size,
            color: input.color,
            pricePaise: body.pricePaise,
            mrpPaise: body.mrpPaise,
            stock: input.initialStock ?? 0,
            reserved: 0,
            lowStockThreshold: input.lowStockThreshold,
            isActive: true,
          });
          added.push({ sku, stock: input.initialStock ?? 0 });
        }
      }
      for (const [key, v] of existing) if (!seen.has(key)) v.isActive = false;

      doc.set({
        ...scalarFields(body),
        category,
        tags,
        ...(body.weightGrams && { "shipping.weightGrams": body.weightGrams }),
      });
      if (body.status === "active" && !doc.publishedAt) doc.publishedAt = new Date();
      await doc.save({ session });

      const ledger = openingMovements(doc._id, added, actor, "Opening stock (new variant)");
      if (ledger.length) await InventoryMovement.insertMany(ledger, { session });

      const keptImages = new Set(body.images.map((i) => i.publicId).filter(Boolean));
      return { id: doc._id.toString(), before, removedImages: oldImages.filter((p) => !keptImages.has(p)) };
    });
    const product = await getAdminProduct(result.id);
    await audit(actor, "product.update", { type: "product", id: product.id, label: product.name }, {
      before: result.before,
      after: { status: product.status, price: product.price, originalPrice: product.originalPrice, name: product.name },
    });
    refreshStorefront();
    return { product, removedImages: result.removedImages };
  } catch (err) {
    duplicateKeyMessage(err);
    throw err;
  }
}

/** Deletes products. Refuses any with units reserved by an unpaid checkout. Returns their Cloudinary images for cleanup. */
export async function deleteProducts(refs: string[], actor: AuditActor) {
  const result = await withTransaction(async (session) => {
    const docs = await Product.find({ $or: refs.map(productRefFilter) }).session(session);
    if (!docs.length) throw notFound("Product not found.");
    const busy = docs.find((d) => d.variants.some((v) => v.reserved > 0));
    if (busy) throw conflict(`“${busy.name}” has units reserved by a pending checkout. Try again once it completes, or archive it instead.`);
    const ids = docs.map((d) => d._id);
    await Product.deleteMany({ _id: { $in: ids } }, { session });
    await StoreSettings.updateMany({}, { $pull: { "homepage.featuredProducts": { $in: ids } } }, { session });
    await Coupon.updateMany({}, { $pull: { products: { $in: ids } } }, { session });
    return docs.map((d) => ({
      id: publicProductId(d),
      name: d.name,
      images: d.images.map((i) => i.publicId).filter(Boolean) as string[],
    }));
  });
  for (const d of result) await audit(actor, "product.delete", { type: "product", id: d.id, label: d.name });
  refreshStorefront();
  return { deleted: result.map((d) => d.id), images: result.flatMap((d) => d.images) };
}

export async function setProductsStatus(refs: string[], status: ProductStatus, actor: AuditActor) {
  await connectToDatabase();
  const docs = await Product.find({ $or: refs.map(productRefFilter) }, { name: 1, images: 1, legacyId: 1, publishedAt: 1 }).lean();
  if (!docs.length) throw notFound("Product not found.");
  // Publishing needs at least one image — skip (and report) any without.
  const eligible = status === "active" ? docs.filter((d) => d.images.length > 0) : docs;
  const skipped = docs.filter((d) => !eligible.includes(d)).map((d) => d.name);
  if (eligible.length) {
    const ids = eligible.map((d) => d._id);
    await Product.updateMany({ _id: { $in: ids } }, { $set: { status } });
    if (status === "active") await Product.updateMany({ _id: { $in: ids }, publishedAt: null }, { $set: { publishedAt: new Date() } });
  }
  await audit(actor, "product.status", { type: "product", label: `${eligible.length} product(s)` }, { status, ids: eligible.map((d) => publicProductId(d)), skipped });
  refreshStorefront();
  return { updated: eligible.map((d) => publicProductId(d)), skipped };
}
