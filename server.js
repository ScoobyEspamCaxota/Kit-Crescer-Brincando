/* =========================================================
   Crescer Brincando — backend de pagamento (QuacPay PIX)
   Serve o site estático + rotas /api.
   Credenciais ficam SÓ aqui (backend), nunca no frontend.
   ========================================================= */
"use strict";
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  QP_BASE = "https://quacpay.com",
  QP_CLIENT_ID = "",
  QP_CLIENT_SECRET = "",
  QP_WEBHOOK_SECRET = "",
  PRICE = "29.90",
  PRODUCT = "Kit Crescer Brincando",
  UTMIFY_API_TOKEN = "",
  UTMIFY_ENDPOINT = "https://api.utmify.com.br/api-credentials/orders",
  UTMIFY_PLATFORM = "QuacPay",
  UTMIFY_IS_TEST = "false",
  DOWNLOAD_URL = "",
  PORT = "3000",
} = process.env;

const app = express();
const ROOT = __dirname;
const ORDERS_FILE = path.join(ROOT, "orders.json");

/* ---------- store simples (arquivo JSON) ---------- */
function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); }
  catch { return {}; }
}
function writeOrders(o) {
  try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2)); }
  catch (e) { console.error("orders write fail", e.message); }
}

/* ---------- cache do token OAuth ---------- */
let tokenCache = { value: null, exp: 0 };
async function getToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.exp - 30000) return tokenCache.value;
  if (!QP_CLIENT_ID || !QP_CLIENT_SECRET) {
    throw new Error("Credenciais QuacPay ausentes. Preencha QP_CLIENT_ID e QP_CLIENT_SECRET no .env");
  }
  const r = await fetch(`${QP_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: QP_CLIENT_ID,
      client_secret: QP_CLIENT_SECRET,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(`OAuth falhou (${r.status}): ${data.message || JSON.stringify(data)}`);
  }
  const ttl = (data.expires_in ? Number(data.expires_in) : 3600) * 1000;
  tokenCache = { value: data.access_token, exp: now + ttl };
  return tokenCache.value;
}

async function qpFetch(pathname, { method = "GET", body } = {}) {
  const token = await getToken();
  const r = await fetch(`${QP_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/* ---------- helpers ---------- */
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

const TRACKING_KEYS = [
  "src",
  "sck",
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_content",
  "utm_term",
];

function validBuyer(b) {
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim();
  if (name.length < 3) return "Informe o nome completo.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "E-mail inválido.";
  return null;
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function formatUtcForUtmify(value) {
  const d = value ? new Date(value) : new Date();
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function getClientIp(req) {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "";
}

function normalizeTracking(input = {}) {
  const tracking = {};
  for (const key of TRACKING_KEYS) {
    const value = input[key] == null ? "" : String(input[key]).trim();
    tracking[key] = value || null;
  }
  return tracking;
}

function buildUtmifyPayload(order, status) {
  const totalPriceInCents = toCents(order.value);
  const paidAt = order.paidAt || null;
  const createdAt = order.createdAt || new Date().toISOString();

  const payload = {
    orderId: order.chargeId || order.externalReference,
    platform: UTMIFY_PLATFORM,
    paymentMethod: "pix",
    status,
    createdAt: formatUtcForUtmify(createdAt),
    approvedDate: status === "paid" && paidAt ? formatUtcForUtmify(paidAt) : null,
    refundedAt: null,
    customer: {
      name: order.buyer?.name || "",
      email: order.buyer?.email || "",
      phone: order.buyer?.phone || null,
      document: order.buyer?.document || order.buyer?.cpf || null,
      country: "BR",
      ip: order.ip || undefined,
    },
    products: [
      {
        id: "kit-crescer-brincando",
        name: PRODUCT,
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: totalPriceInCents,
      },
    ],
    trackingParameters: normalizeTracking(order.tracking),
    commission: {
      totalPriceInCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: totalPriceInCents,
      currency: "BRL",
    },
  };

  if (/^true$/i.test(UTMIFY_IS_TEST)) payload.isTest = true;
  return payload;
}

async function sendUtmifyOrder(order, status) {
  if (!UTMIFY_API_TOKEN) return;

  const r = await fetch(UTMIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": UTMIFY_API_TOKEN,
    },
    body: JSON.stringify(buildUtmifyPayload(order, status)),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Utmify ${status} falhou (${r.status}): ${detail.slice(0, 500)}`);
  }
}

function notifyUtmify(order, status) {
  sendUtmifyOrder(order, status)
    .then(() => console.log(`[utmify] ${status}: ${order.chargeId || order.externalReference}`))
    .catch((e) => console.warn(`[utmify] ${e.message}`));
}

/* =========================================================
   WEBHOOK — precisa do corpo RAW p/ validar assinatura.
   Registrado ANTES do express.json.
   ========================================================= */
app.post("/api/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString("utf8") : "";
  const event = req.get("Quacpay-Event") || "";
  const sig = req.get("Quacpay-Signature") || "";

  if (QP_WEBHOOK_SECRET) {
    if (!verifySignature(raw, sig, QP_WEBHOOK_SECRET)) {
      console.warn("[webhook] assinatura inválida");
      return res.status(401).send("invalid signature");
    }
  } else {
    console.warn("[webhook] QP_WEBHOOK_SECRET não definido — validação pulada (dev)");
  }

  let payload = {};
  try { payload = JSON.parse(raw); } catch {}

  // localizar chargeId/correlation no envelope
  const charge = payload?.dados?.charge || payload?.data?.charge || payload?.charge || {};
  const chargeId =
    charge.chargeId || charge.payment_id || payload.chargeId ||
    payload.id_ou_correlation || charge.correlationID || "";
  const evt = event || payload.evento || payload.event || "";

  const paidEvents = ["charge.paid", "payment_link.paid", "payment.paid"];
  const paidStatuses = ["RECEIVED", "PAID", "CONFIRMED", "COMPLETED"];
  const isPaid =
    paidEvents.includes(evt) ||
    paidStatuses.includes(String(charge.status || "").toUpperCase());

  if (chargeId && isPaid) {
    const orders = readOrders();
    const key = findOrderKey(orders, chargeId);
    if (key) {
      orders[key].status = "PAID";
      orders[key].paidAt = new Date().toISOString();
      writeOrders(orders);
      notifyUtmify(orders[key], "paid");
      console.log(`[webhook] PAGO: ${key}`);
    }
  }
  // responde 2xx rápido
  res.status(200).send("ok");
});

function findOrderKey(orders, chargeId) {
  if (orders[chargeId]) return chargeId;
  for (const k of Object.keys(orders)) {
    const o = orders[k];
    if (o.chargeId === chargeId || o.correlationID === chargeId || o.externalReference === chargeId) return k;
  }
  return null;
}

/* assinatura estilo "t=...,v1=..." (Stripe-like) OU hex puro */
function verifySignature(raw, header, secret) {
  if (!header) return false;
  try {
    let t = "", v1 = "";
    if (header.includes("=")) {
      header.split(",").forEach((p) => {
        const [k, val] = p.split("=");
        if (k.trim() === "t") t = val.trim();
        if (k.trim() === "v1" || k.trim() === "s") v1 = val.trim();
      });
    } else {
      v1 = header.trim();
    }
    // janela de 5 min se houver timestamp
    if (t) {
      const ts = Number(t) > 1e12 ? Number(t) : Number(t) * 1000;
      if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
    }
    const signedPayload = t ? `${t}.${raw}` : raw;
    const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(v1 || "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* JSON parser p/ o resto */
app.use(express.json());

/* =========================================================
   CHECKOUT — cria cliente + cobrança PIX
   ========================================================= */
app.post("/api/checkout", async (req, res) => {
  try {
    const buyer = req.body || {};
    const err = validBuyer(buyer);
    if (err) return res.status(400).json({ error: err });

    const phone = onlyDigits(buyer.phone);

    // cobrança PIX SEM cliente (sem CPF — maior conversão).
    // Sem customerId, a gateway usa o documento da loja associado ao token.
    // preço definido pelo SERVIDOR — nunca confiar no cliente.
    const value = Number(PRICE);
    const externalReference = "CB-" + Date.now();
    const charge = await qpFetch("/api/v1/charges/pix", {
      method: "POST",
      body: { value, externalReference },
    });
    if (!charge.ok || !charge.data?.success) {
      return res.status(502).json({
        error: charge.data?.message || "Falha ao gerar cobrança PIX.",
        detail: charge.data,
      });
    }

    const c = charge.data;
    const orders = readOrders();
    const order = {
      chargeId: c.chargeId,
      correlationID: c.correlationID || externalReference,
      externalReference,
      status: "ACTIVE",
      value,
      buyer: { name: buyer.name, email: buyer.email, phone },
      tracking: normalizeTracking(buyer.tracking),
      ip: getClientIp(req),
      createdAt: new Date().toISOString(),
    };
    orders[c.chargeId] = order;
    writeOrders(orders);
    notifyUtmify(order, "waiting_payment");

    res.json({
      chargeId: c.chargeId,
      qrCode: c.qrCode || "",          // imagem base64
      qrCodePayload: c.qrCodePayload || "", // copia-e-cola EMV
      paymentLink: c.paymentLink || "",
      value,
      product: PRODUCT,
    });
  } catch (e) {
    console.error("[checkout]", e.message);
    res.status(500).json({ error: "Erro no servidor: " + e.message });
  }
});

/* =========================================================
   STATUS — frontend consulta (atualizado pelo webhook)
   ========================================================= */
app.get("/api/status/:chargeId", (req, res) => {
  const orders = readOrders();
  const key = findOrderKey(orders, req.params.chargeId);
  if (!key) return res.status(404).json({ status: "UNKNOWN" });
  const order = orders[key];
  res.json({
    status: order.status,
    paidAt: order.paidAt || null,
    downloadUrl: order.status === "PAID" ? DOWNLOAD_URL || null : null,
  });
});

/* health */
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    hasCreds: Boolean(QP_CLIENT_ID && QP_CLIENT_SECRET),
    hasUtmify: Boolean(UTMIFY_API_TOKEN),
    hasDownload: Boolean(DOWNLOAD_URL),
  })
);

/* =========================================================
   ESTÁTICO — serve o site (index.html, app.html, css, js, assets)
   ========================================================= */
app.use(express.static(ROOT, { extensions: ["html"], index: "index.html" }));

app.listen(Number(PORT), () => {
  console.log(`\n  Crescer Brincando rodando em http://localhost:${PORT}`);
  if (!QP_CLIENT_ID || !QP_CLIENT_SECRET) {
    console.log("  ⚠  Preencha QP_CLIENT_ID e QP_CLIENT_SECRET no arquivo .env para o pagamento funcionar.\n");
  } else {
    console.log("  ✓ Credenciais QuacPay carregadas.\n");
  }
});
