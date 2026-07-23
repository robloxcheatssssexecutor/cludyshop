const { db } = require("../db");

const LTC_SATOSHI = 100_000_000;
const SCAN_INTERVAL_MS = 60_000;
const MIN_CONFIRMATIONS = Number(process.env.LTC_MIN_CONFIRMATIONS) || 2;
const WATCH_HOURS = Number(process.env.LTC_WATCH_HOURS) || 48;

let watcherTimer = null;
let scanning = false;

function calculateLtcAmount(totalEur, orderId) {
  const rate = Number(process.env.LTC_EUR_RATE) || 80;
  const base = totalEur / rate;
  const offset = ((orderId % 999) + 1) / 1_000_000;
  return Number((base + offset).toFixed(6));
}

function litoshisToLtc(litoshis) {
  return litoshis / LTC_SATOSHI;
}

function amountMatches(expectedLtc, litoshis) {
  const expected = Math.round(expectedLtc * LTC_SATOSHI);
  return Math.abs(litoshis - expected) <= 1;
}

function isWithinWatchWindow(order) {
  const created = new Date(order.created_at).getTime();
  const maxAge = WATCH_HOURS * 60 * 60 * 1000;
  return Date.now() - created <= maxAge;
}

async function fetchIncomingPayments(address) {
  const token = process.env.BLOCKCYPHER_TOKEN;
  const url = new URL(`https://api.blockcypher.com/v1/ltc/main/addrs/${encodeURIComponent(address)}/full`);
  url.searchParams.set("limit", "50");
  if (token) url.searchParams.set("token", token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BlockCypher ${res.status}: ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  const payments = [];

  for (const tx of data.txs || []) {
    for (const output of tx.outputs || []) {
      if (!output.addresses?.includes(address)) continue;
      payments.push({
        txHash: tx.hash,
        value: output.value,
        received: tx.received,
        confirmed: tx.confirmed,
        confirmations: tx.confirmations ?? 0,
      });
    }
  }

  return payments;
}

function findMatchingPayment(order, payments) {
  const orderCreated = new Date(order.created_at).getTime() - 5 * 60 * 1000;
  const expectedLtc = order.ltc_amount ?? calculateLtcAmount(order.total, order.id);

  const usedHashes = new Set(
    db
      .prepare("SELECT ltc_tx_hash FROM orders WHERE ltc_tx_hash IS NOT NULL AND ltc_tx_hash != '' AND id != ?")
      .all(order.id)
      .map((row) => row.ltc_tx_hash)
  );

  const candidates = payments
    .filter((payment) => {
      if (usedHashes.has(payment.txHash)) return false;
      if (!amountMatches(expectedLtc, payment.value)) return false;
      const receivedAt = new Date(payment.received || payment.confirmed || 0).getTime();
      return receivedAt >= orderCreated;
    })
    .sort((a, b) => new Date(b.received).getTime() - new Date(a.received).getTime());

  return candidates[0] || null;
}

async function checkOrderPayment(orderId, markOrderPaid) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order || order.payment_method !== "litecoin" || order.payment_status === "paid") {
    return { matched: false };
  }

  const wallet = process.env.LTC_WALLET_ADDRESS;
  if (!wallet) return { matched: false, error: "LTC wallet not configured" };

  if (!isWithinWatchWindow(order)) return { matched: false, expired: true };

  const payments = await fetchIncomingPayments(wallet);
  const match = findMatchingPayment(order, payments);
  if (!match) return { matched: false };

  db.prepare("UPDATE orders SET ltc_tx_hash = ?, payment_status = 'pending_verification' WHERE id = ?").run(
    match.txHash,
    order.id
  );

  if (match.confirmations >= MIN_CONFIRMATIONS) {
    await markOrderPaid(order.id);
    return { matched: true, confirmed: true, txHash: match.txHash };
  }

  return {
    matched: true,
    confirmed: false,
    txHash: match.txHash,
    confirmations: match.confirmations,
    requiredConfirmations: MIN_CONFIRMATIONS,
  };
}

async function scanPendingLtcOrders(markOrderPaid) {
  if (scanning || !process.env.LTC_WALLET_ADDRESS) return;
  scanning = true;

  try {
    const orders = db
      .prepare(
        `SELECT * FROM orders
         WHERE payment_method = 'litecoin'
           AND payment_status IN ('pending', 'pending_verification')
         ORDER BY created_at DESC`
      )
      .all();

    for (const order of orders) {
      if (!isWithinWatchWindow(order)) continue;
      try {
        await checkOrderPayment(order.id, markOrderPaid);
      } catch (err) {
        console.error(`LTC check failed for order ${order.order_code}:`, err.message);
      }
    }
  } finally {
    scanning = false;
  }
}

function startLtcWatcher(markOrderPaid) {
  if (watcherTimer || !process.env.LTC_WALLET_ADDRESS) {
    if (!process.env.LTC_WALLET_ADDRESS) {
      console.warn("LTC watcher disabled: LTC_WALLET_ADDRESS not set");
    }
    return;
  }

  console.log(`LTC watcher started (${MIN_CONFIRMATIONS} confirmations required)`);
  scanPendingLtcOrders(markOrderPaid).catch((err) => console.error("LTC scan error:", err.message));

  watcherTimer = setInterval(() => {
    scanPendingLtcOrders(markOrderPaid).catch((err) => console.error("LTC scan error:", err.message));
  }, SCAN_INTERVAL_MS);
}

module.exports = {
  calculateLtcAmount,
  checkOrderPayment,
  scanPendingLtcOrders,
  startLtcWatcher,
};
