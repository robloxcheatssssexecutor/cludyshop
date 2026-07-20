(function () {
  "use strict";

  const STORAGE_CART = "cludy_cart";
  const STORAGE_REVIEWS = "cludy_reviews";
  const STORAGE_INITIALIZED = "cludy_reviews_init";

  let cart = [];
  let reviews = [];
  let selectedStars = 0;
  let lastOrderProducts = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function formatPrice(n) {
    return "€" + n.toFixed(2);
  }

  function showToast(msg, type = "success") {
    const toast = $("#toast");
    toast.textContent = msg;
    toast.className = "toast show " + type;
    setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function openModal(id) {
    $(id).classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    $(id).classList.remove("active");
    document.body.style.overflow = "";
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

  function loadReviews() {
    try {
      reviews = JSON.parse(localStorage.getItem(STORAGE_REVIEWS)) || [];
    } catch {
      reviews = [];
    }
    if (!localStorage.getItem(STORAGE_INITIALIZED)) {
      reviews = [...SAMPLE_REVIEWS];
      saveReviews();
      localStorage.setItem(STORAGE_INITIALIZED, "1");
    }
  }

  function saveReviews() {
    localStorage.setItem(STORAGE_REVIEWS, JSON.stringify(reviews));
  }

  /* ---- Products ---- */
  function renderProducts(filter = "all") {
    const grid = $("#productsGrid");
    const filtered =
      filter === "all"
        ? PRODUCTS
        : PRODUCTS.filter((p) => p.category === filter);

    grid.innerHTML = filtered
      .map(
        (p, i) => `
      <article class="product-card" style="animation-delay:${i * 0.06}s" data-id="${p.id}">
        <div class="product-image">
          ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
          ${p.emoji}
        </div>
        <div class="product-info">
          <span class="product-category">${p.category}</span>
          <h3 class="product-name">${p.name}</h3>
          <p class="product-desc">${p.description}</p>
          <div class="product-footer">
            <span class="product-price">${formatPrice(p.price)}</span>
            <button class="add-to-cart" data-id="${p.id}" aria-label="Añadir ${p.name} al carrito">+</button>
          </div>
        </div>
      </article>`
      )
      .join("");

    grid.querySelectorAll(".add-to-cart").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        addToCart(Number(btn.dataset.id));
      });
    });
  }

  /* ---- Cart ---- */
  function addToCart(productId) {
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) return;

    const existing = cart.find((item) => item.id === productId);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({ ...product, qty: 1 });
    }
    saveCart();
    updateCartUI();
    showToast(`${product.name} añadido al carrito`);
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
    if (item.qty <= 0) {
      removeFromCart(productId);
    } else {
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
        <span class="cart-item-emoji">${item.emoji}</span>
        <div class="cart-item-info">
          <h4>${item.name}</h4>
          <span>${formatPrice(item.price)} c/u</span>
        </div>
        <div class="cart-item-qty">
          <button data-id="${item.id}" data-delta="-1">−</button>
          <span>${item.qty}</span>
          <button data-id="${item.id}" data-delta="1">+</button>
        </div>
        <span class="cart-item-price">${formatPrice(item.price * item.qty)}</span>
        <button class="cart-item-remove" data-remove="${item.id}">&times;</button>
      </div>`
      )
      .join("");

    $("#cartTotal").textContent = formatPrice(getCartTotal());

    itemsEl.querySelectorAll("[data-delta]").forEach((btn) => {
      btn.addEventListener("click", () =>
        updateQty(Number(btn.dataset.id), Number(btn.dataset.delta))
      );
    });
    itemsEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(Number(btn.dataset.remove)));
    });
  }

  /* ---- Reviews ---- */
  function renderStars(count) {
    return "★".repeat(count) + "☆".repeat(5 - count);
  }

  function renderReviews() {
    const grid = $("#reviewsGrid");
    const empty = $("#reviewsEmpty");
    const summary = $("#reviewsSummary");

    $("#statReviews").textContent = reviews.length + "+";

    if (reviews.length === 0) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      summary.classList.add("hidden");
      return;
    }

    empty.classList.add("hidden");
    summary.classList.remove("hidden");

    const avg = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length;
    const bars = [5, 4, 3, 2, 1].map((star) => {
      const count = reviews.filter((r) => r.stars === star).length;
      const pct = (count / reviews.length) * 100;
      return { star, count, pct };
    });

    summary.innerHTML = `
      <div class="summary-score">
        <div class="big">${avg.toFixed(1)}</div>
        <div class="stars-display">${renderStars(Math.round(avg))}</div>
        <div class="count">${reviews.length} reseña${reviews.length !== 1 ? "s" : ""}</div>
      </div>
      <div class="summary-bars">
        ${bars
          .map(
            (b) => `
          <div class="bar-row">
            <span>${b.star}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${b.pct}%"></div></div>
            <span>${b.count}</span>
          </div>`
          )
          .join("")}
      </div>`;

    grid.innerHTML = [...reviews]
      .reverse()
      .map(
        (r, i) => `
      <article class="review-card" style="animation-delay:${i * 0.05}s">
        <div class="review-header">
          <div class="review-avatar">${r.name.charAt(0)}</div>
          <div class="review-meta">
            <h4>${r.name}</h4>
            <span class="review-date">${new Date(r.date).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })}</span>
          </div>
        </div>
        <div class="review-stars">${renderStars(r.stars)}</div>
        <span class="review-product-tag">${r.product}</span>
        <p class="review-text">${escapeHtml(r.message)}</p>
      </article>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function populateReviewProducts() {
    const select = $("#reviewProduct");
    select.innerHTML = lastOrderProducts
      .map((p) => `<option value="${p.name}">${p.name}</option>`)
      .join("");
  }

  /* ---- Checkout ---- */
  function handleCheckout(e) {
    e.preventDefault();

    const name = $("#customerName").value.trim();
    const email = $("#customerEmail").value.trim();
    const payment = document.querySelector('input[name="payment"]:checked');

    if (!payment) {
      showToast("Selecciona un método de pago", "warning");
      return;
    }

    lastOrderProducts = cart.map((item) => ({
      name: item.name,
      qty: item.qty,
    }));

    const paymentLabels = {
      litecoin: "Litecoin (LTC)",
      paypal: "PayPal Amigos y Familiares",
      stripe: "Stripe",
    };

    const total = getCartTotal();
    cart = [];
    saveCart();
    updateCartUI();

    closeModal("#checkoutModal");
    closeModal("#cartModal");

    showToast(`Pedido confirmado — ${formatPrice(total)} vía ${paymentLabels[payment.value]}`);

    setTimeout(() => {
      selectedStars = 0;
      $$("#starRating .star").forEach((s) => s.classList.remove("active"));
      $("#reviewStars").value = "";
      $("#reviewMessage").value = "";
      populateReviewProducts();
      openModal("#reviewModal");
    }, 800);
  }

  function handleReviewSubmit(e) {
    e.preventDefault();

    if (!selectedStars) {
      showToast("Selecciona entre 1 y 5 estrellas", "warning");
      return;
    }

    const name = $("#customerName").value.trim() || "Cliente";
    const message = $("#reviewMessage").value.trim();
    const product = $("#reviewProduct").value;

    reviews.push({
      id: Date.now().toString(),
      name: name.split(" ")[0] + " " + (name.split(" ")[1]?.charAt(0) || "") + ".",
      stars: selectedStars,
      message,
      product,
      date: new Date().toISOString(),
    });

    saveReviews();
    renderReviews();
    closeModal("#reviewModal");
    showToast("¡Gracias! Tu reseña ha sido publicada y tu garantía está activa.");
  }

  function handleSkipReview() {
    closeModal("#reviewModal");
    showToast("Compra completada sin garantía — recuerda dejar tu reseña la próxima vez", "warning");
  }

  /* ---- Navigation ---- */
  function initNavigation() {
    const header = $("#header");

    window.addEventListener("scroll", () => {
      header.classList.toggle("scrolled", window.scrollY > 50);
    });

    $$(".nav-link").forEach((link) => {
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
            const id = entry.target.id;
            $$(".nav-link").forEach((l) => {
              l.classList.toggle("active", l.dataset.section === id);
            });
          }
        });
      },
      { threshold: 0.3, rootMargin: "-80px 0px -40% 0px" }
    );
    sections.forEach((s) => observer.observe(s));

    $("#menuToggle").addEventListener("click", () => {
      $("#nav").classList.toggle("open");
    });
  }

  /* ---- Filters ---- */
  function initFilters() {
    $$(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderProducts(btn.dataset.filter);
      });
    });
  }

  /* ---- Star Rating ---- */
  function initStarRating() {
    $$("#starRating .star").forEach((star) => {
      star.addEventListener("click", () => {
        selectedStars = Number(star.dataset.value);
        $("#reviewStars").value = selectedStars;
        $$("#starRating .star").forEach((s) => {
          s.classList.toggle("active", Number(s.dataset.value) <= selectedStars);
        });
      });

      star.addEventListener("mouseenter", () => {
        const val = Number(star.dataset.value);
        $$("#starRating .star").forEach((s) => {
          s.style.color =
            Number(s.dataset.value) <= val ? "var(--gold)" : "";
        });
      });

      star.addEventListener("mouseleave", () => {
        $$("#starRating .star").forEach((s) => {
          s.style.color = "";
        });
      });
    });
  }

  /* ---- Modals ---- */
  function initModals() {
    $("#cartBtn").addEventListener("click", () => openModal("#cartModal"));
    $("#cartClose").addEventListener("click", () => closeModal("#cartModal"));
    $("#checkoutClose").addEventListener("click", () => closeModal("#checkoutModal"));
    $("#reviewClose").addEventListener("click", () => closeModal("#reviewModal"));

    $("#checkoutBtn").addEventListener("click", () => {
      if (cart.length === 0) return;
      closeModal("#cartModal");
      $("#checkoutTotal").textContent = formatPrice(getCartTotal());
      openModal("#checkoutModal");
    });

    $("#cartShopBtn").addEventListener("click", () => {
      closeModal("#cartModal");
    });

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
    $("#skipReview").addEventListener("click", handleSkipReview);
  }

  /* ---- Init ---- */
  function init() {
    loadCart();
    loadReviews();
    renderProducts();
    renderReviews();
    updateCartUI();
    initNavigation();
    initFilters();
    initStarRating();
    initModals();

    $("#statProducts").textContent = PRODUCTS.length + "+";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
