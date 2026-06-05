"use strict";

const {
  PRODUCT,
  connectBlobs,
  getClientIp,
  json,
  normalizeTracking,
  notifyUtmify,
  onlyDigits,
  parseJsonBody,
  qpFetch,
  resolveCheckoutPricing,
  saveOrder,
  validBuyer,
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo nao permitido." });
  }

  try {
    connectBlobs(event);
    const buyer = parseJsonBody(event);
    const err = validBuyer(buyer);
    if (err) return json(400, { error: err });

    const pricing = resolveCheckoutPricing(buyer.offer, { bump: buyer.bump, bumps: buyer.bumps });
    const { offer, addons, value } = pricing;
    const phone = onlyDigits(buyer.phone);
    const externalReference = (offer.id === "rescue" ? "RJR-" : "RJ-") + Date.now();
    const charge = await qpFetch("/api/v1/charges/pix", {
      method: "POST",
      body: { value, externalReference },
    });

    if (!charge.ok || !charge.data?.success) {
      return json(502, {
        error: charge.data?.message || "Falha ao gerar cobranca PIX.",
        detail: charge.data,
      });
    }

    const c = charge.data;
    const order = {
      chargeId: c.chargeId,
      correlationID: c.correlationID || externalReference,
      externalReference,
      offer: offer.id,
      addons,
      status: "ACTIVE",
      value,
      offerValue: offer.value,
      buyer: { name: buyer.name, email: buyer.email, phone },
      tracking: normalizeTracking(buyer.tracking),
      ip: getClientIp(event),
      createdAt: new Date().toISOString(),
    };
    await saveOrder(order);
    notifyUtmify(order, "waiting_payment");

    return json(200, {
      chargeId: c.chargeId,
      qrCode: c.qrCode || "",
      qrCodePayload: c.qrCodePayload || "",
      paymentLink: c.paymentLink || "",
      value,
      offer: offer.id,
      addons,
      product: PRODUCT,
    });
  } catch (e) {
    console.error("[checkout]", e);
    return json(e.statusCode || 500, { error: "Erro no servidor: " + e.message });
  }
};
