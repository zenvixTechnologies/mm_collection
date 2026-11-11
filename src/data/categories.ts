import type { Category, CategoryId } from "@/types";
import { IMG, portrait } from "./images";

export const categories: Category[] = [
  {
    id: "dresses",
    slug: "dresses",
    name: "Dresses",
    description: "Midis, maxis and A-lines for every mood — from brunch to evenings out.",
    image: portrait(IMG.floralWrapDress),
  },
  {
    id: "tops",
    slug: "tops",
    name: "Tops",
    description: "Easy blouses, shirts and knits that pair with everything you own.",
    image: portrait(IMG.embroideredShirt),
  },
  {
    id: "kurtis",
    slug: "kurtis",
    name: "Kurtis",
    description: "Printed, embroidered and Anarkali kurtis for daily wear and festive days.",
    image: portrait(IMG.greenKurti),
  },
  {
    id: "churidhars",
    slug: "churidhars",
    name: "Churidhars",
    description: "Complete churidhar sets with dupattas, in breathable cottons and silks.",
    image: portrait(IMG.whiteAnarkali),
  },
  {
    id: "sarees",
    slug: "sarees",
    name: "Sarees",
    description: "Silk and soft-drape sarees with zari borders for weddings and festivals.",
    image: portrait(IMG.purpleSaree),
  },
  {
    id: "co-ord-sets",
    slug: "co-ord-sets",
    name: "Co-ord Sets",
    description: "Matching two-piece sets — one decision, a perfectly put-together look.",
    image: portrait(IMG.navyCoord),
  },
  {
    id: "ethnic-wear",
    slug: "ethnic-wear",
    name: "Ethnic Wear",
    description: "Festive and traditional pieces rooted in Indian craft and textiles.",
    image: portrait(IMG.redSilkSaree),
  },
  {
    id: "western-wear",
    slug: "western-wear",
    name: "Western Wear",
    description: "Jumpsuits, blazers and dresses with clean, contemporary tailoring.",
    image: portrait(IMG.tealJumpsuit),
  },
  {
    id: "casual-wear",
    slug: "casual-wear",
    name: "Casual Wear",
    description: "Comfortable, easy pieces made for long days and weekends.",
    image: portrait(IMG.whiteTeeJeans),
  },
  {
    id: "party-wear",
    slug: "party-wear",
    name: "Party Wear",
    description: "Gowns and statement dresses for celebrations and special evenings.",
    image: portrait(IMG.redGown),
  },
  {
    id: "nightwear",
    slug: "nightwear",
    name: "Nightwear",
    description: "Soft cotton sets and loungewear for slow mornings and restful nights.",
    image: portrait(IMG.camisoles),
  },
  {
    id: "feeding-wear",
    slug: "feeding-wear",
    name: "Feeding Wear",
    description: "Thoughtful nursing-friendly frocks and dresses with discreet openings.",
    image: portrait(IMG.burgundyShirtDress),
  },
];

export function getCategory(id: string) {
  return categories.find((c) => c.id === id);
}

export function isCategoryId(id: string): id is CategoryId {
  return categories.some((c) => c.id === id);
}
