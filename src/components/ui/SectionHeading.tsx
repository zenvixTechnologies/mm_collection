import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  id?: string;
}

export function SectionHeading({ eyebrow, title, description, href, linkLabel = "View all", id }: SectionHeadingProps) {
  return (
    <div className="mb-7 flex items-end justify-between gap-4 sm:mb-9">
      <div className="max-w-xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 id={id} className="font-display text-[28px] font-semibold sm:text-4xl">
          {title}
        </h2>
        {description && <p className="mt-2 text-muted">{description}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="group hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-ink underline-offset-4 hover:underline sm:inline-flex"
        >
          {linkLabel}
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
