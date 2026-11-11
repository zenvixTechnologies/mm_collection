import type { Review } from "@/types";

/** Homepage testimonials. */
export const testimonials: Review[] = [
  {
    id: "t1",
    name: "Anjali Menon",
    location: "Kochi",
    rating: 5,
    title: "Fits exactly as described",
    comment:
      "I ordered the Floral Printed Cotton Dress in M and it fit perfectly. The fabric is soft and breathable — I've already worn it three times this month!",
    date: "2026-10-18",
    productName: "Floral Printed Cotton Dress",
  },
  {
    id: "t2",
    name: "Fathima Rahman",
    location: "Kozhikode",
    rating: 5,
    title: "A lifesaver for new mums",
    comment:
      "The feeding frock is so thoughtfully made. Buttons are easy to open, the material doesn't cling and I feel put-together even on sleepless days.",
    date: "2026-10-05",
    productName: "Premium Feeding Frock",
  },
  {
    id: "t3",
    name: "Priya Nair",
    location: "Thiruvananthapuram",
    rating: 4,
    title: "Beautiful kurti, quick delivery",
    comment:
      "The Ajrak kurti colours are rich and exactly like the photos. Delivered in 3 days. Only wish it came in more colours!",
    date: "2026-09-27",
    productName: "Ajrak Printed Kurti",
  },
  {
    id: "t4",
    name: "Sneha Varghese",
    location: "Bengaluru",
    rating: 5,
    title: "Got so many compliments",
    comment:
      "Wore the Party Wear Gown to my cousin's reception and everyone asked where it was from. The twirl is everything. Packaging was lovely too.",
    date: "2026-09-14",
    productName: "Party Wear Gown",
  },
  {
    id: "t5",
    name: "Lakshmi Iyer",
    location: "Chennai",
    rating: 5,
    title: "Silk saree is stunning",
    comment:
      "The Banarasi saree has a gorgeous sheen and the zari is neat. Very good value for the price. Will definitely shop again for Diwali.",
    date: "2026-08-30",
    productName: "Banarasi Silk Saree",
  },
  {
    id: "t6",
    name: "Reshma Thomas",
    location: "Thrissur",
    rating: 4,
    title: "Easy exchange process",
    comment:
      "I needed a size up in the co-ord set and the exchange was hassle-free. The new size fits beautifully and the linen feels premium.",
    date: "2026-08-21",
    productName: "Women's Casual Co-ord Set",
  },
  {
    id: "t7",
    name: "Divya Krishnan",
    location: "Hyderabad",
    rating: 5,
    title: "My go-to for office wear",
    comment:
      "I've bought four kurtas and two tops from M&M COLLECTIONS. The stitching quality is consistent and the size chart is accurate every time.",
    date: "2026-08-02",
  },
  {
    id: "t8",
    name: "Neha Joseph",
    location: "Mumbai",
    rating: 4,
    title: "Comfortable nightwear",
    comment:
      "The cotton nightwear set is super soft and doesn't fade after washing. Ordered a second set in grey right after the first arrived.",
    date: "2026-07-19",
    productName: "Cotton Nightwear Set",
  },
];

const REVIEW_POOL: Omit<Review, "id" | "date">[] = [
  { name: "Aishwarya R.", location: "Kochi", rating: 5, title: "Loved it!", comment: "Fabric quality is excellent and the colour is exactly as shown. Fits true to size." },
  { name: "Meera S.", location: "Pune", rating: 4, title: "Good value", comment: "Very pretty and comfortable. Stitching is neat. Slightly long for my height but easily altered." },
  { name: "Shabana K.", location: "Kannur", rating: 5, title: "Perfect for festivals", comment: "Wore it for Onam and got so many compliments. Delivery was quick and packaging was neat." },
  { name: "Ritika P.", location: "Delhi", rating: 4, title: "Nice fit", comment: "Fits well around the shoulders and waist. The material feels breathable even in humid weather." },
  { name: "Gayathri M.", location: "Kollam", rating: 5, title: "Premium feel", comment: "Feels much more expensive than the price. Washed it once and it still looks brand new." },
  { name: "Jasmine A.", location: "Alappuzha", rating: 3, title: "Pretty but runs small", comment: "Lovely design, but I'd suggest ordering one size up. Exchange was easy though." },
];

/** Deterministic product reviews so server and client render identical content. */
export function getProductReviews(productId: string, count = 4): Review[] {
  const seed = Number(productId.replace(/\D/g, "")) || 1;
  return Array.from({ length: count }, (_, i) => {
    const base = REVIEW_POOL[(seed + i * 2) % REVIEW_POOL.length];
    const day = ((seed * 7 + i * 11) % 27) + 1;
    const month = 10 - ((seed + i) % 4);
    return {
      ...base,
      id: `${productId}-r${i}`,
      date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  });
}
