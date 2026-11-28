"use client";

import Link from "next/link";
import { MessageSquareText, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AdminPage, AdminReview } from "@/types/admin";
import { useAdminQuery, withQuery } from "@/hooks/use-admin-query";
import { useDebounced } from "@/hooks/use-debounced";
import { adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate } from "@/lib/utils";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { ReviewImages } from "@/components/products/ReviewImages";
import { Rating } from "@/components/ui/Rating";
import { Badge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { LoadError, TableSkeleton } from "../ui/QueryState";
import { FilterSelect, SearchInput, Toolbar } from "../ui/Toolbar";

type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";

const PAGE_SIZE = 20;

/** Customer reviews: staff can read and delete them. There is deliberately no way to edit one. */
export function ReviewsView() {
  const canDelete = useAdminSession((s) => s.can("reviews:moderate"));
  const [q, setQ] = useState("");
  const [rating, setRating] = useState<RatingFilter>("all");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminReview | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const filters = { q: useDebounced(q.trim()), rating: rating === "all" ? undefined : rating };
  const filterKey = JSON.stringify(filters);
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setPage(1);
  }
  const { data, status, error, refreshing, reload } = useAdminQuery<AdminPage<AdminReview>>(withQuery("/reviews", { ...filters, page, limit: PAGE_SIZE }));
  const rows = data?.items ?? [];

  const remove = async (review: AdminReview) => {
    setDeleting(review.id);
    try {
      await adminApi(`/reviews/${review.id}`, { method: "DELETE" });
      toast.success("Review deleted");
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else reload();
    } catch (err) {
      toast.error(errorMessage(err));
      reload();
    } finally {
      setDeleting(null);
    }
  };

  const columns: Column<AdminReview>[] = [
    {
      id: "product",
      header: "Product",
      cell: (r) => (
        <div className="min-w-[130px]">
          {r.productSlug ? (
            <Link href={`/product/${r.productSlug}`} target="_blank" className="font-semibold hover:text-accent hover:underline">
              {r.productName}
            </Link>
          ) : (
            <span className="font-semibold">{r.productName}</span>
          )}
          <p className="mt-0.5 text-xs text-muted md:hidden">{r.authorName}</p>
        </div>
      ),
    },
    { id: "reviewer", header: "Reviewer", hideBelow: "md", cell: (r) => <span className="whitespace-nowrap">{r.authorName}</span> },
    { id: "rating", header: "Rating", cell: (r) => <Rating value={r.rating} size={13} /> },
    {
      id: "review",
      header: "Review",
      cell: (r) => (
        <div className="min-w-[220px] max-w-md">
          {r.title && <p className="font-medium">{r.title}</p>}
          <p className="leading-6 break-words whitespace-pre-line text-muted">{r.comment}</p>
          <ReviewImages images={r.images} author={r.authorName} />
        </div>
      ),
    },
    { id: "date", header: "Submitted", hideBelow: "lg", cell: (r) => <span className="whitespace-nowrap text-muted">{formatDate(r.createdAt, true)}</span> },
    {
      id: "verified",
      header: "Purchase",
      hideBelow: "sm",
      cell: (r) => (
        <div className="flex flex-col items-start gap-1 whitespace-nowrap">
          {r.verified ? <Badge tone="success">Verified purchase</Badge> : <Badge tone="muted">Not verified</Badge>}
          {r.orderNumber && (
            <Link href={`/mm-hub/orders/${r.orderNumber}`} className="text-xs text-muted hover:text-ink hover:underline">
              {r.orderNumber}
            </Link>
          )}
          {r.orderNow && <span className="text-xs text-danger">Order {r.orderNow} since</span>}
          {!r.verified && <span className="text-xs text-muted">Hidden from shoppers</span>}
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      className: "w-10",
      cell: (r) =>
        canDelete && (
          <button type="button" onClick={() => setTarget(r)} disabled={deleting === r.id} className="icon-btn h-9 w-9 text-muted hover:text-danger disabled:opacity-40" aria-label={`Delete review by ${r.authorName} of ${r.productName}`}>
            <Trash2 size={16} />
          </button>
        ),
    },
  ];

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Reviews" }]} title="Reviews" description="Reviews from customers who bought the product. You can delete a review, but not edit it." />

      <div className="card overflow-hidden">
        <Toolbar className="p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Product, reviewer or review text" label="Search reviews" className="sm:max-w-xs sm:flex-1" />
          <FilterSelect<RatingFilter>
            label="Rating"
            value={rating}
            onChange={setRating}
            options={[{ value: "all", label: "All ratings" }, ...(["5", "4", "3", "2", "1"] as const).map((s) => ({ value: s, label: `${s} star${s === "1" ? "" : "s"}` }))]}
          />
          <p className="text-[13px] text-muted sm:ml-auto">
            {data?.total ?? 0} review{data?.total === 1 ? "" : "s"}
          </p>
        </Toolbar>
        {status === "loading" ? (
          <TableSkeleton />
        ) : status === "error" ? (
          <LoadError title="Couldn't load reviews" message={error} onRetry={reload} />
        ) : (
          <DataTable
            caption="Product reviews"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            server={{ page, totalPages: data?.totalPages ?? 1, total: data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: refreshing }}
            empty={<TableEmpty icon={<MessageSquareText size={24} />} title="No reviews found" description={q || rating !== "all" ? "Try another search or rating." : "Reviews appear here when customers submit them."} />}
          />
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Delete this review?"
        description={
          target && (
            <>
              The {target.rating}-star review by <strong className="text-ink">{target.authorName}</strong> of <strong className="text-ink">{target.productName}</strong> is
              permanently removed{target.images.length ? ", with its photos," : ""} and no longer counts towards the product&apos;s rating. This can&apos;t be undone.
            </>
          )
        }
        confirmLabel="Delete review"
        onConfirm={() => {
          if (target) void remove(target);
        }}
      />
    </>
  );
}
