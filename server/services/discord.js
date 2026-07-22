const PAYMENT_LABELS = {
  stripe: "💳 Tarjeta (Stripe)",
  litecoin: "🪙 Litecoin",
  paypal: "🅿️ PayPal",
};

function formatMoney(amount) {
  return `€${Number(amount).toFixed(2)}`;
}

function formatItems(items) {
  return items
    .map((item) => {
      const name = item.product_name || item.name;
      const qty = item.qty || 1;
      const price = item.price ?? 0;
      return `• **${name}** × ${qty} — ${formatMoney(price * qty)}`;
    })
    .join("\n");
}

function paymentLabel(method) {
  return PAYMENT_LABELS[method] || method;
}

async function sendWebhook(url, payload) {
  if (!url) return false;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`Discord webhook error (${res.status}):`, text.slice(0, 200));
      return false;
    }

    return true;
  } catch (err) {
    console.error("Discord webhook failed:", err.message);
    return false;
  }
}

async function notifyOrderCreated(order, items) {
  const url = process.env.DISCORD_WEBHOOK_ORDER;
  if (!url) return false;

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const trackUrl = `${baseUrl}/track.html?code=${order.order_code}`;
  const total = formatMoney(order.total);

  return sendWebhook(url, {
    content: `# 🛒 Nueva orden — ${total}`,
    embeds: [
      {
        title: order.order_code,
        color: 0x5865f2,
        fields: [
          { name: "👤 Cliente", value: order.customer_name, inline: true },
          { name: "📧 Email", value: order.customer_email, inline: true },
          { name: "💳 Método de pago", value: paymentLabel(order.payment_method), inline: true },
          { name: "📦 Productos", value: formatItems(items) || "—" },
          { name: "💰 Total", value: `**${total}**`, inline: true },
          { name: "📋 Estado", value: "⏳ Pendiente de pago", inline: true },
          { name: "🔗 Seguimiento", value: trackUrl },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Cludy Shop — Nueva orden" },
      },
    ],
  });
}

async function notifyPurchaseCompleted(order, items) {
  const url = process.env.DISCORD_WEBHOOK_PURCHASE;
  if (!url) return false;

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const trackUrl = `${baseUrl}/track.html?code=${order.order_code}`;
  const total = formatMoney(order.total);

  return sendWebhook(url, {
    content: `# 💰 COMPRA CONFIRMADA — ${total}`,
    embeds: [
      {
        title: `✅ ${order.order_code}`,
        color: 0x57f287,
        fields: [
          { name: "👤 Cliente", value: order.customer_name, inline: true },
          { name: "📧 Email", value: order.customer_email, inline: true },
          { name: "💳 Método de pago", value: paymentLabel(order.payment_method), inline: true },
          { name: "📦 Productos", value: formatItems(items) || "—" },
          { name: "💵 Importe", value: `## ${total}`, inline: false },
          { name: "🔗 Seguimiento", value: trackUrl },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Cludy Shop — Compra completada" },
      },
    ],
  });
}

module.exports = { notifyOrderCreated, notifyPurchaseCompleted };
