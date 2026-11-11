import { ProductGridSkeleton } from "@/components/ui/Skeletons";

export default function Loading() {
  return (
    <div className="container-page pt-8">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton mt-5 h-10 w-64" />
      <div className="mt-10">
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
