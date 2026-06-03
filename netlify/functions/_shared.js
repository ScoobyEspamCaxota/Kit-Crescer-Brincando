"use strict";

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

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
} = process.env;

const TRACKING_KEYS = [
  "src",
  "sck",
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_content",
  "utm_term",
];

let tokenCache = { value: null, exp: 0 };

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
const QP_TIMEOUT_MS = Math.max(3000, Number(process.env.QP_TIMEOUT_MS || 9000));
const QP_RETRY_DELAY_MS = 450;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = QP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text().catch(() => "");
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 500) };
    }
    return { response, data };
  } catch (e) {
    const error = new Error(
      e.name === "AbortError"
        ? "Tempo limite ao comunicar com o gateway de pagamento."
        : e.message || "Falha de rede ao comunicar com o gateway de pagamento."
    );
    error.transient = true;
    error.timeout = e.name === "AbortError";
    error.statusCode = error.timeout ? 504 : 502;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function connectBlobs(event) {
  connectLambda(event);
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? headers[found] : "";
}

function rawBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

function parseJsonBody(event) {
  const raw = rawBody(event);
  if (!raw) return {};
  return JSON.parse(raw);
}

function getClientIp(event) {
  return String(getHeader(event, "x-forwarded-for") || "").split(",")[0].trim();
}

function validBuyer(b) {
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim();
  if (name.length < 3) return "Informe o nome completo.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "E-mail inválido.";
  return null;
}

function normalizeTracking(input = {}) {
  const tracking = {};
  for (const key of TRACKING_KEYS) {
    const value = input[key] == null ? "" : String(input[key]).trim();
    tracking[key] = value || null;
  }
  return tracking;
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.exp - 30000) return tokenCache.value;
  if (!QP_CLIENT_ID || !QP_CLIENT_SECRET) {
    throw new Error("Credenciais QuacPay ausentes no Netlify.");
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { response, data } = await fetchJsonWithTimeout(`${QP_BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: QP_CLIENT_ID,
          client_secret: QP_CLIENT_SECRET,
        }),
      });

      if (response.ok && data.access_token) {
        const ttl = Math.max(60, Number(data.expires_in || 3600)) * 1000;
        tokenCache = { value: data.access_token, exp: now + ttl };
        return tokenCache.value;
      }

      if (!isTransientStatus(response.status) || attempt === 2) {
        throw new Error(`OAuth falhou (${response.status}): ${data.message || JSON.stringify(data)}`);
      }
    } catch (e) {
      if (e.timeout || !e.transient || attempt === 2) throw e;
    }

    await wait(QP_RETRY_DELAY_MS);
  }
}

async function qpFetch(pathname, { method = "GET", body } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const token = await getToken();
      const { response, data } = await fetchJsonWithTimeout(`${QP_BASE}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 401 && attempt === 1) {
        tokenCache = { value: null, exp: 0 };
        await wait(QP_RETRY_DELAY_MS);
        continue;
      }

      if (!response.ok && isTransientStatus(response.status) && attempt === 1) {
        await wait(QP_RETRY_DELAY_MS);
        continue;
      }

      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      lastError = e;
      if (e.timeout || !e.transient || attempt === 2) throw e;
      await wait(QP_RETRY_DELAY_MS);
    }
  }

  throw lastError || new Error("Falha ao comunicar com o gateway de pagamento.");
}

function ordersStore() {
  return getStore("orders");
}

async function getOrder(chargeId) {
  return ordersStore().get(chargeId, { type: "json" });
}

async function saveOrder(order) {
  await ordersStore().setJSON(order.chargeId, order);
}

async function findOrder(chargeId) {
  if (!chargeId) return null;
  const direct = await getOrder(chargeId).catch(() => null);
  if (direct) return direct;

  const store = ordersStore();
  const list = await store.list();
  for (const blob of list.blobs || []) {
    const order = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (order && (order.chargeId === chargeId || order.correlationID === chargeId || order.externalReference === chargeId)) {
      return order;
    }
  }
  return null;
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function formatUtcForUtmify(value) {
  const d = value ? new Date(value) : new Date();
  return d.toISOString().replace("T", " ").slice(0, 19);
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

async function notifyUtmify(order, status) {
  try {
    await sendUtmifyOrder(order, status);
  } catch (e) {
    console.warn(`[utmify] ${e.message}`);
  }
}

function verifySignature(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    String(header).split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim(), v?.trim()];
    })
  );
  const t = parts.t;
  const v1 = parts.v1 || header;
  const base = t ? `${t}.${raw}` : raw;
  const mac = crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(v1));
  } catch {
    return false;
  }
}

function envInfo() {
  return {
    ok: true,
    hasCreds: Boolean(QP_CLIENT_ID && QP_CLIENT_SECRET),
    hasUtmify: Boolean(UTMIFY_API_TOKEN),
    hasDownload: Boolean(DOWNLOAD_URL),
  };
}

module.exports = {
  DOWNLOAD_URL,
  PRICE,
  PRODUCT,
  QP_WEBHOOK_SECRET,
  connectBlobs,
  envInfo,
  findOrder,
  getClientIp,
  getHeader,
  json,
  normalizeTracking,
  notifyUtmify,
  onlyDigits,
  parseJsonBody,
  qpFetch,
  rawBody,
  saveOrder,
  validBuyer,
  verifySignature,
};
