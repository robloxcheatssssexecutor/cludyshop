const BRANDING_KEYS = [
  "logo_url",
  "logo_letter",
  "brand_name",
  "brand_accent",
  "site_title",
  "hero_badge",
  "hero_title",
  "hero_highlight",
  "hero_desc",
  "products_title",
  "about_title",
  "footer_text",
];

const DEFAULTS = {
  logo_url: "",
  logo_letter: "C",
  brand_name: "Cludy",
  brand_accent: "Shop",
  site_title: "Cludy Shop — Digital Products",
  hero_badge: "Instant digital delivery",
  hero_title: "Your store for",
  hero_highlight: "digital products",
  hero_desc:
    "Scripts, configs and packs in .txt and downloadable file formats. Pay with Stripe, Litecoin or PayPal and receive everything instantly.",
  products_title: "Digital products",
  about_title: "Cludy Shop",
  footer_text: "Cludy Shop — Digital products with instant delivery.",
};

function ensureDefaultSettings(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(DEFAULTS)) {
    insert.run(key, value);
  }
}

function getBranding(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const branding = { ...DEFAULTS };

  for (const key of BRANDING_KEYS) {
    if (stored[key] !== undefined && stored[key] !== null) {
      branding[key] = stored[key];
    }
  }

  return branding;
}

function setBranding(db, values = {}) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  for (const key of BRANDING_KEYS) {
    if (values[key] === undefined) continue;
    upsert.run(key, String(values[key] ?? "").trim());
  }

  return getBranding(db);
}

module.exports = {
  BRANDING_KEYS,
  DEFAULTS,
  ensureDefaultSettings,
  getBranding,
  setBranding,
};
