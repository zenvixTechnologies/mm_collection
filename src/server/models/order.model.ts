import "server-only";
import { Schema } from "mongoose";
import { CANCEL_REASON_KEYS } from "@/lib/after-sales";
import { ActorSchema, AddressSchema, AUDIENCES, baseOptions, CustomerSchema, defineModel, ImageSchema, paise } from "./_shared";

export const ORDER_STATUSES = [
  "pending_payment", // created, stock reserved, waiting for Razorpay
  "placed", // paid — "Order Placed" on the storefront
  "confirmed",
  "processing",
  "packed",
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
          {
            status: { type: String, enum: ORDER_STATUSES, required: true },
            /** Previous status; recorded for fulfilment moves (absent on older entries). */
            from: { type: String, enum: ORDER_STATUSES },
            at: { type: Date, default: () => new Date() },
            by: ActorSchema,
            note: String,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Razorpay order of the current payment attempt (history: the payments collection). */
    razorpayOrderId: { type: String, default: null },
    /** The captured payment that paid this order. */
    razorpayPaymentId: { type: String, default: null },
    paymentGateway: { type: String, enum: ["razorpay", null], default: null },
    /** Razorpay key mode the order was paid in. */
    paymentMode: { type: String, enum: ["test", "live", null], default: null },
    paidAt: { type: Date, default: null },
    /** Number of Razorpay orders created for this order (attempt numbers 1…n). */
    paymentAttemptCount: { type: Number, min: 0, default: 0 },
    /** Short lock while a new payment attempt is being created, so retries can't race. */
    paymentLockUntil: { type: Date, default: null },
    /**
     * Client-supplied key so a double-clicked "Place Order" never creates two orders. Stored
     * prefixed with the customer/guest scope (`u:<userId>:<key>` / `g:<guestHash>:<key>`), so the
     * unique index makes keys unique per shopper.
     */
    idempotencyKey: { type: String, default: null },
    /**
     * Random per-order value; the guest access token is HMAC(server secret, order id + nonce), so
     * the token itself is never stored. Never sent to clients.
     */
    accessNonce: { type: String, default: null, select: false },
    /** Stock is held until this time; a cron job expires unpaid orders after it. */
    reservationExpiresAt: { type: Date, default: null },
    stockReleased: { type: Boolean, default: false },
    /** When the expiry job last looked at this unpaid order; used to take turns. */
    expiryCheckedAt: { type: Date, default: null },
    refundedPaise: { ...paise(false), default: 0 },
    /** Set only when the customer cancelled the order themselves, with why. */
    cancellation: {
      type: new Schema(
        {
          customer: { type: Schema.Types.ObjectId, ref: "User", required: true },
          reason: { type: String, enum: CANCEL_REASON_KEYS, required: true },
          otherReason: { type: String, maxlength: 500, default: "" },
          details: { type: String, maxlength: 1000, default: "" },
          requestedAt: { type: Date, required: true },
          statusAtRequest: { type: String, enum: ORDER_STATUSES, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    /** Legacy courier details on older orders. Kept so the data survives; no longer read or written. */
    tracking: {
      type: new Schema(
        { courier: String, awb: String, url: String, shippedAt: Date, expectedDeliveryAt: Date, updatedAt: Date, updatedBy: ActorSchema },
        { _id: false },
      ),
      default: null,
    },
    /** Legacy history of those details. Also kept, unused. */
    trackingHistory: {
      type: [
        new Schema(
          { courier: String, awb: String, url: String, shippedAt: Date, expectedDeliveryAt: Date, at: Date, by: ActorSchema },
          { _id: false },
        ),
      ],
      default: [],
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
OrderSchema.index({ razorpayPaymentId: 1 }, { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string" } } });
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
OrderSchema.index({ "cancellation.requestedAt": -1 }, { partialFilterExpression: { "cancellation.requestedAt": { $type: "date" } } });
OrderSchema.index({ "exception.code": 1 }, { partialFilterExpression: { "exception.code": { $type: "string" } } });

export const Order = defineModel("Order", OrderSchema, "orders");
