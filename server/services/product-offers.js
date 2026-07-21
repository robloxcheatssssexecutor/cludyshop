function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isOfferCurrentlyActive(product) {
  if (!product || !product.offer_active || product.offer_price == null) return false;
  const expires = product.offer_expires_at;
  if (!expires) return true;
  const expMs = Date.parse(expires);
  if (Number.isNaN(expMs)) return true;
  return expMs > Date.now();
}

function getEffectivePrice(product) {
  return isOfferCurrentlyActive(product) ? product.offer_price : product.price;
}

function defaultOfferLabel(discountType, discountValue) {
  const value = Number(discountValue);
  if (discountType === "fixed") return `-€${value.toFixed(2)} OFF`;
  return `-${value}% OFF`;
}

function computeOfferPrice(basePrice, discountType, discountValue) {
  const price = Number(basePrice);
  const value = Number(discountValue);
  if (!Number.isFinite(price) || price < 0) return null;
  if (!Number.isFinite(value) || value < 0) return null;

  if (discountType === "fixed") {
    return roundMoney(Math.max(0, price - value));
  }

  if (value > 100) return null;
  return roundMoney(price * (1 - value / 100));
}

function deactivateExpiredOffers(db) {
  const result = db
    .prepare(
      `UPDATE products SET offer_active = 0
       WHERE offer_active = 1
         AND offer_expires_at IS NOT NULL
         AND TRIM(offer_expires_at) != ''
         AND datetime(offer_expires_at) <= datetime('now')`
    )
    .run();
  return result.changes || 0;
}

function normalizeExpiresAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new Error("Fecha de expiracion invalida");
  if (ms <= Date.now()) throw new Error("La expiracion debe ser en el futuro");
  return new Date(ms).toISOString();
}

function applyBulkOffers(db, options = {}) {
  deactivateExpiredOffers(db);

  const scope = options.scope === "selected" ? "selected" : "all";
  const discountType = options.discountType === "fixed" ? "fixed" : "percent";
  const discountValue = Number(options.discountValue);
  const label = String(options.label || "").trim();
  const expiresAt = options.expiresAt ? normalizeExpiresAt(options.expiresAt) : null;

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new Error("Indica un descuento valido mayor que 0");
  }
  if (discountType === "percent" && discountValue > 100) {
    throw new Error("El porcentaje no puede superar 100");
  }

  let productIds = [];
  if (scope === "all") {
    productIds = db.prepare("SELECT id FROM products").all().map((row) => row.id);
  } else {
    const rawIds = Array.isArray(options.productIds) ? options.productIds : [];
    productIds = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!productIds.length) throw new Error("Selecciona al menos un producto");
  }

  const select = db.prepare("SELECT id, name, price FROM products WHERE id = ?");
  const update = db.prepare(
    "UPDATE products SET offer_active = 1, offer_price = ?, offer_label = ?, offer_expires_at = ? WHERE id = ?"
  );

  let updated = 0;
  let skipped = 0;
  const errors = [];
  const offerLabel = label || defaultOfferLabel(discountType, discountValue);

  db.batch(() => {
    for (const id of productIds) {
      const product = select.get(id);
      if (!product) {
        skipped++;
        continue;
      }

      const offerPrice = computeOfferPrice(product.price, discountType, discountValue);
      if (offerPrice == null) {
        errors.push(`"${product.name}": descuento invalido`);
        skipped++;
        continue;
      }
      if (offerPrice >= product.price) {
        errors.push(`"${product.name}": el descuento no reduce el precio`);
        skipped++;
        continue;
      }

      update.run(offerPrice, offerLabel, expiresAt, id);
      updated++;
    }
  });

  return { updated, skipped, errors: errors.slice(0, 15), expiresAt, offerLabel };
}

function clearOffers(db, options = {}) {
  const scope = options.scope === "selected" ? "selected" : "all";

  if (scope === "all") {
    const result = db
      .prepare(
        "UPDATE products SET offer_active = 0, offer_price = NULL, offer_label = '', offer_expires_at = NULL WHERE offer_active = 1 OR offer_price IS NOT NULL OR TRIM(offer_label) != '' OR offer_expires_at IS NOT NULL"
      )
      .run();
    return { cleared: result.changes || 0 };
  }

  const rawIds = Array.isArray(options.productIds) ? options.productIds : [];
  const productIds = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!productIds.length) throw new Error("Selecciona al menos un producto");

  const update = db.prepare(
    "UPDATE products SET offer_active = 0, offer_price = NULL, offer_label = '', offer_expires_at = NULL WHERE id = ?"
  );

  let cleared = 0;
  db.batch(() => {
    for (const id of productIds) {
      const result = update.run(id);
      if (result.changes) cleared++;
    }
  });

  return { cleared };
}

module.exports = {
  applyBulkOffers,
  clearOffers,
  computeOfferPrice,
  deactivateExpiredOffers,
  defaultOfferLabel,
  getEffectivePrice,
  isOfferCurrentlyActive,
};
