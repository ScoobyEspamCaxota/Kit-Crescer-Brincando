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
    var dots = Array.prototype.slice.call(carousel.querySelectorAll("[data-depo-dot]"));
    var index = 0;
    var timer = null;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function updateDots() {
      dots.forEach(function (dot, i) { dot.classList.toggle("active", i === index); });
    }

    function goTo(nextIndex, behavior) {
      if (!track || !slides.length) return;
      index = (nextIndex + slides.length) % slides.length;
      var slide = slides[index];
      var left = slide.offsetLeft - track.offsetLeft - ((track.clientWidth - slide.clientWidth) / 2);
      track.scrollTo({ left: Math.max(0, left), behavior: behavior || "smooth" });
      updateDots();
    }

    function start() {
      if (reduceMotion || timer || slides.length < 2) return;
      timer = setInterval(function () {
        if (!document.hidden) goTo(index + 1);
      }, 3400);
    }

    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }

    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function () {
        stop();
        goTo(i);
        start();
      });
    });

    if (track) {
      track.addEventListener("pointerdown", stop);
      track.addEventListener("pointerup", start);
      track.addEventListener("focusin", stop);
      track.addEventListener("focusout", start);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) start();
        else stop();
      }, { threshold: 0.2 }).observe(carousel);
    } else {
      start();
    }

    goTo(0, "auto");
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
