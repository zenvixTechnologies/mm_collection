import "server-only";
import { z } from "zod";
import { MAX_CART_LINES } from "@/types";
import { address, email, indianMobile, objectId, paise, pagination } from "./common";
import { cartLineInput, variantSku } from "./cart";

/**
 * Checkout and order request bodies. The browser says what to buy (its bag, or one Buy Now
 * line), who it's for and where it goes. Prices, discounts and totals are never accepted — the
 * only money field, `expectedTotalPaise`, is compared against the server's own total so a
 * customer is never charged an amount they didn't see.
 */

export const checkoutSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cart") }),
  z.object({ type: z.literal("buy-now"), item: cartLineInput }),
]);

export const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .max(40, "That coupon code is too long.")
  .regex(/^[A-Z0-9_-]*$/, "Coupon codes contain only letters and numbers.")
  .transform((c) => c || null)
  .nullable()
  .default(null);

export const checkoutCustomer = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Please enter your full name.")
    .max(120)
    .regex(/^[\p{L} .'-]+$/u, "Name can only contain letters and spaces."),
  email,
  mobile: indianMobile,
});

/** Prices the customer last saw, by variant SKU — used only to report what changed. */
const expectedPrices = z
  .record(variantSku, paise)
  .refine((r) => Object.keys(r).length <= MAX_CART_LINES, "Too many items.")
  .optional();

export const checkoutValidateBody = z.object({
  source: checkoutSource,
  couponCode,
  expectedPrices,
});

export const PAYMENT_METHODS = ["upi", "card", "netbanking"] as const;

export const placeOrderBody = z
  .object({
    source: checkoutSource,
    couponCode,
    customer: checkoutCustomer,
    /** A new delivery address… */
    address: address.optional(),
    /** …or one of the signed-in customer's saved addresses. */
    addressId: objectId.optional(),
    /** Preferred method, kept on the order for the payment step (no payment is taken here). */
    paymentMethod: z.enum(PAYMENT_METHODS, "Please choose a payment method."),
    /** Random per checkout attempt; resending the same key returns the same order. */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid request key."),
    /** The total shown to the customer, in paise. Must equal the server's total. */
    expectedTotalPaise: paise,
  })
  .superRefine((b, ctx) => {
    if (!b.address && !b.addressId) ctx.addIssue({ code: "custom", path: ["address"], message: "Please enter a delivery address." });
    if (b.address && b.addressId) ctx.addIssue({ code: "custom", path: ["addressId"], message: "Send either an address or a saved address, not both." });
  });

export type CheckoutSourceInput = z.output<typeof checkoutSource>;
export type PlaceOrderInput = z.output<typeof placeOrderBody>;

/** Order numbers: MM + 4–12 letters/digits (older ones are shorter). */
export const orderNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^MM[A-Z0-9]{4,12}$/, "Invalid order number.");

export const orderParams = z.object({ id: orderNumber });

export const orderListQuery = pagination.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Guest order access token (base64url HMAC), sent in the X-Order-Token header. */
export const orderAccessToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
