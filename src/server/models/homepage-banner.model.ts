import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel, ImageSchema } from "./_shared";

/** Hero / promo banner on the storefront homepage, optionally scheduled. */
const HomepageBannerSchema = new Schema(
  {
    placement: { type: String, enum: ["hero", "promo"], required: true },
    eyebrow: { type: String, trim: true, maxlength: 60, default: "" },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 300, default: "" },
    ctaLabel: { type: String, trim: true, maxlength: 40, default: "" },
    ctaHref: { type: String, trim: true, maxlength: 300, default: "" },
    image: { type: ImageSchema, default: null },
    active: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  baseOptions,
);

HomepageBannerSchema.index({ placement: 1, active: 1, sortOrder: 1 });

export const HomepageBanner = defineModel("HomepageBanner", HomepageBannerSchema, "homepage_banners");
