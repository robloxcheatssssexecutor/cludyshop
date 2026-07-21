const fs = require("fs");

function parseStars(message) {
  const text = String(message || "").toLowerCase();
  const match = text.match(/(\d{1,2})\s*\/\s*10/);
  if (match) {
    const score = Number(match[1]);
    if (score >= 9) return 5;
    if (score >= 7) return 4;
    if (score >= 5) return 3;
    if (score >= 3) return 2;
    return 1;
  }
  if (/\b(legit|recommend|recommended|100%|perfect|excelente|genial)\b/.test(text)) return 5;
  return 5;
}

function parseProductName(message) {
  let product = String(message || "").trim();
  product = product.replace(/\s*\d{1,2}\s*\/\s*10\s*$/i, "").trim();
  product = product.replace(/\s*\+\s*rep\s*$/i, "").trim();
  if (!product) return "Servicio digital";
  if (product.length > 60) return product.slice(0, 57) + "...";
  return product;
}

function resolveUserId(vouchesData, preferredUserId) {
  if (preferredUserId && vouchesData[preferredUserId]) return preferredUserId;
  const ids = Object.keys(vouchesData || {});
  if (ids.length === 1) return ids[0];
  if (preferredUserId) return preferredUserId;
  return ids[0] || null;
}

function importVouches(db, vouchesData, options = {}) {
  const userId = resolveUserId(vouchesData, options.userId);
  if (!userId) {
    return { imported: 0, skipped: 0, total: 0, error: "No se encontraron vouches en el archivo" };
  }

  const vouches = vouchesData[userId];
  if (!Array.isArray(vouches) || vouches.length === 0) {
    return { imported: 0, skipped: 0, total: 0, userId, error: "No hay vouches para este usuario" };
  }

  const existing = new Set(
    db
      .prepare("SELECT source_id FROM reviews WHERE source_id IS NOT NULL")
      .all()
      .map((row) => row.source_id)
  );

  const insert = db.prepare(`
    INSERT INTO reviews (customer_name, stars, message, product_name, approved, created_at, source, source_id)
    VALUES (?, ?, ?, ?, 1, ?, 'discord', ?)
  `);

  let imported = 0;
  let skipped = 0;
  const total = vouches.length;
  const baseTime = Date.now();

  vouches.forEach((vouch, index) => {
    const sourceId = `discord:${userId}:${index}`;
    if (existing.has(sourceId)) {
      skipped++;
      return;
    }

    const message = String(vouch.message || "").trim();
    const name = String(vouch.from || "Cliente").trim() || "Cliente";
    if (!message) {
      skipped++;
      return;
    }

    const createdAt = new Date(baseTime - (total - index) * 60 * 60 * 1000).toISOString();
    insert.run(name, parseStars(message), message, parseProductName(message), createdAt, sourceId);
    existing.add(sourceId);
    imported++;
  });

  return { imported, skipped, total, userId };
}

function loadVouchesFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Formato de vouches.json invalido");
  }
  return data;
}

module.exports = { importVouches, loadVouchesFile, parseStars, parseProductName };
