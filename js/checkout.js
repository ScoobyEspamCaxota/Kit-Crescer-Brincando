/* =========================================================
   Checkout PIX (QuacPay) — frontend
   Intercepta os botões de compra → modal → coleta dados →
   /api/checkout → QR PIX → polling /api/status → sucesso.
   ========================================================= */
(function () {
  "use strict";

  var PRICE_OLD = "R$ 97,00";
  var PRODUCT_NAME = "Kit Crescer Brincando";
  var PRODUCT_ID = "kit-crescer-brincando";
  var PRODUCT_VALUE = 29.9;
  var pollTimer = null;
  var purchaseTracked = {};

  function metaPayload(extra) {
    return Object.assign({
      content_ids: [PRODUCT_ID],
      content_name: PRODUCT_NAME,
      content_type: "product",
      contents: [{ id: PRODUCT_ID, quantity: 1, item_price: PRODUCT_VALUE }],
      currency: "BRL",
      num_items: 1,
      value: PRODUCT_VALUE,
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
    metaTrack("InitiateCheckout", {}, "open");
    backdrop.classList.add("open");
    showForm();
  }
  function close() {
    backdrop.classList.remove("open");
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  backdrop.querySelector(".ckt-close").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  /* ---------- máscaras leves ---------- */
  function maskCPF(v) {
    v = v.replace(/\D/g, "").slice(0, 11);
    return v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  function maskPhone(v) {
    v = v.replace(/\D/g, "").slice(0, 11);
    if (v.length <= 10) return v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
    return v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
  }

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

  /* ---------- 1) formulário ---------- */
  function showForm(prefill) {
    prefill = prefill || {};
    body.innerHTML = [
      '<div class="ckt-price"><span class="old">' + PRICE_OLD + '</span><span class="now">R$ 29,90</span></div>',
      '<form id="ckt-form" novalidate>',
      '  <div class="ckt-field"><label>Nome completo</label><input name="name" autocomplete="name" placeholder="Seu nome" value="' + esc(prefill.name) + '"></div>',
      '  <div class="ckt-field"><label>E-mail</label><input name="email" type="email" autocomplete="email" placeholder="voce@email.com" value="' + esc(prefill.email) + '"></div>',
      '  <div class="ckt-field"><label>Telefone (com DDD)</label><input name="phone" inputmode="numeric" placeholder="(11) 99999-9999" value="' + esc(prefill.phone) + '"></div>',
      '  <button class="ckt-btn" type="submit">Gerar PIX e pagar</button>',
      '  <div class="ckt-msg" id="ckt-msg"></div>',
      '  <div class="ckt-secure"><img src="assets/offer-badges.svg" alt="Compra segura, acesso imediato e 7 dias de garantia" width="270" height="28"></div>',
      "</form>",
    ].join("");

    var form = body.querySelector("#ckt-form");
    var phone = form.phone;
    phone.addEventListener("input", function () { phone.value = maskPhone(phone.value); });
    form.addEventListener("submit", submitForm);
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
      phone: form.phone.value,
      tracking: getTrackingParameters(),
    };
    metaTrack("Lead", { event_source: "checkout_form" }, "form");
    msg.textContent = ""; msg.className = "ckt-msg";
    btn.disabled = true; btn.textContent = "Gerando PIX...";

    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "Falha ao gerar pagamento.");
        metaTrack("AddPaymentInfo", {
          payment_method: "pix",
        }, res.j.chargeId || "pix");
        showPix(res.j, data);
      })
      .catch(function (err) {
        msg.textContent = err.message;
        msg.className = "ckt-msg error";
        btn.disabled = false; btn.textContent = "Gerar PIX e pagar";
      });
  }

  /* ---------- 2) tela PIX ---------- */
  function showPix(p, buyer) {
    var imgSrc = "";
    if (p.qrCode) imgSrc = /^data:|^https?:/.test(p.qrCode) ? p.qrCode : "data:image/png;base64," + p.qrCode;

    body.innerHTML = [
      '<div class="ckt-pix">',
      "  <h4>Escaneie para pagar</h4>",
      '  <p class="sub">Abra o app do seu banco e pague o PIX de <b>R$ 29,90</b></p>',
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
  }

  /* ---------- 3) polling do status ---------- */
  function startPolling(payment) {
    var chargeId = payment.chargeId;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      fetch("/api/status/" + encodeURIComponent(chargeId))
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s.status === "PAID") {
            clearInterval(pollTimer); pollTimer = null;
            if (!purchaseTracked[chargeId]) {
              purchaseTracked[chargeId] = true;
              metaTrack("Purchase", {
                payment_method: "pix",
                transaction_id: chargeId,
                value: Number(payment.value || PRODUCT_VALUE),
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
