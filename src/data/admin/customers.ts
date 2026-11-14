import type { Address, Audience } from "@/types";
import type { AdminCustomer } from "@/types/admin";
import { DEMO_USER } from "@/data/orders";
import { createRng, daysAgo } from "./mock-utils";

const PLACES: Omit<Address, "house" | "street">[] = [
  { city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682016" },
  { city: "Alappuzha", district: "Alappuzha", state: "Kerala", pincode: "688001" },
  { city: "Thiruvananthapuram", district: "Thiruvananthapuram", state: "Kerala", pincode: "695001" },
  { city: "Kottayam", district: "Kottayam", state: "Kerala", pincode: "686001" },
  { city: "Thrissur", district: "Thrissur", state: "Kerala", pincode: "680001" },
  { city: "Kozhikode", district: "Kozhikode", state: "Kerala", pincode: "673001" },
  { city: "Bengaluru", district: "Bengaluru Urban", state: "Karnataka", pincode: "560034" },
  { city: "Chennai", district: "Chennai", state: "Tamil Nadu", pincode: "600017" },
  { city: "Mumbai", district: "Mumbai Suburban", state: "Maharashtra", pincode: "400050" },
  { city: "Hyderabad", district: "Hyderabad", state: "Telangana", pincode: "500034" },
];

const STREETS = ["MG Road", "Temple Road", "Beach Road", "Church Street", "Market Road", "Lake View Lane", "Palace Road", "Hill Top Avenue"];

const PEOPLE: [string, Audience][] = [
  ["Sneha Thomas", "women"],
  ["Rahul Nair", "men"],
  ["Fathima Rahman", "women"],
  ["Divya Krishnan", "women"],
  ["Arjun Menon", "men"],
  ["Meera Pillai", "kids"],
  ["Aisha Kareem", "women"],
  ["Neha Varghese", "women"],
  ["Vishnu Prasad", "men"],
  ["Lakshmi Iyer", "women"],
  ["Riya Joseph", "kids"],
  ["Kavya Suresh", "women"],
  ["Nikhil George", "men"],
  ["Anu Mathew", "women"],
  ["Shreya Das", "women"],
  ["Priya Raghavan", "kids"],
  ["Gayathri Mohan", "women"],
  ["Sanjay Kumar", "men"],
  ["Ammu Philip", "women"],
  ["Hiba Nasser", "women"],
  ["Deepa Unnikrishnan", "kids"],
  ["Jincy Abraham", "women"],
  ["Tara Shenoy", "women"],
];

const rng = createRng(2611);

function emailFor(name: string, i: number) {
  const [first, last] = name.toLowerCase().split(" ");
  const domain = ["gmail.com", "yahoo.co.in", "outlook.com", "gmail.com"][i % 4];
  return `${first}.${last}${i % 3 === 0 ? i + 7 : ""}@${domain}`;
}

const demo: AdminCustomer = {
  id: DEMO_USER.id,
  fullName: DEMO_USER.fullName,
  email: DEMO_USER.email,
  mobile: DEMO_USER.mobile,
  joinedAt: daysAgo(140, 16, 20),
  status: "active",
  addresses: DEMO_USER.addresses.map((a) => ({ ...a })),
  primaryAudience: "women",
  marketingOptIn: true,
  notes: "Demo storefront account.",
};

export const mockCustomers: AdminCustomer[] = [
  demo,
  ...PEOPLE.map(([fullName, primaryAudience], i): AdminCustomer => {
    const place = PLACES[i % PLACES.length];
    return {
      id: `c-${(1001 + i).toString()}`,
      fullName,
      email: emailFor(fullName, i),
      mobile: `9${rng.int(100000000, 999999999)}`,
      joinedAt: daysAgo(rng.int(3, 160), rng.int(8, 22), rng.int(0, 59)),
      status: i === 17 ? "blocked" : "active",
      addresses: [
        {
          house: `${rng.int(1, 48)}/${rng.int(100, 999)}`,
          street: rng.pick(STREETS),
          ...place,
        },
      ],
      primaryAudience,
      marketingOptIn: rng.chance(0.6),
      notes: i === 17 ? "Blocked after repeated failed COD attempts on an older store." : "",
    };
  }),
];
