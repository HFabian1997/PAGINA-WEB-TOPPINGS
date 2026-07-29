/**
 * RULETA TOPPINGS — minijuego de premios independiente (mismo patrón que
 * game/toppings-run.js: se inicializa solo, busca sus propios elementos
 * [data-ruleta-*], no depende de main.js). El servidor (api/ruleta.php) es
 * quien elige el premio SIEMPRE — este archivo solo pide el resultado y
 * anima la rueda hasta el segmento que ya llegó decidido.
 *
 * Se abre desde cualquiera de las 4 dinámicas existentes cuando su premio
 * está configurado como "Giro en la Ruleta": main.js/toppings-run.js llaman
 * a window.__openRuletaModal() cuando el reclamo trae wheelGranted.
 */
(function () {
  "use strict";

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }

  var RULETA_API = "api/ruleta.php";
  var NAME_KEY = "toppings_loyalty_name";
  var DEVICE_KEY = "toppings_run_device_id";
  var MUTE_KEY = "toppings_ruleta_muted";

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

  function boot() {
    var modal = $("[data-ruleta-modal]");
    var canvas = $("[data-ruleta-canvas]", modal);
    if (!modal || !canvas) return;

    var closeBtns = $$("[data-ruleta-close]", modal);
    var muteBtn = $("[data-ruleta-mute]", modal);
    var titleEl = $("[data-ruleta-title]", modal);
    var ticketsEl = $("[data-ruleta-tickets]", modal);
    var spinBtn = $("[data-ruleta-spin]", modal);
    var hintEl = $("[data-ruleta-hint]", modal);
    var resultNameEl = $("[data-ruleta-result-name]", modal);
    var resultActionsEl = $("[data-ruleta-result-actions]", modal);
    var resultHintEl = $("[data-ruleta-result-hint]", modal);
    var viewPrizesBtn = $("[data-ruleta-view-prizes]", modal);
    var againBtn = $("[data-ruleta-again]", modal);
    var stages = {
      idle: $('[data-ruleta-stage="idle"]', modal),
      result: $('[data-ruleta-stage="result"]', modal),
      disabled: $('[data-ruleta-stage="disabled"]', modal),
    };

    var ctx = canvas.getContext("2d");
    var prizes = [];
    var config = { title: "RULETA TOPPINGS", whatsappNumber: "", soundEnabled: true, confettiEnabled: true, active: true };
    var currentRotation = 0;
    var spinning = false;
    var muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}

    function showStage(name) {
      Object.keys(stages).forEach(function (k) {
        if (stages[k]) stages[k].hidden = k !== name;
      });
    }

    function updateMuteBtn() {
      if (!muteBtn) return;
      muteBtn.textContent = muted ? "🔇" : "🔊";
      muteBtn.classList.toggle("is-muted", muted);
    }
    updateMuteBtn();

    function drawWheel() {
      var W = canvas.width, H = canvas.height;
      var cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 4;
      ctx.clearRect(0, 0, W, H);
      var n = prizes.length;
      if (!n) return;
      var segAngle = (Math.PI * 2) / n;
      prizes.forEach(function (p, i) {
        var start = -Math.PI / 2 + i * segAngle;
        var end = start + segAngle;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, end);
        ctx.closePath();
        ctx.fillStyle = p.color || "#ffd400";
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.35)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(start + segAngle / 2);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#111";
        ctx.font = "bold " + Math.max(10, Math.round(r * 0.075)) + "px sans-serif";
        var label = (p.icon ? p.icon + " " : "") + p.name;
        ctx.fillText(label, r - 10, 0);
        ctx.restore();
      });

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();
      ctx.strokeStyle = "#ffd400";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    function renderTickets() {
      var count = config.myTickets ? config.myTickets.length : 0;
      if (ticketsEl) ticketsEl.textContent = "Tiros disponibles: " + count;
      if (spinBtn) spinBtn.disabled = spinning || count === 0;
      if (hintEl) hintEl.hidden = count > 0;
    }

    function fetchStatus(cb) {
      var name = "";
      try { name = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
      var params = "?action=status&deviceId=" + encodeURIComponent(getDeviceId()) + "&name=" + encodeURIComponent(name);
      fetch(RULETA_API + params, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) return;
          config = res;
          prizes = res.prizes || [];
          if (titleEl) titleEl.textContent = res.title || "RULETA TOPPINGS";
          drawWheel();
          renderTickets();
          if (cb) cb(res);
        })
        .catch(function () {});
    }

    /* ---- sonido retro sintetizado (sin archivos), mismo espíritu que el
       resto del sitio: no depende de internet ni pesa nada. ---- */
    var audioCtx = null;
    function getAudioCtx() {
      try {
        if (!audioCtx) {
          var Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) audioCtx = new Ctx();
        }
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
        return audioCtx;
      } catch (e) { return null; }
    }
    function tick() {
      if (muted || !config.soundEnabled) return;
      var ctx2 = getAudioCtx();
      if (!ctx2) return;
      try {
        var osc = ctx2.createOscillator();
        var gain = ctx2.createGain();
        osc.type = "square";
        osc.frequency.value = 700;
        var start = ctx2.currentTime;
        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
        osc.connect(gain).connect(ctx2.destination);
        osc.start(start);
        osc.stop(start + 0.06);
      } catch (e) {}
    }
    function winFanfare() {
      if (window.__playPrizeChime) window.__playPrizeChime();
    }

    function spinTo(segmentIndex, cb) {
      var n = prizes.length || 1;
      var segAngle = 360 / n;
      var targetCenter = segmentIndex * segAngle + segAngle / 2;
      var normalizedTarget = (360 - (targetCenter % 360)) % 360;
      var extraTurns = 6;
      var startRotation = currentRotation;
      var base = startRotation - (startRotation % 360);
      var endRotation = base + extraTurns * 360 + normalizedTarget;
      if (endRotation <= startRotation) endRotation += 360;

      var duration = 4200;
      var startTs = null;
      var lastTickAt = 0;
      function frame(ts) {
        if (!startTs) startTs = ts;
        var t = Math.min(1, (ts - startTs) / duration);
        var eased = 1 - Math.pow(1 - t, 5);
        currentRotation = startRotation + (endRotation - startRotation) * eased;
        canvas.style.transform = "rotate(" + currentRotation + "deg)";
        if (ts - lastTickAt > 90 && t < 0.94) { tick(); lastTickAt = ts; }
        if (t < 1) requestAnimationFrame(frame);
        else {
          currentRotation = endRotation % 360;
          canvas.style.transform = "rotate(" + currentRotation + "deg)";
          if (cb) cb();
        }
      }
      requestAnimationFrame(frame);
    }

    function showResult(prize, result) {
      if (resultNameEl) resultNameEl.textContent = (prize.icon ? prize.icon + " " : "") + prize.name;
      var claimable = !!result.claimable;

      /* El título decía "¡GANASTE!" siempre, incluso cuando salía un premio
         de tipo "sigue intentando". Ahora depende de si de verdad ganó, y
         los dos textos se editan desde el panel de la Ruleta. */
      var titleEl = $("[data-ruleta-result-title]", modal);
      if (titleEl) {
        titleEl.textContent = claimable
          ? (config.winTitle || "¡GANASTE!")
          : (config.loseTitle || "¡QUÉ MALA SUERTE!");
        titleEl.classList.toggle("is-lose", !claimable);
      }
      // el código nunca se muestra — el premio queda guardado por dentro y
      // se ve/reclama desde el botón de regalo 🎁, igual que las otras dinámicas
      if (resultActionsEl) resultActionsEl.hidden = !claimable;
      if (resultHintEl) {
        resultHintEl.hidden = !claimable;
        if (claimable) {
          var durationTxt = (result.codeExpiresAt && window.__formatDuration)
            ? window.__formatDuration(result.codeExpiresAt - Date.now())
            : "24 horas";
          resultHintEl.textContent = "Tienes " + durationTxt + " para reclamarlo. Puedes verlo en el botón de regalo 🎁 (abajo, debajo de WhatsApp). Recuerda: debes estar en el local — no se entrega a domicilio ni para llevar.";
        }
      }
      if (claimable) {
        winFanfare();
        if (config.confettiEnabled && window.__burstConfetti) window.__burstConfetti($(".ruleta-card", modal));
        if (navigator.vibrate) navigator.vibrate(200);
      }
      showStage("result");
    }

    function doSpin() {
      if (spinning) return;
      var count = config.myTickets ? config.myTickets.length : 0;
      if (count === 0) { renderTickets(); return; }
      spinning = true;
      if (spinBtn) spinBtn.disabled = true;
      var name = "";
      try { name = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}

      fetch(RULETA_API + "?action=spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), name: name })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) {
            spinning = false;
            if (spinBtn) spinBtn.disabled = false;
            alert((res && res.error) || "No se pudo girar la ruleta.");
            fetchStatus();
            return;
          }
          var idx = -1;
          for (var i = 0; i < prizes.length; i++) { if (prizes[i].id === res.prize.id) { idx = i; break; } }
          if (idx === -1) idx = 0;
          spinTo(idx, function () {
            spinning = false;
            showResult(res.prize, res.result);
            config.myTickets = res.myTickets || [];
            renderTickets();
          });
        })
        .catch(function () {
          spinning = false;
          if (spinBtn) spinBtn.disabled = false;
          alert("No se pudo conectar con el servidor.");
        });
    }

    function openModal() {
      modal.hidden = false;
      document.body.classList.add("run-no-scroll");
      fetchStatus(function (res) {
        if (!res.active) { showStage("disabled"); return; }
        showStage("idle");
      });
    }
    function closeModal() {
      if (spinning) return;
      modal.hidden = true;
      document.body.classList.remove("run-no-scroll");
    }

    closeBtns.forEach(function (el) { el.addEventListener("click", closeModal); });
    if (spinBtn) spinBtn.addEventListener("click", doSpin);
    if (againBtn) againBtn.addEventListener("click", function () { fetchStatus(function (res) { showStage(res.active ? "idle" : "disabled"); }); });
    if (viewPrizesBtn) {
      viewPrizesBtn.addEventListener("click", function () {
        closeModal();
        if (window.__openGiftPanel) window.__openGiftPanel();
      });
    }
    if (muteBtn) {
      muteBtn.addEventListener("click", function () {
        muted = !muted;
        try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
        updateMuteBtn();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    window.__openRuletaModal = openModal;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
