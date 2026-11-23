import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/**
 * Server-side cart for a signed-in customer (`user`) or a guest (`guestId` from an HttpOnly
 * cookie). Lines hold only product + variant + quantity — prices are always re-read from the
 * product at view/checkout time, never stored from the browser.
 */
const CartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantSku: { type: String, required: true, uppercase: true, trim: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const CartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    guestId: { type: String, default: null },
    items: {
      type: [CartItemSchema],
      default: [],
      validate: { validator: (v: unknown[]) => v.length <= 50, message: "A bag can hold at most 50 lines" },
    },
    couponCode: { type: String, uppercase: true, trim: true, default: null },
    /** Guest carts are removed automatically after inactivity; customer carts never expire. */
    expiresAt: { type: Date, default: null },
  },
  baseOptions,
);

CartSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: "objectId" } } });
CartSchema.index({ guestId: 1 }, { unique: true, partialFilterExpression: { guestId: { $type: "string" } } });
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: "date" } } });

export const Cart = defineModel("Cart", CartSchema, "carts");
