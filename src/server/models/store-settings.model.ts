import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

const CourierSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    trackingUrlTemplate: { type: String, trim: true, default: "" },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const HomepageSectionSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: "" },
    visible: { type: Boolean, default: true },
  },
  { _id: false },
);

/** Single document (key: "store") holding store, shipping, homepage and notification settings. */
const StoreSettingsSchema = new Schema(
  {
    key: { type: String, default: "store", enum: ["store"] },
    store: {
      name: { type: String, default: "M&M COLLECTIONS" },
      tagline: { type: String, default: "" },
      logo: { type: String, default: "/brand/logo-320.webp" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      address: { type: String, default: "" },
      hours: { type: String, default: "" },
      gstin: { type: String, default: "" },
    },
    social: {
      instagram: { type: String, default: "" },
      facebook: { type: String, default: "" },
      youtube: { type: String, default: "" },
    },
    policies: {
      returnWindowDays: { type: Number, min: 0, default: 7 },
      exchangeOnly: { type: Boolean, default: false },
      returnPolicySummary: { type: String, default: "" },
      privacyContact: { type: String, default: "" },
    },
    notifications: {
      newOrder: { type: Boolean, default: true },
      lowStock: { type: Boolean, default: true },
      paymentFailed: { type: Boolean, default: true },
      dailySummary: { type: Boolean, default: false },
      /** Where admin alerts (low stock etc.) are emailed. */
      alertEmails: { type: [String], default: [] },
    },
    shipping: {
      /** Shown wherever a shipping amount would appear. No rates are calculated yet. */
      chargesNotice: { type: String, default: "Shipping Charges Applicable" },
      deliveryEstimate: { type: String, default: "" },
      dispatchTime: { type: String, default: "" },
      country: { type: String, enum: ["India"], default: "India" },
      couriers: { type: [CourierSchema], default: [] },
    },
    checkout: {
      /** Cash on Delivery stays disabled; only Razorpay online payments are accepted. */
      codEnabled: {
        type: Boolean,
        default: false,
        validate: { validator: (v: boolean) => v === false, message: "Cash on Delivery is not available" },
      },
      reservationMinutes: { type: Number, min: 5, max: 60, default: 15 },
    },
    /** Default page title/description for search results and link previews. */
    seo: {
      title: { type: String, trim: true, maxlength: 70, default: "" },
      description: { type: String, trim: true, maxlength: 160, default: "" },
    },
    homepage: {
      sections: { type: [HomepageSectionSchema], default: [] },
      featuredProducts: { type: [{ type: Schema.Types.ObjectId, ref: "Product" }], default: [] },
    },
  },
  baseOptions,
);

StoreSettingsSchema.index({ key: 1 }, { unique: true });

export const StoreSettings = defineModel("StoreSettings", StoreSettingsSchema, "store_settings");
