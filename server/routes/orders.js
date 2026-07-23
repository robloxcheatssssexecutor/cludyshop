const express = require("express");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const Stripe = require("stripe");
const { db, generateOrderCode } = require("../db");
const { uploadDir } = require("../paths");
const { sendOrderConfirmation } = require("../services/email");
const { notifyOrderCreated, notifyPurchaseCompleted } = require("../services/discord");
const { deactivateExpiredOffers, getEffectivePrice } = require("../services/product-offers");
const { calculateLtcAmount, checkOrderPayment } = require("../services/ltc-watcher");

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function getBaseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "";
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

  const itemsWithDelivery = db
    .prepare(
      `SELECT oi.*, p.delivery_type, p.delivery_text, p.digital_file
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`
    )
    .all(orderId);

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const downloadUrl = `${baseUrl}/api/orders/download/${updated.download_token}`;
  await sendOrderConfirmation(updated, itemsWithDelivery, downloadUrl);
  await notifyPurchaseCompleted(updated, itemsWithDelivery);
  return updated;
}

router.post("/create", async (req, res) => {
  try {
    deactivateExpiredOffers(db);
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
    const customerIp = getClientIp(req);
    const result = db
      .prepare(
        `INSERT INTO orders (order_code, customer_name, customer_email, payment_method, total, download_token, customer_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(orderCode, customerName.trim(), customerEmail.trim(), paymentMethod, total, downloadToken, customerIp);

    createOrderItems(result.lastInsertRowid, cartItems);

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(result.lastInsertRowid);
    const baseUrl = getBaseUrl(req);

    notifyOrderCreated(order, cartItems).catch((err) =>
      console.error("Discord order notification error:", err.message)
    );

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
      const ltcAmount = calculateLtcAmount(total, order.id);
      db.prepare("UPDATE orders SET ltc_amount = ? WHERE id = ?").run(ltcAmount, order.id);

      return res.json({
        orderCode,
        paymentMethod: "litecoin",
        total,
        ltcWallet: process.env.LTC_WALLET_ADDRESS,
        ltcAmount: ltcAmount.toFixed(6),
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

router.post("/:code/confirm-ltc", async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(req.params.code);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  if (order.payment_method !== "litecoin") return res.status(400).json({ error: "No es un pedido LTC" });
  if (order.payment_status === "paid") {
    return res.json({
      message: "Pago ya confirmado",
      status: "paid",
      trackUrl: `${getBaseUrl(req)}/track.html?code=${order.order_code}`,
    });
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE orders SET payment_status = 'pending_verification', ltc_watch_started_at = ? WHERE id = ?"
  ).run(now, order.id);

  checkOrderPayment(order.id, markOrderPaid).catch((err) =>
    console.error("LTC immediate check error:", err.message)
  );

  res.json({
    message: "Buscando tu pago en la blockchain. Te avisaremos cuando se confirme.",
    status: "pending_verification",
    trackUrl: `${getBaseUrl(req)}/track.html?code=${order.order_code}&waiting=1`,
  });
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

  let deliveries = null;
  if (order.payment_status === "paid") {
    deliveries = db
      .prepare(
        `SELECT oi.product_name, p.delivery_type, p.digital_file, p.delivery_text
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`
      )
      .all(order.id)
      .map((item) => ({
        name: item.product_name,
        type: item.delivery_type || "file",
        fileUrl: item.digital_file ? `/uploads/${item.digital_file}` : null,
        text: item.delivery_text || null,
      }));
  }

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
    deliveries,
    downloadAvailable: order.payment_status === "paid",
    downloadUrl: order.payment_status === "paid" ? `${baseUrl}/api/orders/download/${order.download_token}` : null,
    ltcWallet: order.payment_method === "litecoin" ? process.env.LTC_WALLET_ADDRESS : null,
    ltcAmount: order.payment_method === "litecoin" ? order.ltc_amount : null,
    ltcTxHash: order.ltc_tx_hash,
    ltcWatchStarted: !!order.ltc_watch_started_at,
    paypalEmail: order.payment_method === "paypal" ? process.env.PAYPAL_EMAIL : null,
  });
});

router.get("/download/:token", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE download_token = ?").get(req.params.token);
  if (!order) return res.status(404).json({ error: "Enlace no válido" });
  if (order.payment_status !== "paid") return res.status(403).json({ error: "Pago pendiente" });

  const items = db.prepare(
    `SELECT oi.*, p.digital_file, p.delivery_type, p.delivery_text, p.name as prod_name
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`
  ).all(order.id);

  const deliveries = items.map((item) => ({
    name: item.prod_name,
    type: item.delivery_type || "file",
    file: item.digital_file,
    text: item.delivery_text,
  }));

  const files = deliveries.filter((item) => item.type !== "text" && item.file);
  const texts = deliveries.filter((item) => item.type === "text" && item.text);

  if (files.length === 1 && texts.length === 0) {
    const filePath = path.join(uploadDir, files[0].file);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, files[0].file);
    }
  }

  if (files.length === 0 && texts.length === 1) {
    res.type("html");
    return res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrega — ${order.order_code}</title>
<style>body{font-family:sans-serif;background:#0a0a0f;color:#e8e8ed;max-width:640px;margin:40px auto;padding:24px}
.box{background:#111118;border:1px solid rgba(0,82,255,0.2);border-radius:12px;padding:24px}
h1{color:#1a7fff;font-size:1.25rem}pre{white-space:pre-wrap;word-break:break-word;background:#0a0a0f;padding:16px;border-radius:8px;margin-top:16px}</style></head>
<body><div class="box"><h1>${texts[0].name}</h1><pre>${texts[0].text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></div></body></html>`);
  }

  res.json({
    orderCode: order.order_code,
    message: "Tu contenido digital",
    files: files.map((item) => ({
      name: item.name,
      url: `/uploads/${item.file}`,
    })),
    texts: texts.map((item) => ({
      name: item.name,
      content: item.text,
    })),
    note: files.length === 0 && texts.length === 0 ? "No hay contenido de entrega configurado. Contacta soporte en Discord." : null,
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
