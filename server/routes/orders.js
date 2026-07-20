const express = require("express");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const Stripe = require("stripe");
const { db, generateOrderCode } = require("../db");
const { sendOrderConfirmation } = require("../services/email");

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function getBaseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function getEffectivePrice(product) {
  return product.offer_active && product.offer_price != null ? product.offer_price : product.price;
}

function createOrderItems(orderId, cartItems) {
  const insert = db.prepare(
    "INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)"
  );
  for (const item of cartItems) {
    insert.run(orderId, item.productId, item.name, item.price, item.qty);
  }
}

async function markOrderPaid(orderId) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order || order.payment_status === "paid") return order;

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE orders SET payment_status = 'paid', paid_at = ?, delivered_at = ? WHERE id = ?"
  ).run(now, now, orderId);

  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);
  for (const item of items) {
    db.prepare("UPDATE products SET purchase_count = purchase_count + ?, stock = CASE WHEN stock = -1 THEN -1 ELSE MAX(0, stock - ?) END WHERE id = ?").run(
      item.qty,
      item.qty,
      item.product_id
    );
  }

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const downloadUrl = `${baseUrl}/api/orders/download/${updated.download_token}`;
  await sendOrderConfirmation(updated, items, downloadUrl);
  return updated;
}

router.post("/create", async (req, res) => {
  try {
    const { customerName, customerEmail, paymentMethod, items } = req.body;

    if (!customerName?.trim() || !customerEmail?.trim() || !paymentMethod || !items?.length) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const cartItems = [];
    let total = 0;

    for (const item of items) {
      const product = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(item.id);
      if (!product) return res.status(400).json({ error: `Producto ${item.id} no encontrado` });
      if (product.stock !== -1 && product.stock < (item.qty || 1)) {
        return res.status(400).json({ error: `${product.name} sin stock suficiente` });
      }
      const price = getEffectivePrice(product);
      const qty = item.qty || 1;
      cartItems.push({ productId: product.id, name: product.name, price, qty });
      total += price * qty;
    }

    const orderCode = generateOrderCode();
    const downloadToken = uuidv4();
    const result = db
      .prepare(
        `INSERT INTO orders (order_code, customer_name, customer_email, payment_method, total, download_token)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(orderCode, customerName.trim(), customerEmail.trim(), paymentMethod, total, downloadToken);

    createOrderItems(result.lastInsertRowid, cartItems);

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(result.lastInsertRowid);
    const baseUrl = getBaseUrl(req);

    if (paymentMethod === "stripe") {
      if (!stripe) return res.status(500).json({ error: "Stripe no configurado" });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: customerEmail.trim(),
        line_items: cartItems.map((item) => ({
          price_data: {
            currency: "eur",
            product_data: { name: item.name },
            unit_amount: Math.round(item.price * 100),
          },
          quantity: item.qty,
        })),
        metadata: { orderId: String(order.id), orderCode },
        success_url: `${baseUrl}/track.html?code=${orderCode}&paid=1`,
        cancel_url: `${baseUrl}/?cancelled=1`,
      });

      db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(session.id, order.id);

      return res.json({
        orderCode,
        paymentMethod: "stripe",
        stripeUrl: session.url,
        total,
      });
    }

    if (paymentMethod === "litecoin") {
      return res.json({
        orderCode,
        paymentMethod: "litecoin",
        total,
        ltcWallet: process.env.LTC_WALLET_ADDRESS,
        ltcAmount: (total / 80).toFixed(6),
        trackUrl: `${baseUrl}/track.html?code=${orderCode}`,
      });
    }

    if (paymentMethod === "paypal") {
      return res.json({
        orderCode,
        paymentMethod: "paypal",
        total,
        paypalEmail: process.env.PAYPAL_EMAIL,
        paypalNote: `Pedido ${orderCode} — NO marcar "bienes y servicios"`,
        trackUrl: `${baseUrl}/track.html?code=${orderCode}`,
      });
    }

    res.status(400).json({ error: "Método de pago no válido" });
  } catch (err) {
    console.error("Order create error:", err);
    res.status(500).json({ error: "Error al crear el pedido" });
  }
});

router.post("/:code/confirm-ltc", (req, res) => {
  const { txHash } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(req.params.code);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  if (order.payment_method !== "litecoin") return res.status(400).json({ error: "No es un pedido LTC" });
  if (!txHash?.trim()) return res.status(400).json({ error: "Hash de transacción requerido" });

  db.prepare("UPDATE orders SET ltc_tx_hash = ?, payment_status = 'pending_verification' WHERE id = ?").run(
    txHash.trim(),
    order.id
  );

  res.json({ message: "Transacción registrada. Verificaremos el pago en breve.", status: "pending_verification" });
});

router.post("/:code/confirm-paypal", (req, res) => {
  const { note } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(req.params.code);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  if (order.payment_method !== "paypal") return res.status(400).json({ error: "No es un pedido PayPal" });

  db.prepare("UPDATE orders SET paypal_note = ?, payment_status = 'pending_verification' WHERE id = ?").run(
    note?.trim() || `Pedido ${order.order_code}`,
    order.id
  );

  res.json({ message: "Pago registrado. Verificaremos en breve.", status: "pending_verification" });
});

router.get("/track/:code", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(req.params.code);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });

  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
  const baseUrl = getBaseUrl(req);

  res.json({
    orderCode: order.order_code,
    customerName: order.customer_name,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    total: order.total,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    deliveredAt: order.delivered_at,
    reviewSubmitted: !!order.review_submitted,
    items: items.map((i) => ({ name: i.product_name, price: i.price, qty: i.qty })),
    downloadAvailable: order.payment_status === "paid",
    downloadUrl: order.payment_status === "paid" ? `${baseUrl}/api/orders/download/${order.download_token}` : null,
    ltcWallet: order.payment_method === "litecoin" ? process.env.LTC_WALLET_ADDRESS : null,
    ltcTxHash: order.ltc_tx_hash,
    paypalEmail: order.payment_method === "paypal" ? process.env.PAYPAL_EMAIL : null,
  });
});

router.get("/download/:token", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE download_token = ?").get(req.params.token);
  if (!order) return res.status(404).json({ error: "Enlace no válido" });
  if (order.payment_status !== "paid") return res.status(403).json({ error: "Pago pendiente" });

  const items = db.prepare(
    `SELECT oi.*, p.digital_file, p.name as prod_name
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`
  ).all(order.id);

  const files = items.filter((i) => i.digital_file).map((i) => ({
    name: i.prod_name,
    file: i.digital_file,
  }));

  if (files.length === 1) {
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads");
    const filePath = path.join(uploadDir, files[0].file);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, files[0].file);
    }
  }

  res.json({
    orderCode: order.order_code,
    message: "Tus archivos digitales",
    files: files.map((f) => ({
      name: f.name,
      url: `/uploads/${f.file}`,
    })),
    note: files.length === 0 ? "Los archivos se entregarán por email. Contacta soporte en Discord si no los recibes." : null,
  });
});

router.post("/stripe/webhook", async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe not configured");

  let event;
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) await markOrderPaid(Number(orderId));
  }

  res.json({ received: true });
});

router.get("/stripe/verify/:code", async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(req.params.code);
  if (!order?.stripe_session_id || !stripe) return res.status(404).json({ error: "No encontrado" });

  try {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    if (session.payment_status === "paid" && order.payment_status !== "paid") {
      await markOrderPaid(order.id);
    }
    const updated = db.prepare("SELECT payment_status FROM orders WHERE id = ?").get(order.id);
    res.json({ status: updated.payment_status });
  } catch {
    res.status(500).json({ error: "Error verificando pago" });
  }
});

module.exports = router;
module.exports.markOrderPaid = markOrderPaid;
