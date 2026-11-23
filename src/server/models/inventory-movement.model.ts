import "server-only";
import { Schema } from "mongoose";
import { ActorSchema, baseOptions, defineModel } from "./_shared";

export const MOVEMENT_TYPES = [
  "restock",
  "adjustment",
  "correction",
  "damaged",
  "return",
  "reservation", // checkout held units
  "release", // unpaid order expired / failed, hold released
  "sale", // payment confirmed, units deducted
] as const;

/** Append-only stock ledger: every change to a variant's stock or reservation is recorded here. */
const InventoryMovementSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantSku: { type: String, required: true, uppercase: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    /** Signed change to on-hand stock (0 for reservation/release). */
    stockChange: { type: Number, required: true, default: 0 },
    /** Signed change to reserved units. */
    reservedChange: { type: Number, required: true, default: 0 },
    stockAfter: { type: Number, required: true, min: 0 },
    reservedAfter: { type: Number, required: true, min: 0 },
    order: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    actor: { type: ActorSchema, required: true },
    note: { type: String, maxlength: 500, default: "" },
  },
  { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
);

InventoryMovementSchema.index({ product: 1, createdAt: -1 });
InventoryMovementSchema.index({ variantSku: 1, createdAt: -1 });
InventoryMovementSchema.index({ order: 1 }, { partialFilterExpression: { order: { $type: "objectId" } } });
InventoryMovementSchema.index({ createdAt: -1 });

export const InventoryMovement = defineModel("InventoryMovement", InventoryMovementSchema, "inventory_movements");
