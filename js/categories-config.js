// js/categories-config.js

/**
 * Safpedia Marketplace Category & Unit Registry
 * Central configuration for physical & digital product categories.
 */

export const CATEGORIES = [
  {
    id: "electronics",
    label: "Electronics & Gadgets",
    supportedTypes: ["physical"],
    units: ["unit", "set", "pack", "piece"]
  },
  {
    id: "foodstuff",
    label: "Foodstuff & Provisions",
    supportedTypes: ["physical"],
    units: ["bag", "crate", "kg", "paint rubber", "carton", "unit"]
  },
  {
    id: "clothing",
    label: "Clothing & Apparel",
    supportedTypes: ["physical"],
    units: ["item", "pair", "pack", "set"]
  },
  {
    id: "building",
    label: "Plumbing & Building Materials",
    supportedTypes: ["physical"],
    units: ["piece", "length", "bag", "truckload", "roll", "set"]
  },
  {
    id: "ebooks",
    label: "E-Books & Guides",
    supportedTypes: ["digital"],
    units: ["download"]
  },
  {
    id: "software",
    label: "Software & Templates",
    supportedTypes: ["digital"],
    units: ["license", "download"]
  },
  {
    id: "audio_media",
    label: "Audio & Music",
    supportedTypes: ["digital"],
    units: ["download"]
  },
  {
    id: "courses_coaching",
    label: "Digital Courses & Resources",
    supportedTypes: ["digital"],
    units: ["access", "download"]
  },
  {
    id: "general",
    label: "General Goods & Services",
    supportedTypes: ["physical", "digital"],
    units: ["unit", "pack", "box", "item"]
  }
];

/**
 * Helper: Find category config by ID
 */
export function getCategoryById(categoryId) {
  return CATEGORIES.find((cat) => cat.id === categoryId) || CATEGORIES.find((cat) => cat.id === "general");
}

/**
 * Helper: Retrieve permitted units based on category and product type
 */
export function getUnitsForCategory(categoryId, type = "physical") {
  if (type === "digital") {
    return ["download", "license", "access"];
  }
  const category = getCategoryById(categoryId);
  return category ? category.units : ["unit"];
}