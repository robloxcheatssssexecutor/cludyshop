const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { db } = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { markOrderPaid } = require("./orders");

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function productUpload(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return next();

  upload.fields([{ name: "image", maxCount: 1 }, { name: "digitalFile", maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Error al subir archivo" });
    next();
  });
}

function removeUpload(relativePath) {
  if (!relativePath) return;
  const filename = relativePath.startsWith("/uploads/") ? relativePath.slice("/uploads/".length) : path.basename(relativePath);
  const fullPath = path.join(uploadDir, filename);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  const token = jwt.sign({ user: username, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("admin_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true, user: username, isAdmin: true });
});

router.post("/logout", (req, res) => {
  res.clearCookie("admin_token");
  res.json({ ok: true });
});

router.get("/me", authMiddleware, (req, res) => {
  const isAdmin = req.admin.isAdmin === true || req.admin.user === process.env.ADMIN_USER;
  res.json({ user: req.admin.user, isAdmin });
});

router.get("/stats", authMiddleware, (req, res) => {
  const products = db.prepare("SELECT COUNT(*) as c FROM products WHERE active = 1").get().c;
  const orders = db.prepare("SELECT COUNT(*) as c FROM orders").get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE payment_status = 'paid'").get().t;
  const pending = db.prepare("SELECT COUNT(*) as c FROM orders WHERE payment_status IN ('pending', 'pending_verification')").get().c;
  res.json({ products, orders, revenue, pending });
});

router.get("/products", authMiddleware, (req, res) => {
  const products = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
  res.json(products);
});

router.post("/products", authMiddleware, productUpload, (req, res) => {
  const { name, description, price, category, stock, showStock, showPurchases, offerActive, offerPrice, offerLabel } =
    req.body;

  if (!name?.trim() || price === undefined || price === "") {
    return res.status(400).json({ error: "Nombre y precio requeridos" });
  }

  const imageUrl = req.files?.image?.[0] ? `/uploads/${req.files.image[0].filename}` : "";
  const digitalFile = req.files?.digitalFile?.[0]?.filename || "";

  const result = db
    .prepare(
      `INSERT INTO products (name, description, price, category, image_url, stock, show_stock, show_purchases,
       offer_active, offer_price, offer_label, digital_file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.trim(),
      description?.trim() || "",
      Number(price),
      category || "variety",
      imageUrl,
      stock !== undefined && stock !== "" ? Number(stock) : -1,
      showStock === "1" || showStock === true || showStock === 1 ? 1 : 0,
      showPurchases !== "0" && showPurchases !== false && showPurchases !== 0 ? 1 : 0,
      offerActive === "1" || offerActive === true || offerActive === 1 ? 1 : 0,
      offerPrice !== undefined && offerPrice !== "" ? Number(offerPrice) : null,
      offerLabel || "",
      digitalFile
    );

  res.json({ id: result.lastInsertRowid });
});

function updateProduct(req, res) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "No encontrado" });

  const { name, description, price, category, stock, showStock, showPurchases, offerActive, offerPrice, offerLabel, active } =
    req.body;

  let imageUrl = product.image_url;
  let digitalFile = product.digital_file;
  if (req.files?.image?.[0]) imageUrl = `/uploads/${req.files.image[0].filename}`;
  if (req.files?.digitalFile?.[0]) digitalFile = req.files.digitalFile[0].filename;

  db.prepare(
    `UPDATE products SET name=?, description=?, price=?, category=?, image_url=?, stock=?,
     show_stock=?, show_purchases=?, offer_active=?, offer_price=?, offer_label=?, digital_file=?, active=?
     WHERE id=?`
  ).run(
    name?.trim() || product.name,
    description?.trim() ?? product.description,
    price !== undefined && price !== "" ? Number(price) : product.price,
    category || product.category,
    imageUrl,
    stock !== undefined && stock !== "" ? Number(stock) : product.stock,
    showStock === "1" || showStock === true || showStock === 1 ? 1 : showStock === "0" || showStock === false || showStock === 0 ? 0 : product.show_stock,
    showPurchases === "1" || showPurchases === true || showPurchases === 1 ? 1 : showPurchases === "0" || showPurchases === false || showPurchases === 0 ? 0 : product.show_purchases,
    offerActive === "1" || offerActive === true || offerActive === 1 ? 1 : offerActive === "0" || offerActive === false || offerActive === 0 ? 0 : product.offer_active,
    offerPrice !== undefined && offerPrice !== "" ? Number(offerPrice) : product.offer_price,
    offerLabel ?? product.offer_label,
    digitalFile,
    active !== undefined ? (active === "1" || active === true || active === 1 ? 1 : 0) : product.active,
    req.params.id
  );

  res.json({ ok: true });
}

router.put("/products/:id", authMiddleware, productUpload, updateProduct);
router.post("/products/:id", authMiddleware, productUpload, updateProduct);

router.delete("/products/:id", authMiddleware, (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "No encontrado" });

  db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/orders", authMiddleware, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").all();
  res.json(orders);
});

router.post("/orders/:id/approve", authMiddleware, async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "No encontrado" });
  await markOrderPaid(order.id);
  res.json({ ok: true, status: "paid" });
});

router.delete("/orders/:id", authMiddleware, (req, res) => {
  db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/reviews", authMiddleware, (req, res) => {
  const reviews = db.prepare("SELECT * FROM reviews ORDER BY created_at DESC").all();
  res.json(reviews);
});

router.put("/reviews/:id", authMiddleware, (req, res) => {
  const { approved } = req.body;
  db.prepare("UPDATE reviews SET approved = ? WHERE id = ?").run(approved ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
