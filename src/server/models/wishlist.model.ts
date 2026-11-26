import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/** Saved products for a customer or a guest (guestId cookie). Merged into the account on login. */
const WishlistSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    guestId: { type: String, default: null },
    items: {
      type: [
        new Schema(
          {
            product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
            addedAt: { type: Date, default: () => new Date() },
          },
          { _id: false },
        ),
      ],
      default: [],
      validate: { validator: (v: unknown[]) => v.length <= 200, message: "Wishlist is full" },
    },
    /** Bumped on every write; merges are compare-and-set on it (see Cart.revision). */
    revision: { type: Number, min: 0, default: 0 },
    expiresAt: { type: Date, default: null },
  },
  baseOptions,
);

WishlistSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: "objectId" } } });
WishlistSchema.index({ guestId: 1 }, { unique: true, partialFilterExpression: { guestId: { $type: "string" } } });
WishlistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: "date" } } });

export const Wishlist = defineModel("Wishlist", WishlistSchema, "wishlists");
