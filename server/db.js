const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DATABASE_PATH || "./data/cludy.db";
const dir = path.dirname(dbPath);

let sqlDb = null;
let persistEnabled = false;

function saveDb() {
  if (!persistEnabled || !sqlDb) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(sqlDb.export()));
}

function bindParams(stmt, params) {
  if (params.length) stmt.bind(params);
}

const db = {
  prepare(sql) {
    return {
      get(...params) {
        const stmt = sqlDb.prepare(sql);
        try {
          bindParams(stmt, params);
          if (stmt.step()) return stmt.getAsObject();
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...params) {
        const stmt = sqlDb.prepare(sql);
        try {
          bindParams(stmt, params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      },
      run(...params) {
        sqlDb.run(sql, params);
        const lastInsertRowid = sqlDb.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0];
        const changes = sqlDb.getRowsModified();
        saveDb();
        return { lastInsertRowid, changes };
      },
    };
  },
  exec(sql) {
    sqlDb.exec(sql);
    saveDb();
  },
};

async function initDb() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    sqlDb = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.run("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL,
      category TEXT NOT NULL DEFAULT 'digital',
      image_url TEXT DEFAULT '',
      stock INTEGER DEFAULT -1,
      show_stock INTEGER DEFAULT 0,
      purchase_count INTEGER DEFAULT 0,
      show_purchases INTEGER DEFAULT 1,
      offer_price REAL,
      offer_active INTEGER DEFAULT 0,
      offer_label TEXT DEFAULT '',
      digital_file TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      total REAL NOT NULL,
      stripe_session_id TEXT,
      ltc_tx_hash TEXT,
      paypal_note TEXT,
      download_token TEXT UNIQUE,
      review_submitted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      paid_at TEXT,
      delivered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER DEFAULT 1,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      customer_name TEXT NOT NULL,
      stars INTEGER NOT NULL CHECK(stars >= 1 AND stars <= 5),
      message TEXT NOT NULL,
      product_name TEXT NOT NULL,
      approved INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const count = db.prepare("SELECT COUNT(*) as c FROM products").get().c;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO products (name, description, price, category, stock, show_stock, purchase_count, show_purchases, offer_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const samples = [
      ["Pack Premium Digital", "Colección de archivos .txt y recursos digitales exclusivos. Entrega instantánea.", 19.99, "packs", 50, 1, 127, 1, 0],
      ["Script Pro v2", "Script avanzado en formato .txt listo para usar. Compatible y documentado.", 14.99, "scripts", -1, 0, 89, 1, 0],
      ["Guía Completa Digital", "Manual digital descargable al instante en formato .txt/.pdf.", 9.99, "guides", 100, 1, 234, 1, 1],
      ["Bundle Ultimate", "Todos los productos digitales en un solo pack con descuento incluido.", 49.99, "packs", 25, 1, 56, 1, 0],
      ["Config Elite .txt", "Archivo de configuración optimizada premium. Descarga directa.", 7.99, "configs", -1, 0, 312, 1, 0],
      ["Plantillas Pack", "Pack de plantillas editables en múltiples formatos digitales.", 12.99, "templates", 75, 1, 98, 1, 0],
      ["Starter Digital Kit", "Kit inicial perfecto para empezar. Archivos listos para descargar.", 4.99, "packs", -1, 0, 501, 1, 0],
    ];
    for (const s of samples) insert.run(...s);
    db.prepare("UPDATE products SET offer_price = 6.99, offer_label = '-30% OFERTA' WHERE name = 'Guía Completa Digital'").run();
  }

  db.prepare("UPDATE products SET active = 0 WHERE category = 'techniques'").run();

  const reviewCount = db.prepare("SELECT COUNT(*) as c FROM reviews").get().c;
  if (reviewCount === 0) {
    const insertReview = db.prepare(`
      INSERT INTO reviews (customer_name, stars, message, product_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertReview.run("Carlos M.", 5, "Entrega instantánea del archivo digital. Todo perfecto, muy recomendado.", "Pack Premium Digital", "2026-07-15T10:00:00.000Z");
    insertReview.run("Laura S.", 5, "Pago con Stripe y en segundos tenía mi descarga. Excelente tienda.", "Script Pro v2", "2026-07-10T14:30:00.000Z");
    insertReview.run("Diego R.", 4, "Buena calidad en los archivos. Litecoin funcionó sin problemas.", "Guía Completa PDF", "2026-07-05T09:15:00.000Z");
  }

  persistEnabled = true;
  saveDb();
}

function generateOrderCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "CLUDY-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = { db, initDb, generateOrderCode };
