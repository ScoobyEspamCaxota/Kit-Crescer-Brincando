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

  /* ---- carrossel de depoimentos ---- */
  d.querySelectorAll("[data-depo-carousel]").forEach(function (carousel) {
    var track = carousel.querySelector("[data-depo-track]");
    var slides = track ? Array.prototype.slice.call(track.querySelectorAll(".depo-card")) : [];
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!track || slides.length < 2) return;

    slides.forEach(function (slide) {
      var clone = slide.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      clone.removeAttribute("data-reveal");
      clone.classList.add("in", "depo-card--clone");
      track.appendChild(clone);
    });

    track.classList.add("depo-track--marquee");

    function syncDistance() {
      var firstClone = track.querySelector(".depo-card--clone");
      if (!firstClone) return;
      var distance = firstClone.offsetLeft - slides[0].offsetLeft;
      track.style.setProperty("--depo-distance", Math.max(0, distance) + "px");
    }

    syncDistance();
    window.addEventListener("resize", syncDistance, { passive: true });
    track.querySelectorAll("img").forEach(function (img) {
      if (!img.complete) img.addEventListener("load", syncDistance, { once: true });
    });

    if (reduceMotion) return;

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        carousel.classList.toggle("is-running", entries[0].isIntersecting);
      }, { threshold: 0.2 }).observe(carousel);
    } else {
      carousel.classList.add("is-running");
    }
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
