(function () {
  "use strict";

  const STORAGE_CART = "cludy_cart";

  let cart = [];
  let products = [];
  let reviews = [];
  let reviewStats = { total: 0, average: 0 };
  let config = {};
  let selectedStars = 0;
  let currentFilter = "all";
  let searchQuery = "";
  let lastOrderCode = "";
  let lastOrderProducts = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function formatPrice(n) {
    return "€" + Number(n).toFixed(2);
  }

  function showToast(msg, type = "success") {
    const toast = $("#toast");
    toast.textContent = msg;
    toast.className = "toast show " + type;
    setTimeout(() => toast.classList.remove("show"), 4000);
  }

  function openModal(id) {
    $(id).classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    $(id).classList.remove("active");
    document.body.style.overflow = "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Server error");
    return data;
  }

  /* ---- Storage ---- */
  function loadCart() {
    try {
      cart = JSON.parse(localStorage.getItem(STORAGE_CART)) || [];
    } catch {
      cart = [];
    }
  }

  function saveCart() {
    localStorage.setItem(STORAGE_CART, JSON.stringify(cart));
  }

  /* ---- Products ---- */
  async function fetchProducts() {
    const params = new URLSearchParams();
    if (currentFilter !== "all") params.set("category", currentFilter);
    if (searchQuery) params.set("search", searchQuery);
    products = await api(`/api/products?${params}`);
    $("#statProducts").textContent = products.length + "+";
    renderProducts();
  }

  function productImage(p) {
    if (p.imageUrl) return `<img src="${p.imageUrl}" alt="${escapeHtml(p.name)}" loading="lazy">`;
    return `<span class="product-placeholder" aria-hidden="true">📦</span>`;
  }

  function categoryLabel(category) {
    const labels = { tools: "Tools", methods: "Methods", variety: "Variety", all: "All" };
    return labels[category] || category.charAt(0).toUpperCase() + category.slice(1);
  }

  function renderProductCard(p, i) {
    const price = p.offerActive && p.offerPrice != null ? p.offerPrice : p.price;
    const priceHtml = p.offerActive && p.offerPrice != null
      ? `<div class="price-offer"><span class="product-price-old">€${p.price.toFixed(2)}</span><span class="product-price">${formatPrice(price)}</span>${p.offerLabel ? `<span class="offer-tag">${escapeHtml(p.offerLabel)}</span>` : ""}</div>`
      : `<span class="product-price">${formatPrice(price)}</span>`;

    let meta = "";
    if (p.showStock && p.stock !== -1) meta += `<span class="product-meta">Stock: ${p.stock}</span>`;
    if (p.showPurchases) meta += `<span class="product-meta">${p.purchaseCount} sold</span>`;
    if (!p.inStock) meta += `<span class="product-meta" style="color:var(--danger)">Out of stock</span>`;

    return `
      <article class="product-card" style="animation-delay:${i * 0.06}s" data-id="${p.id}">
        <div class="product-image${p.imageUrl ? " has-photo" : ""}">
          ${p.badge ? `<span class="product-badge">${escapeHtml(p.badge)}</span>` : ""}
          ${productImage(p)}
        </div>
        <div class="product-info">
          <span class="product-category">${categoryLabel(p.category)}</span>
          <h3 class="product-name">${escapeHtml(p.name)}</h3>
          <p class="product-desc">${escapeHtml(p.description)}</p>
          ${meta ? `<div class="product-meta-row">${meta}</div>` : ""}
          <div class="product-footer">
            ${priceHtml}
            <button class="add-to-cart" data-id="${p.id}" ${!p.inStock ? "disabled" : ""} aria-label="Add ${escapeHtml(p.name)}">+</button>
          </div>
        </div>
      </article>`;
  }

  function renderProducts() {
    const grid = $("#productsGrid");
    const empty = $("#productsEmpty");
    if (!products.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    grid.innerHTML = products.map((p, i) => renderProductCard(p, i)).join("");
    bindAddToCart(grid);
  }

  function bindAddToCart(container) {
    container.querySelectorAll(".add-to-cart").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        addToCart(Number(btn.dataset.id));
      });
    });
  }

  /* ---- Cart ---- */
  function addToCart(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product || !product.inStock) return;

    const price = product.offerActive && product.offerPrice != null ? product.offerPrice : product.price;
    const existing = cart.find((item) => item.id === productId);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price,
        category: product.category,
        imageUrl: product.imageUrl,
        qty: 1,
      });
    }
    saveCart();
    updateCartUI();
    showToast(`${product.name} added to cart`);
  }

  function removeFromCart(productId) {
    cart = cart.filter((item) => item.id !== productId);
    saveCart();
    updateCartUI();
  }

  function updateQty(productId, delta) {
    const item = cart.find((i) => i.id === productId);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) removeFromCart(productId);
    else {
      saveCart();
      updateCartUI();
    }
  }

  function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function getCartCount() {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }

  function updateCartUI() {
    const count = getCartCount();
    $("#cartCount").textContent = count;

    const itemsEl = $("#cartItems");
    const footerEl = $("#cartFooter");
    const emptyEl = $("#cartEmpty");

    if (cart.length === 0) {
      itemsEl.innerHTML = "";
      footerEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      return;
    }

    emptyEl.classList.add("hidden");
    footerEl.classList.remove("hidden");

    itemsEl.innerHTML = cart
      .map(
        (item) => `
      <div class="cart-item">
        <span class="cart-item-emoji">${item.imageUrl ? `<img src="${item.imageUrl}" alt="" class="cart-item-thumb">` : "📦"}</span>
        <div class="cart-item-info"><h4>${escapeHtml(item.name)}</h4><span>${formatPrice(item.price)} each</span></div>
        <div class="cart-item-qty">
          <button data-id="${item.id}" data-delta="-1">−</button><span>${item.qty}</span>
          <button data-id="${item.id}" data-delta="1">+</button>
        </div>
        <span class="cart-item-price">${formatPrice(item.price * item.qty)}</span>
        <button class="cart-item-remove" data-remove="${item.id}">&times;</button>
      </div>`
      )
      .join("");

    $("#cartTotal").textContent = formatPrice(getCartTotal());

    itemsEl.querySelectorAll("[data-delta]").forEach((btn) => {
      btn.addEventListener("click", () => updateQty(Number(btn.dataset.id), Number(btn.dataset.delta)));
    });
    itemsEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(Number(btn.dataset.remove)));
    });
  }

  /* ---- Reviews ---- */
  function renderStars(count) {
    return "★".repeat(count) + "☆".repeat(5 - count);
  }

  async function fetchReviews() {
    reviews = await api("/api/reviews");
    reviewStats = await api("/api/reviews/stats");
    $("#statReviews").textContent = reviewStats.total + "+";
    renderReviews();
  }

  function renderReviews() {
    const grid = $("#reviewsGrid");
    const empty = $("#reviewsEmpty");
    const summary = $("#reviewsSummary");

    if (reviews.length === 0) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      summary.classList.add("hidden");
      return;
    }

    empty.classList.add("hidden");
    summary.classList.remove("hidden");

    const avg = reviewStats.average || (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length);
    const total = reviewStats.total || reviews.length;
    const barBase = total || reviews.length;
    const bars = [5, 4, 3, 2, 1].map((star) => {
      const count = reviews.filter((r) => r.stars === star).length;
      return { star, count, pct: barBase ? (count / barBase) * 100 : 0 };
    });

    summary.innerHTML = `
      <div class="summary-score"><div class="big">${avg.toFixed(1)}</div><div class="stars-display">${renderStars(Math.round(avg))}</div><div class="count">${total} review${total !== 1 ? "s" : ""}</div></div>
      <div class="summary-bars">${bars.map((b) => `<div class="bar-row"><span>${b.star}</span><div class="bar-track"><div class="bar-fill" style="width:${b.pct}%"></div></div><span>${b.count}</span></div>`).join("")}</div>`;

    grid.innerHTML = reviews
      .map(
        (r) => `
      <article class="review-card">
        <div class="review-header"><div class="review-avatar">${r.name.charAt(0)}</div><div class="review-meta"><h4>${escapeHtml(r.name)}</h4><span class="review-date">${new Date(r.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span></div></div>
        <div class="review-stars">${renderStars(r.stars)}</div>
        <span class="review-product-tag">${escapeHtml(r.product)}</span>
        <p class="review-text">${escapeHtml(r.message)}</p>
      </article>`
      )
      .join("");
  }

  function populateReviewProducts() {
    const select = $("#reviewProduct");
    select.innerHTML = lastOrderProducts.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
    $("#reviewOrderCode").value = lastOrderCode;
  }

  /* ---- Checkout ---- */
  async function handleCheckout(e) {
    e.preventDefault();

    const name = $("#customerName").value.trim();
    const email = $("#customerEmail").value.trim();
    const payment = document.querySelector('input[name="payment"]:checked');
    if (!payment) return showToast("Select a payment method", "warning");

    const btn = $("#checkoutSubmit");
    btn.disabled = true;
    btn.textContent = "Processing...";

    try {
      const result = await api("/api/orders/create", {
        method: "POST",
        body: JSON.stringify({
          customerName: name,
          customerEmail: email,
          paymentMethod: payment.value,
          items: cart.map((i) => ({ id: i.id, qty: i.qty })),
        }),
      });

      lastOrderCode = result.orderCode;
      lastOrderProducts = cart.map((i) => ({ name: i.name, qty: i.qty }));

      cart = [];
      saveCart();
      updateCartUI();
      closeModal("#checkoutModal");
      closeModal("#cartModal");

      if (result.paymentMethod === "stripe" && result.stripeUrl) {
        showToast("Redirecting to Stripe...");
        window.location.href = result.stripeUrl;
        return;
      }

      if (result.paymentMethod === "litecoin") {
        showLtcModal(result);
        return;
      }

      if (result.paymentMethod === "paypal") {
        showPaypalModal(result);
        return;
      }
    } catch (err) {
      showToast(err.message, "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = "Confirm order";
    }
  }

  function showLtcModal(result) {
    $("#ltcOrderCode").textContent = result.orderCode;
    $("#ltcAmount").textContent = result.ltcAmount;
    $("#ltcAddress").value = result.ltcWallet;
    $("#ltcQr").src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`litecoin:${result.ltcWallet}?amount=${result.ltcAmount}`)}`;
    $("#ltcTrackLink").href = result.trackUrl;
    openModal("#ltcModal");
    showToast("Order created — send the exact LTC amount");
  }

  function showPaypalModal(result) {
    $("#paypalOrderCode").textContent = result.orderCode;
    $("#paypalTotal").textContent = formatPrice(result.total);
    $("#paypalEmail").textContent = result.paypalEmail;
    $("#paypalNote").textContent = result.paypalNote;
    $("#paypalTrackLink").href = result.trackUrl;
    openModal("#paypalModal");
    showToast("Order created — complete the PayPal payment");
  }

  async function confirmLtc() {
    const btn = $("#ltcConfirm");
    btn.disabled = true;
    btn.textContent = "Checking...";
    try {
      const data = await api(`/api/orders/${lastOrderCode}/confirm-ltc`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      closeModal("#ltcModal");
      window.location.href = data.trackUrl || `/track.html?code=${lastOrderCode}&waiting=1`;
    } catch (err) {
      showToast(err.message, "warning");
      btn.disabled = false;
      btn.textContent = "I've sent the payment";
    }
  }

  async function handleReviewSubmit(e) {
    e.preventDefault();
    if (!selectedStars) return showToast("Select between 1 and 5 stars", "warning");

    try {
      await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          orderCode: $("#reviewOrderCode").value || lastOrderCode,
          customerName: $("#customerName")?.value?.trim(),
          stars: selectedStars,
          message: $("#reviewMessage").value.trim(),
          productName: $("#reviewProduct").value,
        }),
      });
      closeModal("#reviewModal");
      showToast("Thank you! Your review has been published.");
      fetchReviews();
    } catch (err) {
      showToast(err.message, "warning");
    }
  }

  function promptReview() {
    setTimeout(() => {
      selectedStars = 0;
      $$("#starRating .star").forEach((s) => s.classList.remove("active"));
      $("#reviewMessage").value = "";
      populateReviewProducts();
      openModal("#reviewModal");
    }, 800);
  }

  /* ---- FAQ ---- */
  function initFaq() {
    $$(".faq-question").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".faq-item");
        const wasOpen = item.classList.contains("open");
        $$(".faq-item").forEach((i) => i.classList.remove("open"));
        if (!wasOpen) item.classList.add("open");
      });
    });
  }

  /* ---- Search ---- */
  function initSearch() {
    let timeout;
    const handleSearch = (val) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        searchQuery = val.trim();
        currentFilter = "all";
        $$(".filter-btn").forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));
        fetchProducts();
      }, 300);
    };
    $("#searchInput")?.addEventListener("input", (e) => handleSearch(e.target.value));
    $("#searchInputMobile")?.addEventListener("input", (e) => handleSearch(e.target.value));
  }

  /* ---- Navigation ---- */
  function initNavigation() {
    const header = $("#header");
    window.addEventListener("scroll", () => header.classList.toggle("scrolled", window.scrollY > 50));

    $$(".nav-link[data-section]").forEach((link) => {
      link.addEventListener("click", () => {
        $$(".nav-link").forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        $("#nav").classList.remove("open");
      });
    });

    const sections = $$("section[id]");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            $$(".nav-link[data-section]").forEach((l) => {
              l.classList.toggle("active", l.dataset.section === entry.target.id);
            });
          }
        });
      },
      { threshold: 0.3, rootMargin: "-80px 0px -40% 0px" }
    );
    sections.forEach((s) => observer.observe(s));

    $("#menuToggle").addEventListener("click", () => $("#nav").classList.toggle("open"));
  }

  function initFilters() {
    $$(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        searchQuery = "";
        if ($("#searchInput")) $("#searchInput").value = "";
        if ($("#searchInputMobile")) $("#searchInputMobile").value = "";
        fetchProducts();
      });
    });
  }

  function initStarRating() {
    $$("#starRating .star").forEach((star) => {
      star.addEventListener("click", () => {
        selectedStars = Number(star.dataset.value);
        $("#reviewStars").value = selectedStars;
        $$("#starRating .star").forEach((s) => s.classList.toggle("active", Number(s.dataset.value) <= selectedStars));
      });
    });
  }

  function initModals() {
    $("#cartBtn").addEventListener("click", () => openModal("#cartModal"));
    $("#cartClose").addEventListener("click", () => closeModal("#cartModal"));
    $("#checkoutClose").addEventListener("click", () => closeModal("#checkoutModal"));
    $("#reviewClose").addEventListener("click", () => closeModal("#reviewModal"));
    $("#ltcClose").addEventListener("click", () => closeModal("#ltcModal"));
    $("#paypalClose").addEventListener("click", () => closeModal("#paypalModal"));

    $("#checkoutBtn").addEventListener("click", () => {
      if (cart.length === 0) return;
      closeModal("#cartModal");
      $("#checkoutTotal").textContent = formatPrice(getCartTotal());
      openModal("#checkoutModal");
    });

    $("#cartShopBtn").addEventListener("click", () => closeModal("#cartModal"));

    $$(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.classList.remove("active");
          document.body.style.overflow = "";
        }
      });
    });

    $("#checkoutForm").addEventListener("submit", handleCheckout);
    $("#reviewForm").addEventListener("submit", handleReviewSubmit);
    $("#skipReview").addEventListener("click", () => closeModal("#reviewModal"));
    $("#ltcConfirm").addEventListener("click", confirmLtc);
    $("#ltcCopy").addEventListener("click", () => {
      navigator.clipboard.writeText($("#ltcAddress").value);
      showToast("Address copied");
    });
  }

  async function checkStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || new URLSearchParams(window.location.hash.slice(1)).get("code");
    if (params.get("cancelled")) showToast("Payment cancelled", "warning");
  }

  async function init() {
    loadCart();
    updateCartUI();
    initNavigation();
    initFilters();
    initStarRating();
    initModals();
    initFaq();
    initSearch();

    try {
      config = await api("/api/config");
      if (config.discordUrl) {
        const discordBtn = $("#discordBtn");
        if (discordBtn) discordBtn.href = config.discordUrl;
      }
    } catch {
      /* offline */
    }

    await fetchProducts();
    await fetchReviews();
    checkStripeReturn();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
