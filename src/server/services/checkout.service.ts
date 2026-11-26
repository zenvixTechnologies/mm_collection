import "server-only";
import { Types, type ClientSession } from "mongoose";
import type { Audience, CartItem, CheckoutCoupon, CheckoutIssue, CheckoutQuote, PlacedOrder, Size } from "@/types";
import { formatPrice } from "@/lib/utils";
import { ownerFilter, type Shopper } from "@/server/auth/shopper";
import { publicProductId } from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest, notFound } from "@/server/http/errors";
import { Cart } from "@/server/models/cart.model";
import { CouponRedemption } from "@/server/models/coupon-redemption.model";
import { Order } from "@/server/models/order.model";
import { Product } from "@/server/models/product.model";
import { User } from "@/server/models/user.model";
import { logger, serializeError } from "@/server/utils/logger";
import type { CheckoutSourceInput, PlaceOrderInput } from "@/server/validation/checkout";
import { evaluateCoupon, takeCouponUse, type CouponEvaluation, type CouponIdentity } from "./coupon.service";
import { findVariant, isPublicProduct, publicProductFilter, type CartProductDoc } from "./cart.service";
import {
  expireStaleOrders,
  newAccessNonce,
  newOrderNumber,
  orderAccessToken,
  RESERVATION_MINUTES,
  toOrderView,
  type OrderDoc,
} from "./order.service";
import { reserveVariant, type StockActor } from "./stock-reservation.service";

/**
 * Checkout: quoting and order creation.
 *
 * Everything is priced on the server from MongoDB at request time — the exact variant chosen
 * (size + colour → SKU) gives the unit price and MRP; available stock is that variant's
 * `stock − reserved`. The browser supplies only what to buy and where to send it.
 *
 * Placing an order is one MongoDB transaction: re-read the bag and products → re-check every
 * line, coupon and the total the customer saw → reserve stock per variant (+ ledger) → take the
 * coupon use → create the order (+ coupon redemption) → empty the bag. Any failure rolls all of
 * it back; concurrent checkouts touching the same variant or coupon conflict and are retried on
 * fresh data by the driver, so stock and coupon limits can't be oversold.
 */

/* ---------- Loading what is being bought ---------- */

interface CheckoutProductDoc extends CartProductDoc {
  category: Types.ObjectId;
  tags?: Types.ObjectId[];
  images?: { url: string; publicId?: string; alt?: string; width?: number; height?: number; format?: string; bytes?: number }[];
}

type Variant = CheckoutProductDoc["variants"][number];

const FIELDS = { legacyId: 1, slug: 1, name: 1, audience: 1, status: 1, visible: 1, category: 1, tags: 1, images: { $slice: 1 }, variants: 1 } as const;

interface WantedLine {
  product: Types.ObjectId;
  sku: string;
  quantity: number;
}

interface Loaded {
  lines: WantedLine[];
  products: Map<string, CheckoutProductDoc>;
  /** The bag that was read (to empty it after the order). */
  cart: { _id: Types.ObjectId; revision: number } | null;
  /** Problems found before pricing (e.g. a Buy Now variant that doesn't exist). */
  issues: CheckoutIssue[];
}

async function loadProducts(ids: Types.ObjectId[], session?: ClientSession) {
  const unique = [...new Set(ids.map(String))].map((id) => new Types.ObjectId(id));
  const docs = unique.length
    ? await Product.find({ _id: { $in: unique } }, FIELDS)
        .session(session ?? null)
        .lean<CheckoutProductDoc[]>()
    : [];
  return new Map(docs.map((d) => [String(d._id), d]));
}

async function loadSource(shopper: Shopper, source: CheckoutSourceInput, session?: ClientSession): Promise<Loaded> {
  if (source.type === "buy-now") {
    const p = await Product.findOne(publicProductFilter(source.item.productId), FIELDS)
      .session(session ?? null)
      .lean<CheckoutProductDoc>();
    if (!p) return { lines: [], products: new Map(), cart: null, issues: [issue("unavailable", null, "This product is no longer available.")] };
    const v = findVariant(p, source.item.size, source.item.color);
    if (!v) {
      return {
        lines: [],
        products: new Map([[String(p._id), p]]),
        cart: null,
        issues: [issue("unavailable", null, `That size and colour combination isn't available for ${p.name}. Please choose another option.`)],
      };
    }
    return { lines: [{ product: p._id, sku: v.sku, quantity: source.item.quantity }], products: new Map([[String(p._id), p]]), cart: null, issues: [] };
  }

  if (shopper.kind === "anonymous") return { lines: [], products: new Map(), cart: null, issues: [] };
  const cart = await Cart.findOne(ownerFilter(shopper), { items: 1, revision: 1 })
    .session(session ?? null)
    .lean<{ _id: Types.ObjectId; revision?: number; items: { product: Types.ObjectId; variantSku: string; quantity: number }[] }>();
  if (!cart) return { lines: [], products: new Map(), cart: null, issues: [] };
  const lines = cart.items.map((l) => ({ product: l.product, sku: l.variantSku, quantity: l.quantity }));
  return { lines, products: await loadProducts(lines.map((l) => l.product), session), cart: { _id: cart._id, revision: cart.revision ?? 0 }, issues: [] };
}

/* ---------- Pricing ---------- */

const issue = (code: CheckoutIssue["code"], sku: string | null, message: string, blocking = true): CheckoutIssue => ({ code, sku, message, blocking });

function label(p: CheckoutProductDoc, v?: Variant) {
  const opts = v ? [v.size, v.color?.name].filter(Boolean).join(" / ") : "";
  return opts ? `${p.name} (${opts})` : p.name;
}

interface PricedLine {
  product: CheckoutProductDoc;
  variant: Variant;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
}

interface Priced {
  lines: PricedLine[];
  issues: CheckoutIssue[];
  subtotalPaise: number;
  mrpTotalPaise: number;
}

/**
 * Prices each line from its exact variant and checks it can be sold: product on sale, variant
 * active, enough available units (quantities of the same variant are added up first). Lines with
 * a problem are reported and left out of the totals.
 */
function priceLines(loaded: Loaded, expectedPrices: Record<string, number> = {}): Priced {
  const issues = [...loaded.issues];
  const merged = new Map<string, WantedLine>();
  for (const l of loaded.lines) {
    const cur = merged.get(l.sku);
    if (cur) cur.quantity += l.quantity;
    else merged.set(l.sku, { ...l });
  }

  const lines: PricedLine[] = [];
  for (const l of merged.values()) {
    const p = loaded.products.get(String(l.product));
    const v = p?.variants.find((x) => x.sku === l.sku);
    if (!isPublicProduct(p) || !v || v.isActive === false) {
      issues.push(issue("unavailable", l.sku, `${p ? label(p, v) : "An item"} is no longer available. Please remove it from your bag.`));
      continue;
    }
    const available = Math.max(0, v.stock - v.reserved);
    if (available <= 0) {
      issues.push(issue("out_of_stock", l.sku, `${label(p, v)} is out of stock. Please remove it from your bag.`));
      continue;
    }
    if (l.quantity > available) {
      issues.push(issue("insufficient_stock", l.sku, `Only ${available} of ${label(p, v)} ${available === 1 ? "is" : "are"} left. Please reduce the quantity.`));
      continue;
    }
    const seen = expectedPrices[v.sku];
    if (seen !== undefined && seen !== v.pricePaise) {
      issues.push(
        issue("price_changed", v.sku, `The price of ${label(p, v)} has changed from ${formatPrice(seen / 100)} to ${formatPrice(v.pricePaise / 100)}.`, false),
      );
    }
    const mrpPaise = Math.max(v.mrpPaise, v.pricePaise);
    lines.push({ product: p, variant: v, quantity: l.quantity, unitPricePaise: v.pricePaise, mrpPaise, lineTotalPaise: v.pricePaise * l.quantity });
  }

  if (!loaded.lines.length && !issues.length) issues.push(issue("empty", null, "Your bag is empty."));
  return {
    lines,
    issues,
    subtotalPaise: lines.reduce((s, l) => s + l.lineTotalPaise, 0),
    mrpTotalPaise: lines.reduce((s, l) => s + l.mrpPaise * l.quantity, 0),
  };
}

const couponLines = (priced: Priced) =>
  priced.lines.map((l) => ({ product: l.product._id, categories: [l.product.category, ...(l.product.tags ?? [])], lineTotalPaise: l.lineTotalPaise }));

const MIN_ORDER_PAISE = 100;

function toQuote(priced: Priced, coupon: CouponEvaluation | null): CheckoutQuote {
  const discountPaise = coupon?.ok ? coupon.discountPaise : 0;
  const totalPaise = Math.max(0, priced.subtotalPaise - discountPaise);
  const items: CartItem[] = priced.lines.map((l) => ({
    key: l.variant.sku,
    productId: publicProductId(l.product),
    slug: l.product.slug,
    name: l.product.name,
    image: l.product.images?.[0]?.url ?? "",
    price: l.unitPricePaise / 100,
    originalPrice: l.mrpPaise / 100,
    size: (l.variant.size ?? null) as Size | null,
    color: l.variant.color?.name ?? null,
    quantity: l.quantity,
    stock: Math.max(0, l.variant.stock - l.variant.reserved),
    audience: l.product.audience as Audience,
  }));
  const couponView: CheckoutCoupon | null = coupon
    ? {
        code: coupon.coupon?.code ?? "",
        status: coupon.ok ? "applied" : "rejected",
        description: coupon.description,
        message: coupon.ok ? null : coupon.message,
        discount: discountPaise / 100,
      }
    : null;
  const issues = [...priced.issues];
  if (priced.lines.length && totalPaise < MIN_ORDER_PAISE) issues.push(issue("empty", null, "Order total must be at least ₹1."));
  return {
    items,
    totals: {
      itemCount: priced.lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: priced.subtotalPaise / 100,
      mrpTotal: priced.mrpTotalPaise / 100,
      couponDiscount: discountPaise / 100,
      shipping: null, // "Shipping Charges Applicable" — never calculated at checkout
      total: totalPaise / 100,
      savings: (priced.mrpTotalPaise - priced.subtotalPaise + discountPaise) / 100,
    },
    amounts: { subtotalPaise: priced.subtotalPaise, mrpTotalPaise: priced.mrpTotalPaise, discountPaise, totalPaise },
    coupon: couponView,
    issues,
    canPlaceOrder: priced.lines.length > 0 && !issues.some((i) => i.blocking) && (!coupon || coupon.ok),
    currency: "INR",
  };
}

const identityOf = (shopper: Shopper): CouponIdentity => (shopper.kind === "customer" ? { userId: shopper.userId } : {});

/* ---------- Quote ---------- */

/**
 * Validates what the shopper is about to buy and prices it: availability, exact variant, live
 * variant prices, stock, coupon. Nothing is written (except releasing expired holds).
 */
export async function quoteCheckout(
  shopper: Shopper,
  input: { source: CheckoutSourceInput; couponCode: string | null; expectedPrices?: Record<string, number> },
): Promise<CheckoutQuote> {
  await connectToDatabase();
  await releaseExpiredHolds();
  const priced = priceLines(await loadSource(shopper, input.source), input.expectedPrices);
  const coupon = input.couponCode && priced.lines.length ? await evaluateCoupon(input.couponCode, couponLines(priced), identityOf(shopper)) : null;
  return toQuote(priced, coupon);
}

/** Expired unpaid orders give their stock back before availability is checked. Never blocks checkout. */
async function releaseExpiredHolds() {
  try {
    await expireStaleOrders({ limit: 20 });
  } catch (err) {
    logger.warn("checkout.expire_sweep_failed", { error: serializeError(err) });
  }
}

/* ---------- Place order ---------- */

type Owner = Exclude<Shopper, { kind: "anonymous" }>;

function idempotencyScope(shopper: Owner, key: string) {
  return shopper.kind === "customer" ? `u:${shopper.userId}:${key}` : `g:${shopper.key}:${key}`;
}

/** Delivery address for the order: a new one, or a saved address that must belong to this customer. */
async function deliveryAddress(shopper: Owner, input: PlaceOrderInput) {
  if (input.address) return { ...input.address, country: "India" as const };
  if (shopper.kind !== "customer") throw badRequest("Please log in to use a saved address, or enter your delivery address.");
  const user = await User.findById(shopper.userId, { addresses: 1 }).lean<{ addresses: { _id: Types.ObjectId; address: Record<string, string> }[] }>();
  const saved = user?.addresses.find((a) => String(a._id) === input.addressId);
  if (!saved) throw notFound("That address isn't saved on your account. Please choose another or enter it again.");
  const a = saved.address;
  return { house: a.house, street: a.street, city: a.city, district: a.district, state: a.state, pincode: a.pincode, country: "India" as const };
}

async function existingOrder(idempotencyKey: string, shopper: Owner): Promise<PlacedOrder | null> {
  const order = await Order.findOne({ idempotencyKey }).select("+accessNonce").lean<OrderDoc>();
  if (!order) return null;
  return placed(order, shopper);
}

function placed(order: OrderDoc, shopper: Owner): PlacedOrder {
  return {
    order: toOrderView(order),
    accessToken: shopper.kind === "guest" && order.accessNonce ? orderAccessToken(order._id, order.accessNonce) : null,
  };
}

const isDuplicate = (err: unknown, field: string) => {
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  return e?.code === 11000 && (e.keyPattern ? field in e.keyPattern : String(e.message).includes(field));
};

/**
 * Creates an order from server-side data only. Resending the same idempotency key returns the
 * order already created instead of a second one.
 */
export async function placeOrder(shopper: Owner, input: PlaceOrderInput): Promise<PlacedOrder & { replayed: boolean }> {
  await connectToDatabase();
  const idempotencyKey = idempotencyScope(shopper, input.idempotencyKey);
  const replay = await existingOrder(idempotencyKey, shopper);
  if (replay) return { ...replay, replayed: true };

  const shippingAddress = await deliveryAddress(shopper, input);
  await releaseExpiredHolds();

  const customer = { fullName: input.customer.fullName, email: input.customer.email, mobile: input.customer.mobile };
  const actor: StockActor =
    shopper.kind === "customer" ? { type: "customer", id: shopper.userId, name: customer.fullName } : { type: "customer", name: `${customer.fullName} (guest)` };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const order = await withTransaction((session) => createOrder(session, shopper, input, { idempotencyKey, shippingAddress, customer, actor }));
      logger.info("order.created", { orderNumber: order.orderNumber, items: order.items.length, totalPaise: order.totalPaise, guest: shopper.kind === "guest" });
      return { ...placed(order, shopper), replayed: false };
    } catch (err) {
      // A freshly generated order number collided (very unlikely) — try again with a new one.
      if (isDuplicate(err, "orderNumber")) continue;
      // The same request arrived twice at once and the other copy won: it created the order (and
      // emptied the bag, which is why this copy failed) — return that order instead of an error.
      const again = await existingOrder(idempotencyKey, shopper).catch(() => null);
      if (again) return { ...again, replayed: true };
      throw err;
    }
  }
  throw new AppError(503, "SERVICE_UNAVAILABLE", "We couldn't place your order. Please try again.");
}

async function createOrder(
  session: ClientSession,
  shopper: Owner,
  input: PlaceOrderInput,
  ctx: { idempotencyKey: string; shippingAddress: Record<string, string>; customer: { fullName: string; email: string; mobile: string }; actor: StockActor },
): Promise<OrderDoc> {
  // Read everything again inside the transaction: this is the data the order is built from.
  const loaded = await loadSource(shopper, input.source, session);
  const priced = priceLines(loaded);
  const blocking = priced.issues.filter((i) => i.blocking);
  if (blocking.length) {
    const message = blocking.map((i) => i.message).join(" ");
    if (blocking.every((i) => i.code === "empty")) throw badRequest(message);
    throw new AppError(409, "CART_CHANGED", message);
  }

  const who: CouponIdentity = { userId: shopper.kind === "customer" ? shopper.userId : null, email: ctx.customer.email };
  const coupon = input.couponCode ? await evaluateCoupon(input.couponCode, couponLines(priced), who, { session }) : null;
  if (coupon && !coupon.ok) throw new AppError(409, "COUPON_INVALID", coupon.message);

  const discountPaise = coupon?.ok ? coupon.discountPaise : 0;
  const totalPaise = priced.subtotalPaise - discountPaise;
  if (totalPaise < MIN_ORDER_PAISE) throw badRequest("Order total must be at least ₹1.");
  if (totalPaise !== input.expectedTotalPaise) {
    throw new AppError(
      409,
      "PRICE_CHANGED",
      `Prices in your order have changed — the total is now ${formatPrice(totalPaise / 100)}. Please review your order and place it again.`,
    );
  }

  const orderId = new Types.ObjectId();
  const now = new Date();

  // Hold stock for each exact variant. Several lines can share a product: reserveVariant keeps
  // the in-memory variant counts in step so the next check sees the units already held.
  for (const l of priced.lines) {
    await reserveVariant(session, { productId: l.product._id, variants: l.product.variants, sku: l.variant.sku, quantity: l.quantity, orderId, actor: ctx.actor });
  }

  if (coupon?.ok && !(await takeCouponUse(coupon.coupon._id, session, now))) {
    throw new AppError(409, "COUPON_INVALID", `${coupon.coupon.code} has just reached its usage limit. Please remove it to continue.`);
  }

  const accessNonce = newAccessNonce();
  const [order] = await Order.create(
    [
      {
        _id: orderId,
        orderNumber: newOrderNumber(),
        user: shopper.kind === "customer" ? shopper.userId : null,
        customer: ctx.customer,
        shippingAddress: ctx.shippingAddress,
        items: priced.lines.map((l) => ({
          product: l.product._id,
          variantSku: l.variant.sku,
          name: l.product.name,
          slug: l.product.slug,
          image: l.product.images?.[0] ? { url: l.product.images[0].url, publicId: l.product.images[0].publicId, alt: l.product.images[0].alt ?? "" } : null,
          audience: l.product.audience,
          category: l.product.category,
          size: l.variant.size ?? null,
          color: l.variant.color?.name ?? null,
          unitPricePaise: l.unitPricePaise,
          mrpPaise: l.mrpPaise,
          quantity: l.quantity,
          lineTotalPaise: l.lineTotalPaise,
        })),
        currency: "INR",
        subtotalPaise: priced.subtotalPaise,
        mrpTotalPaise: priced.mrpTotalPaise,
        discountPaise,
        // shippingPaise stays null (schema default): "Shipping Charges Applicable", never calculated here.
        totalPaise,
        coupon: coupon?.ok ? { coupon: coupon.coupon._id, code: coupon.coupon.code, discountPaise } : null,
        paymentMethod: input.paymentMethod,
        status: "pending_payment",
        paymentStatus: "pending",
        statusHistory: [{ status: "pending_payment", at: now, by: ctx.actor, note: "Order created at checkout; stock reserved" }],
        idempotencyKey: ctx.idempotencyKey,
        accessNonce,
        reservationExpiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000),
        stockReleased: false,
      },
    ],
    { session },
  );

  if (coupon?.ok) {
    await CouponRedemption.create(
      [{ coupon: coupon.coupon._id, code: coupon.coupon.code, order: orderId, user: who.userId ?? null, email: ctx.customer.email, discountPaise, status: "reserved" }],
      { session },
    );
  }

  // Empty the bag that was ordered — only if it is exactly the bag we priced.
  if (input.source.type === "cart" && loaded.cart) {
    const res = await Cart.updateOne(
      { _id: loaded.cart._id, revision: loaded.cart.revision },
      { $set: { items: [], couponCode: null }, $inc: { revision: 1 } },
      { session },
    );
    if (res.matchedCount !== 1) throw new AppError(409, "CART_CHANGED", "Your bag changed while the order was being placed. Please review it and try again.");
  }

  return { ...(order.toObject() as unknown as OrderDoc), accessNonce };
}
