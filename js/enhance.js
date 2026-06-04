/* =========================================================
   Arraiá Lucrativo — enhancement (reveal ao rolar)
   Progressivo: se algo falhar, remove .enhanced (tudo visível).
   ========================================================= */
(function () {
  "use strict";
  var d = document, root = d.documentElement;

  // ---- De-dup: cada CTA tem 2 checkouts (Kirvano + Bravvius). Remove o Bravvius. ----
  function dedup() {
    d.querySelectorAll('a[href*="bravvius"]').forEach(function (a) {
      var box = (a.closest && a.closest('[id^="e_"]')) || a.parentElement;
      if (box) box.style.display = "none";
    });
  }
  if (d.readyState !== "loading") dedup();
  else d.addEventListener("DOMContentLoaded", dedup);

  // Sem IntersectionObserver: não esconde nada (reveal desativado).
  if (!("IntersectionObserver" in window)) return;

  root.className += " enhanced";

  try {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { root: null, rootMargin: "0px 0px -7% 0px", threshold: 0.08 });

    function setup() {
      var groups = d.querySelectorAll(".centralizar");
      for (var g = 0; g < groups.length; g++) {
        var kids = groups[g].children, idx = 0;
        for (var i = 0; i < kids.length; i++) {
          var el = kids[i];
          if (el.id && el.id.indexOf("e_") === 0) {
            el.style.setProperty("--rd", (Math.min(idx, 6) * 70) + "ms");
            io.observe(el);
            idx++;
          }
        }
      }
      // Segurança: revela qualquer coisa visível logo após o load.
      setTimeout(function () {
        var vh = window.innerHeight || 800;
        d.querySelectorAll('.centralizar > [id^="e_"]').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < vh && r.bottom > 0) el.classList.add("in");
        });
      }, 400);
    }

    if (d.readyState !== "loading") setup();
    else d.addEventListener("DOMContentLoaded", setup);
  } catch (err) {
    // Em caso de erro, garante conteúdo visível.
    root.className = root.className.replace(/\benhanced\b/, "");
  }
})();
