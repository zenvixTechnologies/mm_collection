import "server-only";
import { isValidObjectId, Types } from "mongoose";
import { MAX_WISHLIST_ITEMS, type WishlistSnapshot } from "@/types";
import { guestExpiry } from "@/server/auth/guest";
import { ownerFilter, type Shopper } from "@/server/auth/shopper";
import { publicProductId } from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { conflict, notFound } from "@/server/http/errors";
import { Product } from "@/server/models/product.model";
import { Wishlist } from "@/server/models/wishlist.model";
import { backoff, publicProductFilter } from "./cart.service";

/**
 * Saved products for customers and guests. Adds and removes are single atomic updates (a
 * product can't be saved twice, however many requests race); merges are compare-and-set on
 * `revision`. Products taken off sale are hidden from the list but kept, so they reappear if
 * the product comes back.
 */

type Owner = Exclude<Shopper, { kind: "anonymous" }>;

interface WishlistDoc {
  _id: Types.ObjectId;
  items: { product: Types.ObjectId; addedAt: Date }[];
  revision?: number;
}

interface ProductRef {
  _id: Types.ObjectId;
  legacyId?: string | null;
}

const ownerSet = (owner: Owner) => (owner.kind === "guest" ? { expiresAt: guestExpiry() } : {});
/** Slides a guest wishlist's expiry on every write (no empty `$set` for customers). */
const touch = (owner: Owner) => (owner.kind === "guest" ? { $set: { expiresAt: guestExpiry() } } : {});

async function toView(doc: Pick<WishlistDoc, "items"> | null): Promise<WishlistSnapshot> {
  if (!doc?.items.length) return { items: [] };
  const products = await Product.find(
    { _id: { $in: doc.items.map((i) => i.product) }, status: "active", visible: true },
    { legacyId: 1 },
  ).lean<ProductRef[]>();
  const byId = new Map(products.map((p) => [p._id.toString(), publicProductId(p)]));
  return {
    items: [...doc.items]
      .sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt))
      .flatMap((i) => {
        const id = byId.get(i.product.toString());
        return id ? [{ productId: id, addedAt: new Date(i.addedAt).toISOString() }] : [];
      }),
  };
}

async function ensureWishlist(owner: Owner) {
  const filter = ownerFilter(owner);
  try {
    await Wishlist.updateOne(
      filter,
      { $setOnInsert: { items: [], revision: 0, expiresAt: owner.kind === "guest" ? guestExpiry() : null } },
      { upsert: true },
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err; // a concurrent first write created it
  }
}

export async function getWishlist(shopper: Shopper): Promise<WishlistSnapshot> {
  if (shopper.kind === "anonymous") return { items: [] };
  await connectToDatabase();
  return toView(await Wishlist.findOne(ownerFilter(shopper), { items: 1 }).lean<WishlistDoc>());
}

export async function addToWishlist(owner: Owner, productRef: string): Promise<WishlistSnapshot> {
  await connectToDatabase();
  const product = await Product.findOne(publicProductFilter(productRef), { _id: 1 }).lean<ProductRef>();
  if (!product) throw notFound("This product is no longer available.");
  await ensureWishlist(owner);
  const filter = ownerFilter(owner);
  // Only pushes when the product isn't saved yet and there's room — atomic, so never duplicated.
  const res = await Wishlist.updateOne(
    { ...filter, "items.product": { $ne: product._id }, [`items.${MAX_WISHLIST_ITEMS - 1}`]: { $exists: false } },
    { $push: { items: { product: product._id, addedAt: new Date() } }, ...touch(owner), $inc: { revision: 1 } },
  );
  const doc = await Wishlist.findOne(filter, { items: 1 }).lean<WishlistDoc>();
  if (res.modifiedCount === 0 && !doc?.items.some((i) => i.product.equals(product._id))) {
    throw conflict(`Your wishlist is full (${MAX_WISHLIST_ITEMS} items). Remove something to save this.`);
  }
  return toView(doc);
}

export async function removeFromWishlist(shopper: Shopper, productRef: string): Promise<WishlistSnapshot> {
  if (shopper.kind === "anonymous") return { items: [] };
  await connectToDatabase();
  // Removing works for products that have since been hidden too.
  const or: Record<string, unknown>[] = [{ legacyId: productRef }];
  if (isValidObjectId(productRef)) or.push({ _id: new Types.ObjectId(productRef) });
  const product = await Product.findOne({ $or: or }, { _id: 1 }).lean<ProductRef>();
  const filter = ownerFilter(shopper);
  if (product) {
    await Wishlist.updateOne(filter, { $pull: { items: { product: product._id } }, ...touch(shopper), $inc: { revision: 1 } });
  }
  return toView(await Wishlist.findOne(filter, { items: 1 }).lean<WishlistDoc>());
}

export async function clearWishlist(shopper: Shopper): Promise<WishlistSnapshot> {
  if (shopper.kind === "anonymous") return { items: [] };
  await connectToDatabase();
  await Wishlist.updateOne(ownerFilter(shopper), { $set: { items: [] }, $inc: { revision: 1 } });
  return { items: [] };
}

/**
 * Merges a guest wishlist (claimed atomically) and/or product IDs saved in the browser before
 * wishlists lived on the server into the shopper's wishlist. Duplicates and products no longer
 * on sale are skipped.
 */
export async function mergeIntoWishlist(owner: Owner, opts: { guestKey?: string | null; productIds?: string[] }): Promise<WishlistSnapshot> {
  await connectToDatabase();
  let claimed: WishlistDoc | null = null;
  if (owner.kind === "customer" && opts.guestKey) {
    claimed = await Wishlist.findOneAndDelete({ guestId: opts.guestKey }, { projection: { items: 1 } }).lean<WishlistDoc>();
  }

  const refs = [...new Set(opts.productIds ?? [])];
  const objectIds = refs.filter(isValidObjectId).map((id) => new Types.ObjectId(id));
  const fromBrowser = refs.length
    ? await Product.find({ status: "active", visible: true, $or: [{ legacyId: { $in: refs } }, { _id: { $in: objectIds } }] }, { _id: 1 }).lean<
        ProductRef[]
      >()
    : [];
  const incoming = [
    ...(claimed?.items ?? []).map((i) => ({ product: i.product, addedAt: i.addedAt ?? new Date() })),
    ...fromBrowser.map((p) => ({ product: p._id, addedAt: new Date() })),
  ];
  if (!incoming.length) return getWishlist(owner);

  try {
    await ensureWishlist(owner);
    const filter = ownerFilter(owner);
    for (let attempt = 0; attempt < 8; attempt++) {
      const doc = await Wishlist.findOne(filter, { items: 1, revision: 1 }).lean<WishlistDoc>();
      if (!doc) break;
      const items = [...doc.items];
      const seen = new Set(items.map((i) => i.product.toString()));
      for (const inc of incoming) {
        if (items.length >= MAX_WISHLIST_ITEMS) break;
        if (seen.has(inc.product.toString())) continue;
        seen.add(inc.product.toString());
        items.push(inc);
      }
      const res = await Wishlist.updateOne(
        { _id: doc._id, revision: doc.revision ?? 0 },
        { $set: { items, ...ownerSet(owner) }, $inc: { revision: 1 } },
      );
      if (res.matchedCount === 1) return toView({ items });
      await backoff(attempt);
    }
    throw conflict("Your wishlist was being updated at the same time. Please try again.");
  } catch (err) {
    if (claimed?.items.length && opts.guestKey) {
      await Wishlist.create({ guestId: opts.guestKey, items: claimed.items, expiresAt: guestExpiry() }).catch(() => undefined);
    }
    throw err;
  }
}
