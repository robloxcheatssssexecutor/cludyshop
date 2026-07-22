(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let products = [];
  let offerProducts = [];
  let editingId = null;
  let imagePreviewUrl = null;
  let brandingLogoPreviewUrl = null;
  let currentBranding = null;

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
      throw new Error("Session expired");
    }
    if (!res.ok) throw new Error(data.error || "Server error");
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
    if (tab === "offers") loadOffers();
    if (tab === "orders") loadOrders();
    if (tab === "reviews") loadReviews();
    if (tab === "branding") loadBranding();
  }

  async function loadStats() {
    const stats = await api("/api/admin/stats");
    $("#statsGrid").innerHTML = `
      <div class="admin-stat-card"><span class="admin-stat-value">${stats.products}</span><span class="admin-stat-label">Active products</span></div>
      <div class="admin-stat-card"><span class="admin-stat-value">${stats.orders}</span><span class="admin-stat-label">Total orders</span></div>
      <div class="admin-stat-card"><span class="admin-stat-value">${formatPrice(stats.revenue)}</span><span class="admin-stat-label">Revenue</span></div>
      <div class="admin-stat-card warn"><span class="admin-stat-value">${stats.pending}</span><span class="admin-stat-label">Pending payments</span></div>`;
  }

  function stockLabel(stock) {
    if (stock === -1) return "Unlimited";
    return String(stock);
  }

  function visibilityBadges(p) {
    const badges = [];
    if (p.show_stock) badges.push('<span class="admin-badge blue">Stock visible</span>');
    if (p.show_purchases) badges.push('<span class="admin-badge green">Sales visible</span>');
    if (p.offer_active) badges.push('<span class="admin-badge gold">Offer</span>');
    return badges.join(" ") || '<span class="admin-muted">—</span>';
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("es-ES");
  }

  function toDatetimeLocalValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function defaultOfferExpiry() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    date.setSeconds(0, 0);
    return toDatetimeLocalValue(date);
  }

  function updateOfferScopeUI() {
    const selected = $("#offerScopeSelected").checked;
    $("#offerProductPicker").classList.toggle("hidden", !selected);
  }

  function updateOfferDiscountLabel() {
    const isFixed = $("#offerDiscountType").value === "fixed";
    $("#offerDiscountValueLabel").textContent = isFixed ? "Descuento (€)" : "Descuento (%)";
    $("#offerDiscountValue").placeholder = isFixed ? "Ej. 5.00" : "Ej. 20";
    $("#offerDiscountValue").step = isFixed ? "0.01" : "1";
    $("#offerDiscountValue").max = isFixed ? "" : "100";
  }

  function renderOfferProductPicker() {
    const list = $("#offerProductList");
    if (!offerProducts.length) {
      list.innerHTML = '<p class="admin-muted">No hay productos</p>';
      return;
    }

    list.innerHTML = offerProducts
      .map(
        (p) => `
      <label class="admin-check">
        <input type="checkbox" class="offer-product-check" value="${p.id}">
        <span>${escapeHtml(p.name)} <small class="admin-muted">(${formatPrice(p.price)})</small></span>
      </label>`
      )
      .join("");
  }

  function getSelectedOfferProductIds() {
    return [...document.querySelectorAll(".offer-product-check:checked")].map((el) => Number(el.value));
  }

  async function loadOffers() {
    const data = await api("/api/admin/offers");
    offerProducts = data.products || [];
    renderOfferProductPicker();

    const countLabel = $("#offersCountLabel");
    if (countLabel) {
      countLabel.textContent = `${data.activeCount || 0} producto(s) con oferta activa de ${offerProducts.length} en total`;
    }

    const tbody = $("#offersBody");
    const active = data.active || [];
    if (!active.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">No hay ofertas activas</td></tr>';
      return;
    }

    tbody.innerHTML = active
      .map(
        (p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td><s class="admin-muted">${formatPrice(p.price)}</s></td>
        <td>${formatPrice(p.offer_price)}</td>
        <td>${p.offer_label ? `<span class="admin-badge gold">${escapeHtml(p.offer_label)}</span>` : '<span class="admin-muted">—</span>'}</td>
        <td><small>${formatDateTime(p.offer_expires_at)}</small></td>
        <td class="admin-actions">
          <button type="button" class="btn btn-sm btn-outline" data-clear-offer="${p.id}">Quitar</button>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-clear-offer]").forEach((btn) => {
      btn.addEventListener("click", () => clearOffers("selected", [Number(btn.dataset.clearOffer)]));
    });
  }

  async function applyOffer(e) {
    e.preventDefault();

    const scope = $("#offerScopeSelected").checked ? "selected" : "all";
    const productIds = scope === "selected" ? getSelectedOfferProductIds() : [];
    const discountType = $("#offerDiscountType").value;
    const discountValue = Number($("#offerDiscountValue").value);
    const label = $("#offerLabel").value.trim();
    const expiresAt = $("#offerExpiresAt").value;

    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      showToast("Indica un descuento valido", "warning");
      return;
    }
    if (discountType === "percent" && discountValue > 100) {
      showToast("El porcentaje no puede superar 100", "warning");
      return;
    }
    if (!expiresAt) {
      showToast("Indica cuando expira la oferta", "warning");
      return;
    }
    if (scope === "selected" && !productIds.length) {
      showToast("Selecciona al menos un producto", "warning");
      return;
    }

    const btn = $("#applyOfferBtn");
    btn.disabled = true;
    btn.textContent = "Aplicando...";

    try {
      const data = await api("/api/admin/offers/apply", {
        method: "POST",
        body: JSON.stringify({
          scope,
          discountType,
          discountValue,
          label,
          expiresAt,
          productIds,
        }),
      });

      let msg = `Oferta aplicada a ${data.updated} producto(s)`;
      if (data.skipped) msg += ` (${data.skipped} omitidos)`;
      showToast(msg);
      if (data.errors?.length) showToast(data.errors[0], "warning");

      await loadOffers();
      if (products.length) await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = "Aplicar oferta";
    }
  }

  async function clearOffers(scope, productIds = []) {
    const message =
      scope === "all"
        ? "Quitar todas las ofertas activas de la tienda?"
        : "Quitar la oferta de los productos seleccionados?";
    if (!confirm(message)) return;

    try {
      const data = await api("/api/admin/offers/clear", {
        method: "POST",
        body: JSON.stringify({ scope, productIds }),
      });
      showToast(`Ofertas eliminadas: ${data.cleared}`);
      await loadOffers();
      if (products.length) await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    }
  }

  async function loadProducts() {
    products = await api("/api/admin/products");
    const tbody = $("#productsBody");
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">No products</td></tr>';
      return;
    }

    tbody.innerHTML = products
      .map(
        (p) => `
      <tr class="${p.active ? "" : "inactive"}">
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.image_url ? `<br><small class="admin-muted">With image</small>` : ""}
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
        <td>${p.active ? '<span class="admin-badge green">Active</span>' : '<span class="admin-badge red">Hidden</span>'}</td>
        <td class="admin-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit="${p.id}">Edit</button>
          <button type="button" class="btn btn-sm btn-outline" data-hide="${p.id}">Hide</button>
          <button type="button" class="btn btn-sm btn-danger" data-delete="${p.id}">Delete</button>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openProductModal(Number(btn.dataset.edit)));
    });
    tbody.querySelectorAll("[data-hide]").forEach((btn) => {
      btn.addEventListener("click", () => hideProduct(Number(btn.dataset.hide)));
    });
    tbody.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteProduct(Number(btn.dataset.delete)));
    });
  }

  function productIdMatch(a, b) {
    return Number(a) === Number(b);
  }

  function updateDeliveryTypeUI(type = "file") {
    const isText = type === "text";
    $("#deliveryTypeFile").checked = !isText;
    $("#deliveryTypeText").checked = isText;
    $("#deliveryFileWrap").classList.toggle("hidden", isText);
    $("#deliveryTextWrap").classList.toggle("hidden", !isText);
  }

  function getDeliveryType() {
    return $("#deliveryTypeText").checked ? "text" : "file";
  }

  function appendDeliveryFields(fd) {
    const deliveryType = getDeliveryType();
    fd.append("deliveryType", deliveryType);
    if (deliveryType === "text") {
      fd.append("deliveryText", $("#productDeliveryText").value.trim());
    }
  }

  function validateDeliveryForm() {
    const deliveryType = getDeliveryType();
    if (deliveryType === "text") {
      if (!$("#productDeliveryText").value.trim()) {
        showToast("Enter the delivery text", "warning");
        return false;
      }
      return true;
    }
    const hasFile = $("#productDigitalFile").files[0];
    const hasExisting = $("#currentFileHint").classList.contains("hidden") === false;
    if (!hasFile && !hasExisting) {
      showToast("Upload the delivery file", "warning");
      return false;
    }
    return true;
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
    if (image) fd.append("image", image);
    if (getDeliveryType() === "file") {
      const digital = $("#productDigitalFile").files[0];
      if (digital) fd.append("digitalFile", digital);
    }
    appendDeliveryFields(fd);
    return fd;
  }

  function updateImagePreview(src) {
    const preview = $("#productImagePreview");
    const img = $("#productImagePreviewImg");
    const placeholder = $("#productImagePlaceholder");
    if (src) {
      img.src = src;
      img.classList.remove("hidden");
      placeholder.classList.add("hidden");
      preview.classList.remove("hidden");
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
    img.classList.add("hidden");
    img.removeAttribute("src");
    placeholder.classList.remove("hidden");
    preview.classList.remove("hidden");
  }

  function openProductModal(id = null) {
    editingId = id;
    const form = $("#productForm");
    form.reset();
    updateImagePreview(null);
    $("#productModalTitle").textContent = id ? "Edit product" : "New product";
    $("#productActiveWrap").classList.toggle("hidden", !id);
    $("#currentImageHint").classList.add("hidden");
    $("#currentFileHint").classList.add("hidden");
    $("#currentTextHint").classList.add("hidden");
    $("#productShowPurchases").checked = true;
    updateDeliveryTypeUI("file");

    if (id) {
      const p = products.find((x) => productIdMatch(x.id, id));
      if (!p) {
        showToast("Could not load product", "warning");
        return;
      }
      $("#productId").value = p.id;
      $("#productName").value = p.name;
      $("#productDesc").value = p.description || "";
      $("#productPrice").value = p.price;
      $("#productCategory").value = p.category || "variety";
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
        $("#currentImageHint").textContent = `Current: ${p.image_url}`;
        $("#currentImageHint").classList.remove("hidden");
      }
      if (p.digital_file) {
        $("#currentFileHint").textContent = `Current file: ${p.digital_file}`;
        $("#currentFileHint").classList.remove("hidden");
      }
      const deliveryType = p.delivery_type || "file";
      updateDeliveryTypeUI(deliveryType);
      if (deliveryType === "text") {
        $("#productDeliveryText").value = p.delivery_text || "";
        if (p.delivery_text) {
          $("#currentTextHint").textContent = "Delivery text configured";
          $("#currentTextHint").classList.remove("hidden");
        }
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
    if (!validateDeliveryForm()) return;

    const btn = $("#saveProductBtn");
    btn.disabled = true;
    btn.textContent = "Saving...";

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
    if (image) fd.append("image", image);
    if (getDeliveryType() === "file") {
      const digital = $("#productDigitalFile").files[0];
      if (digital) fd.append("digitalFile", digital);
    }
    appendDeliveryFields(fd);

    try {
      if (editingId) {
        fd.append("active", $("#productActive").checked ? "1" : "0");
        await api(`/api/admin/products/${editingId}`, { method: "PUT", body: fd });
        showToast("Product updated");
      } else {
        await api("/api/admin/products", { method: "POST", body: fd });
        showToast("Product created");
      }
      closeProductModal();
      await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  }

  async function hideProduct(id) {
    const p = products.find((x) => productIdMatch(x.id, id));
    if (!confirm(`Hide "${p?.name}" from the store?`)) return;
    try {
      await api(`/api/admin/products/${id}`, { method: "DELETE" });
      showToast("Product hidden");
      await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    }
  }

  async function deleteProduct(id) {
    const p = products.find((x) => productIdMatch(x.id, id));
    if (!confirm(`Permanently delete "${p?.name}"? This action cannot be undone.`)) return;
    try {
      await api(`/api/admin/products/${id}/permanent`, { method: "DELETE" });
      showToast("Product deleted");
      await loadProducts();
    } catch (err) {
      showToast(err.message, "warning");
    }
  }

  async function exportProductsCatalog() {
    const btn = $("#exportProductsBtn");
    btn.disabled = true;
    btn.textContent = "Exporting...";

    try {
      const res = await fetch("/api/admin/products/export", { credentials: "include" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Export failed");
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      const fallback = `products-export-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Product catalog exported (ZIP with JSON and files)");
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = "Export catalog";
    }
  }

  async function importProductsCatalog(file) {
    if (!file) return;

    const updateExisting = $("#importProductsUpdate")?.checked;

    try {
      const formData = new FormData();
      formData.append("productsFile", file);
      formData.append("updateExisting", updateExisting ? "1" : "0");

      const data = await api("/api/admin/products/import", { method: "POST", body: formData });

      const parts = [`${data.imported} new`, `${data.skipped} skipped`];
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.filesCopied) parts.push(`${data.filesCopied} files copied`);
      showToast(`${parts.join(", ")}. Total in store: ${data.total}`);
      if (data.errors?.length) {
        showToast(data.errors[0], "warning");
      }
      await loadProducts();
      loadStats();
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      $("#importProductsFile").value = "";
    }
  }

  const STATUS_MAP = {
    pending: { label: "Pending", cls: "gold" },
    pending_verification: { label: "Verifying", cls: "blue" },
    paid: { label: "Paid", cls: "green" },
  };

  function formatOrderItems(items) {
    if (!items?.length) return '<span class="admin-muted">—</span>';
    return items
      .map(
        (item) =>
          `<div><strong>${escapeHtml(item.product_name)}</strong> × ${item.qty}<br><small class="admin-muted">${formatPrice(item.price * item.qty)}</small></div>`
      )
      .join("");
  }

  async function loadOrders() {
    const orders = await api("/api/admin/orders");
    const tbody = $("#ordersBody");
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">No orders</td></tr>';
      return;
    }

    tbody.innerHTML = orders
      .map((o) => {
        const st = STATUS_MAP[o.payment_status] || STATUS_MAP.pending;
        return `
      <tr>
        <td><code>${escapeHtml(o.order_code)}</code></td>
        <td>${escapeHtml(o.customer_name)}<br><small class="admin-muted">${escapeHtml(o.customer_email)}</small></td>
        <td class="admin-order-items">${formatOrderItems(o.items)}</td>
        <td><strong>${formatPrice(o.total)}</strong></td>
        <td><code class="admin-ip">${escapeHtml(o.customer_ip || "—")}</code></td>
        <td>${escapeHtml(o.payment_method)}</td>
        <td><span class="admin-badge ${st.cls}">${st.label}</span></td>
        <td><small>${new Date(o.created_at).toLocaleString("en-US")}</small></td>
        <td class="admin-actions">
          ${o.payment_status === "pending_verification" ? `<button type="button" class="btn btn-sm btn-primary" data-approve="${o.id}">Approve</button>` : ""}
          <button type="button" class="btn btn-sm btn-danger" data-del-order="${o.id}">Delete</button>
        </td>
      </tr>`;
      })
      .join("");

    tbody.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/orders/${btn.dataset.approve}/approve`, { method: "POST" });
          showToast("Order approved and delivered");
          loadOrders();
          loadStats();
        } catch (err) {
          showToast(err.message, "warning");
        }
      });
    });

    tbody.querySelectorAll("[data-del-order]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this order?")) return;
        try {
          await api(`/api/admin/orders/${btn.dataset.delOrder}`, { method: "DELETE" });
          showToast("Order deleted");
          loadOrders();
        } catch (err) {
          showToast(err.message, "warning");
        }
      });
    });
  }

  async function importDiscordVouches(file) {
    const btn = $("#importDiscordBtn");
    btn.disabled = true;
    btn.textContent = "Importing...";

    try {
      let data;
      if (file) {
        const formData = new FormData();
        formData.append("vouchesFile", file);
        data = await api("/api/admin/reviews/import-discord", { method: "POST", body: formData });
      } else {
        data = await api("/api/admin/reviews/import-discord", { method: "POST", body: JSON.stringify({}) });
      }

      showToast(
        `${data.imported} nuevas de ${data.total} en el archivo (${data.skipped} ya existían). Total en tienda: ${data.visible ?? data.inDatabase} visibles`
      );
      loadReviews();
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = "Import from Discord";
      if (file) $("#importDiscordFile").value = "";
    }
  }

  async function loadBranding() {
    currentBranding = await api("/api/admin/branding");

    $("#brandingLogoLetter").value = currentBranding.logo_letter || "C";
    $("#brandingBrandName").value = currentBranding.brand_name || "";
    $("#brandingBrandAccent").value = currentBranding.brand_accent || "";
    $("#brandingSiteTitle").value = currentBranding.site_title || "";
    $("#brandingHeroBadge").value = currentBranding.hero_badge || "";
    $("#brandingHeroTitle").value = currentBranding.hero_title || "";
    $("#brandingHeroHighlight").value = currentBranding.hero_highlight || "";
    $("#brandingHeroDesc").value = currentBranding.hero_desc || "";
    $("#brandingProductsTitle").value = currentBranding.products_title || "";
    $("#brandingAboutTitle").value = currentBranding.about_title || "";
    $("#brandingFooterText").value = currentBranding.footer_text || "";
    $("#brandingRemoveLogo").checked = false;
    $("#brandingLogoFile").value = "";

    updateBrandingLogoPreview(currentBranding.logo_url || null);
    $("#brandingLogoPreviewLetter").textContent = (currentBranding.logo_letter || "C").slice(0, 2);
  }

  function updateBrandingLogoPreview(url) {
    const img = $("#brandingLogoPreviewImg");
    const letter = $("#brandingLogoPreviewLetter");

    if (brandingLogoPreviewUrl) {
      URL.revokeObjectURL(brandingLogoPreviewUrl);
      brandingLogoPreviewUrl = null;
    }

    if (url) {
      img.src = url;
      img.classList.remove("hidden");
      letter.classList.add("hidden");
      return;
    }

    img.removeAttribute("src");
    img.classList.add("hidden");
    letter.classList.remove("hidden");
  }

  async function saveBranding(e) {
    e.preventDefault();

    const formData = new FormData();
    formData.append("logo_letter", $("#brandingLogoLetter").value.trim().slice(0, 2) || "C");
    formData.append("brand_name", $("#brandingBrandName").value.trim());
    formData.append("brand_accent", $("#brandingBrandAccent").value.trim());
    formData.append("site_title", $("#brandingSiteTitle").value.trim());
    formData.append("hero_badge", $("#brandingHeroBadge").value.trim());
    formData.append("hero_title", $("#brandingHeroTitle").value.trim());
    formData.append("hero_highlight", $("#brandingHeroHighlight").value.trim());
    formData.append("hero_desc", $("#brandingHeroDesc").value.trim());
    formData.append("products_title", $("#brandingProductsTitle").value.trim());
    formData.append("about_title", $("#brandingAboutTitle").value.trim());
    formData.append("footer_text", $("#brandingFooterText").value.trim());

    const logoFile = $("#brandingLogoFile").files[0];
    if (logoFile) formData.append("logo", logoFile);
    if ($("#brandingRemoveLogo").checked) formData.append("removeLogo", "1");

    try {
      const data = await api("/api/admin/branding", {
        method: "PUT",
        body: formData,
      });
      currentBranding = data.branding;
      updateBrandingLogoPreview(currentBranding.logo_url || null);
      $("#brandingLogoFile").value = "";
      $("#brandingRemoveLogo").checked = false;
      showToast("Personalización guardada");
    } catch (err) {
      showToast(err.message, "warning");
    }
  }

  async function loadReviews() {
    const reviews = await api("/api/admin/reviews");
    const tbody = $("#reviewsBody");
    const countLabel = $("#reviewsCountLabel");
    const visibleCount = reviews.filter((r) => r.approved).length;
    if (countLabel) {
      countLabel.textContent = `${reviews.length} reseñas en total · ${visibleCount} visibles en la web`;
    }
    if (!reviews.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">No reviews</td></tr>';
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
    $("#exportProductsBtn").addEventListener("click", exportProductsCatalog);
    $("#importProductsFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importProductsCatalog(file);
    });
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
    $("#deliveryTypeFile").addEventListener("change", () => updateDeliveryTypeUI("file"));
    $("#deliveryTypeText").addEventListener("change", () => updateDeliveryTypeUI("text"));
    $("#productForm").addEventListener("submit", saveProduct);
    $("#productModal").addEventListener("click", (e) => {
      if (e.target === $("#productModal")) closeProductModal();
    });

    $("#importDiscordBtn").addEventListener("click", () => importDiscordVouches());
    $("#importDiscordFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importDiscordVouches(file);
    });

    $("#offerScopeAll").addEventListener("change", updateOfferScopeUI);
    $("#offerScopeSelected").addEventListener("change", updateOfferScopeUI);
    $("#offerDiscountType").addEventListener("change", updateOfferDiscountLabel);
    $("#offerForm").addEventListener("submit", applyOffer);
    $("#clearAllOffersBtn").addEventListener("click", () => clearOffers("all"));
    $("#offerSelectAllBtn").addEventListener("click", () => {
      document.querySelectorAll(".offer-product-check").forEach((el) => {
        el.checked = true;
      });
    });
    $("#offerSelectNoneBtn").addEventListener("click", () => {
      document.querySelectorAll(".offer-product-check").forEach((el) => {
        el.checked = false;
      });
    });
    $("#offerExpiresAt").value = defaultOfferExpiry();
    updateOfferDiscountLabel();
    updateOfferScopeUI();

    $("#brandingForm").addEventListener("submit", saveBranding);
    $("#brandingLogoLetter").addEventListener("input", (e) => {
      $("#brandingLogoPreviewLetter").textContent = e.target.value.trim().slice(0, 2) || "C";
    });
    $("#brandingLogoFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) {
        updateBrandingLogoPreview(currentBranding?.logo_url || null);
        return;
      }
      if (brandingLogoPreviewUrl) URL.revokeObjectURL(brandingLogoPreviewUrl);
      brandingLogoPreviewUrl = URL.createObjectURL(file);
      updateBrandingLogoPreview(brandingLogoPreviewUrl);
      $("#brandingRemoveLogo").checked = false;
    });
    $("#brandingRemoveLogo").addEventListener("change", (e) => {
      if (e.target.checked) {
        updateBrandingLogoPreview(null);
        $("#brandingLogoFile").value = "";
      } else {
        updateBrandingLogoPreview(currentBranding?.logo_url || null);
      }
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
