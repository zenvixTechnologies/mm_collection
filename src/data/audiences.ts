import type { Audience } from "@/types";
import { IMG, portrait } from "./images";

export interface AudienceInfo {
  id: Audience;
  /** Short nav label — "Women". */
  label: string;
  /** "Women's", "Men's", "Kids'" */
  possessive: string;
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
    possessive: "Kids'",
    href: "/kids",
    title: "Kids' Collection",
    tagline: "Playful, comfy and easy-care outfits for boys, girls and babies.",
    heroImage: portrait(IMG.kidsGroup),
    cardImage: portrait(IMG.kidsGroup),
    keywords: ["kids", "kid", "children", "child", "boys", "boy", "girls", "girl", "baby", "toddler"],
  },
];

export const DEFAULT_AUDIENCE: Audience = "women";

export function getAudience(id: Audience) {
  return AUDIENCES.find((a) => a.id === id)!;
}

export function isAudience(v: unknown): v is Audience {
  return v === "women" || v === "men" || v === "kids";
}
