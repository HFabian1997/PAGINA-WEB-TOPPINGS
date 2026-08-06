(function () {
  "use strict";

  var data = window.__BRAND__ || {};
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  var $  = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
  var escHTML = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function safe(fn, name) {
    try { fn(); } catch (e) { console.warn("[" + name + "] failed:", e); }
  }

  /* ---------------- Personalización (fondo, colores, tamaño de letra, efectos) ----------------
     Se corre primero que cualquier otra cosa en boot(), para que el resto de
     la página ya pinte con los valores elegidos desde el panel y no haya un
     "flash" del tema por defecto más de lo necesario. */
  function applyCustomization() {
    var c = data.customization;
    if (!c) return;
    var root = document.documentElement;

    if (c.accentColor) root.style.setProperty("--accent", c.accentColor);
    if (c.textColor) root.style.setProperty("--ink", c.textColor);
    if (typeof c.backgroundOverlay === "number") {
      root.style.setProperty("--overlay-alpha", String(c.backgroundOverlay));
    }

    var FONT_SCALE = { small: "15px", normal: "16px", large: "18px" };
    root.style.fontSize = FONT_SCALE[c.fontSizeScale] || FONT_SCALE.normal;

    if (c.backgroundType === "color" && c.backgroundColor) {
      root.style.setProperty("--page-bg-color", c.backgroundColor);
      root.style.setProperty("--page-bg-image", "none");
    } else if (c.backgroundType === "image" && c.backgroundImage) {
      root.style.setProperty("--page-bg-color", "#0a0a0a");
      root.style.setProperty("--page-bg-image", "url('" + c.backgroundImage + "')");
    }
    // backgroundType "texture" (o sin definir): se deja la textura urbana de siempre.

    /* Estilo de las ventanas emergentes (Personalización → Ventanas).
       "urban" = franja de pintura con chorreado + textura de muro;
       "plain" = la ventana lisa de siempre. */
    var modal = c.modal || {};
    var plain = modal.style === "plain";
    document.body.classList.toggle("modal-plain", plain);
    document.body.classList.toggle("modal-no-drip", !plain && modal.drip === false);
    document.body.classList.toggle("modal-no-texture", !plain && modal.texture === false);
    if (modal.dripColor) root.style.setProperty("--modal-drip", modal.dripColor);

    if (c.effects) {
      document.body.classList.toggle("no-animations", c.effects.animations === false);
      document.body.classList.toggle("no-glow", c.effects.glow === false);
      var scrollFab = $("[data-scroll-fab]");
      if (scrollFab) scrollFab.hidden = c.effects.scrollButtons === false;
      if (c.effects.pageNavArrows === false) {
        $$("[data-pagenav]").forEach(function (b) { b.hidden = true; });
      }
    }
  }

  /* ---------------- WhatsApp links ---------------- */
  function buildWhatsAppUrl(extraText) {
    var biz = data.business || {};
    var phone = (biz.whatsapp || "").replace(/[^0-9]/g, "");
    var msg = extraText || biz.whatsappMessage || "Hola TOPPINGS!";
    return "https://wa.me/" + phone + "?text=" + encodeURIComponent(msg);
  }
  function initWhatsappLinks() {
    var url = buildWhatsAppUrl();
    $$("[data-whatsapp-link]").forEach(function (a) { a.href = url; });
  }

  /* ---------------- Identificador del dispositivo (compartido con el juego) ----------------
     Misma llave de localStorage que usa game/toppings-run.js — así el mismo
     dispositivo se reconoce en cualquier parte del sitio, sin cuentas ni
     login. Es lo único que el servidor usa para comprobar que un cambio de
     nombre lo pide de verdad el dueño del registro, no cualquiera. */
  var DEVICE_KEY = "toppings_run_device_id";
  function getDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = "d_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) { return ""; }
  }

  /* ---------------- Saludo en el inicio (posición configurable desde admin) ----------------
     Recuerda el mismo nombre que usa el cronómetro, la tarjeta, el reto y el
     juego. Al cambiarlo, se lo avisa al servidor para que el nombre nuevo
     quede también en el ranking y en el historial de premios — no solo en
     este celular. El límite de cambios (o si se puede cambiar) se configura
     desde el panel — el primer nombre que da un cliente nunca cuenta como
     "cambio". ---- */
  var NAME_CHANGE_COUNT_KEY = "toppings_name_change_count";
  var RUN_API = "api/run-leaderboard.php";

  /* Mueve el saludo a donde el admin haya elegido dentro de la portada —
     mismo patrón que positionDailyPrize. */
  function positionHeroGreeting() {
    var el = $("[data-hero-greeting]");
    var hero = $(".hero-inner");
    if (!el || !hero) return;
    var cfg = data.customerGreeting || {};
    var position = cfg.position || "belowLogo";
    var kicker = $(".hero-kicker", hero);
    var title = $(".hero-title", hero);
    var sub = $(".hero-sub", hero);
    var actions = $(".hero-actions", hero);

    if (position === "aboveLogo" && kicker) hero.insertBefore(el, kicker);
    else if (position === "afterSubtitle" && sub) sub.parentNode.insertBefore(el, sub.nextSibling);
    else if (position === "afterButtons" && actions) actions.parentNode.insertBefore(el, actions.nextSibling);
    else if (title) title.parentNode.insertBefore(el, title.nextSibling); // "belowLogo" (por defecto)
  }

  function renderHeroGreeting() {
    var el = $("[data-hero-greeting]");
    if (!el) return;
    var cfg = data.customerGreeting || {};
    if (cfg.active === false) { el.hidden = true; return; }
    var textEl = $("[data-hero-greeting-text]", el);
    var editBtn = $("[data-hero-greeting-edit]", el);
    var name = localStorage.getItem(LOYALTY_NAME_KEY) || "";
    if (name) {
      el.hidden = false;
      if (textEl) textEl.textContent = "👋 Hola, " + name;
      if (editBtn) editBtn.hidden = cfg.nameChangeMode === "disabled";
    } else {
      el.hidden = true;
    }
  }
  window.__renderHeroGreeting = renderHeroGreeting;

  /* Avisa a los dos servicios (premios y ranking) para que el nombre nuevo
     reemplace al viejo en cualquier registro que ya tuviera este mismo
     dispositivo — sin esto, el cambio solo se vería en este celular. */
  function renameEverywhere(newName, oldName) {
    var deviceId = getDeviceId();
    var body = JSON.stringify({ action: "rename", deviceId: deviceId, newName: newName, oldName: oldName || "" });
    fetch(PRIZE_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.state) premioState = res.state;
        safe(renderPremioSection, "renderPremioSection");
      })
      .catch(function (e) { console.warn("[rename] premio.php:", e); });
    /* La acción VA EN LA DIRECCIÓN (`?action=rename`), no solo dentro del
       mensaje: run-leaderboard.php la lee de ahí. Faltaba, así que el
       servidor respondía "acción no reconocida" y no renombraba nada — por
       eso el nombre en el ranking solo cambiaba al volver a jugar, que sí
       usa `?action=submit`. La tarjeta funcionaba porque premio.php además
       la acepta dentro del mensaje.

       Además el ranking se refresca DESPUÉS de que el cambio ya quedó
       guardado: si se pidieran los dos a la vez, la consulta podría llegar
       primero y mostrar todavía el nombre viejo. */
    fetch(RUN_API + "?action=rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        // Un fallo del servidor no puede pasar desapercibido: antes se
        // ignoraba la respuesta y el error quedaba invisible.
        if (!res || !res.ok) console.warn("[rename] el ranking rechazó el cambio:", res && res.error);
        // El servidor devuelve el ranking YA con el nombre corregido: se le
        // pasa tal cual al juego para que repinte con ese dato y no dependa
        // de una segunda consulta.
        if (window.__renameGameName) window.__renameGameName(newName, res && res.status);
      })
      .catch(function (e) {
        console.warn("[rename] run-leaderboard.php:", e);
        if (window.__renameGameName) window.__renameGameName(newName);
      });
  }

  /* ---- Aviso de "ese nombre ya está en uso" — antes de guardar un nombre
     nuevo (por primera vez en el juego, o al cambiarlo desde el saludo) se
     consulta si otro dispositivo ya lo tiene en el ranking; si es así, se
     pregunta si continuar igual o cambiar de nombre. Es solo una advertencia
     — si la consulta falla por internet, sigue igual que si no estuviera
     en uso, sin bloquear al cliente. ---- */
  function showNameTakenModal(onContinue, onChangeName) {
    var modal = $("[data-name-taken-modal]");
    if (!modal) { onContinue(); return; }
    modal.hidden = false;
    var continueBtn = $("[data-name-taken-continue]", modal);
    var changeBtn = $("[data-name-taken-change]", modal);
    var backdrop = $("[data-name-taken-close]", modal);
    function cleanup() {
      modal.hidden = true;
      if (continueBtn) continueBtn.onclick = null;
      if (changeBtn) changeBtn.onclick = null;
      if (backdrop) backdrop.onclick = null;
    }
    function dismiss() { cleanup(); if (onChangeName) onChangeName(); }
    if (continueBtn) continueBtn.onclick = function () { cleanup(); onContinue(); };
    if (changeBtn) changeBtn.onclick = dismiss;
    if (backdrop) backdrop.onclick = dismiss;
  }

  /* ---------------- Ventana de confirmación propia ----------------
     Reemplaza al confirm() del navegador: en el celular ese cuadro muestra
     el dominio ("...hostingersite.com dice") sobre un fondo gris del
     sistema, y el cliente lo lee como un error de la página en vez de como
     una pregunta del sitio. Se arma sola la primera vez que se usa, así no
     hay que repetir el mismo HTML en las 5 páginas. */
  var confirmModal = null;

  function buildConfirmModal() {
    var el = document.createElement("div");
    el.className = "prize-modal name-taken-modal";
    el.hidden = true;
    el.innerHTML =
      '<div class="prize-modal-backdrop" data-confirm-close></div>' +
      '<div class="prize-modal-card name-taken-card">' +
        '<p class="section-kicker" data-confirm-title></p>' +
        '<p class="claim-prize-hint" data-confirm-text></p>' +
        '<div class="name-taken-actions">' +
          '<button type="button" class="btn btn-primary" data-confirm-yes></button>' +
          '<button type="button" class="btn btn-ghost" data-confirm-no></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function askConfirm(opts, onYes, onNo) {
    if (!confirmModal) confirmModal = buildConfirmModal();
    var m = confirmModal;
    $("[data-confirm-title]", m).textContent = opts.title || "";
    $("[data-confirm-text]", m).textContent = opts.text || "";
    var yes = $("[data-confirm-yes]", m);
    var no = $("[data-confirm-no]", m);
    yes.textContent = opts.yesLabel || "Continuar";
    no.textContent = opts.noLabel || "Cancelar";
    m.hidden = false;

    function cleanup() {
      m.hidden = true;
      yes.onclick = null;
      no.onclick = null;
      $("[data-confirm-close]", m).onclick = null;
    }
    function decline() { cleanup(); if (onNo) onNo(); }
    yes.onclick = function () { cleanup(); if (onYes) onYes(); };
    no.onclick = decline;
    $("[data-confirm-close]", m).onclick = decline;
  }
  window.__askConfirm = askConfirm;

  function checkNameThenProceed(name, onContinue, onChangeName) {
    var deviceId = getDeviceId();
    fetch(RUN_API + "?action=check-name&name=" + encodeURIComponent(name) + "&deviceId=" + encodeURIComponent(deviceId), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok && res.taken) showNameTakenModal(onContinue, onChangeName);
        else onContinue();
      })
      .catch(function () { onContinue(); });
  }
  window.__checkNameThenProceed = checkNameThenProceed;

  /* Guarda el nombre en este dispositivo Y lo deja registrado en el servidor.
     Todo punto donde el cliente escribe su nombre (saludo, juego, cronómetro,
     tarjeta, reto, asistente) pasa por aquí — así el aviso de "ese nombre ya
     está en uso" funciona para todos, no solo para quienes juegan. */
  /* La "v2" del nombre de la marca NO es decorativa: los despliegues borraron
     el registro de clientes del servidor varias veces, pero cada celular seguía
     con su anotación de "ya me registré" y por eso no volvía a avisar hasta
     una semana después. Los clientes de siempre no aparecían en el panel.
     Cambiar la marca hace que todos vuelvan a registrarse UNA vez, y de ahí en
     adelante sigue el ritmo semanal de siempre. */
  var REGISTERED_NAME_KEY = "toppings_registered_name_v2";
  function setCustomerName(name) {
    name = (name || "").trim();
    if (!name) return;
    try { localStorage.setItem(LOYALTY_NAME_KEY, name); } catch (e) {}
    registerNameOnce(name);
  }
  /* Solo le avisa al servidor cuando el nombre cambió de verdad — así
     reclamar el cronómetro cada rato no reescribe el registro una y otra vez. */
  /* Antes esto se hacía UNA sola vez y nunca más: si el servidor perdía el
     registro (pasó), el celular creía que ya lo había avisado y no lo volvía a
     intentar jamás. Ahora se guarda el nombre CON la fecha y se vuelve a avisar
     si pasó más de una semana, así el registro se repara solo. */
  var REGISTER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  function registerNameOnce(name) {
    var guardado = null;
    try { guardado = localStorage.getItem(REGISTERED_NAME_KEY); } catch (e) {}
    if (guardado) {
      var info = null;
      try { info = JSON.parse(guardado); } catch (e) {}
      // el formato viejo era el nombre pelado: cuenta como vencido y se
      // vuelve a registrar una vez
      if (info && info.name === name && info.at && (Date.now() - info.at) < REGISTER_TTL_MS) return;
    }
    fetch(RUN_API + "?action=register-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), name: name })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        // solo se da por registrado si el servidor lo confirmó — si falla,
        // se vuelve a intentar la próxima vez en vez de quedar a medias
        if (res && res.ok) {
          try {
            localStorage.setItem(REGISTERED_NAME_KEY, JSON.stringify({ name: name, at: Date.now() }));
          } catch (e) {}
        }
      })
      .catch(function () {});
  }
  /* Quien ya tenía su nombre guardado de antes (de cualquier dinámica) entra
     al registro la primera vez que abre la página, para que el aviso de
     nombre repetido tenga en cuenta a todos, no solo a los nuevos. */
  function registerExistingName() {
    var saved = "";
    try { saved = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}
    if (saved) registerNameOnce(saved);
  }
  window.__setCustomerName = setCustomerName;

  /* Pide un nombre y, si ya lo usa otra persona, muestra el aviso con las
     opciones de continuar igual o volver a escribir otro. */
  function askNameWithCheck(onDone) {
    function ask() {
      openNameModal(function (name) {
        name = (name || "").trim();
        if (!name) { onDone(""); return; }
        checkNameThenProceed(name, function () { setCustomerName(name); onDone(name); }, ask);
      });
    }
    ask();
  }

  function initHeroGreeting() {
    var el = $("[data-hero-greeting]");
    if (!el) return;
    var editBtn = $("[data-hero-greeting-edit]", el);
    renderHeroGreeting();

    if (editBtn) {
      editBtn.addEventListener("click", function () {
        var cfg = data.customerGreeting || {};
        var mode = cfg.nameChangeMode || "limited";
        if (mode === "disabled") return; // el botón ya está oculto, esto es solo un respaldo

        if (mode === "limited") {
          var maxChanges = Number(cfg.maxNameChanges) || 2;
          var used = parseInt(localStorage.getItem(NAME_CHANGE_COUNT_KEY) || "0", 10);
          var remaining = maxChanges - used;
          if (remaining <= 0) {
            alert("Ya usaste tus " + maxChanges + " cambios de nombre disponibles.");
            return;
          }
          var plural = remaining === 1 ? "" : "s";
          var ok = confirm("Solo puedes cambiar tu nombre " + maxChanges + " veces en total. Te queda" + plural + " " + remaining + " cambio" + plural + ". ¿Quieres continuar?");
          if (!ok) return;
        }

        var oldName = localStorage.getItem(LOYALTY_NAME_KEY) || "";
        // Se define como función con nombre para poder volver a abrirse a sí
        // misma cuando el cliente elige "Cambiar nombre" en el aviso de
        // nombre repetido — igual que en el juego, que lo deja escribiendo otro.
        function askForName() {
          openNameModal(function (name) {
            if (!name || name === oldName) return;
            checkNameThenProceed(name, function () {
              setCustomerName(name);
              if (mode === "limited") {
                var usedNow = parseInt(localStorage.getItem(NAME_CHANGE_COUNT_KEY) || "0", 10);
                localStorage.setItem(NAME_CHANGE_COUNT_KEY, String(usedNow + 1));
              }
              renderHeroGreeting();
              safe(renderPremioSection, "renderPremioSection");
              /* Se avisa al servidor SIEMPRE, aunque no hubiera un nombre
                 anterior guardado en este celular: el ranking se guarda por
                 dispositivo, así que puede haber un puntaje suyo con otro
                 nombre (por ejemplo si borró los datos del navegador). Si solo
                 se avisaba cuando había nombre viejo, esos casos seguían
                 mostrando el nombre antiguo en el ranking. */
              renameEverywhere(name, oldName);
            }, askForName);
          });
        }
        askForName();
      });
    }
  }

  /* ---------------- Música de fondo (opcional, se activa desde Personalización) ----------------
     El navegador nunca deja reproducir sonido sin que el cliente toque algo
     primero, así que arranca en pausa siempre: el botón flotante es la
     única forma de iniciarla. Recuerda si el cliente la había puesto a
     sonar para no volver a pedirle que la active en cada página. */
  function initBackgroundMusic() {
    var music = data.music || {};
    var btn = $("[data-music-toggle]");
    var audioEl = $("[data-bg-music]");
    if (!btn || !audioEl) return;
    if (!music.active || !music.file) { btn.hidden = true; return; }

    audioEl.src = music.file;
    audioEl.loop = true;
    audioEl.volume = typeof music.volume === "number" ? music.volume : 0.5;
    btn.hidden = false;

    var PLAY_KEY = "toppings_music_playing";
    function setPlaying(on) {
      btn.classList.toggle("is-playing", on);
      btn.setAttribute("aria-label", on ? "Pausar música" : "Reproducir música");
    }
    btn.addEventListener("click", function () {
      if (audioEl.paused) {
        audioEl.play().then(function () {
          setPlaying(true);
          try { sessionStorage.setItem(PLAY_KEY, "1"); } catch (e) {}
        }).catch(function () {});
      } else {
        audioEl.pause();
        setPlaying(false);
        try { sessionStorage.removeItem(PLAY_KEY); } catch (e) {}
      }
    });

    // Si venía sonando en la página anterior (misma pestaña/sesión), la
    // retoma sola — esto SÍ lo permite el navegador porque ya hubo un
    // gesto del cliente antes, en esta misma sesión de navegación.
    try {
      if (sessionStorage.getItem(PLAY_KEY) === "1") {
        audioEl.play().then(function () { setPlaying(true); }).catch(function () {});
      }
    } catch (e) {}
  }

  /* ---------------- Sonido + confeti al reclamar un premio ---------------- */
  function playPrizeChime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        var start = ctx.currentTime + i * 0.09;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
      setTimeout(function () { ctx.close(); }, 900);
    } catch (e) {}
  }

  function burstConfetti(targetEl) {
    if (!targetEl || reduced || document.body.classList.contains("no-animations")) return;
    var colors = ["#ffd400", "#ff5252", "#2ecc71", "#4fc3f7", "#ffffff"];
    var pieces = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 16; i++) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.setProperty("--c", colors[i % colors.length]);
      piece.style.setProperty("--x", (Math.random() * 200 - 100) + "px");
      piece.style.setProperty("--rot", (Math.random() * 480 - 240) + "deg");
      piece.style.left = (42 + Math.random() * 16) + "%";
      piece.style.animationDelay = (Math.random() * 0.15) + "s";
      frag.appendChild(piece);
      pieces.push(piece);
    }
    targetEl.appendChild(frag);
    setTimeout(function () {
      pieces.forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); });
    }, 1300);
  }
  window.__playPrizeChime = playPrizeChime;
  window.__burstConfetti = burstConfetti;

  /* ---------------- Header + mobile nav ---------------- */
  function initNav() {
    var header = $("[data-header]");
    if (header) {
      var onScroll = function () {
        header.classList.toggle("is-scrolled", window.scrollY > 8);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
  }

  /* ---------------- Aviso de "desliza, hay más abajo" ----------------
     Solo existe en la portada (el elemento no está en las demás páginas).
     Aparece de una y desaparece para siempre en cuanto el cliente desplaza:
     ya cumplió su trabajo y estorbaría el resto de la visita. */
  function initScrollHint() {
    var hint = $("[data-scroll-hint]");
    if (!hint) return;

    var effects = (data.customization && data.customization.effects) || {};
    if (effects.scrollHint === false) return;

    // si la página ya viene desplazada (volver atrás, enlace con #), no se muestra
    if (window.scrollY > 40) return;

    hint.hidden = false;
    /* Un respiro para que la transición de entrada se vea. Con
       requestAnimationFrame no sirve: si la pestaña no está pintando (recién
       abierta en segundo plano, o el navegador la frena), rAF no corre y el
       aviso se quedaría invisible para siempre. */
    setTimeout(function () { hint.classList.add("is-visible"); }, 30);

    var gone = false;
    function dismiss() {
      if (gone || window.scrollY <= 40) return;
      gone = true;
      hint.classList.remove("is-visible");
      hint.classList.add("is-gone");
      window.removeEventListener("scroll", dismiss);
      setTimeout(function () { hint.hidden = true; }, 600);
    }
    window.addEventListener("scroll", dismiss, { passive: true });
  }

  /* ---------------- Flecha: ir al inicio o al final de la página (según dónde estés) ---------------- */
  function initScrollButtons() {
    var stack = $("[data-scroll-fab]");
    var btn = $("[data-scroll-btn]");
    if (!stack || !btn) return;

    var updateDirection = function () {
      var atTop = window.scrollY < 120;
      btn.classList.toggle("is-dir-down", atTop);
      btn.classList.toggle("is-dir-up", !atTop);
    };
    updateDirection();

    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-dir-down")) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    var hideTimer;
    var onScroll = function () {
      updateDirection();
      stack.classList.add("is-visible");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { stack.classList.remove("is-visible"); }, 1100);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------------- Flechas + deslizar: cambiar entre Inicio / Comidas / Helados / Bebidas ---------------- */
  var PAGE_ORDER = ["inicio", "comidas", "helados", "bebidas"];
  var PAGE_URL = { inicio: "index.html", comidas: "comidas.html", helados: "helados.html", bebidas: "bebidas.html" };
  var PAGE_SCROLL_KEY = "toppings_page_scroll_";
  var PAGE_SLIDE_KEY = "toppings_page_slide_dir";
  // Zonas con su propio manejo de deslizar/scroll horizontal — nunca deben
  // interpretarse como "cambiar de página" (carrusel del premio, el juego,
  // la galería ampliada, el chat). La barra de categorías (.nav) YA NO se
  // excluye: solo 3 pestañas, nunca necesita su propio scroll horizontal,
  // así que deslizar también funciona empezando justo encima de ella.
  var PAGE_SWIPE_EXCLUDE = "[data-prize-methods], .run-canvas-wrap, [data-lightbox], .assistant-panel, #nav-mobile, .run-overlay, [data-cat-carousel]";

  function slideMainOut(direction, onDone) {
    var main = $("#main");
    if (!main) { onDone(); return; }
    main.classList.add("is-sliding");
    void main.offsetWidth; // fuerza reflow para que la transición se aplique
    main.style.transform = direction === "next" ? "translateX(-100%)" : "translateX(100%)";
    var done = false;
    var finish = function () { if (done) return; done = true; onDone(); };
    main.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 420); // respaldo si el navegador no dispara transitionend
  }

  function applyIncomingSlide() {
    var main = $("#main");
    var dir;
    try { dir = sessionStorage.getItem(PAGE_SLIDE_KEY); } catch (e) { dir = null; }
    if (!dir || !main) return;
    try { sessionStorage.removeItem(PAGE_SLIDE_KEY); } catch (e) {}
    main.style.transition = "none";
    main.style.transform = dir === "next" ? "translateX(100%)" : "translateX(-100%)";

    // Nunca debe quedar a medio deslizar: si requestAnimationFrame se
    // retrasa (pestaña en segundo plano, etc.) o transitionend no llega,
    // este respaldo garantiza que #main siempre termine en su posición
    // normal (sin transform), aunque no se vea la animación.
    var settled = false;
    var settle = function () {
      if (settled) return;
      settled = true;
      main.classList.remove("is-sliding");
      main.style.transform = "";
      main.style.transition = "";
    };
    setTimeout(settle, 700);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        main.style.transition = "";
        main.classList.add("is-sliding");
        main.style.transform = "translateX(0)";
        main.addEventListener("transitionend", settle, { once: true });
      });
    });
  }

  function initPageNav() {
    var current = document.body.getAttribute("data-category");
    var idx = PAGE_ORDER.indexOf(current);
    if (idx === -1) return; // misterio.html, creditos.html, admin: sin esta función

    applyIncomingSlide();

    var prevKey = idx > 0 ? PAGE_ORDER[idx - 1] : null;
    var nextKey = idx < PAGE_ORDER.length - 1 ? PAGE_ORDER[idx + 1] : null;

    var goTo = function (key, direction) {
      try { sessionStorage.setItem(PAGE_SCROLL_KEY + current, String(window.scrollY)); } catch (e) {}
      try { sessionStorage.setItem(PAGE_SLIDE_KEY, direction); } catch (e) {}
      slideMainOut(direction, function () { location.href = PAGE_URL[key]; });
    };

    var prevBtn = $("[data-pagenav='prev']");
    var nextBtn = $("[data-pagenav='next']");
    if (prevBtn) {
      if (!prevKey) prevBtn.hidden = true;
      else prevBtn.addEventListener("click", function () { goTo(prevKey, "prev"); });
    }
    if (nextBtn) {
      if (!nextKey) nextBtn.hidden = true;
      else nextBtn.addEventListener("click", function () { goTo(nextKey, "next"); });
    }

    // El logo (vuelve a Inicio) y las pestañas Comida/Helados/Bebidas del
    // header son OTRA forma de cambiar de página — deben guardar/recordar
    // el scroll exactamente igual que las flechas y que deslizar el dedo,
    // así que también pasan por goTo() en vez de navegar de forma directa.
    $$(".nav a[href], .brand[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var base = href.split("#")[0].split("/").pop();
      var targetKey = null;
      for (var k in PAGE_URL) { if (PAGE_URL[k] === base) { targetKey = k; break; } }
      if (!targetKey || targetKey === current) return;
      var direction = PAGE_ORDER.indexOf(targetKey) > idx ? "next" : "prev";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        goTo(targetKey, direction);
      });
    });

    try {
      var saved = sessionStorage.getItem(PAGE_SCROLL_KEY + current);
      if (saved != null) {
        var savedY = parseInt(saved, 10) || 0;
        window.scrollTo(0, savedY);
        // Las imágenes del menú aún pueden estar cargando: el alto real de la
        // página crece después de este primer intento, así que se reintenta
        // cuando cada imagen termina de cargar y una última vez en "load".
        var reapply = function () { window.scrollTo(0, savedY); };
        $$("[data-menu-image] img").forEach(function (img) {
          if (!img.complete) img.addEventListener("load", reapply, { once: true });
        });
        window.addEventListener("load", reapply, { once: true });
      }
    } catch (e) {}

    // Las flechas de página (prev/next) son siempre visibles mientras la
    // función esté activada (a diferencia de la flecha de subir/bajar, que
    // sí aparece solo al deslizar) — su único control es el interruptor del
    // admin. El deslizar con el dedo funciona aparte, sin depender de ellas.

    // Deslizar con el dedo (o el mouse) hacia los lados para cambiar de página.
    var touchStartX = 0, touchStartY = 0, touching = false, excluded = false;
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      excluded = !!e.target.closest(PAGE_SWIPE_EXCLUDE);
      if (excluded) return;
      touching = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener("touchend", function (e) {
      if (!touching || excluded) { touching = false; return; }
      touching = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchStartX;
      var dy = t.clientY - touchStartY;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      if (dx < 0 && nextKey) goTo(nextKey, "next");
      else if (dx > 0 && prevKey) goTo(prevKey, "prev");
    }, { passive: true });
  }

  /* ---------------- Hero text (Inicio only) ---------------- */
  function mountHero() {
    var hero = data.hero;
    if (!hero) return;
    var kickerEl = $("[data-hero-kicker]");
    if (kickerEl && hero.kicker) kickerEl.textContent = hero.kicker;
    var subEl = $("[data-hero-sub]");
    if (subEl && hero.subtitle) subEl.textContent = hero.subtitle;
    var ctaPrimary = $("[data-hero-cta-primary]");
    if (ctaPrimary && hero.ctaPrimaryLabel) ctaPrimary.textContent = hero.ctaPrimaryLabel;
    var ctaSecondary = $("[data-hero-cta-secondary]");
    if (ctaSecondary && hero.ctaSecondaryLabel) ctaSecondary.textContent = hero.ctaSecondaryLabel;
  }

  /* ---------------- Header quick-nav labels (Comidas/Helados/Bebidas) ---------------- */
  function mountQuickNav() {
    var items = data.quickNav || [];
    if (!items.length) return;
    $$("[data-nav] a").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var base = href.split("#")[0].split("/").pop();
      var match = items.filter(function (it) { return it.target === base; })[0];
      if (!match) return;
      var iconEl = $(".nav-icon", a);
      var labelEl = $(".nav-label", a);
      if (iconEl && match.icon) iconEl.textContent = match.icon;
      if (labelEl && match.label) labelEl.textContent = match.label;
    });
  }

  /* ---------------- Category menu (image list, one or more frames per page) ---------------- */
  function mountCategoryMenu() {
    var bodyCategory = document.body.getAttribute("data-category");
    if (bodyCategory) {
      var bodyInfo = data[bodyCategory];
      if (bodyInfo) {
        var titleEl = $("[data-category-title]");
        if (titleEl && bodyInfo.title) titleEl.textContent = bodyInfo.title;
        var subEl = $("[data-category-subtitle]");
        if (subEl && bodyInfo.subtitle) subEl.textContent = bodyInfo.subtitle;
      }
    }

    $$("[data-menu-image]").forEach(function (frame) {
      var category = frame.getAttribute("data-menu-category") || bodyCategory;
      var info = category && data[category];
      if (!info) return;

      /* Las imágenes ocultas desde el panel se guardan aparte, en
         `hiddenImages`, en vez de cambiar `images` de lista de rutas a lista
         de objetos: así lo que ya está guardado sigue funcionando igual y
         una imagen oculta se recupera sin volver a subirla.

         Importante: se recorre la lista COMPLETA y solo se omite el <img> de
         las ocultas. La posición del carrusel es un índice sobre esa lista
         completa (es la que se ve en el panel), así que ocultar una imagen no
         debe correr el carrusel de lugar. */
      var images = info.images || [];
      var hidden = info.hiddenImages || [];
      var visibleCount = images.filter(function (src) { return hidden.indexOf(src) === -1; }).length;
      if (visibleCount) {
        // El menú se arma por BLOQUES: cada imagen es un bloque y el carrusel
        // (si está activo) es otro bloque más, insertado en la posición que el
        // admin haya elegido. Así se puede poner antes, entre o después de
        // cualquier imagen sin tocar código.
        frame.innerHTML = "";
        var carousel = activeCarouselFor(info);
        var at = carousel ? Math.max(0, Math.min(images.length, Number(carousel.position) || 0)) : -1;

        if (at === 0) insertCategoryCarousel(frame, carousel, category);
        var shown = 0;
        images.forEach(function (src, i) {
          if (hidden.indexOf(src) === -1) {
            var img = document.createElement("img");
            img.src = src;
            img.alt = (info.title || category) + " — parte " + (shown + 1);
            img.loading = shown === 0 ? "eager" : "lazy";
            img.decoding = "async";
            frame.appendChild(img);
            shown++;
          }
          if (at === i + 1) insertCategoryCarousel(frame, carousel, category);
        });
      } else {
        var emptyMsg = frame.getAttribute("data-empty-msg") ||
          ("Todavía no hemos subido el menú de " + (info.title || category).toLowerCase() + ".");
        frame.innerHTML =
          '<div class="menu-empty">' +
          "<p>" + escHTML(emptyMsg) + "</p>" +
          '<p>Escríbenos por WhatsApp y te contamos qué tenemos hoy.</p>' +
          "</div>";
      }
    });
  }

  /* ---------------- Carrusel de categoría (diapositivas) ----------------
     La implementación vive en lib/cat-carousel.js porque el panel de
     administración la reutiliza para su vista previa — así lo que se ve al
     configurar es exactamente lo que verá el cliente. */
  function activeCarouselFor(info) {
    return window.__catCarousel ? window.__catCarousel.activeConfig(info) : null;
  }
  function insertCategoryCarousel(frame, cfg, category) {
    if (window.__catCarousel) window.__catCarousel.insert(frame, cfg, category);
  }

  /* ---------------- Mystery floating button ---------------- */
  function initMysteryFab() {
    var btn = $("[data-fab-mystery]");
    var bubble = $("[data-fab-bubble]");
    if (!btn || !bubble) return;

    var zona = data.zonaSecreta || {};
    var textEl = $("[data-fab-bubble-text]", bubble);
    if (textEl && zona.bubbleText) textEl.textContent = zona.bubbleText;

    var AUTO_HIDE_MS = 6000;
    var hideTimer = null;

    function showBubble(autoHide) {
      bubble.classList.add("is-visible");
      clearTimeout(hideTimer);
      // Solo se esconde sola la primera vez, la que aparece al entrar. Si fue
      // el cliente quien la abrió, se queda hasta que él la cierre.
      if (autoHide) {
        hideTimer = setTimeout(function () {
          bubble.classList.remove("is-visible");
        }, AUTO_HIDE_MS);
      }
    }

    function hideBubble() {
      clearTimeout(hideTimer);
      bubble.classList.remove("is-visible");
    }

    setTimeout(function () {
      btn.classList.add("is-visible");
      if (!reduced) btn.classList.add("is-pulsing");
      showBubble(true);
    }, 5000);

    // Un clic muestra el mensaje y otro lo esconde.
    btn.addEventListener("click", function () {
      if (bubble.classList.contains("is-visible")) hideBubble();
      else showBubble(false);
    });
  }

  /* ---------------- Asistente virtual (IA) ---------------- */
  var ASSISTANT_API = "api/assistant.php";
  var ASSISTANT_GREETED_KEY = "toppings_assistant_greeted";

  function initAssistant() {
    var ai = data.aiAssistant;
    if (!ai || !ai.active) return;

    var wrap = $("[data-assistant-wrap]");
    var toggleBtn = $("[data-assistant-toggle]");
    var panel = $("[data-assistant-panel]");
    var closeBtn = $("[data-assistant-close]");
    var messagesEl = $("[data-assistant-messages]");
    var nameForm = $("[data-assistant-name-form]");
    var nameInput = $("[data-assistant-name-input]");
    var chatForm = $("[data-assistant-chat-form]");
    var chatInput = $("[data-assistant-chat-input]");
    if (!wrap || !toggleBtn || !panel || !messagesEl) return;
    wrap.hidden = false;

    var history = [];
    var busy = false;

    function addMessage(role, text) {
      var el = document.createElement("div");
      el.className = "assistant-msg " + (role === "user" ? "is-user" : "is-bot");
      el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return el;
    }

    function openPanel() { panel.hidden = false; }
    function closePanel() { panel.hidden = true; }

    function showChatMode() {
      if (nameForm) nameForm.hidden = true;
      if (chatForm) chatForm.hidden = false;
      if (chatInput && !reduced) chatInput.focus();
    }
    function showNameMode() {
      if (chatForm) chatForm.hidden = true;
      if (nameForm) nameForm.hidden = false;
      if (nameInput && !reduced) nameInput.focus();
    }

    toggleBtn.addEventListener("click", function () {
      if (panel.hidden) openPanel(); else closePanel();
    });
    if (closeBtn) closeBtn.addEventListener("click", closePanel);

    // El saludo (de bienvenida o de pedir el nombre) solo se agrega al chat
    // y se abre solo una vez por sesión — cambiar de sección (otra página)
    // no debe repetirlo ni volver a abrir el panel solo.
    var alreadyGreetedThisSession = !!sessionStorage.getItem(ASSISTANT_GREETED_KEY);
    var savedName = localStorage.getItem(LOYALTY_NAME_KEY) || "";

    if (!savedName) {
      addMessage("bot", "👋 ¡Hola! Antes de comenzar, ¿cómo te llamas?");
      showNameMode();
    } else if (!alreadyGreetedThisSession) {
      addMessage("bot", "👋 Hola, " + savedName + ". ¡Bienvenido nuevamente a Toppings! Si necesitas saber algo, solo pregúntame. 😊");
      showChatMode();
    } else {
      showChatMode();
    }

    if (!alreadyGreetedThisSession) {
      sessionStorage.setItem(ASSISTANT_GREETED_KEY, "1");
      setTimeout(function () { if (panel.hidden) openPanel(); }, 1600);
    }

    if (nameForm) {
      nameForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = (nameInput.value || "").trim();
        if (!name) return;
        // mismo aviso que en el resto del sitio si el nombre ya lo usa otra
        // persona: "continuar" lo deja igual, "cambiar" lo devuelve al campo
        checkNameThenProceed(name, function () {
          setCustomerName(name);
          nameInput.value = "";
          addMessage("user", name);
          addMessage("bot", "👋 ¡Mucho gusto, " + name + "! Aquí estoy para ayudarte. Si tienes cualquier duda sobre Toppings, solo pregúntame. 😊");
          showChatMode();
        }, function () { nameInput.select(); nameInput.focus(); });
      });
    }

    function sendMessage(text) {
      if (busy) return;
      busy = true;
      addMessage("user", text);
      var typingEl = addMessage("bot", "Escribiendo…");
      typingEl.classList.add("is-typing");

      fetch(ASSISTANT_API + "?action=chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, name: localStorage.getItem(LOYALTY_NAME_KEY) || "", history: history })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          typingEl.remove();
          busy = false;
          if (res && res.ok) {
            history.push({ role: "user", content: text });
            history.push({ role: "assistant", content: res.reply });
            if (history.length > 16) history = history.slice(-16);
            addMessage("bot", res.reply);
          } else {
            addMessage("bot", (res && res.error) || "No tengo esa información confirmada. Puedes comunicarte directamente con el equipo de Toppings.");
          }
        })
        .catch(function () {
          typingEl.remove();
          busy = false;
          addMessage("bot", "No se pudo conectar. Intenta de nuevo en un momento.");
        });
    }

    if (chatForm) {
      chatForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = (chatInput.value || "").trim();
        if (!text) return;
        chatInput.value = "";
        sendMessage(text);
      });
    }

    setTimeout(function () { wrap.classList.add("is-ready"); }, 400);
  }

  /* ---------------- Gallery + lightbox ---------------- */
  function mountGallery() {
    var grid = $("[data-gallery]");
    if (!grid) return;
    var items = data.galeria || [];
    grid.innerHTML = items.map(function (g, i) {
      return '<button class="gallery-item" data-reveal data-index="' + i + '" aria-label="Ampliar imagen: ' + escHTML(g.alt || "") + '">' +
        '<img src="' + escHTML(g.image) + '" alt="' + escHTML(g.alt || "") + '" loading="lazy" decoding="async"></button>';
    }).join("");
  }

  /* ---------------- Galería de stikers encontrados (reto del día) ---------------- */
  function isSameDay(isoDate) {
    if (!isoDate) return false;
    var d = new Date(isoDate + "T00:00:00");
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function renderStikerItems(grid, items) {
    if (!items.length) {
      grid.innerHTML = '<p class="noscript-note">Todavía no hay stikers encontrados. ¡Sé el primero en cumplir el reto!</p>';
      return;
    }
    grid.innerHTML = items.slice().reverse().map(function (item) {
      var foundToday = isSameDay(item.date);
      return '<div class="stiker-item">' +
        (foundToday ? '<span class="stiker-badge">¡Encontrado hoy!</span>' : "") +
        '<img src="' + escHTML(item.image) + '" alt="' + escHTML(item.alt || "Stiker encontrado") + '" loading="lazy" decoding="async">' +
        (item.alt ? '<p class="stiker-name">' + escHTML(item.alt) + "</p>" : "") +
        "</div>";
    }).join("");
  }

  function mountStikerGallery() {
    var grid = $("[data-stiker-gallery]");
    if (!grid) return;
    grid.innerHTML = '<p class="noscript-note">Cargando…</p>';
    fetch(PRIZE_API + "?action=status", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var items = (res && res.ok && res.state && res.state.stikers) || [];
        renderStikerItems(grid, items);
      })
      .catch(function (e) {
        console.warn("[stikers] no se pudo cargar la galería:", e);
        grid.innerHTML = '<p class="noscript-note">No se pudo cargar la galería. Intenta de nuevo más tarde.</p>';
      });
  }

  function initLightbox() {
    var box = $("[data-lightbox]");
    var img = $("[data-lightbox-img]");
    var closeBtn = $("[data-lightbox-close]");
    if (!box || !img) return;
    var items = data.galeria || [];

    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-gallery] .gallery-item");
      if (!trigger) return;
      var idx = Number(trigger.getAttribute("data-index"));
      var g = items[idx];
      if (!g) return;
      img.src = g.image;
      img.alt = g.alt || "";
      box.hidden = false;
    });

    function close() { box.hidden = true; img.src = ""; }
    if (closeBtn) closeBtn.addEventListener("click", close);
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ---------------- Hours + social + address ---------------- */
  function mountBusinessInfo() {
    var biz = data.business || {};

    if (biz.logo) {
      $$("[data-brand-mark]").forEach(function (el) {
        el.innerHTML = '<img class="brand-logo-img" src="' + escHTML(biz.logo) + '" alt="' + escHTML(biz.name || "TOPPINGS") + '">';
      });
    }

    var hoursList = $("[data-hours]");
    if (hoursList && biz.hours) {
      hoursList.innerHTML = biz.hours.map(function (h) {
        return "<li><span>" + escHTML(h.day) + "</span><span>" + escHTML(h.time) + "</span></li>";
      }).join("");
    }

    var socialRows = $$("[data-social], [data-social-footer]");
    var socialLabels = { instagram: "IG", facebook: "FB", tiktok: "TT" };
    if (biz.social) {
      var html = Object.keys(biz.social).map(function (key) {
        var url = biz.social[key];
        if (!url) return "";
        return '<a href="' + escHTML(url) + '" target="_blank" rel="noopener" aria-label="' + escHTML(key) + '">' + (socialLabels[key] || key.slice(0, 2).toUpperCase()) + "</a>";
      }).join("");
      socialRows.forEach(function (row) { row.innerHTML = html; });
    }

    $$("[data-address], [data-address-footer]").forEach(function (el) {
      if (biz.address) el.textContent = biz.address;
    });

    var mapEl = $("[data-maps-embed]");
    if (mapEl && biz.mapsEmbedUrl) mapEl.src = biz.mapsEmbedUrl;

    var reviewsTitleEl = $("[data-reviews-title]");
    if (reviewsTitleEl && biz.reviewsTitle) reviewsTitleEl.textContent = biz.reviewsTitle;
    var reviewsSubEl = $("[data-reviews-sub]");
    if (reviewsSubEl && biz.reviewsSubtitle) reviewsSubEl.textContent = biz.reviewsSubtitle;
    var reviewsCtaEl = $("[data-reviews-cta]");
    if (reviewsCtaEl && biz.reviewsCtaLabel) reviewsCtaEl.textContent = biz.reviewsCtaLabel;
    var reviewsLinkEl = $("[data-reviews-link]");
    if (reviewsLinkEl && biz.reviewsUrl) reviewsLinkEl.href = biz.reviewsUrl;
  }

  /* ---------------- Reveal on scroll ---------------- */
  function initReveals() {
    var targets = $$("[data-reveal]");
    if (!targets.length) return;
    if (!("IntersectionObserver" in window) || reduced) {
      targets.forEach(function (t) { t.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -40px 0px" });
    targets.forEach(function (t) { io.observe(t); });

    // Safety net: reveal everything after a delay in case observer misfires
    setTimeout(function () {
      targets.forEach(function (t) { t.classList.add("is-visible"); });
    }, 4000);
  }

  /* ---------------- Posición del premio del día en la página ---------------- */
  function positionDailyPrize() {
    var main = document.getElementById("main");
    var section = $("[data-daily-prize]");
    if (!main || !section) return; // solo existe en index.html

    /* Si hay una lista de bloques, ella manda: mueve TODAS las secciones y ya
       colocó esta donde corresponde. Sin este corte, lo de aquí abajo la
       reubicaba después y deshacía el orden elegido en el panel. */
    if (data.home && data.home.blocks && data.home.blocks.length) return;

    var info = data.dailyPrize;
    var position = (info && info.position) || "afterHero";
    var hero = $(".hero", main);
    var comidasSection = $(".menu-page", main);

    function moveBefore(ref) { if (ref) main.insertBefore(section, ref); }
    function moveAfter(ref) {
      if (!ref) return;
      var next = ref.nextSibling;
      if (next) main.insertBefore(section, next);
      else main.appendChild(section);
    }

    if (position === "top") {
      moveBefore(main.firstElementChild);
    } else if (position === "afterComidas" && comidasSection) {
      moveAfter(comidasSection);
    } else if (hero) {
      moveAfter(hero);
    }
  }

  /* ---------------- Premio del día (3 formas de ganar + regalo) ---------------- */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  /* ---- Estado compartido del premio del día (api/premio.php, sin base de datos) ----
     Cada forma de ganar es independiente: la tarjeta de fidelidad y el reto del
     día se bloquean cada uno por su cuenta al reclamarse, sin afectar al otro.
     El cronómetro nunca se bloquea — no usa este estado en absoluto. */
  var PRIZE_API = "api/premio.php";
  var CODES_API = "api/codes.php";
  var RULETA_API_MAIN = "api/ruleta.php";
  var REDEEM_API = "api/redeem.php";
  var premioState = null;
  var premioPollTimer = null;
  var cronometroGen = 0;

  // El reloj del celular puede estar adelantado o atrasado respecto al del
  // servidor (el que de verdad decide cuándo se puede reclamar). Cada vez
  // que llega una respuesta con "serverNow" se recalcula el desfase, y
  // serverAdjustedNow() se usa en vez de Date.now() para que el botón nunca
  // se ponga verde antes (o después) de lo que el servidor permite.
  var clockSkewMs = 0;
  function applyServerClock(state) {
    if (state && typeof state.serverNow === "number") clockSkewMs = state.serverNow - Date.now();
  }
  function serverAdjustedNow() { return Date.now() + clockSkewMs; }

  function fetchPremioStatus(cb) {
    // "&_=" con la hora actual evita que un caché intermedio (del hosting u
    // otro) devuelva una respuesta vieja — "cache: no-store" solo controla
    // el caché del propio navegador, no cachés entre el navegador y el
    // servidor, y eso causaba que el botón se viera "listo" con datos de
    // una ronda anterior aunque el cronómetro real todavía no llegara a 0.
    fetch(PRIZE_API + "?action=status&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) { premioState = res.state; applyServerClock(res.state); if (cb) cb(res.state); }
      })
      .catch(function (e) { console.warn("[premio] no se pudo consultar el estado:", e); });
  }

  function attemptClaim(claimMethod, opts, done) {
    opts = opts || {};
    fetch(PRIZE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim", method: claimMethod, name: opts.name || "", photo: opts.photo || "", deviceId: getDeviceId() })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.state) { premioState = res.state; applyServerClock(res.state); }
        done(res);
      })
      .catch(function (e) {
        console.warn("[premio] no se pudo reclamar:", e);
        done(null);
      });
  }

  /* El reto del día puede tener varios ganadores por día (admin-configurable) —
     a diferencia de la tarjeta/cronómetro, aquí sí se muestra bloqueado una
     vez alcanzado el límite, listando a todos los que ya ganaron hoy. */
  function renderChallengeLockedCard(card, challengeText, claims) {
    claims = claims || [];
    var names = claims.map(function (c) { return escHTML(c.name || "Un cliente"); }).join(", ");
    var lastPhoto = claims.length ? claims[claims.length - 1].photo : null;
    var verb = claims.length > 1 ? "ya ganaron" : "ya ganó";
    card.innerHTML =
      '<p class="prize-method-title">🔒 Ya se alcanzó el número de ganadores de hoy</p>' +
      (challengeText ? '<p class="prize-locked-detail">' + escHTML(challengeText) + '</p>' : "") +
      (lastPhoto ? '<img class="prize-locked-photo" src="' + escHTML(lastPhoto) + '" alt="Foto de un ganador" loading="lazy">' : "") +
      '<p class="prize-locked-text">' + (names || "Ya se ganó el reto de hoy") + (names ? " " + verb : "") + '. ¡Vuelve mañana para una nueva oportunidad! 🎉</p>';
  }

  /* Textos de los 2 botones grandes (Reclamar/Entregar premio) y de los
     títulos de sus modales — todos editables desde el admin. */
  function applyDeliveryLabels(info) {
    var claimBtn = $("[data-open-claim-prize]");
    var deliverBtn = $("[data-open-deliver-prize]");
    var deliverSubtext = $("[data-deliver-prize-subtext]");
    var claimTitle = $("[data-claim-prize-title]");
    var deliverTitle = $("[data-deliver-prize-title]");
    var deliverSubtext2 = $("[data-deliver-prize-subtext-2]");
    var claimLabel = info.claimPrizeButtonLabel || "🎁 Reclamar premio";
    var deliverLabel = info.deliverPrizeButtonLabel || "🔒 Entregar premio";
    var deliverSub = info.deliverPrizeSubtext || "Solo empleados";
    if (claimBtn) claimBtn.textContent = claimLabel;
    if (deliverBtn) deliverBtn.textContent = deliverLabel;
    if (deliverSubtext) deliverSubtext.textContent = deliverSub;
    if (claimTitle) claimTitle.textContent = claimLabel;
    if (deliverTitle) deliverTitle.textContent = deliverLabel;
    if (deliverSubtext2) deliverSubtext2.textContent = deliverSub;
  }

  var PRIZE_METHOD_KEYS = ["cronometro", "loyalty", "challenge", "toppingsRun"];

  /* Orden de las formas de ganar, configurable desde el panel.
     Las claves que la lista guardada no mencione se agregan al final —
     igual que en applyHomeBlocks — así nunca desaparece una forma de ganar
     por una lista incompleta o desactualizada. */
  function orderPrizeMethods(info) {
    var saved = (info && info.methodOrder) || [];
    var out = [];
    var usadas = {};
    saved.forEach(function (key) {
      if (usadas[key] || PRIZE_METHOD_KEYS.indexOf(key) === -1) return;
      usadas[key] = true;
      out.push({ key: key, data: info[key] || {} });
    });
    PRIZE_METHOD_KEYS.forEach(function (key) {
      if (usadas[key]) return;
      usadas[key] = true;
      out.push({ key: key, data: info[key] || {} });
    });
    return out;
  }

  /* Las pestañas hacen wrap.scrollLeft = i * clientWidth, así que el orden
     del DOM tiene que coincidir con el del arreglo. Mover los nodos (en vez
     de reescribir innerHTML) conserva las referencias que el juego ya tiene
     guardadas, así que es seguro hacerlo en cada repintado. */
  function reorderPrizeCards(section, methods) {
    var wrap = $("[data-prize-methods]", section);
    if (!wrap) return;
    methods.forEach(function (m) {
      var card = $('[data-prize-method="' + m.key + '"]', wrap);
      if (card) wrap.appendChild(card);
    });
    // las tarjetas inactivas (ocultas) quedan al final, sin perderse
    $$("[data-prize-method]", wrap).forEach(function (card) {
      if (card.hidden) wrap.appendChild(card);
    });
  }

  function renderPremioSection() {
    safe(renderHeroGreeting, "renderHeroGreeting");
    var section = $("[data-daily-prize]");
    var deliveryActions = $("[data-prize-delivery-actions]");
    if (!section) return;
    var info = data.dailyPrize;
    if (!info || !info.active) {
      section.hidden = true;
      if (deliveryActions) deliveryActions.hidden = true;
      return;
    }

    var methods = orderPrizeMethods(info).filter(function (m) { return m.data.active; });

    if (!methods.length) {
      section.hidden = true;
      if (deliveryActions) deliveryActions.hidden = true;
      return;
    }

    var kickerEl = $("[data-prize-kicker]", section);
    if (kickerEl && info.kicker) kickerEl.textContent = info.kicker;
    section.hidden = false;
    if (deliveryActions) deliveryActions.hidden = false;
    safe(function () { applyDeliveryLabels(info); }, "applyDeliveryLabels");

    $$("[data-prize-method]", section).forEach(function (card) { card.hidden = true; });

    methods.forEach(function (m) {
      if (m.key === "cronometro") safe(function () { mountPrizeCronometro(section, m.data); }, "mountPrizeCronometro");
      else if (m.key === "loyalty") safe(function () { mountPrizeLoyalty(section, m.data); }, "mountPrizeLoyalty");
      else if (m.key === "challenge") safe(function () { mountPrizeChallenge(section, m.data); }, "mountPrizeChallenge");
      else if (m.key === "toppingsRun") safe(function () { mountPrizeToppingsRun(section, m.data); }, "mountPrizeToppingsRun");
    });

    // después de montar (ahí queda definido cuáles quedaron visibles) y antes
    // del selector, que numera las pestañas por posición en el DOM
    safe(function () { reorderPrizeCards(section, methods); }, "reorderPrizeCards");
    safe(function () { initPrizeSwitcher(section, methods); }, "initPrizeSwitcher");
  }

  function pollPremioStatus() {
    var section = $("[data-daily-prize]");
    if (!section) return;
    var prevChallengeClaims = (premioState && premioState.challenge && premioState.challenge.claims && premioState.challenge.claims.length) || 0;
    var prevCronoClaimAt = premioState && premioState.cronometro && premioState.cronometro.lastClaimAt;
    fetchPremioStatus(function (state) {
      var newChallengeClaims = (state && state.challenge && state.challenge.claims && state.challenge.claims.length) || 0;
      var newCronoClaimAt = state && state.cronometro && state.cronometro.lastClaimAt;
      var info = data.dailyPrize || {};
      if (newChallengeClaims !== prevChallengeClaims && info.challenge && info.challenge.active) {
        safe(function () { mountPrizeChallenge(section, info.challenge); }, "mountPrizeChallenge");
      }
      if (newCronoClaimAt !== prevCronoClaimAt && info.cronometro && info.cronometro.active) {
        safe(function () { mountPrizeCronometro(section, info.cronometro); }, "mountPrizeCronometro");
      }
    });
  }

  function mountDailyPrize() {
    var section = $("[data-daily-prize]");
    if (!section) return;
    var info = data.dailyPrize;
    if (!info || !info.active) { section.hidden = true; return; }

    // Se muestra primero en el estado "sin reclamar" (optimista) para no dejar
    // la sección vacía mientras se consulta el servidor, y se corrige apenas responda.
    renderPremioSection();
    fetchPremioStatus(function () { renderPremioSection(); });

    if (premioPollTimer) clearInterval(premioPollTimer);
    // 3s en vez de 20s: para que el botón se ponga gris para todos los
    // celulares casi al instante apenas alguien reclama, sin recargar la
    // página (requisito de sincronización en tiempo real).
    premioPollTimer = setInterval(pollPremioStatus, 3000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) pollPremioStatus();
    });
  }

  /* ---- Selector entre formas de ganar (el cliente elige) ----
     Pestañas fijas abajo (con ícono + nombre) en vez de puntos y flechas —
     mismo carrusel de scroll-snap por debajo, solo cambia el control. */
  var PRIZE_TAB_META = {
    cronometro: { icon: "⏱️", label: "Cronómetro" },
    loyalty: { icon: "🎟️", label: "Fidelidad" },
    challenge: { icon: "🎯", label: "Reto" },
    toppingsRun: { icon: "🎮", label: "Toppings Run" }
  };

  function initPrizeSwitcher(section, methods) {
    var wrap = $("[data-prize-methods]", section);
    var tabsWrap = $("[data-prize-tabs]", section);
    if (!wrap) return;

    var activeKeys = methods.map(function (m) { return m.key; });

    if (activeKeys.length <= 1) {
      if (tabsWrap) tabsWrap.hidden = true;
      return;
    }

    if (tabsWrap) {
      tabsWrap.hidden = false;
      tabsWrap.innerHTML = methods.map(function (m, i) {
        var key = m.key;
        var meta = PRIZE_TAB_META[key] || { icon: "•", label: key };
        var label = (m.data && m.data.label && m.data.label.trim()) || meta.label;
        return '<button type="button" class="prize-tab' + (i === 0 ? " is-active" : "") + '" data-prize-tab="' + i + '">' +
          '<span class="prize-tab-icon">' + meta.icon + '</span><span class="prize-tab-label">' + escHTML(label) + '</span></button>';
      }).join("");
    }

    function updateTabs(i) {
      if (!tabsWrap) return;
      $$(".prize-tab", tabsWrap).forEach(function (t, idx) { t.classList.toggle("is-active", idx === i); });
    }
    function currentIndex() {
      var w = wrap.clientWidth || 1;
      return Math.round(wrap.scrollLeft / w);
    }
    function goTo(i) {
      // Ciclo infinito: pasar del último vuelve al primero, y al revés.
      i = ((i % activeKeys.length) + activeKeys.length) % activeKeys.length;
      wrap.scrollTo({ left: i * wrap.clientWidth, behavior: reduced ? "auto" : "smooth" });
      updateTabs(i);
    }

    /* ---- Movimiento automático entre las formas de ganar ----
       Configurable desde el panel (Premio del día → Movimiento automático).
       Se detiene en cuanto el cliente elige una opción, y vuelve a andar
       cuando desplaza la página: la señal de que ya siguió mirando. */
    var carCfg = (data.dailyPrize && data.dailyPrize.carousel) || {};
    var autoOn = carCfg.active !== false && !reduced && activeKeys.length > 1;
    var stepDir = carCfg.direction === "rtl" ? -1 : 1;
    // el panel lo pide en segundos porque es lo que se entiende; aquí se pasa
    // a milisegundos, con un mínimo para que nunca quede imposible de leer
    var everyMs = Math.max(1500, (Number(carCfg.intervalSeconds) || 5) * 1000);
    var autoTimer = null;
    var pickedByUser = false;
    var pickedAt = 0;

    function autoStop() { clearInterval(autoTimer); autoTimer = null; }
    function autoStart() {
      autoStop();
      if (!autoOn || pickedByUser || document.hidden) return;
      // nunca mientras se está jugando: se llevaría el juego a mitad de partida
      if (document.body.classList.contains("run-no-scroll")) return;
      autoTimer = setInterval(function () {
        if (document.body.classList.contains("run-no-scroll")) return;
        goTo(currentIndex() + stepDir);
      }, everyMs);
    }
    function userPicked() {
      pickedByUser = true;
      pickedAt = Date.now();
      autoStop();
    }

    if (tabsWrap) {
      $$(".prize-tab", tabsWrap).forEach(function (tab, i) {
        tab.addEventListener("click", function () { userPicked(); goTo(i); });
      });
    }
    // deslizar el carrusel con el dedo también cuenta como elegir
    wrap.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") userPicked();
    }, { passive: true });

    var scrollTimer = null;
    wrap.addEventListener("scroll", function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () { updateTabs(currentIndex()); }, 100);
    });

    if (autoOn) {
      window.addEventListener("scroll", function () {
        // margen: el propio gesto de deslizar la tarjeta mueve un poco la página
        if (pickedByUser && Date.now() - pickedAt > 600) {
          pickedByUser = false;
          autoStart();
        }
      }, { passive: true });

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) autoStop(); else autoStart();
      });

      /* A propósito NO se usa IntersectionObserver para pausar cuando la
         sección no está a la vista: ya pasó con el carrusel de las categorías
         que el observador no reporta (o reporta tarde y en falso), y el
         carrusel se quedaba quieto para siempre. Lo que se ahorraría es un
         solo temporizador; no compensa el riesgo de que la función no ande. */
      autoStart();
      window.__prizeAutoRefresh = autoStart;   // lo usa el juego al salir
    }
  }

  /* ---- Método 1: Cronómetro (misma fecha para todos los visitantes, se repite solo) ---- */
  function cronometroRepeatMs(info) {
    var amount = Number(info.repeatAmount) || 0;
    if (!amount) return 0;
    var unitMs = info.repeatUnit === "seconds" ? 1000
      : (info.repeatUnit === "minutes" ? 60000 : 3600000);
    return amount * unitMs;
  }

  /* ============ Cronómetro: dos modos ============
     El admin elige cuál está activo. La configuración del otro no se borra:
     son dos ramas independientes de content.json, así que se puede ir y venir
     entre los dos modos sin perder nada.
       "countdown" -> cuenta regresiva de siempre (más abajo, sin tocar)
       "stopTime"  -> "Detén el tiempo" (mountStopTimeGame) */
  function mountPrizeCronometro(section, info) {
    var card = $('[data-prize-method="cronometro"]', section);
    if (!card) return;

    var countdownWrap = $("[data-cronometro-countdown-mode]", card);
    var stopWrap = $("[data-cronometro-stoptime-mode]", card);
    var esStopTime = info.mode === "stopTime";

    if (countdownWrap) countdownWrap.hidden = esStopTime;
    if (stopWrap) stopWrap.hidden = !esStopTime;

    if (esStopTime) {
      var titleEl2 = $("[data-cronometro-title]", card);
      if (titleEl2) titleEl2.textContent = (info.stopTime && info.stopTime.title) || info.title || "⏱️ Detén el tiempo";
      card.hidden = false;
      safe(function () { mountStopTimeGame(card, info); }, "mountStopTimeGame");
      return;
    }

    var repeatMs = cronometroRepeatMs(info);
    if (repeatMs <= 0) { card.hidden = true; return; }

    var titleEl = $("[data-cronometro-title]", card);
    if (titleEl && info.title) titleEl.textContent = info.title;
    var countdownEl = $("[data-prize-countdown]", card);
    var claimBtn = $('[data-prize-claim-btn="cronometro"]', card);
    var claimedMsgEl = $("[data-crono-claimed]", card);
    var daysEl = $("[data-prize-days]", card);
    var hoursEl = $("[data-prize-hours]", card);
    var minutesEl = $("[data-prize-minutes]", card);
    var secondsEl = $("[data-prize-seconds]", card);
    function pad(n) { return (n < 10 ? "0" : "") + n; }

    card.hidden = false;
    if (claimBtn) { claimBtn.hidden = false; claimBtn.textContent = info.claimButtonLabel || "🎁 Reclamar premio"; }

    // Sin fecha configurable: el temporizador arranca cada día a medianoche
    // (mismo momento para todos), o desde el último reclamo de hoy si ya
    // hubo uno. El servidor calcula "unlocksAtMs" — el instante EXACTO en
    // que se puede volver a reclamar — con su propio reloj y zona horaria
    // (America/Bogota), nunca con la hora ni la zona horaria de cada
    // celular (que puede estar mal puesta o distinta entre dispositivos).
    // Así todos cuentan regresiva hacia el mismo instante, como un
    // cronómetro de transmisión en vivo — nunca de forma local. Cuando
    // llega ahí el botón se pone verde y el conteo se congela en cero —
    // así se queda hasta que alguien reclame, momento en el que se
    // restablece por el mismo tiempo y queda un aviso de quién ganó hoy.
    var cronoState = (premioState && premioState.cronometro) || {};
    if (claimedMsgEl) {
      if (cronoState.lastClaimName) {
        claimedMsgEl.hidden = false;
        claimedMsgEl.textContent = "🏆 Hoy " + cronoState.lastClaimName + " ya ganó con el cronómetro.";
      } else {
        claimedMsgEl.hidden = true;
      }
    }

    // Antes de recibir datos del servidor (primer render optimista) no hay
    // "unlocksAtMs" todavía — se corrige apenas responda la consulta real.
    var unlocksAtMs = cronoState.unlocksAtMs || (serverAdjustedNow() + repeatMs);

    cronometroGen++;
    var myGen = cronometroGen;

    function tick() {
      if (myGen !== cronometroGen) return;
      var now = serverAdjustedNow();
      var diff = Math.max(0, unlocksAtMs - now);
      var unlocked = diff <= 0;
      if (claimBtn) {
        claimBtn.disabled = !unlocked;
        claimBtn.classList.toggle("is-ready", unlocked);
        claimBtn.classList.toggle("is-locked", !unlocked);
      }

      if (countdownEl) countdownEl.hidden = false;
      var totalSeconds = Math.floor(diff / 1000);
      if (daysEl) daysEl.textContent = String(Math.floor(totalSeconds / 86400));
      if (hoursEl) hoursEl.textContent = pad(Math.floor((totalSeconds % 86400) / 3600));
      if (minutesEl) minutesEl.textContent = pad(Math.floor((totalSeconds % 3600) / 60));
      if (secondsEl) secondsEl.textContent = pad(totalSeconds % 60);
      if (!unlocked) setTimeout(tick, 1000);
    }
    tick();

    if (claimBtn) {
      claimBtn.onclick = function () {
        function doClaim(name) {
          if (name) setCustomerName(name);
          claimBtn.disabled = true;
          attemptClaim("cronometro", { name: name || "" }, function (res) {
            if (res && res.ok) {
              openClaimResult(res, info.prizeText, "Hola TOPPINGS! Quiero reclamar el premio del cronómetro 🎁 Mi nombre es " + (name || ""), { icon: info.prizeIcon });
              safe(function () { mountPrizeCronometro(section, info); }, "mountPrizeCronometro");
            } else if (res && res.alreadyClaimed) {
              alert("¡Todavía no está listo, o alguien se te adelantó justo ahora!");
              safe(function () { mountPrizeCronometro(section, info); }, "mountPrizeCronometro");
            } else {
              claimBtn.disabled = false;
              alert("No se pudo reclamar el premio. Revisa tu conexión e intenta de nuevo.");
            }
          });
        }
        var existingName = localStorage.getItem(LOYALTY_NAME_KEY);
        if (existingName) { doClaim(existingName); return; }
        /* Sin nombre no se reclama. Antes se colaba como "Cliente" y en el
           aviso de ganador y en el panel quedaba gente sin identificar. */
        askNameWithCheck(function (name) {
          name = (name || "").trim();
          if (name) doClaim(name);
        });
      };
    }
  }

  /* ============ Modo 2 del cronómetro: "Detén el tiempo" ============
     Sube un cronómetro y hay que detenerlo justo en el tiempo que configuró el
     admin. Quien decide si ganó es el servidor (api/stoptime.php); acá solo se
     mide y se dibuja.

     El tiempo se mide con performance.now(), que es monótono: no lo afecta que
     el reloj del celular esté mal puesto ni que cambie la hora a mitad del
     intento. El valor que se manda es EXACTAMENTE el que quedó en pantalla al
     tocar DETENER — se calcula en el mismo momento del clic, no del dibujado. */
  var STOPTIME_API = "api/stoptime.php";
  var stopTimeTimer = null;
  var stopTimeRun = null;          // { attemptId, t0 } mientras el cronómetro corre
  var cuentaRegresivaTimer = null; // conteo hasta que se le renueva el intento

  /** "2 h 05 min", "12:34" o "45 s" — lo más corto que se entienda. */
  function formatFaltante(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    if (h >= 1) return h + " h " + p2(m) + " min";
    if (m >= 1) return m + ":" + p2(s) + " min";
    return s + " s";
  }

  function formatStopTime(ms) {
    ms = Math.max(0, Math.round(ms));
    var cent = Math.floor((ms % 1000) / 10);
    var totalSeg = Math.floor(ms / 1000);
    var min = Math.floor(totalSeg / 60);
    var seg = totalSeg % 60;
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return p2(min) + ":" + p2(seg) + "." + p2(cent);
  }

  function precisionHint(precision, targetMs) {
    var t = formatStopTime(targetMs);
    if (precision === "easy") return "Detenlo en el segundo " + Math.floor(targetMs / 1000) + " (" + t + ")";
    if (precision === "hard") return "Detenlo exactamente en " + t + " — hasta las centésimas";
    return "Detenlo en " + t + " (tienes un margen de una décima)";
  }

  function mountStopTimeGame(card, info) {
    // Si hay un intento corriendo, no se vuelve a dibujar: un repintado a
    // mitad del intento reiniciaría el cronómetro del cliente.
    if (stopTimeRun) return;

    var cfg = info.stopTime || {};
    var targetEl = $("[data-stoptime-target]", card);
    var clockEl = $("[data-stoptime-clock]", card);
    var msgEl = $("[data-stoptime-msg]", card);
    var actionBtn = $("[data-stoptime-action]", card);
    var attemptsEl = $("[data-stoptime-attempts]", card);
    var prizeBtn = $("[data-stoptime-prize]", card);
    if (!clockEl || !actionBtn || !prizeBtn) return;

    function setMsg(text, kind) {
      if (!msgEl) return;
      msgEl.textContent = text || "";
      msgEl.hidden = !text;
      msgEl.classList.toggle("is-win", kind === "win");
      msgEl.classList.toggle("is-lose", kind === "lose");
    }

    /* Los 4 estados del botón del premio, tal como se pidieron:
       antes de jugar gris, al ganar verde, al fallar rojo, y gris otra vez
       cuando el premio ya se reclamó. */
    /* Es el mismo botón de reclamo que en todas las demás formas de ganar: el
       texto no cambia según el tipo de premio, solo el color y si se puede
       tocar. Lo que hay detrás (premio para reclamar o tiro de Ruleta) lo
       resuelve la ventana del regalo, no el botón. */
    function paintPrize(mine) {
      prizeBtn.classList.remove("is-ready", "is-lost", "is-locked");
      if (mine.state === "won" && mine.prizeClaimed) {
        prizeBtn.textContent = cfg.claimedLabel || "Premio reclamado";
        prizeBtn.classList.add("is-locked");
        prizeBtn.disabled = true;
      } else if (mine.state === "won") {
        prizeBtn.textContent = cfg.claimLabel || "Reclamar premio";
        prizeBtn.classList.add("is-ready");
        prizeBtn.disabled = false;
      } else if (mine.state === "lost") {
        prizeBtn.textContent = cfg.retryLabel || "Inténtalo en la próxima oportunidad";
        prizeBtn.classList.add("is-lost");
        prizeBtn.disabled = true;
      } else {
        prizeBtn.textContent = cfg.idleLabel || "Detén el tiempo exacto para ganar";
        prizeBtn.classList.add("is-locked");
        prizeBtn.disabled = true;
      }
    }

    /* Línea de abajo: o los intentos que le quedan, o —si ya los gastó— cuánto
       falta para que se le renueven. El conteo se dibuja acá cada segundo y se
       apoya en el reloj DEL SERVIDOR (nextAttemptAtMs viene con serverNow al
       lado), no en el del celular, que puede estar mal puesto. */
    function renderAttemptsLine(st) {
      if (!attemptsEl) return;
      if (cuentaRegresivaTimer) { clearInterval(cuentaRegresivaTimer); cuentaRegresivaTimer = null; }

      var quedan = st.attemptsLeft > 0;

      if (quedan) {
        attemptsEl.textContent = "Te queda" + (st.attemptsLeft === 1 ? "" : "n") + " " + st.attemptsLeft +
          " intento" + (st.attemptsLeft === 1 ? "" : "s");
        return;
      }

      if (!st.nextAttemptAtMs) {
        // modo manual: no hay una hora fija que mostrar
        attemptsEl.textContent = "Ya jugaste. Espera a que el negocio habilite una nueva oportunidad.";
        return;
      }

      var desfase = st.nextAttemptAtMs - (st.serverNow || Date.now());
      var vencimiento = Date.now() + desfase;

      function pintar() {
        var falta = vencimiento - Date.now();
        if (falta <= 0) {
          if (cuentaRegresivaTimer) { clearInterval(cuentaRegresivaTimer); cuentaRegresivaTimer = null; }
          attemptsEl.textContent = "¡Ya puedes volver a jugar!";
          fetchStatus();   // se recarga el estado y vuelve a aparecer EMPEZAR
          return;
        }
        attemptsEl.textContent = "Vuelves a jugar en " + formatFaltante(falta);
      }
      pintar();
      cuentaRegresivaTimer = setInterval(pintar, 1000);
    }

    function render(st) {
      if (targetEl) targetEl.textContent = precisionHint(st.precision, st.targetMs);

      var mine = st.mine || { state: "none" };
      /* No hay rondas: el juego está abierto siempre que esté dentro de sus
         fechas, y quién puede jugar lo decide el tiempo de reinicio. Quien ya
         ganó no repite hasta que le toque de nuevo; quien falló vuelve solo si
         le quedan intentos del periodo. */
      var puedeJugar = st.attemptsLeft > 0 && mine.state !== "won";

      if (mine.elapsedMs != null) clockEl.textContent = formatStopTime(mine.elapsedMs);
      else clockEl.textContent = formatStopTime(0);
      clockEl.classList.remove("is-running");
      clockEl.classList.toggle("is-win", mine.state === "won");
      clockEl.classList.toggle("is-lose", mine.state === "lost");

      if (mine.state === "won") {
        var txtGano = cfg.winMessage || "🎉 ¡Felicidades! Detuviste el tiempo exacto y ganaste un premio.";
        if (mine.rewardType === "wheelSpins" && mine.wheelSpins > 0) {
          txtGano += " Ganaste " + mine.wheelSpins + " tiro" + (mine.wheelSpins === 1 ? "" : "s") + " en la Ruleta.";
        }
        setMsg(txtGano, "win");
      } else if (mine.state === "lost") {
        var base = st.attemptsLeft > 0
          ? "❌ No era el tiempo exacto. Te detuviste en " + formatStopTime(mine.elapsedMs || 0) + "."
          : (cfg.loseMessage || "❌ Estuviste cerca. Inténtalo cuando haya una nueva oportunidad.") +
            " (te detuviste en " + formatStopTime(mine.elapsedMs || 0) + ")";
        setMsg(base, "lose");
      } else if (!st.inWindow) {
        setMsg("Esta dinámica no está disponible en este momento.", "");
      } else {
        setMsg("", "");
      }

      actionBtn.hidden = !puedeJugar;
      // "running" = arrancó un intento y no lo detuvo (recargó la página). El
      // intento NO se le devuelve: al continuar, el cronómetro sigue desde el
      // tiempo que ya llevaba corriendo en el servidor.
      actionBtn.textContent = mine.state === "running"
        ? (cfg.resumeLabel || "▶️ CONTINUAR")
        : (cfg.startLabel || "▶️ EMPEZAR");
      actionBtn.disabled = false;
      actionBtn.onclick = empezar;

      renderAttemptsLine(st);
      paintPrize(mine);
      prizeBtn.onclick = function () { reclamar(mine); };
    }

    /* Abre la MISMA ventana con la caja de regalo que usan todas las demás
       formas de ganar. openClaimResult ya sabe distinguir sola entre un premio
       para reclamar y tiros de Ruleta: solo hay que armarle el mismo bloque
       que le manda premio.php. Se reconstruye desde el estado y no desde la
       respuesta de "detener", para que siga funcionando después de recargar. */
    function reclamar(mine) {
      if (mine.state !== "won" || mine.prizeClaimed) return;

      var res = {};
      if (mine.rewardType === "wheelSpins") {
        res.wheelGranted = { count: mine.wheelSpins || 1 };
      } else if (mine.prizeName) {
        res.codeGranted = {
          prizeName: mine.prizeName,
          prizeIcon: mine.prizeIcon || cfg.prizeIcon || "🎁",
          expiresAt: mine.prizeExpiresAt
        };
      }

      var name = "";
      try { name = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}

      safe(function () {
        openClaimResult(
          res,
          cfg.winMessage || "🎉 ¡Felicidades! Detuviste el tiempo exacto y ganaste un premio.",
          "Hola TOPPINGS! Detuve el tiempo exacto y gané un premio 🎁 Mi nombre es " + name,
          { icon: cfg.prizeIcon }
        );
      }, "openClaimResult");

      // Se avisa al servidor para que el botón siga gris aunque recargue.
      fetch(STOPTIME_API + "?action=claim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", deviceId: getDeviceId() })
      })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; })
        .then(function () { fetchStatus(); });
    }

    function fetchStatus(cb) {
      fetch(STOPTIME_API + "?action=status&deviceId=" + encodeURIComponent(getDeviceId()) + "&_=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (st) { if (st && st.ok) { if (cb) cb(st); else render(st); } })
        .catch(function (e) { console.warn("[stoptime] no se pudo consultar el estado:", e); });
    }

    function stopClock() {
      if (stopTimeTimer) { clearInterval(stopTimeTimer); stopTimeTimer = null; }
    }

    function detener() {
      if (!stopTimeRun) return;
      // el valor que se manda es el del instante del clic, no el del último
      // dibujado: si el navegador se atrasó un cuadro, no se pierde precisión
      var elapsed = Math.round(performance.now() - stopTimeRun.t0);
      var attemptId = stopTimeRun.attemptId;
      stopClock();
      clockEl.textContent = formatStopTime(elapsed);
      actionBtn.disabled = true;
      actionBtn.textContent = "Comprobando…";

      var name = "";
      try { name = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}

      fetch(STOPTIME_API + "?action=stop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", deviceId: getDeviceId(), attemptId: attemptId, elapsedMs: elapsed, name: name })
      })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; })
        .then(function (res) {
          stopTimeRun = null;
          if (!res) {
            setMsg("No se pudo enviar tu intento. Revisa tu conexión.", "lose");
            actionBtn.hidden = true;
            return;
          }
          if (!res.ok && res.reason === "time_mismatch") {
            setMsg("No pudimos validar tu tiempo (la conexión tardó demasiado). Ese intento no cuenta como acierto.", "lose");
          }
          if (res.ok && res.won) {
            safe(refreshGiftFab, "refreshGiftFab");
            safe(function () { launchStopTimeConfetti(card, cfg); }, "launchStopTimeConfetti");
            // La ventana del regalo NO se abre sola: queda el botón verde y la
            // abre el cliente al tocar "Reclamar premio", como en el resto.
          }
          if (res.ok && res.noSlots) {
            setMsg("Acertaste, pero los premios de este periodo ya se acabaron.", "lose");
            fetchStatus(function (st) { render(st); setMsg("Acertaste, pero los premios de este periodo ya se acabaron.", "lose"); });
            return;
          }
          fetchStatus();
        });
    }

    /* El nombre se pide ANTES de dejar jugar, igual que en TOPPINGS RUN: sin
       nombre no hay a quién entregarle el premio, y en el panel los ganadores
       salían sin identificar. Si cierra la ventana sin escribir nada, no se
       arranca el intento — no se le gasta. */
    function empezar() {
      var guardado = "";
      try { guardado = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}
      if (guardado) { empezarConNombre(guardado); return; }
      askNameWithCheck(function (name) {
        name = (name || "").trim();
        if (!name) return;   // canceló: se queda como estaba
        empezarConNombre(name);
      });
    }

    function empezarConNombre(name) {
      actionBtn.disabled = true;

      fetch(STOPTIME_API + "?action=start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", deviceId: getDeviceId(), name: name })
      })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; })
        .then(function (res) {
          actionBtn.disabled = false;
          if (!res || !res.ok) {
            var razones = {
              out_of_window: "Esta dinámica no está disponible en este momento.",
              no_attempts: "Ya usaste todos tus intentos."
            };
            setMsg((res && razones[res.reason]) || (res && res.error) || "No se pudo empezar.", "lose");
            fetchStatus();
            return;
          }

          setMsg("", "");
          // mientras juega no tiene sentido el conteo "vuelves a jugar en…"
          if (cuentaRegresivaTimer) { clearInterval(cuentaRegresivaTimer); cuentaRegresivaTimer = null; }
          if (attemptsEl) attemptsEl.textContent = "";
          // Si el intento venía abierto (recargó la página), el cronómetro
          // arranca desde el tiempo que el servidor ya lleva contando — así
          // recargar no regala un intento nuevo ni deja el reloj en cero.
          var yaCorrido = res.resumed ? Math.max(0, (res.serverNow || 0) - (res.startedAt || 0)) : 0;
          stopTimeRun = { attemptId: res.attemptId, t0: performance.now() - yaCorrido };
          actionBtn.textContent = cfg.stopLabel || "DETENER";
          actionBtn.onclick = detener;
          clockEl.classList.remove("is-win", "is-lose");
          clockEl.classList.add("is-running");

          // setInterval y no requestAnimationFrame: rAF se congela cuando la
          // pestaña no está pintando, y el cronómetro tiene que seguir
          // corriendo igual (el mismo motivo por el que el arrastre del panel
          // usa setInterval).
          stopClock();
          stopTimeTimer = setInterval(function () {
            if (!stopTimeRun) { stopClock(); return; }
            clockEl.textContent = formatStopTime(performance.now() - stopTimeRun.t0);
          }, 20);
        });
    }

    actionBtn.onclick = empezar;
    stopClock();
    clockEl.classList.remove("is-running");
    fetchStatus();
  }

  /* Un puñado de destellos al ganar — reutiliza el confeti de la ruleta si
     está cargado, y si no hace uno simple para no depender de esa página. */
  function launchStopTimeConfetti(card, cfg) {
    if (cfg.soundEnabled !== false) safe(function () { playStopTimeWinSound(); }, "playStopTimeWinSound");
    var host = $("[data-stoptime-clock]", card);
    if (!host) return;
    host.classList.remove("is-pop");
    // reinicia la animación aunque se gane dos veces seguidas
    void host.offsetWidth;
    host.classList.add("is-pop");
  }

  function playStopTimeWinSound() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = new AC();
    [880, 1175, 1568].forEach(function (f, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.09 + 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.09);
      osc.stop(ctx.currentTime + i * 0.09 + 0.25);
    });
    setTimeout(function () { try { ctx.close(); } catch (e) {} }, 900);
  }

  /* ---- Método 2: Tarjeta de fidelidad (sellada escaneando un QR en el local) ---- */
  var LOYALTY_STAMPS_KEY = "toppings_loyalty_stamps";
  var LOYALTY_LAST_DAY_KEY = "toppings_loyalty_last_day";
  var LOYALTY_NAME_KEY = "toppings_loyalty_name";

  function mountPrizeLoyalty(section, info) {
    var card = $('[data-prize-method="loyalty"]', section);
    if (!card) return;
    var required = Number(info.stampsRequired) || 8;
    if (!required) { card.hidden = true; return; }
    card.hidden = false;

    // La tarjeta de fidelidad no se bloquea para nadie: cada cliente
    // completa y reclama la suya (sellos guardados en su propio celular)
    // sin afectar a los demás clientes.
    var stampsEl = $("[data-loyalty-stamps]", card);
    var statusEl = $("[data-loyalty-status]", card);
    var scanHintEl = $("[data-loyalty-scan-hint]", card);
    var scanBtn = $("[data-loyalty-scan-btn]", card);
    var greetingEl = $("[data-loyalty-greeting]", card);
    var claimBtn = $('[data-prize-claim-btn="loyalty"]', card);
    if (scanBtn) scanBtn.onclick = openLoyaltyScanModal;
    if (scanHintEl) scanHintEl.textContent = info.scanHintText || "Escanea el código QR que está en el local para sumar tu sello de hoy 📱";
    // el texto del botón lo pone render(), que es quien sabe cuántos sellos faltan

    function getStamps() { return Math.min(required, Number(localStorage.getItem(LOYALTY_STAMPS_KEY) || 0)); }

    function render() {
      var name = localStorage.getItem(LOYALTY_NAME_KEY) || "";
      if (greetingEl) {
        if (name) { greetingEl.hidden = false; greetingEl.textContent = "Hola, " + name + " 👋"; }
        else greetingEl.hidden = true;
      }
      var stamps = getStamps();
      var full = stamps >= required;
      if (stampsEl) {
        stampsEl.innerHTML = "";
        for (var i = 0; i < required; i++) {
          var dot = document.createElement("span");
          dot.className = "loyalty-stamp" + (i < stamps ? " is-filled" : "");
          dot.textContent = i < stamps ? "★" : "";
          stampsEl.appendChild(dot);
        }
      }
      /* El botón del premio está SIEMPRE visible, con los mismos dos estados
         que el cronómetro: gris avisando cuánto falta, verde cuando ya se
         puede reclamar. Antes aparecía de la nada al último sello, así que el
         cliente no sabía que había premio ni cuánto le faltaba. */
      if (claimBtn) {
        claimBtn.hidden = false;
        claimBtn.disabled = !full;
        claimBtn.classList.toggle("is-ready", full);
        claimBtn.classList.toggle("is-locked", !full);
        if (full) {
          claimBtn.textContent = info.claimButtonLabel || "🎁 Reclamar premio";
        } else {
          var faltan = required - stamps;
          claimBtn.textContent = "Te falta" + (faltan === 1 ? "" : "n") + " " + faltan +
            " sello" + (faltan === 1 ? "" : "s") + " para reclamar";
        }
      }

      if (full) {
        if (statusEl) statusEl.hidden = true;
        if (scanHintEl) scanHintEl.hidden = true;
        if (scanBtn) scanBtn.hidden = true;
      } else {
        if (scanHintEl) scanHintEl.hidden = false;
        if (scanBtn) scanBtn.hidden = false;
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = stamps + " de " + required + " sellos";
        }
      }
    }
    render();

    if (claimBtn) {
      claimBtn.onclick = function () {
        claimBtn.disabled = true;
        var name = localStorage.getItem(LOYALTY_NAME_KEY) || "";
        attemptClaim("loyalty", { name: name }, function (res) {
          if (res && res.ok) {
            claimBtn.disabled = false;
            localStorage.setItem(LOYALTY_STAMPS_KEY, "0");
            openClaimResult(res, info.prizeText, "Hola TOPPINGS! Completé mi tarjeta de fidelidad 🎟️ Mi nombre es " + name, { icon: info.prizeIcon });
          } else {
            claimBtn.disabled = false;
            alert("No se pudo reclamar el premio. Revisa tu conexión e intenta de nuevo.");
          }
        });
      };
    }
  }

  /* Si el QR trae una URL completa (ej. https://sitio.com/?sello=1), toma solo
     el código; si ya es el código pelado (lo que lee la cámara de un QR
     simple), lo usa tal cual. Así funciona sin importar qué haya impreso el
     negocio en su QR físico. */
  function extractLoyaltyCode(raw) {
    raw = (raw || "").trim();
    if (!raw) return "";
    try {
      if (/^https?:\/\//i.test(raw)) {
        var fromParam = new URL(raw).searchParams.get("sello");
        if (fromParam) return fromParam.trim();
      }
    } catch (e) {}
    return raw;
  }

  /* Intenta sumar un sello con el código dado (venga de la URL o de la
     cámara) — devuelve por qué falló para poder avisarle al cliente. */
  function tryRedeemLoyaltyCode(rawCode) {
    var info = data.dailyPrize && data.dailyPrize.loyalty;
    if (!info || !info.active) return { ok: false, reason: "inactive" };
    var expected = (info.secretCode || "").trim();
    var scanned = extractLoyaltyCode(rawCode);
    if (!expected || !scanned || scanned.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, reason: "mismatch" };
    }
    if (localStorage.getItem(LOYALTY_LAST_DAY_KEY) === todayKey()) {
      return { ok: false, reason: "already-today" };
    }

    function addStamp() {
      var required = Number(info.stampsRequired) || 8;
      var stamps = Math.min(required, Number(localStorage.getItem(LOYALTY_STAMPS_KEY) || 0) + 1);
      localStorage.setItem(LOYALTY_STAMPS_KEY, String(stamps));
      localStorage.setItem(LOYALTY_LAST_DAY_KEY, todayKey());
      var section = $("[data-daily-prize]");
      if (section) {
        renderPremioSection();
        section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      }
    }

    if (localStorage.getItem(LOYALTY_NAME_KEY)) {
      addStamp();
    } else {
      askNameWithCheck(function (name) {
        setCustomerName(name || "Cliente");
        addStamp();
      });
    }
    return { ok: true };
  }

  /* Escanea el QR del local desde un enlace (ej. si el celular lo abre con
     su propia app de cámara) -> agrega un sello automáticamente. */
  function initLoyaltyQrStamp() {
    var params = new URLSearchParams(location.search);
    var scanned = params.get("sello");
    if (!scanned) return;
    // limpia el parámetro de la URL para que no se vuelva a procesar al recargar
    var cleanUrl = location.pathname + location.hash;
    if (window.history && history.replaceState) history.replaceState(null, "", cleanUrl);
    tryRedeemLoyaltyCode(scanned);
  }

  /* Escanea el QR sin salir de la página: abre la cámara del celular dentro
     de un modal y lee el código con jsQR (librería local, sin depender de
     un servicio externo ni de que el celular tenga su propio lector). */
  var loyaltyScanStream = null;
  var loyaltyScanRafId = null;

  function stopLoyaltyScan() {
    if (loyaltyScanRafId) cancelAnimationFrame(loyaltyScanRafId);
    loyaltyScanRafId = null;
    if (loyaltyScanStream) {
      loyaltyScanStream.getTracks().forEach(function (t) { t.stop(); });
      loyaltyScanStream = null;
    }
    var modal = $("[data-scan-modal]");
    var video = $("[data-scan-video]", modal);
    if (video) video.srcObject = null;
    if (modal) modal.hidden = true;
  }

  function openLoyaltyScanModal() {
    var modal = $("[data-scan-modal]");
    if (!modal) return;
    var video = $("[data-scan-video]", modal);
    var canvas = $("[data-scan-canvas]", modal);
    var statusEl = $("[data-scan-status]", modal);
    if (!video || !canvas) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Tu navegador no permite usar la cámara aquí. Abre la app de cámara de tu celular y apunta al código QR directamente.");
      return;
    }
    if (!window.jsQR) {
      alert("No se pudo cargar el lector de códigos. Recarga la página e intenta de nuevo.");
      return;
    }

    modal.hidden = false;
    if (statusEl) statusEl.textContent = "Acércate al código QR del local 📱";
    var ctx = canvas.getContext("2d", { willReadFrequently: true });

    function scanFrame() {
      if (!loyaltyScanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var result = window.jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
        if (result && result.data) { handleScan(result.data); return; }
      }
      loyaltyScanRafId = requestAnimationFrame(scanFrame);
    }

    function handleScan(raw) {
      var res = tryRedeemLoyaltyCode(raw);
      if (res.ok) {
        if (statusEl) statusEl.textContent = "¡Sello agregado! 🎉";
        setTimeout(stopLoyaltyScan, 700);
      } else if (res.reason === "already-today") {
        if (statusEl) statusEl.textContent = "Ya sumaste tu sello de hoy — vuelve mañana.";
        setTimeout(stopLoyaltyScan, 1600);
      } else {
        if (statusEl) statusEl.textContent = "Ese código no es válido — sigue apuntando…";
        loyaltyScanRafId = requestAnimationFrame(scanFrame);
      }
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(function (stream) {
        loyaltyScanStream = stream;
        video.srcObject = stream;
        video.play();
        loyaltyScanRafId = requestAnimationFrame(scanFrame);
      })
      .catch(function () {
        if (statusEl) statusEl.textContent = "No se pudo acceder a la cámara. Revisa los permisos del navegador e intenta de nuevo.";
      });
  }

  function initLoyaltyScanModalClose() {
    var modal = $("[data-scan-modal]");
    if (!modal) return;
    $$("[data-scan-modal-close]", modal).forEach(function (el) {
      el.addEventListener("click", stopLoyaltyScan);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) stopLoyaltyScan();
    });
  }

  /* ---- Método 3: Reto del día (sube una foto como prueba, no un código) ---- */
  var CHALLENGE_MAX_DIM = 1280;

  function readAndCompressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, CHALLENGE_MAX_DIM / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { cb(reader.result); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  /* ¿El reto de enlace está dentro de sus fechas? Las fechas son opcionales:
     vacías = sin límite. Se comparan como texto AAAA-MM-DD, que ordena
     igual que la fecha, y se usa la fecha local del visitante. */
  function linkChallengeInWindow(link) {
    var hoy = new Date();
    var m = hoy.getMonth() + 1, d = hoy.getDate();
    var today = hoy.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
    if (link.startDate && today < link.startDate) return false;
    if (link.endDate && today > link.endDate) return false;
    return true;
  }

  /* Modalidad "enlace externo": la página solo muestra el reto y lleva al
     enlace. Nada de foto, código, reclamo ni aviso al administrador — la
     prueba se le muestra al mesero en el local. */
  /* La tarjeta del reto puede haber quedado reescrita por
     renderChallengeLockedCard (que reemplaza todo su HTML cuando se agotan
     los ganadores del día). Si el bloque del enlace no está, se reconstruye
     — así el modo enlace funciona igual sin depender de recargar. */
  function ensureChallengeBlocks(card) {
    if ($("[data-challenge-link-mode]", card)) return;
    card.innerHTML =
      '<p class="prize-method-title">🎯 Reto del día</p>' +
      '<p class="prize-challenge-text" data-challenge-text></p>' +
      '<p class="prize-challenge-hint" data-challenge-hint hidden></p>' +
      '<div class="challenge-link-mode" data-challenge-link-mode>' +
        '<img class="challenge-link-banner" data-challenge-link-banner alt="" hidden>' +
        '<p class="challenge-link-prize" data-challenge-link-prize hidden></p>' +
        '<a class="btn btn-primary daily-prize-claim" data-challenge-link-btn href="#" target="_blank" rel="noopener noreferrer"></a>' +
        '<button type="button" class="btn btn-ghost challenge-link-ask" data-challenge-link-ask></button>' +
        '<p class="challenge-link-note" data-challenge-link-note></p>' +
      "</div>";
  }

  function mountChallengeLinkMode(card, info) {
    var link = info.link || {};

    if (!link.url || link.active === false || !linkChallengeInWindow(link)) {
      card.hidden = true;
      return true; // atendido: en modo enlace no se cae al modo foto
    }

    ensureChallengeBlocks(card);
    var photoMode = $("[data-challenge-photo-mode]", card);
    var linkMode = $("[data-challenge-link-mode]", card);
    if (photoMode) photoMode.hidden = true;
    if (linkMode) linkMode.hidden = false;
    card.hidden = false;

    var titleEl = $(".prize-method-title", card);
    if (titleEl && link.title) titleEl.textContent = link.title;

    var textEl = $("[data-challenge-text]", card);
    if (textEl) textEl.textContent = link.description || info.challengeText || "";

    var hintEl = $("[data-challenge-hint]", card);
    if (hintEl) hintEl.hidden = true;

    var bannerEl = $("[data-challenge-link-banner]", card);
    if (bannerEl) {
      if (link.banner) { bannerEl.src = link.banner; bannerEl.hidden = false; }
      else bannerEl.hidden = true;
    }

    var prizeEl = $("[data-challenge-link-prize]", card);
    if (prizeEl) {
      if (link.prizeText) { prizeEl.textContent = "🎁 " + link.prizeText; prizeEl.hidden = false; }
      else prizeEl.hidden = true;
    }

    var btn = $("[data-challenge-link-btn]", card);
    if (btn) {
      btn.textContent = link.buttonLabel || "Participa aquí";
      btn.href = link.url;
    }

    /* En modo enlace NO hay botón de "Reclamar premio": el premio no se
       entrega solo. El cliente cumple el reto, pide su código por WhatsApp, y
       lo escribe en "Introducir código de premio" (panel 🎁). */
    var askBtn = $("[data-challenge-link-ask]", card);
    if (askBtn) {
      var askLabel = link.askButtonLabel || "Ya cumplí, solicitar premio";
      askBtn.textContent = askLabel;
      askBtn.hidden = link.askButtonActive === false;
      askBtn.onclick = function () {
        function abrir(name) {
          if (name) setCustomerName(name);
          var plantilla = link.askMessage ||
            "Hola, soy [nombre]. Cumplí el reto del día. Por favor envíame el código de regalo.";
          var msg = plantilla.replace(/\[nombre\]/gi, name || "un cliente");
          window.open(buildWhatsAppUrl(msg), "_blank", "noopener");
        }
        var existing = null;
        try { existing = localStorage.getItem(LOYALTY_NAME_KEY); } catch (e) {}
        if (existing) abrir(existing);
        else askNameWithCheck(function (name) { abrir(name || ""); });
      };
    }

    var noteEl = $("[data-challenge-link-note]", card);
    if (noteEl) {
      noteEl.textContent = link.note ||
        "Después de completar el reto, muéstrale la prueba al mesero para recibir tu premio.";
    }
    return true;
  }

  function mountPrizeChallenge(section, info) {
    var card = $('[data-prize-method="challenge"]', section);
    if (!card) return;

    // El tipo de reto lo elige el admin. "link" no comparte nada del flujo
    // de la foto: se atiende aquí y se sale.
    if (info.challengeType === "link") {
      if (mountChallengeLinkMode(card, info)) return;
    }

    // ---- Modalidad de siempre: foto de prueba ----
    var photoModeEl = $("[data-challenge-photo-mode]", card);
    var linkModeEl = $("[data-challenge-link-mode]", card);
    if (photoModeEl) photoModeEl.hidden = false;
    if (linkModeEl) linkModeEl.hidden = true;
    // el modo enlace pudo haber cambiado el título; se devuelve al suyo
    var ttl = $(".prize-method-title", card);
    if (ttl) ttl.textContent = "🎯 Reto del día";

    if (!info.challengeText) { card.hidden = true; return; }
    card.hidden = false;

    var challengeInfo = (premioState && premioState.challenge) || { claims: [], limit: 1, remaining: 1 };
    if (challengeInfo.remaining <= 0) {
      renderChallengeLockedCard(card, info.challengeText, challengeInfo.claims);
      return;
    }

    var textEl = $("[data-challenge-text]", card);
    var hintEl = $("[data-challenge-hint]", card);
    var photoInput = $("[data-challenge-photo-input]", card);
    var photoPreview = $("[data-challenge-photo-preview]", card);
    var claimBtn = $('[data-prize-claim-btn="challenge"]', card);
    var photoLabelEl = $("[data-challenge-photo-label]", card);
    if (textEl) textEl.textContent = info.challengeText;
    if (hintEl) {
      if (info.hintText) { hintEl.hidden = false; hintEl.textContent = "💡 Pista: " + info.hintText; }
      else hintEl.hidden = true;
    }
    if (photoLabelEl) photoLabelEl.textContent = info.photoButtonLabel || "📷 Subir foto del stiker";
    if (claimBtn) claimBtn.textContent = info.claimButtonLabel || "✅ Ya cumplí, reclamar";

    var photoDataUrl = "";
    if (claimBtn) claimBtn.disabled = true;
    if (photoPreview) photoPreview.hidden = true;

    if (photoInput) {
      photoInput.value = "";
      photoInput.onchange = function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) return;
        readAndCompressImage(file, function (dataUrl) {
          if (!dataUrl) return;
          photoDataUrl = dataUrl;
          if (photoPreview) { photoPreview.src = photoDataUrl; photoPreview.hidden = false; }
          if (claimBtn) claimBtn.disabled = false;
        });
      };
    }

    if (claimBtn) {
      claimBtn.onclick = function () {
        if (!photoDataUrl) return;
        function doClaim(name) {
          if (name) setCustomerName(name);
          claimBtn.disabled = true;
          attemptClaim("challenge", { name: name || "", photo: photoDataUrl }, function (res) {
            if (res && res.ok) {
              openClaimResult(res, info.prizeText, "Hola TOPPINGS! Cumplí el reto del día 🎯 Les envío la foto de mi stiker para reclamar el premio.", { icon: info.prizeIcon });
            } else if (res && res.alreadyClaimed) {
              alert("¡Justo se te adelantaron! Ya se alcanzó el número de ganadores de hoy para el reto.");
              var chInfo = (res.state && res.state.challenge) || { claims: [], limit: 1, remaining: 0 };
              renderChallengeLockedCard(card, info.challengeText, chInfo.claims);
            } else {
              claimBtn.disabled = false;
              alert("No se pudo reclamar el premio. Revisa tu conexión e intenta de nuevo.");
            }
          });
        }
        var existingName = localStorage.getItem(LOYALTY_NAME_KEY);
        if (existingName) doClaim(existingName);
        else askNameWithCheck(function (name) { doClaim(name || "Cliente"); });
      };
    }
  }

  /* ---- Método 4: TOPPINGS RUN (minijuego, sin estado de servidor todavía) ----
     Este método solo muestra la tarjeta — toda la lógica del juego vive en su
     propio archivo (game/toppings-run.js), separado de main.js a propósito. */
  function mountPrizeToppingsRun(section, info) {
    var card = $('[data-prize-method="toppingsRun"]', section);
    if (!card) return;
    card.hidden = false;
    var taglineEl = $("[data-run-tagline]", card);
    if (taglineEl && info.tagline) taglineEl.textContent = info.tagline;
  }

  /* actionOverride opcional {label, onClick}: reemplaza el botón de WhatsApp
     de la revelación por una acción distinta (ej. "ABRIR RULETA" cuando el
     premio de esta dinámica es un giro en vez de un premio directo). */
  function openPrizeModal(prizeText, claimMessage, onRevealed, actionOverride) {
    var modal = $("[data-prize-modal]");
    if (!modal) return;
    var giftBox = $("[data-gift-box]", modal);
    var reveal = $("[data-prize-reveal]", modal);
    var textEl = $("[data-prize-text]", modal);
    var whatsappEl = $("[data-prize-whatsapp]", modal);

    giftBox.hidden = false;
    giftBox.classList.remove("is-open");
    reveal.hidden = true;
    if (textEl) textEl.textContent = prizeText || "";
    if (whatsappEl) {
      if (actionOverride) {
        whatsappEl.textContent = actionOverride.label;
        whatsappEl.removeAttribute("target");
        whatsappEl.href = "#";
        whatsappEl.onclick = function (e) { e.preventDefault(); actionOverride.onClick(); };
      } else {
        whatsappEl.textContent = "📲 Reclamar por WhatsApp";
        whatsappEl.target = "_blank";
        whatsappEl.onclick = null;
        whatsappEl.href = buildWhatsAppUrl(claimMessage || "Hola TOPPINGS! Quiero reclamar el premio del día 🎁");
      }
    }

    modal.hidden = false;

    function openGift() {
      giftBox.removeEventListener("click", openGift);
      function finish() {
        giftBox.hidden = true;
        reveal.hidden = false;
        playPrizeChime();
        burstConfetti($(".prize-modal-card", modal));
        if (onRevealed) onRevealed();
      }
      if (reduced) { finish(); return; }
      giftBox.classList.add("is-open");
      setTimeout(finish, 550);
    }
    giftBox.addEventListener("click", openGift);
  }
  window.__openPrizeModal = openPrizeModal;

  /* Después de un reclamo exitoso: si la dinámica está configurada como
     premio directo, revela el prizeText de siempre. Si está configurada
     como "Giro en la Ruleta", en vez de eso avisa que ganó tiro(s) y ofrece
     abrir la ruleta — el tiro ya quedó otorgado en el servidor. */
  function openClaimResult(res, prizeText, claimMessage, prizeMeta) {
    if (res && res.wheelGranted) {
      var count = res.wheelGranted.count || 1;
      var msg = "¡FELICIDADES!\nHas ganado " + count + (count > 1 ? " tiros" : " tiro") + " en la Ruleta TOPPINGS.";
      openPrizeModal(msg, claimMessage, null, {
        label: "🎡 ABRIR RULETA",
        onClick: function () {
          var modal = $("[data-prize-modal]");
          if (modal) modal.hidden = true;
          abrirRuleta();
        }
      });
    } else if (res && res.codeGranted) {
      var g = res.codeGranted;
      var icon = (prizeMeta && prizeMeta.icon) || g.prizeIcon || "🎁";
      var durationTxt = g.expiresAt ? formatDuration(g.expiresAt - Date.now()) : "24 horas";
      var msg2 = icon + " ¡Felicidades! Ganaste " + (g.prizeName || "un premio") +
        ".\n\nTienes " + durationTxt + " para reclamarlo. Puedes ver tus premios en el botón de regalo 🎁 (abajo, debajo de WhatsApp)." +
        "\n\nRecuerda: para reclamar tu premio debes estar en el local — no se entrega a domicilio ni para llevar. Acércate al local y pídele al mesero que vas a reclamar un premio.";
      openPrizeModal(msg2, claimMessage, null, {
        label: "🎁 VER MIS PREMIOS",
        onClick: function () {
          var modal = $("[data-prize-modal]");
          if (modal) modal.hidden = true;
          safe(refreshGiftFab, "refreshGiftFab");
          var giftModal = $("[data-gift-codes-modal]");
          if (giftModal) giftModal.hidden = false;
        }
      });
      safe(refreshGiftFab, "refreshGiftFab");
    } else {
      openPrizeModal(prizeText, claimMessage);
    }
  }
  window.__openClaimResult = openClaimResult;

  function initPrizeModalClose() {
    var modal = $("[data-prize-modal]");
    if (!modal) return;
    $$("[data-prize-modal-close]", modal).forEach(function (el) {
      el.addEventListener("click", function () { modal.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });
  }

  /* ---- Reclamar premio (cliente): un solo flujo para TODAS las dinámicas
     (cronómetro, fidelidad, reto, juego, Ruleta) — el cliente escribe su
     código, el servidor lo valida, y al solicitar la entrega queda
     "esperando" hasta que un empleado la confirme desde "Entregar premio". ---- */
  var claimPollTimer = null;
  var currentClaimCode = "";

  function stopClaimPoll() { if (claimPollTimer) clearInterval(claimPollTimer); claimPollTimer = null; }

  function showClaimStage(modal, stage) {
    $$("[data-claim-stage]", modal).forEach(function (el) {
      el.hidden = el.getAttribute("data-claim-stage") !== stage;
    });
  }

  function showClaimError(modal, msg) {
    var errorEl = $("[data-claim-prize-error]", modal);
    if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
  }

  function startClaimPoll(modal, code) {
    stopClaimPoll();
    var deviceId = getDeviceId();
    claimPollTimer = setInterval(function () {
      fetch(CODES_API + "?action=my-status&code=" + encodeURIComponent(code) + "&deviceId=" + encodeURIComponent(deviceId) + "&_=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok && res.status === "delivered") {
            stopClaimPoll();
            showClaimStage(modal, "delivered");
            safe(refreshGiftFab, "refreshGiftFab");
          }
        })
        .catch(function () {});
    }, 3000);
  }

  function verifyClaimCode(modal, code) {
    var nameEl = $("[data-claim-prize-name]", modal);
    var errorEl = $("[data-claim-prize-error]", modal);
    if (errorEl) errorEl.hidden = true;
    var deviceId = getDeviceId();
    fetch(CODES_API + "?action=lookup&code=" + encodeURIComponent(code) + "&deviceId=" + encodeURIComponent(deviceId) + "&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { showClaimError(modal, "No se pudo verificar el código. Intenta de nuevo."); return; }
        if (res.reason === "already_waiting") {
          currentClaimCode = code;
          showClaimStage(modal, "waiting");
          startClaimPoll(modal, code);
          return;
        }
        if (res.reason === "already_delivered") { showClaimStage(modal, "delivered"); return; }
        var REASON_MSG = {
          not_found: "Ese código no existe. Revísalo e intenta de nuevo.",
          wrong_device: "Este código no fue ganado desde este dispositivo.",
          void: "Este código fue anulado.",
          expired: "Este código ya venció."
        };
        if (res.reason !== "ok") { showClaimError(modal, REASON_MSG[res.reason] || "No se pudo verificar el código."); return; }
        currentClaimCode = code;
        if (nameEl) nameEl.textContent = (res.prize.prizeIcon || "🎁") + " " + res.prize.prizeName;
        showClaimStage(modal, "confirm");
      })
      .catch(function () { showClaimError(modal, "No se pudo conectar con el servidor."); });
  }

  /* Abre el modal de reclamo con un código ya escrito — usado por el botón
     flotante de regalo y por el enlace "?claim=CODIGO" (cuando el botón
     flotante se toca desde una página que no tiene este modal). */
  function openClaimModalWithCode(code, autoVerify) {
    var modal = $("[data-claim-prize-modal]");
    if (!modal) {
      location.href = "index.html?claim=" + encodeURIComponent(code || "");
      return;
    }
    var input = $("[data-claim-code-input]", modal);
    stopClaimPoll();
    showClaimStage(modal, "code");
    var errorEl = $("[data-claim-prize-error]", modal);
    if (errorEl) errorEl.hidden = true;
    if (input) input.value = code || "";
    modal.hidden = false;
    if (autoVerify && code) verifyClaimCode(modal, code);
  }
  window.__openClaimModalWithCode = openClaimModalWithCode;

  function initClaimPrizeFlow() {
    var modal = $("[data-claim-prize-modal]");
    if (!modal) return;
    var openBtn = $("[data-open-claim-prize]");
    if (openBtn) openBtn.addEventListener("click", function () { openClaimModalWithCode(""); });
    $$("[data-claim-prize-close]", modal).forEach(function (el) {
      el.addEventListener("click", function () { modal.hidden = true; stopClaimPoll(); });
    });
    var input = $("[data-claim-code-input]", modal);
    var verifyBtn = $("[data-claim-verify-btn]", modal);
    if (verifyBtn) {
      verifyBtn.addEventListener("click", function () {
        var code = (input ? input.value : "").trim();
        if (code) verifyClaimCode(modal, code);
      });
    }
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter" && verifyBtn) verifyBtn.click(); });

    var requestBtn = $("[data-claim-request-btn]", modal);
    if (requestBtn) {
      requestBtn.addEventListener("click", function () {
        if (!currentClaimCode) return;
        requestBtn.disabled = true;
        var name = localStorage.getItem(LOYALTY_NAME_KEY) || "";
        fetch(CODES_API + "?action=request-delivery", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: currentClaimCode, deviceId: getDeviceId(), name: name })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            requestBtn.disabled = false;
            if (res && res.ok) {
              showClaimStage(modal, "waiting");
              startClaimPoll(modal, currentClaimCode);
              safe(refreshGiftFab, "refreshGiftFab");
            } else {
              showClaimStage(modal, "code");
              showClaimError(modal, "No se pudo enviar la solicitud. Intenta de nuevo.");
            }
          })
          .catch(function () {
            requestBtn.disabled = false;
            showClaimStage(modal, "code");
            showClaimError(modal, "No se pudo conectar con el servidor.");
          });
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) { modal.hidden = true; stopClaimPoll(); }
    });

    // Si llega ?claim=CODIGO en la URL (el botón flotante de regalo navega
    // así desde una página que no tiene este modal), lo abre y verifica solo.
    var params = new URLSearchParams(location.search);
    var claimParam = params.get("claim");
    if (claimParam) {
      var cleanUrl = location.pathname + location.hash;
      if (window.history && history.replaceState) history.replaceState(null, "", cleanUrl);
      openClaimModalWithCode(claimParam, true);
    }
  }

  /* ---- Entregar premio (empleado): PIN propio del negocio, distinto del
     admin, que se revalida en el servidor en cada acción — no queda
     "recordado" en el navegador entre visitas. ---- */
  function initDeliverPrizeFlow() {
    var modal = $("[data-deliver-prize-modal]");
    if (!modal) return;
    var openBtn = $("[data-open-deliver-prize]");
    var pinInput = $("[data-deliver-pin-input]", modal);
    var nameInput = $("[data-deliver-name-input]", modal);
    var errorEl = $("[data-deliver-prize-error]", modal);
    var loginBtn = $("[data-deliver-login-btn]", modal);
    var pendingList = $("[data-deliver-pending-list]", modal);
    var pendingEmpty = $("[data-deliver-pending-empty]", modal);
    var currentPin = "";
    var currentEmployeeName = "";
    var pendingPollTimer = null;

    function stopPendingPoll() { if (pendingPollTimer) clearInterval(pendingPollTimer); pendingPollTimer = null; }

    function showStage(stage) {
      $$("[data-deliver-stage]", modal).forEach(function (el) {
        el.hidden = el.getAttribute("data-deliver-stage") !== stage;
      });
    }

    function closeModal() {
      modal.hidden = true;
      stopPendingPoll();
      currentPin = "";
      currentEmployeeName = "";
      if (pinInput) pinInput.value = "";
    }

    function fetchPending() {
      fetch(CODES_API + "?action=employee-pending", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: currentPin })
      }).then(function (r) { return r.json(); })
        .then(function (res) { if (res && res.ok) renderPending(res.pending); })
        .catch(function () {});
    }

    function renderPending(list) {
      if (!pendingList) return;
      if (!list.length) {
        pendingList.innerHTML = "";
        if (pendingEmpty) pendingEmpty.hidden = false;
        return;
      }
      if (pendingEmpty) pendingEmpty.hidden = true;
      pendingList.innerHTML = list.map(function (p) {
        var d = new Date(p.requestedAt);
        return '<div class="deliver-pending-row">' +
          '<strong>' + escHTML(p.name || "—") + '</strong> — ' + (p.prizeIcon || "🎁") + " " + escHTML(p.prizeName) +
          '<br><code>' + escHTML(p.code) + '</code> · <span class="hint">' + d.toLocaleTimeString() + '</span>' +
          '<button type="button" class="btn btn-primary deliver-confirm-btn" data-code="' + escHTML(p.code) + '">Entregar premio</button>' +
        '</div>';
      }).join("");
      $$(".deliver-confirm-btn", pendingList).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var code = btn.getAttribute("data-code");
          if (!confirm("¿Confirmas que entregaste este premio?")) return;
          btn.disabled = true;
          fetch(CODES_API + "?action=employee-deliver", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: currentPin, code: code, employeeName: currentEmployeeName })
          }).then(function (r) { return r.json(); })
            .then(function (res) {
              if (res && res.ok) fetchPending();
              else { alert((res && res.error) || "No se pudo entregar el premio."); btn.disabled = false; }
            })
            .catch(function () { alert("No se pudo conectar con el servidor."); btn.disabled = false; });
        });
      });
    }

    if (openBtn) {
      openBtn.addEventListener("click", function () {
        showStage("pin");
        if (errorEl) errorEl.hidden = true;
        if (pinInput) pinInput.value = "";
        if (nameInput) nameInput.value = "";
        modal.hidden = false;
        if (pinInput) pinInput.focus();
      });
    }
    $$("[data-deliver-prize-close]", modal).forEach(function (el) { el.addEventListener("click", closeModal); });
    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        var pin = (pinInput ? pinInput.value : "").trim();
        var employeeName = (nameInput ? nameInput.value : "").trim();
        if (!pin) return;
        loginBtn.disabled = true;
        fetch(CODES_API + "?action=employee-pending", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: pin })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            loginBtn.disabled = false;
            if (res && res.ok) {
              currentPin = pin;
              currentEmployeeName = employeeName || "Empleado";
              showStage("pending");
              renderPending(res.pending);
              stopPendingPoll();
              pendingPollTimer = setInterval(fetchPending, 5000);
            } else if (errorEl) {
              errorEl.textContent = (res && res.error) || "PIN incorrecto."; errorEl.hidden = false;
            }
          })
          .catch(function () {
            loginBtn.disabled = false;
            if (errorEl) { errorEl.textContent = "No se pudo conectar con el servidor."; errorEl.hidden = false; }
          });
      });
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeModal(); });
  }

  /* ---- Botón flotante 🎁 (todas las páginas): recordatorio de los premios
     disponibles/esperando entrega de este dispositivo, con acceso directo
     al mismo flujo de "Reclamar premio". Los códigos nunca se muestran al
     cliente — solo viajan por dentro para accionar el "Reclamar". ---- */
  var DISMISSED_CODES_KEY = "toppings_dismissed_codes";
  var lastGiftCodes = [];
  var lastGiftTickets = [];
  var seenGiftCodes = {}; // code -> { status, prizeName, prizeIcon }

  function getDismissedCodes() {
    try { return JSON.parse(localStorage.getItem(DISMISSED_CODES_KEY) || "[]"); } catch (e) { return []; }
  }
  function dismissCode(code) {
    var list = getDismissedCodes();
    if (list.indexOf(code) === -1) {
      list.push(code);
      try { localStorage.setItem(DISMISSED_CODES_KEY, JSON.stringify(list)); } catch (e) {}
    }
  }
  // Formateador de duración compartido — el mensaje de "ganaste" y la cuenta
  // regresiva del panel del 🎁 usan el mismo texto para la misma duración.
  function formatDuration(ms) {
    var totalMin = Math.max(1, Math.round(ms / 60000));
    var days = Math.floor(totalMin / 1440);
    var hours = Math.floor((totalMin % 1440) / 60);
    var mins = totalMin % 60;
    if (days > 0) {
      var dayPart = days + (days === 1 ? " día" : " días");
      return hours > 0 ? dayPart + " y " + hours + (hours === 1 ? " hora" : " horas") : dayPart;
    }
    if (hours > 0) {
      var hourPart = hours + (hours === 1 ? " hora" : " horas");
      return (mins > 0 && hours < 3) ? hourPart + " y " + mins + (mins === 1 ? " minuto" : " minutos") : hourPart;
    }
    return mins + (mins === 1 ? " minuto" : " minutos");
  }

  function formatCountdown(ms) {
    if (ms <= 0) return "Por vencer";
    return "Vence en " + formatDuration(ms);
  }
  window.__formatDuration = formatDuration;

  function renderGiftCodesList(codes, tickets) {
    var list = $("[data-gift-codes-list]");
    var empty = $("[data-gift-codes-empty]");
    var gotoBtn = $("[data-gift-codes-goto-carousel]");
    if (!list) return;
    tickets = tickets || lastGiftTickets || [];
    var dismissed = getDismissedCodes();
    var visible = codes.filter(function (c) { return dismissed.indexOf(c.code) === -1; });
    if (!visible.length && !tickets.length && !lastNotifs.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      if (gotoBtn) gotoBtn.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    if (gotoBtn) gotoBtn.hidden = true;

    /* Los avisos del negocio van primero: puede haber un código de premio ahí
       adentro y no se puede perder entre los premios. */
    var notifsHtml = lastNotifs.map(function (n) {
      var accion = notifPrizeAction(n);
      return '<div class="gift-code-row is-notif">' +
        '<span class="gift-code-icon">📣</span>' +
        '<span class="gift-code-info"><strong>' + escHTML(n.title || "Mensaje de TOPPINGS") + '</strong><br>' +
        '<span class="hint">' + escHTML(n.message) + '</span></span>' +
        '<button type="button" class="btn btn-primary gift-code-claim-btn" data-notif-read="' + escHTML(n.id) + '">' +
          (accion ? escHTML(accion.label) : "Leído") + '</button>' +
      '</div>';
    }).join("");
    // Los tiros de ruleta sin usar van primero: quedan guardados aquí para
    // girarlos cuando el cliente quiera (aunque haya cerrado la ruleta sin jugar).
    var ticketsHtml = tickets.map(function (t) {
      return '<div class="gift-code-row is-pending">' +
        '<span class="gift-code-icon">🎡</span>' +
        '<span class="gift-code-info"><strong>Tiro en la Ruleta</strong><br>' +
        '<span class="hint">Sin usar · ' + formatCountdown(t.expiresAt - Date.now()) + '</span></span>' +
        '<button type="button" class="btn btn-primary gift-code-claim-btn" data-spin-ticket="' + escHTML(t.id) + '">Girar</button>' +
      '</div>';
    }).join("");
    list.innerHTML = notifsHtml + ticketsHtml + visible.map(function (c) {
      if (c.status === "expired") {
        return '<div class="gift-code-row is-expired">' +
          '<span class="gift-code-icon">' + (c.prizeIcon || "🎁") + '</span>' +
          '<span class="gift-code-info"><strong>' + escHTML(c.prizeName) + '</strong><br>' +
          '<span class="hint">Este premio venció</span></span>' +
          '<button type="button" class="btn gift-code-claim-btn is-expired-btn" disabled>VENCIDO</button>' +
          '<button type="button" class="gift-code-dismiss-btn" data-dismiss-code="' + escHTML(c.code) + '" aria-label="Cerrar">&times;</button>' +
        '</div>';
      }
      var statusLabel = c.status === "waiting" ? "Esperando entrega" : "Disponible";
      var countdown = formatCountdown(c.expiresAt - Date.now());
      return '<div class="gift-code-row is-pending">' +
        '<span class="gift-code-icon">' + (c.prizeIcon || "🎁") + '</span>' +
        '<span class="gift-code-info"><strong>' + escHTML(c.prizeName) + '</strong><br>' +
        '<span class="hint">' + statusLabel + ' · ' + countdown + '</span></span>' +
        '<button type="button" class="btn btn-primary gift-code-claim-btn" data-code="' + escHTML(c.code) + '">Reclamar</button>' +
      '</div>';
    }).join("");
    $$(".gift-code-claim-btn[data-code]", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-code");
        var giftModal = $("[data-gift-codes-modal]");
        if (giftModal) giftModal.hidden = true;
        openClaimModalWithCode(code, true);
      });
    });
    $$(".gift-code-claim-btn[data-spin-ticket]", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var giftModal = $("[data-gift-codes-modal]");
        if (giftModal) giftModal.hidden = true;
        abrirRuleta();
      });
    });
    $$("[data-notif-read]", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-notif-read");
        var n = null;
        for (var i = 0; i < lastNotifs.length; i++) { if (lastNotifs[i].id === id) { n = lastNotifs[i]; break; } }
        markNotifRead(id);
        var accion = n && notifPrizeAction(n);
        if (accion) safe(accion.run, "notifPrizeAction");
        safe(refreshGiftFab, "refreshGiftFab");
      });
    });
    $$(".gift-code-dismiss-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-dismiss-code");
        var found = null;
        for (var i = 0; i < lastGiftCodes.length; i++) { if (lastGiftCodes[i].code === code) { found = lastGiftCodes[i]; break; } }
        dismissCode(code);
        delete seenGiftCodes[code];
        if (found) alert((found.prizeIcon || "🎁") + " " + found.prizeName + " ya cumplió el tiempo y no puede ser reclamado.");
        renderGiftCodesList(lastGiftCodes, lastGiftTickets);
        var badge = $("[data-fab-gift-badge]", $("[data-fab-gift]"));
        var stillVisible = lastGiftCodes.filter(function (c) { return getDismissedCodes().indexOf(c.code) === -1; });
        var total = stillVisible.length + lastGiftTickets.length;
        if (badge) {
          badge.hidden = !total;
          if (total) badge.textContent = String(total);
        }
      });
    });
  }

  /* ---- Latido: para que el panel sepa cuánta gente hay ahora en la página ----
     setInterval y no requestAnimationFrame: rAF se congela cuando la pestaña
     no está pintando, y entonces alguien que dejó la página abierta en segundo
     plano dejaría de contarse. */
  var PRESENCE_API = "api/presence.php";
  /* ================= 🔒 Premio Bloqueado =================
     Un premio secreto con cuenta regresiva que se lleva la PRIMERA persona
     que lo reclame.

     Regla que hay que respetar al pie: esto NUNCA se abre solo. Ni al cargar,
     ni por temporizador, ni cuando el contador llega a cero. El refresco solo
     cambia el BOTÓN (🔒 → 🔓); el panel se abre únicamente cuando el cliente
     lo toca. Es la diferencia con la burbuja de Zona Secreta, que sí aparece
     sola a los 5 segundos.

     Quién gana lo decide el servidor, siempre. Acá no se compara ninguna hora
     contra el reloj del celular: el contador solo dibuja la diferencia contra
     el serverNow que llega del servidor, igual que "Detén el tiempo". */

  var LOCKED_API = "api/locked.php";

  function initPremioBloqueado() {
    var wrap = $("[data-locked-wrap]");
    if (!wrap) return;

    var cfg = data.premioBloqueado || {};
    if (!cfg.active) return;                       // apagado desde el panel
    if (!paginaMuestraFlotante("locked")) return;  // esta página no lo muestra

    var btn = $("[data-locked-toggle]", wrap);
    var panel = $("[data-locked-panel]", wrap);
    var cuerpo = $("[data-locked-body]", wrap);
    var iconoEl = $("[data-locked-icon]", wrap);
    var textos = cfg.textos || {};

    var estado = null;      // lo último que dijo el servidor
    var desfase = 0;        // serverNow - Date.now(), para el contador
    var pidiendo = false;   // hay un reclamo en curso (evita el doble toque)
    var tickTimer = null;
    var pollTimer = null;

    function t(clave, porDefecto) {
      var v = textos[clave];
      return (typeof v === "string" && v !== "") ? v : porDefecto;
    }

    function ahoraServidor() { return Date.now() + desfase; }

    function faltan() {
      if (!estado || !estado.hayPremio) return 0;
      return Math.max(0, estado.unlockAt - ahoraServidor());
    }

    function comoReloj(ms) {
      var s = Math.floor(ms / 1000);
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
      function dd(n) { return (n < 10 ? "0" : "") + n; }
      return dd(h) + ":" + dd(m) + ":" + dd(r);
    }

    /* ---- el botón ---- */
    function pintarBoton() {
      var abierto = !!(estado && estado.hayPremio && faltan() <= 0);
      if (iconoEl) iconoEl.textContent = abierto ? "🔓" : (cfg.icono || "🔒");
      wrap.classList.toggle("is-open-prize", abierto);
      // "ocultar el botón cuando no haya ningún premio programado"
      var ocultar = cfg.ocultarSinPremio && (!estado || !estado.hayPremio);
      wrap.hidden = !!ocultar;
    }

    /* ---- el panel ---- */
    function pintarPanel() {
      if (!cuerpo || panel.hidden) return;   // cerrado: no se dibuja de gusto
      var html = "";

      if (!estado || !estado.hayPremio) {
        html += '<p class="locked-title">🔒 ' + escHTML(t("tituloSinPremio", "PRÓXIMO PREMIO")) + "</p>";
        html += '<p class="locked-text">' + escHTML(t("sinPremio", "Muy pronto tendremos otro Premio Bloqueado 👀")) + "</p>";
      } else if (faltan() > 0) {
        html += '<p class="locked-title">🔒 ' + escHTML(t("titulo", "PREMIO BLOQUEADO")) + "</p>";
        html += '<p class="locked-text">' + escHTML(t("intro", "Hay un premio secreto esperando... 👀")) + "</p>";
        html += '<p class="locked-cd-label">' + escHTML(t("labelContador", "Se desbloquea en")) + "</p>";
        html += '<p class="locked-cd" data-locked-cd>' + comoReloj(faltan()) + "</p>";
        html += '<p class="locked-winners">🏆 ' + escHTML(t("ganadores", "1 GANADOR")) + "</p>";
        html += '<p class="locked-rule">⚡ ' + escHTML(t("regla", "Solo la primera persona en reclamarlo se lo lleva.")) + "</p>";
      } else if (estado.reservadoPorOtro) {
        html += '<p class="locked-title">🔓 ' + escHTML(t("tituloAbierto", "¡PREMIO DESBLOQUEADO!")) + "</p>";
        html += '<p class="locked-text">' + escHTML(t("tomado", "Alguien lo está reclamando en este momento…")) + "</p>";
      } else {
        html += '<p class="locked-title">🔓 ' + escHTML(t("tituloAbierto", "¡PREMIO DESBLOQUEADO!")) + "</p>";
        html += '<p class="locked-prize">' + escHTML(estado.prizeIcon || "🎁") + " " + escHTML(estado.prizeName || "") + "</p>";
        html += '<p class="locked-text">⚡ ' + escHTML(t("sePrimero", "¡Sé el primero!")) + "</p>";
        html += '<p class="locked-winners">🏆 ' + escHTML(t("ganadores", "1 GANADOR")) + "</p>";
        html += '<button type="button" class="locked-claim" data-locked-claim>' +
                escHTML(t("botonReclamar", "RECLAMAR PREMIO")) + "</button>";
      }

      if (estado && estado.ganadorAnterior) {
        var linea = t("ganadorAnterior", "{nombre} se llevó el premio anterior");
        html += '<p class="locked-prev">🏆 ' + escHTML(linea.replace("{nombre}", estado.ganadorAnterior)) + "</p>";
      }
      cuerpo.innerHTML = html;

      var reclamar = $("[data-locked-claim]", cuerpo);
      if (reclamar) reclamar.addEventListener("click", onReclamar);
    }

    function mostrarMensaje(html) { if (cuerpo) cuerpo.innerHTML = html; }

    /* ---- reclamar ---- */
    function onReclamar() {
      if (pidiendo) return;
      pidiendo = true;
      var boton = $("[data-locked-claim]", cuerpo);
      if (boton) { boton.disabled = true; boton.textContent = "Reclamando…"; }

      var miNombre = "";
      try { miNombre = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}

      fetch(LOCKED_API + "?action=claim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), name: miNombre, id: estado && estado.id })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          pidiendo = false;
          if (!res || !res.ok) {
            var razon = res && res.razon;
            if (razon === "ya-reclamado") {
              mostrarMensaje('<p class="locked-title">😮</p><p class="locked-text">' +
                escHTML(t("llegoOtro", "¡Alguien fue más rápido! Este premio ya fue reclamado.")) + "</p>");
            } else if (razon === "todavia-bloqueado") {
              mostrarMensaje('<p class="locked-text">Todavía no es la hora.</p>');
            } else {
              mostrarMensaje('<p class="locked-text">No se pudo reclamar. Intentá de nuevo.</p>');
            }
            refrescar();
            return;
          }
          if (res.estado === "falta-nombre") { pedirNombre(res); return; }
          festejar(res);
        })
        .catch(function () {
          pidiendo = false;
          mostrarMensaje('<p class="locked-text">No se pudo conectar. Intentá de nuevo.</p>');
        });
    }

    /* El servidor ya lo guardó a su nombre por unos minutos: nadie se lo puede
       quitar mientras escribe. */
    function pedirNombre(res) {
      mostrarMensaje(
        '<p class="locked-title">🎉 ' + escHTML(t("fuistePrimero", "¡Fuiste el primero!")) + "</p>" +
        '<p class="locked-prize">' + escHTML(res.prizeIcon || "🎁") + " " + escHTML(res.prizeName || "") + "</p>" +
        '<p class="locked-text">¿Cómo te llamas?</p>' +
        '<input type="text" class="locked-input" data-locked-name maxlength="60" placeholder="Tu nombre">' +
        '<p class="locked-error" data-locked-error hidden></p>' +
        '<button type="button" class="locked-claim" data-locked-continue>CONTINUAR</button>'
      );
      var input = $("[data-locked-name]", cuerpo);
      var error = $("[data-locked-error]", cuerpo);
      var seguir = $("[data-locked-continue]", cuerpo);
      if (input) input.focus();

      function enviar() {
        var nombre = (input.value || "").trim();
        if (!nombre) { error.hidden = false; error.textContent = "Escribí tu nombre."; return; }
        if (pidiendo) return;
        pidiendo = true;
        seguir.disabled = true;
        fetch(LOCKED_API + "?action=set-name", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: getDeviceId(), name: nombre })
        }).then(function (r) { return r.json(); })
          .then(function (r2) {
            pidiendo = false;
            if (!r2 || !r2.ok) {
              mostrarMensaje('<p class="locked-text">' +
                (r2 && r2.razon === "reserva-vencida"
                  ? "Pasó demasiado tiempo y el premio volvió a estar libre."
                  : "No se pudo guardar tu nombre.") + "</p>");
              refrescar();
              return;
            }
            try { localStorage.setItem(LOYALTY_NAME_KEY, nombre); } catch (e) {}
            festejar(r2);
          })
          .catch(function () { pidiendo = false; seguir.disabled = false; });
      }
      seguir.addEventListener("click", enviar);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") enviar(); });
    }

    function festejar(res) {
      mostrarMensaje(
        '<p class="locked-title">🎉 ¡GANASTE!</p>' +
        '<p class="locked-prize">' + escHTML(res.prizeIcon || "🎁") + " " + escHTML(res.prizeName || "") + "</p>" +
        '<p class="locked-text">Te quedó guardado en el botón 🎁 de arriba. Mostralo en el local para reclamarlo.</p>'
      );
      safe(refreshGiftFab, "refreshGiftFab");   // que aparezca ya en el 🎁
      refrescar();
    }

    /* ---- estado y contador ---- */
    function refrescar() {
      return fetch(LOCKED_API + "?action=state&deviceId=" + encodeURIComponent(getDeviceId()) + "&_=" + Date.now(),
        { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) return;
          desfase = res.serverNow - Date.now();
          var antes = estado;
          estado = res;
          pintarBoton();
          /* Si el panel está cerrado NO se abre: solo se repinta lo que ya
             estuviera abierto, para que no quede con datos viejos. */
          if (!panel.hidden) {
            var cambioDeFase = !antes || antes.estado !== res.estado || antes.id !== res.id;
            if (cambioDeFase) pintarPanel();
          }
          ajustarRitmo();
        })
        .catch(function () {});
    }

    /* Se pregunta poco casi siempre, y seguido solo cuando de verdad importa:
       en el último minuto antes de abrirse, y mientras está abierto sin dueño. */
    function ajustarRitmo() {
      var ms = 25000;
      if (estado && estado.hayPremio) {
        var resta = faltan();
        if (resta <= 0 || resta < 60000) ms = 5000;
      }
      clearTimeout(pollTimer);
      pollTimer = setTimeout(function () { refrescar(); }, ms);
    }

    /* El contador se redibuja con setInterval, no con requestAnimationFrame:
       en este proyecto rAF se congela en segundo plano. */
    function arrancarTick() {
      clearInterval(tickTimer);
      tickTimer = setInterval(function () {
        if (!estado || !estado.hayPremio) return;
        var cd = $("[data-locked-cd]", cuerpo);
        if (cd && !panel.hidden) cd.textContent = comoReloj(faltan());
        // al cruzar el cero solo cambia el botón; el panel NO se abre
        if (faltan() <= 0 && estado.estado === "bloqueado") refrescar();
      }, 1000);
    }

    /* ---- abrir y cerrar: solo por toque ---- */
    function abrir() {
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      pintarPanel();
    }
    function cerrar() {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    btn.addEventListener("click", function () {
      if (panel.hidden) abrir(); else cerrar();
    });
    var cerrarBtn = $("[data-locked-close]", wrap);
    if (cerrarBtn) cerrarBtn.addEventListener("click", cerrar);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) cerrar();
    });

    wrap.hidden = false;
    if (cfg.animacion !== false) wrap.classList.add("is-animated");
    refrescar().then(arrancarTick);
  }

  /* ---- qué botones flotantes se ven en esta página ----
     Antes estaba fijo en el HTML; ahora lo decide el panel, con una casilla
     por botón y por página. */
  function paginaActual() {
    var f = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (f === "" || f === "index.html") return "inicio";
    if (f === "comidas.html") return "comidas";
    if (f === "helados.html") return "helados";
    if (f === "bebidas.html") return "bebidas";
    if (f === "misterio.html") return "secreta";
    return "inicio";
  }

  var FLOTANTES_POR_DEFECTO = {
    locked:   { inicio: true, comidas: false, helados: false, bebidas: false, secreta: false },
    zona:     { inicio: true, comidas: true,  helados: true,  bebidas: true,  secreta: false },
    whatsapp: { inicio: true, comidas: true,  helados: true,  bebidas: true,  secreta: true },
    musica:   { inicio: true, comidas: true,  helados: true,  bebidas: true,  secreta: true }
  };

  function paginaMuestraFlotante(cual) {
    var cfg = (data.flotantes || {})[cual];
    var pag = paginaActual();
    if (cfg && typeof cfg[pag] === "boolean") return cfg[pag];
    return FLOTANTES_POR_DEFECTO[cual] ? FLOTANTES_POR_DEFECTO[cual][pag] : true;
  }

  /* Solo esconde o muestra. No cambia cómo funciona ninguno: la burbuja de
     Zona Secreta, por ejemplo, sigue igual donde se muestre. */
  function aplicarFlotantes() {
    [["zona", ".fab-mystery-wrap"],
     ["whatsapp", "[data-whatsapp-link]"],
     ["musica", "[data-music-toggle]"]].forEach(function (par) {
      var el = $(par[1]);
      if (el && !paginaMuestraFlotante(par[0])) el.style.display = "none";
    });
  }


  function initPresencePing() {
    function ping() {
      fetch(PRESENCE_API + "?action=ping", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", deviceId: getDeviceId() })
      }).catch(function () {});
    }
    ping();
    setInterval(ping, 60000);
  }

  /* ---- Avisos que manda el negocio ---- */
  var NOTIF_API = "api/notifications.php";
  var lastNotifs = [];
  var notifShown = {};   // los que ya se abrieron en ESTA visita, para no repetir

  function markNotifRead(id) {
    fetch(NOTIF_API + "?action=read", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", deviceId: getDeviceId(), id: id })
    }).catch(function () {});
    lastNotifs = lastNotifs.filter(function (n) { return n.id !== id; });
  }

  /* La ruleta ahora está en las CINCO páginas (su marcado y game/ruleta.js),
     así que se abre donde esté el cliente. Antes vivía solo en la portada y
     había que mandarlo para allá, que era molesto: si estaba mirando helados,
     reclamar lo sacaba de ahí. */
  function abrirRuleta() {
    if (window.__openRuletaModal) { window.__openRuletaModal(); return; }
    // último recurso, por si alguna página quedara sin la ruleta
    if (window.__openGiftPanel) window.__openGiftPanel();
  }

  /* Qué dice y adónde lleva el botón del aviso, según lo que el negocio le
     haya puesto. Sin premio no hay botón: es solo un mensaje. */
  function notifPrizeAction(n) {
    if (n.prizeType === "wheelSpins") {
      return { label: "🎡 Girar la ruleta", run: function () {
        abrirRuleta();
      } };
    }
    if (n.prizeType === "direct") {
      return { label: "🎁 Ver mi premio", run: function () {
        if (window.__openGiftPanel) window.__openGiftPanel();
      } };
    }
    if (n.prizeType === "code" && n.redeemCode) {
      return { label: "🎟️ Canjear mi código", run: function () {
        if (window.__openGiftPanel) window.__openGiftPanel();
        // se le deja el código ya escrito para que solo toque canjear
        var input = $("[data-redeem-input]");
        if (input) {
          input.value = n.redeemCode;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          try { input.focus(); } catch (e) {}
        }
      } };
    }
    return null;
  }

  /* La notificación NO es la ventana del regalo: un "gracias por visitarnos"
     no puede verse igual que ganarse un premio. Es una tarjeta que baja desde
     arriba, no bloquea la página, y solo trae botón si de verdad hay premio.
     Se marca como leída al cerrarla, no al mostrarla: si la cierra sin leer,
     el aviso sigue en el panel 🎁 y un código no se pierde. */
  function showNotif(n) {
    if (notifShown[n.id]) return;
    notifShown[n.id] = true;

    var vieja = $("[data-notif-toast]");
    if (vieja && vieja.parentNode) vieja.parentNode.removeChild(vieja);

    var card = document.createElement("div");
    card.className = "notif-toast";
    card.setAttribute("data-notif-toast", "");
    card.innerHTML =
      '<button type="button" class="notif-toast-close" aria-label="Cerrar">&times;</button>' +
      '<p class="notif-toast-title">' + escHTML(n.title || "📣 TOPPINGS") + "</p>" +
      '<p class="notif-toast-msg">' + escHTML(n.message) + "</p>";

    var accion = notifPrizeAction(n);
    if (accion) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary notif-toast-btn";
      btn.textContent = accion.label;
      btn.addEventListener("click", function () {
        cerrar();
        safe(accion.run, "notifPrizeAction");
      });
      card.appendChild(btn);
    }

    function cerrar() {
      card.classList.remove("is-in");
      markNotifRead(n.id);
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        safe(refreshGiftFab, "refreshGiftFab");
      }, 260);
    }
    card.querySelector(".notif-toast-close").addEventListener("click", cerrar);

    document.body.appendChild(card);
    // setTimeout y no rAF: en este proyecto rAF se congela en segundo plano y
    // la tarjeta se quedaría sin la clase que la hace entrar
    setTimeout(function () { card.classList.add("is-in"); }, 30);
  }

  function refreshGiftFab() {
    var btn = $("[data-fab-gift]");
    if (!btn) return;
    var deviceId = getDeviceId();
    var codesReq = fetch(CODES_API + "?action=mine&deviceId=" + encodeURIComponent(deviceId) + "&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    // Los tiros de ruleta sin usar viven en su propio archivo (ruleta.json) —
    // se piden aparte para mostrarlos junto a los premios en el mismo panel.
    var ticketsReq = fetch(RULETA_API_MAIN + "?action=status&deviceId=" + encodeURIComponent(deviceId) + "&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    // avisos del negocio para este cliente. El nombre viaja porque un aviso
    // para todos puede traer premio, y el premio se emite a nombre de quien lo
    // recibe (ver "mine" en notifications.php).
    var miNombre = "";
    try { miNombre = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}
    var notifReq = fetch(NOTIF_API + "?action=mine&deviceId=" + encodeURIComponent(deviceId) +
      "&name=" + encodeURIComponent(miNombre) + "&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });

    Promise.all([codesReq, ticketsReq, notifReq])
      .then(function (both) {
        var res = both[0];
        var rul = both[1];
        var ntf = both[2];
        lastNotifs = (ntf && ntf.ok && ntf.items) || [];
        var codes = (res && res.ok && res.codes) || [];
        var tickets = (rul && rul.ok && rul.active && rul.myTickets) || [];
        var dismissed = getDismissedCodes();

        // premios que ya veíamos vencidos (en rojo) y que ahora desaparecieron
        // del todo -> se les acabó la ventana de 24h sin que el cliente los
        // cerrara a mano; se avisa una sola vez
        var stillPresent = {};
        codes.forEach(function (c) { stillPresent[c.code] = true; });
        Object.keys(seenGiftCodes).forEach(function (code) {
          var info = seenGiftCodes[code];
          if (info.status === "expired" && !stillPresent[code] && dismissed.indexOf(code) === -1) {
            alert((info.prizeIcon || "🎁") + " " + info.prizeName + " ya cumplió el tiempo y no puede ser reclamado.");
          }
        });
        seenGiftCodes = {};
        codes.forEach(function (c) { seenGiftCodes[c.code] = { status: c.status, prizeName: c.prizeName, prizeIcon: c.prizeIcon }; });

        lastGiftCodes = codes;
        lastGiftTickets = tickets;
        // el botón ahora vive en el header (reemplaza al menú) — siempre
        // queda visible, solo el numerito rojo aparece/desaparece
        var visible = codes.filter(function (c) { return dismissed.indexOf(c.code) === -1; });
        var total = visible.length + tickets.length + lastNotifs.length;
        var badge = $("[data-fab-gift-badge]", btn);
        if (badge) {
          badge.hidden = !total;
          if (total) badge.textContent = String(total);
        }
        renderGiftCodesList(codes, tickets);

        // el aviso más viejo sin leer se abre solo; los demás quedan en el panel
        if (lastNotifs.length) safe(function () { showNotif(lastNotifs[0]); }, "showNotif");
      })
      .catch(function () {});
  }

  function initGiftFab() {
    var btn = $("[data-fab-gift]");
    var modal = $("[data-gift-codes-modal]");
    if (!btn || !modal) return;
    btn.addEventListener("click", function () { refreshGiftFab(); modal.hidden = false; });
    $$("[data-gift-codes-close]", modal).forEach(function (el) {
      el.addEventListener("click", function () { modal.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });
    var gotoBtn = $("[data-gift-codes-goto-carousel]", modal);
    if (gotoBtn) {
      gotoBtn.addEventListener("click", function () {
        modal.hidden = true;
        var section = document.getElementById("premio-del-dia");
        // el carrusel de premios solo vive en index.html — desde otra
        // página se navega ahí directo a esa sección
        if (section) section.scrollIntoView({ behavior: "smooth" });
        else window.location.href = "index.html#premio-del-dia";
      });
    }
    // recalcula solo el texto de la cuenta regresiva mientras el panel está
    // abierto, sin volver a pedirle al servidor (eso ya lo hace el poll de
    // refreshGiftFab por separado)
    setInterval(function () {
      if (!modal.hidden) renderGiftCodesList(lastGiftCodes);
    }, 60000);
  }

  /* ---- Canjear código de premio (dentro del panel 🎁) ----
     El admin define una palabra en el panel y la reparte (cliente especial,
     promoción, evento); quien la escriba acá desbloquea el premio, que después
     reclama igual que cualquier otro. */
  var REDEEM_REASONS = {
    not_found: "El código ingresado no es válido.",
    inactive: "Este código ya no está disponible.",
    expired: "Este código ha vencido.",
    already_used: "Este código ya fue utilizado.",
    max_uses: "Este código ya fue utilizado."
  };

  function initRedeemCode() {
    var input = $("[data-redeem-input]");
    var btn = $("[data-redeem-btn]");
    var msg = $("[data-redeem-msg]");
    if (!input || !btn) return;
    var busy = false;

    function setMsg(text, kind) {
      if (!msg) return;
      msg.textContent = text || "";
      msg.hidden = !text;
      msg.classList.toggle("is-ok", kind === "ok");
      msg.classList.toggle("is-error", kind === "error");
    }

    function submit() {
      if (busy) return;
      var code = (input.value || "").trim();
      if (!code) { setMsg("Escribe el código que te dieron.", "error"); input.focus(); return; }

      busy = true;
      btn.disabled = true;
      var originalLabel = btn.textContent;
      btn.textContent = "Canjeando…";
      setMsg("", "");

      var name = "";
      try { name = localStorage.getItem(LOYALTY_NAME_KEY) || ""; } catch (e) {}

      fetch(REDEEM_API + "?action=redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redeem", code: code, deviceId: getDeviceId(), name: name })
      })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; })
        .then(function (res) {
          busy = false;
          btn.disabled = false;
          btn.textContent = originalLabel;

          if (!res) { setMsg("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "error"); return; }
          if (!res.ok) {
            setMsg(REDEEM_REASONS[res.reason] || res.error || "No se pudo canjear el código.", "error");
            return;
          }

          input.value = "";
          var icon = res.prizeIcon || "🎁";
          setMsg("🎉 ¡Felicidades! Has reclamado tu premio: " + icon + " " +
            (res.prizeName || "Premio desbloqueado") + ". Ya está en tus premios.", "ok");
          // El premio se creó bajo el deviceId de esta persona, así que aparece
          // en la lista al instante — sin recargar. Esto también sube el
          // numerito del botón 🎁.
          safe(refreshGiftFab, "refreshGiftFab");
        });
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    input.addEventListener("input", function () { setMsg("", ""); });
  }

  // Punto de entrada compartido para abrir el panel de premios desde
  // cualquier otro módulo (ej. la ruleta, tras un giro ganador).
  /* ---- limpieza de las notificaciones al celular ----
     Se probaron y se quitaron: el cartel del permiso resultaba molesto.

     Esto NO es código muerto. El service worker que llegamos a instalar queda
     guardado EN EL NAVEGADOR de quien haya entrado mientras estuvo activo, y
     sigue registrado aunque el archivo ya no esté en el servidor. El sw.js que
     dejamos se desinstala solo, pero esto lo vuelve seguro: da de baja la
     suscripción, quita el registro y borra las marcas que quedaron en el
     celular. Se puede quitar dentro de unos meses. */
  function limpiarPushViejo() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (reg) {
          if (reg.pushManager) {
            reg.pushManager.getSubscription()
              .then(function (sub) { if (sub) sub.unsubscribe(); })
              .catch(function () {});
          }
          reg.unregister();
        });
      }).catch(function () {});
    }
    ["toppings_push_preguntado", "toppings_push_estado"].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  window.__openGiftPanel = function () {
    refreshGiftFab();
    var modal = $("[data-gift-codes-modal]");
    if (modal) modal.hidden = false;
  };

  /* ---- Modal genérico de texto (hoy se usa para pedir el nombre del cliente) ---- */
  function openNameModal(onSubmit) {
    var modal = $("[data-code-modal]");
    if (!modal) { onSubmit(""); return; }
    var titleEl = $("[data-code-modal-title]", modal);
    var input = $("[data-code-modal-input]", modal);
    var errorEl = $("[data-code-modal-error]", modal);
    var confirmBtn = $("[data-code-modal-confirm]", modal);

    if (titleEl) titleEl.textContent = "¿Cuál es tu nombre?";
    if (input) { input.value = ""; input.placeholder = "Tu nombre"; }
    if (errorEl) errorEl.hidden = true;
    modal.hidden = false;
    if (input) input.focus();

    function submit() {
      var value = (input ? input.value : "").trim();
      modal.hidden = true;
      onSubmit(value);
    }
    // .onclick/.onkeydown (not addEventListener) so each call replaces the previous handler instead of stacking
    if (confirmBtn) confirmBtn.onclick = submit;
    if (input) input.onkeydown = function (e) { if (e.key === "Enter") submit(); };
  }

  function initCodeModalClose() {
    var modal = $("[data-code-modal]");
    if (!modal) return;
    $$("[data-code-modal-close]", modal).forEach(function (el) {
      el.addEventListener("click", function () { modal.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });
  }

  /* ---------------- Bloques de la página de inicio ----------------
     El orden de la portada, el premio del día, las reseñas y las imágenes
     que se agreguen sale del panel (Portada → Bloques del inicio). Se
     guarda como una sola lista ordenada en `home.blocks`.

     Corre ANTES que todo lo demás en boot(): el premio del día contiene el
     juego y el carrusel, así que moverlo después de que se inicializan
     dejaría sus referencias apuntando a elementos ya movidos. */
  function applyHomeBlocks() {
    var main = document.getElementById("main");
    if (!main) return;
    // solo la portada tiene bloques; las demás páginas no traen estas marcas
    if (!$("[data-home-block]", main)) return;

    var blocks = (data.home && data.home.blocks) || [];
    if (!blocks.length) return;

    var frag = document.createDocumentFragment();
    var usadas = {};

    blocks.forEach(function (b, i) {
      if (!b || b.hidden) return;

      if (b.type === "image") {
        if (!b.src) return;
        var wrap = document.createElement("div");
        wrap.className = "home-image container";
        var img = document.createElement("img");
        img.src = b.src;
        img.alt = "";           // decorativa: no aporta información nueva
        img.loading = i < 2 ? "eager" : "lazy";
        img.decoding = "async";
        wrap.appendChild(img);
        frag.appendChild(wrap);
        return;
      }

      var sec = $('[data-home-block="' + b.type + '"]', main);
      if (sec && !usadas[b.type]) { usadas[b.type] = true; frag.appendChild(sec); }
    });

    // Cualquier sección que la lista no mencione se conserva al final: nunca
    // se pierde contenido por una lista incompleta o desactualizada.
    $$("[data-home-block]", main).forEach(function (sec) {
      var t = sec.getAttribute("data-home-block");
      if (!usadas[t]) { usadas[t] = true; frag.appendChild(sec); }
    });

    main.appendChild(frag);
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    safe(applyHomeBlocks, "applyHomeBlocks");
    safe(applyCustomization, "applyCustomization");
    safe(mountHero, "mountHero");
    safe(positionHeroGreeting, "positionHeroGreeting");
    safe(initHeroGreeting, "initHeroGreeting");
    safe(registerExistingName, "registerExistingName");
    safe(mountQuickNav, "mountQuickNav");
    safe(mountCategoryMenu, "mountCategoryMenu");
    safe(initMysteryFab, "initMysteryFab");
    safe(initAssistant, "initAssistant");
    safe(mountGallery, "mountGallery");
    safe(mountBusinessInfo, "mountBusinessInfo");
    safe(initWhatsappLinks, "initWhatsappLinks");
    safe(initBackgroundMusic, "initBackgroundMusic");
    safe(initNav, "initNav");
    safe(initScrollHint, "initScrollHint");
    safe(initScrollButtons, "initScrollButtons");
    safe(initPageNav, "initPageNav");
    safe(initLightbox, "initLightbox");
    safe(initReveals, "initReveals");
    safe(positionDailyPrize, "positionDailyPrize");
    safe(mountDailyPrize, "mountDailyPrize");
    safe(initLoyaltyQrStamp, "initLoyaltyQrStamp");
    safe(initLoyaltyScanModalClose, "initLoyaltyScanModalClose");
    safe(initPrizeModalClose, "initPrizeModalClose");
    safe(initCodeModalClose, "initCodeModalClose");
    safe(mountStikerGallery, "mountStikerGallery");
    safe(initClaimPrizeFlow, "initClaimPrizeFlow");
    safe(initDeliverPrizeFlow, "initDeliverPrizeFlow");
    safe(initGiftFab, "initGiftFab");
    safe(initRedeemCode, "initRedeemCode");
    safe(aplicarFlotantes, "aplicarFlotantes");
    safe(initPremioBloqueado, "initPremioBloqueado");
    safe(initPresencePing, "initPresencePing");
    safe(limpiarPushViejo, "limpiarPushViejo");
    safe(refreshGiftFab, "refreshGiftFab");
    setInterval(function () { safe(refreshGiftFab, "refreshGiftFab"); }, 30000);

    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
