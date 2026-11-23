import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { INDIAN_STATES, PIN_RE } from "@/lib/validation";

export const AUDIENCES = ["women", "men", "kids", "home-living"] as const;
export type AudienceKey = (typeof AUDIENCES)[number];

/**
 * Register a model once. Next.js hot reload re-evaluates modules, and re-registering a model
 * name throws, so reuse the existing one.
 */
export function defineModel<S extends Schema>(name: string, schema: S, collection?: string) {
  type M = Model<InferSchemaType<S>>;
  return (mongoose.models[name] as M | undefined) ?? (mongoose.model(name, schema, collection) as unknown as M);
}

/** Money in integer paise (₹1 = 100). */
export function paise(required = true) {
  return {
    type: Number,
    required,
    min: 0,
    validate: { validator: (v: unknown) => v == null || Number.isSafeInteger(v), message: "{PATH} must be whole paise" },
  };
}

export const ImageSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    /** Cloudinary public ID; absent for legacy (Unsplash) images. */
    publicId: { type: String, trim: true },
    width: Number,
    height: Number,
    format: String,
    bytes: Number,
    alt: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { _id: false },
);

export const AddressSchema = new Schema(
  {
    house: { type: String, required: true, trim: true, maxlength: 200 },
    street: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    district: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, enum: INDIAN_STATES },
    pincode: { type: String, required: true, match: PIN_RE },
    country: { type: String, enum: ["India"], default: "India" },
  },
  { _id: false },
);

export const CustomerSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    mobile: { type: String, required: true, match: /^[6-9]\d{9}$/ },
  },
  { _id: false },
);

/** Who did something — used by inventory movements, order history and audit logs. */
export const ActorSchema = new Schema(
  {
    type: { type: String, enum: ["admin", "customer", "system"], required: true },
    id: { type: Schema.Types.ObjectId },
    name: { type: String, trim: true },
  },
  { _id: false },
);

/** Shared schema options: timestamps, clean JSON (id instead of _id, no __v). */
export const baseOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      return ret;
    },
  },
} as const;
