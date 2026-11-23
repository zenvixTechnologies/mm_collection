import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/** Announcement-bar / promo offer shown on the storefront (admin "Coupons & Offers" → Offers). */
const OfferSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 200, default: "" },
    code: { type: String, trim: true, uppercase: true, default: null },
    href: { type: String, trim: true, maxlength: 300, default: "/shop" },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  baseOptions,
);

OfferSchema.index({ active: 1, sortOrder: 1 });

export const Offer = defineModel("Offer", OfferSchema, "offers");
