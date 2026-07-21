(function () {
  "use strict";

  function setLoggedOut() {
    document.querySelectorAll(".header-login-btn").forEach((el) => el.classList.remove("hidden"));
    document.querySelectorAll(".header-account-btn").forEach((el) => el.classList.add("hidden"));
  }

  function setLoggedIn() {
    document.querySelectorAll(".header-login-btn").forEach((el) => el.classList.add("hidden"));
    document.querySelectorAll(".header-account-btn").forEach((el) => el.classList.remove("hidden"));
  }

  async function updateAuthHeader() {
    try {
      const res = await fetch("/api/admin/me", { credentials: "include" });
      if (!res.ok) {
        setLoggedOut();
        return null;
      }
      const data = await res.json();
      setLoggedIn();
      return data;
    } catch {
      setLoggedOut();
      return null;
    }
  }

  window.updateAuthHeader = updateAuthHeader;
  document.addEventListener("DOMContentLoaded", updateAuthHeader);
})();
