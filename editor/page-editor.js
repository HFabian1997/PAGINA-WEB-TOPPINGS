/**
 * Editor visual — Etapa 1+2.
 * Entrada (botón discreto + reutiliza el login del panel de administrador),
 * modo edición, resaltado y selección de cualquier elemento (incluidos los
 * botones flotantes), mover con "mantener presionado y arrastrar", editar
 * texto con doble clic, guardar/restablecer contra api/editor.php.
 * Autoconctenido, no toca main.js.
 *
 * Arquitectura: los overrides (posición, texto) se guardan en JSON
 * (api/editor.php) y se aplican con JS encima del HTML/CSS original — el
 * HTML/CSS del sitio nunca se reescribe. Reposicionamiento con
 * `position: relative` + `transform: translate()` (nunca absolute suelto),
 * acotado siempre dentro del contenedor padre (o del viewport para los
 * elementos flotantes `position: fixed`).
 */
(function () {
  "use strict";

  var CONTENT_API = "api/content.php";
  var EDITOR_API = "api/editor.php";
  var EDITOR_UI_ATTR = "data-editor-ui";
  var HOLD_MS = 220;
  var MOVE_THRESHOLD = 6;
  var TEXT_TAGS = ["P", "SPAN", "H1", "H2", "H3", "H4", "SMALL", "BUTTON", "A", "LABEL", "LI"];

  function $(sel, root) { return (root || document).querySelector(sel); }

  function pageSlug() {
    var path = location.pathname.split("/").pop() || "index.html";
    var slug = path.replace(/\.html?$/i, "");
    if (slug === "") slug = "index";
    return slug.toLowerCase();
  }

  function currentBreakpoint() {
    var w = window.innerWidth;
    if (w < 720) return "mobile";
    if (w < 1200) return "tablet";
    return "desktop";
  }

  /* ---------------------------------------------------------------
     Identificación estable de elementos: prioriza id -> atributo
     data-* único ya existente -> ruta tag.clase:nth-of-type relativa
     al ancestro estable más cercano. Sirve tanto para mostrar en el
     panel como para volver a encontrar el elemento con querySelector
     al cargar la página (por eso debe ser un selector CSS válido).
     --------------------------------------------------------------- */
  function isUniqueSelector(sel, el) {
    try {
      var matches = document.querySelectorAll(sel);
      return matches.length === 1 && matches[0] === el;
    } catch (e) { return false; }
  }

  function getStableSelector(el) {
    if (!el || el === document.body) return "body";
    if (el.id && isUniqueSelector("#" + el.id, el)) return "#" + el.id;

    var dataAttrs = Array.prototype.filter.call(el.attributes || [], function (a) {
      return a.name.indexOf("data-") === 0 && a.name !== EDITOR_UI_ATTR;
    });
    for (var i = 0; i < dataAttrs.length; i++) {
      var candidate = "[" + dataAttrs[i].name + (dataAttrs[i].value ? '="' + dataAttrs[i].value + '"' : "") + "]";
      if (isUniqueSelector(candidate, el)) return candidate;
    }

    var parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();

    var siblingsSameTag = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
    var index = siblingsSameTag.indexOf(el) + 1;
    var part = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string" && el.className.trim()) {
      part += "." + el.className.trim().split(/\s+/).join(".");
    }
    part += ":nth-of-type(" + index + ")";

    return getStableSelector(parent) + " > " + part;
  }

  /* ---------------------------------------------------------------
     Qué se puede seleccionar: cualquier elemento visible de la página
     (incluidos los botones flotantes, que viven fuera de header/main/
     footer) salvo la UI del propio editor y contenedores estructurales
     sin utilidad (script/style/svg interno, canvas del juego).
     --------------------------------------------------------------- */
  var SVG_INTERNAL_TAGS = ["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "use", "ellipse", "defs", "clippath"];

  function isEditableCandidate(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (el.closest("[" + EDITOR_UI_ATTR + "]")) return false;
    var tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "CANVAS") return false;
    return true;
  }

  /**
   * Muchos botones (WhatsApp, íconos flotantes) usan un <svg> interno —
   * si el hit-test cae sobre el propio svg/path, hay que resolverlo hacia
   * su ancestro real (el <a>/<button> que sí tiene sentido mover/editar),
   * en vez de rechazarlo directamente.
   */
  function resolveTarget(x, y) {
    var el = document.elementFromPoint(x, y);
    var guard = 0;
    while (el && el.tagName && SVG_INTERNAL_TAGS.indexOf(el.tagName.toLowerCase()) !== -1 && guard < 10) {
      el = el.parentElement;
      guard++;
    }
    return el;
  }

  function textPreview(el) {
    var t = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (t.length > 60) t = t.slice(0, 57) + "…";
    return t || "(sin texto)";
  }

  function isTextEditable(el) {
    return TEXT_TAGS.indexOf(el.tagName) !== -1;
  }

  /* ---------------------------------------------------------------
     Overrides: selector -> {dx, dy, text}. Se cargan al inicio de
     CADA visita (haya o no sesión de administrador) para que los
     cambios guardados se vean para todos; solo se pueden CREAR desde
     el modo edición.
     --------------------------------------------------------------- */
  var overrides = {};
  var dirty = false;

  /** `elements` siempre debe tratarse como mapa selector -> override, nunca
   *  como lista — un `{}` vacío puede llegar como `[]` desde JSON. */
  function asOverridesMap(v) {
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }

  var MIN_SCALE = 0.4;
  var MAX_SCALE = 2.5;
  var SCALE_STEP = 0.1;

  function clampScale(s) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(s * 100) / 100));
  }

  /* El tamaño se aplica con `scale`, no tocando width/height: así funciona
     igual con un texto, una imagen o una tarjeta entera, sin romper el
     diseño responsive de alrededor. El `transform-origin` queda en el centro
     para que el elemento crezca hacia los dos lados y no se corra. */
  function writeTransform(el, dx, dy, scale) {
    var cs = getComputedStyle(el);
    if (cs.position === "static") el.style.position = "relative";
    var t = "translate(" + (dx || 0) + "px," + (dy || 0) + "px)";
    if (scale && scale !== 1) t += " scale(" + clampScale(scale) + ")";
    el.style.transform = t;
  }

  function applyOverride(selector, ov) {
    var el;
    try { el = document.querySelector(selector); } catch (e) { return; }
    if (!el) return;

    var hasMove = typeof ov.dx === "number" || typeof ov.dy === "number";
    var hasScale = typeof ov.scale === "number" && ov.scale !== 1;
    if (hasMove || hasScale) writeTransform(el, ov.dx, ov.dy, ov.scale);
    if (typeof ov.text === "string") el.textContent = ov.text;
  }

  function loadAndApplyOverrides(cb) {
    fetch(EDITOR_API + "?action=get&page=" + pageSlug() + "&breakpoint=" + currentBreakpoint(), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          overrides = asOverridesMap(res.elements);
          Object.keys(overrides).forEach(function (sel) { applyOverride(sel, overrides[sel]); });
        }
        if (cb) cb();
      })
      .catch(function () { if (cb) cb(); });
  }

  function saveOverrides() {
    var btn = $("[data-editor-save]");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    fetch(EDITOR_API + "?action=save", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: pageSlug(), breakpoint: currentBreakpoint(), elements: overrides })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = res && res.ok ? "✓ Guardado" : "💾 Guardar";
          if (res && res.ok) { dirty = false; setTimeout(function () { btn.textContent = "💾 Guardar"; }, 1800); }
        }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = "💾 Guardar"; }
        alert("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
      });
  }

  function resetOverrides() {
    if (!confirm("¿Quitar todos los cambios guardados de esta página en este dispositivo? Esta acción no se puede deshacer.")) return;
    fetch(EDITOR_API + "?action=reset", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: pageSlug(), breakpoint: currentBreakpoint() })
    }).then(function () { location.reload(); })
      .catch(function () { alert("No se pudo restablecer. Intenta de nuevo."); });
  }

  /* ---------------------------------------------------------------
     Estado del editor
     --------------------------------------------------------------- */
  var state = { active: false, selected: null };
  var drag = null; // {el, selector, holdTimer, armed, moved, startX, startY, startDx, startDy, originalRect}
  var editingText = null; // elemento con contenteditable activo

  var els = {};

  function buildUi() {
    var toolbar = document.createElement("div");
    toolbar.className = "editor-toolbar";
    toolbar.setAttribute(EDITOR_UI_ATTR, "");
    toolbar.hidden = true;
    toolbar.innerHTML =
      '<span class="editor-toolbar-title">✏️ Modo edición</span>' +
      '<button type="button" class="editor-toolbar-btn" data-editor-undo disabled title="Próximamente">↶ Deshacer</button>' +
      '<button type="button" class="editor-toolbar-btn" data-editor-redo disabled title="Próximamente">↷ Rehacer</button>' +
      '<button type="button" class="editor-toolbar-btn" data-editor-save>💾 Guardar</button>' +
      '<button type="button" class="editor-toolbar-btn" data-editor-reset>♻️ Restablecer</button>' +
      '<button type="button" class="editor-toolbar-btn is-exit" data-editor-exit>✕ Salir</button>';
    document.body.appendChild(toolbar);

    var hint = document.createElement("div");
    hint.className = "editor-hint";
    hint.setAttribute(EDITOR_UI_ATTR, "");
    hint.hidden = true;
    hint.textContent = "Mantén presionado y arrastra para mover · doble clic para editar el texto · − / + para el tamaño";
    document.body.appendChild(hint);

    var hoverBox = document.createElement("div");
    hoverBox.className = "editor-hover-box";
    hoverBox.setAttribute(EDITOR_UI_ATTR, "");
    hoverBox.hidden = true;
    document.body.appendChild(hoverBox);

    var selectBox = document.createElement("div");
    selectBox.className = "editor-select-box";
    selectBox.setAttribute(EDITOR_UI_ATTR, "");
    selectBox.hidden = true;
    selectBox.innerHTML = '<span class="editor-select-label" data-editor-select-label></span>';
    document.body.appendChild(selectBox);

    var panel = document.createElement("div");
    panel.className = "editor-side-panel";
    panel.setAttribute(EDITOR_UI_ATTR, "");
    panel.innerHTML =
      '<button type="button" class="editor-side-panel-close" data-editor-panel-close aria-label="Cerrar">✕</button>' +
      '<h4>Elemento seleccionado</h4>' +
      '<div data-editor-panel-body><p class="editor-side-panel-empty">Haz clic sobre cualquier texto, imagen, botón, contenedor, sección o botón flotante para seleccionarlo.</p></div>';
    document.body.appendChild(panel);

    els.toolbar = toolbar;
    els.hint = hint;
    els.hoverBox = hoverBox;
    els.selectBox = selectBox;
    els.selectLabel = $("[data-editor-select-label]", selectBox);
    els.panel = panel;
    els.panelBody = $("[data-editor-panel-body]", panel);

    $("[data-editor-exit]", toolbar).addEventListener("click", deactivate);
    $("[data-editor-panel-close]", panel).addEventListener("click", clearSelection);
    $("[data-editor-save]", toolbar).addEventListener("click", saveOverrides);
    $("[data-editor-reset]", toolbar).addEventListener("click", resetOverrides);
  }

  function positionBox(box, rect) {
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
  }

  function selectElement(el) {
    state.selected = el;
    els.hoverBox.hidden = true;
    els.selectBox.hidden = false;
    positionBox(els.selectBox, el.getBoundingClientRect());
    els.selectLabel.textContent = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");

    var selector = getStableSelector(el);
    var canEditText = isTextEditable(el);
    els.panelBody.innerHTML =
      '<div class="editor-size-row">' +
        '<label>Tamaño</label>' +
        '<div class="editor-size-controls">' +
          '<button type="button" data-editor-scale="-1" aria-label="Reducir">−</button>' +
          '<span class="editor-size-val" data-editor-scale-val></span>' +
          '<button type="button" data-editor-scale="1" aria-label="Agrandar">+</button>' +
          '<button type="button" class="editor-size-reset" data-editor-scale="0">↺</button>' +
        '</div>' +
      '</div>' +
      (canEditText ? '<button type="button" class="editor-toolbar-btn editor-panel-edit-text" data-editor-edit-text>✏️ Editar este texto</button>' : "") +
      '<div class="editor-side-panel-row"><label>Etiqueta</label><div class="val">' + el.tagName.toLowerCase() + '</div></div>' +
      '<div class="editor-side-panel-row"><label>Clases</label><div class="val">' + escHTML(el.className && typeof el.className === "string" ? el.className : "(ninguna)") + '</div></div>' +
      '<div class="editor-side-panel-row"><label>Texto</label><div class="val">' + escHTML(textPreview(el)) + '</div></div>' +
      '<div class="editor-side-panel-row"><label>Selector estable</label><div class="val">' + escHTML(selector) + '</div></div>';

    var valEl = $("[data-editor-scale-val]", els.panelBody);
    function paintScale() {
      valEl.textContent = Math.round(currentScale(el) * 100) + "%";
    }
    paintScale();

    Array.prototype.forEach.call(els.panelBody.querySelectorAll("[data-editor-scale]"), function (btn) {
      btn.addEventListener("click", function () {
        var dir = Number(btn.getAttribute("data-editor-scale"));
        var next = dir === 0 ? 1 : clampScale(currentScale(el) + dir * SCALE_STEP);
        var t = currentTranslate(el);
        writeTransform(el, t.dx, t.dy, next);
        overrides[selector] = Object.assign({}, overrides[selector], { dx: t.dx, dy: t.dy, scale: next });
        dirty = true;
        paintScale();
        positionBox(els.selectBox, el.getBoundingClientRect());
      });
    });

    if (canEditText) {
      $("[data-editor-edit-text]", els.panelBody).addEventListener("click", function () { startTextEdit(el); });
    }
    els.panel.classList.add("is-open");
  }

  function clearSelection() {
    state.selected = null;
    els.selectBox.hidden = true;
    els.panel.classList.remove("is-open");
    els.panelBody.innerHTML = '<p class="editor-side-panel-empty">Haz clic sobre cualquier texto, imagen, botón, contenedor, sección o botón flotante para seleccionarlo.</p>';
  }

  function escHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------
     Mover: mantener presionado (mouse o dedo) y arrastrar. Se acota
     siempre dentro del contenedor padre (o del viewport si el
     elemento es `position: fixed`, como los botones flotantes).
     --------------------------------------------------------------- */
  function currentTranslate(el) {
    var m = (el.style.transform || "").match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    return m ? { dx: parseFloat(m[1]), dy: parseFloat(m[2]) } : { dx: 0, dy: 0 };
  }

  function currentScale(el) {
    var m = (el.style.transform || "").match(/scale\(([\d.]+)\)/);
    return m ? parseFloat(m[1]) : 1;
  }

  /* Antes cada elemento solo se podía mover dentro de la caja de su padre —
     en la práctica eso significaba que casi nada se movía: un título ocupa
     todo el ancho de su contenedor, así que el margen para moverlo era cero.
     Ahora el límite es la PANTALLA: se puede llevar cualquier bloque a
     donde sea, con la única condición de que no se salga de vista.

     El límite sigue existiendo por dos motivos: el `overflow-x: clip` del
     body recorta cualquier cosa que pase del ancho de la pantalla (quedaría
     invisible), y un elemento arrastrado fuera de vista ya no se podría
     volver a agarrar para devolverlo. */
  var KEEP_VISIBLE_PX = 48;

  function clampDelta(el, rectAtStart, dx, dy) {
    var w = rectAtStart.width || 1;
    var h = rectAtStart.height || 1;
    // cuánto del elemento debe seguir dentro de la pantalla
    var keepX = Math.min(KEEP_VISIBLE_PX, w);
    var keepY = Math.min(KEEP_VISIBLE_PX, h);

    var minDx = -rectAtStart.right + keepX;
    var maxDx = window.innerWidth - rectAtStart.left - keepX;
    var minDy = -rectAtStart.bottom + keepY;
    var maxDy = window.innerHeight - rectAtStart.top - keepY;

    return {
      dx: Math.round(Math.max(minDx, Math.min(maxDx, dx))),
      dy: Math.round(Math.max(minDy, Math.min(maxDy, dy)))
    };
  }

  function onPointerDown(e) {
    if (!state.active) return;
    if (e.target.closest && e.target.closest("[" + EDITOR_UI_ATTR + "]")) return;
    if (editingText) return; // deja escribir normalmente dentro del texto en edición

    var target = resolveTarget(e.clientX, e.clientY);
    if (!isEditableCandidate(target)) return;

    var start = currentTranslate(target);
    drag = {
      el: target,
      startX: e.clientX,
      startY: e.clientY,
      startDx: start.dx,
      startDy: start.dy,
      originalRect: target.getBoundingClientRect(),
      armed: false,
      moved: false,
      holdTimer: setTimeout(function () {
        if (drag) { drag.armed = true; drag.el.classList.add("is-editor-dragging"); }
      }, HOLD_MS)
    };
  }

  function onPointerMoveDrag(e) {
    if (!state.active || !drag) { onHover(e); return; }
    var dxRaw = e.clientX - drag.startX;
    var dyRaw = e.clientY - drag.startY;
    if (!drag.armed) {
      if (Math.hypot(dxRaw, dyRaw) > MOVE_THRESHOLD) {
        clearTimeout(drag.holdTimer);
        drag.armed = true;
        drag.el.classList.add("is-editor-dragging");
      } else {
        return;
      }
    }
    drag.moved = true;
    els.hoverBox.hidden = true;
    var clamped = clampDelta(drag.el, drag.originalRect, drag.startDx + dxRaw, drag.startDy + dyRaw);
    // se conserva la escala: si no, arrastrar un elemento agrandado lo devolvía a su tamaño
    writeTransform(drag.el, clamped.dx, clamped.dy, currentScale(drag.el));
    positionBox(els.selectBox, drag.el.getBoundingClientRect());
    els.selectLabel.textContent = "moviendo…";
  }

  function onHover(e) {
    if (!state.active || drag) return;
    var target = resolveTarget(e.clientX, e.clientY);
    if (!isEditableCandidate(target) || target === state.selected) {
      els.hoverBox.hidden = true;
      return;
    }
    els.hoverBox.hidden = false;
    positionBox(els.hoverBox, target.getBoundingClientRect());
  }

  function onPointerUp() {
    if (!drag) return;
    clearTimeout(drag.holdTimer);
    var d = drag;
    drag = null;
    d.el.classList.remove("is-editor-dragging");

    if (d.armed && d.moved) {
      var t = currentTranslate(d.el);
      var selector = getStableSelector(d.el);
      overrides[selector] = Object.assign({}, overrides[selector], { dx: t.dx, dy: t.dy });
      dirty = true;
    }
    selectElement(d.el);
  }

  /* ---------------------------------------------------------------
     Editar texto: doble clic sobre un elemento de texto activa
     contenteditable temporalmente; al salir del foco se guarda como
     override.
     --------------------------------------------------------------- */
  function startTextEdit(el) {
    if (editingText === el) return;
    if (editingText) finishTextEdit(editingText);
    editingText = el;
    el.setAttribute("contenteditable", "true");
    el.classList.add("is-editor-editing-text");
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function onBlur() {
      el.removeEventListener("blur", onBlur);
      finishTextEdit(el);
    }
    el.addEventListener("blur", onBlur);
  }

  function finishTextEdit(el) {
    el.removeAttribute("contenteditable");
    el.classList.remove("is-editor-editing-text");
    if (editingText === el) editingText = null;
    var selector = getStableSelector(el);
    var text = (el.textContent || "").trim();
    overrides[selector] = Object.assign({}, overrides[selector], { text: text });
    dirty = true;
    if (state.selected === el) selectElement(el);
  }

  function onDblClick(e) {
    if (!state.active) return;
    if (e.target.closest && e.target.closest("[" + EDITOR_UI_ATTR + "]")) return;
    var target = resolveTarget(e.clientX, e.clientY);
    if (!isEditableCandidate(target) || !isTextEditable(target)) return;
    e.preventDefault();
    e.stopPropagation();
    startTextEdit(target);
  }

  function onClickCapture(e) {
    if (!state.active) return;
    if (e.target.closest && e.target.closest("[" + EDITOR_UI_ATTR + "]")) return;
    if (editingText) return; // deja los clics normales dentro del texto que se está editando

    // Bloquea la funcionalidad real de la página mientras se edita
    // (enlaces, botones de premio, WhatsApp, etc.) para poder
    // seleccionar/mover sin disparar su acción normal.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // La selección real ya ocurrió en onPointerUp (cubre clic simple y
    // arrastre); aquí solo evitamos que el clic dispare la acción real.
    if (!drag) {
      var target = resolveTarget(e.clientX, e.clientY);
      if (!isEditableCandidate(target)) clearSelection();
    }
  }

  function onScrollOrResize() {
    if (!state.active) return;
    if (state.selected) positionBox(els.selectBox, state.selected.getBoundingClientRect());
    els.hoverBox.hidden = true;
  }

  function onKeydown(e) {
    if (!state.active) return;
    if (e.key === "Escape") {
      if (editingText) finishTextEdit(editingText);
      clearSelection();
    }
  }

  function beforeUnload(e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  }

  function activate() {
    if (state.active) return;
    if (!els.toolbar) buildUi();
    state.active = true;
    document.body.classList.add("editor-mode");
    els.toolbar.hidden = false;
    els.hint.hidden = false;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMoveDrag, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("beforeunload", beforeUnload);
  }

  function deactivate() {
    if (!state.active) return;
    if (editingText) finishTextEdit(editingText);
    state.active = false;
    document.body.classList.remove("editor-mode");
    if (els.toolbar) els.toolbar.hidden = true;
    if (els.hint) els.hint.hidden = true;
    if (els.hoverBox) els.hoverBox.hidden = true;
    clearSelection();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMoveDrag, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("click", onClickCapture, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("beforeunload", beforeUnload);
  }

  /* ---------------------------------------------------------------
     Autenticación — reutiliza exactamente el login del panel de
     administrador (api/content.php). La clave nunca se guarda en JS
     ni en el navegador; solo se reenvía una vez al servidor, que
     responde con una cookie de sesión httponly.
     --------------------------------------------------------------- */
  function checkAuth(cb) {
    fetch(CONTENT_API + "?action=check", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) { cb(!!(res && res.ok && res.authed)); })
      .catch(function () { cb(false); });
  }

  function showLoginModal() {
    var modal = document.createElement("div");
    modal.className = "editor-login-modal";
    modal.setAttribute(EDITOR_UI_ATTR, "");
    modal.innerHTML =
      '<div class="editor-login-card">' +
      '<h3>✏️ Editar página</h3>' +
      '<p>Escribe la clave de administrador para activar el modo edición.</p>' +
      '<input type="password" class="editor-login-input" data-editor-login-password placeholder="Clave" autocomplete="current-password">' +
      '<p class="editor-login-error" data-editor-login-error hidden></p>' +
      '<div class="editor-login-actions">' +
      '<button type="button" class="btn btn-ghost" data-editor-login-cancel>Cancelar</button>' +
      '<button type="button" class="btn btn-primary" data-editor-login-submit>Entrar</button>' +
      '</div></div>';
    document.body.appendChild(modal);

    var input = $("[data-editor-login-password]", modal);
    var errorEl = $("[data-editor-login-error]", modal);
    var submitBtn = $("[data-editor-login-submit]", modal);

    function close() { modal.remove(); }

    function attempt() {
      var password = input.value;
      if (!password) return;
      errorEl.hidden = true;
      submitBtn.disabled = true;
      fetch(CONTENT_API + "?action=login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          submitBtn.disabled = false;
          if (res && res.ok) {
            close();
            activate();
          } else {
            errorEl.textContent = (res && res.error) || "No se pudo entrar.";
            errorEl.hidden = false;
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          errorEl.textContent = "No se pudo conectar con el servidor.";
          errorEl.hidden = false;
        });
    }

    submitBtn.addEventListener("click", attempt);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") attempt(); });
    $("[data-editor-login-cancel]", modal).addEventListener("click", close);
    input.focus();
  }

  function openEditor() {
    checkAuth(function (authed) {
      if (authed) activate();
      else showLoginModal();
    });
  }

  /* ---------------------------------------------------------------
     Punto de entrada — botón discreto debajo del link "Admin" del
     footer, más la entrada directa desde el panel de administrador
     (?editor=1). Los overrides guardados se cargan y aplican SIEMPRE,
     haya o no sesión, para que los cambios publicados se vean para
     todos los visitantes.
     --------------------------------------------------------------- */
  function init() {
    loadAndApplyOverrides();

    var footerAdmin = $(".footer-admin");
    if (footerAdmin && !$(".editor-entry-btn")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "editor-entry-btn";
      btn.textContent = "✏️ Editar página";
      btn.addEventListener("click", openEditor);
      footerAdmin.insertAdjacentElement("afterend", btn);
    }

    if (/[?&]editor=1(&|$)/.test(location.search)) {
      var cleanUrl = location.pathname + location.hash;
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", cleanUrl);
      checkAuth(function (authed) { if (authed) activate(); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
