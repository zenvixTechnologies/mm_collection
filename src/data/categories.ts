import type { Audience, Category, CategoryId } from "@/types";
import { IMG, portrait } from "./images";

const womenCategories: Category[] = [
  {
    id: "dresses",
    slug: "dresses",
    audience: "women",
    name: "Dresses",
    description: "Midis, maxis and A-lines for every mood — from brunch to evenings out.",
    image: portrait(IMG.floralWrapDress),
  },
  {
    id: "tops",
    slug: "tops",
    audience: "women",
    name: "Tops",
    description: "Easy blouses, shirts and knits that pair with everything you own.",
    image: portrait(IMG.embroideredShirt),
  },
  {
    id: "kurtis",
    slug: "kurtis",
    audience: "women",
    name: "Kurtis",
    description: "Printed, embroidered and Anarkali kurtis for daily wear and festive days.",
    image: portrait(IMG.greenKurti),
  },
  {
    id: "churidhars",
    slug: "churidhars",
    audience: "women",
    name: "Churidhars",
    description: "Complete churidhar sets with dupattas, in breathable cottons and silks.",
    image: portrait(IMG.whiteAnarkali),
  },
  {
    id: "sarees",
    slug: "sarees",
    audience: "women",
    name: "Sarees",
    description: "Silk and soft-drape sarees with zari borders for weddings and festivals.",
    image: portrait(IMG.purpleSaree),
  },
  {
    id: "co-ord-sets",
    slug: "co-ord-sets",
    audience: "women",
    name: "Co-ord Sets",
    description: "Matching two-piece sets — one decision, a perfectly put-together look.",
    image: portrait(IMG.navyCoord),
  },
  {
    id: "ethnic-wear",
    slug: "ethnic-wear",
    audience: "women",
    name: "Ethnic Wear",
    description: "Festive and traditional pieces rooted in Indian craft and textiles.",
    image: portrait(IMG.redSilkSaree),
  },
  {
    id: "western-wear",
    slug: "western-wear",
    audience: "women",
    name: "Western Wear",
    description: "Jumpsuits, blazers and dresses with clean, contemporary tailoring.",
    image: portrait(IMG.tealJumpsuit),
  },
  {
    id: "casual-wear",
    slug: "casual-wear",
    audience: "women",
    name: "Casual Wear",
    description: "Comfortable, easy pieces made for long days and weekends.",
    image: portrait(IMG.whiteTeeJeans),
  },
  {
    id: "party-wear",
    slug: "party-wear",
    audience: "women",
    name: "Party Wear",
    description: "Gowns and statement dresses for celebrations and special evenings.",
    image: portrait(IMG.redGown),
  },
  {
    id: "nightwear",
    slug: "nightwear",
    audience: "women",
    name: "Nightwear",
    description: "Soft cotton sets and loungewear for slow mornings and restful nights.",
    image: portrait(IMG.camisoles),
  },
  {
    id: "feeding-wear",
    slug: "feeding-wear",
    audience: "women",
    name: "Feeding Wear",
    description: "Thoughtful nursing-friendly frocks and dresses with discreet openings.",
    image: portrait(IMG.burgundyShirtDress),
  },
];

const menCategories: Category[] = [
  cat("men", "men-shirts", "Shirts", "Formal and casual shirts in breathable cottons, cut for a sharp fit.", IMG.formalShirts),
  cat("men", "men-t-shirts", "T-Shirts", "Everyday crew necks, graphic tees and polos in soft combed cotton.", IMG.whiteCrewTee),
  cat("men", "men-jeans", "Jeans", "Slim, straight and relaxed denim in classic washes.", IMG.jeansStack),
  cat("men", "men-trousers", "Trousers", "Chinos and tailored trousers that go from office to weekend.", IMG.khakiChinos),
  cat("men", "men-casual-wear", "Casual Wear", "Relaxed jackets, tees and layers for easy weekends.", IMG.rippedJeansLook),
  cat("men", "men-formal-wear", "Formal Wear", "Suits, blazers and dress shirts for work and occasions.", IMG.navySuit),
  cat("men", "men-ethnic-wear", "Ethnic Wear", "Kurtas, kurta sets and waistcoats for festivals and weddings.", IMG.blueKurta),
  cat("men", "men-co-ord-sets", "Men's Co-ord Sets", "Matching shirt-and-bottom sets — effortless, put-together style.", IMG.mintCoord),
];

const kidsCategories: Category[] = [
  cat("kids", "kids-boys", "Boys Clothing", "Polos, shirts, sets and festive wear for boys aged 1–10.", IMG.boyCardigan),
  cat("kids", "kids-girls", "Girls Clothing", "Frocks, tops, dungarees and festive outfits for girls aged 1–10.", IMG.girlDenimJacket),
  cat("kids", "kids-dresses", "Kids Dresses", "Twirl-ready frocks and party dresses in soft, comfy fabrics.", IMG.girlRedFrock),
  cat("kids", "kids-t-shirts", "T-Shirts", "Soft everyday tees and polos that survive the playground.", IMG.boyRedPolo),
  cat("kids", "kids-sets", "Kids Sets", "Mix-free matching sets — one pick, a whole outfit.", IMG.boyTracksuit),
  cat("kids", "kids-baby", "Baby Clothing", "Gentle rompers, onesies and basics for babies and toddlers.", IMG.babyBearSuit),
  cat("kids", "kids-ethnic-wear", "Ethnic Wear", "Little kurtas and festive outfits for celebrations and family functions.", IMG.boyPurpleKurta),
  cat("kids", "kids-casual-wear", "Casual Wear", "Easy, durable outfits made for play and everyday adventures.", IMG.girlDungaree),
];

function cat(audience: Audience, id: CategoryId, name: string, description: string, photo: string): Category {
  return { id, slug: id, audience, name, description, image: portrait(photo) };
}

export const categories: Category[] = [...womenCategories, ...menCategories, ...kidsCategories];


export function getCategory(id: string) {
  return categories.find((c) => c.id === id);
}

export function isCategoryId(id: string): id is CategoryId {
  return categories.some((c) => c.id === id);
}

export function getCategoriesByAudience(audience: Audience) {
  return categories.filter((c) => c.audience === audience);
}

/** Name that stays unambiguous outside its audience — "Men's Shirts", "Kids' T-Shirts", "Dresses". */
export function categoryFullName(c: Category) {
  if (c.audience === "women" || /^(men|kids)/i.test(c.name)) return c.name;
  return `${c.audience === "men" ? "Men's" : "Kids'"} ${c.name}`;
}
