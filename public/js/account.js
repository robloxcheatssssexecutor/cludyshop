(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  function showToast(msg, type = "success") {
    const toast = $("#toast");
    toast.textContent = msg;
    toast.className = "toast show " + type;
    setTimeout(() => toast.classList.remove("show"), 4000);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: "include",
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...opts.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error de servidor");
    return data;
  }

  function showLoginView() {
    $("#accountLogin").classList.remove("hidden");
    $("#accountDashboard").classList.add("hidden");
    $("#adminSection").classList.add("hidden");
    window.updateAuthHeader?.();
  }

  function showAccountView(user, isAdmin) {
    $("#accountLogin").classList.add("hidden");
    $("#accountDashboard").classList.remove("hidden");
    $("#accountUser").textContent = user;
    $("#adminSection").classList.toggle("hidden", !isAdmin);
    window.updateAuthHeader?.();
  }

  async function checkSession() {
    try {
      const me = await api("/api/admin/me");
      showAccountView(me.user, me.isAdmin === true);
      return true;
    } catch {
      showLoginView();
      if (window.location.hash === "#login") {
        $("#loginUser")?.focus();
      }
      return false;
    }
  }

  async function init() {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Entrando...";

      try {
        const data = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({
            username: $("#loginUser").value.trim(),
            password: $("#loginPass").value,
          }),
        });
        showToast("Sesión iniciada correctamente");
        showAccountView(data.user, data.isAdmin === true);
        history.replaceState(null, "", "/account.html");
      } catch (err) {
        showToast(err.message, "warning");
      } finally {
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });

    $("#logoutBtn").addEventListener("click", async () => {
      try {
        await api("/api/admin/logout", { method: "POST" });
      } catch {
        /* ignore */
      }
      showToast("Sesión cerrada");
      showLoginView();
      $("#loginPass").value = "";
    });

    await checkSession();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
