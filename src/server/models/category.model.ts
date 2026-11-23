import "server-only";
import { Schema } from "mongoose";
import { AUDIENCES, baseOptions, defineModel, ImageSchema } from "./_shared";

/**
 * A sub-category within one of the four audiences (Women / Men / Kids / Home & Living),
 * e.g. Women → Kurtis, Home & Living → Bedsheets. The slug matches the existing storefront
 * URL (/categories/[slug]) so links and SEO are preserved.
 */
const CategorySchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    audience: { type: String, enum: AUDIENCES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    image: { type: ImageSchema, default: null },
    visible: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    seo: {
      title: { type: String, trim: true, maxlength: 120 },
      description: { type: String, trim: true, maxlength: 300 },
    },
  },
  baseOptions,
);

CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ audience: 1, visible: 1, sortOrder: 1 });

export const Category = defineModel("Category", CategorySchema, "categories");
