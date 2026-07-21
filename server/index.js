require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const { initDb, saveDb } = require("./db");
const { uploadDir } = require("./paths");

const productsRouter = require("./routes/products");
const ordersRouter = require("./routes/orders");
const reviewsRouter = require("./routes/reviews");
const adminRouter = require("./routes/admin");
const configRouter = require("./routes/config");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use("/api/orders/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const uploadDirResolved = uploadDir;
if (!fs.existsSync(uploadDirResolved)) fs.mkdirSync(uploadDirResolved, { recursive: true });
app.use("/uploads", express.static(uploadDirResolved));
app.use("/css", express.static(path.join(__dirname, "../css")));
app.use(express.static(path.join(__dirname, "../public")));

app.use("/api", configRouter);
app.use("/api/products", productsRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin", adminRouter);

app.get("/sitemap.xml", (req, res) => {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><priority>1.0</priority></url>
  <url><loc>${base}/track.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/admin.html</loc><priority>0.3</priority></url>
</urlset>`);
});

app.get("/robots.txt", (req, res) => {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/admin\nSitemap: ${base}/sitemap.xml`);
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

initDb()
  .then(() => {
    const { dbPath } = require("./db");
    console.log(`Database: ${dbPath}`);
    app.listen(PORT, HOST, () => {
      const base = process.env.BASE_URL || `http://localhost:${PORT}`;
      console.log(`Cludy Shop running on ${base}`);
      console.log(`Admin panel: ${base}/admin.html`);
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });

function shutdown() {
  saveDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", saveDb);
