"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { Audience, Size } from "@/types";
import type { AdminProduct, ProductStatus } from "@/types/admin";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/data/admin/catalog";
import { cn, discountPercent, formatPrice, slugify } from "@/lib/utils";
import { uid, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { FormSection, SelectField, Switch, TextAreaField, TextField } from "../ui/FormControls";
import { MultiImageUpload } from "../ui/ImageUpload";
import { AUDIENCE_OPTIONS, SIZE_OPTIONS, categoryLabel } from "./catalog-helpers";

function blankProduct(categoryId: string, audience: Audience): AdminProduct {
  const stamp = Date.now();
  return {
    id: uid("p"),
    slug: "",
    sku: `MM-NEW-${String(stamp).slice(-4)}`,
    name: "",
    audienceCategory: audience,
    categoryId,
    tags: [],
    shortDescription: "",
    description: "",
    originalPrice: 0,
    price: 0,
    discount: 0,
    images: [],
    sizes: [],
    colors: [],
    stock: 0,
    rating: 0,
    reviewCount: 0,
    featured: false,
    newArrival: true,
    bestSeller: false,
    fabric: "",
    care: [],
    addedAt: stamp,
    sold: 0,
    weight: 400,
    weightUnit: "g",
    packageLength: 30,
    packageWidth: 25,
    packageHeight: 3,
    status: "draft",
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    updatedAt: new Date(stamp).toISOString(),
  };
}

type Errors = Partial<Record<"name" | "sku" | "slug" | "price" | "originalPrice" | "images" | "sizes" | "categoryId", string>>;

function validate(p: AdminProduct, all: AdminProduct[]): Errors {
  const e: Errors = {};
  if (!p.name.trim()) e.name = "Enter a product name.";
  if (!p.sku.trim()) e.sku = "Enter a SKU.";
  else if (all.some((x) => x.id !== p.id && x.sku.toLowerCase() === p.sku.trim().toLowerCase())) e.sku = "Another product already uses this SKU.";
  if (!p.slug.trim()) e.slug = "Enter a URL slug.";
  else if (all.some((x) => x.id !== p.id && x.slug === p.slug)) e.slug = "Another product already uses this URL.";
  if (!p.categoryId) e.categoryId = "Choose a category.";
  if (!(p.originalPrice > 0)) e.originalPrice = "Enter the MRP.";
  if (!(p.price > 0)) e.price = "Enter the selling price.";
  else if (p.originalPrice > 0 && p.price > p.originalPrice) e.price = "Selling price can't be more than the MRP.";
  if (p.status === "active") {
    if (!p.images.length) e.images = "Add at least one image before publishing.";
    if (!p.sizes.length) e.sizes = "Pick at least one size before publishing.";
  }
  return e;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** null → add a new product */
  product: AdminProduct | null;
}

export function ProductFormDrawer({ open, onClose, product }: Props) {
  // Remount the form whenever a different product is opened so state starts fresh.
  return (
    <Dialog open={open} onClose={onClose} variant="right" size="xl" title={product ? "Edit product" : "Add product"}>
      {open && <ProductForm key={product?.id ?? "new"} product={product} onDone={onClose} />}
    </Dialog>
  );
}

function ProductForm({ product, onDone }: { product: AdminProduct | null; onDone: () => void }) {
  const categories = useAdminStore((s) => s.categories);
  const products = useAdminStore((s) => s.products);
  const saveProduct = useAdminStore((s) => s.saveProduct);
  const firstWomen = categories.find((c) => c.audience === "women");
  const [p, setP] = useState<AdminProduct>(() => (product ? structuredClone(product) : blankProduct(firstWomen?.id ?? "", "women")));
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [errors, setErrors] = useState<Errors>({});
  const [colorName, setColorName] = useState("");
  const [colorHex, setColorHex] = useState("#b3121b");

  const clearError = (key: string) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as keyof Errors];
      return next;
    });
  const set = <K extends keyof AdminProduct>(key: K, value: AdminProduct[K]) => {
    setP((prev) => ({ ...prev, [key]: value }));
    clearError(key);
  };
  const audienceCats = useMemo(
    () => categories.filter((c) => c.audience === p.audienceCategory).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, p.audienceCategory],
  );
  const discount = discountPercent(p.originalPrice, p.price);

  const submit = (status?: ProductStatus) => (e?: FormEvent) => {
    e?.preventDefault();
    const next = {
      ...p,
      status: status ?? p.status,
      name: p.name.trim(),
      sku: p.sku.trim().toUpperCase(),
      care: p.care.map((c) => c.trim()).filter(Boolean),
      discount,
    };
    const errs = validate(next, products);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    saveProduct(next);
    toast.success(product ? `Saved “${next.name}”` : `Added “${next.name}”`);
    onDone();
  };

  return (
    <form onSubmit={submit()} noValidate className="flex min-h-full flex-col">
      <div className="flex-1 space-y-6 px-5 py-5">
        <FormSection title="Images" description="The first image is used on product cards.">
          <div className="sm:col-span-2">
            <MultiImageUpload images={p.images} onChange={(images) => set("images", images)} altBase={p.name || "Product"} />
            {errors.images && <p className="field-error">{errors.images}</p>}
          </div>
        </FormSection>

        <FormSection title="Basic details">
          <TextField
            className="sm:col-span-2"
            label="Product name"
            required
            value={p.name}
            error={errors.name}
            onChange={(e) => {
              const name = e.target.value;
              setP((prev) => ({ ...prev, name, slug: slugTouched ? prev.slug : slugify(name) }));
              clearError("name");
              if (!slugTouched) clearError("slug");
            }}
            placeholder="e.g. Floral Printed Cotton Kurti"
          />
          <TextField
            label="URL slug"
            required
            value={p.slug}
            error={errors.slug}
            hint={`/product/${p.slug || "…"}`}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", slugify(e.target.value));
            }}
          />
          <TextField label="SKU" required value={p.sku} error={errors.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} />
          <TextField
            className="sm:col-span-2"
            label="Short description"
            value={p.shortDescription}
            maxLength={120}
            aside={`${p.shortDescription.length}/120`}
            onChange={(e) => set("shortDescription", e.target.value)}
          />
          <TextAreaField className="sm:col-span-2" label="Full description" rows={4} value={p.description} onChange={(e) => set("description", e.target.value)} />
        </FormSection>

        <FormSection title="Organisation">
          <SelectField
            label="Audience"
            value={p.audienceCategory}
            options={AUDIENCE_OPTIONS}
            onChange={(e) => {
              const audience = e.target.value as Audience;
              const firstCat = categories.find((c) => c.audience === audience);
              setP((prev) => ({
                ...prev,
                audienceCategory: audience,
                categoryId: firstCat?.id ?? "",
                sizes: prev.sizes.filter((s) => SIZE_OPTIONS[audience].includes(s)),
              }));
            }}
          />
          <SelectField
            label="Category"
            required
            value={p.categoryId}
            error={errors.categoryId}
            options={audienceCats.map((c) => ({ value: c.id, label: categoryLabel(c) }))}
            onChange={(e) => set("categoryId", e.target.value)}
          />
          <TextField label="Fabric" value={p.fabric} onChange={(e) => set("fabric", e.target.value)} placeholder="e.g. Pure cotton" />
          <TextAreaField
            label="Care instructions"
            hint="One per line"
            rows={2}
            value={p.care.join("\n")}
            onChange={(e) => set("care", e.target.value.split("\n"))}
          />
        </FormSection>

        <FormSection title="Pricing" description="Prices include GST. Shipping charges are shown separately at checkout.">
          <TextField
            label="MRP"
            required
            prefix="₹"
            type="number"
            min={0}
            inputMode="numeric"
            value={p.originalPrice || ""}
            error={errors.originalPrice}
            onChange={(e) => set("originalPrice", Number(e.target.value))}
          />
          <TextField
            label="Selling price"
            required
            prefix="₹"
            type="number"
            min={0}
            inputMode="numeric"
            value={p.price || ""}
            error={errors.price}
            hint={discount > 0 ? `${discount}% off · customer saves ${formatPrice(p.originalPrice - p.price)}` : undefined}
            onChange={(e) => set("price", Number(e.target.value))}
          />
        </FormSection>

        <FormSection title="Variants">
          <div className="sm:col-span-2">
            <p className="field-label">Sizes</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Sizes">
              {SIZE_OPTIONS[p.audienceCategory].map((s: Size) => {
                const on = p.sizes.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("sizes", on ? p.sizes.filter((x) => x !== s) : SIZE_OPTIONS[p.audienceCategory].filter((x) => x === s || p.sizes.includes(x)))}
                    className={cn(
                      "min-w-12 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                      on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            {errors.sizes && <p className="field-error">{errors.sizes}</p>}
          </div>
          <div className="sm:col-span-2">
            <p className="field-label">Colours</p>
            <ul className="flex flex-wrap gap-2">
              {p.colors.map((c) => (
                <li key={c.name} className="inline-flex items-center gap-2 rounded-full border border-line bg-white py-1 pr-1.5 pl-1.5 text-sm">
                  <span className="h-5 w-5 rounded-full ring-1 ring-ink/10" style={{ background: c.hex }} aria-hidden />
                  {c.name}
                  <button
                    type="button"
                    onClick={() => set("colors", p.colors.filter((x) => x.name !== c.name))}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-sand hover:text-danger"
                    aria-label={`Remove colour ${c.name}`}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line" style={{ background: colorHex }}>
                <span className="sr-only">Pick colour</span>
                <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              <input
                value={colorName}
                onChange={(e) => setColorName(e.target.value)}
                placeholder="Colour name, e.g. Bottle Green"
                aria-label="New colour name"
                className="field-input field-sm max-w-60 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click();
                  }
                }}
              />
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => {
                  const name = colorName.trim();
                  if (!name) return;
                  if (p.colors.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
                    toast.error("That colour is already added.");
                    return;
                  }
                  set("colors", [...p.colors, { name, hex: colorHex }]);
                  setColorName("");
                }}
              >
                <Plus size={15} aria-hidden /> Add colour
              </button>
            </div>
          </div>
        </FormSection>

        <FormSection title="Inventory">
          <TextField label="Stock on hand" type="number" min={0} inputMode="numeric" value={p.stock} onChange={(e) => set("stock", Math.max(0, Number(e.target.value)))} />
          <TextField
            label="Low-stock alert at"
            type="number"
            min={0}
            inputMode="numeric"
            value={p.lowStockThreshold}
            hint="You'll be alerted at or below this quantity."
            onChange={(e) => set("lowStockThreshold", Math.max(0, Number(e.target.value)))}
          />
          <TextField label="Packed weight (g)" type="number" min={1} value={p.weight} onChange={(e) => set("weight", Math.max(1, Number(e.target.value)))} />
        </FormSection>

        <FormSection title="Visibility">
          <SelectField
            label="Status"
            value={p.status}
            options={[
              { value: "active", label: "Active — visible in store" },
              { value: "draft", label: "Draft — hidden" },
              { value: "archived", label: "Archived" },
            ]}
            onChange={(e) => set("status", e.target.value as ProductStatus)}
          />
          <div className="space-y-3 sm:col-span-2">
            <Switch label="Featured" description="Eligible for the homepage featured section" checked={p.featured} onChange={(v) => set("featured", v)} />
            <Switch label="New arrival" description="Shows the NEW badge and appears in New Arrivals" checked={p.newArrival} onChange={(v) => set("newArrival", v)} />
            <Switch label="Best seller" description="Shows the BESTSELLER badge" checked={p.bestSeller} onChange={(v) => set("bestSeller", v)} />
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-line bg-white px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} className="btn-ghost btn-sm">
          Cancel
        </button>
        {p.status === "draft" ? (
          <>
            <button type="button" onClick={submit("draft")} className="btn-outline btn-sm">
              Save as draft
            </button>
            <button type="button" onClick={submit("active")} className="btn-primary btn-sm">
              Save &amp; publish
            </button>
          </>
        ) : (
          <button type="submit" className="btn-primary btn-sm">
            {product ? "Save changes" : "Add product"}
          </button>
        )}
      </div>
    </form>
  );
}
