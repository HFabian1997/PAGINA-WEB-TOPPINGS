(function () {
  "use strict";

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

  var API = "../api/content.php";
  var PRIZE_API = "../api/premio.php";
  var RUN_API = "../api/run-leaderboard.php";
  var RULETA_API = "../api/ruleta.php";
  var CODES_API = "../api/codes.php";
  var LOYALTY_API = "../api/loyalty.php";
  var VOTES_API = "../api/votes.php";
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
  /**
   * Devuelve SIEMPRE una lista, aunque lo guardado no lo sea.
   *
   * Hace falta porque un campo puede cambiar de forma entre versiones: el
   * letrero grande del juego primero fue un campo de texto y después pasó a
   * ser una lista. A quien ya había guardado le quedaba un texto, y el
   * .forEach de más abajo reventaba — y al reventar se caía el pintado de
   * TODAS las listas, así que el panel decía "no se pudo cargar el
   * contenido" y no se podía editar nada, ni siquiera lo que sí estaba bien.
   *
   * Un texto que hubiera quedado guardado no se tira: pasa a ser el primer
   * elemento de la lista.
   */
  function listaSegura(container, clave) {
    var v = container[clave];
    if (Array.isArray(v)) return v;
    var texto = (typeof v === "string") ? v.trim() : "";
    container[clave] = texto ? [{ texto: texto }] : [];
    return container[clave];
  }

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

  /* ================= guardado automático =================
     No hay que darle a ningún botón: cualquier cambio se guarda solo poco
     después, y si se sale de la pestaña o le da atrás se manda de una.

     Cada "cual" es una de las tres cosas que se guardan por separado:
     el contenido general, la ruleta y los códigos. Cada una tiene su propio
     temporizador para que escribir en una no dispare el guardado de otra.

     Las funciones que de verdad guardan las registra cada sección con
     registrarGuardador(); acá solo se decide CUÁNDO. */
  var ESPERA_MS = 900;          // se espera a que deje de escribir
  var guardadores = {};         // cual -> function(motivo, cb)
  var timers = {};              // cual -> id de setTimeout
  var enVuelo = {};             // cual -> ¿hay un guardado andando?
  var vueltaPendiente = {};     // cual -> cambió algo mientras guardaba
  var huboFallo = false;        // el último intento no llegó al servidor

  function registrarGuardador(cual, fn) { guardadores[cual] = fn; }

  /* Los premios y códigos nuevos llevaban el id vacío y se lo ponía el
     servidor... en CADA guardado. Con el guardado automático eso sería un id
     distinto por tecla, y como los canjes se guardan por id, el historial y el
     conteo de usos se perderían. Ahora el id nace acá y no cambia más. */
  function nuevoId(prefijo) {
    return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function programarGuardado(cual) {
    if (!guardadores[cual]) return;
    chipEstado("escribiendo");
    if (timers[cual]) clearTimeout(timers[cual]);
    timers[cual] = setTimeout(function () {
      timers[cual] = null;
      guardarAhora(cual, "auto");
    }, ESPERA_MS);
  }

  function guardarAhora(cual, motivo) {
    var fn = guardadores[cual];
    if (!fn) return;
    if (timers[cual]) { clearTimeout(timers[cual]); timers[cual] = null; }
    // si ya hay uno andando, se anota para repetir al terminar en vez de
    // mandar dos a la vez y que el servidor los mezcle
    if (enVuelo[cual]) { vueltaPendiente[cual] = true; return; }

    enVuelo[cual] = true;
    chipEstado("guardando");
    fn(motivo, function (ok, mensaje) {
      enVuelo[cual] = false;
      if (ok === false) huboFallo = true;
      else if (ok === true) huboFallo = false;
      if (vueltaPendiente[cual]) {
        vueltaPendiente[cual] = false;
        guardarAhora(cual, "auto");
        return;
      }
      chipEstado(ok === false ? "error" : (ok === "omitido" ? "espera" : "guardado"), mensaje);
    });
  }

  /* Manda TODO lo que esté pendiente ya mismo. Se usa al salir de la página,
     al cambiar de pestaña y al minimizar: es lo que hace que "darle atrás"
     no pierda nada. */
  function guardarTodoPendiente(motivo) {
    Object.keys(guardadores).forEach(function (cual) {
      if (timers[cual] || vueltaPendiente[cual]) guardarAhora(cual, motivo || "salida");
    });
  }

  /* ---- el avisito flotante ---- */
  var chipEl = null, chipTimer = null;
  function chipEstado(estado, mensaje) {
    if (!chipEl) {
      chipEl = document.createElement("div");
      chipEl.className = "autosave-chip";
      chipEl.setAttribute("role", "status");
      document.body.appendChild(chipEl);
    }
    // la barra de abajo es fija y cambia de alto según se parta el texto en
    // pantallas angostas, así que se mide en vez de adivinar
    var barra = $(".admin-savebar");
    chipEl.style.bottom = ((barra ? barra.getBoundingClientRect().height : 60) + 12) + "px";
    var textos = {
      escribiendo: "✍️ Escribiendo…",
      guardando: "⏳ Guardando…",
      guardado: "✅ Guardado",
      espera: "⏸️ Sin guardar todavía",
      error: "⚠️ No se pudo guardar"
    };
    chipEl.textContent = mensaje || textos[estado] || "";
    chipEl.className = "autosave-chip is-" + estado + " is-visible";
    if (chipTimer) clearTimeout(chipTimer);
    // el "guardado" se va solo; los avisos que importan se quedan
    if (estado === "guardado") {
      chipTimer = setTimeout(function () { chipEl.classList.remove("is-visible"); }, 2200);
    }
  }

  function markDirty() {
    state.dirty = true;
    setSaveStatus("Cambios sin guardar", "");
    programarGuardado("contenido");
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
        // cambiar de pestaña cuenta como "ya terminé acá": lo pendiente se manda
        guardarTodoPendiente("cambio-pestaña");
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
          // el campo de horas solo aparece con el ranking personalizado
          if (input.getAttribute("data-field") === "rankingType") renderRankingHoursVisibility();
          markDirty();
        };
        if (input.getAttribute("data-field") === "rankingType") input.onchange = input.oninput;
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
    if (t === "daily") return "Diario";
    if (t === "hourly") return "Por horas";
    if (t === "custom") return "Personalizado";
    return "Semanal";
  }

  /* El campo de horas solo tiene sentido con el tipo personalizado. */
  function renderRankingHoursVisibility() {
    var sel = $('[data-field="rankingType"]');
    var campo = $("[data-ranking-hours]");
    if (!sel || !campo) return;
    campo.hidden = sel.value !== "custom";
  }

  /* ---------------- Puntajes del evento en curso ----------------
     Sirve para corregir un puntaje que quedó mal y para que Fabián se ponga a
     sí mismo en la tabla. El aviso de que eso le entrega el premio de verdad
     está escrito en el panel, no acá. */
  function renderRankingScores(scores) {
    var box = $("[data-ranking-scores]");
    if (!box) return;
    scores = scores || [];
    if (!scores.length) {
      box.innerHTML = '<p class="hint">Todavía nadie jugó en este evento.</p>';
      return;
    }
    box.innerHTML = scores.map(function (s, i) {
      return '<div class="ranking-score-row" data-device="' + escHTML(s.deviceId) + '">' +
        '<span class="ranking-score-rank">' + (i + 1) + "</span>" +
        '<span class="ranking-score-name">' + escHTML(s.name || "Sin nombre") + "</span>" +
        '<input type="number" min="0" class="ranking-score-input" data-ranking-score value="' + Number(s.score || 0) + '">' +
        '<button type="button" class="btn btn-ghost" data-ranking-save>Guardar</button>' +
      "</div>";
    }).join("");
  }

  function guardarPuntaje(deviceId, name, score, done) {
    fetch(RUN_API + "?action=admin-set-score", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId || "", name: name || "", score: Number(score) || 0 })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          renderRankingScores(res.scores);
          // el estado de arriba muestra al ganador parcial: hay que refrescarlo
          renderRankingStatus();
        } else {
          alert((res && res.error) || "No se pudo guardar el puntaje.");
        }
        if (done) done();
      })
      .catch(function () {
        alert("No se pudo conectar con el servidor.");
        if (done) done();
      });
  }

  function initRankingScores() {
    var box = $("[data-ranking-scores]");
    if (!box) return;

    box.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("[data-ranking-save]") : null;
      if (!btn) return;
      var fila = btn.closest("[data-device]");
      if (!fila) return;
      btn.disabled = true;
      guardarPuntaje(
        fila.getAttribute("data-device"),
        "",   // vacío = no se toca el nombre que ya tiene
        ($("[data-ranking-score]", fila) || {}).value,
        function () { btn.disabled = false; }
      );
    });

    var addBtn = $("[data-ranking-add]");
    if (addBtn) addBtn.addEventListener("click", function () {
      var nombreEl = $("[data-ranking-new-name]");
      var puntosEl = $("[data-ranking-new-score]");
      var nombre = (nombreEl.value || "").trim();
      if (!nombre) { alert("Escribe el nombre del jugador."); nombreEl.focus(); return; }
      addBtn.disabled = true;
      guardarPuntaje("", nombre, puntosEl.value, function () {
        addBtn.disabled = false;
        nombreEl.value = "";
        puntosEl.value = "";
      });
    });
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
        renderRankingScores(s.scores);

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

  /* ---------------- 🗳️ Votaciones ----------------
     Cada votación guarda adentro dónde aparece, así que acá no hay ninguna
     lista de "lugares posibles" cableada: se dibujan las casillas de las
     páginas que informe el servidor. */
  var votesPolls = [];
  var votesPaginas = ["inicio", "comidas", "helados", "bebidas", "secreta"];
  var VOTES_PAGINA_NOMBRE = {
    inicio: "Inicio", comidas: "Comidas", helados: "Helados",
    bebidas: "Bebidas", secreta: "Zona Secreta"
  };

  /* Los <input type="datetime-local"> hablan en texto local ("2026-08-20T18:00")
     y el servidor guarda milisegundos. Estas dos traducen, y devuelven vacío
     cuando no hay fecha — que es lo normal: una votación sin fechas se abre y
     se cierra a mano. */
  function voteMsAInput(ms) {
    if (!ms) return "";
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return "";
    function dos(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + dos(d.getMonth() + 1) + "-" + dos(d.getDate()) +
      "T" + dos(d.getHours()) + ":" + dos(d.getMinutes());
  }
  function voteInputAMs(txt) {
    txt = (txt || "").trim();
    if (!txt) return null;
    var t = new Date(txt).getTime();
    return isNaN(t) ? null : t;
  }

  function votePollVacia() {
    return {
      id: "", title: "", text: "", active: true,
      options: [{ id: "opt_1", name: "", image: null, note: "" },
                { id: "opt_2", name: "", image: null, note: "" }],
      rules: { repeat: "once", who: "name", results: "adminOnly", opensAt: null, closesAt: null },
      placement: { pages: { inicio: true }, menuPosition: {}, fab: {} }
    };
  }

  function voteOpcionHTML(o, i) {
    /* La ruta de la foto vive en el atributo de la fila, no en una variable
       aparte: así se puede reordenar o borrar opciones sin que las fotos se
       crucen entre sí. */
    return '<div class="vote-opt-row" data-vote-opt="' + i + '"' +
        (o.image ? ' data-vote-opt-image="' + escHTML(o.image) + '"' : "") + ">" +
      '<div class="vote-opt-thumb">' +
        (o.image ? '<img src="' + escHTML(adminAssetUrl(o.image)) + '" alt="">' : '<span>sin foto</span>') +
      "</div>" +
      '<div class="vote-opt-fields">' +
        '<input type="text" data-vote-opt-name placeholder="Nombre de la opción" value="' + escHTML(o.name || "") + '">' +
        '<input type="text" data-vote-opt-note placeholder="Descripción corta (opcional)" value="' + escHTML(o.note || "") + '">' +
      "</div>" +
      '<div class="vote-opt-actions">' +
        '<button type="button" class="btn btn-ghost" data-vote-opt-img title="Poner o cambiar la foto">📷</button>' +
        '<button type="button" class="btn btn-ghost" data-vote-opt-del title="Quitar esta opción">✕</button>' +
      "</div>" +
      (typeof o.votes === "number" ? '<div class="vote-opt-count">' + o.votes + " voto" + (o.votes === 1 ? "" : "s") + "</div>" : "") +
    "</div>";
  }

  function votePollHTML(p) {
    var abierta = p.open !== false;
    return '<details class="admin-collapsible vote-poll" data-vote-poll="' + escHTML(p.id) + '"' + (p.id ? "" : " open") + ">" +
      "<summary>" + escHTML(p.title || "Votación sin título") +
        ' <span class="vote-poll-tag">' + (p.active === false ? "apagada" : (abierta ? "abierta" : "cerrada")) +
        (typeof p.totalVotes === "number" ? " · " + p.totalVotes + " voto" + (p.totalVotes === 1 ? "" : "s") : "") +
      "</span></summary>" +

      '<label class="switch"><input type="checkbox" data-vote-active' + (p.active === false ? "" : " checked") + "> Votación encendida</label>" +
      '<label class="switch"><input type="checkbox" data-vote-collapsed' + (p.collapsed ? " checked" : "") + "> Empezar plegada (solo se ve el título y la flecha)</label>" +
      '<p class="hint">Aunque la dejes desplegada, a quien ya votó le aparece plegada: el bloque ya cumplió y no tiene por qué seguir ocupando media pantalla.</p>' +

      '<div class="field-grid">' +
        '<label class="full">Pregunta o título <input type="text" data-vote-title value="' + escHTML(p.title || "") + '"></label>' +
        '<label class="full">Texto de abajo <textarea data-vote-text rows="2">' + escHTML(p.text || "") + "</textarea></label>" +
      "</div>" +

      "<h4>Opciones</h4>" +
      '<p class="hint">Con foto se ven como tarjetas (para un concurso); sin foto, como botones de texto (para una encuesta).</p>' +
      '<div class="vote-opts" data-vote-opts>' + (p.options || []).map(voteOpcionHTML).join("") + "</div>" +
      '<button type="button" class="btn btn-ghost" data-vote-opt-add>+ Agregar opción</button>' +

      "<h4>Dónde aparece</h4>" +
      '<p class="hint">Puede estar en varias páginas a la vez. El voto es el mismo: si vota en una, queda votado en todas.</p>' +
      '<div class="vote-pages">' + votesPaginas.map(function (pag) {
        var on = p.placement && p.placement.pages && p.placement.pages[pag];
        return '<label class="switch"><input type="checkbox" data-vote-page="' + pag + '"' + (on ? " checked" : "") + "> " +
          escHTML(VOTES_PAGINA_NOMBRE[pag]) + "</label>";
      }).join("") + "</div>" +

      '<div class="field-grid">' +
        "<label>En el Inicio, ubicarla" +
          '<select data-vote-home-after>' +
            '<option value="start">Arriba del todo</option>' +
            '<option value="afterHero">Después de la portada</option>' +
            '<option value="afterPrizes">Después de las formas de ganar</option>' +
            '<option value="end">Al final</option>' +
          "</select></label>" +
        ["comidas", "helados", "bebidas"].map(function (pag) {
          var n = (p.placement && p.placement.menuPosition && p.placement.menuPosition[pag]) || 0;
          return "<label>En " + escHTML(VOTES_PAGINA_NOMBRE[pag]) + ", antes de la imagen n.º" +
            '<input type="number" min="0" data-vote-menu-pos="' + pag + '" value="' + n + '"></label>';
        }).join("") +
      "</div>" +
      '<p class="hint">En las páginas de menú, <strong>0</strong> la pone antes de la primera imagen, <strong>1</strong> después de la primera, y así. Es el mismo número que usa el carrusel de la categoría.</p>' +

      "<h4>Botón flotante 🗳️</h4>" +
      '<p class="hint">Una burbuja que lleva a la votación. Puede salir en páginas donde la votación <em>no</em> se muestra: ahí el botón lleva hasta la página donde sí está.</p>' +
      '<div class="vote-pages">' + votesPaginas.map(function (pag) {
        var on = p.placement && p.placement.fab && p.placement.fab[pag];
        return '<label class="switch"><input type="checkbox" data-vote-fab-page="' + pag + '"' + (on ? " checked" : "") + "> " +
          escHTML(VOTES_PAGINA_NOMBRE[pag]) + "</label>";
      }).join("") + "</div>" +
      '<div class="field-grid"><label class="full">Texto del globo del botón (si lo dejas vacío usa el título)' +
        '<input type="text" data-vote-fab-text value="' + escHTML((p.placement && p.placement.fabText) || "") + '"></label></div>' +

      "<h4>Reglas</h4>" +
      '<div class="field-grid">' +
        "<label>Cuántas veces puede votar cada persona" +
          '<select data-vote-repeat>' +
            '<option value="once">Una sola vez</option>' +
            '<option value="daily">Una vez por día</option>' +
            '<option value="changeable">Una, pero puede cambiarla</option>' +
          "</select></label>" +
        "<label>Quién puede votar" +
          '<select data-vote-who>' +
            '<option value="name">Cualquiera, pidiéndole el nombre</option>' +
            '<option value="anyone">Cualquiera, sin pedir nada</option>' +
            '<option value="qr">Solo quien escaneó el QR del local</option>' +
          "</select></label>" +
        "<label>Los resultados" +
          '<select data-vote-results>' +
            '<option value="adminOnly">Solo los ves vos</option>' +
            '<option value="public">A la vista de todos</option>' +
            '<option value="hidden">Ocultos hasta que cierre</option>' +
          "</select></label>" +
      "</div>" +

      '<div class="vote-poll-actions">' +
        '<button type="button" class="btn btn-primary" data-vote-save>Guardar votación</button>' +
        (p.id ? '<button type="button" class="btn btn-ghost" data-vote-reset>Borrar los votos</button>' +
                '<button type="button" class="btn btn-ghost" data-vote-del>Eliminar votación</button>' : "") +
      "</div>" +
    "</details>";
  }

  function renderVotes() {
    var box = $("[data-votes-list]");
    if (!box) return;
    if (!votesPolls.length) {
      box.innerHTML = '<p class="hint">Todavía no hay ninguna votación. Toca <strong>+ Nueva votación</strong> para crear la primera.</p>';
      return;
    }
    box.innerHTML = votesPolls.map(votePollHTML).join("");
    // los <select> no se pueden preseleccionar con innerHTML sin repetir el
    // atributo: se ponen acá, después de pintar
    votesPolls.forEach(function (p) {
      var el = $('[data-vote-poll="' + p.id + '"]', box);
      if (!el) return;
      var r = p.rules || {};
      var rep = $("[data-vote-repeat]", el); if (rep) rep.value = r.repeat || "once";
      var who = $("[data-vote-who]", el); if (who) who.value = r.who || "name";
      var res = $("[data-vote-results]", el); if (res) res.value = r.results || "adminOnly";
      var ha = $("[data-vote-home-after]", el);
      if (ha) ha.value = (p.placement && p.placement.homeAfter) || "afterPrizes";
    });
  }

  /** Lee del DOM la votación que está editando. */
  function voteLeerDelDOM(el, original) {
    var p = original ? JSON.parse(JSON.stringify(original)) : votePollVacia();
    p.title = ($("[data-vote-title]", el) || {}).value || "";
    p.text = ($("[data-vote-text]", el) || {}).value || "";
    p.active = !!($("[data-vote-active]", el) || {}).checked;
    p.collapsed = !!($("[data-vote-collapsed]", el) || {}).checked;

    p.options = $$("[data-vote-opt]", el).map(function (row, i) {
      var prev = (original && original.options && original.options[Number(row.getAttribute("data-vote-opt"))]) || {};
      return {
        id: prev.id || "opt_" + (i + 1) + "_" + Math.random().toString(36).slice(2, 6),
        name: ($("[data-vote-opt-name]", row) || {}).value || "",
        note: ($("[data-vote-opt-note]", row) || {}).value || "",
        // la del atributo manda: es la recién subida; si no hay, la de antes
        image: row.getAttribute("data-vote-opt-image") || prev.image || null
      };
    });

    var pages = {};
    $$("[data-vote-page]", el).forEach(function (c) { pages[c.getAttribute("data-vote-page")] = c.checked; });
    p.placement = p.placement || {};
    p.placement.pages = pages;

    var fab = {};
    $$("[data-vote-fab-page]", el).forEach(function (c) { fab[c.getAttribute("data-vote-fab-page")] = c.checked; });
    p.placement.fab = fab;
    p.placement.fabText = ($("[data-vote-fab-text]", el) || {}).value || "";
    p.placement.homeAfter = ($("[data-vote-home-after]", el) || {}).value || "afterPrizes";

    var pos = {};
    $$("[data-vote-menu-pos]", el).forEach(function (c) {
      pos[c.getAttribute("data-vote-menu-pos")] = Math.max(0, Number(c.value) || 0);
    });
    p.placement.menuPosition = pos;

    p.rules = p.rules || {};
    p.rules.repeat = ($("[data-vote-repeat]", el) || {}).value || "once";
    p.rules.who = ($("[data-vote-who]", el) || {}).value || "name";
    p.rules.results = ($("[data-vote-results]", el) || {}).value || "adminOnly";
    return p;
  }

  function votesPost(accion, cuerpo, done) {
    fetch(VOTES_API + "?action=" + accion, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo || {})
    }).then(function (r) { return r.json(); })
      .then(function (res) { done(res); })
      .catch(function () { done({ ok: false, error: "No se pudo conectar con el servidor." }); });
  }

  function cargarVotes(cb) {
    votesPost("admin-list", {}, function (res) {
      if (res && res.ok) {
        votesPolls = res.polls || [];
        if (res.pages && res.pages.length) votesPaginas = res.pages;
        renderVotes();
      } else {
        var box = $("[data-votes-list]");
        if (box) box.innerHTML = '<p class="hint">' + escHTML((res && res.error) || "No se pudo cargar.") + "</p>";
      }
      if (cb) cb();
    });
  }

  function initVotesTab() {
    var panel = $('[data-panel="votaciones"]');
    if (!panel) return;
    cargarVotes();

    var nueva = $("[data-vote-new]", panel);
    if (nueva) nueva.addEventListener("click", function () {
      votesPolls.push(votePollVacia());
      renderVotes();
    });

    var refrescar = $("[data-vote-refresh]", panel);
    if (refrescar) refrescar.addEventListener("click", function () { cargarVotes(); });

    panel.addEventListener("click", function (ev) {
      var el = ev.target.closest ? ev.target.closest("[data-vote-poll]") : null;
      var t = ev.target;

      if (t.closest && t.closest("[data-vote-opt-add]")) {
        var cont = $("[data-vote-opts]", el);
        var i = $$("[data-vote-opt]", cont).length;
        cont.insertAdjacentHTML("beforeend", voteOpcionHTML({ name: "", note: "", image: null }, i));
        return;
      }
      if (t.closest && t.closest("[data-vote-opt-del]")) {
        var fila = t.closest("[data-vote-opt]");
        if (fila && $$("[data-vote-opt]", el).length > 2) fila.remove();
        else alert("Una votación necesita al menos dos opciones.");
        return;
      }
      /* La foto se sube con el mismo camino que el resto de las imágenes del
         sitio (se convierte a WebP en el servidor). La ruta se guarda en el
         propio recuadro, así sobrevive a que se reordenen las opciones. */
      if (t.closest && t.closest("[data-vote-opt-img]")) {
        var filaImg = t.closest("[data-vote-opt]");
        var input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = function () {
          var f = input.files && input.files[0];
          if (!f) return;
          var thumb = $(".vote-opt-thumb", filaImg);
          if (thumb) thumb.innerHTML = "<span>subiendo…</span>";
          uploadImage(f, function (path) {
            if (!path) { if (thumb) thumb.innerHTML = "<span>sin foto</span>"; return; }
            filaImg.setAttribute("data-vote-opt-image", path);
            if (thumb) thumb.innerHTML = '<img src="' + escHTML(adminAssetUrl(path)) + '" alt="">';
          });
        };
        input.click();
        return;
      }
      if (!el) return;
      var id = el.getAttribute("data-vote-poll");
      var original = votesPolls.filter(function (p) { return p.id === id; })[0] || null;

      if (t.closest("[data-vote-save]")) {
        var poll = voteLeerDelDOM(el, original);
        if (!poll.title.trim()) { alert("Ponle un título a la votación."); return; }
        var conNombre = poll.options.filter(function (o) { return o.name.trim() || o.image; });
        if (conNombre.length < 2) { alert("Necesita al menos dos opciones con nombre."); return; }
        votesPost("admin-save", { poll: poll }, function (res) {
          if (res && res.ok) cargarVotes();
          else alert((res && res.error) || "No se pudo guardar.");
        });
        return;
      }
      if (t.closest("[data-vote-reset]")) {
        if (!confirm("¿Borrar todos los votos de esta votación? La votación queda, los votos no.")) return;
        votesPost("admin-reset", { pollId: id }, function (res) {
          if (res && res.ok) cargarVotes();
          else alert((res && res.error) || "No se pudo borrar los votos.");
        });
        return;
      }
      if (t.closest("[data-vote-del]")) {
        if (!confirm("¿Eliminar esta votación y sus votos? No se puede deshacer.")) return;
        votesPost("admin-delete", { pollId: id }, function (res) {
          if (res && res.ok) cargarVotes();
          else alert((res && res.error) || "No se pudo eliminar.");
        });
      }
    });
  }

  /* ---------------- Tarjeta de fidelidad: dar sellos a mano ----------------
     Existe porque el deviceId del cliente vive en su navegador: quien borra
     los datos entra como cliente nuevo aunque sus sellos sigan guardados en
     el servidor. Acá se los repone. También sirve para premiar sin escanear. */
  var loyaltyCards = [];

  function loyaltyFechaCorta(ms) {
    if (!ms) return "—";
    var d = new Date(Number(ms));
    return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  }

  function renderLoyaltyList() {
    var box = $("[data-loyalty-list]");
    if (!box) return;
    var q = (($("[data-loyalty-search]") || {}).value || "").trim().toLowerCase();
    var filas = loyaltyCards.filter(function (c) {
      if (!q) return true;
      return String(c.name || "").toLowerCase().indexOf(q) !== -1;
    });

    if (!filas.length) {
      box.innerHTML = '<p class="hint">' +
        (loyaltyCards.length ? "Ningún cliente coincide con esa búsqueda."
                             : "Todavía no hay clientes registrados. Aparecen acá en cuanto alguien escriba su nombre en el sitio.") + "</p>";
      return;
    }

    /* Con muchos clientes no se pintan todos de una: la lista se volvería
       una pared y el panel iría lento. Se muestran los primeros (que son los
       que tienen sellos y los que vinieron hace menos) y para el resto está
       el buscador. */
    var TOPE = 60;
    var recortada = filas.length > TOPE && !q;
    var aMostrar = recortada ? filas.slice(0, TOPE) : filas;

    box.innerHTML = (recortada
      ? '<p class="hint">Mostrando ' + TOPE + " de " + filas.length +
        " clientes. Busca por nombre para encontrar a alguien que no esté en la lista.</p>"
      : "") + aMostrar.map(function (c) {
      var espera = c.nextStampAt && c.nextStampAt > Date.now()
        ? ' · puede sellar el ' + escHTML(loyaltyFechaCorta(c.nextStampAt))
        : "";
      var llena = c.stamps >= c.required;
      return '<div class="loyalty-row' + (llena ? " is-full" : "") + '" data-device="' + escHTML(c.deviceId) + '">' +
        '<div class="loyalty-row-who">' +
          '<strong>' + escHTML(c.name || "Cliente sin nombre") + "</strong>" +
          '<span class="hint">' + c.stamps + " de " + c.required + " sellos" +
            (c.claims ? " · " + c.claims + " premio" + (c.claims === 1 ? "" : "s") + " reclamado" + (c.claims === 1 ? "" : "s") : "") +
            espera + "</span>" +
        "</div>" +
        '<div class="loyalty-row-actions">' +
          '<button type="button" class="btn btn-ghost" data-loyalty-give="-1" title="Quitar un sello">−</button>' +
          '<button type="button" class="btn btn-ghost" data-loyalty-give="1" title="Dar un sello">+</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  function cargarLoyaltyCards(cb) {
    var box = $("[data-loyalty-list]");
    fetch(LOYALTY_API + "?action=admin-list", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          loyaltyCards = res.cards || [];
          renderLoyaltyList();
        } else if (box) {
          box.innerHTML = '<p class="hint">' + escHTML((res && res.error) || "No se pudo cargar la lista.") + "</p>";
        }
        if (cb) cb();
      })
      .catch(function () {
        if (box) box.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>';
        if (cb) cb();
      });
  }

  function initLoyaltyAdmin() {
    var caja = $("[data-loyalty-admin]");
    if (!caja) return;

    cargarLoyaltyCards();

    var buscar = $("[data-loyalty-search]", caja);
    if (buscar) buscar.addEventListener("input", renderLoyaltyList);

    var refrescar = $("[data-loyalty-refresh]", caja);
    if (refrescar) refrescar.addEventListener("click", function () { cargarLoyaltyCards(); });

    // un solo listener para toda la lista: las filas se repintan al filtrar
    caja.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("[data-loyalty-give]") : null;
      if (!btn) return;
      var fila = btn.closest("[data-device]");
      if (!fila) return;
      var delta = Number(btn.getAttribute("data-loyalty-give")) || 0;
      if (!delta) return;
      btn.disabled = true;
      fetch(LOYALTY_API + "?action=admin-stamp", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDeviceId: fila.getAttribute("data-device"), delta: delta })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          if (res && res.ok) cargarLoyaltyCards();
          else alert((res && res.error) || "No se pudo cambiar los sellos.");
        })
        .catch(function () {
          btn.disabled = false;
          alert("No se pudo conectar con el servidor.");
        });
    });

    var reset = $("[data-loyalty-reset]", caja);
    if (reset) reset.addEventListener("click", function () {
      if (!confirm("¿Poner en cero los sellos de TODOS los clientes? No se puede deshacer.")) return;
      reset.disabled = true;
      fetch(LOYALTY_API + "?action=admin-reset", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: "{}"
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          reset.disabled = false;
          if (res && res.ok) cargarLoyaltyCards();
          else alert((res && res.error) || "No se pudo reiniciar.");
        })
        .catch(function () {
          reset.disabled = false;
          alert("No se pudo conectar con el servidor.");
        });
    });
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

  /* ==================== Bloques de la página de inicio ====================
     Una sola lista ordenada con las secciones fijas y las imágenes sueltas.
     Las secciones no se pueden borrar ni ocultar desde aquí (cada una tiene
     su propio interruptor en su pestaña); solo se mueven. */
  var HOME_SECTIONS = {
    hero:    { icon: "🏠", label: "Portada" },
    prizes:  { icon: "🎁", label: "Premio del día" },
    reviews: { icon: "⭐", label: "Nos importa lo que piensas" }
  };

  function homeBlocks() {
    var h = state.content.home || (state.content.home = {});
    if (!Array.isArray(h.blocks) || !h.blocks.length) {
      // primera vez: se arma con el orden que ya tiene la página
      h.blocks = [{ type: "hero" }, { type: "prizes" }, { type: "reviews" }];
    }
    // por si en el futuro se agrega una sección nueva al HTML: se añade al final
    Object.keys(HOME_SECTIONS).forEach(function (t) {
      var hay = h.blocks.some(function (b) { return b && b.type === t; });
      if (!hay) h.blocks.push({ type: t });
    });
    return h.blocks;
  }

  function renderHomeBlocks() {
    var list = $("[data-home-blocks]");
    if (!list) return;
    var blocks = homeBlocks();

    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        var arr = homeBlocks();
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        markDirty();
        renderHomeBlocks();
      });
    }

    list.innerHTML = "";
    blocks.forEach(function (b, idx) {
      var row = document.createElement("div");
      row.className = "home-block" + (b.hidden ? " is-off" : "");
      row.setAttribute("data-sort-item", "");

      var meta = HOME_SECTIONS[b.type];
      if (meta) {
        row.innerHTML =
          '<span class="home-block-icon">' + meta.icon + "</span>" +
          '<span class="home-block-label">' + meta.label + "</span>" +
          '<span class="home-block-tag">sección</span>' +
          '<span class="image-list-grip">⠿</span>';
      } else {
        row.innerHTML =
          '<img class="home-block-thumb" src="' + adminAssetUrl(b.src) + '" alt="">' +
          '<span class="home-block-label">Imagen</span>' +
          '<button type="button" class="home-block-hide" data-role="hide"></button>' +
          '<button type="button" class="home-block-replace" data-role="replace">🔄</button>' +
          '<input type="file" accept="image/*" hidden data-role="replace-input">' +
          '<span class="image-list-grip">⠿</span>' +
          '<button type="button" class="btn-remove" data-role="remove" aria-label="Eliminar">&times;</button>';

        var hideBtn = row.querySelector('[data-role="hide"]');
        hideBtn.textContent = b.hidden ? "🙈" : "👁️";
        hideBtn.title = b.hidden ? "Oculta — clic para mostrarla" : "Se muestra — clic para ocultarla";
        hideBtn.onclick = function () { b.hidden = !b.hidden; markDirty(); renderHomeBlocks(); };

        row.querySelector('[data-role="remove"]').onclick = function () {
          if (!confirm("¿Eliminar esta imagen del inicio?")) return;
          homeBlocks().splice(idx, 1);
          markDirty();
          renderHomeBlocks();
        };

        var repBtn = row.querySelector('[data-role="replace"]');
        var repInput = row.querySelector('[data-role="replace-input"]');
        repBtn.title = "Reemplazar la imagen sin moverla de lugar";
        repBtn.onclick = function () { repInput.click(); };
        repInput.onchange = function () {
          var file = repInput.files[0];
          if (!file) return;
          repBtn.disabled = true;
          uploadImage(file, function (rel) {
            repInput.value = "";
            if (!rel) { repBtn.disabled = false; return; }
            b.src = rel;
            markDirty();
            renderHomeBlocks();
          });
        };
      }
      list.appendChild(row);
    });
  }

  function initAddHomeImage() {
    var input = $("[data-add-home-image]");
    if (!input) return;
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) return;
      uploadImage(file, function (rel) {
        input.value = "";
        if (!rel) return;
        // entra antes de las reseñas, que es donde más se suele querer
        var arr = homeBlocks();
        var at = arr.length;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].type === "reviews") { at = i; break; }
        }
        arr.splice(at, 0, { type: "image", src: rel });
        markDirty();
        renderHomeBlocks();
      });
    });
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
      var items = listaSegura(container, arrKey);

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

        /* Subir una foto JUSTO DEBAJO de esta. El botón de "+ Agregar imagen"
           siempre la manda al final y después toca subirla a mano hasta su
           lugar; así entra derecho donde va. */
        var insertBtn = node.querySelector('[data-role="insert"]');
        var insertInput = node.querySelector('[data-role="insert-input"]');
        insertBtn.onclick = function () { insertInput.click(); };
        insertInput.onchange = function () {
          var file = insertInput.files[0];
          if (!file) return;
          insertBtn.disabled = true;
          insertBtn.textContent = "Subiendo…";
          uploadImage(file, function (rel) {
            insertInput.value = "";
            if (!rel) { insertBtn.disabled = false; insertBtn.textContent = "⬇️ Subir foto aquí debajo"; return; }
            items.splice(idx + 1, 0, rel);
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
        var items = listaSegura(container, arrKey);

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
      var items = listaSegura(container, arrKey);

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
        var items = listaSegura(container, arrKey);
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

  /* ---- De un carrusel por categoría a varios ----

     Antes cada categoría guardaba UN carrusel en `info.carousel`. Ahora
     guarda una lista en `info.carousels`.

     Lo que ya está guardado se convierte solo la primera vez que se lee: el
     carrusel suelto pasa a ser el primero de la lista. Así Fabián no pierde
     lo que tenía configurado y no hay que migrar el content.json a mano. */

  /** Le pone los valores que falten a un carrusel leído del disco.
   *  Vale la pena ser desconfiado acá: el panel ya se rompió entero una vez
   *  por hacerle .forEach a un campo que estaba guardado como texto. */
  function normalizarCarrusel(c) {
    if (!c || typeof c !== "object") c = {};
    for (var k in CAROUSEL_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(CAROUSEL_DEFAULTS, k) && c[k] === undefined) {
        c[k] = Array.isArray(CAROUSEL_DEFAULTS[k]) ? [] : CAROUSEL_DEFAULTS[k];
      }
    }
    if (!Array.isArray(c.images)) c.images = [];
    return c;
  }

  /** La lista de carruseles de una categoría, creándola si hace falta. */
  function carouselesDe(cat) {
    var info = state.content[cat] || (state.content[cat] = {});
    if (!Array.isArray(info.carousels)) {
      // formato viejo: el carrusel suelto pasa a ser el primero
      info.carousels = (info.carousel && typeof info.carousel === "object")
        ? [info.carousel] : [];
      delete info.carousel;
    }
    /* Se normaliza EN EL MISMO array, sin reemplazarlo.

       Antes esto hacía `info.carousels = info.carousels.map(...)`, que crea
       un array nuevo cada vez. Como dibujar cada bloque vuelve a llamar acá,
       la lista que había capturado el botón "Agregar" quedaba apuntando al
       array viejo: el push iba a uno que ya nadie miraba, y agregar no hacía
       nada. Guardar la identidad del array es lo que lo arregla. */
    for (var i = 0; i < info.carousels.length; i++) {
      info.carousels[i] = normalizarCarrusel(info.carousels[i]);
    }
    return info.carousels;
  }

  /** El carrusel número `idx` de una categoría, creándolo si hace falta. */
  function carouselOf(cat, idx) {
    var lista = carouselesDe(cat);
    idx = idx || 0;
    while (lista.length <= idx) lista.push(normalizarCarrusel({}));
    return lista[idx];
  }

  function renderCarouselAdmins() {
    $$("[data-carousel-admin]").forEach(function (host) {
      renderListaCarruseles(host, host.getAttribute("data-carousel-admin"));
    });
  }

  /** La categoría entera: un bloque plegable por carrusel, más el botón de
   *  agregar. Cada bloque se dibuja en su propio contenedor para que los
   *  campos de uno no se mezclen con los del otro. */
  function renderListaCarruseles(host, cat) {
    var lista = carouselesDe(cat);
    host.innerHTML = "";

    if (!lista.length) {
      var vacio = document.createElement("p");
      vacio.className = "hint";
      vacio.textContent = "Todavía no hay ningún carrusel en esta página.";
      host.appendChild(vacio);
    }

    lista.forEach(function (c, idx) {
      var caja = document.createElement("div");
      caja.className = "cc-bloque";

      var cabecera = document.createElement("div");
      cabecera.className = "cc-bloque-cab";
      var titulo = document.createElement("strong");
      titulo.textContent = "Carrusel " + (idx + 1) +
        (c.active ? "" : "  ·  apagado") +
        "  ·  " + (c.images || []).length + ((c.images || []).length === 1 ? " imagen" : " imágenes");
      cabecera.appendChild(titulo);

      var borrar = document.createElement("button");
      borrar.type = "button";
      borrar.className = "btn btn-ghost cc-borrar";
      borrar.textContent = "Quitar";
      borrar.onclick = function () {
        if (!confirm("¿Quitar el carrusel " + (idx + 1) + " de esta página? Se pierden sus imágenes y su configuración.")) return;
        lista.splice(idx, 1);
        markDirty();
        renderListaCarruseles(host, cat);
      };
      cabecera.appendChild(borrar);
      caja.appendChild(cabecera);

      var cuerpo = document.createElement("div");
      caja.appendChild(cuerpo);
      host.appendChild(caja);
      renderCarouselAdmin(cuerpo, cat, idx);
    });

    var agregar = document.createElement("button");
    agregar.type = "button";
    agregar.className = "btn btn-primary";
    agregar.textContent = "+ Agregar otro carrusel a esta página";
    agregar.onclick = function () {
      var nuevo = normalizarCarrusel({});
      nuevo.active = true;
      /* Al final del menú: es donde menos estorba y donde se ve enseguida
         que se agregó, en vez de aparecer entre medio sin avisar. */
      nuevo.position = ((state.content[cat] && state.content[cat].images) || []).length;
      lista.push(nuevo);
      markDirty();
      renderListaCarruseles(host, cat);
    };
    host.appendChild(agregar);
  }

  function renderCarouselAdmin(host, cat, idx) {
    idx = idx || 0;
    var c = carouselOf(cat, idx);
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
        renderCarouselAdmin(host, cat, idx);
      });
    };

    $("[data-cc-preview]", host).onclick = function () { openCarouselPreview(cat, idx); };
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
        var cfg = carouselOf(cat, idx);
        cfg.images.splice(to, 0, cfg.images.splice(from, 1)[0]);
        markDirty();
        renderCarouselAdmin(host, cat, idx);
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
      onBox.onchange = function () { item.active = onBox.checked; markDirty(); renderCarouselAdmin(host, cat, idx); };

      var up = row.querySelector('[data-role="up"]');
      var down = row.querySelector('[data-role="down"]');
      up.disabled = idx === 0;
      down.disabled = idx === c.images.length - 1;
      up.onclick = function () { c.images.splice(idx - 1, 0, c.images.splice(idx, 1)[0]); markDirty(); renderCarouselAdmin(host, cat, idx); };
      down.onclick = function () { c.images.splice(idx + 1, 0, c.images.splice(idx, 1)[0]); markDirty(); renderCarouselAdmin(host, cat, idx); };
      row.querySelector('[data-role="remove"]').onclick = function () {
        if (!confirm("¿Quitar esta imagen del carrusel?")) return;
        c.images.splice(idx, 1); markDirty(); renderCarouselAdmin(host, cat, idx);
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
      up.onclick = function () { c.position = Math.max(0, c.position - 1); markDirty(); renderCarouselAdmin(host, cat, idx); };
      down.onclick = function () { c.position = Math.min(total, c.position + 1); markDirty(); renderCarouselAdmin(host, cat, idx); };
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
        renderCarouselAdmin(host, cat, idx);
      });
    }
    return row;
  }

  /* Vista previa: usa EXACTAMENTE el mismo carrusel que ve el cliente
     (lib/cat-carousel.js), así lo que se ve aquí es lo que se publicará. */
  function openCarouselPreview(cat, idx) {
    var c = carouselOf(cat, idx || 0);
    var modal = $("[data-cc-preview-modal]");
    var body = $("[data-cc-preview-body]", modal);
    var prev = $(".cat-carousel", body);
    if (prev && window.__catCarousel) window.__catCarousel.destroy(prev);
    body.innerHTML = "";

    var usable = window.__catCarousel && window.__catCarousel.usable ? window.__catCarousel.usable(c) : window.__catCarousel.activeConfig({ carousel: c });
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

  /* ==================== ⏱️ Cronómetro: los dos modos ====================
     El selector solo muestra los campos del modo elegido; la configuración del
     otro sigue guardada en content.json intacta, así que alternar no borra nada. */
  var STOPTIME_API = "../api/stoptime.php";

  function stopTimeCfg() {
    if (!state.content) return {};
    var c = state.content.dailyPrize && state.content.dailyPrize.cronometro;
    if (!c) return {};
    if (!c.stopTime || typeof c.stopTime !== "object") c.stopTime = {};
    return c.stopTime;
  }

  function renderCronoModeVisibility() {
    var select = $("[data-crono-mode-select]");
    if (!select) return;
    var modo = select.value === "stopTime" ? "stopTime" : "countdown";
    $$("[data-crono-mode]").forEach(function (el) {
      el.hidden = el.getAttribute("data-crono-mode") !== modo;
    });
  }

  /* Los campos "cada cuánto" solo aparecen si eligió reinicio por intervalo. */
  function renderAttemptsResetVisibility() {
    var select = $("[data-attempts-reset-select]");
    if (!select) return;
    $$("[data-attempts-reset-field]").forEach(function (el) {
      el.hidden = el.getAttribute("data-attempts-reset-field") !== select.value;
    });
  }

  function initAttemptsResetToggle() {
    var select = $("[data-attempts-reset-select]");
    if (select) select.addEventListener("change", renderAttemptsResetVisibility);
  }

  /* El tiempo ganador se guarda en milisegundos (uno solo), pero se edita en
     tres casillas (min : seg . centésimas) porque escribir "10000" para decir
     10 segundos no se entiende. */
  function renderStopTimeTarget() {
    var cfg = stopTimeCfg();
    var ms = Number(cfg.targetMs) > 0 ? Number(cfg.targetMs) : 10000;
    var cent = Math.floor((ms % 1000) / 10);
    var totalSeg = Math.floor(ms / 1000);
    var partes = { min: Math.floor(totalSeg / 60), sec: totalSeg % 60, cent: cent };
    $$("[data-stoptime-part]").forEach(function (input) {
      input.value = partes[input.getAttribute("data-stoptime-part")];
      input.oninput = function () {
        var vals = {};
        $$("[data-stoptime-part]").forEach(function (i2) {
          vals[i2.getAttribute("data-stoptime-part")] = Math.max(0, Number(i2.value) || 0);
        });
        stopTimeCfg().targetMs = (vals.min * 60000) + (vals.sec * 1000) + (vals.cent * 10);
        markDirty();
      };
    });
  }

  /* Las fechas se guardan como texto "YYYY-MM-DDTHH:MM" (lo que da el campo del
     navegador) y el servidor las lee con strtotime — así el admin escribe en su
     hora local, que es la del negocio. */
  function renderStopTimeDates() {
    $$("[data-stoptime-date]").forEach(function (input) {
      var key = input.getAttribute("data-stoptime-date");
      input.value = stopTimeCfg()[key] || "";
      input.oninput = function () {
        stopTimeCfg()[key] = input.value || "";
        markDirty();
      };
    });
  }

  function stopTimeSecret() {
    return ((state.content && state.content.business && state.content.business.adminSecret) || "").trim();
  }

  function fetchStopTimeRound() {
    var box = $("[data-stoptime-round]");
    var log = $("[data-stoptime-log]");
    if (!box) return;
    var secret = stopTimeSecret();
    if (!secret) {
      box.innerHTML = '<p class="hint">Primero escribí una "Clave de administrador" en la pestaña Negocio.</p>';
      return;
    }
    box.innerHTML = '<p class="hint">Consultando…</p>';
    fetch(STOPTIME_API + "?action=admin-status&secret=" + encodeURIComponent(secret) + "&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) {
          box.innerHTML = '<p class="hint">' + escHTML((res && res.error) || "No se pudo consultar el estado.") + "</p>";
          if (log) log.innerHTML = "";
          return;
        }
        var periodo = { daily: "hoy", interval: "en este periodo", manual: "desde el último reinicio" }[res.attemptsReset] || "en este periodo";
        var filas = [
          ["Disponible ahora", res.inWindow ? "Sí" : "No"],
          ["Participantes " + periodo, res.participants],
          ["Intentos " + periodo, res.attempts],
          ["Ganadores " + periodo, res.winners + (res.maxWinners > 0 ? " de " + res.maxWinners : "")]
        ];
        box.innerHTML = filas.map(function (f) {
          return '<div class="ruleta-stat"><span class="ruleta-stat-value">' + escHTML(String(f[1])) +
            '</span><span class="ruleta-stat-label">' + f[0] + "</span></div>";
        }).join("");

        if (log) {
          if (!res.log.length) {
            log.innerHTML = '<p class="hint">Todavía nadie ha jugado en este periodo.</p>';
          } else {
            log.innerHTML = res.log.map(function (a) {
              var cuando = a.startedAt ? new Date(a.startedAt).toLocaleString() : "—";
              var tiempo = a.elapsedMs != null ? (a.elapsedMs / 1000).toFixed(2) + " s" : "sin detener";
              var marca = a.won ? "🏆 ganó" : (a.rejected ? "⚠️ tiempo no válido" : "❌ falló");
              var premio = a.prizeStatus ? " · premio " + a.prizeStatus : "";
              return '<p class="hint stoptime-log-row"><strong>' + escHTML(a.name) + "</strong> — " +
                escHTML(tiempo) + " — " + marca + escHTML(premio) + " · " + escHTML(cuando) + "</p>";
            }).join("");
          }
        }
      })
      .catch(function () {
        box.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>';
      });
  }

  function initStopTimeRound() {
    $$("[data-stoptime-op]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var secret = stopTimeSecret();
        if (!secret) { alert('Primero escribí una "Clave de administrador" en la pestaña Negocio.'); return; }
        if (!confirm("¿Reiniciar participantes? Se borran los intentos y todos pueden volver a jugar de inmediato, sin esperar a que se cumpla el tiempo.")) return;
        btn.disabled = true;
        fetch(STOPTIME_API + "?action=admin-reset", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "admin-reset", secret: secret })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            btn.disabled = false;
            if (res && res.ok) fetchStopTimeRound();
            else alert((res && res.error) || "No se pudo reiniciar.");
          })
          .catch(function () { btn.disabled = false; alert("No se pudo conectar con el servidor."); });
      });
    });

    var refresh = $("[data-stoptime-refresh]");
    if (refresh) refresh.addEventListener("click", fetchStopTimeRound);

    var select = $("[data-crono-mode-select]");
    if (select) {
      select.addEventListener("change", function () {
        renderCronoModeVisibility();
        if (select.value === "stopTime") fetchStopTimeRound();
      });
    }
  }

  /* Reiniciar la cuenta regresiva del Modo 1. */
  function initCronoReset() {
    var btn = $("[data-crono-reset]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var secret = stopTimeSecret();
      if (!secret) { alert('Primero escribí una "Clave de administrador" en la pestaña Negocio.'); return; }
      if (!confirm("¿Reiniciar el temporizador? Se borra el ganador de hoy y la cuenta vuelve a arrancar desde ahora.")) return;
      btn.disabled = true;
      fetch(PRIZE_API, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin-reset-cronometro", secret: secret })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          if (res && res.ok) alert("Temporizador reiniciado.");
          else alert((res && res.error) || "No se pudo reiniciar el temporizador.");
        })
        .catch(function () { btn.disabled = false; alert("No se pudo conectar con el servidor."); });
    });
  }

  /* ---------------- orden de las formas de ganar (Premio del día) ----------------
     Mismo patrón que los bloques del inicio: una lista arrastrable desde el asa
     ⠿ (pointer events, no arrastre nativo, que en táctil no existe). Las claves
     que falten se agregan al final, así nunca desaparece una forma de ganar. */
  var PRIZE_METHOD_META = {
    cronometro: { icon: "⏱️", label: "Cronómetro" },
    loyalty: { icon: "🎟️", label: "Tarjeta de fidelidad" },
    challenge: { icon: "🎯", label: "Reto del día" },
    toppingsRun: { icon: "🎮", label: "TOPPINGS RUN" }
  };

  function prizeMethodOrder() {
    // state.content es null hasta que se inicia sesión y llega el contenido
    if (!state.content) return [];
    var dp = state.content.dailyPrize || (state.content.dailyPrize = {});
    if (!Array.isArray(dp.methodOrder)) dp.methodOrder = [];
    // se limpia lo que no exista y se completa con lo que falte, en el orden
    // en que están declaradas arriba
    dp.methodOrder = dp.methodOrder.filter(function (k, i) {
      return PRIZE_METHOD_META[k] && dp.methodOrder.indexOf(k) === i;
    });
    Object.keys(PRIZE_METHOD_META).forEach(function (k) {
      if (dp.methodOrder.indexOf(k) === -1) dp.methodOrder.push(k);
    });
    return dp.methodOrder;
  }

  var prizeRowsOpen = {};   // qué filas dejó abiertas, para no cerrárselas al repintar

  function renderPrizeMethodOrder() {
    var list = $("[data-prize-method-order]");
    if (!list) return;
    var order = prizeMethodOrder();
    var dp = (state.content && state.content.dailyPrize) || {};

    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        var arr = prizeMethodOrder();
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        markDirty();
        renderPrizeMethodOrder();
      });
    }

    /* Antes de vaciar la lista hay que SACAR las secciones de configuración,
       o `innerHTML = ""` las destruiría junto con sus campos ya enlazados.
       Se guardan en un cajón oculto y se vuelven a meter en la fila que toca.
       Mover un nodo no rompe nada: renderForms() los enlazó por
       data-form/data-field y esas referencias sobreviven al cambio de padre. */
    var cajon = $("[data-prize-config-stash]");
    $$("[data-prize-config]").forEach(function (sec) {
      if (cajon) cajon.appendChild(sec);
    });

    list.innerHTML = "";
    order.forEach(function (key) {
      var meta = PRIZE_METHOD_META[key];
      var activa = !!(dp[key] && dp[key].active);

      var row = document.createElement("div");
      row.className = "prize-method-row" + (activa ? "" : " is-off");
      row.setAttribute("data-sort-item", "");
      row.innerHTML =
        '<div class="pm-head">' +
          '<span class="image-list-grip">⠿</span>' +
          '<button type="button" class="pm-toggle" data-pm-toggle>' +
            '<span class="pm-icon">' + meta.icon + "</span>" +
            '<span class="pm-name">' + escHTML(meta.label) + "</span>" +
            '<span class="pm-tag">' + (activa ? "activa" : "desactivada") + "</span>" +
            '<span class="pm-caret">▸</span>' +
          "</button>" +
          '<button type="button" class="pm-active" data-pm-active title="Activar / desactivar">' +
            (activa ? "✅" : "🚫") + "</button>" +
        "</div>" +
        '<div class="pm-body" hidden></div>';

      var body = row.querySelector(".pm-body");
      var caret = row.querySelector(".pm-caret");
      var seccion = cajon ? cajon.querySelector('[data-prize-config="' + key + '"]') : null;
      if (seccion) {
        seccion.open = true;              // la fila ya hace de plegable
        body.appendChild(seccion);
      }

      /* Se recuerda cuáles estaban abiertas: tocar el interruptor repinta la
         lista, y sin esto se le cerraría en la cara la sección que está
         editando. */
      var abierta = prizeRowsOpen[key];
      body.hidden = !abierta;
      caret.textContent = abierta ? "▾" : "▸";
      row.classList.toggle("is-open", !!abierta);

      row.querySelector("[data-pm-toggle]").onclick = function () {
        body.hidden = !body.hidden;
        prizeRowsOpen[key] = !body.hidden;
        caret.textContent = body.hidden ? "▸" : "▾";
        row.classList.toggle("is-open", !body.hidden);
      };

      /* El interruptor de la cabecera y el de adentro son EL MISMO dato: acá
         solo se dispara el de adentro, para no tener dos fuentes que se
         puedan contradecir. */
      row.querySelector("[data-pm-active]").onclick = function () {
        var sw = $('[data-field="dailyPrize.' + key + '.active"]');
        if (!sw) return;
        sw.checked = !sw.checked;
        sw.dispatchEvent(new Event("input", { bubbles: true }));
        sw.dispatchEvent(new Event("change", { bubbles: true }));
      };

      list.appendChild(row);
    });
  }

  /* La etiqueta y el ✅/🚫 de cada fila siguen al interruptor de esa forma de
     ganar, que ahora vive dentro de la misma fila. Se engancha por delegación
     porque las secciones cambian de lugar en cada repintado. */
  function initPrizeMethodOrder() {
    var panel = $('[data-panel="premio"]');
    if (!panel) return;
    panel.addEventListener("change", function (e) {
      var f = e.target && e.target.getAttribute && e.target.getAttribute("data-field");
      if (!f) return;
      var m = f.match(/^dailyPrize\.(\w+)\.active$/);
      if (m && PRIZE_METHOD_META[m[1]]) renderPrizeMethodOrder();
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
    renderFlotantes();
    renderLockedList();
    renderLockedWinners();
    renderHomeBlocks();
    renderPrizeMethodOrder();
    renderCronoModeVisibility();
    renderStopTimeTarget();
    renderStopTimeDates();
    renderAttemptsResetVisibility();
    renderChallengeTypeVisibility();
    renderBgTypeVisibility();
    renderModalStyleVisibility();
    renderNameChangeModeVisibility();
    renderRankingStatus();
    renderRankingHoursVisibility();
    renderAllRewardTypeVisibility();
    fetchCodesStats();
    renderChallengeStatus();
    /* Los premios de la ruleta y los códigos se cargan al ENTRAR al panel, no
       al abrir su pestaña: así el botón de guardar nunca puede mandar una
       lista vacía por no haberla mirado todavía, que fue como se borraron. */
    fetchRuletaAdmin();
    fetchRedeemAdmin();
    fetchLockedAdmin();
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

  /* Tipo de reto: se muestran solo los campos de la modalidad elegida. Los de
     la otra quedan guardados intactos, así cambiar de tipo y volver no pierde
     nada de lo que ya estaba escrito. */
  function renderChallengeTypeVisibility() {
    var select = $("[data-challenge-type-select]");
    if (!select) return;
    var ch = (state.content.dailyPrize && state.content.dailyPrize.challenge) || {};
    var tipo = ch.challengeType === "link" ? "link" : "photo";
    $$("[data-challenge-mode]").forEach(function (el) {
      el.hidden = el.getAttribute("data-challenge-mode") !== tipo;
    });
  }

  function initChallengeTypeToggle() {
    var select = $("[data-challenge-type-select]");
    if (!select) return;
    select.addEventListener("change", renderChallengeTypeVisibility);
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
  var ruletaState = { active: false, title: "RULETA TOPPINGS", winTitle: "¡GANASTE!", loseTitle: "¡QUÉ MALA SUERTE!", whatsappNumber: "", soundEnabled: true, confettiEnabled: true, prizeExpiryHours: 24, prizes: [] };
  var ruletaLoaded = false;        // ¿el servidor llegó a darnos los premios?
  var ruletaServerCount = 0;       // cuántos había, para avisar antes de vaciarlos

  function fetchRuletaAdmin() {
    fetch(RULETA_API + "?action=admin-status", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) return;
        ruletaState.active = res.active;
        ruletaState.title = res.title;
        ruletaState.winTitle = res.winTitle || "¡GANASTE!";
        ruletaState.loseTitle = res.loseTitle || "¡QUÉ MALA SUERTE!";
        ruletaState.whatsappNumber = res.whatsappNumber;
        ruletaState.soundEnabled = res.soundEnabled;
        ruletaState.confettiEnabled = res.confettiEnabled;
        ruletaState.prizeExpiryHours = res.prizeExpiryHours || 24;
        ruletaState.prizes = res.prizes || [];
        // igual que en los códigos: la bandera se marca al recibir la
        // respuesta buena, no al pedirla
        ruletaLoaded = true;
        ruletaServerCount = ruletaState.prizes.length;
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
        programarGuardado("ruleta");
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

  /* Cada premio es una fila plegada: ícono, nombre y probabilidad a la vista,
     y los campos solo cuando se abre. Con 8 premios abiertos a la vez eran
     más de cien campos en pantalla y había que deslizar sin parar.

     El ORDEN de la lista es el orden real de la rueda: se cambia arrastrando,
     por eso ya no existe el campo "Orden". */
  function buildRuletaPrizeRow(p, idx) {
    var row = document.createElement("div");
    row.className = "ruleta-prize-row" + (p.active === false ? " is-off" : "");
    row.innerHTML =
      '<div class="rp-head">' +
        '<span class="image-list-grip">⠿</span>' +
        '<button type="button" class="rp-toggle" data-rp-toggle>' +
          '<span class="rp-icon">' + escHTML(p.icon || "🎁") + "</span>" +
          '<span class="rp-name">' + escHTML(p.name || "(sin nombre)") + "</span>" +
          (p.claimable ? "" : '<span class="rp-tag">sigue intentando</span>') +
          '<span class="rp-prob">' + (Number(p.probability) || 0) + "%</span>" +
          '<span class="rp-caret">▸</span>' +
        "</button>" +
        '<button type="button" class="rp-active" data-rp-active title="Activo / desactivado"></button>' +
        '<button type="button" class="rp-remove" data-rp-remove title="Quitar este premio" aria-label="Quitar este premio">✕</button>' +
      "</div>" +
      '<div class="rp-body" hidden>' +
        '<div class="ruleta-prize-grid">' +
          '<label class="full">Nombre <input type="text" data-p="name"></label>' +
          '<label>Ícono <input type="text" data-p="icon" maxlength="4"></label>' +
          '<label>Color en la rueda <input type="color" data-p="color"></label>' +
          '<label>Probabilidad % <input type="number" min="0" max="100" step="0.1" data-p="probability"></label>' +
          '<label>Límite diario (-1 = sin límite) <input type="number" data-p="dailyLimit"></label>' +
        "</div>" +
        '<label class="switch-inline"><input type="checkbox" data-p="claimable"> Es un premio de verdad (si lo apagas, es tipo "sigue intentando")</label>' +
      "</div>";

    var body = row.querySelector(".rp-body");
    var caret = row.querySelector(".rp-caret");
    row.querySelector("[data-rp-toggle]").onclick = function () {
      body.hidden = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      row.classList.toggle("is-open", !body.hidden);
    };

    var activeBtn = row.querySelector("[data-rp-active]");
    function paintActive() { activeBtn.textContent = p.active === false ? "🚫" : "✅"; }
    paintActive();
    activeBtn.onclick = function () {
      p.active = p.active === false;
      paintActive();
      row.classList.toggle("is-off", p.active === false);
      renderRuletaProbSum();
      programarGuardado("ruleta");
    };

    $$("[data-p]", row).forEach(function (input) {
      var key = input.getAttribute("data-p");
      var val = p[key];
      if (input.type === "checkbox") input.checked = !!val;
      else input.value = val == null ? "" : val;
      input.oninput = function () {
        p[key] = input.type === "checkbox" ? input.checked : (input.type === "number" ? Number(input.value) : input.value);
        if (key === "probability" || key === "name" || key === "icon" || key === "claimable") {
          // la cabecera muestra estos datos: se refresca sin cerrar la fila
          var h = row.querySelector(".rp-icon"); if (h) h.textContent = p.icon || "🎁";
          var n = row.querySelector(".rp-name"); if (n) n.textContent = p.name || "(sin nombre)";
          var pr = row.querySelector(".rp-prob"); if (pr) pr.textContent = (Number(p.probability) || 0) + "%";
          var tag = row.querySelector(".rp-tag");
          if (!p.claimable && !tag) {
            tag = document.createElement("span");
            tag.className = "rp-tag";
            tag.textContent = "sigue intentando";
            row.querySelector(".rp-prob").insertAdjacentElement("beforebegin", tag);
          } else if (p.claimable && tag) { tag.remove(); }
        }
        if (key === "probability") renderRuletaProbSum();
        programarGuardado("ruleta");
      };
    });

    row.querySelector("[data-rp-remove]").addEventListener("click", function () {
      if (!confirm("¿Quitar este premio de la ruleta?")) return;
      ruletaState.prizes.splice(idx, 1);
      renderRuletaPrizes();
      programarGuardado("ruleta");
    });
    return row;
  }

  function renderRuletaPrizes() {
    var list = $("[data-ruleta-prizes-list]");
    if (!list) return;

    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        // la ruleta tiene su propio estado y su propio guardado, aparte del
        // contenido general
        var arr = ruletaState.prizes;
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        renderRuletaPrizes();
        programarGuardado("ruleta");
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
        id: nuevoId("prz_"), name: "Nuevo premio", icon: "🎁", color: "#ffd400",
        probability: 0, dailyLimit: -1, active: true, claimable: true
      });
      renderRuletaPrizes();
      // se abre el último para escribirlo de una, sin tener que buscarlo
      var filas = $$("[data-ruleta-prizes-list] .ruleta-prize-row");
      var ultima = filas[filas.length - 1];
      if (ultima) {
        ultima.querySelector("[data-rp-toggle]").click();
        ultima.scrollIntoView({ block: "center" });
        var nombre = ultima.querySelector('[data-p="name"]');
        if (nombre) { nombre.focus(); nombre.select(); }
      }
      programarGuardado("ruleta");
    });
  }

  function initRuletaSave() {
    /* forzado = lo pidió el botón a mano; auto = lo disparó un cambio.
       La diferencia importa en un solo caso: dejar la ruleta sin premios.
       Eso sola no se guarda nunca — hay que pedirlo con el botón y confirmar. */
    registrarGuardador("ruleta", function (motivo, listo) {
      var statusEl = $("[data-ruleta-save-status]");
      var forzado = motivo === "boton";

      /* Guardar reemplaza TODOS los premios de la ruleta. Si nunca llegamos a
         cargarlos, mandarlos sería borrarlos. */
      if (!ruletaLoaded) {
        if (statusEl) {
          statusEl.textContent = "Todavía no se cargó la ruleta. Recargá la página antes de guardar.";
          statusEl.className = "save-status is-error";
        }
        fetchRuletaAdmin();
        listo(false, "⚠️ La ruleta no cargó — recargá");
        return;
      }
      if (!ruletaState.prizes.length && ruletaServerCount > 0) {
        if (!forzado) {
          // vaciar la lista entera no se hace solo: se avisa y se espera
          if (statusEl) {
            statusEl.textContent = "Quitaste todos los premios. Dale al botón de guardar para confirmarlo.";
            statusEl.className = "save-status is-error";
          }
          listo("omitido", "⏸️ Quitaste todo — confirmá con el botón");
          return;
        }
        if (!confirm("Vas a dejar la ruleta sin ningún premio. Se van a borrar los " +
            ruletaServerCount + " que hay guardados. ¿Seguro?")) { listo("omitido"); return; }
      }

      if (statusEl) { statusEl.textContent = "Guardando…"; statusEl.className = "save-status"; }
      fetch(RULETA_API + "?action=admin-config", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruletaState),
        keepalive: motivo === "salida"
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            if (statusEl) { statusEl.textContent = "Guardado ✓"; statusEl.className = "save-status is-ok"; }
            ruletaServerCount = ruletaState.prizes.length;
            // el aviso de las probabilidades solo cuando lo pidió a mano: si
            // saltara solo, interrumpiría mientras escribe los porcentajes
            if (forzado && Math.abs((res.probabilitySum || 0) - 100) > 0.05) {
              alert("Ojo: las probabilidades de los premios activos suman " + res.probabilitySum + "%, no 100%. La ruleta las ajusta sola al girar, pero puede que el resultado no sea el que esperas — revisa los porcentajes.");
            }
            listo(true);
          } else {
            if (statusEl) { statusEl.textContent = (res && res.error) || "No se pudo guardar."; statusEl.className = "save-status is-error"; }
            listo(false, (res && res.error) ? "⚠️ " + res.error : null);
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.textContent = "No se pudo conectar con el servidor."; statusEl.className = "save-status is-error"; }
          listo(false, "⚠️ Sin conexión — no se guardó");
        });
    });

    var btn = $("[data-ruleta-save-btn]");
    if (btn) btn.addEventListener("click", function () { guardarAhora("ruleta", "boton"); });
  }

  function initRuletaTab() {
    // Reintenta si la primera carga (la de renderAll) no llegó bien; si ya
    // está cargada no se vuelve a pedir.
    var tabBtn = $('[data-tab="ruleta"]');
    if (tabBtn) {
      tabBtn.addEventListener("click", function () {
        if (!ruletaLoaded) fetchRuletaAdmin();
      });
    }
    initRuletaAddPrize();
    initRuletaSave();
  }

  /* ==================== 📊 Historial y 👥 Clientes ====================
     Todo sale de api/history.php, que no guarda nada nuevo: junta lo que ya
     escriben las demás dinámicas y lo separa por categoría. */
  var HISTORY_API = "../api/history.php";
  var PRESENCE_API = "../api/presence.php";
  var NOTIF_API = "../api/notifications.php";
  var histAbierta = {};        // qué categorías dejó abiertas
  var customerRowsOpen = {};   // qué fichas de cliente dejó abiertas
  var histPeriodo = {};        // el periodo elegido en cada una
  var panelPollTimer = null;   // refresco automático de la pestaña abierta

  function fmtFecha(ms) {
    if (!ms) return "—";
    return new Date(Number(ms)).toLocaleString();
  }

  /* ---------------- Tarjetas que se pueden tocar ----------------
     Cada número del panel es una puerta: se toca y se abre debajo la lista de
     lo que representa. Se despliega en lugar de abrir una ventana porque en
     el celular una ventana tapa el contexto y hay que cerrarla para poder
     comparar con la tarjeta de al lado. */

  var historialPeriodo = "todos";
  var statAbierta = null;   // solo una abierta a la vez

  /** Desde qué milisegundo cuenta el período elegido. 0 = desde siempre. */
  function periodoDesdeMs(periodo) {
    var d = new Date();
    if (periodo === "hoy") { d.setHours(0, 0, 0, 0); return d.getTime(); }
    if (periodo === "semana") return Date.now() - 6 * 86400000;
    if (periodo === "mes") { d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
    return 0;
  }

  /** Una tarjeta. `clave` vacía = no se puede tocar (no hay detalle detrás). */
  function statHtml(valor, etiqueta, clave, nota) {
    if (!clave) {
      return '<div class="ruleta-stat">' +
        '<span class="ruleta-stat-value">' + escHTML(String(valor)) + "</span>" +
        '<span class="ruleta-stat-label">' + escHTML(etiqueta) + "</span>" +
        (nota ? '<span class="ruleta-stat-nota">' + escHTML(nota) + "</span>" : "") +
      "</div>";
    }
    return '<button type="button" class="ruleta-stat is-tocable' + (statAbierta === clave ? " is-abierta" : "") +
        '" data-stat="' + escHTML(clave) + '">' +
      '<span class="ruleta-stat-value">' + escHTML(String(valor)) + "</span>" +
      '<span class="ruleta-stat-label">' + escHTML(etiqueta) + "</span>" +
      (nota ? '<span class="ruleta-stat-nota">' + escHTML(nota) + "</span>" : "") +
    "</button>";
  }

  function pintarFilasPersonas(caja, titulo, filas) {
    if (!filas.length) {
      caja.innerHTML = "<h4>" + escHTML(titulo) + '</h4><p class="hint">No hay ninguno.</p>';
      return;
    }
    caja.innerHTML = "<h4>" + escHTML(titulo) + " · " + filas.length + "</h4>" +
      '<div class="stat-lista">' + filas.map(function (f) {
        return '<div class="stat-fila">' +
          '<span class="stat-fila-nombre">' + escHTML(f.name || "Cliente sin nombre") +
            (f.online ? ' <em class="stat-online">en línea</em>' : "") + "</span>" +
          '<span class="hint">' + escHTML(f.lastSeen ? fmtFecha(f.lastSeen) : "") + "</span>" +
        "</div>";
      }).join("") + "</div>";
  }

  function pintarFilasPremios(caja, titulo, filas) {
    if (!filas.length) {
      caja.innerHTML = "<h4>" + escHTML(titulo) + '</h4><p class="hint">No hay ninguno en este período.</p>';
      return;
    }
    caja.innerHTML = "<h4>" + escHTML(titulo) + " · " + filas.length + "</h4>" +
      '<div class="stat-lista">' + filas.map(function (p) {
        return '<div class="stat-fila">' +
          '<span class="stat-fila-nombre">' + escHTML(p.prizeName || "Premio") +
            ' <em>' + escHTML(p.name || "sin nombre") + "</em></span>" +
          '<span class="hint">' + escHTML(p.code) + " · " + escHTML(p.source || "") +
            " · " + escHTML(fmtFecha(p.issuedAt)) + "</span>" +
        "</div>";
      }).join("") + "</div>";
  }

  /** Abre (o cierra) el detalle de una tarjeta. */
  function abrirStat(clave, caja) {
    if (statAbierta === clave) {      // segunda vez sobre la misma: se cierra
      statAbierta = null;
      caja.hidden = true;
      refrescarTarjetas();
      return;
    }
    statAbierta = clave;
    // se cierran los dos contenedores: la abierta puede ser del otro grupo
    var otros = [$("[data-presence-detalle]"), $("[data-codes-detalle]")];
    otros.forEach(function (c) { if (c && c !== caja) c.hidden = true; });
    caja.hidden = false;
    caja.innerHTML = '<p class="hint">Cargando…</p>';
    refrescarTarjetas();

    var partes = clave.split(":");
    var tipo = partes[0], valor = partes[1] || "";

    if (tipo === "ahora" || tipo === "entraron") {
      fetch(PRESENCE_API + "?action=who&que=" + (tipo === "ahora" ? "ahora" : "periodo") +
            "&periodo=" + encodeURIComponent(historialPeriodo) + "&_=" + Date.now(),
        { credentials: "same-origin", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) { caja.innerHTML = '<p class="hint">' + escHTML((res && res.error) || "No se pudo cargar.") + "</p>"; return; }
          pintarFilasPersonas(caja, tipo === "ahora" ? "Conectados ahora" : "Entraron", res.rows || []);
        })
        .catch(function () { caja.innerHTML = '<p class="hint">No se pudo conectar.</p>'; });
      return;
    }

    // premios: se reutiliza la búsqueda que ya existía, ahora con fecha y origen
    var url = CODES_API + "?action=admin-search&desde=" + periodoDesdeMs(historialPeriodo);
    if (tipo === "estado") url += "&status=" + encodeURIComponent(valor);
    if (tipo === "origen") url += "&source=" + encodeURIComponent(valor);
    fetch(url + "&_=" + Date.now(), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { caja.innerHTML = '<p class="hint">' + escHTML((res && res.error) || "No se pudo cargar.") + "</p>"; return; }
        var titulo = tipo === "estado" ? (ESTADO_ETIQUETA[valor] || valor)
                   : tipo === "origen" ? ("Emitidos por " + valor) : "Todos los premios";
        pintarFilasPremios(caja, titulo, res.results || []);
      })
      .catch(function () { caja.innerHTML = '<p class="hint">No se pudo conectar.</p>'; });
  }

  var ESTADO_ETIQUETA = {
    available: "Disponibles", waiting: "Esperando entrega", delivered: "Entregados",
    expired: "Vencidos", "void": "Anulados",
  };

  function refrescarTarjetas() {
    ["[data-presence-stats]", "[data-codes-stats]"].forEach(function (sel) {
      var g = $(sel);
      if (!g) return;
      $$("[data-stat]", g).forEach(function (b) {
        b.classList.toggle("is-abierta", b.getAttribute("data-stat") === statAbierta);
      });
    });
  }

  function initTarjetasHistorial() {
    var sel = $("[data-historial-periodo]");
    if (sel) sel.addEventListener("change", function () {
      historialPeriodo = sel.value;
      statAbierta = null;
      [$("[data-presence-detalle]"), $("[data-codes-detalle]")].forEach(function (c) { if (c) c.hidden = true; });
      fetchPresence();
      fetchCodesStats();
    });
    var ref = $("[data-historial-refresh]");
    if (ref) ref.addEventListener("click", function () { fetchPresence(); fetchCodesStats(); });

    [["[data-presence-stats]", "[data-presence-detalle]"], ["[data-codes-stats]", "[data-codes-detalle]"]]
      .forEach(function (par) {
        var g = $(par[0]);
        if (!g) return;
        g.addEventListener("click", function (ev) {
          var b = ev.target.closest ? ev.target.closest("[data-stat]") : null;
          if (!b) return;
          abrirStat(b.getAttribute("data-stat"), $(par[1]));
        });
      });
  }

  /* ---- Presencia ---- */
  function fetchPresence() {
    var box = $("[data-presence-stats]");
    if (!box) return;
    fetch(PRESENCE_API + "?action=count&_=" + Date.now(), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { box.innerHTML = '<p class="hint">No se pudo consultar.</p>'; return; }
        /* "Entraron ayer" no se puede abrir todavía: hasta este cambio el
           servidor solo guardaba la lista del día en curso y la de ayer ya se
           descartó. Se deja sin tocar, con la nota que lo explica, en vez de
           que parezca rota. */
        box.innerHTML =
          statHtml(res.online, "Conectados ahora", "ahora") +
          statHtml(res.today, "Entraron hoy", "entraron") +
          statHtml(res.yesterday, "Entraron ayer", "", "el detalle se guarda desde hoy");
      })
      .catch(function () { box.innerHTML = '<p class="hint">No se pudo conectar.</p>'; });
  }

  /* ---- Historial por categoría ---- */
  function fetchHistorySummary() {
    var cont = $("[data-history-cats]");
    var statusEl = $("[data-history-status]");
    if (!cont) return;
    fetch(HISTORY_API + "?action=summary&_=" + Date.now(), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) {
          if (statusEl) statusEl.textContent = (res && res.error) || "No se pudo consultar el historial.";
          return;
        }
        if (statusEl) statusEl.textContent = "";
        cont.innerHTML = "";
        res.cats.forEach(function (c) { cont.appendChild(buildHistoryRow(c)); });
      })
      .catch(function () { if (statusEl) statusEl.textContent = "No se pudo conectar con el servidor."; });
  }

  function buildHistoryRow(c) {
    var row = document.createElement("div");
    row.className = "ruleta-prize-row";
    var abierta = !!histAbierta[c.cat];
    var periodo = histPeriodo[c.cat] || "all";

    row.innerHTML =
      '<div class="rp-head">' +
        '<button type="button" class="rp-toggle" data-h-toggle>' +
          '<span class="rp-icon">' + c.icon + "</span>" +
          '<span class="rp-name">' + escHTML(c.label) + "</span>" +
          '<span class="rp-prob">' + c.total + "</span>" +
          '<span class="rp-caret">' + (abierta ? "▾" : "▸") + "</span>" +
        "</button>" +
      "</div>" +
      '<div class="rp-body"' + (abierta ? "" : " hidden") + ">" +
        '<div class="history-controls">' +
          '<select data-h-period>' +
            '<option value="day">Hoy</option>' +
            '<option value="week">Últimos 7 días</option>' +
            '<option value="month">Últimos 30 días</option>' +
            '<option value="all">Todo</option>' +
          "</select>" +
          '<button type="button" class="btn btn-ghost" data-h-reset>🗑️ Reiniciar este historial</button>' +
        "</div>" +
        '<div class="history-rows" data-h-rows></div>' +
      "</div>";

    var body = row.querySelector(".rp-body");
    var caret = row.querySelector(".rp-caret");
    var sel = row.querySelector("[data-h-period]");
    sel.value = periodo;

    row.querySelector("[data-h-toggle]").onclick = function () {
      body.hidden = !body.hidden;
      histAbierta[c.cat] = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      row.classList.toggle("is-open", !body.hidden);
      if (!body.hidden) fetchHistoryRows(c.cat, row);
    };
    sel.onchange = function () {
      histPeriodo[c.cat] = sel.value;
      fetchHistoryRows(c.cat, row);
    };
    row.querySelector("[data-h-reset]").onclick = function () {
      if (!confirm('¿Reiniciar el historial de "' + c.label + '"?\n\nSe borra solo el de esta dinámica; las demás no se tocan. Los premios que un cliente todavía puede reclamar NO se borran.')) return;
      fetch(HISTORY_API + "?action=reset", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", cat: c.cat })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) { alert((res && res.error) || "No se pudo reiniciar."); return; }
          if (res.kept) alert("Listo. Se conservaron " + res.kept + " premio(s) que el cliente todavía puede reclamar.");
          fetchHistorySummary();
        })
        .catch(function () { alert("No se pudo conectar con el servidor."); });
    };

    if (abierta) fetchHistoryRows(c.cat, row);
    return row;
  }

  function fetchHistoryRows(cat, row) {
    var cont = row.querySelector("[data-h-rows]");
    var periodo = histPeriodo[cat] || "all";
    cont.innerHTML = '<p class="hint">Consultando…</p>';
    fetch(HISTORY_API + "?action=list&cat=" + encodeURIComponent(cat) + "&period=" + encodeURIComponent(periodo) + "&_=" + Date.now(),
      { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { cont.innerHTML = '<p class="hint">No se pudo consultar.</p>'; return; }
        var aviso = res.onlyWinners
          ? '<p class="hint">En esta dinámica solo queda registro de quien <strong>gana</strong>: los sellos y los reclamos del día no se guardan en el servidor.</p>'
          : "";
        if (!res.rows.length) { cont.innerHTML = aviso + '<p class="hint">Nada en este periodo.</p>'; return; }
        cont.innerHTML = aviso + res.rows.map(function (r2) {
          return '<p class="hint history-row"><strong>' + escHTML(r2.name) + "</strong> — " + escHTML(r2.text) +
            (r2.status ? " · " + escHTML(r2.status) : "") + "<br><span class='history-when'>" + escHTML(fmtFecha(r2.ts)) + "</span></p>";
        }).join("") + (res.total > res.rows.length
          ? '<p class="hint">Mostrando ' + res.rows.length + " de " + res.total + ".</p>" : "");
      })
      .catch(function () { cont.innerHTML = '<p class="hint">No se pudo conectar.</p>'; });
  }

  /* ---- La lista de clientes en un recuadro que se desplaza ----
     Con muchos clientes la página se hacía larguísima y había que bajar medio
     panel para llegar a lo de abajo. Mismo patrón que el ranking del juego:
     alto fijo, y flechas que solo salen si hay más de los que entran. */
  function ajustarFlechasClientes() {
    var lista = $("[data-customers-list]");
    var up = $("[data-customers-up]"), down = $("[data-customers-down]");
    if (!lista || !up || !down) return;
    // con alguien abierto el recuadro se suelta: no hay nada que desplazar
    lista.classList.toggle("is-abierta", !!lista.querySelector(".ruleta-prize-row.is-open"));
    var hayDeMas = lista.scrollHeight > lista.clientHeight + 2;
    up.hidden = !hayDeMas;
    down.hidden = !hayDeMas;
    if (!hayDeMas) return;
    var tope = lista.scrollHeight - lista.clientHeight;
    up.disabled = lista.scrollTop <= 1;
    down.disabled = lista.scrollTop >= tope - 1;
  }

  function initCustomersScroll() {
    var lista = $("[data-customers-list]");
    var up = $("[data-customers-up]"), down = $("[data-customers-down]");
    if (!lista) return;
    function desplazar(abajo) {
      var fila = lista.querySelector(".ruleta-prize-row");
      var paso = (fila ? fila.offsetHeight + 6 : 60) * 2;
      lista.scrollTop += abajo ? paso : -paso;
      ajustarFlechasClientes();
    }
    if (up) up.addEventListener("click", function () { desplazar(false); });
    if (down) down.addEventListener("click", function () { desplazar(true); });
    lista.addEventListener("scroll", ajustarFlechasClientes);
  }

  /* ---- La ficha completa de un cliente ----
     Junta lo que hasta ahora vivía en cuatro archivos separados: los premios
     con su estado, los giros de ruleta, los canjes de código y los sellos.
     El filtro de acá adentro es por ACTIVIDAD del cliente, distinto del de
     arriba, que filtra por cuándo vino. */
  var PERIODO_ETIQUETA = { hoy: "hoy", semana: "en los últimos 7 días", mes: "este mes", todos: "en total" };

  /* La ficha guarda su última respuesta para poder filtrar sin volver a
     preguntarle al servidor: los premios ya están todos en la pantalla, y
     tocar "Vencidos" es quedarse con unos pocos, no una consulta nueva. */
  var fichaDatos = {};      // deviceId -> última respuesta del servidor
  var fichaFiltro = {};     // deviceId -> qué tarjeta está tocada

  var FICHA_FILTROS = {
    todos:     function () { return true; },
    pendiente: function (p) { return p.status === "available" || p.status === "waiting"; },
    delivered: function (p) { return p.status === "delivered"; },
    expired:   function (p) { return p.status === "expired"; },
  };

  function pintarFichaCliente(caja, res, deviceId) {
    if (!res || !res.ok) {
      caja.innerHTML = '<p class="hint">' + escHTML((res && res.error) || "No se pudo cargar la ficha.") + "</p>";
      return;
    }
    fichaDatos[deviceId] = res;
    var filtro = fichaFiltro[deviceId] || "todos";
    var r = res.resumen, e = r.porEstado, cuando = PERIODO_ETIQUETA[res.periodo] || "";

    var origenes = Object.keys(r.porOrigen || {});
    var vecesGano = 0;
    origenes.forEach(function (k) { vecesGano += r.porOrigen[k]; });

    var sellos = r.sellos
      ? r.sellos.stamps + " de " + r.sellos.required + " sellos" +
        (r.sellos.claims ? " · " + r.sellos.claims + " tarjeta(s) completada(s)" : "")
      : "sin datos";

    var visitas = res.visitas || { total: 0, dias: [] };

    function tarjeta(valor, etiqueta, clave, nota) {
      var activa = filtro === clave;
      return '<button type="button" class="ficha-dato is-tocable' + (activa ? " is-abierta" : "") +
          '" data-ficha-stat="' + escHTML(clave) + '">' +
        "<span>" + escHTML(etiqueta) + "</span><strong>" + escHTML(String(valor)) + "</strong>" +
        (nota ? '<em class="ficha-dato-nota">' + escHTML(nota) + "</em>" : "") +
      "</button>";
    }

    /* Los premios que se ven abajo dependen de qué tarjeta esté tocada. */
    var visibles = res.premios.filter(FICHA_FILTROS[filtro] || FICHA_FILTROS.todos);

    var listaPremios = visibles.length
      ? visibles.map(function (p) {
          var vencido = p.status === "expired", anulado = p.status === "void";
          return '<div class="ficha-premio' + (vencido ? " is-vencido" : "") + (anulado ? " is-anulado" : "") + '">' +
            '<span class="ficha-premio-icon">' + escHTML(p.prizeIcon || "🎁") + "</span>" +
            '<span class="ficha-premio-txt">' +
              "<strong>" + escHTML(p.prizeName || "Premio") + "</strong>" +
              '<span class="hint">' + escHTML(p.sourceIcon + " " + p.sourceLabel) + " · " + escHTML(p.statusLabel) +
                " · " + escHTML(fmtFecha(p.issuedAt)) + "</span>" +
            "</span>" +
            (p.status === "available" || p.status === "waiting"
              ? '<button type="button" class="btn btn-ghost" data-quitar-premio="' + escHTML(p.code) + '">Quitar</button>'
              : "") +
          "</div>";
        }).join("")
      : '<p class="hint">Ninguno con ese filtro.</p>';

    caja.innerHTML =
      '<div class="ficha-resumen">' +
        tarjeta(r.premios, "Premios " + cuando, "todos") +
        tarjeta(e.available + e.waiting, "Sin reclamar", "pendiente") +
        tarjeta(e.delivered, "Entregados", "delivered") +
        tarjeta(e.expired, "Vencidos", "expired") +
        tarjeta(vecesGano, "Veces que ganó", "gano") +
        tarjeta(visitas.total, "Veces que entró", "visitas", "desde hoy") +
      "</div>" +
      '<div class="ficha-extra" data-ficha-extra' + (filtro === "gano" || filtro === "visitas" ? "" : " hidden") + "></div>" +
      '<p class="hint">🎟️ Tarjeta de fidelidad: <strong>' + escHTML(sellos) + "</strong>" +
        " · 🎡 " + r.giros.total + " giro(s) de ruleta" +
        " · 🎟️ " + r.canjes + " código(s) canjeado(s)</p>" +
      '<h4>Premios ' + escHTML(cuando) + (filtro !== "todos" && FICHA_FILTROS[filtro] ? " · filtrados" : "") + "</h4>" +
      listaPremios;

    // el desglose de las dos tarjetas que no filtran premios sino que abren datos
    var extra = caja.querySelector("[data-ficha-extra]");
    if (filtro === "gano") {
      /* El servidor manda la clave interna ("loyalty", "toppingsRun"); el
         nombre bonito y el ícono vienen dentro de cada premio. Se arma el
         diccionario desde ahí para no repetir la tabla de nombres acá. */
      var nombreDe = {};
      res.premios.forEach(function (p) {
        if (p.source) nombreDe[p.source] = (p.sourceIcon ? p.sourceIcon + " " : "") + (p.sourceLabel || p.source);
      });
      extra.innerHTML = origenes.length
        ? '<div class="stat-lista">' + origenes.map(function (k) {
            var n = r.porOrigen[k];
            return '<div class="stat-fila"><span class="stat-fila-nombre">' + escHTML(nombreDe[k] || k) +
              '</span><span class="hint">' + n + (n === 1 ? " vez" : " veces") + "</span></div>";
          }).join("") + "</div>"
        : '<p class="hint">Todavía no ha ganado nada ' + escHTML(cuando) + ".</p>";
    } else if (filtro === "visitas") {
      extra.innerHTML = visitas.dias.length
        ? '<div class="stat-lista">' + visitas.dias.map(function (d) {
            return '<div class="stat-fila"><span class="stat-fila-nombre">' + escHTML(d) + "</span></div>";
          }).join("") + "</div>"
        : '<p class="hint">Sin visitas registradas. El detalle de qué días vino se empezó a guardar hoy: lo anterior no quedó registrado.</p>';
    }
  }

  function cargarFichaCliente(deviceId, periodo, caja) {
    caja.innerHTML = '<p class="hint">Cargando ficha…</p>';
    fetch(HISTORY_API + "?action=customer-detail&deviceId=" + encodeURIComponent(deviceId) +
          "&periodo=" + encodeURIComponent(periodo) + "&_=" + Date.now(),
      { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) { pintarFichaCliente(caja, res, deviceId); })
      .catch(function () { caja.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>'; });
  }

  /* ---- Clientes ---- */
  function fetchCustomers() {
    var cont = $("[data-customers-list]");
    var statusEl = $("[data-customers-status]");
    if (!cont) return;
    var q = ($("[data-customers-search]") || {}).value || "";
    var periodo = ($("[data-customers-period]") || {}).value || "todos";
    fetch(HISTORY_API + "?action=customers&q=" + encodeURIComponent(q) +
          "&periodo=" + encodeURIComponent(periodo) + "&_=" + Date.now(),
      { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) {
          if (statusEl) statusEl.textContent = (res && res.error) || "No se pudo consultar.";
          return;
        }
        var ETIQUETA = { hoy: "que visitaron hoy", semana: "de los últimos 7 días", mes: "que visitaron este mes" };
        if (statusEl) {
          statusEl.textContent = periodo === "todos"
            ? res.total + " cliente(s) con nombre registrado."
            : res.total + " " + ETIQUETA[periodo] + " · " + res.totalSinFiltro + " en total";
        }
        if (!res.customers.length) {
          cont.innerHTML = periodo === "todos"
            ? '<p class="hint">Todavía nadie ha dado su nombre.</p>'
            : '<p class="hint">Ningún cliente ' + ETIQUETA[periodo] + '.</p>';
          return;
        }
        cont.innerHTML = "";
        res.customers.forEach(function (c) { cont.appendChild(buildCustomerRow(c)); });
        ajustarFlechasClientes();
      })
      .catch(function () { if (statusEl) statusEl.textContent = "No se pudo conectar con el servidor."; });
  }

  function buildCustomerRow(c) {
    var row = document.createElement("div");
    row.className = "ruleta-prize-row";
    row.innerHTML =
      '<div class="rp-head">' +
        '<button type="button" class="rp-toggle" data-c-toggle>' +
          '<span class="rp-icon">👤</span>' +
          '<span class="rp-name">' + escHTML(c.name) + "</span>" +
          '<span class="rp-prob">' + c.prizes + " 🎁</span>" +
          '<span class="rp-caret">▸</span>' +
        "</button>" +
      "</div>" +
      '<div class="rp-body" hidden>' +
        '<p class="hint">Premios: <strong>' + c.prizes + "</strong> · entregados: <strong>" + c.delivered +
          "</strong> · sin reclamar: <strong>" + c.pending + "</strong></p>" +
        '<p class="hint">Última vez en la página: ' + escHTML(fmtFecha(c.lastSeen)) +
          " · nombre puesto el " + escHTML(fmtFecha(c.updatedAt)) + "</p>" +
        '<div class="field-grid" data-notif-form="one">' +
          "<label>Título <input type='text' data-c-title placeholder='📣 TOPPINGS'></label>" +
          "<label class='full'>Mensaje para " + escHTML(c.name) +
            " <textarea rows='3' data-c-message placeholder='Ej: Gracias por venir hoy 🍟'></textarea></label>" +
          prizeFieldsHtml() +
        "</div>" +
        '<button type="button" class="btn btn-primary" data-c-send>Enviar mensaje</button>' +
        '<p class="hint" data-c-status></p>' +

        '<h4>Ficha completa</h4>' +
        '<div class="ficha-barra">' +
          "<label>Ver actividad de " +
            "<select data-c-periodo>" +
              '<option value="hoy">Hoy</option>' +
              '<option value="semana">Últimos 7 días</option>' +
              '<option value="mes">Este mes</option>' +
              '<option value="todos" selected>Siempre</option>' +
            "</select></label>" +
          '<button type="button" class="btn btn-ghost" data-c-sello="1">+1 sello</button>' +
          '<button type="button" class="btn btn-ghost" data-c-sello="-1">−1 sello</button>' +
          '<button type="button" class="btn btn-ghost is-danger" data-c-eliminar>Quitar de la lista</button>' +
        "</div>" +
        '<div class="ficha-cliente" data-c-ficha></div>' +
      "</div>";

    var body = row.querySelector(".rp-body");
    var caret = row.querySelector(".rp-caret");

    // se recuerda cuál dejó abierta, para que el refresco no se la cierre
    var abierta = !!customerRowsOpen[c.deviceId];
    body.hidden = !abierta;
    caret.textContent = abierta ? "▾" : "▸";
    row.classList.toggle("is-open", abierta);

    row.querySelector("[data-c-toggle]").onclick = function () {
      body.hidden = !body.hidden;
      customerRowsOpen[c.deviceId] = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      row.classList.toggle("is-open", !body.hidden);
    };

    var forma = row.querySelector('[data-notif-form="one"]');
    var selTipo = forma.querySelector("[data-notif-prize-type]");
    selTipo.addEventListener("change", function () { renderPrizeFields(forma, false); });
    renderPrizeFields(forma, false);

    row.querySelector("[data-c-send]").onclick = function () {
      var titulo = row.querySelector("[data-c-title]").value;
      var msg = row.querySelector("[data-c-message]").value;
      var st = row.querySelector("[data-c-status]");
      if (!msg.trim()) { st.textContent = "Escribí el mensaje."; return; }
      var premio = readPrizeFields(forma);
      if (premio.prizeType === "code" && !String(premio.redeemCode).trim()) { st.textContent = "Escribí el código."; return; }
      st.textContent = "Enviando…";
      enviarAviso(c.deviceId, titulo, msg, premio, function (ok, err) {
        st.textContent = ok ? "Enviado ✓" : (err || "No se pudo enviar.");
        if (ok) { row.querySelector("[data-c-message]").value = ""; fetchNotifSent(); }
      });
    };

    /* ---- La ficha y sus acciones ----
       La ficha se pide al abrir la fila, no al pintar la lista: si se pidiera
       para todos de una, abrir la pestaña con 200 clientes dispararía 200
       consultas al servidor. */
    var fichaEl = row.querySelector("[data-c-ficha]");
    var periodoEl = row.querySelector("[data-c-periodo]");
    var fichaCargada = false;

    function recargarFicha() {
      fichaCargada = true;
      cargarFichaCliente(c.deviceId, periodoEl.value, fichaEl);
    }
    if (abierta) recargarFicha();
    periodoEl.addEventListener("change", recargarFicha);

    // se engancha al botón que ya abre y cierra la fila, sin reemplazarlo
    var abrirOriginal = row.querySelector("[data-c-toggle]").onclick;
    row.querySelector("[data-c-toggle]").onclick = function () {
      abrirOriginal();
      if (!body.hidden && !fichaCargada) recargarFicha();
      ajustarFlechasClientes();
    };

    // dar o quitar un sello a mano
    Array.prototype.forEach.call(row.querySelectorAll("[data-c-sello]"), function (b) {
      b.onclick = function () {
        var delta = Number(b.getAttribute("data-c-sello")) || 0;
        b.disabled = true;
        fetch(LOYALTY_API + "?action=admin-stamp", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDeviceId: c.deviceId, delta: delta })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            b.disabled = false;
            if (res && res.ok) recargarFicha();
            else alert((res && res.error) || "No se pudo cambiar los sellos.");
          })
          .catch(function () { b.disabled = false; alert("No se pudo conectar con el servidor."); });
      };
    });

    /* Quitar un premio. Solo aparece en los que todavía se pueden usar: un
       premio ya entregado o vencido no se puede "quitar" sin reescribir la
       historia, y anularlo no le devolvería nada a nadie. */
    /* Tocar una tarjeta de la ficha filtra la lista de premios de abajo.
       No se le pregunta nada al servidor: los premios ya están todos en la
       pantalla y lo único que cambia es cuáles se muestran. Tocar la misma
       otra vez vuelve a mostrarlos todos. */
    fichaEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-ficha-stat]") : null;
      if (t) {
        var clave = t.getAttribute("data-ficha-stat");
        fichaFiltro[c.deviceId] = (fichaFiltro[c.deviceId] === clave) ? "todos" : clave;
        if (fichaDatos[c.deviceId]) pintarFichaCliente(fichaEl, fichaDatos[c.deviceId], c.deviceId);
        return;
      }
      var b = ev.target.closest ? ev.target.closest("[data-quitar-premio]") : null;
      if (!b) return;
      var code = b.getAttribute("data-quitar-premio");
      if (!confirm("¿Quitarle este premio a " + c.name + "? El código deja de servir.")) return;
      b.disabled = true;
      fetch(CODES_API + "?action=admin-void", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          b.disabled = false;
          if (res && res.ok) { recargarFicha(); fetchCustomers(); }
          else alert((res && res.error) || "No se pudo quitar el premio.");
        })
        .catch(function () { b.disabled = false; alert("No se pudo conectar con el servidor."); });
    });

    /* Sacarlo de la lista. Es una limpieza, no una expulsión: se le avisa por
       escrito que si vuelve a entrar reaparece, para que nadie crea que lo
       está bloqueando. Sus premios y sellos no se tocan. */
    row.querySelector("[data-c-eliminar]").onclick = function () {
      if (!confirm("¿Quitar a " + c.name + " de la lista de clientes?\n\n" +
                   "Sus premios y sellos NO se borran. Y si vuelve a entrar a la página con su nombre guardado, " +
                   "va a reaparecer solo en la lista.")) return;
      fetch(HISTORY_API + "?action=customer-delete", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: c.deviceId })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) { delete customerRowsOpen[c.deviceId]; fetchCustomers(); }
          else alert((res && res.error) || "No se pudo quitar de la lista.");
        })
        .catch(function () { alert("No se pudo conectar con el servidor."); });
    };

    return row;
  }

  /* Los mismos campos de premio en los dos sitios (mensaje para todos y ficha
     de cada cliente), para no escribirlos dos veces ni que se desincronicen. */
  function prizeFieldsHtml() {
    return '<label class="full">¿Lleva premio?' +
        '<select data-notif-prize-type>' +
          '<option value="none">No, es solo un mensaje</option>' +
          '<option value="direct">Sí — premio que entrega un mesero</option>' +
          '<option value="wheelSpins">Sí — tiro(s) en la Ruleta</option>' +
          '<option value="code">Sí — un código para que lo escriba</option>' +
        "</select>" +
      "</label>" +
      '<label data-notif-prize-field="direct">Nombre del premio <input type="text" data-notif-prize-name placeholder="Ej: Bebida gratis"></label>' +
      '<label data-notif-prize-field="direct">Ícono <input type="text" data-notif-prize-icon maxlength="4" placeholder="🎁"></label>' +
      '<label data-notif-prize-field="wheelSpins">Cuántos tiros <input type="number" min="1" data-notif-spin-count value="1"></label>' +
      '<label data-notif-prize-field="direct wheelSpins">Vigencia (horas) <input type="number" min="1" data-notif-prize-hours value="24"></label>' +
      '<label class="full" data-notif-prize-field="code">Código (uno de los de 🎟️ Códigos de Premio) <input type="text" data-notif-code placeholder="Ej: AMIGO"></label>' +
      '<p class="hint full" data-notif-prize-note></p>';
  }

  /** Muestra solo los campos del tipo elegido, y explica qué va a pasar. */
  function renderPrizeFields(scope, paraTodos) {
    var sel = scope.querySelector("[data-notif-prize-type]");
    if (!sel) return;
    var tipo = sel.value;
    $$("[data-notif-prize-field]", scope).forEach(function (el) {
      var para = el.getAttribute("data-notif-prize-field").split(" ");
      el.hidden = para.indexOf(tipo) === -1;
    });
    var nota = scope.querySelector("[data-notif-prize-note]");
    if (!nota) return;
    var textos = {
      none: "Le baja una notificación con el mensaje y nada más. Sin botón de reclamar.",
      direct: paraTodos
        ? "El premio se le entrega a cada cliente la primera vez que reciba el aviso, y le queda en 🎁 Mis Premios."
        : "El premio se le entrega AL ENVIAR y le queda en 🎁 Mis Premios.",
      wheelSpins: paraTodos
        ? "Los tiros se le dan a cada cliente la primera vez que reciba el aviso."
        : "Los tiros se le dan AL ENVIAR.",
      code: "No se entrega nada acá: el cliente toca el botón y le queda el código escrito para canjearlo. El código tiene que existir en 🎟️ Códigos de Premio."
    };
    nota.textContent = textos[tipo] || "";
  }

  /** Lee los campos de premio de un bloque y arma lo que espera el servidor. */
  function readPrizeFields(scope) {
    var sel = scope.querySelector("[data-notif-prize-type]");
    var tipo = sel ? sel.value : "none";
    var out = { prizeType: tipo };
    if (tipo === "direct") {
      out.prizeName = (scope.querySelector("[data-notif-prize-name]") || {}).value || "";
      out.prizeIcon = (scope.querySelector("[data-notif-prize-icon]") || {}).value || "";
      out.prizeExpiryHours = Number((scope.querySelector("[data-notif-prize-hours]") || {}).value) || 24;
    } else if (tipo === "wheelSpins") {
      out.wheelSpinCount = Number((scope.querySelector("[data-notif-spin-count]") || {}).value) || 1;
      out.prizeExpiryHours = Number((scope.querySelector("[data-notif-prize-hours]") || {}).value) || 24;
    } else if (tipo === "code") {
      out.redeemCode = (scope.querySelector("[data-notif-code]") || {}).value || "";
    }
    return out;
  }

  function enviarAviso(deviceId, title, message, premio, cb) {
    var cuerpo = { action: "admin-send", deviceId: deviceId, title: title, message: message };
    for (var k in premio) if (premio.hasOwnProperty(k)) cuerpo[k] = premio[k];
    fetch(NOTIF_API + "?action=admin-send", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    }).then(function (r) { return r.json(); })
      .then(function (res) { cb(!!(res && res.ok), res && res.error); })
      .catch(function () { cb(false, "No se pudo conectar con el servidor."); });
  }

  function fetchNotifSent() {
    var cont = $("[data-notif-sent-list]");
    if (!cont) return;
    fetch(NOTIF_API + "?action=admin-list&_=" + Date.now(), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { cont.innerHTML = '<p class="hint">No se pudo consultar.</p>'; return; }
        if (!res.items.length) { cont.innerHTML = '<p class="hint">Todavía no has enviado ningún mensaje.</p>'; return; }
        var etiquetaPremio = {
          direct: function (n) { return "🎁 " + (n.prizeName || "premio"); },
          wheelSpins: function (n) { return "🎡 " + (n.wheelSpinCount || 1) + " tiro(s)"; },
          code: function (n) { return "🎟️ código " + (n.redeemCode || ""); }
        };
        cont.innerHTML = res.items.map(function (n) {
          var pt = n.prizeType || "none";
          var premio = etiquetaPremio[pt] ? '<span class="rp-tag">' + escHTML(etiquetaPremio[pt](n)) + "</span>" : "";
          var entregado = (pt === "direct" || pt === "wheelSpins")
            ? " · entregado a " + (n.grantedCount || 0) : "";
          return '<div class="ruleta-search-row-result">' +
            "<strong>" + escHTML(n.title) + "</strong> " +
            (n.toAll ? '<span class="rp-tag">a todos</span> ' : "") + premio +
            "<br>" + escHTML(n.message) +
            '<br><span class="hint">' + escHTML(fmtFecha(n.createdAt)) + " · leído por " + n.readCount + entregado + "</span>" +
            '<button type="button" class="btn btn-ghost" data-notif-del="' + escHTML(n.id) + '">Borrar</button>' +
          "</div>";
        }).join("");
        $$("[data-notif-del]", cont).forEach(function (b) {
          b.addEventListener("click", function () {
            if (!confirm("¿Borrar este mensaje? Los clientes que no lo hayan leído ya no lo verán.")) return;
            fetch(NOTIF_API + "?action=admin-delete", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "admin-delete", id: b.getAttribute("data-notif-del") })
            }).then(function (r) { return r.json(); }).then(function () { fetchNotifSent(); });
          });
        });
      })
      .catch(function () { cont.innerHTML = '<p class="hint">No se pudo conectar.</p>'; });
  }

  /* El panel se refresca solo mientras la pestaña está abierta: si un cliente
     se cambia el nombre, acá se ve sin tener que recargar. Se apaga al salir
     de la pestaña para no consultar de gratis. */
  /* ¿Está escribiendo algo en esta pestaña? Refrescar reconstruye las fichas,
     y si lo hace mientras escribe le desaparece el campo y el celular cierra
     el teclado. Mejor esperar a la vuelta siguiente. */
  function estaEscribiendo(panelName) {
    var el = document.activeElement;
    if (!el) return false;
    var t = (el.tagName || "").toLowerCase();
    if (t !== "input" && t !== "textarea" && t !== "select") return false;
    var panel = $('[data-panel="' + panelName + '"]');
    return !!(panel && panel.contains(el));
  }

  function startPanelPoll(which) {
    stopPanelPoll();
    panelPollTimer = setInterval(function () {
      if (estaEscribiendo(which)) return;
      if (which === "historial") { fetchPresence(); fetchHistorySummary(); }
      else { fetchCustomers(); fetchNotifSent(); }
    }, 15000);
  }
  function stopPanelPoll() {
    if (panelPollTimer) { clearInterval(panelPollTimer); panelPollTimer = null; }
  }

  function initHistoryTabs() {
    var tabHist = $('[data-tab="historial"]');
    if (tabHist) {
      tabHist.addEventListener("click", function () {
        fetchPresence(); fetchHistorySummary(); fetchCodesStats();
        startPanelPoll("historial");
      });
    }
    var tabCli = $('[data-tab="clientes"]');
    if (tabCli) {
      tabCli.addEventListener("click", function () {
        fetchCustomers(); fetchNotifSent();
        startPanelPoll("clientes");
      });
    }
    // al irse a cualquier otra pestaña se apaga el refresco
    $$("[data-tab]").forEach(function (t) {
      var name = t.getAttribute("data-tab");
      if (name !== "historial" && name !== "clientes") t.addEventListener("click", stopPanelPoll);
    });

    var buscar = $("[data-customers-search]");
    if (buscar) {
      buscar.addEventListener("input", function () {
        clearTimeout(buscar.__t);
        buscar.__t = setTimeout(fetchCustomers, 300);
      });
    }
    // el filtro de hoy/semana/mes recarga la lista al cambiarlo
    var periodoSel = $("[data-customers-period]");
    if (periodoSel) periodoSel.addEventListener("change", fetchCustomers);

    var refrescar = $("[data-customers-refresh]");
    if (refrescar) refrescar.addEventListener("click", function () { fetchCustomers(); fetchNotifSent(); });

    var formaTodos = $('[data-notif-form="all"]');
    if (formaTodos) {
      var selTodos = formaTodos.querySelector("[data-notif-prize-type]");
      if (selTodos) selTodos.addEventListener("change", function () { renderPrizeFields(formaTodos, true); });
      renderPrizeFields(formaTodos, true);
    }

    var enviarTodos = $("[data-notif-send-all]");
    if (enviarTodos && formaTodos) {
      enviarTodos.addEventListener("click", function () {
        var titulo = (formaTodos.querySelector("[data-notif-title]") || {}).value || "";
        var msg = (formaTodos.querySelector("[data-notif-message]") || {}).value || "";
        var st = $("[data-notif-all-status]");
        if (!msg.trim()) { if (st) st.textContent = "Escribí el mensaje."; return; }
        var premio = readPrizeFields(formaTodos);
        if (premio.prizeType === "code" && !String(premio.redeemCode).trim()) {
          if (st) st.textContent = "Escribí el código."; return;
        }
        var aviso = premio.prizeType === "none"
          ? "¿Enviar este mensaje a TODOS los clientes?"
          : "¿Enviar a TODOS los clientes con premio? Cada uno lo recibirá una sola vez.";
        if (!confirm(aviso)) return;
        if (st) st.textContent = "Enviando…";
        enviarAviso("*", titulo, msg, premio, function (ok, err) {
          if (st) st.textContent = ok ? "Enviado a todos ✓" : (err || "No se pudo enviar.");
          if (ok) { formaTodos.querySelector("[data-notif-message]").value = ""; fetchNotifSent(); }
        });
      });
    }
  }

  /* ==================== 🎟️ Códigos de Premio (cupones a mano) ====================
     El admin escribe una palabra, la reparte, y quien la escriba en el panel 🎁
     de la página desbloquea el premio. Tiene su propio archivo y su propio
     botón de guardar, igual que la ruleta — el estado NO vive en content.json
     porque los canjes los escribe el cliente en cualquier momento y
     content.json se sobrescribe completo en cada guardado del panel. */
  var REDEEM_API = "../api/redeem.php";
  var redeemState = { codes: [] };
  var redeemLoaded = false;      // ¿el servidor llegó a darnos la lista de verdad?
  var redeemServerCount = 0;     // cuántos había, para avisar antes de vaciarla

  function fetchRedeemAdmin() {
    var statusEl = $("[data-redeem-status]");
    if (statusEl) statusEl.textContent = "Cargando códigos…";
    fetch(REDEEM_API + "?action=admin-list", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) {
          if (statusEl) { statusEl.textContent = (res && res.error) || "No se pudieron cargar los códigos."; statusEl.style.color = "var(--danger)"; }
          return;
        }
        redeemState.codes = res.codes || [];
        /* La bandera se marca CUANDO el servidor respondió bien, no al
           disparar la consulta: si falla, el guardado sabe que no tiene la
           lista de verdad y se niega a mandar una vacía. */
        redeemLoaded = true;
        redeemServerCount = redeemState.codes.length;
        if (statusEl) { statusEl.textContent = ""; statusEl.style.color = ""; }
        renderRedeemCodes();
      })
      .catch(function () {
        if (statusEl) { statusEl.textContent = "No se pudo conectar con el servidor."; statusEl.style.color = "var(--danger)"; }
      });
  }

  function redeemUsesLabel(c) {
    var usados = Number(c.usedCount) || 0;
    var tope = Number(c.maxUses);
    return usados + "/" + (tope >= 0 ? tope : "∞") + " usos";
  }

  function buildRedeemCodeRow(c, idx) {
    var row = document.createElement("div");
    row.className = "ruleta-prize-row" + (c.active ? "" : " is-off");
    row.innerHTML =
      '<div class="rp-head">' +
        '<button type="button" class="rp-toggle" data-rp-toggle>' +
          '<span class="rp-icon">🎟️</span>' +
          '<span class="rp-name">' + escHTML(c.code || "(sin código)") + "</span>" +
          '<span class="rp-prob" data-rc-uses>' + escHTML(redeemUsesLabel(c)) + "</span>" +
          '<span class="rp-caret">▸</span>' +
        "</button>" +
        '<button type="button" class="rp-active" data-rp-active title="Activo / desactivado"></button>' +
        '<button type="button" class="rp-remove" data-rp-remove title="Quitar este código" aria-label="Quitar este código">✕</button>' +
      "</div>" +
      '<div class="rp-body" hidden>' +
        '<div class="ruleta-prize-grid">' +
          '<label class="full">Código que le das al cliente (una palabra o frase, sin importar mayúsculas)' +
            '<span class="redeem-code-field">' +
              '<input type="text" data-c="code" placeholder="amigo">' +
              '<button type="button" class="btn btn-ghost redeem-gen-btn" title="Generar uno al azar">🎲</button>' +
            "</span>" +
          "</label>" +
          '<label class="full">Para qué es (solo lo ves tú) <input type="text" data-c="internalName" placeholder="Ej: Clientes del aniversario"></label>' +
          '<label class="full">Tipo de premio' +
            '<select data-c="rewardType" data-rc-type>' +
              '<option value="prize">Premio que entrega un mesero</option>' +
              '<option value="wheelSpins">Tiro(s) en la Ruleta</option>' +
            "</select>" +
          "</label>" +
        "</div>" +

        '<div class="ruleta-prize-grid" data-rc-field="prize">' +
          '<label class="full">Nombre del premio (lo que ve el cliente) <input type="text" data-c="prizeName" placeholder="Ej: Bebida gratis"></label>' +
          '<label>Ícono <input type="text" data-c="prizeIcon" maxlength="4" placeholder="🎁"></label>' +
          '<label>Vigencia del premio (horas) <input type="number" min="1" data-c="prizeExpiryHours"></label>' +
        "</div>" +

        '<div class="ruleta-prize-grid" data-rc-field="wheelSpins">' +
          '<label>Cuántos tiros <input type="number" min="1" data-c="wheelSpinCount"></label>' +
          '<label>Vigencia del tiro (horas) <input type="number" min="1" data-c="wheelTicketExpiryHours"></label>' +
        "</div>" +

        '<div class="ruleta-prize-grid">' +
          '<label>Máximo de usos en total (-1 = sin tope) <input type="number" data-c="maxUses"></label>' +
          '<label>Usos por persona <input type="number" min="1" data-c="usesPerPerson"></label>' +
          '<label class="full">Se puede volver a usar <select data-rc-cooldown>' +
            "<option value='0'>Nunca — una sola vez por persona</option>" +
            "<option value='24'>Cada día</option>" +
            "<option value='168'>Cada semana</option>" +
            "<option value='720'>Cada mes</option>" +
            "<option value='custom'>Cada tantas horas…</option>" +
          "</select></label>" +
          '<label data-rc-cooldown-custom>Cada cuántas horas <input type="number" min="0.5" step="0.5" data-c="cooldownHours"></label>' +
          "<p class='hint full' data-rc-cooldown-nota></p>" +
          '<label class="full">Vence el (vacío = no vence) <input type="datetime-local" data-rc-expires></label>' +
        "</div>" +

        '<details class="admin-collapsible redeem-log">' +
          "<summary>Ver quién lo usó (" + ((c.redemptions && c.redemptions.length) || 0) + ")</summary>" +
          '<div data-rc-log></div>' +
        "</details>" +

      "</div>";

    var body = row.querySelector(".rp-body");
    var caret = row.querySelector(".rp-caret");
    row.querySelector("[data-rp-toggle]").onclick = function () {
      body.hidden = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      row.classList.toggle("is-open", !body.hidden);
    };

    var activeBtn = row.querySelector("[data-rp-active]");
    function paintActive() { activeBtn.textContent = c.active ? "✅" : "🚫"; }
    paintActive();
    activeBtn.onclick = function () {
      c.active = !c.active;
      paintActive();
      row.classList.toggle("is-off", !c.active);
      programarGuardado("codigos");
    };

    // solo se muestran los campos del tipo de premio elegido
    var typeSelect = row.querySelector("[data-rc-type]");
    function paintType() {
      var t = typeSelect.value === "wheelSpins" ? "wheelSpins" : "prize";
      $$("[data-rc-field]", row).forEach(function (el) {
        el.hidden = el.getAttribute("data-rc-field") !== t;
      });
    }

    $$("[data-c]", row).forEach(function (input) {
      var key = input.getAttribute("data-c");
      var val = c[key];
      if (input.type === "checkbox") input.checked = !!val;
      else input.value = val == null ? "" : val;
      input.oninput = function () {
        c[key] = input.type === "checkbox" ? input.checked : (input.type === "number" ? Number(input.value) : input.value);
        if (key === "code") {
          var n = row.querySelector(".rp-name");
          if (n) n.textContent = c.code || "(sin código)";
        }
        if (key === "maxUses") {
          var u = row.querySelector("[data-rc-uses]");
          if (u) u.textContent = redeemUsesLabel(c);
        }
        if (key === "rewardType") paintType();
        // las dos cosas cambian la frase de "se puede volver a usar"
        if (key === "cooldownHours" || key === "usesPerPerson") {
          cdNota.textContent = cdTexto(Number(c.cooldownHours) || 0);
        }
        programarGuardado("codigos");
      };
    });
    typeSelect.addEventListener("change", paintType);
    paintType();

    /* Cada cuánto se le libera el cupón a la MISMA persona. Los plazos comunes
       están en la lista; el campo de horas solo aparece si elige otro. */
    var cdSelect = row.querySelector("[data-rc-cooldown]");
    var cdCustom = row.querySelector("[data-rc-cooldown-custom]");
    var cdNota = row.querySelector("[data-rc-cooldown-nota]");
    var CD_LISTA = ["0", "24", "168", "720"];

    function cdTexto(h) {
      if (!(h > 0)) return "Cada persona lo puede usar una sola vez y después le queda bloqueado.";
      var cuanto = h < 24 ? (h + (h === 1 ? " hora" : " horas"))
                 : (h % 24 === 0 ? ((h / 24) + ((h / 24) === 1 ? " día" : " días")) : (h + " horas"));
      var veces = (c.usesPerPerson || 1) > 1 ? (c.usesPerPerson + " veces") : "una vez";
      return "Cada persona lo puede usar " + veces + " y después se le vuelve a habilitar pasadas " + cuanto + ".";
    }
    function pintarCooldown() {
      var h = Number(c.cooldownHours) || 0;
      var esDeLista = CD_LISTA.indexOf(String(h)) >= 0;
      cdSelect.value = esDeLista ? String(h) : "custom";
      cdCustom.hidden = esDeLista;
      cdNota.textContent = cdTexto(h);
    }
    cdSelect.addEventListener("change", function () {
      if (cdSelect.value === "custom") {
        // al pasar a personalizado se arranca en algo razonable, no en 0
        if (!(Number(c.cooldownHours) > 0)) c.cooldownHours = 12;
        cdCustom.hidden = false;
        var campo = cdCustom.querySelector("input");
        if (campo) { campo.value = c.cooldownHours; campo.focus(); }
      } else {
        c.cooldownHours = Number(cdSelect.value) || 0;
        var c2 = cdCustom.querySelector("input");
        if (c2) c2.value = c.cooldownHours;
        cdCustom.hidden = true;
      }
      cdNota.textContent = cdTexto(Number(c.cooldownHours) || 0);
      programarGuardado("codigos");
    });
    pintarCooldown();

    // La fecha se guarda en milisegundos, pero el campo del navegador habla en
    // hora local — se convierte en los dos sentidos.
    var expInput = row.querySelector("[data-rc-expires]");
    if (c.expiresAt) {
      var d = new Date(Number(c.expiresAt));
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      expInput.value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    expInput.oninput = function () {
      if (!expInput.value) { c.expiresAt = null; programarGuardado("codigos"); return; }
      var t = new Date(expInput.value).getTime();
      c.expiresAt = isNaN(t) ? null : t;
      programarGuardado("codigos");
    };

    var genBtn = row.querySelector(".redeem-gen-btn");
    genBtn.addEventListener("click", function () {
      genBtn.disabled = true;
      fetch(REDEEM_API + "?action=admin-gen", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          genBtn.disabled = false;
          if (!res || !res.ok) return;
          c.code = res.code;
          var input = row.querySelector('[data-c="code"]');
          if (input) input.value = res.code;
          var n = row.querySelector(".rp-name");
          if (n) n.textContent = res.code;
          programarGuardado("codigos");
        })
        .catch(function () { genBtn.disabled = false; });
    });

    var log = row.querySelector("[data-rc-log]");
    var canjes = c.redemptions || [];
    log.innerHTML = canjes.length
      ? canjes.map(function (r) {
          var cuando = r.redeemedAt ? new Date(Number(r.redeemedAt)).toLocaleString() : "—";
          return '<p class="hint redeem-log-row"><strong>' + escHTML(r.name || "(sin nombre)") + "</strong> — " + escHTML(cuando) + "</p>";
        }).join("")
      : '<p class="hint">Todavía nadie lo ha usado.</p>';

    row.querySelector("[data-rp-remove]").addEventListener("click", function () {
      if (!confirm('¿Quitar el código "' + (c.code || "") + '"? Quien ya lo canjeó se queda con su premio.')) return;
      redeemState.codes.splice(idx, 1);
      renderRedeemCodes();
      programarGuardado("codigos");
    });

    return row;
  }

  function renderRedeemCodes() {
    var list = $("[data-redeem-codes-list]");
    if (!list) return;

    if (!list.__sortable) {
      list.__sortable = true;
      makeSortable(list, function (from, to) {
        var arr = redeemState.codes;
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        renderRedeemCodes();
        programarGuardado("codigos");
      });
    }

    list.innerHTML = "";
    if (!redeemState.codes.length) {
      list.innerHTML = '<p class="hint">Todavía no hay códigos. Dale a "+ Agregar código" para crear el primero.</p>';
      return;
    }
    redeemState.codes.forEach(function (c, idx) {
      var row = buildRedeemCodeRow(c, idx);
      row.setAttribute("data-sort-item", "");
      var grip = document.createElement("span");
      grip.className = "image-list-grip";
      grip.textContent = "⠿";
      row.appendChild(grip);
      list.appendChild(row);
    });
  }

  function initRedeemAdd() {
    var btn = $("[data-redeem-add]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      redeemState.codes.push({
        id: nuevoId("rdm_"), code: "", internalName: "", description: "",
        rewardType: "prize", prizeName: "", prizeIcon: "🎁", prizeExpiryHours: 24,
        wheelSpinCount: 1, wheelTicketExpiryHours: 24,
        maxUses: -1, usesPerPerson: 1, cooldownHours: 0, expiresAt: null, active: true,
        usedCount: 0, redemptions: []
      });
      renderRedeemCodes();
      // se abre el último para escribirlo de una, sin tener que buscarlo
      var filas = $$("[data-redeem-codes-list] .ruleta-prize-row");
      var ultima = filas[filas.length - 1];
      if (ultima) {
        ultima.querySelector("[data-rp-toggle]").click();
        ultima.scrollIntoView({ block: "center" });
        var campo = ultima.querySelector('[data-c="code"]');
        if (campo) campo.focus();
      }
      programarGuardado("codigos");
    });
  }

  function initRedeemSave() {
    registrarGuardador("codigos", function (motivo, listo) {
      var statusEl = $("[data-redeem-save-status]");
      var forzado = motivo === "boton";

      /* Guardar reemplaza la lista ENTERA en el servidor. Si nunca llegamos a
         cargarla, mandarla sería borrar todo lo que había — que es justo lo
         que pasó una vez. */
      if (!redeemLoaded) {
        if (statusEl) {
          statusEl.textContent = "Todavía no se cargaron los códigos. Recargá la página antes de guardar.";
          statusEl.className = "save-status is-error";
        }
        fetchRedeemAdmin();
        listo(false, "⚠️ Los códigos no cargaron — recargá");
        return;
      }
      if (!redeemState.codes.length && redeemServerCount > 0) {
        if (!forzado) {
          if (statusEl) {
            statusEl.textContent = "Quitaste todos los códigos. Dale al botón de guardar para confirmarlo.";
            statusEl.className = "save-status is-error";
          }
          listo("omitido", "⏸️ Quitaste todo — confirmá con el botón");
          return;
        }
        if (!confirm("Vas a dejar la lista sin ningún código. Se van a borrar los " +
            redeemServerCount + " que hay guardados. ¿Seguro?")) { listo("omitido"); return; }
      }

      /* Un código recién agregado está en blanco hasta que escriba la palabra.
         Guardarlo así lo perdería (el servidor descarta los vacíos), y avisar
         a gritos mientras escribe sería molesto: se espera calladito. */
      var vacio = redeemState.codes.some(function (c) { return !String(c.code || "").trim(); });
      if (vacio) {
        if (statusEl) { statusEl.textContent = "Hay un código sin palabra escrita."; statusEl.className = "save-status is-error"; }
        listo("omitido", "⏸️ Falta escribir la palabra del código");
        return;
      }
      if (statusEl) { statusEl.textContent = "Guardando…"; statusEl.className = "save-status"; }
      fetch(REDEEM_API + "?action=admin-save", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin-save", codes: redeemState.codes }),
        keepalive: motivo === "salida"
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            if (statusEl) { statusEl.textContent = "Guardado ✓"; statusEl.className = "save-status is-ok"; }
            redeemServerCount = redeemState.codes.length;
            /* Solo se relee cuando lo pidió a mano. Releer redibuja la lista
               entera, y si eso pasara solo cada vez que guarda, le cerraría el
               teclado en la cara mientras escribe. Los id ya no hace falta
               traerlos: se generan acá. */
            if (forzado) fetchRedeemAdmin();
            listo(true);
          } else {
            if (statusEl) { statusEl.textContent = (res && res.error) || "No se pudo guardar."; statusEl.className = "save-status is-error"; }
            listo(false, (res && res.error) ? "⚠️ " + res.error : null);
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.textContent = "No se pudo conectar con el servidor."; statusEl.className = "save-status is-error"; }
          listo(false, "⚠️ Sin conexión — no se guardó");
        });
    });

    var btn = $("[data-redeem-save-btn]");
    if (btn) btn.addEventListener("click", function () { guardarAhora("codigos", "boton"); });
  }

  function initRedeemTab() {
    var tabBtn = $('[data-tab="redeem"]');
    if (tabBtn) {
      tabBtn.addEventListener("click", function () {
        if (!redeemLoaded) fetchRedeemAdmin();
      });
    }
    initRedeemAdd();
    initRedeemSave();
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
        var html =
          statHtml(res.total, "Total de premios", "todos") +
          statHtml(res.byStatus.available, "Disponibles", "estado:available") +
          statHtml(res.byStatus.waiting, "Esperando entrega", "estado:waiting") +
          statHtml(res.byStatus.delivered, "Entregados", "estado:delivered") +
          statHtml(res.byStatus.expired, "Vencidos", "estado:expired") +
          statHtml(res.byStatus.void, "Anulados", "estado:void") +
          // este no es un número: no hay lista que abrir detrás
          statHtml(res.mostDeliveredPrize || "—", "Premio más entregado", "");
        Object.keys(res.bySource || {}).forEach(function (src) {
          html += statHtml(res.bySource[src], "Emitidos por " + src, "origen:" + src);
        });
        el.innerHTML = html;
      })
      .catch(function () { el.innerHTML = '<p class="hint">No se pudo conectar con el servidor.</p>'; });
  }

  /* Repara los premios que salieron sin nombre antes de que el canje lo
     pidiera. Informa las dos cuentas —los que arregló y los que no pudo—
     porque de alguien que nunca dio su nombre no hay de dónde sacarlo. */
  function initCodesFixNames() {
    var btn = $("[data-codes-fix-names]");
    var out = $("[data-codes-fix-result]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = "Revisando…";
      fetch(CODES_API + "?action=admin-fix-names", { method: "POST", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          btn.textContent = label;
          if (!out) return;
          out.hidden = false;
          if (!res || !res.ok) { out.textContent = (res && res.error) || "No se pudo revisar."; return; }
          if (!res.fixed && !res.unknown) { out.textContent = "Todos los premios ya tienen nombre."; return; }
          /* Al segundo toque no queda nada por arreglar, y decir "se le puso
             nombre a 0 premios" se lee como si algo hubiera fallado. */
          var t = res.fixed
            ? "Se le puso nombre a " + res.fixed + " premio" + (res.fixed === 1 ? "" : "s") + "."
            : "No quedaba ninguno por arreglar.";
          if (res.unknown) {
            t += " Hay " + res.unknown + " que no se puede" + (res.unknown === 1 ? "" : "n") +
                 ": esas personas nunca dieron su nombre en ninguna parte del sitio.";
          }
          out.textContent = t;
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = label;
          if (out) { out.hidden = false; out.textContent = "No se pudo conectar con el servidor."; }
        });
    });
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

  /* ================= 🔒 Premio Bloqueado (panel) =================
     La lista vive en su propio archivo del servidor (locked-prize.json), no en
     content.json, porque el estado lo escribe también el cliente al ganar. Por
     eso tiene su propio guardado, como la ruleta y los códigos — con los
     mismos candados: no se guarda lo que no se cargó, y vaciar la lista pide
     confirmación. */

  var LOCKED_API = "../api/locked.php";
  var lockedState = { prizes: [], history: [] };
  var lockedLoaded = false;        // ¿el servidor llegó a darnos la lista?
  var lockedServerCount = 0;       // cuántos había, para avisar antes de vaciar

  function lockedEditables() {
    return lockedState.prizes.filter(function (p) { return p.status !== "reclamado"; });
  }
  /* El servidor ya devuelve el historial completo: los premios de una sola vez
     se quedan en su fila y los que se repiten se archivan al rearmarse. */
  function lockedGanados() {
    return (lockedState.history || []).slice();
  }

  function fetchLockedAdmin() {
    fetch(LOCKED_API + "?action=admin-list&_=" + Date.now(), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) return;
        lockedState.prizes = res.prizes || [];
        lockedState.history = res.history || [];
        lockedLoaded = true;
        lockedServerCount = lockedEditables().length;
        renderLockedList();
        renderLockedWinners();
      })
      .catch(function () {
        var el = $("[data-locked-save-status]");
        if (el) { el.textContent = "No se pudo cargar la lista."; el.className = "save-status is-error"; }
      });
  }

  /* El campo de fecha y hora del navegador habla en hora local; el servidor
     guarda milisegundos. Se convierte en los dos sentidos. */
  function msALocal(ms) {
    if (!ms) return "";
    var d = new Date(Number(ms));
    function dd(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + dd(d.getMonth() + 1) + "-" + dd(d.getDate()) +
           "T" + dd(d.getHours()) + ":" + dd(d.getMinutes());
  }
  function localAMs(v) {
    if (!v) return 0;
    var t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }

  var LOCKED_ESTADO_TXT = {
    programado: "programado", desbloqueado: "desbloqueado",
    reservado: "reservado", cancelado: "cancelado", reclamado: "reclamado"
  };

  /** Una línea corta para ver de un vistazo cada cuánto se repite un premio. */
  function lockedResumen(p) {
    var modo = p.repite || "una";
    if (modo === "cadaHoras") return "cada " + (p.cadaHoras || 0) + " h";
    if (modo === "horasDelDia") return (p.horas || []).join(" · ");
    if (modo === "trasReclamo") return "+" + (p.cadaHoras || 0) + " h tras reclamo";
    return "";
  }

  function buildLockedRow(p, idx) {
    var row = document.createElement("div");
    row.className = "ruleta-prize-row" + (p.status === "cancelado" ? " is-off" : "");
    row.innerHTML =
      '<div class="rp-head">' +
        '<button type="button" class="rp-toggle" data-rp-toggle>' +
          '<span class="rp-icon">' + escHTML(p.prizeIcon || "🎁") + "</span>" +
          '<span class="rp-name">' + escHTML(p.prizeName || "(sin nombre)") + "</span>" +
          '<span class="rp-prob" data-lk-estado>' + escHTML(LOCKED_ESTADO_TXT[p.status] || p.status) + "</span>" +
          '<span class="rp-caret">▸</span>' +
        "</button>" +
        '<button type="button" class="rp-remove" data-rp-remove title="Quitar este premio" aria-label="Quitar este premio">✕</button>' +
      "</div>" +
      '<div class="rp-body" hidden>' +
        '<div class="field-grid">' +
          "<label class='full'>Nombre del premio <input type='text' data-lk='prizeName' placeholder='Salchipapa sencilla'>" +
            "<span class='hint' data-lk-nombre-nota></span></label>" +
          "<label>Ícono <input type='text' data-lk='prizeIcon' maxlength='4' placeholder='🎁'></label>" +
          "<label>Qué se gana <select data-lk='tipo'>" +
            "<option value='escrito'>Un premio escrito (código)</option>" +
            "<option value='ruleta'>Giros en la ruleta</option>" +
          "</select></label>" +
          "<label data-lk-si='ruleta'>Cuántos giros <input type='number' data-lk='giros' min='1' max='20' step='1'></label>" +
          "<label class='full'>Cada cuánto se puede reclamar <select data-lk='repite'>" +
            "<option value='una'>Una sola vez</option>" +
            "<option value='cadaHoras'>Cada tantas horas</option>" +
            "<option value='horasDelDia'>A unas horas fijas, todos los días</option>" +
            "<option value='trasReclamo'>Se restablece tras cada reclamo</option>" +
          "</select></label>" +
          "<label data-lk-si='fecha'><span data-lk-fecha-titulo>Se desbloquea el</span> <input type='datetime-local' data-lk='unlockAt'></label>" +
          "<label data-lk-si='cadaHoras'>Cada cuántas horas <input type='number' data-lk='cadaHoras' min='0.5' max='8760' step='0.5'></label>" +
          "<label class='full' data-lk-si='horasDelDia'>A qué horas <input type='text' data-lk='horas' placeholder='15:00, 18:00, 20:00'>" +
            "<span class='hint'>Separadas por comas. También vale «3 pm, 6 pm».</span></label>" +
          "<label class='full'>Estado <select data-lk='status'>" +
            "<option value='programado'>Programado</option>" +
            "<option value='cancelado'>Cancelado</option>" +
          "</select></label>" +
          "<p class='hint full' data-lk-nota></p>" +
        "</div>" +
      "</div>";

    var body = row.querySelector(".rp-body");
    var caret = row.querySelector(".rp-caret");
    row.querySelector("[data-rp-toggle]").onclick = function () {
      body.hidden = !body.hidden;
      caret.textContent = body.hidden ? "▸" : "▾";
      row.classList.toggle("is-open", !body.hidden);
    };

    /* Cada forma de repetir pide datos distintos: se muestran solo los que
       hacen falta, para que la fila no sea un muro de campos vacíos. */
    var NOTAS = {
      una: "Se entrega una sola vez. Cuando alguien lo gane, pasa al siguiente premio de la lista.",
      cadaHoras: "Después de que alguien lo gane, vuelve a abrirse cada tantas horas contadas desde la fecha de arriba, así que cae siempre a la misma hora.",
      horasDelDia: "Después de que alguien lo gane, vuelve a abrirse en la siguiente de esas horas.",
      trasReclamo: "Después de que alguien lo gane, vuelve a abrirse esas horas más tarde."
    };
    function pintarModo() {
      var modo = p.repite || "una";
      var esRuleta = (p.tipo || "escrito") === "ruleta";
      $$("[data-lk-si]", row).forEach(function (el) {
        var q = el.getAttribute("data-lk-si");
        if (q === "ruleta") el.hidden = !esRuleta;
        else if (q === "fecha") el.hidden = (modo === "horasDelDia");
        else el.hidden = (q !== modo);
      });
      var t = row.querySelector("[data-lk-fecha-titulo]");
      if (t) t.textContent = modo === "una" ? "Se desbloquea el" : "Se desbloquea por primera vez el";
      var nota = row.querySelector("[data-lk-nota]");
      if (nota) nota.textContent = NOTAS[modo] || "";
      var notaNombre = row.querySelector("[data-lk-nombre-nota]");
      if (notaNombre) {
        notaNombre.textContent = esRuleta
          ? "Opcional: lo que se gana lo decide el giro. Si lo dejás vacío se llama solo."
          : "";
      }
      var est = row.querySelector("[data-lk-estado]");
      if (est) {
        var resumen = lockedResumen(p);
        est.textContent = (LOCKED_ESTADO_TXT[p.status] || p.status) + (resumen ? " · " + resumen : "");
      }
    }

    $$("[data-lk]", row).forEach(function (input) {
      var key = input.getAttribute("data-lk");
      if (key === "unlockAt") input.value = msALocal(p.unlockAt);
      else if (key === "horas") input.value = (p.horas || []).join(", ");
      else if (key === "tipo") input.value = p.tipo || "escrito";
      else if (key === "repite") input.value = p.repite || "una";
      else if (key === "giros") input.value = p.giros || 1;
      else if (key === "cadaHoras") input.value = p.cadaHoras || "";
      else input.value = p[key] == null ? "" : p[key];
      input.oninput = function () {
        if (key === "unlockAt") p.unlockAt = localAMs(input.value);
        else if (key === "horas") p.horas = input.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        else if (key === "giros" || key === "cadaHoras") p[key] = Number(input.value) || 0;
        else p[key] = input.value;
        pintarModo();
        if (key === "prizeName") {
          var n = row.querySelector(".rp-name");
          if (n) n.textContent = p.prizeName || "(sin nombre)";
        }
        if (key === "prizeIcon") {
          var ic = row.querySelector(".rp-icon");
          if (ic) ic.textContent = p.prizeIcon || "🎁";
        }
        programarGuardado("bloqueado");
      };
      input.onchange = input.oninput;
    });
    pintarModo();

    row.querySelector("[data-rp-remove]").addEventListener("click", function () {
      if (!confirm('¿Quitar el premio "' + (p.prizeName || "") + '"?')) return;
      var editables = lockedEditables();
      var real = lockedState.prizes.indexOf(editables[idx]);
      if (real >= 0) lockedState.prizes.splice(real, 1);
      renderLockedList();
      programarGuardado("bloqueado");
    });

    return row;
  }

  function renderLockedList() {
    var list = $("[data-locked-list]");
    if (!list) return;
    var editables = lockedEditables();
    list.innerHTML = "";
    if (!editables.length) {
      list.innerHTML = '<p class="hint">No hay ningún premio programado. Dale a "+ Programar premio".</p>';
      return;
    }
    editables.sort(function (a, b) { return (a.unlockAt || 0) - (b.unlockAt || 0); });
    editables.forEach(function (p, i) { list.appendChild(buildLockedRow(p, i)); });
  }

  function renderLockedWinners() {
    var cont = $("[data-locked-winners]");
    if (!cont) return;
    var ganados = lockedGanados();
    if (!ganados.length) {
      cont.innerHTML = '<p class="hint">Todavía nadie ha ganado un Premio Bloqueado.</p>';
      return;
    }
    ganados.sort(function (a, b) { return (b.claimedAt || 0) - (a.claimedAt || 0); });
    cont.innerHTML = ganados.map(function (p) {
      var cuando = p.claimedAt ? new Date(Number(p.claimedAt)).toLocaleString() : "—";
      return '<p class="hint locked-winner-row">🏆 <strong>' + escHTML(p.winnerName || "(sin nombre)") +
             "</strong> — " + escHTML(p.prizeIcon || "🎁") + " " + escHTML(p.prizeName || "") +
             ' <button type="button" class="btn btn-ghost locked-forget" data-locked-forget="' + escHTML(p.id) + '">✕</button>' +
             "<br><span class='hint'>Reclamado el " + escHTML(cuando) + "</span></p>";
    }).join("");

    /* Los ganadores no se pueden editar —son el registro de quién ganó qué—
       pero sí borrar: si queda uno equivocado o de prueba, los clientes lo
       verían como "ganador anterior" en su panel. */
    $$("[data-locked-forget]", cont).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("¿Borrar este ganador del historial?")) return;
        fetch(LOCKED_API + "?action=admin-forget", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: b.getAttribute("data-locked-forget") })
        }).then(function (r) { return r.json(); })
          .then(function () { fetchLockedAdmin(); })
          .catch(function () {});
      });
    });
  }

  function initLockedAdd() {
    var btn = $("[data-locked-add]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      // por defecto, dentro de una hora en punto
      var enUnaHora = Date.now() + 60 * 60 * 1000;
      lockedState.prizes.push({
        id: "", prizeName: "", prizeIcon: "🎁",
        tipo: "escrito", giros: 1,
        unlockAt: enUnaHora, repite: "una", cadaHoras: 24, horas: [],
        status: "programado",
        winnerName: null, winnerDeviceId: null, claimedAt: null, reservedUntil: null
      });
      renderLockedList();
      var filas = $("[data-locked-list] .ruleta-prize-row");
      var ultima = filas[filas.length - 1];
      if (ultima) {
        ultima.querySelector("[data-rp-toggle]").click();
        ultima.scrollIntoView({ block: "center" });
        var campo = ultima.querySelector("[data-lk='prizeName']");
        if (campo) campo.focus();
      }
    });
  }

  function initLockedSave() {
    registrarGuardador("bloqueado", function (motivo, listo) {
      var statusEl = $("[data-locked-save-status]");
      var forzado = motivo === "boton";

      if (!lockedLoaded) {
        if (statusEl) {
          statusEl.textContent = "Todavía no se cargaron los premios. Recargá la página antes de guardar.";
          statusEl.className = "save-status is-error";
        }
        fetchLockedAdmin();
        listo(false, "⚠️ La lista no cargó — recargá");
        return;
      }
      var editables = lockedEditables();
      if (!editables.length && lockedServerCount > 0) {
        if (!forzado) {
          if (statusEl) {
            statusEl.textContent = "Quitaste todos los premios. Dale al botón de guardar para confirmarlo.";
            statusEl.className = "save-status is-error";
          }
          listo("omitido", "⏸️ Quitaste todo — confirmá con el botón");
          return;
        }
        if (!confirm("Vas a dejar la lista sin ningún premio programado. Se van a borrar los " +
            lockedServerCount + " que hay. ¿Seguro?")) { listo("omitido"); return; }
      }
      /* Cada forma de repetir necesita un dato distinto, así que se avisa qué
         falta en vez de mandar algo que el servidor va a descartar en silencio. */
      var falta = null;
      editables.some(function (p) {
        var modo = p.repite || "una";
        /* Con la ruleta el nombre es opcional: lo que se gana lo decide el
           giro. El servidor le arma uno ("2 giros en la ruleta") si va vacío. */
        if ((p.tipo || "escrito") !== "ruleta" && !String(p.prizeName || "").trim()) {
          falta = "Hay un premio sin nombre."; return true;
        }
        if (modo === "horasDelDia") {
          if (!(p.horas || []).length) { falta = 'A "' + p.prizeName + '" le faltan las horas del día.'; return true; }
        } else if (!p.unlockAt) {
          falta = 'A "' + p.prizeName + '" le falta la fecha.'; return true;
        }
        if ((modo === "cadaHoras" || modo === "trasReclamo") && !(Number(p.cadaHoras) > 0)) {
          falta = 'A "' + p.prizeName + '" le faltan las horas de repetición.'; return true;
        }
        return false;
      });
      if (falta) {
        if (statusEl) { statusEl.textContent = falta; statusEl.className = "save-status is-error"; }
        listo("omitido", "⏸️ " + falta);
        return;
      }

      /* En "a estas horas del día" la fecha la pone el servidor: es él quien
         sabe qué hora es de verdad, y así no depende del reloj del celular. */
      var aMandar = editables.map(function (p) {
        if ((p.repite || "una") !== "horasDelDia") return p;
        var copia = {}; for (var k in p) if (p.hasOwnProperty(k)) copia[k] = p[k];
        copia.unlockAt = 0;
        return copia;
      });

      if (statusEl) { statusEl.textContent = "Guardando…"; statusEl.className = "save-status"; }
      fetch(LOCKED_API + "?action=admin-save", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prizes: aMandar }),
        keepalive: motivo === "salida"
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            if (statusEl) { statusEl.textContent = "Guardado ✓"; statusEl.className = "save-status is-ok"; }
            lockedServerCount = editables.length;
            if (forzado) fetchLockedAdmin();   // releer redibuja: solo si lo pidió a mano
            listo(true);
          } else {
            if (statusEl) { statusEl.textContent = (res && res.error) || "No se pudo guardar."; statusEl.className = "save-status is-error"; }
            listo(false, (res && res.error) ? "⚠️ " + res.error : null);
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.textContent = "No se pudo conectar con el servidor."; statusEl.className = "save-status is-error"; }
          listo(false, "⚠️ Sin conexión — no se guardó");
        });
    });

    var btn = $("[data-locked-save-btn]");
    if (btn) btn.addEventListener("click", function () { guardarAhora("bloqueado", "boton"); });
  }

  /* ---- tabla de botones flotantes por página ---- */
  var FLOTANTES_BOTONES = [
    ["locked", "🔒 Premio Bloqueado"],
    ["zona", "❓ Zona Secreta"],
    ["whatsapp", "💬 WhatsApp"],
    ["musica", "🎵 Música"]
  ];
  var FLOTANTES_PAGINAS = [
    ["inicio", "Inicio"], ["comidas", "Comidas"], ["helados", "Helados"],
    ["bebidas", "Bebidas"], ["secreta", "Secreta"]
  ];
  // los mismos valores que usa main.js cuando todavía no hay nada guardado
  var FLOTANTES_DEF = {
    locked:   { inicio: true, comidas: false, helados: false, bebidas: false, secreta: false },
    zona:     { inicio: true, comidas: true,  helados: true,  bebidas: true,  secreta: false },
    whatsapp: { inicio: true, comidas: true,  helados: true,  bebidas: true,  secreta: true },
    musica:   { inicio: true, comidas: true,  helados: true,  bebidas: true,  secreta: true }
  };

  function flotantes() {
    return state.content.flotantes || (state.content.flotantes = {});
  }

  function renderFlotantes() {
    var cont = $("[data-flotantes-tabla]");
    if (!cont) return;
    var cfg = flotantes();
    var html = '<table class="flotantes-grid"><thead><tr><th></th>';
    FLOTANTES_PAGINAS.forEach(function (p) { html += "<th>" + escHTML(p[1]) + "</th>"; });
    html += "</tr></thead><tbody>";
    FLOTANTES_BOTONES.forEach(function (b) {
      html += "<tr><th>" + escHTML(b[1]) + "</th>";
      FLOTANTES_PAGINAS.forEach(function (p) {
        var guardado = cfg[b[0]] && typeof cfg[b[0]][p[0]] === "boolean" ? cfg[b[0]][p[0]] : FLOTANTES_DEF[b[0]][p[0]];
        html += '<td><input type="checkbox" data-flot="' + b[0] + ":" + p[0] + '"' + (guardado ? " checked" : "") + "></td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    cont.innerHTML = html;

    $$("[data-flot]", cont).forEach(function (chk) {
      chk.addEventListener("change", function () {
        var partes = chk.getAttribute("data-flot").split(":");
        var cfg2 = flotantes();
        if (!cfg2[partes[0]]) cfg2[partes[0]] = {};
        cfg2[partes[0]][partes[1]] = chk.checked;
        markDirty();
      });
    });
  }


  /* ---------------- save ---------------- */
  function initSave() {
    /* El contenido general se guarda entero cada vez, así que no hay riesgo de
       borrar una lista a medias: o va todo el content.json o no va nada. */
    registrarGuardador("contenido", function (motivo, listo) {
      if (!state.content) { listo("omitido"); return; }
      setSaveStatus("Guardando…", "");
      var cuerpo = JSON.stringify(state.content);
      // keepalive: si se está yendo de la página, el navegador termina de
      // mandarlo igual en vez de cortarlo a la mitad
      fetch(API + "?action=save-content", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: cuerpo,
        keepalive: motivo === "salida"
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            state.dirty = false;
            setSaveStatus("Guardado ✓ — ya está publicado en tu página", "is-ok");
            listo(true);
          } else {
            setSaveStatus((res && res.error) || "No se pudo guardar.", "is-error");
            listo(false, (res && res.error) ? "⚠️ " + res.error : null);
          }
        })
        .catch(function () {
          setSaveStatus("No se pudo conectar con el servidor.", "is-error");
          listo(false, "⚠️ Sin conexión — no se guardó");
        });
    });

    var btn = $("[data-save-btn]");
    if (btn) btn.addEventListener("click", function () { guardarAhora("contenido", "boton"); });

    /* Lo que hace que "darle atrás" no pierda nada: antes de que la página se
       vaya, o apenas se minimiza / se cambia de app, se manda lo pendiente.
       En el celular `pagehide` y `visibilitychange` son los únicos que llegan
       de verdad — `beforeunload` muchas veces ni se dispara. */
    window.addEventListener("pagehide", function () { guardarTodoPendiente("salida"); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") guardarTodoPendiente("salida");
    });
    window.addEventListener("beforeunload", function (e) {
      guardarTodoPendiente("salida");
      /* Normalmente no se avisa nada: para eso está el guardado automático.
         Pero si el último intento no llegó (sin señal, sesión vencida), irse
         ahí sí perdería el trabajo — solo en ese caso se pregunta. */
      if (huboFallo) { e.preventDefault(); e.returnValue = ""; }
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
    initAddHomeImage();
    initPrizeMethodOrder();
    initStopTimeRound();
    initAttemptsResetToggle();
    initCronoReset();
    initChallengeTypeToggle();
    initModalStyleToggle();
    initNameChangeModeToggle();
    initRewardTypeToggles();
    initTarjetasHistorial();
    initCustomersScroll();
    initRankingScores();
    initRankingReset();
    initChallengeReset();
    initRuletaTab();
    initRedeemTab();
    initVotesTab();
    initLoyaltyAdmin();
    initLockedAdd();
    initLockedSave();
    initHistoryTabs();
    initCodesSearch();
    initCodesFixNames();
    initCarouselPreviewModal();
    initSave();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
