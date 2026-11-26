import "server-only";
import { isValidObjectId, Types } from "mongoose";
import { MAX_CART_LINES, MAX_LINE_QUANTITY, type Audience, type CartItem, type CartSnapshot, type Size } from "@/types";
import { guestExpiry } from "@/server/auth/guest";
import { ownerFilter, type OwnerFilter, type Shopper } from "@/server/auth/shopper";
import { publicProductId } from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { AppError, badRequest, conflict, notFound } from "@/server/http/errors";
import { Cart } from "@/server/models/cart.model";
import { Product } from "@/server/models/product.model";
import { logger } from "@/server/utils/logger";
import type { CartLineInput } from "@/server/validation/cart";

/**
 * Shopping bag for customers and guests.
 *
 * - The database stores only product, variant SKU and quantity. Prices, MRP, names, images and
 *   stock are re-read from the product on every request — nothing the browser sends about money
 *   is ever used.
 * - Every write is a compare-and-set on `revision`: read the bag, compute the new lines against
 *   live stock, write only if nobody changed the bag meanwhile, otherwise retry. Concurrent
 *   requests (double clicks, two tabs) therefore never lose an update or exceed stock.
 * - Each read reconciles the bag with the catalogue: lines whose product was hidden or whose
 *   variant sold out are removed and quantities above available stock are reduced, with a
 *   notice for the shopper.
 */

/* ---------- Product data ---------- */

interface VariantDoc {
  sku: string;
  size?: string | null;
  color?: { name: string } | null;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  reserved: number;
  isActive?: boolean | null;
}

export interface CartProductDoc {
  _id: Types.ObjectId;
  legacyId?: string | null;
  slug: string;
  name: string;
  audience: string;
  status: string;
  visible?: boolean | null;
  images?: { url: string }[];
  variants: VariantDoc[];
}

interface StoredLine {
  product: Types.ObjectId;
  variantSku: string;
  quantity: number;
  addedAt: Date;
}

const PRODUCT_FIELDS = { legacyId: 1, slug: 1, name: 1, audience: 1, status: 1, visible: 1, images: { $slice: 1 }, variants: 1 } as const;
const PUBLIC = { status: "active", visible: true } as const;
const MAX_ATTEMPTS = 8;

/** Short randomised pause between compare-and-set retries, so racing requests spread out. */
export const backoff = (attempt: number) => new Promise((r) => setTimeout(r, Math.random() * 15 * (attempt + 1)));

export const isPublicProduct = (p: Pick<CartProductDoc, "status" | "visible"> | undefined): p is CartProductDoc =>
  !!p && p.status === "active" && p.visible !== false;

const sellable = (v: VariantDoc | undefined): v is VariantDoc => !!v && v.isActive !== false;
export const availableUnits = (v: VariantDoc) => Math.max(0, v.stock - v.reserved);
const lineCap = (v: VariantDoc) => Math.min(availableUnits(v), MAX_LINE_QUANTITY);

function label(p: CartProductDoc, v?: VariantDoc) {
  const opts = v ? [v.size, v.color?.name].filter(Boolean).join(" / ") : "";
  return opts ? `${p.name} (${opts})` : p.name;
}

/** Product by public ID (p001) or database ID; only products on sale. */
export function publicProductFilter(ref: string) {
  const or: Record<string, unknown>[] = [{ legacyId: ref }];
  if (isValidObjectId(ref)) or.push({ _id: new Types.ObjectId(ref) });
  return { ...PUBLIC, $or: or };
}

async function loadProducts(ids: Types.ObjectId[]) {
  const unique = [...new Set(ids.map(String))].map((id) => new Types.ObjectId(id));
  const docs = unique.length ? await Product.find({ _id: { $in: unique } }, PRODUCT_FIELDS).lean<CartProductDoc[]>() : [];
  return new Map(docs.map((d) => [d._id.toString(), d]));
}

/** Public products by public ID (legacy or database ID), keyed by the reference given. */
async function loadPublicProductsByRef(refs: string[]) {
  const unique = [...new Set(refs)];
  if (!unique.length) return new Map<string, CartProductDoc>();
  const objectIds = unique.filter(isValidObjectId).map((id) => new Types.ObjectId(id));
  const docs = await Product.find({ ...PUBLIC, $or: [{ legacyId: { $in: unique } }, { _id: { $in: objectIds } }] }, PRODUCT_FIELDS).lean<
    CartProductDoc[]
  >();
  const byRef = new Map<string, CartProductDoc>();
  for (const d of docs) {
    if (d.legacyId) byRef.set(d.legacyId, d);
    byRef.set(d._id.toString(), d);
  }
  return byRef;
}

/** The variant matching a size/colour choice exactly (null = the product has no such option). */
export function findVariant(p: CartProductDoc, size: string | null, color: string | null) {
  return p.variants.find((v) => sellable(v) && (v.size ?? null) === size && (v.color?.name ?? null) === color);
}

/* ---------- Reconciliation & view ---------- */

function reconcile(lines: StoredLine[], products: Map<string, CartProductDoc>) {
  const notices: string[] = [];
  const out: StoredLine[] = [];
  let changed = false;
  for (const line of lines) {
    const p = products.get(line.product.toString());
    const v = p?.variants.find((x) => x.sku === line.variantSku);
    if (!isPublicProduct(p) || !sellable(v)) {
      notices.push(`${p?.name ?? "An item"} is no longer available and was removed from your bag.`);
      changed = true;
      continue;
    }
    const avail = availableUnits(v);
    if (avail <= 0) {
      notices.push(`${label(p, v)} is sold out and was removed from your bag.`);
      changed = true;
      continue;
    }
    const dup = out.find((x) => x.variantSku === line.variantSku);
    if (dup) {
      dup.quantity += line.quantity;
      changed = true;
    } else {
      out.push({ product: line.product, variantSku: line.variantSku, quantity: line.quantity, addedAt: line.addedAt ?? new Date() });
    }
  }
  for (const line of out) {
    const p = products.get(line.product.toString())!;
    const v = p.variants.find((x) => x.sku === line.variantSku)!;
    const cap = lineCap(v);
    if (line.quantity > cap) {
      line.quantity = cap;
      changed = true;
      notices.push(
        cap < MAX_LINE_QUANTITY
          ? `Only ${cap} of ${label(p, v)} ${cap === 1 ? "is" : "are"} available — we've updated the quantity in your bag.`
          : `You can buy up to ${MAX_LINE_QUANTITY} of ${label(p, v)} — we've updated the quantity in your bag.`,
      );
    }
  }
  return { lines: out, notices, changed };
}

function toView(lines: StoredLine[], products: Map<string, CartProductDoc>, notices: string[] = []): CartSnapshot {
  const items: CartItem[] = [];
  let subtotalPaise = 0;
  let mrpPaise = 0;
  let itemCount = 0;
  for (const line of lines) {
    const p = products.get(line.product.toString());
    const v = p?.variants.find((x) => x.sku === line.variantSku);
    if (!p || !v) continue;
    subtotalPaise += v.pricePaise * line.quantity;
    mrpPaise += Math.max(v.mrpPaise, v.pricePaise) * line.quantity;
    itemCount += line.quantity;
    items.push({
      key: v.sku,
      productId: publicProductId(p),
      slug: p.slug,
      name: p.name,
      image: p.images?.[0]?.url ?? "",
      price: v.pricePaise / 100,
      originalPrice: Math.max(v.mrpPaise, v.pricePaise) / 100,
      size: (v.size ?? null) as Size | null,
      color: v.color?.name ?? null,
      quantity: line.quantity,
      stock: availableUnits(v),
      audience: p.audience as Audience,
    });
  }
  return { items, itemCount, subtotal: subtotalPaise / 100, mrpTotal: mrpPaise / 100, notices };
}

const EMPTY: CartSnapshot = { items: [], itemCount: 0, subtotal: 0, mrpTotal: 0, notices: [] };
export const emptyCart = (): CartSnapshot => ({ ...EMPTY, items: [], notices: [] });

/* ---------- Persistence ---------- */

type Owner = Exclude<Shopper, { kind: "anonymous" }>;

interface CartDoc {
  _id: Types.ObjectId;
  items: StoredLine[];
  revision?: number;
}

const ownerSet = (owner: Owner) => (owner.kind === "guest" ? { expiresAt: guestExpiry() } : {});

async function findCart(filter: OwnerFilter) {
  return Cart.findOne(filter, { items: 1, revision: 1 }).lean<CartDoc>();
}

async function ensureCart(owner: Owner): Promise<CartDoc> {
  const filter = ownerFilter(owner);
  for (let i = 0; i < 2; i++) {
    try {
      const doc = await Cart.findOneAndUpdate(
        filter,
        { $setOnInsert: { items: [], revision: 0, ...(owner.kind === "guest" ? { expiresAt: guestExpiry() } : { expiresAt: null }) } },
        { upsert: true, returnDocument: "after", projection: { items: 1, revision: 1 } },
      ).lean<CartDoc>();
      if (doc) return doc;
    } catch (err) {
      // Two first-writes raced on the unique owner index — the other one created it; read again.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  const doc = await findCart(filter);
  if (!doc) throw new AppError(503, "SERVICE_UNAVAILABLE", "We couldn't open your bag. Please try again.");
  return doc;
}

/**
 * Read → compute → compare-and-set, retried on concurrent changes. `compute` receives the bag
 * already reconciled with live stock and must be pure: it may run more than once.
 */
async function mutate(
  owner: Owner,
  opts: { create: boolean; preload?: Types.ObjectId[] },
  compute: (lines: StoredLine[], products: Map<string, CartProductDoc>) => StoredLine[],
): Promise<CartSnapshot> {
  await connectToDatabase();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const cart = opts.create ? await ensureCart(owner) : await findCart(ownerFilter(owner));
    if (!cart) throw notFound("This item is not in your bag.");
    const products = await loadProducts([...cart.items.map((l) => l.product), ...(opts.preload ?? [])]);
    const rec = reconcile(cart.items, products);
    const next = compute(rec.lines.map((l) => ({ ...l })), products);
    const res = await Cart.updateOne(
      { _id: cart._id, revision: cart.revision ?? 0 },
      { $set: { items: next, ...ownerSet(owner) }, $inc: { revision: 1 } },
      { runValidators: true },
    );
    if (res.matchedCount === 1) return toView(next, products, rec.notices);
    logger.info("cart.write_conflict", { attempt });
    await backoff(attempt);
  }
  throw conflict("Your bag was being updated at the same time. Please try again.");
}

/* ---------- Public API ---------- */

export async function getCart(shopper: Shopper): Promise<CartSnapshot> {
  if (shopper.kind === "anonymous") return emptyCart();
  await connectToDatabase();
  const cart = await findCart(ownerFilter(shopper));
  if (!cart || !cart.items.length) return emptyCart();
  const products = await loadProducts(cart.items.map((l) => l.product));
  const rec = reconcile(cart.items, products);
  if (rec.changed) {
    // Persist the clean-up once; if another request changed the bag meanwhile, it will run again next read.
    await Cart.updateOne({ _id: cart._id, revision: cart.revision ?? 0 }, { $set: { items: rec.lines }, $inc: { revision: 1 } });
  }
  return toView(rec.lines, products, rec.notices);
}

export async function addCartItem(shopper: Owner, input: CartLineInput): Promise<{ cart: CartSnapshot; added: number }> {
  await connectToDatabase();
  const product = await Product.findOne(publicProductFilter(input.productId), PRODUCT_FIELDS).lean<CartProductDoc>();
  if (!product) throw notFound("This product is no longer available.");
  const variant = findVariant(product, input.size, input.color);
  if (!variant) {
    throw badRequest(`That size and colour combination isn't available for ${product.name}. Please choose another option.`);
  }
  if (availableUnits(variant) <= 0) throw conflict(`Sorry, ${label(product, variant)} is out of stock.`);

  let added = 0;
  const cart = await mutate(shopper, { create: true, preload: [product._id] }, (lines, products) => {
    const p = products.get(product._id.toString());
    const v = p?.variants.find((x) => x.sku === variant.sku);
    if (!isPublicProduct(p) || !sellable(v)) throw notFound("This product is no longer available.");
    const avail = availableUnits(v);
    if (avail <= 0) throw conflict(`Sorry, ${label(p, v)} is out of stock.`);
    const existing = lines.find((l) => l.variantSku === v.sku);
    const inBag = existing?.quantity ?? 0;
    const room = lineCap(v) - inBag;
    if (room <= 0) {
      throw conflict(
        inBag >= MAX_LINE_QUANTITY
          ? `You can buy up to ${MAX_LINE_QUANTITY} of one item.`
          : `You already have all ${avail} available unit${avail === 1 ? "" : "s"} of ${label(p, v)} in your bag.`,
      );
    }
    if (!existing && lines.length >= MAX_CART_LINES) {
      throw conflict(`Your bag can hold up to ${MAX_CART_LINES} different items. Remove something to add this.`);
    }
    added = Math.min(input.quantity, room);
    if (existing) existing.quantity += added;
    else lines.push({ product: p._id, variantSku: v.sku, quantity: added, addedAt: new Date() });
    return lines;
  });
  return { cart, added };
}

export async function updateCartItem(shopper: Shopper, sku: string, quantity: number): Promise<CartSnapshot> {
  if (shopper.kind === "anonymous") throw notFound("This item is not in your bag.");
  return mutate(shopper, { create: false }, (lines, products) => {
    const line = lines.find((l) => l.variantSku === sku);
    if (!line) throw notFound("This item is no longer in your bag.");
    const p = products.get(line.product.toString())!;
    const v = p.variants.find((x) => x.sku === sku)!;
    const cap = lineCap(v);
    if (quantity > cap) {
      throw conflict(
        cap < MAX_LINE_QUANTITY
          ? `Only ${cap} unit${cap === 1 ? "" : "s"} of ${label(p, v)} ${cap === 1 ? "is" : "are"} available.`
          : `You can buy up to ${MAX_LINE_QUANTITY} of one item.`,
      );
    }
    line.quantity = quantity;
    return lines;
  });
}

export async function removeCartItem(shopper: Shopper, sku: string): Promise<CartSnapshot> {
  if (shopper.kind === "anonymous") throw notFound("This item is not in your bag.");
  return mutate(shopper, { create: false }, (lines) => {
    if (!lines.some((l) => l.variantSku === sku)) throw notFound("This item is no longer in your bag.");
    return lines.filter((l) => l.variantSku !== sku);
  });
}

export async function clearCart(shopper: Shopper): Promise<CartSnapshot> {
  if (shopper.kind === "anonymous") return emptyCart();
  await connectToDatabase();
  await Cart.updateOne(ownerFilter(shopper), { $set: { items: [], couponCode: null }, $inc: { revision: 1 } });
  return emptyCart();
}

/**
 * Merges lines into the shopper's bag:
 * - a guest bag (by guest key) into a customer's bag after login/registration, and/or
 * - lines from a bag saved in the browser before bags lived on the server (one-time import).
 * Same variants are combined; every quantity is re-checked against live stock; unavailable
 * items are skipped with a notice. The guest bag is claimed atomically (deleted as it is read),
 * so two tabs merging at once can't add it twice.
 */
export async function mergeIntoCart(shopper: Owner, opts: { guestKey?: string | null; items?: CartLineInput[] }): Promise<CartSnapshot> {
  await connectToDatabase();
  const inputs = opts.items ?? [];

  let claimed: CartDoc | null = null;
  if (shopper.kind === "customer" && opts.guestKey) {
    claimed = await Cart.findOneAndDelete({ guestId: opts.guestKey }, { projection: { items: 1 } }).lean<CartDoc>();
  }

  const incoming: { product: Types.ObjectId; variantSku: string; quantity: number }[] = [];
  const notices: string[] = [];
  if (inputs.length) {
    const byRef = await loadPublicProductsByRef(inputs.map((i) => i.productId));
    let missing = 0;
    for (const i of inputs) {
      const p = byRef.get(i.productId);
      const v = p && findVariant(p, i.size, i.color);
      if (!p || !v) missing++;
      else incoming.push({ product: p._id, variantSku: v.sku, quantity: i.quantity });
    }
    if (missing) notices.push(`${missing} item${missing === 1 ? " from your saved bag is" : "s from your saved bag are"} no longer available.`);
  }
  for (const l of claimed?.items ?? []) incoming.push({ product: l.product, variantSku: l.variantSku, quantity: l.quantity });

  if (!incoming.length) {
    const cart = await getCart(shopper);
    return { ...cart, notices: [...notices, ...cart.notices] };
  }

  try {
    let mergeNotices: string[] = [];
    const cart = await mutate(shopper, { create: true, preload: incoming.map((l) => l.product) }, (lines, products) => {
      mergeNotices = [];
      for (const inc of incoming) {
        const p = products.get(inc.product.toString());
        const v = p?.variants.find((x) => x.sku === inc.variantSku);
        if (!isPublicProduct(p) || !sellable(v)) {
          mergeNotices.push(`${p?.name ?? "An item"} is no longer available and wasn't added to your bag.`);
          continue;
        }
        const cap = lineCap(v);
        if (cap <= 0) {
          mergeNotices.push(`${label(p, v)} is sold out and wasn't added to your bag.`);
          continue;
        }
        const existing = lines.find((l) => l.variantSku === v.sku);
        if (!existing && lines.length >= MAX_CART_LINES) {
          mergeNotices.push(`Your bag is full, so ${label(p, v)} wasn't added.`);
          continue;
        }
        const wanted = (existing?.quantity ?? 0) + inc.quantity;
        const qty = Math.min(wanted, cap);
        if (qty < wanted) mergeNotices.push(`Only ${qty} of ${label(p, v)} could be kept in your bag.`);
        if (existing) existing.quantity = qty;
        else lines.push({ product: p._id, variantSku: v.sku, quantity: qty, addedAt: new Date() });
      }
      return lines;
    });
    return { ...cart, notices: dedupe([...notices, ...cart.notices, ...mergeNotices]) };
  } catch (err) {
    // Don't lose the guest's bag if the merge failed — put it back (best effort).
    if (claimed?.items.length && opts.guestKey) {
      await Cart.create({ guestId: opts.guestKey, items: claimed.items, expiresAt: guestExpiry() }).catch(() => undefined);
    }
    throw err;
  }
}

const dedupe = (list: string[]) => [...new Set(list)];
