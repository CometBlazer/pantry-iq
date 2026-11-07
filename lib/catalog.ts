// Reference food database: what PantryIQ knows about common UK supermarket products.
// Quantities are tracked in each product's base unit (g, ml or item).

export type Unit = "g" | "ml" | "item";

export type Category =
  | "Dairy"
  | "Bakery"
  | "Fruit & Veg"
  | "Meat & Fish"
  | "Cupboard"
  | "Frozen"
  | "Drinks"
  | "Household";

export interface PackOption {
  /** Label shown on the shelf, e.g. "4 pints" */
  label: string;
  /** Quantity per pack in base units */
  size: number;
  /** Shelf price in pence */
  price: number;
  /** Promotional pack: e.g. "3 for £2" modelled as one bundle */
  promo?: string;
}

export interface Product {
  id: string;
  name: string;
  category: Category;
  unit: Unit;
  /** Extra strings seen on receipts for this product */
  aliases: string[];
  /** Typical shelf life from purchase, in days */
  shelfLifeDays: number;
  /** Prior estimate of consumption per person per day, in base units */
  dailyUsePerPerson: number;
  /** Energy per base unit (kcal) – used for basket nutrition summary */
  kcalPerUnit: number;
  /** Protein per base unit (g) */
  proteinPerUnit: number;
  /** Counts towards "5 a day" fruit & veg portions (80 g ≈ 1 portion) */
  fiveADay?: boolean;
  packs: PackOption[];
}

export const CATALOG: Product[] = [
  {
    id: "milk-semi",
    name: "Semi-skimmed milk",
    category: "Dairy",
    unit: "ml",
    aliases: ["semi skimmed milk", "milk semi", "british milk", "4pt milk", "2pt milk", "semi skim"],
    shelfLifeDays: 8,
    dailyUsePerPerson: 220,
    kcalPerUnit: 0.47,
    proteinPerUnit: 0.036,
    packs: [
      { label: "1 pint", size: 568, price: 95 },
      { label: "2 pints", size: 1136, price: 130 },
      { label: "4 pints", size: 2272, price: 165 },
    ],
  },
  {
    id: "eggs",
    name: "Free range eggs",
    category: "Dairy",
    unit: "item",
    aliases: ["eggs", "free range eggs", "large eggs", "medium eggs", "egg"],
    shelfLifeDays: 24,
    dailyUsePerPerson: 0.45,
    kcalPerUnit: 70,
    proteinPerUnit: 6.3,
    packs: [
      { label: "6 pack", size: 6, price: 189 },
      { label: "12 pack", size: 12, price: 335 },
      { label: "15 pack", size: 15, price: 375 },
    ],
  },
  {
    id: "cheddar",
    name: "Mature cheddar",
    category: "Dairy",
    unit: "g",
    aliases: ["cheddar", "mature cheddar", "cheese", "cheddar cheese", "mature cheese"],
    shelfLifeDays: 35,
    dailyUsePerPerson: 18,
    kcalPerUnit: 4.16,
    proteinPerUnit: 0.25,
    packs: [
      { label: "400 g", size: 400, price: 299 },
      { label: "800 g", size: 800, price: 525 },
    ],
  },
  {
    id: "yoghurt",
    name: "Greek style yoghurt",
    category: "Dairy",
    unit: "g",
    aliases: ["greek yoghurt", "greek style yogurt", "yogurt", "yoghurt", "natural yoghurt"],
    shelfLifeDays: 12,
    dailyUsePerPerson: 50,
    kcalPerUnit: 1.3,
    proteinPerUnit: 0.055,
    packs: [
      { label: "500 g", size: 500, price: 125 },
      { label: "1 kg", size: 1000, price: 215 },
    ],
  },
  {
    id: "butter",
    name: "Salted butter",
    category: "Dairy",
    unit: "g",
    aliases: ["butter", "salted butter", "spreadable", "unsalted butter"],
    shelfLifeDays: 60,
    dailyUsePerPerson: 9,
    kcalPerUnit: 7.4,
    proteinPerUnit: 0.005,
    packs: [{ label: "250 g", size: 250, price: 219 }],
  },
  {
    id: "bread-wholemeal",
    name: "Wholemeal bread",
    category: "Bakery",
    unit: "g",
    aliases: ["wholemeal bread", "brown bread", "medium sliced", "bread", "loaf", "wholemeal loaf"],
    shelfLifeDays: 6,
    dailyUsePerPerson: 75,
    kcalPerUnit: 2.17,
    proteinPerUnit: 0.1,
    packs: [
      { label: "400 g loaf", size: 400, price: 85 },
      { label: "800 g loaf", size: 800, price: 135 },
    ],
  },
  {
    id: "bananas",
    name: "Bananas",
    category: "Fruit & Veg",
    unit: "item",
    aliases: ["bananas", "banana", "loose bananas", "fairtrade bananas"],
    shelfLifeDays: 6,
    dailyUsePerPerson: 0.6,
    kcalPerUnit: 105,
    proteinPerUnit: 1.3,
    fiveADay: true,
    packs: [
      { label: "loose (each)", size: 1, price: 18 },
      { label: "5 pack", size: 5, price: 79 },
    ],
  },
  {
    id: "apples",
    name: "Gala apples",
    category: "Fruit & Veg",
    unit: "item",
    aliases: ["apples", "gala apples", "apple", "braeburn", "pink lady"],
    shelfLifeDays: 18,
    dailyUsePerPerson: 0.4,
    kcalPerUnit: 80,
    proteinPerUnit: 0.4,
    fiveADay: true,
    packs: [
      { label: "6 pack", size: 6, price: 165 },
      { label: "loose (each)", size: 1, price: 35 },
    ],
  },
  {
    id: "carrots",
    name: "Carrots",
    category: "Fruit & Veg",
    unit: "g",
    aliases: ["carrots", "carrot", "loose carrots"],
    shelfLifeDays: 21,
    dailyUsePerPerson: 45,
    kcalPerUnit: 0.41,
    proteinPerUnit: 0.009,
    fiveADay: true,
    packs: [
      { label: "1 kg", size: 1000, price: 59 },
      { label: "500 g", size: 500, price: 45 },
    ],
  },
  {
    id: "potatoes",
    name: "White potatoes",
    category: "Fruit & Veg",
    unit: "g",
    aliases: ["potatoes", "white potatoes", "maris piper", "baking potatoes", "spuds"],
    shelfLifeDays: 30,
    dailyUsePerPerson: 110,
    kcalPerUnit: 0.77,
    proteinPerUnit: 0.02,
    packs: [
      { label: "2.5 kg", size: 2500, price: 159 },
      { label: "1 kg", size: 1000, price: 99 },
    ],
  },
  {
    id: "onions",
    name: "Brown onions",
    category: "Fruit & Veg",
    unit: "g",
    aliases: ["onions", "brown onions", "onion", "red onions"],
    shelfLifeDays: 30,
    dailyUsePerPerson: 35,
    kcalPerUnit: 0.4,
    proteinPerUnit: 0.011,
    fiveADay: true,
    packs: [
      { label: "1 kg", size: 1000, price: 89 },
      { label: "3 pack (~450 g)", size: 450, price: 65 },
    ],
  },
  {
    id: "tomatoes",
    name: "Salad tomatoes",
    category: "Fruit & Veg",
    unit: "g",
    aliases: ["tomatoes", "salad tomatoes", "cherry tomatoes", "vine tomatoes"],
    shelfLifeDays: 7,
    dailyUsePerPerson: 40,
    kcalPerUnit: 0.18,
    proteinPerUnit: 0.009,
    fiveADay: true,
    packs: [
      { label: "6 pack (~400 g)", size: 400, price: 79 },
      { label: "cherry 250 g", size: 250, price: 95 },
    ],
  },
  {
    id: "spinach",
    name: "Baby spinach",
    category: "Fruit & Veg",
    unit: "g",
    aliases: ["spinach", "baby spinach", "salad bag", "leaf salad"],
    shelfLifeDays: 5,
    dailyUsePerPerson: 25,
    kcalPerUnit: 0.23,
    proteinPerUnit: 0.029,
    fiveADay: true,
    packs: [
      { label: "200 g", size: 200, price: 100 },
      { label: "100 g", size: 100, price: 70 },
    ],
  },
  {
    id: "frozen-peas",
    name: "Garden peas (frozen)",
    category: "Frozen",
    unit: "g",
    aliases: ["peas", "garden peas", "frozen peas", "petits pois"],
    shelfLifeDays: 270,
    dailyUsePerPerson: 25,
    kcalPerUnit: 0.81,
    proteinPerUnit: 0.054,
    fiveADay: true,
    packs: [
      { label: "1 kg", size: 1000, price: 115 },
      { label: "2 kg", size: 2000, price: 199 },
    ],
  },
  {
    id: "chicken-breast",
    name: "Chicken breast fillets",
    category: "Meat & Fish",
    unit: "g",
    aliases: ["chicken breast", "chicken fillets", "chicken breast fillets", "chicken"],
    shelfLifeDays: 5,
    dailyUsePerPerson: 55,
    kcalPerUnit: 1.65,
    proteinPerUnit: 0.31,
    packs: [
      { label: "300 g", size: 300, price: 299 },
      { label: "650 g", size: 650, price: 499 },
      { label: "1 kg", size: 1000, price: 699 },
    ],
  },
  {
    id: "beef-mince",
    name: "Beef mince 5% fat",
    category: "Meat & Fish",
    unit: "g",
    aliases: ["beef mince", "mince", "lean mince", "steak mince"],
    shelfLifeDays: 4,
    dailyUsePerPerson: 30,
    kcalPerUnit: 1.37,
    proteinPerUnit: 0.21,
    packs: [
      { label: "500 g", size: 500, price: 375 },
      { label: "750 g", size: 750, price: 525 },
    ],
  },
  {
    id: "salmon",
    name: "Salmon fillets",
    category: "Meat & Fish",
    unit: "g",
    aliases: ["salmon", "salmon fillets", "scottish salmon"],
    shelfLifeDays: 4,
    dailyUsePerPerson: 15,
    kcalPerUnit: 2.08,
    proteinPerUnit: 0.2,
    packs: [{ label: "2 fillets (240 g)", size: 240, price: 425 }],
  },
  {
    id: "pasta",
    name: "Fusilli pasta",
    category: "Cupboard",
    unit: "g",
    aliases: ["pasta", "fusilli", "penne", "spaghetti", "dried pasta"],
    shelfLifeDays: 540,
    dailyUsePerPerson: 45,
    kcalPerUnit: 3.55,
    proteinPerUnit: 0.12,
    packs: [
      { label: "500 g", size: 500, price: 75 },
      { label: "1 kg", size: 1000, price: 110 },
    ],
  },
  {
    id: "rice",
    name: "Long grain rice",
    category: "Cupboard",
    unit: "g",
    aliases: ["rice", "long grain rice", "basmati", "basmati rice", "easy cook rice"],
    shelfLifeDays: 540,
    dailyUsePerPerson: 40,
    kcalPerUnit: 3.6,
    proteinPerUnit: 0.07,
    packs: [
      { label: "1 kg", size: 1000, price: 145 },
      { label: "4 kg", size: 4000, price: 499 },
    ],
  },
  {
    id: "chopped-tomatoes",
    name: "Chopped tomatoes (tin)",
    category: "Cupboard",
    unit: "item",
    aliases: ["chopped tomatoes", "tinned tomatoes", "canned tomatoes", "tomatoes 400g"],
    shelfLifeDays: 540,
    dailyUsePerPerson: 0.12,
    kcalPerUnit: 80,
    proteinPerUnit: 4,
    fiveADay: true,
    packs: [
      { label: "1 tin", size: 1, price: 45 },
      { label: "4 tins", size: 4, price: 155 },
    ],
  },
  {
    id: "baked-beans",
    name: "Baked beans (tin)",
    category: "Cupboard",
    unit: "item",
    aliases: ["baked beans", "beans", "beanz"],
    shelfLifeDays: 540,
    dailyUsePerPerson: 0.1,
    kcalPerUnit: 320,
    proteinPerUnit: 20,
    packs: [
      { label: "1 tin", size: 1, price: 55 },
      { label: "4 tins", size: 4, price: 180 },
    ],
  },
  {
    id: "oats",
    name: "Porridge oats",
    category: "Cupboard",
    unit: "g",
    aliases: ["oats", "porridge oats", "rolled oats", "porridge"],
    shelfLifeDays: 300,
    dailyUsePerPerson: 40,
    kcalPerUnit: 3.75,
    proteinPerUnit: 0.11,
    packs: [
      { label: "1 kg", size: 1000, price: 95 },
      { label: "500 g", size: 500, price: 65 },
    ],
  },
  {
    id: "cereal",
    name: "Wholegrain cereal",
    category: "Cupboard",
    unit: "g",
    aliases: ["cereal", "cornflakes", "bran flakes", "wheat biscuits", "weetabix"],
    shelfLifeDays: 180,
    dailyUsePerPerson: 30,
    kcalPerUnit: 3.6,
    proteinPerUnit: 0.11,
    packs: [
      { label: "500 g", size: 500, price: 165 },
      { label: "750 g", size: 750, price: 225 },
    ],
  },
  {
    id: "coffee",
    name: "Instant coffee",
    category: "Drinks",
    unit: "g",
    aliases: ["coffee", "instant coffee", "nescafe", "gold blend"],
    shelfLifeDays: 365,
    dailyUsePerPerson: 4,
    kcalPerUnit: 0,
    proteinPerUnit: 0,
    packs: [
      { label: "100 g", size: 100, price: 299 },
      { label: "200 g", size: 200, price: 499 },
    ],
  },
  {
    id: "tea",
    name: "Tea bags",
    category: "Drinks",
    unit: "item",
    aliases: ["tea bags", "tea", "yorkshire tea", "pg tips", "teabags"],
    shelfLifeDays: 540,
    dailyUsePerPerson: 2,
    kcalPerUnit: 0,
    proteinPerUnit: 0,
    packs: [
      { label: "80 bags", size: 80, price: 225 },
      { label: "240 bags", size: 240, price: 499 },
    ],
  },
  {
    id: "orange-juice",
    name: "Orange juice",
    category: "Drinks",
    unit: "ml",
    aliases: ["orange juice", "oj", "fresh orange", "juice"],
    shelfLifeDays: 10,
    dailyUsePerPerson: 90,
    kcalPerUnit: 0.45,
    proteinPerUnit: 0.007,
    fiveADay: true,
    packs: [
      { label: "1 L", size: 1000, price: 125 },
      { label: "1.75 L", size: 1750, price: 195 },
    ],
  },
  {
    id: "toilet-roll",
    name: "Toilet roll",
    category: "Household",
    unit: "item",
    aliases: ["toilet roll", "toilet tissue", "loo roll", "andrex"],
    shelfLifeDays: 3650,
    dailyUsePerPerson: 0.15,
    kcalPerUnit: 0,
    proteinPerUnit: 0,
    packs: [
      { label: "4 rolls", size: 4, price: 220 },
      { label: "9 rolls", size: 9, price: 399 },
      { label: "24 rolls", size: 24, price: 950 },
    ],
  },
  {
    id: "washing-up",
    name: "Washing up liquid",
    category: "Household",
    unit: "ml",
    aliases: ["washing up liquid", "fairy", "dish soap", "washing up"],
    shelfLifeDays: 3650,
    dailyUsePerPerson: 8,
    kcalPerUnit: 0,
    proteinPerUnit: 0,
    packs: [
      { label: "450 ml", size: 450, price: 95 },
      { label: "900 ml", size: 900, price: 175 },
    ],
  },
];

export const PRODUCTS_BY_ID: Record<string, Product> = Object.fromEntries(
  CATALOG.map((p) => [p.id, p]),
);

export function formatQty(qty: number, unit: Unit): string {
  if (unit === "item") return `${Math.round(qty * 10) / 10}`;
  if (qty >= 1000) return `${(qty / 1000).toFixed(qty >= 10000 ? 0 : 1)} ${unit === "g" ? "kg" : "L"}`;
  return `${Math.round(qty)} ${unit}`;
}

export function formatPence(p: number): string {
  const sign = p < 0 ? "-" : "";
  return `${sign}£${(Math.abs(p) / 100).toFixed(2)}`;
}
