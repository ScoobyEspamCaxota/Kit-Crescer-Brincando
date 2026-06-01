/* =========================================================
   Crescer Brincando — animações leves (vanilla)
   reveal no scroll + header sticky + barra CTA mobile.
   Tudo progressivo: sem JS, conteúdo visível (CSS gated em .js).
   ========================================================= */
(function () {
  "use strict";
  var d = document;

  /* ---- header: sombra ao rolar ---- */
  var header = d.querySelector(".site-header");
  function onScroll() { if (header) header.classList.toggle("scrolled", window.scrollY > 8); }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- reveal ---- */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    d.querySelectorAll("[data-reveal]").forEach(function (el, i) {
      // stagger entre irmãos próximos
      var sibIndex = 0, p = el.previousElementSibling;
      while (p) { if (p.hasAttribute && p.hasAttribute("data-reveal")) sibIndex++; p = p.previousElementSibling; }
      el.style.setProperty("--rd", (Math.min(sibIndex, 6) * 70) + "ms");
      io.observe(el);
    });
  } else {
    d.querySelectorAll("[data-reveal]").forEach(function (el) { el.classList.add("in"); });
  }

  /* ---- contador de pessoas online por sessão ---- */
  d.querySelectorAll("[data-live-counter]").forEach(function (counter) {
    var min = Number(counter.getAttribute("data-min") || 112);
    var max = Number(counter.getAttribute("data-max") || (min + 57));
    var countEl = counter.querySelector("[data-live-count]");
    var storageKey = "cb_live_viewers";
    var value = null;

    try { value = Number(sessionStorage.getItem(storageKey)); } catch (_) {}
    if (!value || value < min) {
      value = Math.floor(Math.random() * (max - min + 1)) + min;
      try { sessionStorage.setItem(storageKey, String(value)); } catch (_) {}
    }
    if (countEl) countEl.textContent = String(value);
  });

  /* ---- barra CTA mobile: aparece após hero, some no rodapé ---- */
  var bar = d.getElementById("mobileBar");
  var hero = d.querySelector(".hero");
  var footer = d.querySelector(".site-footer");
  if (bar && "IntersectionObserver" in window) {
    var pastHero = false, atFooter = false;
    function upd() { bar.classList.toggle("show", pastHero && !atFooter); }
    if (hero) new IntersectionObserver(function (e) { pastHero = !e[0].isIntersecting; upd(); }, { rootMargin: "-40% 0px 0px 0px" }).observe(hero);
    if (footer) new IntersectionObserver(function (e) { atFooter = e[0].isIntersecting; upd(); }).observe(footer);
  }
})();
