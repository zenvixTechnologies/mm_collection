import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { AdminCategory } from "@/types/admin";
import type { Audience } from "@/types";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { conflict, notFound } from "@/server/http/errors";
import { Category } from "@/server/models/category.model";
import { Coupon } from "@/server/models/coupon.model";
import { Product } from "@/server/models/product.model";
import type { categoryBody, categoryPatch } from "@/server/validation/admin-catalog";
import { audit, type AuditActor } from "./audit.service";
import { categoryRefFilter, duplicateKeyMessage, refreshStorefront } from "./admin-catalog.shared";

interface CategoryLean {
  _id: Types.ObjectId;
  slug: string;
  audience: string;
  name: string;
  description?: string | null;
  image?: { url: string; publicId?: string | null } | null;
  visible?: boolean | null;
  sortOrder?: number | null;
}

function toAdminCategory(c: CategoryLean, productCount = 0): AdminCategory {
  return {
    id: c.slug,
    slug: c.slug,
    audience: c.audience as Audience,
    name: c.name,
    description: c.description ?? "",
    image: c.image?.url ?? "",
    imagePublicId: c.image?.publicId ?? null,
    visible: c.visible !== false,
    sortOrder: c.sortOrder ?? 0,
    productCount,
  };
}

export async function listAdminCategories(): Promise<AdminCategory[]> {
  await connectToDatabase();
  const [cats, counts] = await Promise.all([
    Category.find().sort({ audience: 1, sortOrder: 1 }).lean<CategoryLean[]>(),
    Product.aggregate<{ _id: unknown; n: number }>([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  return cats.map((c) => toAdminCategory(c, byId.get(c._id.toString()) ?? 0));
}

async function getAdminCategory(ref: string) {
  const c = await Category.findOne(categoryRefFilter(ref)).lean<CategoryLean>();
  if (!c) throw notFound("Category not found.");
  return toAdminCategory(c, await Product.countDocuments({ category: c._id }));
}

const imageDoc = (img: z.output<typeof categoryBody>["image"], alt: string) =>
  img ? { url: img.url, publicId: img.publicId ?? undefined, width: img.width ?? undefined, height: img.height ?? undefined, alt: img.alt ?? alt } : null;

export async function createCategory(body: z.output<typeof categoryBody>, actor: AuditActor) {
  await connectToDatabase();
  try {
    const last = await Category.findOne({ audience: body.audience }).sort({ sortOrder: -1 }).lean();
    await Category.create({
      slug: body.slug,
      audience: body.audience,
      name: body.name,
      description: body.description,
      image: imageDoc(body.image, body.name),
      visible: body.visible,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    });
  } catch (err) {
    duplicateKeyMessage(err);
    throw err;
  }
  const category = await getAdminCategory(body.slug);
  await audit(actor, "category.create", { type: "category", id: category.slug, label: category.name });
  refreshStorefront();
  return category;
}

export async function updateCategory(ref: string, patch: z.output<typeof categoryPatch>, actor: AuditActor) {
  await connectToDatabase();
  const doc = await Category.findOne(categoryRefFilter(ref));
  if (!doc) throw notFound("Category not found.");
  const oldImage = doc.image?.publicId ?? null;
  if (patch.name !== undefined) doc.name = patch.name;
  if (patch.description !== undefined) doc.description = patch.description;
  if (patch.visible !== undefined) doc.visible = patch.visible;
  if (patch.image !== undefined) doc.set("image", imageDoc(patch.image, doc.name));
  await doc.save();
  const category = await getAdminCategory(doc.slug);
  await audit(actor, "category.update", { type: "category", id: category.slug, label: category.name }, patch);
  refreshStorefront();
  const removedImage = oldImage && oldImage !== (doc.image?.publicId ?? null) ? oldImage : null;
  return { category, removedImage };
}

/** Deleting is refused while any product uses the category as its main sub-category. */
export async function deleteCategory(ref: string, actor: AuditActor) {
  const removed = await withTransaction(async (session) => {
    const doc = await Category.findOne(categoryRefFilter(ref)).session(session);
    if (!doc) throw notFound("Category not found.");
    const inUse = await Product.countDocuments({ category: doc._id }).session(session);
    if (inUse) throw conflict(`${inUse} product${inUse === 1 ? " uses" : "s use"} this category. Move them to another category first, or hide it.`);
    await Product.updateMany({ tags: doc._id }, { $pull: { tags: doc._id } }, { session });
    await Coupon.updateMany({ categories: doc._id }, { $pull: { categories: doc._id } }, { session });
    await doc.deleteOne({ session });
    return { slug: doc.slug, name: doc.name, image: doc.image?.publicId ?? null };
  });
  await audit(actor, "category.delete", { type: "category", id: removed.slug, label: removed.name });
  refreshStorefront();
  return removed;
}

/** Swaps a category with its neighbour within the same main category. */
export async function moveCategory(ref: string, direction: -1 | 1, actor: AuditActor) {
  const moved = await withTransaction(async (session) => {
    const doc = await Category.findOne(categoryRefFilter(ref)).session(session);
    if (!doc) throw notFound("Category not found.");
    const siblings = await Category.find({ audience: doc.audience }).sort({ sortOrder: 1, _id: 1 }).session(session);
    const i = siblings.findIndex((c) => c._id.equals(doc._id));
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return null;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    // Rewrite a clean 0..n order, which also repairs any duplicate sort values.
    await Category.bulkWrite(
      siblings.map((c, index) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { sortOrder: index } } } })),
      { session },
    );
    return doc.slug;
  });
  if (moved) {
    await audit(actor, "category.reorder", { type: "category", id: moved }, { direction });
    refreshStorefront();
  }
  return listAdminCategories();
}
