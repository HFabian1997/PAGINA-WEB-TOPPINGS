(function () {
  "use strict";

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

  var API = "../api/content.php";
  var PRIZE_API = "../api/premio.php";
  var RUN_API = "../api/run-leaderboard.php";
  var RULETA_API = "../api/ruleta.php";
  var CODES_API = "../api/codes.php";
  var escHTML = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var state = {
    content: null,
    dirty: false
  };

  /* ---------------- path get/set helpers ---------------- */
  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var parts = path.split(".");
    var last = parts.pop();
    var target = parts.reduce(function (o, k) {
      if (o[k] == null) o[k] = {};
      return o[k];
    }, obj);
    target[last] = value;
  }

  function setSaveStatus(text, cls) {
    var el = $("[data-save-status]");
    el.textContent = text;
    el.className = "save-status" + (cls ? " " + cls : "");
  }
  function markDirty() {
    state.dirty = true;
    setSaveStatus("Cambios sin guardar", "");
  }

  /* Las rutas se guardan relativas a la RAÍZ del sitio ("assets/img/foto.jpg"),
     pero el panel vive dentro de /admin/, así que el navegador las buscaría en
     /admin/assets/... y no las encontraría. Aquí se les antepone "../" para que
     la vista previa cargue bien. Las direcciones completas y las que ya vienen
     con "/" o "../" se dejan tal cual. */
  function adminAssetUrl(path) {
    path = (path || "").trim();
    if (!path) return "";
    if (/^(https?:)?\/\//i.test(path) || path.charAt(0) === "/" || path.indexOf("data:") === 0) return path;
    if (path.indexOf("../") === 0) return path;
    return "../" + path;
  }

  function setImgSrc(el, path) {
    if (!el) return;
    if (!path) { el.removeAttribute("src"); return; }
    el.src = adminAssetUrl(path);
  }

  /* Sube una foto al servidor (se convierte a WebP allá) y devuelve su ruta. */
  function uploadImage(file, onDone) {
    var form = new FormData();
    form.append("image", file);
    fetch(API + "?action=upload-image", { method: "POST", credentials: "same-origin", body: form })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) onDone(res.path);
        else { alert((res && res.error) || "No se pudo subir la imagen."); onDone(null); }
      })
      .catch(function () { alert("No se pudo conectar con el servidor para subir la imagen."); onDone(null); });
  }

  /* Sube un archivo de audio (mp3/ogg/wav/m4a) tal cual, sin convertir. */
  function uploadAudio(file, onDone) {
    var form = new FormData();
    form.append("audio", file);
    fetch(API + "?action=upload-audio", { method: "POST", credentials: "same-origin", body: form })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) onDone(res.path);
        else { alert((res && res.error) || "No se pudo subir el audio."); onDone(null); }
      })
      .catch(function () { alert("No se pudo conectar con el servidor para subir el audio."); onDone(null); });
  }

  /* ---------------- entrar / clave de administrador ---------------- */
  function showLogin(hasPassword) {
    $("[data-login-screen]").hidden = false;
    $("[data-admin-main]").hidden = true;
    $("[data-conn-status]").hidden = true;
    var title = $("[data-login-title]");
    var hint = $("[data-login-hint]");
    if (hasPassword) {
      if (title) title.textContent = "Entrar al panel";
      if (hint) hint.textContent = "Escribe tu clave de administrador.";
    } else {
      if (title) title.textContent = "Crea tu clave de acceso";
      if (hint) hint.textContent = "Es la primera vez que entras — la clave que escribas ahora quedará guardada para la próxima vez.";
    }
  }

  function showAdmin() {
    $("[data-login-screen]").hidden = true;
    $("[data-admin-main]").hidden = false;
    $("[data-conn-status]").hidden = false;
    var originEl = $("[data-site-origin]");
    if (originEl) originEl.textContent = location.host;
  }

  function loadContent() {
    return fetch(API + "?action=get-content", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || "No se pudo cargar el contenido.");
        state.content = res.content;
        showAdmin();
        renderAll();
        setSaveStatus("Listo", "is-ok");
      })
      .catch(function (e) {
        console.warn("[admin] no se pudo cargar el contenido:", e);
        alert("No se pudo cargar el contenido de la página. Intenta de nuevo.");
      });
  }

  function initAuth() {
    var passwordInput = $("[data-login-password]");
    var errorEl = $("[data-login-error]");
    var submitBtn = $("[data-login-submit]");
    var logoutBtn = $("[data-logout-btn]");

    function attemptLogin() {
      var password = passwordInput.value;
      if (!password) return;
      if (errorEl) errorEl.hidden = true;
      submitBtn.disabled = true;
      fetch(API + "?action=login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          submitBtn.disabled = false;
          if (res && res.ok) {
            passwordInput.value = "";
            loadContent();
          } else if (errorEl) {
            errorEl.textContent = (res && res.error) || "No se pudo entrar.";
            errorEl.hidden = false;
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          if (errorEl) { errorEl.textContent = "No se pudo conectar con el servidor."; errorEl.hidden = false; }
        });
    }

    if (submitBtn) submitBtn.addEventListener("click", attemptLogin);
    if (passwordInput) passwordInput.addEventListener("keydown", function (e) { if (e.key === "Enter") attemptLogin(); });
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        fetch(API + "?action=logout", { method: "POST", credentials: "same-origin" }).then(function () {
          state.content = null;
          showLogin(true);
        });
      });
    }

    fetch(API + "?action=check", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok && res.authed) loadContent();
        else showLogin(!!(res && res.hasPassword));
      })
      .catch(function () { showLogin(true); });
  }

  /* ---------------- tabs ---------------- */
  function initTabs() {
    $$("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$("[data-tab]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        var name = btn.getAttribute("data-tab");
        $$("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
      });
    });
  }

  /* ---------------- generic form binding (data-form + data-field) ---------------- */
  function renderForms() {
    $$("[data-form]").forEach(function (form) {
      var base = form.getAttribute("data-form");
      $$("[data-field]", form).forEach(function (input) {
        var path = base + "." + input.getAttribute("data-field");
        var val = getPath(state.content, path);
        if (input.type === "checkbox") input.checked = !!val;
        else input.value = val == null ? "" : val;

        input.oninput = function () {
          var v = input.type === "checkbox" ? input.checked : input.value;
          if (input.type === "number") v = Number(v) || 0;
          setPath(state.content, path, v);
          markDirty();
        };
      });
    });

    // top-level checkboxes outside data-form (e.g. promo.active switch)
    $$("[data-field]:not([data-form] [data-field])").forEach(function (input) {
      var path = input.getAttribute("data-field");
      var val = getPath(state.content, path);
      input.checked = !!val;
      input.oninput = function () {
        setPath(state.content, path, input.checked);
        markDirty();
      };
    });
  }

  function renderImageFields() {
    $$("[data-image-field]").forEach(function (input) {
      var path = input.getAttribute("data-image-field");
      var previewEl = $('[data-image-preview="' + path + '"]');
      setImgSrc(previewEl, getPath(state.content, path));

      input.onchange = function () {
        var file = input.files[0];
        if (!file) return;
        uploadImage(file, function (rel) {
          if (!rel) { input.value = ""; return; }
          setPath(state.content, path, rel);
          setImgSrc(previewEl, rel);
          markDirty();
          input.value = "";
          renderImageFields();   // el logo y el fondo se muestran en dos lugares
          renderLooks();
        });
      };
    });
  }

  function initImageRemove() {
    $$("[data-image-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var path = btn.getAttribute("data-image-remove");
        if (!confirm("¿Quitar esta imagen?")) return;
        setPath(state.content, path, "");
        var fileInput = $('[data-image-field="' + path + '"]');
        if (fileInput) fileInput.value = "";
        var previewEl = $('[data-image-preview="' + path + '"]');
        if (previewEl) previewEl.removeAttribute("src");
        markDirty();
      });
    });
  }

  function renderAudioFields() {
    $$("[data-audio-field]").forEach(function (input) {
      var path = input.getAttribute("data-audio-field");
      var nameEl = $('[data-audio-name="' + path + '"]');
      var playerEl = $('[data-audio-player="' + path + '"]');
      var current = getPath(state.content, path) || "";
      if (nameEl) nameEl.textContent = current ? current.split("/").pop() : "Ningún archivo elegido";
      if (playerEl) {
        if (current) { playerEl.src = adminAssetUrl(current); playerEl.hidden = false; }
        else { playerEl.removeAttribute("src"); playerEl.hidden = true; }
      }

      input.onchange = function () {
        var file = input.files[0];
        if (!file) return;
        if (nameEl) nameEl.textContent = "Subiendo…";
        uploadAudio(file, function (rel) {
          if (!rel) { input.value = ""; if (nameEl) nameEl.textContent = current ? current.split("/").pop() : "Ningún archivo elegido"; return; }
          setPath(state.content, path, rel);
          current = rel;
          if (nameEl) nameEl.textContent = rel.split("/").pop();
          if (playerEl) { playerEl.src = adminAssetUrl(rel); playerEl.hidden = false; }
          markDirty();
          input.value = "";
        });
      };
    });
  }

  function initAudioRemove() {
    $$("[data-audio-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var path = btn.getAttribute("data-audio-remove");
        if (!confirm("¿Quitar este audio?")) return;
        setPath(state.content, path, "");
        var fileInput = $('[data-audio-field="' + path + '"]');
        if (fileInput) fileInput.value = "";
        var nameEl = $('[data-audio-name="' + path + '"]');
        if (nameEl) nameEl.textContent = "Ningún archivo elegido";
        var playerEl = $('[data-audio-player="' + path + '"]');
        if (playerEl) { playerEl.removeAttribute("src"); playerEl.hidden = true; }
        markDirty();
      });
    });
  }

  /* ---------------- gallery ---------------- */
  function renderGallery() {
    var list = $("[data-gallery-list]");
    if (!list) return;
    var items = state.content.galeria || (state.content.galeria = []);

    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        var arr = state.content.galeria;
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        markDirty();
        renderGallery();
      });
    }

    list.innerHTML = "";
    items.forEach(function (item, idx) {
      var node = $("#tpl-gallery-item").content.cloneNode(true);
      var previewImg = node.querySelector('[data-role="preview"]');
      var altInput = node.querySelector('[data-role="alt"]');
      var removeBtn = node.querySelector('[data-role="remove"]');

      altInput.value = item.alt || "";
      setImgSrc(previewImg, item.image);
      altInput.oninput = function () { item.alt = altInput.value; markDirty(); };
      removeBtn.onclick = function () {
        if (!confirm("¿Eliminar esta foto de la galería?")) return;
        items.splice(idx, 1);
        markDirty();
        renderGallery();
      };

      // Reemplazar conservando la posición y la descripción ya escrita
      var replaceBtn = node.querySelector('[data-role="replace"]');
      var replaceInput = node.querySelector('[data-role="replace-input"]');
      replaceBtn.onclick = function () { replaceInput.click(); };
      replaceInput.onchange = function () {
        var file = replaceInput.files[0];
        if (!file) return;
        replaceBtn.disabled = true;
        replaceBtn.textContent = "Subiendo…";
        uploadImage(file, function (rel) {
          replaceInput.value = "";
          if (!rel) { replaceBtn.disabled = false; replaceBtn.textContent = "🔄 Reemplazar imagen"; return; }
          item.image = rel;
          markDirty();
          renderGallery();
        });
      };

      list.appendChild(node);
    });
  }

  function initAddGallery() {
    var input = $("[data-add-gallery]");
    if (!input) return;
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) return;
      uploadImage(file, function (rel) {
        input.value = "";
        if (!rel) return;
        state.content.galeria.push({ image: rel, alt: "" });
        markDirty();
        renderGallery();
      });
    });
  }

  /* ---------------- stikers encontrados (reto del día) ---------------- */
  /* Las fotos las sube el cliente solo, desde la web publicada (api/premio.php).
     Aquí solo las consultamos y, si hace falta, las borramos. */
  function initStikerGalleryPanel() {
    var btn = $("[data-refresh-stikers]");
    var statusEl = $("[data-stikers-status]");
    var list = $("[data-stiker-gallery-list]");
    if (!btn || !list) return;

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.style.color = isError ? "var(--danger)" : "";
    }

    function renderItems(items, secret) {
      list.innerHTML = "";
      if (!items.length) {
        list.innerHTML = '<p class="hint">Todavía no hay stikers subidos por clientes.</p>';
        return;
      }
      items.slice().reverse().forEach(function (item) {
        var node = $("#tpl-stiker-item").content.cloneNode(true);
        var img = node.querySelector('[data-role="preview"]');
        var altEl = node.querySelector('[data-role="alt"]');
        var dateEl = node.querySelector('[data-role="date"]');
        var removeBtn = node.querySelector('[data-role="remove"]');
        img.src = adminAssetUrl(item.image);
        if (altEl) altEl.textContent = item.alt || "Sin nombre";
        if (dateEl) dateEl.textContent = item.date || "";
        removeBtn.onclick = function () {
          if (!confirm("¿Eliminar esta foto de stiker?")) return;
          fetch("../api/premio.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete-stiker", id: item.id, secret: secret })
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.ok) {
              renderItems(res.state.stikers || [], secret);
              setStatus("Foto eliminada ✓");
            } else {
              setStatus((res && res.error) || "No se pudo eliminar la foto.", true);
            }
          }).catch(function () { setStatus("No se pudo conectar con el servidor.", true); });
        };
        list.appendChild(node);
      });
    }

    btn.addEventListener("click", function () {
      var secret = ((state.content.business && state.content.business.adminSecret) || "").trim();
      if (!secret) { setStatus('Primero escribe una "Clave de administrador" en la pestaña Negocio.', true); return; }
      setStatus("Cargando…");
      fetch("../api/premio.php?action=status").then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok) {
          renderItems(res.state.stikers || [], secret);
          setStatus("Actualizado ✓");
        } else {
          setStatus("No se pudo cargar la lista.", true);
        }
      }).catch(function () { setStatus("No se pudo conectar con el servidor.", true); });
    });
  }

  /* ---------------- ranking del Toppings Run (premio al #1) ---------------- */
  var RANKING_STATUS_LABEL = { waiting: "Esperando", available: "Disponible para reclamar", claimed: "Reclamado", expired: "Vencido" };
  var rankingCountdownTimer = null;

  function formatCountdown(ms) {
    if (ms <= 0) return "00:00:00";
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  function rankingTypeLabel(t) {
    return t === "daily" ? "Diario" : t === "hourly" ? "Por horas" : "Semanal";
  }

  function renderRankingStatus() {
    var box = $("[data-ranking-status]");
    var historyBox = $("[data-ranking-history]");
    if (!box) return;
    fetch(RUN_API + "?action=admin-status", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        clearInterval(rankingCountdownTimer);
        if (!res || !res.ok) { box.innerHTML = '<p class="hint">No se pudo cargar el estado del ranking.</p>'; return; }
        var s = res.state;
        var clockOffset = Date.now() - s.serverNow;

        var paint = function () {
          var now = Date.now() - clockOffset;
          var badgeClass = "ranking-badge-" + s.claim.status;
          var rows = [
            '<div class="ranking-status-row"><span>Tipo activo</span><span>' + rankingTypeLabel(s.rankingType) + '</span></div>',
            '<div class="ranking-status-row"><span>Estado</span><span><span class="ranking-badge ' + badgeClass + '">' + (RANKING_STATUS_LABEL[s.claim.status] || s.claim.status) + '</span></span></div>'
          ];
          if (s.winner) {
            rows.push('<div class="ranking-status-row"><span>Ganador actual</span><span>' + escHTML(s.winner.name) + '</span></div>');
            rows.push('<div class="ranking-status-row"><span>Puntaje</span><span>' + s.winner.score + '</span></div>');
          }
          if (s.claim.status === "available" && s.claim.windowEndsAtMs) {
            var msLeft = Math.max(0, s.claim.windowEndsAtMs - now);
            rows.push('<div class="ranking-status-row"><span>Tiempo restante para reclamar</span><span>' + formatCountdown(msLeft) + '</span></div>');
          }
          box.innerHTML = rows.join("");
        };
        paint();
        rankingCountdownTimer = setInterval(paint, 1000);

        if (historyBox) {
          if (!s.history || !s.history.length) {
            historyBox.innerHTML = '<p class="hint">Sin historial todavía.</p>';
          } else {
            historyBox.innerHTML = s.history.map(function (h) {
              var outcomeLabel = h.outcome === "claimed" ? "✅ Reclamado" : h.outcome === "expired" ? "⌛ Vencido, no fue reclamado" : "🔄 Reiniciado por el admin";
              var outcomeClass = "ranking-history-item-outcome-" + h.outcome;
              return '<div class="ranking-history-item">' +
                '<span>' + escHTML(h.name || "—") + (h.score != null ? " · " + h.score + " pts" : "") + " · " + rankingTypeLabel(h.rankingType) + '</span>' +
                '<span class="' + outcomeClass + '">' + outcomeLabel + '</span></div>';
            }).join("");
          }
        }
      })
      .catch(function () { box.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>'; });
  }

  function initRankingReset() {
    var btn = $("[data-ranking-reset]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!confirm("¿Reiniciar el ranking ahora? Se perderán los puntajes del período en curso.")) return;
      btn.disabled = true;
      fetch(RUN_API + "?action=admin-reset", { method: "POST", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          if (res && res.ok) renderRankingStatus();
          else alert((res && res.error) || "No se pudo reiniciar el ranking.");
        })
        .catch(function () {
          btn.disabled = false;
          alert("No se pudo conectar con el servidor.");
        });
    });
  }

  /* ---------------- reto del día: estado + reinicio manual ---------------- */
  function renderChallengeStatus() {
    var box = $("[data-challenge-status]");
    if (!box) return;
    fetch(PRIZE_API + "?action=status")
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { box.innerHTML = '<p class="hint">No se pudo cargar el estado del reto.</p>'; return; }
        var ch = res.state.challenge || { claims: [], limit: 1, remaining: 1 };
        var rows = ['<div class="ranking-status-row"><span>Ganadores hoy</span><span>' + ch.claims.length + ' de ' + ch.limit + '</span></div>'];
        if (ch.claims.length) {
          var names = ch.claims.map(function (c) { return escHTML(c.name || "—"); }).join(", ");
          rows.push('<div class="ranking-status-row"><span>Ya ganaron</span><span>' + names + '</span></div>');
        }
        box.innerHTML = rows.join("");
      })
      .catch(function () { box.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>'; });
  }

  function initChallengeReset() {
    var btn = $("[data-challenge-reset]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var secret = ((state.content.business && state.content.business.adminSecret) || "").trim();
      if (!secret) { alert('Primero escribe una "Clave de administrador" en la pestaña Negocio.'); return; }
      if (!confirm("¿Reiniciar el reto de hoy? Se abrirán de nuevo los cupos de ganadores por hoy.")) return;
      btn.disabled = true;
      fetch(PRIZE_API, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin-reset-challenge", secret: secret })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          if (res && res.ok) renderChallengeStatus();
          else alert((res && res.error) || "No se pudo reiniciar el reto.");
        })
        .catch(function () {
          btn.disabled = false;
          alert("No se pudo conectar con el servidor.");
        });
    });
  }

  /* ---------------- documento de conocimiento del asistente de IA ---------------- */
  function renderAiDocStatus() {
    var statusEl = $("[data-ai-doc-status]");
    if (!statusEl) return;
    var ai = state.content.aiAssistant || {};
    statusEl.textContent = ai.knowledgeDocName
      ? ("Documento actual: " + ai.knowledgeDocName)
      : "Ningún documento subido todavía.";
  }

  function initAiDoc() {
    var input = $("[data-ai-doc-upload]");
    var removeBtn = $("[data-ai-doc-remove]");
    if (input) {
      input.addEventListener("change", function () {
        var file = input.files[0];
        if (!file) return;
        var statusEl = $("[data-ai-doc-status]");
        if (statusEl) statusEl.textContent = "Subiendo y leyendo el documento…";
        var form = new FormData();
        form.append("doc", file);
        fetch(API + "?action=upload-knowledge-doc", { method: "POST", credentials: "same-origin", body: form })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            input.value = "";
            if (res && res.ok) {
              if (!state.content.aiAssistant) state.content.aiAssistant = {};
              state.content.aiAssistant.knowledgeDocText = res.text;
              state.content.aiAssistant.knowledgeDocName = res.name;
              markDirty();
              renderAiDocStatus();
            } else {
              alert((res && res.error) || "No se pudo leer el documento.");
              renderAiDocStatus();
            }
          })
          .catch(function () {
            input.value = "";
            alert("No se pudo conectar con el servidor para subir el documento.");
            renderAiDocStatus();
          });
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        if (!state.content.aiAssistant || !state.content.aiAssistant.knowledgeDocName) return;
        if (!confirm("¿Quitar el documento actual del asistente?")) return;
        state.content.aiAssistant.knowledgeDocText = "";
        state.content.aiAssistant.knowledgeDocName = "";
        markDirty();
        renderAiDocStatus();
      });
    }
  }

  /* ---------------- código QR de la tarjeta de fidelidad ---------------- */
  function initGenerateQr() {
    var btn = $("[data-generate-qr]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var code = (state.content.dailyPrize && state.content.dailyPrize.loyalty && state.content.dailyPrize.loyalty.secretCode || "").trim();
      if (!code) { alert("Primero escribe un código del QR en Tarjeta de fidelidad."); return; }
      if (typeof QRCode === "undefined") { alert("No se pudo cargar el generador de códigos QR."); return; }

      var url = location.origin + "/index.html?sello=" + encodeURIComponent(code) + "#premio-del-dia";
      var canvasEl = $("[data-qr-canvas]");
      var output = $("[data-qr-output]");
      canvasEl.innerHTML = "";
      new QRCode(canvasEl, { text: url, width: 220, height: 220 });
      if (output) output.hidden = false;
    });
  }

  /* ---------------- menu image lists (comidas/helados/bebidas) ---------------- */
  /* ---------------- reordenar arrastrando ----------------
     A propósito NO se usa el drag-and-drop nativo de HTML5 (el que sí usan
     los bloques del carrusel): ese no existe en pantallas táctiles, y el
     panel se maneja casi siempre desde el celular. Con Pointer Events
     funciona igual con dedo y con mouse.

     Hay que mantener presionado un momento antes de que empiece a arrastrar
     — si no, cualquier intento de hacer scroll con el dedo sobre una foto
     terminaría moviéndola de lugar. */
  var SORT_HOLD_MS = 180;
  var SORT_CANCEL_PX = 10;

  function makeSortable(list, onReorder) {
    var holdTimer = null;
    var item = null;      // el elemento que se está arrastrando
    var placeholder = null;
    var dragging = false;
    var startX = 0, startY = 0, grabX = 0, grabY = 0, fromIdx = 0, isGrid = false;
    var lastX = 0, lastY = 0, autoScrollTimer = 0, pointerId = null;

    function itemsOf() {
      return Array.prototype.filter.call(list.children, function (c) {
        return c !== placeholder && c.hasAttribute("data-sort-item");
      });
    }

    /* ¿La lista es una cuadrícula (fotos, varias por renglón) o una columna
       (horario, premios de la ruleta)? De eso depende si soltar "a la
       derecha" o "más abajo" de otro elemento significa ponerlo después.
       Se decide mirando si hay dos elementos que compartan renglón. */
    function listIsGrid() {
      var all = itemsOf();
      for (var i = 1; i < all.length; i++) {
        var prev = all[i - 1].getBoundingClientRect();
        var cur = all[i].getBoundingClientRect();
        if (Math.abs(cur.top - prev.top) < 4) return true;
      }
      return false;
    }

    function begin() {
      dragging = true;
      var r = item.getBoundingClientRect();
      fromIdx = itemsOf().indexOf(item);
      isGrid = listIsGrid();

      placeholder = document.createElement("div");
      placeholder.className = "sort-placeholder";
      placeholder.style.width = r.width + "px";
      placeholder.style.height = r.height + "px";
      list.insertBefore(placeholder, item);

      item.classList.add("is-sorting");
      item.style.width = r.width + "px";
      item.style.height = r.height + "px";
      item.style.position = "fixed";
      item.style.left = r.left + "px";
      item.style.top = r.top + "px";
      item.style.zIndex = "999";
      item.style.pointerEvents = "none";
      grabX = startX - r.left;
      grabY = startY - r.top;
      lastX = startX;
      lastY = startY;
      document.body.classList.add("is-sorting-active");
      // temporizador y no requestAnimationFrame: rAF se congela cuando la
      // pestaña no está pintando, y aquí interesa que el desplazamiento siga
      // respondiendo mientras el dedo esté quieto contra el borde
      if (!autoScrollTimer) autoScrollTimer = setInterval(autoScrollTick, 16);
    }

    function moveTo(x, y) {
      lastX = x;
      lastY = y;
      item.style.left = (x - grabX) + "px";
      item.style.top = (y - grabY) + "px";

      // ¿sobre qué otra foto está el dedo? El placeholder se corre ahí.
      var others = itemsOf();
      for (var i = 0; i < others.length; i++) {
        if (others[i] === item) continue;
        var r = others[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          // en cuadrícula manda el eje horizontal; en columna, el vertical
          var after = isGrid
            ? (x - r.left) > r.width / 2
            : (y - r.top) > r.height / 2;
          list.insertBefore(placeholder, after ? others[i].nextSibling : others[i]);
          return;
        }
      }
    }

    /* Con la foto agarrada el dedo no puede hacer scroll, así que para
       llevarla a una posición que no está en pantalla la página se desplaza
       sola al acercar el dedo al borde de arriba o de abajo. Va más rápido
       cuanto más cerca del borde. */
    var EDGE_PX = 90;
    var MAX_STEP = 14;

    function autoScrollTick() {
      if (!dragging) return;
      var step = 0;
      if (lastY < EDGE_PX) step = -MAX_STEP * (1 - lastY / EDGE_PX);
      else if (lastY > window.innerHeight - EDGE_PX) {
        step = MAX_STEP * (1 - (window.innerHeight - lastY) / EDGE_PX);
      }
      if (!step) return;
      var before = window.scrollY;
      window.scrollBy(0, step);
      // si de verdad se movió, hay que recalcular dónde cae el placeholder
      if (window.scrollY !== before) moveTo(lastX, lastY);
    }

    function finish(commit) {
      clearTimeout(holdTimer);
      if (autoScrollTimer) { clearInterval(autoScrollTimer); autoScrollTimer = 0; }
      if (pointerId != null) {
        try { list.releasePointerCapture(pointerId); } catch (err) {}
        pointerId = null;
      }
      if (!dragging) { item = null; return; }

      var toIdx = fromIdx;
      if (placeholder) {
        // índice final = posición del placeholder ignorando al que se arrastra
        var order = Array.prototype.filter.call(list.children, function (c) {
          return c === placeholder || (c !== item && c.hasAttribute("data-sort-item"));
        });
        toIdx = order.indexOf(placeholder);
      }

      item.classList.remove("is-sorting");
      item.removeAttribute("style");
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      document.body.classList.remove("is-sorting-active");
      placeholder = null;
      dragging = false;
      var moved = item;
      item = null;

      if (commit && toIdx !== fromIdx) onReorder(fromIdx, toIdx);
      else if (moved) moved.classList.add("is-sort-return");
    }

    list.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      var target = e.target.closest("[data-sort-item]");
      if (!target || !list.contains(target)) return;
      // No pisar los controles ni los campos de texto (en la galería cada
      // foto tiene su descripción).
      if (e.target.closest("button, input, textarea, select, a")) return;

      var onGrip = !!e.target.closest(".image-list-grip");

      /* Con el dedo, el arrastre SOLO empieza desde el asa. Si empezara en
         cualquier punto de la foto habría que bloquear el gesto del
         navegador sobre toda la tarjeta, y entonces no se podría deslizar
         la página con el dedo encima de una imagen. Con mouse sí vale
         agarrar desde cualquier lado, manteniendo presionado. */
      if (!onGrip && e.pointerType === "touch") return;

      item = target;
      startX = e.clientX;
      startY = e.clientY;
      clearTimeout(holdTimer);

      /* Capturar el puntero: sin esto, en cuanto el dedo sale del borde de la
         lista (justo lo que pasa al arrastrar hasta el borde de la pantalla
         para que se desplace sola) dejan de llegar los pointermove y la foto
         se queda pegada a mitad de camino. */
      pointerId = e.pointerId;
      try { list.setPointerCapture(pointerId); } catch (err) { pointerId = null; }

      if (onGrip) {
        begin();
        moveTo(startX, startY);
      } else {
        holdTimer = setTimeout(function () {
          if (!item) return;
          begin();
          moveTo(startX, startY);
        }, SORT_HOLD_MS);
      }
    });

    list.addEventListener("pointermove", function (e) {
      if (!item) return;
      if (!dragging) {
        // se movió antes de completar la pulsación larga => era scroll
        if (Math.abs(e.clientX - startX) > SORT_CANCEL_PX || Math.abs(e.clientY - startY) > SORT_CANCEL_PX) {
          clearTimeout(holdTimer);
          item = null;
        }
        return;
      }
      e.preventDefault();
      moveTo(e.clientX, e.clientY);
    });

    ["pointerup", "pointercancel"].forEach(function (evt) {
      list.addEventListener(evt, function () { finish(evt === "pointerup"); });
    });
    window.addEventListener("blur", function () { if (item) finish(false); });
  }

  /* Lista de rutas ocultas de una categoría. Vive al lado de `images`
     (p. ej. comidas.hiddenImages) para no tener que cambiar el formato de
     `images`, que hoy es una lista simple de rutas. */
  function hiddenListFor(parts, arrKey) {
    var owner = parts.length ? getPath(state.content, parts.join(".")) : state.content;
    var key = arrKey === "images" ? "hiddenImages" : arrKey + "Hidden";
    if (!Array.isArray(owner[key])) owner[key] = [];
    return owner[key];
  }

  function renderImageLists() {
    $$("[data-image-list]").forEach(function (list) {
      var path = list.getAttribute("data-image-list");
      var parts = path.split(".");
      var arrKey = parts.pop();
      var container = parts.length ? getPath(state.content, parts.join(".")) : state.content;
      var items = container[arrKey] || (container[arrKey] = []);

      // el arrastre se engancha al contenedor una sola vez: `list.innerHTML = ""`
      // borra las fotos pero no toca los escuchadores del contenedor
      if (!list.__sortable) {
        list.__sortable = true;
        makeSortable(list, function (from, to) {
          var arr = (parts.length ? getPath(state.content, parts.join(".")) : state.content)[arrKey];
          // `to` ya viene medido sobre la lista SIN el elemento arrastrado
          // (el placeholder ocupa su lugar), así que no hay que corregirlo.
          arr.splice(to, 0, arr.splice(from, 1)[0]);
          markDirty();
          renderImageLists();
          renderCarouselAdmins();
        });
      }

      list.innerHTML = "";
      items.forEach(function (src, idx) {
        var node = $("#tpl-image-list-item").content.cloneNode(true);
        var previewImg = node.querySelector('[data-role="preview"]');
        var posEl = node.querySelector('[data-role="pos"]');
        var numEl = node.querySelector('[data-role="num"]');
        var upBtn = node.querySelector('[data-role="up"]');
        var downBtn = node.querySelector('[data-role="down"]');
        var removeBtn = node.querySelector('[data-role="remove"]');
        var hideBtn = node.querySelector('[data-role="hide"]');

        setImgSrc(previewImg, src);
        posEl.textContent = (idx + 1) + " / " + items.length;
        numEl.textContent = idx + 1;
        upBtn.disabled = idx === 0;
        downBtn.disabled = idx === items.length - 1;

        /* Ocultar ≠ eliminar: la imagen deja de verse en la página pero sigue
           guardada, así que se puede volver a mostrar sin subirla de nuevo. */
        var hiddenList = hiddenListFor(parts, arrKey);
        var isHidden = hiddenList.indexOf(src) !== -1;
        node.querySelector("[data-sort-item]").classList.toggle("is-hidden-image", isHidden);
        hideBtn.textContent = isHidden ? "🙈 Oculta" : "👁️ Se muestra";
        hideBtn.classList.toggle("is-off", isHidden);
        hideBtn.onclick = function () {
          var pos = hiddenList.indexOf(src);
          if (pos === -1) hiddenList.push(src);
          else hiddenList.splice(pos, 1);
          markDirty();
          renderImageLists();
        };

        upBtn.onclick = function () {
          if (idx === 0) return;
          items.splice(idx - 1, 0, items.splice(idx, 1)[0]);
          markDirty();
          renderImageLists();
          renderCarouselAdmins();
        };
        downBtn.onclick = function () {
          if (idx === items.length - 1) return;
          items.splice(idx + 1, 0, items.splice(idx, 1)[0]);
          markDirty();
          renderImageLists();
          renderCarouselAdmins();
        };
        removeBtn.onclick = function () {
          if (!confirm("¿Eliminar esta imagen del menú?")) return;
          items.splice(idx, 1);
          // que no quede la ruta colgada en la lista de ocultas
          var h = hiddenList.indexOf(src);
          if (h !== -1) hiddenList.splice(h, 1);
          markDirty();
          renderImageLists();
          renderCarouselAdmins();
        };

        /* Reemplazar: cambia la foto conservando su POSICIÓN. Antes había que
           borrar y volver a subir, y la nueva quedaba al final de la lista. */
        var replaceBtn = node.querySelector('[data-role="replace"]');
        var replaceInput = node.querySelector('[data-role="replace-input"]');
        replaceBtn.onclick = function () { replaceInput.click(); };
        replaceInput.onchange = function () {
          var file = replaceInput.files[0];
          if (!file) return;
          replaceBtn.disabled = true;
          replaceBtn.textContent = "Subiendo…";
          uploadImage(file, function (rel) {
            replaceInput.value = "";
            if (!rel) { replaceBtn.disabled = false; replaceBtn.textContent = "🔄 Reemplazar imagen"; return; }
            items[idx] = rel;
            // si estaba oculta, la nueva hereda ese estado
            var pos = hiddenList.indexOf(src);
            if (pos !== -1) hiddenList[pos] = rel;
            markDirty();
            renderImageLists();
            renderCarouselAdmins();
          });
        };

        list.appendChild(node);
      });
    });
  }

  function initAddImageList() {
    $$("[data-add-image-list]").forEach(function (input) {
      input.addEventListener("change", function () {
        var file = input.files[0];
        if (!file) return;
        var path = input.getAttribute("data-add-image-list");
        var parts = path.split(".");
        var arrKey = parts.pop();
        var container = parts.length ? getPath(state.content, parts.join(".")) : state.content;
        var items = container[arrKey] || (container[arrKey] = []);

        uploadImage(file, function (rel) {
          input.value = "";
          if (!rel) return;
          items.push(rel);
          markDirty();
          renderImageLists();
          renderCarouselAdmins();
        });
      });
    });
  }

  /* ---------------- generic repeat lists (horario, zona secreta items) ---------------- */
  function renderRepeatLists() {
    $$("[data-list]").forEach(function (list) {
      var path = list.getAttribute("data-list");
      var fields = list.getAttribute("data-item-fields").split(",");
      var labels = list.getAttribute("data-item-labels").split(",");
      var parts = path.split(".");
      var arrKey = parts.pop();
      var container = parts.length ? getPath(state.content, parts.join(".")) : state.content;
      var items = container[arrKey] || (container[arrKey] = []);

      if (!list.__sortable) {
        list.__sortable = true;
        makeSortable(list, function (from, to) {
          var arr = (parts.length ? getPath(state.content, parts.join(".")) : state.content)[arrKey];
          arr.splice(to, 0, arr.splice(from, 1)[0]);
          markDirty();
          renderRepeatLists();
        });
      }

      list.innerHTML = "";
      items.forEach(function (item, idx) {
        var node = $("#tpl-repeat-item").content.cloneNode(true);
        var wrap = node.querySelector(".repeat-item");
        wrap.setAttribute("data-sort-item", "");
        fields.forEach(function (f, i) {
          var label = document.createElement("label");
          if (fields.length > 2 || f === "description") label.className = "full";
          var labelText = document.createElement("span");
          labelText.textContent = labels[i] || f;
          var input = f === "description"
            ? document.createElement("textarea")
            : document.createElement("input");
          if (input.tagName === "INPUT") input.type = "text";
          else input.rows = 2;
          input.value = item[f] || "";
          input.oninput = function () { item[f] = input.value; markDirty(); };
          label.appendChild(labelText);
          label.appendChild(input);
          wrap.appendChild(label);
        });
        var removeBtn = document.createElement("button");
        removeBtn.className = "btn-remove";
        removeBtn.type = "button";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Eliminar";
        removeBtn.onclick = function () {
          items.splice(idx, 1);
          markDirty();
          renderRepeatLists();
        };
        wrap.appendChild(removeBtn);

        var grip = document.createElement("span");
        grip.className = "image-list-grip";
        grip.textContent = "⠿";
        wrap.appendChild(grip);

        list.appendChild(node);
      });
    });
  }

  function initAddRepeat() {
    $$("[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var path = btn.getAttribute("data-add");
        var parts = path.split(".");
        var arrKey = parts.pop();
        var container = parts.length ? getPath(state.content, parts.join(".")) : state.content;
        var items = container[arrKey] || (container[arrKey] = []);
        var fields = document.querySelector('[data-list="' + path + '"]').getAttribute("data-item-fields").split(",");
        var blank = {};
        fields.forEach(function (f) { blank[f] = ""; });
        items.push(blank);
        markDirty();
        renderRepeatLists();
      });
    });
  }

  /* ---------------- Carrusel dentro de cada categoría del menú ----------------
     Cada categoría (Comidas/Helados/Bebidas) administra SOLO su carrusel: sus
     imágenes, su posición entre las imágenes del menú y su configuración. Nada
     se comparte entre categorías. Toda la interfaz se genera aquí para no
     repetir el mismo bloque de HTML tres veces. */

  var CAROUSEL_DEFAULTS = {
    active: false, position: 0, images: [],
    intervalMs: 4000, transitionMs: 600, direction: "ltr",
    autoplay: true, showArrows: true, showDots: true, swipe: true,
    autoHeight: true, height: 220, radius: 14,
    marginTop: 0, marginBottom: 0, sidePadding: 0,
    bg: "", border: false, shadow: true
  };

  /** Devuelve (creándola si hace falta) la config del carrusel de una categoría. */
  function carouselOf(cat) {
    var info = state.content[cat] || (state.content[cat] = {});
    var c = info.carousel || (info.carousel = {});
    for (var k in CAROUSEL_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(CAROUSEL_DEFAULTS, k) && c[k] === undefined) {
        c[k] = Array.isArray(CAROUSEL_DEFAULTS[k]) ? [] : CAROUSEL_DEFAULTS[k];
      }
    }
    if (!Array.isArray(c.images)) c.images = [];
    return c;
  }

  function renderCarouselAdmins() {
    $$("[data-carousel-admin]").forEach(function (host) {
      renderCarouselAdmin(host, host.getAttribute("data-carousel-admin"));
    });
  }

  function renderCarouselAdmin(host, cat) {
    var c = carouselOf(cat);
    var menuImages = (state.content[cat] && state.content[cat].images) || [];

    host.innerHTML =
      '<label class="switch"><input type="checkbox" data-cc-active> Mostrar este carrusel en la web</label>' +
      '<p class="hint">Si lo desactivas, no se muestra ni deja espacio, pero se conserva todo lo que configuraste aquí.</p>' +

      '<h4>Imágenes del carrusel</h4>' +
      '<p class="hint">Puedes desactivar una imagen sin borrarla — deja de mostrarse pero queda guardada.</p>' +
      '<div class="cc-admin-images" data-cc-images></div>' +
      '<label class="btn btn-primary file-btn">+ Agregar imagen al carrusel' +
        '<input type="file" accept="image/*" data-cc-add hidden>' +
      "</label>" +

      '<h4>Posición dentro del menú</h4>' +
      '<p class="hint">Arrastra el bloque del carrusel, o usa las flechas, para ponerlo antes, entre o después de las imágenes del menú.</p>' +
      '<div class="cc-blocks" data-cc-blocks></div>' +

      '<h4>Animación</h4>' +
      '<div class="field-grid">' +
        '<label>Tiempo entre imágenes (segundos) <input type="number" min="1" step="0.5" data-cc-num="intervalMs" data-cc-scale="1000"></label>' +
        '<label>Velocidad de la transición (segundos) <input type="number" min="0" step="0.1" data-cc-num="transitionMs" data-cc-scale="1000"></label>' +
        '<label>Dirección' +
          '<select data-cc-val="direction">' +
            '<option value="ltr">De izquierda a derecha</option>' +
            '<option value="rtl">De derecha a izquierda</option>' +
          "</select>" +
        "</label>" +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="autoplay"> Avanzar solo</label>' +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="showArrows"> Mostrar flechas</label>' +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="showDots"> Mostrar indicadores</label>' +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="swipe"> Permitir deslizar con el dedo</label>' +
      "</div>" +

      "<h4>Apariencia</h4>" +
      '<div class="field-grid">' +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="autoHeight"> Altura automática (la imagen manda)</label>' +
        '<label>Altura fija (px, si desactivas la automática) <input type="number" min="60" data-cc-num="height"></label>' +
        '<label>Bordes redondeados (px) <input type="number" min="0" data-cc-num="radius"></label>' +
        '<label>Margen superior (px) <input type="number" min="0" data-cc-num="marginTop"></label>' +
        '<label>Margen inferior (px) <input type="number" min="0" data-cc-num="marginBottom"></label>' +
        '<label>Separación lateral (px) <input type="number" min="0" data-cc-num="sidePadding"></label>' +
        '<label>Color de fondo (vacío = sin fondo) <input type="text" data-cc-val="bg" placeholder="#000000"></label>' +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="border"> Contorno</label>' +
        '<label class="switch-inline"><input type="checkbox" data-cc-bool="shadow"> Sombra</label>' +
      "</div>" +

      '<button type="button" class="btn btn-ghost" data-cc-preview>👁️ Vista previa</button>';

    // --- interruptor principal
    var activeBox = $("[data-cc-active]", host);
    activeBox.checked = !!c.active;
    activeBox.onchange = function () { c.active = activeBox.checked; markDirty(); };

    // --- campos simples
    $$("[data-cc-bool]", host).forEach(function (el) {
      var k = el.getAttribute("data-cc-bool");
      el.checked = c[k] !== false;
      el.onchange = function () { c[k] = el.checked; markDirty(); };
    });
    $$("[data-cc-val]", host).forEach(function (el) {
      var k = el.getAttribute("data-cc-val");
      el.value = c[k] == null ? "" : c[k];
      el.oninput = function () { c[k] = el.value; markDirty(); };
    });
    $$("[data-cc-num]", host).forEach(function (el) {
      var k = el.getAttribute("data-cc-num");
      var scale = Number(el.getAttribute("data-cc-scale")) || 1;
      el.value = (Number(c[k]) || 0) / scale;
      el.oninput = function () { c[k] = (Number(el.value) || 0) * scale; markDirty(); };
    });

    renderCarouselImages(host, cat, c);
    renderCarouselBlocks(host, cat, c, menuImages);

    $("[data-cc-add]", host).onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      uploadImage(file, function (rel) {
        e.target.value = "";
        if (!rel) return;
        c.images.push({ src: rel, active: true });
        markDirty();
        renderCarouselAdmin(host, cat);
      });
    };

    $("[data-cc-preview]", host).onclick = function () { openCarouselPreview(cat); };
  }

  function renderCarouselImages(host, cat, c) {
    var list = $("[data-cc-images]", host);
    if (!c.images.length) {
      list.innerHTML = '<p class="hint">Todavía no has agregado imágenes a este carrusel.</p>';
      return;
    }
    // mismo arrastre que las fotos del menú (se engancha una sola vez)
    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        var cfg = carouselOf(cat);
        cfg.images.splice(to, 0, cfg.images.splice(from, 1)[0]);
        markDirty();
        renderCarouselAdmin(host, cat);
      });
    }

    list.innerHTML = "";
    c.images.forEach(function (item, idx) {
      var row = document.createElement("div");
      row.setAttribute("data-sort-item", "");
      row.className = "cc-admin-image" + (item.active === false ? " is-off" : "");
      row.innerHTML =
        '<img class="preview" src="' + adminAssetUrl(item.src) + '" alt="">' +
        '<div class="cc-admin-image-actions">' +
          '<label class="switch-inline"><input type="checkbox" data-role="on"> Se muestra</label>' +
          '<span class="cc-admin-image-buttons">' +
            '<button type="button" data-role="up" aria-label="Subir">↑</button>' +
            '<span class="image-list-pos">' + (idx + 1) + " / " + c.images.length + "</span>" +
            '<button type="button" data-role="down" aria-label="Bajar">↓</button>' +
          "</span>" +
          '<span class="image-list-grip">⠿</span>' +
        "</div>" +
        '<button type="button" class="btn-remove" data-role="remove" title="Eliminar del carrusel" aria-label="Eliminar del carrusel">&times;</button>';

      var onBox = row.querySelector('[data-role="on"]');
      onBox.checked = item.active !== false;
      onBox.onchange = function () { item.active = onBox.checked; markDirty(); renderCarouselAdmin(host, cat); };

      var up = row.querySelector('[data-role="up"]');
      var down = row.querySelector('[data-role="down"]');
      up.disabled = idx === 0;
      down.disabled = idx === c.images.length - 1;
      up.onclick = function () { c.images.splice(idx - 1, 0, c.images.splice(idx, 1)[0]); markDirty(); renderCarouselAdmin(host, cat); };
      down.onclick = function () { c.images.splice(idx + 1, 0, c.images.splice(idx, 1)[0]); markDirty(); renderCarouselAdmin(host, cat); };
      row.querySelector('[data-role="remove"]').onclick = function () {
        if (!confirm("¿Quitar esta imagen del carrusel?")) return;
        c.images.splice(idx, 1); markDirty(); renderCarouselAdmin(host, cat);
      };
      list.appendChild(row);
    });
  }

  /* Lista de BLOQUES: las imágenes del menú y el carrusel en una sola lista
     ordenable. Mover el bloque del carrusel cambia su posición. Si mañana se
     agregan más imágenes al menú, aparecen aquí solas. */
  function renderCarouselBlocks(host, cat, c, menuImages) {
    var box = $("[data-cc-blocks]", host);
    var total = menuImages.length;
    var pos = Math.max(0, Math.min(total, Number(c.position) || 0));
    c.position = pos;

    box.innerHTML = "";
    for (var slot = 0; slot <= total; slot++) {
      if (slot === pos) box.appendChild(buildCarouselBlockRow(host, cat, c, total, true, null, slot));
      if (slot < total) box.appendChild(buildCarouselBlockRow(host, cat, c, total, false, menuImages[slot], slot));
    }
  }

  function buildCarouselBlockRow(host, cat, c, total, isCarousel, src, slot) {
    var row = document.createElement("div");
    row.className = "cc-block" + (isCarousel ? " is-carousel" : "");
    if (isCarousel) {
      row.setAttribute("draggable", "true");
      row.innerHTML =
        '<span class="cc-block-label">🎠 CARRUSEL' + (c.active ? "" : " (desactivado)") + "</span>" +
        '<span class="cc-block-actions">' +
          '<button type="button" data-role="up" aria-label="Subir">↑</button>' +
          '<button type="button" data-role="down" aria-label="Bajar">↓</button>' +
        "</span>";
      var up = row.querySelector('[data-role="up"]');
      var down = row.querySelector('[data-role="down"]');
      up.disabled = c.position === 0;
      down.disabled = c.position === total;
      up.onclick = function () { c.position = Math.max(0, c.position - 1); markDirty(); renderCarouselAdmin(host, cat); };
      down.onclick = function () { c.position = Math.min(total, c.position + 1); markDirty(); renderCarouselAdmin(host, cat); };
      row.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", "carousel");
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", function () { row.classList.remove("is-dragging"); });
    } else {
      row.innerHTML =
        '<img class="cc-block-thumb" src="' + adminAssetUrl(src) + '" alt="">' +
        '<span class="cc-block-label">Imagen ' + (slot + 1) + "</span>";
      // soltar el carrusel encima de una imagen lo coloca antes o después
      row.addEventListener("dragover", function (e) { e.preventDefault(); row.classList.add("is-drop"); });
      row.addEventListener("dragleave", function () { row.classList.remove("is-drop"); });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("is-drop");
        var r = row.getBoundingClientRect();
        c.position = (e.clientY - r.top) < r.height / 2 ? slot : slot + 1;
        markDirty();
        renderCarouselAdmin(host, cat);
      });
    }
    return row;
  }

  /* Vista previa: usa EXACTAMENTE el mismo carrusel que ve el cliente
     (lib/cat-carousel.js), así lo que se ve aquí es lo que se publicará. */
  function openCarouselPreview(cat) {
    var c = carouselOf(cat);
    var modal = $("[data-cc-preview-modal]");
    var body = $("[data-cc-preview-body]", modal);
    var prev = $(".cat-carousel", body);
    if (prev && window.__catCarousel) window.__catCarousel.destroy(prev);
    body.innerHTML = "";

    var usable = window.__catCarousel && window.__catCarousel.activeConfig({ carousel: c });
    if (!usable) {
      body.innerHTML = '<p class="hint">Activa el carrusel y agrega al menos una imagen activa para ver la vista previa.</p>';
    } else {
      // las rutas del admin necesitan "../" para resolverse bien
      var copy = JSON.parse(JSON.stringify(usable));
      copy.images = copy.images.map(function (it) { return { src: adminAssetUrl(it.src), active: true }; });
      window.__catCarousel.insert(body, copy, cat);
    }
    modal.hidden = false;
  }

  function initCarouselPreviewModal() {
    var modal = $("[data-cc-preview-modal]");
    if (!modal) return;
    $$("[data-cc-preview-close]", modal).forEach(function (el) {
      el.addEventListener("click", function () {
        var prev = $(".cat-carousel", modal);
        if (prev && window.__catCarousel) window.__catCarousel.destroy(prev);
        modal.hidden = true;
      });
    });
  }

  /* ---------------- render everything ---------------- */
  function renderAll() {
    renderForms();
    renderImageFields();
    renderAudioFields();
    renderImageLists();
    renderCarouselAdmins();
    renderGallery();
    renderRepeatLists();
    renderAiDocStatus();
    renderLooks();
    renderBgTypeVisibility();
    renderModalStyleVisibility();
    renderNameChangeModeVisibility();
    renderRankingStatus();
    renderAllRewardTypeVisibility();
    fetchCodesStats();
    renderChallengeStatus();
  }

  /* ---------------- personalización: mostrar solo el campo del tipo de fondo elegido ---------------- */
  function renderBgTypeVisibility() {
    var select = $("[data-bg-type-select]");
    if (!select) return;
    var type = (state.content.customization && state.content.customization.backgroundType) || "texture";
    $$('[data-bg-field="color"]').forEach(function (el) { el.hidden = type !== "color"; });
    $$('[data-bg-field="image"]').forEach(function (el) { el.hidden = type !== "image"; });
  }

  function initBgTypeToggle() {
    var select = $("[data-bg-type-select]");
    if (!select) return;
    select.addEventListener("change", function () {
      renderBgTypeVisibility();
      renderLooks();
    });
  }

  /* Estilo de las ventanas emergentes: los ajustes del chorreado solo tienen
     sentido con el estilo urbano, así que se ocultan con el estilo simple. */
  function renderModalStyleVisibility() {
    var select = $("[data-modal-style-select]");
    if (!select) return;
    var c = state.content.customization || {};
    var urban = ((c.modal && c.modal.style) || "urban") !== "plain";
    $$('[data-modal-field="urban"]').forEach(function (el) { el.hidden = !urban; });
  }

  function initModalStyleToggle() {
    var select = $("[data-modal-style-select]");
    if (!select) return;
    select.addEventListener("change", renderModalStyleVisibility);
  }

  /* ---------------- "Imagen del sitio" (pestaña Negocio) ----------------
     Un solo lugar para el logo y el fondo, con vista previa de verdad: lo que
     se ve en el recuadro es lo mismo que va a ver el cliente. Los <input
     type="file"> quedan ocultos y los dispara el botón, así cambiar una
     imagen es un clic y no dos. */
  function customization() {
    return state.content.customization || (state.content.customization = {});
  }

  function renderLooks() {
    var c = customization();
    var type = c.backgroundType || "texture";

    $$("[data-bg-choice]").forEach(function (radio) {
      var on = radio.getAttribute("data-bg-choice") === type;
      radio.checked = on;
      var label = radio.closest(".looks-choice");
      if (label) label.classList.toggle("is-active", on);
    });
    $$("[data-bg-quick]").forEach(function (el) {
      el.hidden = el.getAttribute("data-bg-quick") !== type;
    });

    var colorInput = $("[data-bg-quick-color]");
    if (colorInput) colorInput.value = c.backgroundColor || "#0a0a0a";

    var box = $("[data-bg-live-preview]");
    if (box) {
      if (type === "color") {
        box.style.background = c.backgroundColor || "#0a0a0a";
      } else if (type === "image" && c.backgroundImage) {
        box.style.background = "#0a0a0a url('" + adminAssetUrl(c.backgroundImage) + "') center / cover no-repeat";
      } else if (type === "image") {
        box.style.background = "#0a0a0a";
      } else {
        box.style.background = "#0a0a0a url('" + adminAssetUrl("assets/img/bg-texture.jpg") + "') center / cover no-repeat";
      }
    }
  }

  function initLooks() {
    // botón -> abre el selector de archivos oculto
    $$("[data-looks-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = $('[data-looks-input="' + btn.getAttribute("data-looks-pick") + '"]');
        if (input) input.click();
      });
    });

    $$("[data-bg-choice]").forEach(function (radio) {
      radio.addEventListener("change", function () {
        customization().backgroundType = radio.getAttribute("data-bg-choice");
        markDirty();
        renderLooks();
        renderForms();              // mantiene sincronizado el select de Personalización
        renderBgTypeVisibility();
      });
    });

    // elegir una foto de fondo implica querer usarla: se cambia el tipo solo
    var bgFile = $('[data-looks-input="customization.backgroundImage"]');
    if (bgFile) {
      bgFile.addEventListener("change", function () {
        if (!bgFile.files || !bgFile.files[0]) return;
        customization().backgroundType = "image";
        markDirty();
        renderLooks();
        renderForms();
        renderBgTypeVisibility();
      });
    }

    var colorInput = $("[data-bg-quick-color]");
    if (colorInput) {
      colorInput.addEventListener("input", function () {
        customization().backgroundColor = colorInput.value;
        markDirty();
        renderLooks();
        renderForms();
      });
    }
  }

  /* ---------------- saludo al cliente: mostrar el número de cambios solo si el modo es "limited" ---------------- */
  function renderNameChangeModeVisibility() {
    var select = $("[data-name-change-mode-select]");
    if (!select) return;
    var mode = (state.content.customerGreeting && state.content.customerGreeting.nameChangeMode) || "limited";
    $$('[data-name-change-field="limited"]').forEach(function (el) { el.hidden = mode !== "limited"; });
  }

  function initNameChangeModeToggle() {
    var select = $("[data-name-change-mode-select]");
    if (!select) return;
    select.addEventListener("change", renderNameChangeModeVisibility);
  }

  /* ---------------- premio del día: mostrar cantidad/vencimiento de tiros
     solo cuando el tipo de premio de ESA dinámica es "Giro en la Ruleta"
     (hay 4 selects independientes, uno por cada forma de ganar) ---------------- */
  function renderRewardTypeVisibility(select) {
    var grid = select.closest("[data-form]");
    if (!grid) return;
    $$('[data-reward-field]', grid).forEach(function (el) {
      el.hidden = el.getAttribute("data-reward-field") !== select.value;
    });
  }
  function renderAllRewardTypeVisibility() {
    $$("[data-reward-type-select]").forEach(renderRewardTypeVisibility);
  }
  function initRewardTypeToggles() {
    $$("[data-reward-type-select]").forEach(function (select) {
      select.addEventListener("change", function () { renderRewardTypeVisibility(select); });
    });
  }

  /* ==================== 🎡 Ruleta TOPPINGS ====================
     Vive en su propio archivo (ruleta.json), no en admin/content.json,
     porque el inventario de cada premio se descuenta con cada giro real
     (acción del cliente) — necesita el mismo candado atómico que la
     acción de girar usa en el servidor. Por eso tiene su propio ciclo
     cargar/guardar, aparte del botón general "Guardar cambios". */
  var ruletaState = { active: false, title: "RULETA TOPPINGS", whatsappNumber: "", soundEnabled: true, confettiEnabled: true, prizeExpiryHours: 24, prizes: [] };
  var ruletaLoaded = false;

  function fetchRuletaAdmin() {
    fetch(RULETA_API + "?action=admin-status", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) return;
        ruletaState.active = res.active;
        ruletaState.title = res.title;
        ruletaState.whatsappNumber = res.whatsappNumber;
        ruletaState.soundEnabled = res.soundEnabled;
        ruletaState.confettiEnabled = res.confettiEnabled;
        ruletaState.prizeExpiryHours = res.prizeExpiryHours || 24;
        ruletaState.prizes = res.prizes || [];
        renderRuletaForm();
        renderRuletaPrizes();
      })
      .catch(function () {
        var el = $("[data-ruleta-save-status]");
        if (el) { el.textContent = "No se pudo cargar la ruleta."; el.className = "save-status is-error"; }
      });
  }

  function renderRuletaForm() {
    $$("[data-ruleta-field]").forEach(function (input) {
      var key = input.getAttribute("data-ruleta-field");
      if (input.type === "checkbox") input.checked = !!ruletaState[key];
      else input.value = ruletaState[key] == null ? "" : ruletaState[key];
      input.oninput = function () {
        ruletaState[key] = input.type === "checkbox" ? input.checked : input.value;
      };
    });
  }

  function renderRuletaProbSum() {
    var el = $("[data-ruleta-prob-sum]");
    if (!el) return;
    var sum = 0;
    ruletaState.prizes.forEach(function (p) { if (p.active) sum += Number(p.probability) || 0; });
    el.textContent = "Suma de probabilidades activas: " + (Math.round(sum * 10) / 10) + "%";
    el.classList.toggle("is-warning", Math.abs(sum - 100) > 0.05);
  }

  function buildRuletaPrizeRow(p, idx) {
    var row = document.createElement("div");
    row.className = "ruleta-prize-row";
    row.innerHTML =
      '<div class="ruleta-prize-grid">' +
        '<label>Nombre <input type="text" data-p="name"></label>' +
        '<label>Ícono <input type="text" data-p="icon" maxlength="4"></label>' +
        '<label>Color <input type="color" data-p="color"></label>' +
        '<label>Probabilidad % <input type="number" min="0" max="100" step="0.1" data-p="probability"></label>' +
        '<label>Inventario (-1 = ilimitado) <input type="number" data-p="inventory"></label>' +
        '<label>Límite diario (-1 = sin límite) <input type="number" data-p="dailyLimit"></label>' +
        '<label>Límite semanal (-1 = sin límite) <input type="number" data-p="weeklyLimit"></label>' +
        '<label>Fecha inicio (opcional) <input type="date" data-p="startDate"></label>' +
        '<label>Fecha fin (opcional) <input type="date" data-p="endDate"></label>' +
        '<label>Orden <input type="number" data-p="order"></label>' +
        '<label class="full">Descripción <input type="text" data-p="description"></label>' +
        '<label class="switch-inline"><input type="checkbox" data-p="active"> Activo</label>' +
        '<label class="switch-inline"><input type="checkbox" data-p="claimable"> Premio reclamable (si no, es tipo "sigue intentando")</label>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost ruleta-prize-remove">🗑️ Quitar este premio</button>';

    $$("[data-p]", row).forEach(function (input) {
      var key = input.getAttribute("data-p");
      var val = p[key];
      if (input.type === "checkbox") input.checked = !!val;
      else input.value = val == null ? "" : val;
      input.oninput = function () {
        p[key] = input.type === "checkbox" ? input.checked : (input.type === "number" ? Number(input.value) : input.value);
        if (key === "probability" || key === "active") renderRuletaProbSum();
      };
    });
    row.querySelector(".ruleta-prize-remove").addEventListener("click", function () {
      if (!confirm("¿Quitar este premio de la ruleta?")) return;
      ruletaState.prizes.splice(idx, 1);
      renderRuletaPrizes();
    });
    return row;
  }

  function renderRuletaPrizes() {
    var list = $("[data-ruleta-prizes-list]");
    if (!list) return;

    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        // la ruleta no tiene marca de "cambios sin guardar": edita su propio
        // estado y se guarda con su botón aparte
        var arr = ruletaState.prizes;
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        renderRuletaPrizes();
      });
    }

    list.innerHTML = "";
    ruletaState.prizes.forEach(function (p, idx) {
      var row = buildRuletaPrizeRow(p, idx);
      row.setAttribute("data-sort-item", "");
      var grip = document.createElement("span");
      grip.className = "image-list-grip";
      grip.textContent = "⠿";
      row.appendChild(grip);
      list.appendChild(row);
    });
    renderRuletaProbSum();
  }

  function initRuletaAddPrize() {
    var btn = $("[data-ruleta-add-prize]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      ruletaState.prizes.push({
        id: "", name: "Nuevo premio", description: "", icon: "🎁", color: "#ffd400",
        probability: 0, inventory: -1, dailyLimit: -1, weeklyLimit: -1, active: true,
        claimable: true, startDate: "", endDate: "", order: ruletaState.prizes.length,
      });
      renderRuletaPrizes();
    });
  }

  function initRuletaSave() {
    var btn = $("[data-ruleta-save-btn]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var statusEl = $("[data-ruleta-save-status]");
      if (statusEl) { statusEl.textContent = "Guardando…"; statusEl.className = "save-status"; }
      fetch(RULETA_API + "?action=admin-config", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruletaState)
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            if (statusEl) { statusEl.textContent = "Guardado ✓"; statusEl.className = "save-status is-ok"; }
            if (Math.abs((res.probabilitySum || 0) - 100) > 0.05) {
              alert("Ojo: las probabilidades de los premios activos suman " + res.probabilitySum + "%, no 100%. La ruleta las ajusta sola al girar, pero puede que el resultado no sea el que esperas — revisa los porcentajes.");
            }
          } else if (statusEl) {
            statusEl.textContent = (res && res.error) || "No se pudo guardar."; statusEl.className = "save-status is-error";
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.textContent = "No se pudo conectar con el servidor."; statusEl.className = "save-status is-error"; }
        });
    });
  }

  function initRuletaTab() {
    var tabBtn = $('[data-tab="ruleta"]');
    if (tabBtn) {
      tabBtn.addEventListener("click", function () {
        if (!ruletaLoaded) { ruletaLoaded = true; fetchRuletaAdmin(); }
      });
    }
    initRuletaAddPrize();
    initRuletaSave();
  }

  /* ==================== 🎁 Validar / Entregar premios (unificado) ====================
     Cubre TODOS los premios (cronómetro, fidelidad, reto, juego y Ruleta) —
     un solo lugar para buscar códigos, anular uno y ver las estadísticas
     completas. Vive en la pestaña "Premio del día". */
  var STATUS_LABEL = { available: "Disponible", waiting: "Esperando entrega", delivered: "Entregado", expired: "Vencido", void: "Anulado" };

  function fetchCodesStats() {
    var el = $("[data-codes-stats]");
    if (!el) return;
    fetch(CODES_API + "?action=admin-stats", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { el.innerHTML = '<p class="hint">No se pudieron cargar las estadísticas.</p>'; return; }
        var rows = [
          ["Total de códigos", res.total],
          ["Disponibles", res.byStatus.available], ["Esperando entrega", res.byStatus.waiting],
          ["Entregados", res.byStatus.delivered], ["Vencidos", res.byStatus.expired], ["Anulados", res.byStatus.void],
          ["Premio más entregado", res.mostDeliveredPrize || "—"],
        ];
        Object.keys(res.bySource || {}).forEach(function (src) {
          rows.push(["Emitidos por " + src, res.bySource[src]]);
        });
        el.innerHTML = rows.map(function (r) {
          return '<div class="ruleta-stat"><span class="ruleta-stat-value">' + escHTML(String(r[1])) + '</span><span class="ruleta-stat-label">' + r[0] + '</span></div>';
        }).join("");
      })
      .catch(function () { el.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>'; });
  }

  function initCodesSearch() {
    var btn = $("[data-codes-search-btn]");
    var input = $("[data-codes-search-input]");
    var statusFilter = $("[data-codes-status-filter]");
    var results = $("[data-codes-search-results]");
    if (!btn || !input || !results) return;

    function voidCode(code) {
      if (!confirm("¿Anular este código? Ya no se podrá reclamar ni entregar.")) return;
      fetch(CODES_API + "?action=admin-void", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) doSearch();
          else alert((res && res.error) || "No se pudo anular el código.");
        });
    }

    function doSearch() {
      var q = input.value.trim();
      var status = statusFilter ? statusFilter.value : "";
      if (!q && !status) { results.innerHTML = ""; return; }
      results.innerHTML = '<p class="hint">Buscando…</p>';
      var url = CODES_API + "?action=admin-search&q=" + encodeURIComponent(q) + "&status=" + encodeURIComponent(status);
      fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok || !res.results.length) { results.innerHTML = '<p class="hint">Sin resultados.</p>'; return; }
          results.innerHTML = res.results.map(function (r) {
            var d = new Date(r.issuedAt);
            var extra = "";
            if (r.status === "delivered") extra = ' · entregado por ' + escHTML(r.deliveredBy || "—") + ' el ' + new Date(r.deliveredAt).toLocaleString();
            var voidBtn = (r.status === "available" || r.status === "waiting")
              ? '<button type="button" class="btn btn-ghost codes-void-btn" data-code="' + escHTML(r.code) + '">Anular</button>'
              : "";
            return '<div class="ruleta-search-row-result">' +
              '<strong>' + escHTML(r.name || "—") + '</strong> — ' + escHTML(r.prizeName) + ' (' + escHTML(r.source) + ')' +
              ' — <code>' + escHTML(r.code) + '</code>' +
              '<br><span class="hint">' + d.toLocaleString() + ' · ' + (STATUS_LABEL[r.status] || r.status) + extra + '</span>' +
              voidBtn +
            '</div>';
          }).join("");
          $$(".codes-void-btn", results).forEach(function (b) {
            b.addEventListener("click", function () { voidCode(b.getAttribute("data-code")); });
          });
        })
        .catch(function () { results.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>'; });
    }
    btn.addEventListener("click", doSearch);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
    if (statusFilter) statusFilter.addEventListener("change", doSearch);
  }

  /* ---------------- save ---------------- */
  function initSave() {
    $("[data-save-btn]").addEventListener("click", function () {
      if (!state.content) return;
      setSaveStatus("Guardando…", "");
      fetch(API + "?action=save-content", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.content)
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            state.dirty = false;
            setSaveStatus("Guardado ✓ — ya está publicado en tu página", "is-ok");
          } else {
            setSaveStatus((res && res.error) || "No se pudo guardar.", "is-error");
          }
        })
        .catch(function () {
          setSaveStatus("No se pudo conectar con el servidor.", "is-error");
        });
    });

    window.addEventListener("beforeunload", function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    initTabs();
    initAuth();
    initAddImageList();
    initAddGallery();
    initStikerGalleryPanel();
    initGenerateQr();
    initAddRepeat();
    initImageRemove();
    initAudioRemove();
    initAiDoc();
    initBgTypeToggle();
    initLooks();
    initModalStyleToggle();
    initNameChangeModeToggle();
    initRewardTypeToggles();
    initRankingReset();
    initChallengeReset();
    initRuletaTab();
    initCodesSearch();
    initCarouselPreviewModal();
    initSave();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
