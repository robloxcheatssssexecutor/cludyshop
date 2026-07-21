const path = require("path");
const fs = require("fs");

const VALID_CATEGORIES = new Set(["tools", "methods", "variety"]);

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function uploadRelativePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) return raw.slice("/uploads/".length);
  if (raw.startsWith("uploads/")) return raw.slice("uploads/".length);
  return raw.replace(/^\/+/, "");
}

function normalizeDigitalFile(value) {
  return uploadRelativePath(value);
}

function resolveUploadFile(uploadDir, value) {
  const rel = uploadRelativePath(value);
  if (!rel) return null;

  const full = path.resolve(uploadDir, rel);
  const base = path.resolve(uploadDir);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;

  return { rel, full };
}

function collectProductUploadFiles(products, uploadDir) {
  const seen = new Set();
  const files = [];

  for (const product of products) {
    for (const field of [product.image_url, product.digital_file]) {
      const resolved = resolveUploadFile(uploadDir, field);
      if (!resolved || seen.has(resolved.rel)) continue;
      seen.add(resolved.rel);
      files.push(resolved);
    }
  }

  return files;
}

function findProductsJsonFile(rootDir) {
  const direct = path.join(rootDir, "products.json");
  if (fs.existsSync(direct)) return direct;

  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(rootDir, entry.name, "products.json");
    if (fs.existsSync(nested)) return nested;
  }

  return null;
}

function copyImportUploads(sourceUploadsDir, targetUploadDir) {
  if (!sourceUploadsDir || !fs.existsSync(sourceUploadsDir)) return 0;

  if (!fs.existsSync(targetUploadDir)) fs.mkdirSync(targetUploadDir, { recursive: true });

  const base = path.resolve(targetUploadDir);
  let copied = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = path.relative(sourceUploadsDir, full);
      const dest = path.resolve(targetUploadDir, rel);
      if (dest !== base && !dest.startsWith(base + path.sep)) continue;

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(full, dest);
      copied++;
    }
  };

  walk(sourceUploadsDir);
  return copied;
}

function loadPayloadFromExtractedImport(extractDir) {
  const jsonPath = findProductsJsonFile(extractDir);
  if (!jsonPath) {
    throw new Error("No se encontro products.json en el archivo ZIP");
  }

  const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const uploadsDir = path.join(path.dirname(jsonPath), "uploads");
  return { payload, uploadsDir };
}

function exportProduct(row) {
  return {
    name: row.name,
    description: row.description || "",
    price: row.price,
    category: row.category || "variety",
    image_url: row.image_url || "",
    stock: row.stock ?? -1,
    show_stock: !!row.show_stock,
    show_purchases: row.show_purchases !== 0,
    purchase_count: row.purchase_count ?? 0,
    offer_active: !!row.offer_active,
    offer_price: row.offer_price ?? null,
    offer_label: row.offer_label || "",
    delivery_type: row.delivery_type || "file",
    delivery_text: row.delivery_text || "",
    digital_file: row.digital_file || "",
    active: row.active !== 0,
  };
}

function exportProducts(db) {
  const rows = db.prepare("SELECT * FROM products ORDER BY name ASC").all();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    products: rows.map(exportProduct),
  };
}

function parseImportPayload(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.products)) return data.products;
  throw new Error("Formato invalido. Se esperaba un array de productos o { products: [...] }");
}

function normalizeImportProduct(raw, index) {
  if (!raw || typeof raw !== "object") {
    return { error: `Producto #${index + 1}: formato invalido` };
  }

  const name = String(raw.name || "").trim();
  if (!name) return { error: `Producto #${index + 1}: nombre requerido` };

  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) {
    return { error: `"${name}": precio invalido` };
  }

  const category = String(raw.category || "variety").trim().toLowerCase();
  if (!VALID_CATEGORIES.has(category)) {
    return { error: `"${name}": categoria invalida (${category})` };
  }

  const deliveryType = raw.delivery_type === "text" || raw.deliveryType === "text" ? "text" : "file";
  const deliveryText = String(raw.delivery_text ?? raw.deliveryText ?? "").trim();
  const digitalFile = normalizeDigitalFile(raw.digital_file ?? raw.digitalFile);

  if (deliveryType === "text" && !deliveryText) {
    return { error: `"${name}": delivery_text requerido para entrega por texto` };
  }

  const stock = raw.stock !== undefined && raw.stock !== "" ? Number(raw.stock) : -1;
  const offerPrice =
    raw.offer_price !== undefined && raw.offer_price !== null && raw.offer_price !== ""
      ? Number(raw.offer_price)
      : raw.offerPrice !== undefined && raw.offerPrice !== null && raw.offerPrice !== ""
        ? Number(raw.offerPrice)
        : null;

  return {
    product: {
      name,
      description: String(raw.description || "").trim(),
      price,
      category,
      image_url: String(raw.image_url ?? raw.imageUrl ?? "").trim(),
      stock: Number.isFinite(stock) ? stock : -1,
      show_stock: raw.show_stock === true || raw.show_stock === 1 || raw.showStock === true || raw.showStock === 1 ? 1 : 0,
      show_purchases:
        raw.show_purchases === false || raw.show_purchases === 0 || raw.showPurchases === false || raw.showPurchases === 0
          ? 0
          : 1,
      purchase_count:
        raw.purchase_count !== undefined && raw.purchase_count !== ""
          ? Number(raw.purchase_count) || 0
          : raw.purchaseCount !== undefined && raw.purchaseCount !== ""
            ? Number(raw.purchaseCount) || 0
            : 0,
      offer_active: raw.offer_active === true || raw.offer_active === 1 || raw.offerActive === true || raw.offerActive === 1 ? 1 : 0,
      offer_price: Number.isFinite(offerPrice) ? offerPrice : null,
      offer_label: String(raw.offer_label ?? raw.offerLabel ?? "").trim(),
      delivery_type: deliveryType,
      delivery_text: deliveryType === "text" ? deliveryText : "",
      digital_file: deliveryType === "file" ? digitalFile : "",
      active: raw.active === false || raw.active === 0 ? 0 : 1,
    },
  };
}

function importProducts(db, rawPayload, options = {}) {
  const items = parseImportPayload(rawPayload);
  const updateExisting = options.updateExisting === true;

  const existingRows = db.prepare("SELECT id, name FROM products").all();
  const byName = new Map(existingRows.map((row) => [normalizeName(row.name), row.id]));

  const insert = db.prepare(`
    INSERT INTO products (name, description, price, category, image_url, stock, show_stock, show_purchases,
      purchase_count, offer_active, offer_price, offer_label, digital_file, delivery_type, delivery_text, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const update = db.prepare(`
    UPDATE products SET name=?, description=?, price=?, category=?, image_url=?, stock=?, show_stock=?,
      show_purchases=?, purchase_count=?, offer_active=?, offer_price=?, offer_label=?, digital_file=?,
      delivery_type=?, delivery_text=?, active=?
    WHERE id=?
  `);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  db.batch(() => {
    items.forEach((raw, index) => {
      const parsed = normalizeImportProduct(raw, index);
      if (parsed.error) {
        errors.push(parsed.error);
        skipped++;
        return;
      }

      const p = parsed.product;
      const key = normalizeName(p.name);
      const existingId = byName.get(key);

      if (existingId) {
        if (!updateExisting) {
          skipped++;
          return;
        }
        update.run(
          p.name,
          p.description,
          p.price,
          p.category,
          p.image_url,
          p.stock,
          p.show_stock,
          p.show_purchases,
          p.purchase_count,
          p.offer_active,
          p.offer_price,
          p.offer_label,
          p.digital_file,
          p.delivery_type,
          p.delivery_text,
          p.active,
          existingId
        );
        updated++;
        return;
      }

      insert.run(
        p.name,
        p.description,
        p.price,
        p.category,
        p.image_url,
        p.stock,
        p.show_stock,
        p.show_purchases,
        p.purchase_count,
        p.offer_active,
        p.offer_price,
        p.offer_label,
        p.digital_file,
        p.delivery_type,
        p.delivery_text,
        p.active
      );
      byName.set(key, true);
      imported++;
    });
  });

  const total = db.prepare("SELECT COUNT(*) as c FROM products").get().c;

  return { imported, updated, skipped, total, errors: errors.slice(0, 10) };
}

module.exports = {
  exportProducts,
  importProducts,
  parseImportPayload,
  collectProductUploadFiles,
  loadPayloadFromExtractedImport,
  copyImportUploads,
};
