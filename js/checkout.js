/* =========================================================
   Checkout hospedado (QuacPay)
   Mantem o link oficial pronto com UTMs/click ids para abrir rapido.
   ========================================================= */
(function () {
  "use strict";

  var CHECKOUT_URL = "https://quacpay.com/c/qp_a541a48a32206beb804e2b4e052415a1/arraia-lucrativo-receitinhas";
  var PRODUCT_NAME = "Metodo Arraia Lucrativo";
  var PRODUCT_ID = "metodo-arraia-lucrativo";
  var PRODUCT_VALUE = 14.9;
  var STORAGE_PREFIX = "ckt_";
  var TRACKING_KEYS = [
    "src",
    "sck",
    "utm_source",
    "utm_campaign",
    "utm_medium",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
    "ttclid",
  ];

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

  function rememberTracking() {
    var params = new URLSearchParams(window.location.search);
    var tracking = {};

    TRACKING_KEYS.forEach(function (key) {
      var value = params.get(key);
      if (value) {
        tracking[key] = value;
        try { sessionStorage.setItem(STORAGE_PREFIX + key, value); } catch (_) {}
        return;
      }

      try { value = sessionStorage.getItem(STORAGE_PREFIX + key) || ""; } catch (_) { value = ""; }
      tracking[key] = value;
    });

    if (!tracking.sck) {
      tracking.sck = params.get("xcod") || params.get("cid") || "";
      if (tracking.sck) {
        try { sessionStorage.setItem(STORAGE_PREFIX + "sck", tracking.sck); } catch (_) {}
      }
    }

    return tracking;
  }

  function checkoutUrl() {
    var url = new URL(CHECKOUT_URL);
    var tracking = rememberTracking();

    Object.keys(tracking).forEach(function (key) {
      if (tracking[key]) url.searchParams.set(key, tracking[key]);
    });

    if (!url.searchParams.get("utm_source")) url.searchParams.set("utm_source", "site");
    if (!url.searchParams.get("utm_medium")) url.searchParams.set("utm_medium", "checkout_button");
    if (!url.searchParams.get("utm_campaign")) url.searchParams.set("utm_campaign", "arraia_lucrativo_sao_joao_2026");
    if (!url.searchParams.get("utm_content")) url.searchParams.set("utm_content", "botao_oferta");
    if (!url.searchParams.get("src")) url.searchParams.set("src", url.searchParams.get("utm_source") || "site");
    if (!url.searchParams.get("sck")) url.searchParams.set("sck", url.searchParams.get("utm_campaign") || "arraia_lucrativo_sao_joao_2026");

    return url.toString();
  }

  function prepareBuyLinks() {
    var url = checkoutUrl();
    document.querySelectorAll("[data-buy]").forEach(function (buy) {
      if (buy.tagName && buy.tagName.toLowerCase() === "a") {
        buy.href = url;
        if (!buy.target) buy.target = "quacpay_checkout";
        if (!buy.rel) buy.rel = "noopener";
      }
    });
    return url;
  }

  function trackHostedCheckout() {
    metaTrack("InitiateCheckout", {
      checkout_type: "quacpay_hosted",
      value: PRODUCT_VALUE,
    }, "hosted");
  }

  function closest(el, sel) {
    return el && el.closest ? el.closest(sel) : null;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      prepareBuyLinks();
      trackViewContent();
    }, { once: true });
  } else {
    prepareBuyLinks();
    trackViewContent();
  }

  ["pointerenter", "focus", "touchstart"].forEach(function (eventName) {
    document.addEventListener(eventName, function (e) {
      if (closest(e.target, "[data-buy]")) prepareBuyLinks();
    }, { passive: true, capture: true });
  });

  document.addEventListener("click", function (e) {
    var buy = closest(e.target, "[data-buy]");
    if (buy) {
      var url = prepareBuyLinks();
      trackHostedCheckout();
      if (!(buy.tagName && buy.tagName.toLowerCase() === "a")) {
        e.preventDefault();
        window.location.href = url;
      }
      return;
    }

    var scroll = closest(e.target, "[data-scroll]");
    if (scroll) {
      var sel = scroll.getAttribute("data-scroll");
      var target = sel && document.querySelector(sel);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, false);
})();
