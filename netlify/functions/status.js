"use strict";

const { buildDownloadLinks, connectBlobs, findOrder, json } = require("./_shared");

function chargeIdFromPath(event) {
  const path = event.path || "";
  return decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Metodo nao permitido." });
  }

  try {
    connectBlobs(event);
    const chargeId = chargeIdFromPath(event);
    const order = await findOrder(chargeId);
    if (!order) return json(404, { status: "UNKNOWN" });

    const downloadLinks = order.status === "PAID" ? buildDownloadLinks(order) : [];

    return json(200, {
      status: order.status,
      paidAt: order.paidAt || null,
      downloadUrl: downloadLinks[0]?.url || null,
      downloadLinks,
    });
  } catch (e) {
    console.error("[status]", e);
    return json(500, { error: "Erro no servidor: " + e.message });
  }
};
