const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendOrderConfirmation(order, items, downloadUrl) {
  const from = process.env.EMAIL_FROM || "Cludy Shop <noreply@cludyshop.com>";
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const trackUrl = `${baseUrl}/track.html?code=${order.order_code}`;

  const itemsHtml = items
    .map((i) => `<li>${i.product_name} × ${i.qty} — €${i.price.toFixed(2)}</li>`)
    .join("");

  const textDeliveries = items.filter((i) => (i.delivery_type || "file") === "text" && i.delivery_text);
  const textHtml = textDeliveries.length
    ? `<h3 style="color:#fff;">Contenido de entrega</h3>${textDeliveries
        .map(
          (i) =>
            `<div style="background:#0a0a0f;padding:16px;border-radius:8px;margin:12px 0;"><strong style="color:#fff;">${i.product_name}</strong><pre style="white-space:pre-wrap;color:#9898a8;margin:8px 0 0;">${i.delivery_text}</pre></div>`
        )
        .join("")}`
    : "";

  const hasFiles = items.some((i) => (i.delivery_type || "file") !== "text" && i.digital_file);
  const downloadLabel = hasFiles && textDeliveries.length ? "Ver entrega completa" : hasFiles ? "Descargar archivos" : "Ver tu entrega";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#e8e8ed;padding:32px;border-radius:12px;">
      <h1 style="color:#1a7fff;margin:0 0 8px;">¡Pedido confirmado!</h1>
      <p style="color:#9898a8;">Hola ${order.customer_name}, tu pedido digital está listo.</p>
      <div style="background:#111118;padding:20px;border-radius:8px;margin:20px 0;">
        <p><strong>Código:</strong> ${order.order_code}</p>
        <p><strong>Total:</strong> €${order.total.toFixed(2)}</p>
        <p><strong>Método:</strong> ${order.payment_method}</p>
      </div>
      <h3 style="color:#fff;">Productos</h3>
      <ul style="color:#9898a8;">${itemsHtml}</ul>
      ${textHtml}
      <a href="${downloadUrl}" style="display:inline-block;background:#0052FF;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">${downloadLabel}</a>
      <p style="color:#9898a8;font-size:14px;">También puedes seguir tu pedido en: <a href="${trackUrl}" style="color:#1a7fff;">${trackUrl}</a></p>
      <p style="color:#5a5a6e;font-size:12px;margin-top:32px;">Cludy Shop — Productos digitales instantáneos</p>
    </div>`;

  const mail = {
    from,
    to: order.customer_email,
    subject: `Pedido ${order.order_code} confirmado — Cludy Shop`,
    html,
  };

  const transport = getTransporter();
  if (transport) {
    await transport.sendMail(mail);
    return true;
  }

  console.log("\n📧 Email (SMTP no configurado — simulado):");
  console.log(`   Para: ${order.customer_email}`);
  console.log(`   Asunto: ${mail.subject}`);
  console.log(`   Descarga: ${downloadUrl}\n`);
  return false;
}

module.exports = { sendOrderConfirmation };
