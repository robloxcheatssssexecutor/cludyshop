(function () {
  "use strict";

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function renderLogoMarkup(logo, className = "logo-img") {
    if (logo.url) {
      return `<img src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.alt)}" class="${className}">`;
    }
    return `<span class="logo-icon">${escapeHtml(logo.letter || "C")}</span>`;
  }

  function renderBrandText(brand) {
    const name = escapeHtml(brand.name || "Cludy");
    const accent = escapeHtml(brand.accent || "Shop");
    return `${name}<span class="logo-accent">${accent}</span>`;
  }

  function applyBranding(branding) {
    if (!branding) return;

    const logo = {
      url: branding.logo_url || "",
      letter: branding.logo_letter || "C",
      alt: `${branding.brand_name || "Cludy"} ${branding.brand_accent || "Shop"}`.trim(),
    };
    const brand = {
      name: branding.brand_name || "Cludy",
      accent: branding.brand_accent || "Shop",
    };

    document.querySelectorAll(".logo").forEach((el) => {
      el.innerHTML = `${renderLogoMarkup(logo)}<span class="logo-text">${renderBrandText(brand)}</span>`;
    });

    document.querySelectorAll(".footer-brand .logo-icon, .footer-brand .logo-img").forEach((el) => {
      el.remove();
    });
    const footerBrand = document.querySelector(".footer-brand");
    if (footerBrand) {
      const icon = document.createElement(logo.url ? "img" : "span");
      if (logo.url) {
        icon.src = logo.url;
        icon.alt = logo.alt;
        icon.className = "logo-img footer-logo-img";
      } else {
        icon.className = "logo-icon";
        icon.style.width = "32px";
        icon.style.height = "32px";
        icon.style.fontSize = "1rem";
        icon.textContent = logo.letter;
      }
      footerBrand.insertBefore(icon, footerBrand.firstChild);
    }

    const footerText = document.querySelector("[data-branding='footer-text']");
    if (footerText && branding.footer_text) footerText.textContent = branding.footer_text;

    const heroBadge = document.querySelector("[data-branding='hero-badge']");
    if (heroBadge && branding.hero_badge) heroBadge.textContent = branding.hero_badge;

    const heroTitle = document.querySelector("[data-branding='hero-title']");
    if (heroTitle && branding.hero_title) {
      const highlight = branding.hero_highlight
        ? `<span class="gradient-text">${escapeHtml(branding.hero_highlight)}</span>`
        : "";
      heroTitle.innerHTML = `${escapeHtml(branding.hero_title)}${highlight ? "<br>" + highlight : ""}`;
    }

    const heroDesc = document.querySelector("[data-branding='hero-desc']");
    if (heroDesc && branding.hero_desc) heroDesc.textContent = branding.hero_desc;

    const productsTitle = document.querySelector("[data-branding='products-title']");
    if (productsTitle && branding.products_title) productsTitle.textContent = branding.products_title;

    const aboutTitle = document.querySelector("[data-branding='about-title']");
    if (aboutTitle && branding.about_title) aboutTitle.textContent = branding.about_title;

    if (branding.site_title || branding.brand_name) {
      const suffix = document.body.dataset.brandingTitleSuffix;
      if (suffix) {
        const brandLabel = `${branding.brand_name || "Cludy"}${branding.brand_accent ? ` ${branding.brand_accent}` : ""}`.trim();
        document.title = `${suffix} — ${brandLabel}`;
      } else if (branding.site_title) {
        document.title = branding.site_title;
      }
    }
  }

  async function loadBranding() {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      const config = await res.json();
      applyBranding(config.branding);
    } catch {
      /* offline */
    }
  }

  window.applyBranding = applyBranding;
  document.addEventListener("DOMContentLoaded", loadBranding);
})();
