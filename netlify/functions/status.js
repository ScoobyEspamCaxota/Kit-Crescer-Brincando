"use strict";

const { DOWNLOAD_URL, findOrder, json } = require("./_shared");

function chargeIdFromPath(event) {
  const path = event.path || "";
  return decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Metodo nao permitido." });
  }

  try {
    const chargeId = chargeIdFromPath(event);
    const order = await findOrder(chargeId);
    if (!order) return json(404, { status: "UNKNOWN" });

    return json(200, {
      status: order.status,
      paidAt: order.paidAt || null,
      downloadUrl: order.status === "PAID" ? DOWNLOAD_URL || null : null,
    });
  } catch (e) {
    console.error("[status]", e);
    return json(500, { error: "Erro no servidor: " + e.message });
  }
};
