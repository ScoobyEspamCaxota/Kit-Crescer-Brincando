/* =========================================================
   Checkout PIX (QuacPay) — frontend
   Intercepta os botões de compra → modal → coleta dados →
   /api/checkout → QR PIX → polling /api/status → sucesso.
   ========================================================= */
(function () {
  "use strict";

  var PRICE_OLD = "R$ 97,90";
  var PRODUCT_NAME = "Kit Crescer Brincando";
  var PRODUCT_ID = "kit-crescer-brincando";
  var OFFERS = {
    main: {
      id: "main",
      value: 29.9,
      price: "R$ 29,90",
      tag: "Oferta ativa",
      cta: "Gerar PIX e pagar",
      promoBadge: "PROMOÇÃO",
      promoText: "Oferta reservada por",
      priceTone: "",
    },
    rescue: {
      id: "rescue",
      value: 14.99,
      price: "R$ 14,99",
      tag: "Condição especial",
      cta: "Garantir por R$ 14,99",
      promoBadge: "OFERTA ESPECIAL",
      promoText: "Condição liberada por",
      priceTone: " ckt-price--rescue",
    },
  };
  var currentOffer = OFFERS.main;
  var rescueShown = false;
  var pollTimer = null;
  var promoTimer = null;
  var promoDeadline = null;
  var PROMO_MINUTES = 12;
  var purchaseTracked = {};
  var CHECKOUT_TIMEOUT_MS = 25000;

  function activeOffer() {
    return currentOffer || OFFERS.main;
  }

  function metaPayload(extra) {
    var offer = activeOffer();
    return Object.assign({
      content_ids: [PRODUCT_ID],
      content_name: PRODUCT_NAME,
      content_type: "product",
      contents: [{ id: PRODUCT_ID, quantity: 1, item_price: offer.value }],
      currency: "BRL",
      num_items: 1,
      value: offer.value,
    }, extra || {});
  }

  function metaEventId(eventName, suffix) {
    return [
      "cb",
      eventName,
      suffix || Date.now(),
      Math.random().toString(36).slice(2, 10),
    ].join("-");
  }

  function metaTrack(eventName, extra, suffix) {
    if (typeof window.fbq !== "function") return;
    window.fbq("track", eventName, metaPayload(extra), {
      eventID: metaEventId(eventName, suffix),
    });
  }

  function trackViewContent() {
    metaTrack("ViewContent", {}, "landing");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackViewContent, { once: true });
  } else {
    trackViewContent();
  }

  /* ---------- monta o modal uma vez ---------- */
  var backdrop = document.createElement("div");
  backdrop.className = "ckt-backdrop";
  backdrop.innerHTML = [
    '<div class="ckt-modal" role="dialog" aria-modal="true" aria-labelledby="ckt-title">',
    '  <div class="ckt-head">',
    '    <h3 id="ckt-title">Finalizar compra</h3>',
    '    <p>Pagamento via PIX • acesso imediato</p>',
    '    <button class="ckt-close" type="button" aria-label="Fechar">&times;</button>',
    "  </div>",
    '  <div class="ckt-body" id="ckt-body"></div>',
    "</div>",
  ].join("");
  document.body.appendChild(backdrop);
  var body = backdrop.querySelector("#ckt-body");

  function open() {
    currentOffer = OFFERS.main;
    rescueShown = false;
    metaTrack("InitiateCheckout", {}, "open");
    backdrop.classList.add("open");
    resetPromoDeadline();
    showForm();
  }
  function forceClose() {
    backdrop.classList.remove("open");
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopPromoCountdown();
    promoDeadline = null;
  }
  function close() {
    if (shouldShowRescueOffer()) {
      showRescueOffer(readFormPrefill());
      return;
    }
    forceClose();
  }
  backdrop.querySelector(".ckt-close").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  function getTrackingParameters() {
    var keys = ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"];
    var params = new URLSearchParams(window.location.search);
    var tracking = {};

    keys.forEach(function (key) {
      var value = params.get(key);
      if (value) {
        tracking[key] = value;
        try { sessionStorage.setItem("ckt_" + key, value); } catch (_) {}
      } else {
        try { tracking[key] = sessionStorage.getItem("ckt_" + key) || ""; } catch (_) { tracking[key] = ""; }
      }
    });

    if (!tracking.sck) {
      tracking.sck = params.get("xcod") || params.get("cid") || "";
      if (tracking.sck) {
        try { sessionStorage.setItem("ckt_sck", tracking.sck); } catch (_) {}
      }
    }
    return tracking;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function apiUrl(path) {
    try { return new URL(path, window.location.origin).toString(); }
    catch (_) { return path; }
  }

  function isTransientCheckoutError(err) {
    var msg = String((err && err.message) || "");
    return (
      err && [408, 429, 500, 502, 503, 504].indexOf(Number(err.status)) !== -1
    ) || /failed to fetch|network|load failed|timeout|tempo limite|string did not match/i.test(msg);
  }

  function friendlyCheckoutMessage(err) {
    if (isTransientCheckoutError(err)) {
      return "Não foi possível gerar o PIX agora. Tente novamente em alguns segundos.";
    }
    return (err && err.message) || "Falha ao gerar pagamento.";
  }

  function fetchJsonWithTimeout(url, options, timeoutMs) {
    if (!window.AbortController) {
      return fetch(url, options);
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    options = Object.assign({}, options || {}, { signal: controller.signal });

    return fetch(url, options).finally(function () {
      clearTimeout(timer);
    });
  }

  function parseJsonResponse(r) {
    return r.text().then(function (text) {
      var j = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch (_) {
        var invalid = new Error(
          text && text.trim().charAt(0) === "<"
            ? "O servidor retornou uma página HTML em vez da resposta do PIX."
            : "Resposta inválida do servidor."
        );
        invalid.status = r.status || 502;
        throw invalid;
      }

      if (!r.ok) {
        var err = new Error(j.error || "Falha ao gerar pagamento.");
        err.status = r.status;
        throw err;
      }

      return j;
    });
  }

  function requestCheckout(data, retriesLeft) {
    return fetchJsonWithTimeout(apiUrl("/api/checkout"), {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, CHECKOUT_TIMEOUT_MS)
      .then(parseJsonResponse)
      .then(function (j) {
        if (!j.chargeId || !(j.qrCodePayload || j.qrCode || j.paymentLink)) {
          var err = new Error("O gateway respondeu sem os dados do PIX. Tente novamente.");
          err.status = 502;
          throw err;
        }
        return j;
      })
      .catch(function (err) {
        if (retriesLeft > 0 && isTransientCheckoutError(err)) {
          return wait(900).then(function () { return requestCheckout(data, retriesLeft - 1); });
        }
        throw err;
      });
  }

  function formatPrice(value) {
    var n = Number(value || 0);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function readFormPrefill() {
    var form = body.querySelector("#ckt-form");
    if (!form) return {};
    return {
      name: form.name ? form.name.value.trim() : "",
      email: form.email ? form.email.value.trim() : "",
    };
  }

  function shouldShowRescueOffer() {
    return (
      backdrop.classList.contains("open") &&
      !rescueShown &&
      activeOffer().id === "main" &&
      Boolean(body.querySelector("#ckt-form"))
    );
  }

  function showRescueOffer(prefill) {
    prefill = prefill || {};
    rescueShown = true;
    stopPromoCountdown();
    metaTrack("ViewContent", {
      event_source: "rescue_offer",
      value: OFFERS.rescue.value,
    }, "rescue-offer");

    body.innerHTML = [
      '<div class="ckt-rescue">',
      '  <span class="ckt-rescue-badge">Oferta especial liberada</span>',
      "  <h4>Antes de sair, fique com o Kit completo por R$ 14,99</h4>",
      "  <p>É o mesmo acesso digital: +270 atividades, os 3 bônus e o mesmo link de download. A diferença é só a condição especial para você decidir agora.</p>",
      '  <div class="ckt-rescue-price"><span>De ' + PRICE_OLD + '</span><strong>R$ 14,99</strong></div>',
      '  <ul class="ckt-rescue-list">',
      "    <li>Mesmo material entregue após o pagamento</li>",
      "    <li>Mesmo acesso imediato pelo download</li>",
      "    <li>Mesma garantia de 7 dias</li>",
      "  </ul>",
      '  <button class="ckt-btn ckt-rescue-accept" type="button" id="ckt-rescue-accept">Quero garantir por R$ 14,99</button>',
      '  <button class="ckt-link-btn" type="button" id="ckt-rescue-decline">Não, obrigado</button>',
      "</div>",
    ].join("");

    var accept = body.querySelector("#ckt-rescue-accept");
    var decline = body.querySelector("#ckt-rescue-decline");
    if (accept) accept.addEventListener("click", function () {
      currentOffer = OFFERS.rescue;
      resetPromoDeadline();
      metaTrack("InitiateCheckout", {
        event_source: "rescue_accept",
        value: OFFERS.rescue.value,
      }, "rescue");
      showForm(prefill);
    });
    if (decline) decline.addEventListener("click", forceClose);
  }

  function resetPromoDeadline() {
    promoDeadline = Date.now() + (PROMO_MINUTES * 60 * 1000);
  }

  function stopPromoCountdown() {
    if (promoTimer) {
      clearInterval(promoTimer);
      promoTimer = null;
    }
  }

  function formatCountdown(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var minutes = String(Math.floor(total / 60)).padStart(2, "0");
    var seconds = String(total % 60).padStart(2, "0");
    return minutes + ":" + seconds;
  }

  function updatePromoCountdown() {
    var remaining = (promoDeadline || Date.now()) - Date.now();
    var time = formatCountdown(remaining);
    body.querySelectorAll("[data-ckt-countdown]").forEach(function (el) {
      el.textContent = time;
    });
    body.querySelectorAll("[data-ckt-expire-text]").forEach(function (el) {
      el.textContent = remaining <= 0 ? "Oferta encerrada nesta reserva" : activeOffer().promoText;
    });
    if (remaining <= 0) stopPromoCountdown();
  }

  function startPromoCountdown() {
    stopPromoCountdown();
    if (!promoDeadline) resetPromoDeadline();
    updatePromoCountdown();
    promoTimer = setInterval(updatePromoCountdown, 1000);
  }

  function promoBlock() {
    var offer = activeOffer();
    return [
      '<div class="ckt-promo" aria-live="polite">',
      '  <span class="ckt-promo-badge">' + offer.promoBadge + '</span>',
      '  <span class="ckt-promo-copy"><span data-ckt-expire-text>' + offer.promoText + '</span> <strong data-ckt-countdown>12:00</strong></span>',
      "</div>",
    ].join("");
  }

  /* ---------- 1) formulário ---------- */
  function showForm(prefill) {
    var offer = activeOffer();
    prefill = prefill || {};
    body.innerHTML = [
      promoBlock(),
      '<div class="ckt-price' + offer.priceTone + '" aria-label="Preco promocional">',
      '  <div class="ckt-price-copy">',
      '    <span class="old">De ' + PRICE_OLD + '</span>',
      '    <span class="now"><small>Por</small> ' + offer.price + '</span>',
      "  </div>",
      '  <span class="ckt-price-tag">' + offer.tag + '</span>',
      "</div>",
      '<form id="ckt-form" novalidate>',
      '  <div class="ckt-field"><label>Nome completo</label><input name="name" autocomplete="name" placeholder="Seu nome" value="' + esc(prefill.name) + '"></div>',
      '  <div class="ckt-field"><label>E-mail</label><input name="email" type="email" autocomplete="email" placeholder="voce@email.com" value="' + esc(prefill.email) + '"></div>',
      '  <button class="ckt-btn" type="submit">' + offer.cta + '</button>',
      '  <div class="ckt-msg" id="ckt-msg"></div>',
      '  <div class="ckt-secure"><img src="assets/offer-badges.svg" alt="Compra segura, acesso imediato e 7 dias de garantia" width="270" height="28" loading="lazy" decoding="async"></div>',
      "</form>",
    ].join("");

    var form = body.querySelector("#ckt-form");
    form.addEventListener("submit", submitForm);
    startPromoCountdown();
    setTimeout(function () { form.name.focus(); }, 50);
  }

  function submitForm(e) {
    e.preventDefault();
    var form = e.target;
    var msg = body.querySelector("#ckt-msg");
    var btn = form.querySelector(".ckt-btn");
    var data = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      offer: activeOffer().id,
      tracking: getTrackingParameters(),
    };
    metaTrack("Lead", {
      event_source: "checkout_form",
      offer: activeOffer().id,
      value: activeOffer().value,
    }, activeOffer().id + "-form");
    msg.textContent = ""; msg.className = "ckt-msg";
    btn.disabled = true; btn.textContent = "Gerando PIX...";

    requestCheckout(data, 1)
      .then(function (res) {
        metaTrack("AddPaymentInfo", {
          payment_method: "pix",
        }, res.chargeId || "pix");
        showPix(res, data);
      })
      .catch(function (err) {
        msg.textContent = friendlyCheckoutMessage(err);
        msg.className = "ckt-msg error";
        btn.disabled = false; btn.textContent = activeOffer().cta;
      });
  }

  /* ---------- 2) tela PIX ---------- */
  function showPix(p, buyer) {
    var imgSrc = "";
    var pixPrice = formatPrice(p.value || activeOffer().value);
    if (p.qrCode) imgSrc = /^data:|^https?:/.test(p.qrCode) ? p.qrCode : "data:image/png;base64," + p.qrCode;

    body.innerHTML = [
      '<div class="ckt-pix">',
      promoBlock(),
      "  <h4>Escaneie para pagar</h4>",
      '  <p class="sub">Abra o app do seu banco e pague o PIX de <b>' + pixPrice + '</b></p>',
      imgSrc ? '  <div class="ckt-qr"><img alt="QR Code PIX" src="' + esc(imgSrc) + '"></div>' : "",
      '  <div class="ckt-copy-wrap"><input id="ckt-payload" readonly value="' + esc(p.qrCodePayload || "") + '"><button class="ckt-copy-btn" type="button" id="ckt-copy">Copiar</button></div>',
      '  <div class="ckt-status" id="ckt-status"><span class="ckt-spin"></span> Aguardando pagamento...</div>',
      "</div>",
    ].join("");

    var copyBtn = body.querySelector("#ckt-copy");
    var payload = body.querySelector("#ckt-payload");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      payload.select();
      try { navigator.clipboard.writeText(payload.value); } catch (e) { document.execCommand("copy"); }
      copyBtn.textContent = "Copiado!";
      setTimeout(function () { copyBtn.textContent = "Copiar"; }, 1800);
    });

    startPolling(p);
    startPromoCountdown();
  }

  /* ---------- 3) polling do status ---------- */
  function startPolling(payment) {
    var chargeId = payment.chargeId;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      fetch(apiUrl("/api/status/" + encodeURIComponent(chargeId)), {
        headers: { "Accept": "application/json" },
      })
        .then(parseJsonResponse)
        .then(function (s) {
          if (s.status === "PAID") {
            clearInterval(pollTimer); pollTimer = null;
            if (!purchaseTracked[chargeId]) {
              purchaseTracked[chargeId] = true;
              metaTrack("Purchase", {
                payment_method: "pix",
                transaction_id: chargeId,
                value: Number(payment.value || activeOffer().value),
              }, chargeId);
            }
            showSuccess(s.downloadUrl);
          }
        })
        .catch(function () {});
    }, 4000);
  }

  /* ---------- 4) sucesso ---------- */
  function showSuccess(downloadUrl) {
    stopPromoCountdown();
    body.innerHTML = [
      '<div class="ckt-success">',
      '  <div class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-11" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>',
      "  <h4>Pagamento confirmado!</h4>",
      "  <p>Seu acesso ao Kit foi liberado. Clique abaixo para baixar os arquivos.</p>",
      downloadUrl ? '  <a class="ckt-download" href="' + esc(downloadUrl) + '" target="_blank" rel="noopener">Baixar meus arquivos</a>' : "",
      '  <button class="ckt-btn" type="button" id="ckt-done" style="margin-top:18px">Fechar</button>',
      "</div>",
    ].join("");
    var d = body.querySelector("#ckt-done");
    if (d) d.addEventListener("click", close);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- roteamento dos botões ----------
     - [data-buy]        → abre o checkout PIX
     - [data-scroll=sel] → rola suave até a seção alvo
  */
  function closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }

  document.addEventListener("click", function (e) {
    var buy = closest(e.target, "[data-buy]");
    if (buy) { e.preventDefault(); open(); return; }

    var scroll = closest(e.target, "[data-scroll]");
    if (scroll) {
      var sel = scroll.getAttribute("data-scroll");
      var target = sel && document.querySelector(sel);
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }
  }, false);
})();
