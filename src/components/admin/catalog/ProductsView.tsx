"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, Download, Eye, EyeOff, Pencil, Plus, Shirt, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Audience } from "@/types";
import type { AdminProduct, ProductStatus } from "@/types/admin";
import { stockState, type StockState } from "@/lib/admin/metrics";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { ProductImage } from "@/components/ui/ProductImage";
import { ProductStatusBadge, StockBadge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";
import { categoryLabel } from "./catalog-helpers";
import { ProductFormDrawer } from "./ProductFormDrawer";

type StatusTab = "all" | ProductStatus;

export function ProductsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const products = useAdminStore((s) => s.products);
  const categories = useAdminStore((s) => s.categories);
  const deleteProducts = useAdminStore((s) => s.deleteProducts);
  const setProductStatus = useAdminStore((s) => s.setProductStatus);

  const [tab, setTab] = useState<StatusTab>("all");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [audience, setAudience] = useState<"all" | Audience>("all");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState<"all" | StockState>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [formOpen, setFormOpen] = useState(params.get("new") === "1");
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const counts = useMemo(
    () => ({
      all: products.length,
      active: products.filter((p) => p.status === "active").length,
      draft: products.filter((p) => p.status === "draft").length,
      archived: products.filter((p) => p.status === "archived").length,
    }),
    [products],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (tab === "all" || p.status === tab) &&
        (audience === "all" || p.audienceCategory === audience) &&
        (category === "all" || p.categoryId === category) &&
        (stock === "all" || stockState(p) === stock) &&
        (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)),
    );
  }, [products, tab, audience, category, stock, q]);

  const openForm = (p: AdminProduct | null) => {
    setEditing(p);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    if (params.get("new")) router.replace(pathname);
  };

  const columns: Column<AdminProduct>[] = [
    {
      id: "name",
      header: "Product",
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="flex min-w-[220px] items-center gap-3">
          <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-sand">
            {p.images[0] && <ProductImage src={p.images[0]} alt="" fill sizes="44px" unoptimized={p.images[0].startsWith("blob:")} />}
          </span>
          <span className="min-w-0">
            <button type="button" onClick={() => openForm(p)} className="block max-w-[280px] truncate text-left font-semibold hover:text-accent hover:underline">
              {p.name}
            </button>
            <span className="text-xs text-muted">
              {p.sku}
              <span className="sm:hidden">
                {" "}
                · {formatPrice(p.price)} · {p.stock} in stock
              </span>
            </span>
          </span>
        </div>
      ),
    },
    {
      id: "category",
      header: "Category",
      hideBelow: "md",
      sortValue: (p) => catById.get(p.categoryId)?.name ?? "",
      cell: (p) => {
        const c = catById.get(p.categoryId);
        return (
          <span className="whitespace-nowrap">
            {c ? categoryLabel(c) : "—"}
            <span className="block text-xs text-muted capitalize">{p.audienceCategory}</span>
          </span>
        );
      },
    },
    {
      id: "price",
      header: "Price",
      align: "right",
      sortValue: (p) => p.price,
      cell: (p) => (
        <span className="whitespace-nowrap tabular-nums">
          <span className="font-semibold">{formatPrice(p.price)}</span>
          {p.originalPrice > p.price && (
            <span className="block text-xs text-muted">
              <s>{formatPrice(p.originalPrice)}</s> <span className="text-success">{p.discount}% off</span>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "stock",
      header: "Stock",
      sortValue: (p) => p.stock,
      cell: (p) => (
        <span className="flex flex-col items-start gap-1 whitespace-nowrap">
          <span className="font-semibold tabular-nums">{p.stock}</span>
          {stockState(p) !== "in" && <StockBadge state={stockState(p)} />}
        </span>
      ),
    },
    { id: "status", header: "Status", hideBelow: "sm", sortValue: (p) => p.status, cell: (p) => <ProductStatusBadge status={p.status} /> },
    {
      id: "updated",
      header: "Updated",
      hideBelow: "xl",
      sortValue: (p) => p.updatedAt,
      cell: (p) => <span className="whitespace-nowrap text-muted">{formatDate(p.updatedAt)}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (p) => (
        <div className="flex justify-end gap-0.5">
          <button type="button" onClick={() => openForm(p)} className="icon-btn h-9 w-9 text-muted hover:text-ink" aria-label={`Edit ${p.name}`}>
            <Pencil size={16} />
          </button>
          <Link href={`/product/${p.slug}`} target="_blank" className="icon-btn hidden h-9 w-9 text-muted hover:text-ink sm:inline-flex" aria-label={`View ${p.name} in store (new tab)`}>
            <Eye size={16} />
          </Link>
          <button type="button" onClick={() => setConfirmIds([p.id])} className="icon-btn h-9 w-9 text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${p.name}`}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const audienceCats = categories.filter((c) => audience === "all" || c.audience === audience);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Products" }]}
        title="Products"
        description={`${counts.active} live in the store · ${counts.draft} drafts. Add, edit and organise everything you sell.`}
        actions={
          <>
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() => {
                downloadCsv(
                  "mm-products.csv",
                  ["SKU", "Name", "Audience", "Category", "MRP", "Price", "Stock", "Status"],
                  filtered.map((p) => [p.sku, p.name, p.audienceCategory, catById.get(p.categoryId)?.name, p.originalPrice, p.price, p.stock, p.status]),
                );
                toast.success(`Exported ${filtered.length} products`);
              }}
            >
              <Download size={15} aria-hidden /> Export CSV
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => openForm(null)}>
              <Plus size={16} aria-hidden /> Add product
            </button>
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs<StatusTab>
            label="Product status"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setSelected([]);
            }}
            items={[
              { value: "all", label: "All", count: counts.all },
              { value: "active", label: "Active", count: counts.active },
              { value: "draft", label: "Drafts", count: counts.draft },
              { value: "archived", label: "Archived", count: counts.archived },
            ]}
          />
        </div>
        <Toolbar className="p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search by name or SKU" label="Search products" className="sm:max-w-xs sm:flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <FilterSelect
              label="Audience"
              value={audience}
              onChange={(v) => {
                setAudience(v);
                setCategory("all");
              }}
              options={[
                { value: "all", label: "All audiences" },
                { value: "women", label: "Women" },
                { value: "men", label: "Men" },
                { value: "kids", label: "Kids" },
              ]}
            />
            <FilterSelect
              label="Category"
              value={category}
              onChange={setCategory}
              options={[{ value: "all", label: "All categories" }, ...audienceCats.map((c) => ({ value: c.id, label: categoryLabel(c) }))]}
            />
            <FilterSelect
              className="col-span-2 sm:col-auto"
              label="Stock"
              value={stock}
              onChange={setStock}
              options={[
                { value: "all", label: "Any stock" },
                { value: "in", label: "In stock" },
                { value: "low", label: "Low stock" },
                { value: "out", label: "Out of stock" },
              ]}
            />
          </div>
          <p className="text-[13px] text-muted sm:ml-auto">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </p>
        </Toolbar>

        <DataTable
          caption="Products"
          rows={filtered}
          columns={columns}
          getRowId={(p) => p.id}
          resetKey={`${tab}|${q}|${audience}|${category}|${stock}`}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          initialSort={{ id: "updated", dir: "desc" }}
          bulkActions={(ids) => (
            <>
              <button type="button" className="btn-light btn-sm min-h-8 border border-line" onClick={() => { setProductStatus(ids, "active"); setSelected([]); toast.success("Published"); }}>
                <Eye size={14} aria-hidden /> Publish
              </button>
              <button type="button" className="btn-light btn-sm min-h-8 border border-line" onClick={() => { setProductStatus(ids, "draft"); setSelected([]); toast.success("Moved to drafts"); }}>
                <EyeOff size={14} aria-hidden /> Unpublish
              </button>
              <button type="button" className="btn-light btn-sm min-h-8 border border-line" onClick={() => { setProductStatus(ids, "archived"); setSelected([]); toast.success("Archived"); }}>
                <Archive size={14} aria-hidden /> Archive
              </button>
              <button type="button" className="btn btn-sm min-h-8 bg-danger text-white hover:bg-accent-dark" onClick={() => setConfirmIds(ids)}>
                <Trash2 size={14} aria-hidden /> Delete
              </button>
            </>
          )}
          empty={
            <TableEmpty
              icon={<Shirt size={24} />}
              title="No products found"
              description="Try a different search or clear the filters."
              action={
                <button type="button" className="btn-outline btn-sm" onClick={() => { setQ(""); setAudience("all"); setCategory("all"); setStock("all"); setTab("all"); }}>
                  Clear filters
                </button>
              }
            />
          }
        />
      </div>

      <ProductFormDrawer open={formOpen} onClose={closeForm} product={editing} />
      <ConfirmDialog
        open={confirmIds !== null}
        onClose={() => setConfirmIds(null)}
        title={confirmIds && confirmIds.length > 1 ? `Delete ${confirmIds.length} products?` : "Delete product?"}
        description={
          <>
            {confirmIds?.length === 1 ? (
              <>
                <strong className="text-ink">{products.find((p) => p.id === confirmIds[0])?.name}</strong> will be removed from the catalogue.
              </>
            ) : (
              "The selected products will be removed from the catalogue."
            )}{" "}
            Past orders keep their item details. Consider archiving instead if you might sell it again.
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (!confirmIds) return;
          deleteProducts(confirmIds);
          setSelected((s) => s.filter((id) => !confirmIds.includes(id)));
          toast.success(confirmIds.length > 1 ? `Deleted ${confirmIds.length} products` : "Product deleted");
        }}
      />
    </>
  );
}
