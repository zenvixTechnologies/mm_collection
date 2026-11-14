"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { Audience } from "@/types";
import type { AdminCategory } from "@/types/admin";
import { getAudience } from "@/data/audiences";
import { slugify } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { ProductImage } from "@/components/ui/ProductImage";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TableEmpty } from "../ui/DataTable";
import { SelectField, Switch, TextAreaField, TextField } from "../ui/FormControls";
import { SingleImageUpload } from "../ui/ImageUpload";
import { PageHeader } from "../ui/PageHeader";
import { Tabs } from "../ui/Toolbar";
import { AUDIENCE_OPTIONS, categoryLabel } from "./catalog-helpers";

function CategoryForm({ category, audience, onDone }: { category: AdminCategory | null; audience: Audience; onDone: () => void }) {
  const categories = useAdminStore((s) => s.categories);
  const save = useAdminStore((s) => s.saveCategory);
  const [c, setC] = useState<AdminCategory>(
    () => category ?? { id: "", slug: "", name: "", description: "", image: "", audience, visible: true, sortOrder: 0 },
  );
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [errors, setErrors] = useState<{ name?: string; slug?: string; image?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!c.name.trim()) errs.name = "Enter a category name.";
    if (!c.slug) errs.slug = "Enter a URL slug.";
    else if (categories.some((x) => x.slug === c.slug && x.id !== c.id)) errs.slug = "This URL is already used by another category.";
    if (!c.image) errs.image = "Add a category image.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save({ ...c, id: c.id || c.slug, name: c.name.trim() });
    toast.success(category ? "Category updated" : "Category added");
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-5 px-5 py-5 sm:grid-cols-[180px_1fr]">
        <div>
          <p className="field-label">Image</p>
          <SingleImageUpload image={c.image || null} onChange={(img) => setC({ ...c, image: img ?? "" })} alt={c.name || "Category"} />
          {errors.image && <p className="field-error">{errors.image}</p>}
        </div>
        <div className="space-y-4">
          <TextField
            label="Name"
            required
            value={c.name}
            error={errors.name}
            onChange={(e) => setC({ ...c, name: e.target.value, slug: slugTouched ? c.slug : slugify(e.target.value) })}
            data-autofocus
          />
          <TextField
            label="URL slug"
            required
            value={c.slug}
            error={errors.slug}
            hint={`/categories/${c.slug || "…"}`}
            disabled={Boolean(category)}
            onChange={(e) => {
              setSlugTouched(true);
              setC({ ...c, slug: slugify(e.target.value) });
            }}
          />
          <SelectField
            label="Audience"
            value={c.audience}
            options={AUDIENCE_OPTIONS}
            disabled={Boolean(category)}
            onChange={(e) => setC({ ...c, audience: e.target.value as Audience })}
          />
          <TextAreaField label="Description" value={c.description} rows={3} onChange={(e) => setC({ ...c, description: e.target.value })} />
          <Switch label="Visible in store" description="Hidden categories don't appear in menus" checked={c.visible} onChange={(v) => setC({ ...c, visible: v })} />
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm">
          {category ? "Save changes" : "Add category"}
        </button>
      </div>
    </form>
  );
}

export function CategoriesView() {
  const categories = useAdminStore((s) => s.categories);
  const products = useAdminStore((s) => s.products);
  const save = useAdminStore((s) => s.saveCategory);
  const move = useAdminStore((s) => s.moveCategory);
  const remove = useAdminStore((s) => s.deleteCategory);
  const [tab, setTab] = useState<Audience>("women");
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);

  const productCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [products]);

  const list = categories.filter((c) => c.audience === tab).sort((a, b) => a.sortOrder - b.sortOrder);
  const count = (a: Audience) => categories.filter((c) => c.audience === a).length;
  const info = getAudience(tab);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Categories" }]}
        title="Categories"
        description="Organise the store into Women, Men and Kids, each with its own sub-categories. The order here is the order shoppers see."
        actions={
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} aria-hidden /> Add category
          </button>
        }
      />

      <Tabs<Audience>
        label="Audience"
        value={tab}
        onChange={setTab}
        items={AUDIENCE_OPTIONS.map((a) => ({ value: a.value, label: a.label, count: count(a.value) }))}
        className="mb-5"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {info.title} · {list.length} sub-categories · {list.reduce((s, c) => s + (productCount.get(c.id) ?? 0), 0)} products
        </p>
        <Link href={info.href} target="_blank" className="text-[13px] font-semibold text-accent hover:underline">
          View {info.label} page in store ↗
        </Link>
      </div>

      {list.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c, i) => {
            const n = productCount.get(c.id) ?? 0;
            return (
              <li key={c.id} className="card flex gap-4 p-3 pr-4">
                <div className="relative h-28 w-[90px] shrink-0 overflow-hidden rounded-lg bg-sand">
                  {c.image && <ProductImage src={c.image} alt="" fill sizes="90px" unoptimized={c.image.startsWith("blob:")} />}
                  {!c.visible && <span className="absolute inset-0 bg-white/50" aria-hidden />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{categoryLabel(c)}</p>
                      <p className="text-xs text-muted">/{c.slug}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={c.visible ? "text-xs font-semibold text-success" : "text-xs font-semibold text-muted"} aria-hidden>
                        {c.visible ? "Visible" : "Hidden"}
                      </span>
                      <Switch hideLabel label={`Show ${c.name} in store`} checked={c.visible} onChange={(v) => save({ ...c, visible: v })} />
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-muted">{c.description}</p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">
                      {n} product{n === 1 ? "" : "s"}
                    </span>
                    <div className="flex items-center">
                      <button type="button" className="icon-btn h-8 w-8 text-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label={`Move ${c.name} up`}>
                        <ArrowUp size={15} />
                      </button>
                      <button type="button" className="icon-btn h-8 w-8 text-muted disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(c.id, 1)} aria-label={`Move ${c.name} down`}>
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn h-8 w-8 text-muted"
                        onClick={() => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                        aria-label={`Edit ${c.name}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button type="button" className="icon-btn h-8 w-8 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="card py-14">
          <TableEmpty icon={<FolderTree size={24} />} title="No categories yet" description={`Add the first ${info.possessive.toLowerCase()} category.`} />
        </div>
      )}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : "Add category"} size="lg">
        {formOpen && <CategoryForm key={editing?.id ?? "new"} category={editing} audience={tab} onDone={() => setFormOpen(false)} />}
      </Dialog>

      {deleting && (productCount.get(deleting.id) ?? 0) > 0 ? (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="Can't delete yet"
          description={
            <>
              <strong className="text-ink">{categoryLabel(deleting)}</strong> still has {productCount.get(deleting.id)} products. Move them to another category first, or hide
              this category instead.
            </>
          }
          confirmLabel="Hide category instead"
          destructive={false}
          onConfirm={() => {
            save({ ...deleting, visible: false });
            toast.success("Category hidden");
          }}
        />
      ) : (
        <ConfirmDialog
          open={deleting !== null}
          onClose={() => setDeleting(null)}
          title="Delete category?"
          description={
            <>
              <strong className="text-ink">{deleting && categoryLabel(deleting)}</strong> will be removed. It has no products.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => {
            if (!deleting) return;
            remove(deleting.id);
            toast.success("Category deleted");
          }}
        />
      )}
    </>
  );
}
