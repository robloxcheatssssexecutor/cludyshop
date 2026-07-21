(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let products = [];
  let editingId = null;
  let imagePreviewUrl = null;

  function showToast(msg, type = "success") {
    const toast = $("#toast");
    toast.textContent = msg;
    toast.className = "toast show " + type;
    setTimeout(() => toast.classList.remove("show"), 4000);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function formatPrice(n) {
    return "€" + Number(n).toFixed(2);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: "include",
      ...opts,
      headers: {
        ...(opts.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...opts.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.includes("/login")) {
      showLogin();
      throw new Error("Sesión expirada");
    }
    if (!res.ok) throw new Error(data.error || "Error de servidor");
    return data;
  }

  function showLogin() {
    $("#loginScreen").classList.remove("hidden");
    $("#adminApp").classList.add("hidden");
  }

  function showApp(user) {
    $("#loginScreen").classList.add("hidden");
    $("#adminApp").classList.remove("hidden");
    $("#adminUserLabel").textContent = user;
  }

  function switchTab(tab) {
    $$(".admin-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".admin-tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${tab}`));
    if (tab === "dashboard") loadStats();
    if (tab === "products") loadProducts();
    if (tab === "orders") loadOrders();
    if (tab === "reviews") loadReviews();
  }

  async function loadStats() {
    const stats = await api("/api/admin/stats");
    $("#statsGrid").innerHTML = `
      <div class="admin-stat-card"><span class="admin-stat-value">${stats.products}</span><span class="admin-stat-label">Productos activos</span></div>
      <div class="admin-stat-card"><span class="admin-stat-value">${stats.orders}</span><span class="admin-stat-label">Pedidos totales</span></div>
      <div class="admin-stat-card"><span class="admin-stat-value">${formatPrice(stats.revenue)}</span><span class="admin-stat-label">Ingresos</span></div>
      <div class="admin-stat-card warn"><span class="admin-stat-value">${stats.pending}</span><span class="admin-stat-label">Pagos pendientes</span></div>`;
  }

  function stockLabel(stock) {
    if (stock === -1) return "Ilimitado";
    return String(stock);
  }

  function visibilityBadges(p) {
    const badges = [];
    if (p.show_stock) badges.push('<span class="admin-badge blue">Stock visible</span>');
    if (p.show_purchases) badges.push('<span class="admin-badge green">Ventas visibles</span>');
    if (p.offer_active) badges.push('<span class="admin-badge gold">Oferta</span>');
    return badges.join(" ") || '<span class="admin-muted">—</span>';
  }

  async function loadProducts() {
    products = await api("/api/admin/products");
    const tbody = $("#productsBody");
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">No hay productos</td></tr>';
      return;
    }

    tbody.innerHTML = products
      .map(
        (p) => `
      <tr class="${p.active ? "" : "inactive"}">
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.image_url ? `<br><small class="admin-muted">Con imagen</small>` : ""}
        </td>
        <td>${escapeHtml(p.category)}</td>
        <td>
          ${p.offer_active && p.offer_price != null
            ? `<s class="admin-muted">${formatPrice(p.price)}</s> ${formatPrice(p.offer_price)}`
            : formatPrice(p.price)}
        </td>
        <td>${stockLabel(p.stock)}</td>
        <td>${p.purchase_count}</td>
        <td>${visibilityBadges(p)}</td>
        <td>${p.active ? '<span class="admin-badge green">Activo</span>' : '<span class="admin-badge red">Oculto</span>'}</td>
        <td class="admin-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit="${p.id}">Editar</button>
          <button type="button" class="btn btn-sm btn-danger" data-delete="${p.id}">Ocultar</button>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openProductModal(Number(btn.dataset.edit)));
    });
    tbody.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteProduct(Number(btn.dataset.delete)));
    });
  }

  function productIdMatch(a, b) {
    return Number(a) === Number(b);
  }

  function readProductForm() {
    return {
      name: $("#productName").value.trim(),
      description: $("#productDesc").value.trim(),
      price: $("#productPrice").value,
      category: $("#productCategory").value,
      stock: $("#productStock").value,
      showStock: $("#productShowStock").checked,
      showPurchases: $("#productShowPurchases").checked,
      offerActive: $("#productOfferActive").checked,
      offerPrice: $("#productOfferPrice").value,
      offerLabel: $("#productOfferLabel").value.trim(),
      active: $("#productActive").checked,
    };
  }

  function buildProductFormData(data) {
    const fd = new FormData();
    fd.append("name", data.name);
    fd.append("description", data.description);
    fd.append("price", data.price);
    fd.append("category", data.category);
    fd.append("stock", data.stock);
    fd.append("showStock", data.showStock ? "1" : "0");
    fd.append("showPurchases", data.showPurchases ? "1" : "0");
    fd.append("offerActive", data.offerActive ? "1" : "0");
    fd.append("offerPrice", data.offerPrice);
    fd.append("offerLabel", data.offerLabel);
    if (editingId) fd.append("active", data.active ? "1" : "0");

    const image = $("#productImage").files[0];
    const digital = $("#productDigitalFile").files[0];
    if (image) fd.append("image", image);
    if (digital) fd.append("digitalFile", digital);
    return fd;
  }

  function updateImagePreview(src) {
    const preview = $("#productImagePreview");
    const img = $("#productImagePreviewImg");
    if (src) {
      img.src = src;
      preview.classList.remove("hidden");
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
    img.removeAttribute("src");
    preview.classList.add("hidden");
  }

  function openProductModal(id = null) {
    editingId = id;
    const form = $("#productForm");
    form.reset();
    updateImagePreview(null);
    $("#productModalTitle").textContent = id ? "Editar producto" : "Nuevo producto";
    $("#productActiveWrap").classList.toggle("hidden", !id);
    $("#currentImageHint").classList.add("hidden");
    $("#currentFileHint").classList.add("hidden");
    $("#productShowPurchases").checked = true;

    if (id) {
      const p = products.find((x) => productIdMatch(x.id, id));
      if (!p) {
        showToast("No se pudo cargar el producto", "warning");
        return;
      }
      $("#productId").value = p.id;
      $("#productName").value = p.name;
      $("#productDesc").value = p.description || "";
      $("#productPrice").value = p.price;
      $("#productCategory").value = p.category || "digital";
      $("#productStock").value = p.stock;
      $("#productPurchases").value = p.purchase_count;
      $("#productShowStock").checked = !!p.show_stock;
      $("#productShowPurchases").checked = !!p.show_purchases;
      $("#productOfferActive").checked = !!p.offer_active;
      $("#productOfferPrice").value = p.offer_price ?? "";
      $("#productOfferLabel").value = p.offer_label || "";
      $("#productActive").checked = !!p.active;
      if (p.image_url) {
        updateImagePreview(p.image_url);
        $("#currentImageHint").textContent = `Actual: ${p.image_url}`;
        $("#currentImageHint").classList.remove("hidden");
      }
      if (p.digital_file) {
        $("#currentFileHint").textContent = `Actual: ${p.digital_file}`;
        $("#currentFileHint").classList.remove("hidden");
      }
    } else {
      $("#productId").value = "";
      $("#productStock").value = -1;
      $("#productPurchases").value = 0;
    }

    $("#productModal").classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeProductModal() {
    $("#productModal").classList.remove("active");
    document.body.style.overflow = "";
    updateImagePreview(null);
    editingId = null;
  }

  async function saveProduct(e) {
    e.preventDefault();
    const btn = $("#saveProductBtn");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    const fd = new FormData();
    fd.append("name", $("#productName").value.trim());
    fd.append("description", $("#productDesc").value.trim());
    fd.append("price", $("#productPrice").value);
    fd.append("category", $("#productCategory").value);
    fd.append("stock", $("#productStock").value);
    fd.append("showStock", $("#productShowStock").checked ? "1" : "0");
    fd.append("showPurchases", $("#productShowPurchases").checked ? "1" : "0");
    fd.append("offerActive", $("#productOfferActive").checked ? "1" : "0");
    fd.append("offerPrice", $("#productOfferPrice").value);
    fd.append("offerLabel", $("#productOfferLabel").value.trim());

    const image = $("#productImage").files[0];
    const digital = $("#productDigitalFile").files[0];
    if (image) fd.append("image", image);
    if (digital) fd.append("digitalFile", digital);

    try {
      if (editingId) {
        fd.append("active", $("#productActive").checked ? "1" : "0");
        await api(`/api/admin/products/${editingId}`, { method: "PUT", body: fd });
        showToast("Producto actualizado");
      } else {
        await api("/api/admin/products", { method: "POST", body: fd });
        showToast("Producto creado");
      }
      closeProductModal();
      await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  }

  async function deleteProduct(id) {
    const p = products.find((x) => productIdMatch(x.id, id));
    if (!confirm(`¿Ocultar "${p?.name}" de la tienda?`)) return;
    try {
      await api(`/api/admin/products/${id}`, { method: "DELETE" });
      showToast("Producto desactivado");
      await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    }
  }

  const STATUS_MAP = {
    pending: { label: "Pendiente", cls: "gold" },
    pending_verification: { label: "Verificando", cls: "blue" },
    paid: { label: "Pagado", cls: "green" },
  };

  async function loadOrders() {
    const orders = await api("/api/admin/orders");
    const tbody = $("#ordersBody");
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">No hay pedidos</td></tr>';
      return;
    }

    tbody.innerHTML = orders
      .map((o) => {
        const st = STATUS_MAP[o.payment_status] || STATUS_MAP.pending;
        return `
      <tr>
        <td><code>${escapeHtml(o.order_code)}</code></td>
        <td>${escapeHtml(o.customer_name)}<br><small class="admin-muted">${escapeHtml(o.customer_email)}</small></td>
        <td>${formatPrice(o.total)}</td>
        <td>${escapeHtml(o.payment_method)}</td>
        <td><span class="admin-badge ${st.cls}">${st.label}</span></td>
        <td><small>${new Date(o.created_at).toLocaleString("es-ES")}</small></td>
        <td class="admin-actions">
          ${o.payment_status === "pending_verification" ? `<button type="button" class="btn btn-sm btn-primary" data-approve="${o.id}">Aprobar</button>` : ""}
          <button type="button" class="btn btn-sm btn-danger" data-del-order="${o.id}">Eliminar</button>
        </td>
      </tr>`;
      })
      .join("");

    tbody.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/orders/${btn.dataset.approve}/approve`, { method: "POST" });
          showToast("Pedido aprobado y entregado");
          loadOrders();
          loadStats();
        } catch (err) {
          showToast(err.message, "warning");
        }
      });
    });

    tbody.querySelectorAll("[data-del-order]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este pedido?")) return;
        try {
          await api(`/api/admin/orders/${btn.dataset.delOrder}`, { method: "DELETE" });
          showToast("Pedido eliminado");
          loadOrders();
        } catch (err) {
          showToast(err.message, "warning");
        }
      });
    });
  }

  async function loadReviews() {
    const reviews = await api("/api/admin/reviews");
    const tbody = $("#reviewsBody");
    if (!reviews.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">No hay reseñas</td></tr>';
      return;
    }

    tbody.innerHTML = reviews
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.customer_name)}</td>
        <td>${escapeHtml(r.product_name)}</td>
        <td>${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</td>
        <td class="admin-review-msg">${escapeHtml(r.message)}</td>
        <td>${r.approved ? '<span class="admin-badge green">Visible</span>' : '<span class="admin-badge red">Oculta</span>'}</td>
        <td>
          <button type="button" class="btn btn-sm btn-outline" data-toggle-review="${r.id}" data-approved="${r.approved ? "0" : "1"}">
            ${r.approved ? "Ocultar" : "Aprobar"}
          </button>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-toggle-review]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/reviews/${btn.dataset.toggleReview}`, {
            method: "PUT",
            body: JSON.stringify({ approved: btn.dataset.approved === "1" }),
          });
          showToast("Reseña actualizada");
          loadReviews();
        } catch (err) {
          showToast(err.message, "warning");
        }
      });
    });
  }

  async function init() {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const data = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({
            username: $("#loginUser").value.trim(),
            password: $("#loginPass").value,
          }),
        });
        showApp(data.user);
        switchTab("dashboard");
      } catch (err) {
        showToast(err.message, "warning");
      }
    });

    $("#logoutBtn").addEventListener("click", async () => {
      await api("/api/admin/logout", { method: "POST" }).catch(() => {});
      showLogin();
    });

    $$(".admin-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    $("#newProductBtn").addEventListener("click", () => openProductModal());
    $("#closeProductModal").addEventListener("click", closeProductModal);
    $("#cancelProductBtn").addEventListener("click", closeProductModal);
    $("#productImage").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) {
        updateImagePreview(null);
        return;
      }
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = URL.createObjectURL(file);
      updateImagePreview(imagePreviewUrl);
    });
    $("#productForm").addEventListener("submit", saveProduct);
    $("#productModal").addEventListener("click", (e) => {
      if (e.target === $("#productModal")) closeProductModal();
    });

    try {
      const me = await api("/api/admin/me");
      showApp(me.user);
      switchTab("dashboard");
    } catch {
      showLogin();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
