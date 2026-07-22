const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");
const { dbPath } = require("./paths");
const { ensureDefaultSettings } = require("./services/site-branding");

const dir = path.dirname(dbPath);

let sqlDb = null;
let persistEnabled = false;
let saveSuppressed = 0;

function saveDb() {
  if (!persistEnabled || !sqlDb) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = Buffer.from(sqlDb.export());
  const tmpPath = `${dbPath}.tmp`;
  fs.writeFileSync(tmpPath, data);
  try {
    fs.renameSync(tmpPath, dbPath);
  } catch {
    fs.writeFileSync(dbPath, data);
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
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
        if (saveSuppressed === 0) saveDb();
        return { lastInsertRowid, changes };
      },
    };
  },
  exec(sql) {
    sqlDb.exec(sql);
    if (saveSuppressed === 0) saveDb();
  },
  batch(fn) {
    saveSuppressed++;
    sqlDb.run("BEGIN TRANSACTION");
    try {
      const result = fn();
      sqlDb.run("COMMIT");
      return result;
    } catch (err) {
      try {
        sqlDb.run("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      saveSuppressed--;
      if (saveSuppressed === 0) saveDb();
    }
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

  persistEnabled = true;

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
      delivery_type TEXT DEFAULT 'file',
      delivery_text TEXT DEFAULT '',
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

  db.prepare("UPDATE products SET active = 0 WHERE category = 'techniques'").run();

  const legacyCategoryMap = {
    packs: "variety",
    scripts: "tools",
    guides: "methods",
    configs: "tools",
    templates: "variety",
    digital: "variety",
    techniques: "methods",
  };
  for (const [from, to] of Object.entries(legacyCategoryMap)) {
    db.prepare("UPDATE products SET category = ? WHERE category = ?").run(to, from);
  }

  const productColumns = db.prepare("PRAGMA table_info(products)").all().map((col) => col.name);
  if (!productColumns.includes("delivery_type")) {
    db.exec("ALTER TABLE products ADD COLUMN delivery_type TEXT DEFAULT 'file'");
  }
  if (!productColumns.includes("delivery_text")) {
    db.exec("ALTER TABLE products ADD COLUMN delivery_text TEXT DEFAULT ''");
  }
  if (!productColumns.includes("offer_expires_at")) {
    db.exec("ALTER TABLE products ADD COLUMN offer_expires_at TEXT");
  }

  const reviewColumns = db.prepare("PRAGMA table_info(reviews)").all().map((col) => col.name);
  if (!reviewColumns.includes("source")) {
    db.exec("ALTER TABLE reviews ADD COLUMN source TEXT");
  }
  if (!reviewColumns.includes("source_id")) {
    db.exec("ALTER TABLE reviews ADD COLUMN source_id TEXT");
  }

  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((col) => col.name);
  if (!orderColumns.includes("customer_ip")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_ip TEXT DEFAULT ''");
  }

  ensureDefaultSettings(db);

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

  saveDb();
}

function generateOrderCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "CLUDY-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = { db, initDb, generateOrderCode, saveDb, dbPath };
