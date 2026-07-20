(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const STATUS_LABELS = {
    pending: { text: "Pendiente de pago", color: "#ffd700" },
    pending_verification: { text: "Verificando pago", color: "#1a7fff" },
    paid: { text: "Entregado ✓", color: "#2ed573" },
  };

  function showToast(msg, type = "success") {
    const toast = $("#toast");
    toast.textContent = msg;
    toast.className = "toast show " + type;
    setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function formatPrice(n) {
    return "€" + Number(n).toFixed(2);
  }

  function renderTimeline(order) {
    const steps = [
      { label: "Pedido creado", done: true, date: order.createdAt },
      { label: "Pago recibido", done: ["pending_verification", "paid"].includes(order.paymentStatus), date: order.paidAt },
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

  async function trackOrder(code) {
    const resultEl = $("#trackResult");
    const errorEl = $("#trackError");
    resultEl.classList.add("hidden");
    errorEl.classList.add("hidden");

    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(code)}`);
      const order = await res.json();
      if (!res.ok) throw new Error(order.error);

      const status = STATUS_LABELS[order.paymentStatus] || STATUS_LABELS.pending;

      $("#resultCode").textContent = order.orderCode;
      $("#resultStatus").textContent = status.text;
      $("#resultStatus").style.background = status.color;
      $("#resultTimeline").innerHTML = renderTimeline(order);
      $("#resultItems").innerHTML = `<strong>Productos digitales:</strong><ul style="margin-top:8px;padding-left:20px;">${order.items.map((i) => `<li>${i.name} × ${i.qty}</li>`).join("")}</ul>`;
      $("#resultTotal").textContent = formatPrice(order.total);
      $("#resultMethod").textContent = order.paymentMethod;

      const actions = $("#resultActions");
      actions.innerHTML = "";

      if (order.downloadAvailable && order.downloadUrl) {
        const dl = document.createElement("a");
        dl.href = order.downloadUrl;
        dl.className = "btn btn-primary";
        dl.textContent = "Descargar archivos";
        dl.target = "_blank";
        actions.appendChild(dl);
      }

      if (order.paymentStatus === "pending" && order.paymentMethod === "litecoin") {
        const ltcDiv = $("#resultLtc");
        ltcDiv.classList.remove("hidden");
        ltcDiv.innerHTML = `
          <p><strong>Pago LTC pendiente</strong></p>
          <p style="font-size:0.9rem;margin:8px 0;">Envía a: <code style="color:var(--blue-bright);">${order.ltcWallet}</code></p>
          <input type="text" id="txHashInput" placeholder="Hash de transacción" style="width:100%;padding:10px;margin:8px 0;background:var(--black-card);border:1px solid rgba(0,82,255,0.2);border-radius:8px;color:#fff;">
          <button class="btn btn-sm btn-primary" id="submitTx">Confirmar TX</button>`;
        ltcDiv.querySelector("#submitTx").addEventListener("click", async () => {
          const txHash = ltcDiv.querySelector("#txHashInput").value.trim();
          if (!txHash) return showToast("Introduce el hash", "warning");
          const r = await fetch(`/api/orders/${order.orderCode}/confirm-ltc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash }),
          });
          const d = await r.json();
          if (r.ok) {
            showToast("Transacción registrada");
            trackOrder(order.orderCode);
          } else showToast(d.error, "warning");
        });
      } else {
        $("#resultLtc").classList.add("hidden");
      }

      if (order.paymentStatus === "paid" && !order.reviewSubmitted) {
        const review = document.createElement("a");
        review.href = `/?review=${order.orderCode}`;
        review.className = "btn btn-outline";
        review.textContent = "Dejar reseña";
        actions.appendChild(review);
      }

      resultEl.classList.remove("hidden");

      if (order.paymentMethod === "stripe" && order.paymentStatus === "pending") {
        fetch(`/api/orders/stripe/verify/${order.orderCode}`).then(() => trackOrder(code));
      }
    } catch (err) {
      errorEl.textContent = err.message || "Pedido no encontrado";
      errorEl.classList.remove("hidden");
    }
  }

  $("#trackForm").addEventListener("submit", (e) => {
    e.preventDefault();
    trackOrder($("#trackCode").value.trim().toUpperCase());
  });

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    $("#trackCode").value = code;
    trackOrder(code.toUpperCase());
    if (params.get("paid") === "1") showToast("¡Pago completado! Tus archivos están listos.");
  }
})();
