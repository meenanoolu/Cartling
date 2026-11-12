export type Offer = {
  store: string;
  price: number;
  ships: string;
  days: number;
};

export type Product = {
  id: string;
  name: string;
  blurb: string;
  image: string;
  returnDays: number;
  aliases: string[];
  pairs: string[];
  facts: string[];
  offers: Offer[];
};

export const PRODUCTS: Product[] = [
  {
    id: "earbuds-nc",
    name: "Noise-cancelling earbuds",
    blurb: "Active noise cancelling, 30 hours with the case. The commute pair.",
    image: "/static/products/earbuds.jpg",
    returnDays: 30,
    aliases: ["earbud", "earbuds", "buds", "noise", "anc", "commute"],
    pairs: [],
    facts: ["30 hours with the case", "Active noise cancelling", "Light enough for a commute"],
    offers: [
      { store: "BudgetBuy", price: 48, ships: "4 days", days: 4 },
      { store: "GadgetHub", price: 58, ships: "2 days", days: 2 },
      { store: "TechStore", price: 79.99, ships: "2 days", days: 2 },
    ],
  },
  {
    id: "headphones-overear",
    name: "Over-ear headphones",
    blurb: "Softer for long sessions, 40 hour battery. Heavier than buds.",
    image: "/static/products/headphones.jpg",
    returnDays: 30,
    aliases: ["headphone", "headphones", "over-ear", "over ear"],
    pairs: [],
    facts: ["40 hour battery", "Over-ear and heavier", "Better for a long sitting"],
    offers: [
      { store: "GadgetHub", price: 119, ships: "3 days", days: 3 },
      { store: "TechStore", price: 129.99, ships: "2 days", days: 2 },
    ],
  },
  {
    id: "phone-case",
    name: "Clear shockproof case",
    blurb: "Slim clear case, raised lip over the screen.",
    image: "/static/products/case.jpg",
    returnDays: 30,
    aliases: ["case", "phone case", "cover"],
    pairs: [],
    facts: ["Raised lip over the screen", "Slim, not a wallet", "Clear, so the phone still looks like itself"],
    offers: [
      { store: "GadgetHub", price: 12.5, ships: "3 days", days: 3 },
      { store: "TechStore", price: 14.99, ships: "2 days", days: 2 },
    ],
  },
  {
    id: "usb-c-cable",
    name: "USB-C cable, 2m",
    blurb: "Braided fast-charge cable. The one that always walks off.",
    image: "/static/products/cable.jpg",
    returnDays: 30,
    aliases: ["cable", "usb", "usb-c", "usbc", "cord", "charger cable"],
    pairs: [],
    facts: ["2 metres", "Braided", "The piece a power bank is useless without"],
    offers: [
      { store: "BudgetBuy", price: 9.99, ships: "5 days", days: 5 },
      { store: "TechStore", price: 12.99, ships: "2 days", days: 2 },
    ],
  },
  {
    id: "power-bank",
    name: "20000mAh power bank",
    blurb: "A day and a half of phone charge. It does not include a cable.",
    image: "/static/products/power.jpg",
    returnDays: 30,
    aliases: ["power bank", "powerbank", "battery", "portable charger", "charger"],
    pairs: ["usb-c-cable"],
    facts: ["20,000 mAh", "No cable in the box", "A day and a half of phone charge"],
    offers: [
      { store: "BudgetBuy", price: 29.99, ships: "4 days", days: 4 },
      { store: "GadgetHub", price: 34.99, ships: "2 days", days: 2 },
    ],
  },
  {
    id: "smartwatch",
    name: "Fitness smartwatch",
    blurb: "Heart rate, sleep, seven-day battery. Not a phone replacement.",
    image: "/static/products/watch.jpg",
    returnDays: 30,
    aliases: ["watch", "smartwatch", "fitness", "tracker"],
    pairs: [],
    facts: ["Seven-day battery", "Heart rate and sleep", "Not a phone"],
    offers: [
      { store: "GadgetHub", price: 79.99, ships: "3 days", days: 3 },
      { store: "TechStore", price: 89.99, ships: "2 days", days: 2 },
    ],
  },
  {
    id: "laptop-stand",
    name: "Adjustable laptop stand",
    blurb: "Aluminum, lifts the screen to eye line.",
    image: "/static/products/stand.jpg",
    returnDays: 30,
    aliases: ["stand", "laptop stand", "riser", "posture"],
    pairs: ["mouse"],
    facts: ["Aluminum", "Screen to eye line", "Nothing to charge"],
    offers: [{ store: "BudgetBuy", price: 24.99, ships: "4 days", days: 4 }],
  },
  {
    id: "mouse",
    name: "Wireless ergonomic mouse",
    blurb: "Quiet click, right-hand shape.",
    image: "/static/products/mouse.jpg",
    returnDays: 30,
    aliases: ["mouse", "mice"],
    pairs: ["laptop-stand"],
    facts: ["Quiet click", "Right-hand shape", "Wireless"],
    offers: [
      { store: "GadgetHub", price: 24.5, ships: "3 days", days: 3 },
      { store: "TechStore", price: 29.99, ships: "2 days", days: 2 },
    ],
  },
];

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function bestOffer(product: Product): Offer {
  return [...product.offers].sort((a, b) => a.price - b.price || a.days - b.days)[0]!;
}

export function soonestOffer(product: Product): Offer {
  return [...product.offers].sort((a, b) => a.days - b.days || a.price - b.price)[0]!;
}

export function chosenOffer(product: Product, store?: string): Offer {
  if (!store) return bestOffer(product);
  const hit = product.offers.find((offer) => offer.store.toLowerCase() === store.toLowerCase());
  return hit ?? bestOffer(product);
}

export function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
