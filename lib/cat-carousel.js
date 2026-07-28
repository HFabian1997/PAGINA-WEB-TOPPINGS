/**
 * Carrusel de categoría (diapositivas) — compartido entre el sitio público
 * (main.js) y la vista previa del panel de administración (admin.js), para que
 * lo que se ve al configurar sea EXACTAMENTE lo que verá el cliente.
 *
 * Muestra una imagen completa a la vez, espera, se desliza a la siguiente y al
 * terminar vuelve a empezar. Cada categoría usa su propia configuración.
 */
(function () {
  "use strict";

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  function escHTML(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------------- Carrusel de categoría (diapositivas) ----------------
     Solo vive dentro de las páginas de menú (comidas/helados/bebidas), nunca
     en el inicio. Muestra UNA imagen completa a la vez, espera, se desliza a
     la siguiente y al final vuelve a empezar. Cada categoría tiene el suyo,
     con su propia configuración — nada se comparte entre categorías. */

  /** Devuelve la config del carrusel solo si está activo y tiene imágenes
   *  activas; si no, null (y entonces no se dibuja nada — sin huecos). */
  function activeCarouselFor(info) {
    var c = info && info.carousel;
    if (!c || !c.active) return null;
    var imgs = (c.images || []).filter(function (it) {
      return it && it.src && it.active !== false;
    });
    if (!imgs.length) return null;
    var out = {};
    for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k]; }
    out.images = imgs;
    return out;
  }

  /* Se inserta PRIMERO en la página y solo después se pone en marcha: el
     observador que lo pausa cuando no se ve necesita que el elemento ya esté
     dentro del documento para funcionar. */
  function insertCategoryCarousel(frame, cfg, category) {
    var root = buildCategoryCarousel(cfg, category);
    frame.appendChild(root);
    initCategoryCarousel(root, cfg);
    return root;
  }

  function buildCategoryCarousel(cfg, category) {
    var root = document.createElement("div");
    root.className = "cat-carousel";
    root.setAttribute("data-cat-carousel", category || "");

    var speed = Math.max(0, Number(cfg.transitionMs) || 600);
    root.style.setProperty("--cc-speed", speed + "ms");
    if (cfg.autoHeight === false) {
      var h = Number(cfg.height) || 220;
      root.style.height = h + "px";
    } else {
      root.classList.add("is-auto-height");
    }
    if (cfg.radius != null) root.style.borderRadius = (Number(cfg.radius) || 0) + "px";
    if (cfg.marginTop) root.style.marginTop = (Number(cfg.marginTop) || 0) + "px";
    if (cfg.marginBottom) root.style.marginBottom = (Number(cfg.marginBottom) || 0) + "px";
    if (cfg.sidePadding) {
      root.style.paddingLeft = (Number(cfg.sidePadding) || 0) + "px";
      root.style.paddingRight = (Number(cfg.sidePadding) || 0) + "px";
    }
    if (cfg.bg) root.style.background = cfg.bg;
    if (cfg.border) root.style.border = "1px solid var(--line)";
    if (cfg.shadow) root.style.boxShadow = "var(--shadow-md)";

    var imgs = cfg.images;
    var slidesHtml = imgs.map(function (it, i) {
      return '<div class="cat-carousel-slide">' +
        '<img src="' + escHTML(it.src) + '" alt="" loading="' + (i === 0 ? "eager" : "lazy") + '" decoding="async">' +
        "</div>";
    }).join("");
    var dotsHtml = imgs.map(function (_, i) {
      return '<button type="button" class="cat-carousel-dot' + (i === 0 ? " is-active" : "") + '" data-cc-dot="' + i + '" aria-label="Imagen ' + (i + 1) + '"></button>';
    }).join("");

    root.innerHTML =
      '<div class="cat-carousel-viewport" data-cc-viewport>' +
        '<div class="cat-carousel-track" data-cc-track>' + slidesHtml + "</div>" +
      "</div>" +
      '<button type="button" class="cat-carousel-arrow is-prev" data-cc-prev aria-label="Anterior">‹</button>' +
      '<button type="button" class="cat-carousel-arrow is-next" data-cc-next aria-label="Siguiente">›</button>' +
      '<div class="cat-carousel-dots" data-cc-dots>' + dotsHtml + "</div>";

    var showArrows = cfg.showArrows !== false && imgs.length > 1;
    var showDots = cfg.showDots !== false && imgs.length > 1;
    $("[data-cc-prev]", root).hidden = !showArrows;
    $("[data-cc-next]", root).hidden = !showArrows;
    $("[data-cc-dots]", root).hidden = !showDots;
    return root;
  }

  function initCategoryCarousel(root, cfg) {
    var track = $("[data-cc-track]", root);
    var viewport = $("[data-cc-viewport]", root);
    var dots = $$("[data-cc-dot]", root);
    var total = cfg.images.length;
    var index = 0;
    var timer = null;
    var interval = Math.max(1000, Number(cfg.intervalMs) || 4000);
    var step = cfg.direction === "rtl" ? -1 : 1;

    var autoHeight = cfg.autoHeight !== false;

    function paint() {
      track.style.transform = "translateX(" + (-index * 100) + "%)";
      dots.forEach(function (d, i) { d.classList.toggle("is-active", i === index); });
      syncHeight();
      preloadNeighbour();
    }
    /* Con altura automática el alto del carrusel sigue a la imagen visible,
       así fotos de distinta proporción no dejan espacios en blanco. */
    function syncHeight() {
      if (!autoHeight) return;
      var slide = track.children[index];
      if (!slide) return;
      var img = slide.querySelector("img");
      var apply = function () {
        var h = slide.getBoundingClientRect().height;
        if (h > 0) viewport.style.height = h + "px";
      };
      if (img && !img.complete) img.addEventListener("load", apply, { once: true });
      apply();
    }
    // precarga la siguiente para que el cambio no muestre un hueco
    function preloadNeighbour() {
      var nextIdx = (index + 1) % total;
      var nextImg = track.children[nextIdx] && track.children[nextIdx].querySelector("img");
      if (nextImg && nextImg.loading === "lazy") nextImg.loading = "eager";
    }
    function goTo(i, fromUser) {
      index = ((i % total) + total) % total;
      paint();
      if (fromUser) restart(); // si el cliente cambia a mano, el tiempo se reinicia
    }
    function stop() { clearInterval(timer); timer = null; }
    root.__ccStop = stop; // permite apagarlo desde fuera (vista previa del admin)
    function restart() {
      stop();
      if (cfg.autoplay === false || total < 2) return;
      timer = setInterval(function () { goTo(index + step); }, interval);
    }

    if (total > 1) {
      $("[data-cc-prev]", root).addEventListener("click", function () { goTo(index - 1, true); });
      $("[data-cc-next]", root).addEventListener("click", function () { goTo(index + 1, true); });
      dots.forEach(function (d, i) {
        d.addEventListener("click", function () { goTo(i, true); });
      });

      if (cfg.swipe !== false) {
        var sx = 0, sy = 0, tracking = false;
        viewport.addEventListener("touchstart", function (e) {
          if (e.touches.length !== 1) return;
          tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        }, { passive: true });
        viewport.addEventListener("touchend", function (e) {
          if (!tracking) return;
          tracking = false;
          var t = e.changedTouches[0];
          var dx = t.clientX - sx, dy = t.clientY - sy;
          if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          goTo(index + (dx < 0 ? 1 : -1), true);
        }, { passive: true });
      }

      // Arranca siempre. El observador es solo un ahorro de batería: pausa
      // mientras el carrusel no se ve y lo reanuda al volver. Si el navegador
      // no lo soporta (o no reporta), el carrusel funciona igual.
      restart();
      if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) restart(); else stop(); });
        }, { threshold: 0.01 }).observe(root);
      }
      // si la pestaña queda en segundo plano, no acumula avances
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop(); else restart();
      });
    }
    // al girar el celular o cambiar el ancho, el alto se recalcula
    window.addEventListener("resize", syncHeight);
    paint();
  }


  /* Detiene los temporizadores de un carrusel ya creado (lo usa la vista
     previa del admin al cerrarse o al volver a dibujarse). */
  function destroyCategoryCarousel(root) {
    if (root && root.__ccStop) root.__ccStop();
  }

  window.__catCarousel = {
    activeConfig: activeCarouselFor,
    insert: insertCategoryCarousel,
    build: buildCategoryCarousel,
    init: initCategoryCarousel,
    destroy: destroyCategoryCarousel
  };
})();
