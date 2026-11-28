import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/**
 * Every image upload the admin panel starts. Lets a scheduled job delete images that were
 * uploaded but never saved to a product/category/banner (abandoned forms, failed saves).
 */
const MediaAssetSchema = new Schema(
  {
    publicId: { type: String, required: true },
    purpose: { type: String, enum: ["product", "category", "banner", "logo", "review"], required: true },
    status: { type: String, enum: ["signed", "uploaded", "attached", "deleted"], default: "signed" },
    url: { type: String, default: null },
    format: { type: String, default: null },
    bytes: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    /* Review photos only: who may attach it, to which product, and whether an upload was used. */
    customer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    product: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    claimedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  baseOptions,
);

MediaAssetSchema.index({ publicId: 1 }, { unique: true });
MediaAssetSchema.index({ status: 1, createdAt: 1 });

export const MediaAsset = defineModel("MediaAsset", MediaAssetSchema, "media_assets");
