import { IMG, portrait } from "@/data/images";
import { ProductImage } from "@/components/ui/ProductImage";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="container-page grid gap-10 py-10 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-14">
      <div className="relative hidden aspect-[4/5] max-h-[640px] overflow-hidden rounded-3xl lg:block">
        <ProductImage src={portrait(IMG.mustardWrapDress)} alt="Woman in a mustard satin wrap dress" fill sizes="50vw" priority />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
        <div className="absolute bottom-8 left-8 max-w-xs text-white">
          <p className="font-display text-3xl font-semibold text-white">Your wardrobe, saved.</p>
          <p className="mt-2 text-sm text-white/85">Track orders, save addresses and keep your wishlist across visits.</p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-md">
        <h1 className="font-display text-4xl font-semibold">{title}</h1>
        <p className="mt-2 mb-7 text-muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
