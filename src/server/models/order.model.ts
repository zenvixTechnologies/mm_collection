import "server-only";
import { Schema } from "mongoose";
import { ActorSchema, AddressSchema, AUDIENCES, baseOptions, CustomerSchema, defineModel, ImageSchema, paise } from "./_shared";

export const ORDER_STATUSES = [
  "pending_payment", // created, stock reserved, waiting for Razorpay
  "placed", // paid — "Order Placed" on the storefront
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "expired", // payment never completed; reservation released
  "payment_failed",
] as const;

export const PAYMENT_STATUSES = ["pending", "authorized", "captured", "failed", "refunded", "partially_refunded"] as const;

/** Snapshot of what was bought, frozen at checkout so later catalogue edits don't change history. */
const OrderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantSku: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    image: { type: ImageSchema, default: null },
    audience: { type: String, enum: AUDIENCES },
    category: { type: Schema.Types.ObjectId, ref: "Category" },
    size: { type: String, default: null },
    color: { type: String, default: null },
    unitPricePaise: paise(),
    mrpPaise: paise(),
    quantity: { type: Number, required: true, min: 1, max: 20 },
    lineTotalPaise: paise(),
  },
  { _id: true },
);

const OrderSchema = new Schema(
  {
    /** Customer-facing order number, e.g. MM24A7K1. */
    orderNumber: { type: String, required: true, uppercase: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    customer: { type: CustomerSchema, required: true },
    shippingAddress: { type: AddressSchema, required: true },
    items: {
      type: [OrderItemSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: "An order needs at least one item" },
    },
    currency: { type: String, enum: ["INR"], default: "INR" },
    subtotalPaise: paise(),
    mrpTotalPaise: paise(),
    discountPaise: paise(),
    /** null = "Shipping Charges Applicable" — no shipping amount is calculated yet. */
    shippingPaise: { ...paise(false), default: null },
    totalPaise: paise(),
    coupon: {
      type: new Schema(
        { coupon: { type: Schema.Types.ObjectId, ref: "Coupon" }, code: String, discountPaise: paise() },
        { _id: false },
      ),
      default: null,
    },
    paymentMethod: { type: String, enum: ["upi", "card", "netbanking", null], default: null },
    status: { type: String, enum: ORDER_STATUSES, default: "pending_payment" },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
    statusHistory: {
      type: [
        new Schema(
          { status: { type: String, enum: ORDER_STATUSES, required: true }, at: { type: Date, default: () => new Date() }, by: ActorSchema, note: String },
          { _id: false },
        ),
      ],
      default: [],
    },
    razorpayOrderId: { type: String, default: null },
    /** Client-supplied key so a double-clicked "Pay" never creates two orders. */
    idempotencyKey: { type: String, default: null },
    /** Stock is held until this time; a cron job expires unpaid orders after it. */
    reservationExpiresAt: { type: Date, default: null },
    stockReleased: { type: Boolean, default: false },
    refundedPaise: { ...paise(false), default: 0 },
    tracking: {
      type: new Schema({ courier: String, awb: String, url: String, shippedAt: Date }, { _id: false }),
      default: null,
    },
    notes: {
      type: [new Schema({ author: ActorSchema, text: { type: String, maxlength: 2000 }, at: { type: Date, default: () => new Date() } }, { _id: true })],
      default: [],
    },
    /** Set when something needs staff attention, e.g. paid after the reservation expired and stock ran out. */
    exception: {
      type: new Schema({ code: String, message: String, at: Date, resolvedAt: Date }, { _id: false }),
      default: null,
    },
    placedAt: { type: Date, default: null },
  },
  baseOptions,
);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: "string" } } });
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ "customer.email": 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });
OrderSchema.index({ createdAt: -1 });
// Reservation-expiry cron: unpaid orders past their hold time.
OrderSchema.index(
  { reservationExpiresAt: 1 },
  { partialFilterExpression: { status: "pending_payment" }, name: "pending_reservation_expiry" },
);
OrderSchema.index({ "exception.code": 1 }, { partialFilterExpression: { "exception.code": { $type: "string" } } });

export const Order = defineModel("Order", OrderSchema, "orders");
