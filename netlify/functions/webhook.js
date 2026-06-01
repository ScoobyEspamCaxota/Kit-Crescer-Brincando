"use strict";

const {
  QP_WEBHOOK_SECRET,
  findOrder,
  getHeader,
  json,
  notifyUtmify,
  rawBody,
  saveOrder,
  verifySignature,
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo nao permitido." });
  }

  const raw = rawBody(event);
  const evtHeader = getHeader(event, "Quacpay-Event") || "";
  const sig = getHeader(event, "Quacpay-Signature") || "";

  if (QP_WEBHOOK_SECRET && !verifySignature(raw, sig, QP_WEBHOOK_SECRET)) {
    console.warn("[webhook] assinatura invalida");
    return { statusCode: 401, body: "invalid signature" };
  }

  try {
    const payload = raw ? JSON.parse(raw) : {};
    const charge = payload?.dados?.charge || payload?.data?.charge || payload?.charge || {};
    const chargeId =
      charge.chargeId ||
      charge.payment_id ||
      payload.chargeId ||
      payload.id_ou_correlation ||
      charge.correlationID ||
      "";
    const evt = evtHeader || payload.evento || payload.event || "";

    const paidEvents = ["charge.paid", "payment_link.paid", "payment.paid"];
    const paidStatuses = ["RECEIVED", "PAID", "CONFIRMED", "COMPLETED"];
    const isPaid =
      paidEvents.includes(evt) ||
      paidStatuses.includes(String(charge.status || "").toUpperCase());

    if (chargeId && isPaid) {
      const order = await findOrder(chargeId);
      if (order) {
        order.status = "PAID";
        order.paidAt = new Date().toISOString();
        await saveOrder(order);
        await notifyUtmify(order, "paid");
        console.log(`[webhook] PAGO: ${order.chargeId}`);
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error("[webhook]", e);
    return json(500, { error: "Erro no servidor: " + e.message });
  }
};
