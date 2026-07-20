const express = require("express");
const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/config", (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    ltcWallet: process.env.LTC_WALLET_ADDRESS || "",
    paypalEmail: process.env.PAYPAL_EMAIL || "",
    discordUrl: process.env.DISCORD_URL || "https://discord.gg/WPrr4kFWyn",
    baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get("host")}`,
  });
});

module.exports = router;
