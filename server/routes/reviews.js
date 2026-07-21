const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const reviews = db
    .prepare("SELECT * FROM reviews WHERE approved = 1 ORDER BY created_at DESC")
    .all()
    .map((r) => ({
      id: r.id,
      name: r.customer_name,
      stars: r.stars,
      message: r.message,
      product: r.product_name,
      date: r.created_at,
    }));
  res.json(reviews);
});

router.get("/stats", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as c FROM reviews WHERE approved = 1").get().c;
  const avg = db.prepare("SELECT AVG(stars) as a FROM reviews WHERE approved = 1").get().a || 0;
  res.json({ total, average: Math.round(avg * 10) / 10 });
});

router.post("/", (req, res) => {
  const { orderCode, customerName, stars, message, productName } = req.body;

  if (!stars || stars < 1 || stars > 5 || !message?.trim()) {
    return res.status(400).json({ error: "Incomplete review data" });
  }

  let order = null;
  if (orderCode) {
    order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
    if (order?.review_submitted) {
      return res.status(400).json({ error: "You have already left a review for this order" });
    }
  }

  const name = customerName || order?.customer_name || "Customer";
  const product = productName || "Digital product";

  const result = db
    .prepare(
      "INSERT INTO reviews (order_id, customer_name, stars, message, product_name) VALUES (?, ?, ?, ?, ?)"
    )
    .run(order?.id || null, name, stars, message.trim(), product);

  if (order) {
    db.prepare("UPDATE orders SET review_submitted = 1 WHERE id = ?").run(order.id);
  }

  res.json({
    id: result.lastInsertRowid,
    name,
    stars,
    message: message.trim(),
    product,
    date: new Date().toISOString(),
  });
});

module.exports = router;
