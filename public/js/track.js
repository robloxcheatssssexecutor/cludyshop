(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const STATUS_LABELS = {
    pending: { text: "Pendiente de pago", color: "#ffd700" },
    pending_verification: { text: "Verificando pago", color: "#1a7fff" },
    paid: { text: "Entregado ✓", color: "#2ed573" },
  };

  let pollTimer = null;
  let currentCode = null;

  function showToast(msg, type = "success") {
    const toast = $("#toast");
    toast.textContent = msg;
    toast.className = "toast show " + type;
    setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function formatPrice(n) {
    return "€" + Number(n).toFixed(2);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling(code) {
    stopPolling();
    currentCode = code;
    pollTimer = setInterval(() => trackOrder(code, true), 15000);
  }

  function renderTimeline(order) {
    const steps = [
      { label: "Pedido creado", done: true, date: order.createdAt },
      {
        label: order.paymentMethod === "litecoin" && order.paymentStatus !== "paid"
          ? "Pago detectado en blockchain"
          : "Pago recibido",
        done: ["pending_verification", "paid"].includes(order.paymentStatus),
        date: order.paidAt,
      },
      { label: "Archivos listos", done: order.paymentStatus === "paid", date: order.deliveredAt },
    ];

    return steps
      .map(
        (s, i) => `
      <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;">
        <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;
          background:${s.done ? "var(--blue-strong)" : "var(--black-elevated)"};color:${s.done ? "#fff" : "var(--gray-500)"};border:2px solid ${s.done ? "var(--blue-strong)" : "rgba(0,82,255,0.2)"};">${s.done ? "✓" : i + 1}</div>
        <div><strong style="color:${s.done ? "var(--white)" : "var(--gray-500)"};">${s.label}</strong>
        ${s.date ? `<div style="font-size:0.8rem;color:var(--gray-500);">${new Date(s.date).toLocaleString("es-ES")}</div>` : ""}</div>
      </div>`
      )
      .join("");
  }

  function renderLtcWaiting(order) {
    const ltcDiv = $("#resultLtc");
    ltcDiv.classList.remove("hidden");

    if (order.paymentStatus === "paid") {
      ltcDiv.classList.add("hidden");
      return;
    }

    if (order.paymentStatus === "pending_verification") {
      ltcDiv.innerHTML = `
        <div class="ltc-waiting">
          <div class="ltc-waiting-spinner" aria-hidden="true"></div>
          <h3>Esperando confirmación en blockchain</h3>
          <p>Hemos recibido tu aviso. La web busca automáticamente un pago de <strong>${Number(order.ltcAmount).toFixed(6)} LTC</strong> a nuestra wallet.</p>
          ${order.ltcTxHash ? `<p class="ltc-waiting-tx">TX detectada: <code>${order.ltcTxHash.slice(0, 16)}…</code></p>` : `<p class="ltc-waiting-tx">Aún no detectamos la transacción. Puede tardar 1-3 minutos.</p>`}
          <p class="ltc-waiting-note">Esta página se actualiza sola. Cuando la red confirme el pago, tus archivos aparecerán aquí.</p>
        </div>`;
      startPolling(order.orderCode);
      return;
    }

    ltcDiv.innerHTML = `
      <div class="ltc-pay-box">
        <p><strong>Pago LTC pendiente</strong></p>
        <p>Envía exactamente <strong style="color:var(--blue-bright);">${Number(order.ltcAmount).toFixed(6)} LTC</strong></p>
        <p style="font-size:0.9rem;margin:8px 0;">Dirección: <code style="color:var(--blue-bright);word-break:break-all;">${order.ltcWallet}</code></p>
        <button class="btn btn-sm btn-primary" id="submitLtcSent">Ya envié el pago</button>
      </div>`;

    ltcDiv.querySelector("#submitLtcSent").addEventListener("click", async () => {
      const btn = ltcDiv.querySelector("#submitLtcSent");
      btn.disabled = true;
      btn.textContent = "Comprobando...";
      try {
        const r = await fetch(`/api/orders/${order.orderCode}/confirm-ltc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const d = await r.json();
        if (r.ok) {
          showToast("Buscando tu pago en la blockchain...");
          if (d.trackUrl) history.replaceState(null, "", d.trackUrl);
          trackOrder(order.orderCode);
        } else {
          showToast(d.error || "Error", "warning");
          btn.disabled = false;
          btn.textContent = "Ya envié el pago";
        }
      } catch {
        showToast("Error de conexión", "warning");
        btn.disabled = false;
        btn.textContent = "Ya envié el pago";
      }
    });
  }

  async function trackOrder(code, silent = false) {
    const resultEl = $("#trackResult");
    const errorEl = $("#trackError");
    resultEl.classList.add("hidden");
    errorEl.classList.add("hidden");

    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(code)}`);
      const order = await res.json();
      if (!res.ok) throw new Error(order.error);

      const status = STATUS_LABELS[order.paymentStatus] || STATUS_LABELS.pending;
      const wasPaid = resultEl.dataset.paid === "1";

      $("#resultCode").textContent = order.orderCode;
      $("#resultStatus").textContent = status.text;
      $("#resultStatus").style.background = status.color;
      $("#resultTimeline").innerHTML = renderTimeline(order);
      $("#resultItems").innerHTML = `<strong>Productos digitales:</strong><ul style="margin-top:8px;padding-left:20px;">${order.items.map((i) => `<li>${i.name} × ${i.qty} — ${formatPrice(i.price * i.qty)}</li>`).join("")}</ul>`;
      $("#resultTotal").textContent = formatPrice(order.total);
      $("#resultMethod").textContent = order.paymentMethod;

      const actions = $("#resultActions");
      actions.innerHTML = "";

      if (order.downloadAvailable && order.downloadUrl) {
        stopPolling();
        const dl = document.createElement("a");
        dl.href = order.downloadUrl;
        dl.className = "btn btn-primary";
        dl.textContent = "Descargar archivos";
        dl.target = "_blank";
        actions.appendChild(dl);
        if (!wasPaid && !silent) showToast("¡Pago confirmado! Tus archivos están listos.");
      }

      if (order.paymentMethod === "litecoin" && order.paymentStatus !== "paid") {
        renderLtcWaiting(order);
      } else {
        $("#resultLtc").classList.add("hidden");
        if (order.paymentStatus === "paid") stopPolling();
      }

      if (order.paymentStatus === "paid" && !order.reviewSubmitted) {
        const review = document.createElement("a");
        review.href = `/?review=${order.orderCode}`;
        review.className = "btn btn-outline";
        review.textContent = "Dejar reseña";
        actions.appendChild(review);
      }

      resultEl.dataset.paid = order.paymentStatus === "paid" ? "1" : "0";
      resultEl.classList.remove("hidden");

      if (order.paymentMethod === "stripe" && order.paymentStatus === "pending") {
        fetch(`/api/orders/stripe/verify/${order.orderCode}`).then(() => trackOrder(code, true));
      }
    } catch (err) {
      stopPolling();
      errorEl.textContent = err.message || "Pedido no encontrado";
      errorEl.classList.remove("hidden");
    }
  }

  $("#trackForm").addEventListener("submit", (e) => {
    e.preventDefault();
    stopPolling();
    trackOrder($("#trackCode").value.trim().toUpperCase());
  });

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    $("#trackCode").value = code;
    trackOrder(code.toUpperCase());
    if (params.get("paid") === "1") showToast("¡Pago completado! Tus archivos están listos.");
    if (params.get("waiting") === "1") showToast("Buscando tu pago LTC en la blockchain...");
  }

  window.addEventListener("beforeunload", stopPolling);
})();
