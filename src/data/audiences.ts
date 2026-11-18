import type { Audience } from "@/types";
import { IMG, portrait } from "./images";

export interface AudienceInfo {
  id: Audience;
  /** Short nav label — "Women", "Home & Living". */
  label: string;
  /** Tighter label for narrow switchers (phones, the lg header) — "Home". Falls back to `label`. */
  shortLabel?: string;
  /** "Women's", "Men's", "Kids'", "Home & Living" */
  possessive: string;
  /** Clothing collections get size charts and "styles"; home collections are counted as "products". */
  kind: "apparel" | "home";
  href: `/${Audience}`;
  title: string;
  tagline: string;
  /** Large photo for the collection page hero. */
  heroImage: string;
  /** Photo for the "Who are you shopping for?" card. */
  cardImage: string;
  /** Extra words that should match this audience in search. */
  keywords: string[];
}

/** Women first: it is the brand's primary focus and the default browsing audience. */
export const AUDIENCES: AudienceInfo[] = [
  {
    id: "women",
    label: "Women",
    kind: "apparel",
    possessive: "Women's",
    href: "/women",
    title: "Women's Collection",
    tagline: "Kurtis, dresses, sarees and festive wear — everyday elegance for every woman.",
    heroImage: portrait(IMG.blushMaxiDress),
    cardImage: portrait(IMG.floralWrapDress),
    keywords: ["women", "womens", "ladies", "lady", "her"],
  },
  {
    id: "men",
    label: "Men",
    kind: "apparel",
    possessive: "Men's",
    href: "/men",
    title: "Men's Collection",
    tagline: "Explore our latest men's fashion — shirts, denim, kurtas and sharp tailoring.",
    heroImage: portrait(IMG.navySuit),
    cardImage: portrait(IMG.navySuit),
    keywords: ["men", "mens", "man", "gents", "him"],
  },
  {
    id: "kids",
    label: "Kids",
    kind: "apparel",
    possessive: "Kids'",
    href: "/kids",
    title: "Kids' Collection",
    tagline: "Playful, comfy and easy-care outfits for boys, girls and babies.",
    heroImage: portrait(IMG.kidsGroup),
    cardImage: portrait(IMG.kidsGroup),
    keywords: ["kids", "kid", "children", "child", "boys", "boy", "girls", "girl", "baby", "toddler"],
  },
  {
    id: "home-living",
    label: "Home & Living",
    shortLabel: "Home",
    kind: "home",
    possessive: "Home & Living",
    href: "/home-living",
    title: "Home & Living",
    tagline: "Bedsheets, pillow covers, cushion covers and blankets to make every room feel like home.",
    heroImage: portrait(IMG.whiteMadeBed),
    cardImage: portrait(IMG.stripedBedding),
    keywords: ["home", "living", "bedding", "bed", "linen", "linens", "furnishing", "furnishings", "decor", "bedroom"],
  },
];

export const DEFAULT_AUDIENCE: Audience = "women";

export function getAudience(id: Audience) {
  return AUDIENCES.find((a) => a.id === id)!;
}

export function isAudience(v: unknown): v is Audience {
  return AUDIENCES.some((a) => a.id === v);
}

/** "12 styles" for clothing, "4 products" for Home & Living. */
export function countLabel(count: number, audience: Audience) {
  const style = getAudience(audience).kind === "apparel";
  return `${count} ${style ? (count === 1 ? "style" : "styles") : count === 1 ? "product" : "products"}`;
}
