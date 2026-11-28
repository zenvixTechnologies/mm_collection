import "server-only";
import { Schema } from "mongoose";
import { AUDIENCES, baseOptions, defineModel, ImageSchema, paise } from "./_shared";

/**
 * One purchasable variant: a size and/or colour with its own SKU, price and stock.
 * Size and colour are optional and free-form so non-clothing products (bedsheets: Single /
 * Double / Queen / King; cushions: 16 × 16 in) and future categories fit without schema changes.
 */
const VariantSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    size: { type: String, trim: true, maxlength: 40, default: null },
    color: {
      type: new Schema(
        { name: { type: String, required: true, trim: true }, hex: { type: String, match: /^#[0-9a-f]{6}$/i } },
        { _id: false },
      ),
      default: null,
    },
    pricePaise: paise(),
    mrpPaise: paise(),
    /** Units on hand, including those reserved by unpaid checkouts. */
    stock: { type: Number, required: true, min: 0, default: 0 },
    /** Units held by pending-payment orders. Available = stock − reserved. */
    reserved: { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, min: 0, default: 5 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

VariantSchema.pre("validate", function () {
  if (this.mrpPaise < this.pricePaise) this.invalidate("mrpPaise", "MRP cannot be lower than the selling price");
  if (this.reserved > this.stock) this.invalidate("reserved", "Reserved units cannot exceed stock");
});

const ProductSchema = new Schema(
  {
    /** Original catalogue ID (p001…) — kept so carts and links saved before the migration still work. */
    legacyId: { type: String, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    /** Style-level SKU; each variant has its own SKU too. */
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    audience: { type: String, enum: AUDIENCES, required: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    /** Additional categories the product also appears in (same audience). */
    tags: { type: [{ type: Schema.Types.ObjectId, ref: "Category" }], default: [] },
    shortDescription: { type: String, trim: true, maxlength: 300, default: "" },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    /** Ordered gallery; the first image is the primary one. */
    images: { type: [ImageSchema], default: [] },
    variants: {
      type: [VariantSchema],
      validate: [
        { validator: (v: unknown[]) => v.length > 0, message: "A product needs at least one variant" },
        {
          validator: (v: { sku: string }[]) => new Set(v.map((x) => x.sku)).size === v.length,
          message: "Variant SKUs must be unique",
        },
      ],
    },
    /** Flexible extra attributes: fabric, care, thread count, dimensions… */
    fabric: { type: String, trim: true, maxlength: 300, default: "" },
    care: { type: [String], default: [] },
    attributes: { type: Map, of: String, default: {} },

    /* Denormalised from variants for fast listing, filtering and sorting — kept in sync by the service layer. */
    pricePaise: paise(),
    mrpPaise: paise(),
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    inStock: { type: Boolean, default: true },

    status: { type: String, enum: ["draft", "active", "archived"], default: "draft" },
    visible: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    newArrival: { type: Boolean, default: false },
    bestSeller: { type: Boolean, default: false },
    /** Rating summary of verified reviews. Written only by the review service. */
    reviewStats: {
      average: { type: Number, min: 0, max: 5, default: 0 },
      count: { type: Number, min: 0, default: 0 },
    },
    /** Legacy sample figures imported with the catalogue — not from real reviews. Kept, never read. */
    rating: {
      average: { type: Number, min: 0, max: 5, default: 0 },
      count: { type: Number, min: 0, default: 0 },
    },
    soldCount: { type: Number, min: 0, default: 0 },
    shipping: {
      weightGrams: { type: Number, min: 0 },
      lengthCm: { type: Number, min: 0 },
      widthCm: { type: Number, min: 0 },
      heightCm: { type: Number, min: 0 },
    },
    seo: {
      title: { type: String, trim: true, maxlength: 120 },
      description: { type: String, trim: true, maxlength: 300 },
    },
    publishedAt: { type: Date, default: null },
  },
  baseOptions,
);

/**
 * Keep the listing summary in step with the variants on every save. Atomic stock updates
 * (reservations, sales) bypass this hook and must update `inStock` themselves.
 */
interface ProductSummary {
  variants?: { pricePaise: number; mrpPaise: number; stock: number; reserved: number; isActive?: boolean | null }[];
  pricePaise: number;
  mrpPaise: number;
  discountPercent: number;
  inStock: boolean;
}

ProductSchema.pre("validate", function (this: ProductSummary) {
  const active = (this.variants ?? []).filter((v) => v.isActive !== false);
  if (!active.length) return;
  this.pricePaise = Math.min(...active.map((v) => v.pricePaise));
  this.mrpPaise = Math.max(...active.map((v) => v.mrpPaise));
  this.discountPercent = this.mrpPaise > this.pricePaise ? Math.round(((this.mrpPaise - this.pricePaise) / this.mrpPaise) * 100) : 0;
  this.inStock = active.some((v) => v.stock - v.reserved > 0);
});

ProductSchema.index({ slug: 1 }, { unique: true });
ProductSchema.index({ sku: 1 }, { unique: true });
ProductSchema.index({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: "string" } } });
// A variant SKU is unique across the whole catalogue.
ProductSchema.index({ "variants.sku": 1 }, { unique: true });
// Storefront listing: audience/category pages with price filter and sort.
ProductSchema.index({ status: 1, visible: 1, audience: 1, category: 1, pricePaise: 1 });
ProductSchema.index({ status: 1, visible: 1, tags: 1 });
ProductSchema.index({ status: 1, visible: 1, featured: 1 });
ProductSchema.index({ status: 1, visible: 1, publishedAt: -1 });
ProductSchema.index({ status: 1, visible: 1, soldCount: -1 });
ProductSchema.index(
  { name: "text", shortDescription: "text", description: "text", fabric: "text" },
  { weights: { name: 10, shortDescription: 4, fabric: 2, description: 1 }, name: "product_text" },
);

export const Product = defineModel("Product", ProductSchema, "products");
