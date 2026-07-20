const express = require("express");
const { db } = require("../db");

const router = express.Router();

function formatProduct(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    category: p.category,
    imageUrl: p.image_url,
    stock: p.stock,
    showStock: !!p.show_stock,
    purchaseCount: p.purchase_count,
    showPurchases: !!p.show_purchases,
    offerPrice: p.offer_price,
    offerActive: !!p.offer_active,
    offerLabel: p.offer_label || "",
    effectivePrice: p.offer_active && p.offer_price != null ? p.offer_price : p.price,
    inStock: p.stock === -1 || p.stock > 0,
    badge: p.offer_active && p.offer_label ? p.offer_label : null,
  };
}

router.get("/", (req, res) => {
  const { category, search } = req.query;
  let sql = "SELECT * FROM products WHERE active = 1";
  const params = [];

  if (category && category !== "all") {
    sql += " AND category = ?";
    params.push(category);
  }

  if (search) {
    sql += " AND (name LIKE ? OR description LIKE ?)";
    const term = `%${search}%`;
    params.push(term, term);
  }

  sql += " ORDER BY created_at DESC";
  const products = db.prepare(sql).all(...params).map(formatProduct);
  res.json(products);
});

router.get("/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(formatProduct(p));
});

module.exports = router;
