/**
 * Packed shipping weight per product, in grams (garment + polybag/tag).
 * DEMO VALUES — realistic estimates for development. Weigh real packed parcels before going live;
 * the admin "Product weights" screen can override any value without changing code.
 *
 * Every product must appear here: the catalogue builder throws if one is missing, so a
 * new product can never silently ship with a zero weight.
 */
export const SHIPPING_WEIGHTS: Record<string, number> = {
  // ---------- Women ----------
  "Floral Printed Cotton Dress": 420,
  "Elegant Anarkali Kurti": 480,
  "Premium Feeding Frock": 430,
  "Women's Casual Co-ord Set": 560,
  "Floral Maxi Dress": 450,
  "Cotton Nightwear Set": 380,
  "Party Wear Gown": 780,
  "Ajrak Printed Kurti": 320,
  "Casual Women's Top": 220,
  "Premium Ethnic Churidar Set": 620,
  "Printed A-Line Dress": 400,
  "Elegant Women's Western Dress": 460,
  "Off-Shoulder Ruffle Dress": 410,
  "Polka Dot Wrap Dress": 360,
  "Red Floral Slip Dress": 300,
  "Mustard Satin Wrap Dress": 380,
  "Embroidered Cotton Shirt": 260,
  "Crochet Knit Poncho Top": 340,
  "Striped Off-Shoulder Top": 230,
  "Sheer Sleeve Black Top": 210,
  "Ruffle Sleeve Blouse": 240,
  "Mustard Printed Straight Kurta": 330,
  "Block Print Cotton Churidar Set": 650,
  "Banarasi Silk Saree": 850,
  "Kanjivaram Style Silk Saree": 900,
  "Embroidered Lehenga Gown": 1350,
  "Sunshine Lounge Co-ord": 640,
  "Navy Crop Co-ord Set": 520,
  "Ivory Linen Co-ord": 540,
  "Tailored Check Blazer": 820,
  "Teal Halter Jumpsuit": 480,
  "Olive Strappy Romper": 350,
  "Relaxed Denim Jacket": 760,
  "Graphic Print Tee": 200,
  "Plum Off-Shoulder Gown": 900,
  "Sequin Embellished Gown": 1250,
  "Pastel Lounge Jogger Set": 560,
  "Cosy Fleece Night Jacket": 620,
  "Button-Front Feeding Dress": 400,
  "Denim Nursing Shirt Dress": 470,
  "Nursing-Friendly Maxi Dress": 460,
  "Black Knit Midi Dress": 430,
  "Lace Cut-Out Evening Dress": 520,
  "White Tailored Blazer": 800,
  // ---------- Men ----------
  "Men's Classic Formal Cotton Shirt": 350,
  "Men's Sky Blue Oxford Shirt": 340,
  "Men's Checked Flannel Shirt": 420,
  "Men's White Dress Shirt": 360,
  "Men's Essential Black T-Shirt": 230,
  "Men's Classic White Crew Tee": 210,
  "Men's Graphic Print T-Shirt": 230,
  "Men's Lilac Cotton T-Shirt": 210,
  "Men's Dark Indigo Slim Jeans": 680,
  "Men's Distressed Light-Wash Jeans": 640,
  "Men's Khaki Stretch Chinos": 520,
  "Men's Grey Tailored Trousers": 480,
  "Men's Denim Trucker Jacket": 950,
  "Men's Camel Casual Blazer": 850,
  "Men's Navy Slim-Fit Suit": 1450,
  "Men's Blue Windowpane Three-Piece Suit": 1700,
  "Men's Charcoal Formal Blazer": 1000,
  "Men's Royal Blue Cotton Kurta Set": 620,
  "Men's Kurta with Printed Waistcoat": 900,
  "Men's White Chikankari Kurta Pyjama": 580,
  "Men's Mint Linen Co-ord Set": 600,
  "Men's Grey Shirt & Shorts Co-ord": 520,
  // ---------- Kids ----------
  "Boys' Navy Cardigan & Shorts Set": 330,
  "Boys' Red Polo T-Shirt": 160,
  "Boys' Colour-Block Tracksuit": 420,
  "Boys' Gingham Shirt with Suspenders": 220,
  "Boys' Purple Silk-Blend Kurta Set": 350,
  "Boys' Sky Blue Kurta Pyjama": 260,
  "Toddler Beige Printed Kurta Set": 200,
  "Girls' Festive Pattu Pavada Set": 420,
  "Girls' Polka Dot Puff-Sleeve Top": 150,
  "Girls' Denim Dungaree Set": 450,
  "Girls' Denim Jacket & Leggings Set": 480,
  "Girls' Plum Party Frock": 280,
  "Girls' Red Tiered Party Dress": 340,
  "Girls' Maroon Bow Dress": 270,
  "Girls' Printed Cotton Frock": 190,
  "Kids' Soft Cotton Basic Tee": 110,
  "Baby Bear Hooded Fleece Suit": 260,
  "Baby Printed Cotton Romper": 120,
  "Kids' Yellow Hooded Raincoat": 380,
};

/** Packed parcel size (cm) for a folded garment of this weight — polybag up to 1 kg, then a box. */
export function packageFor(weightGrams: number) {
  if (weightGrams <= 300) return { packageLength: 30, packageWidth: 22, packageHeight: 3 };
  if (weightGrams <= 600) return { packageLength: 32, packageWidth: 25, packageHeight: 5 };
  if (weightGrams <= 1000) return { packageLength: 35, packageWidth: 28, packageHeight: 7 };
  return { packageLength: 40, packageWidth: 32, packageHeight: 10 };
}
