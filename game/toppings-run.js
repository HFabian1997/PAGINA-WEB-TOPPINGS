/**
 * TOPPINGS RUN — prototipo inspirado en el juego del dinosaurio sin
 * internet, con más gráficos (fondo urbano en paralaje, partículas de
 * velocidad) y nuevas mecánicas (vidas, monedas + récord, power-ups,
 * rampas con trucos). Los personajes usan las imágenes reales recortadas
 * de las hojas de sprites (game/assets/skate.png y bmx.png) — si por
 * algún motivo no cargan, cae de vuelta a las figuras vectoriales.
 *
 * Archivo separado de main.js a propósito: se inicializa solo (no depende
 * de main.js ni main.js depende de él), buscando sus propios elementos por
 * atributos data-run-*. Si esos elementos no existen en la página, no hace
 * nada.
 */
(function () {
  "use strict";

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Misma llave que usa el resto del sitio (cronómetro, fidelidad, reto,
  // asistente) para el nombre del cliente — así si ya lo dio en cualquier
  // otra parte, el juego lo reconoce sin volver a pedirlo.
  var NAME_KEY = "toppings_loyalty_name";
  var RECORD_KEY = "toppings_run_record";
  var DEVICE_KEY = "toppings_run_device_id";
  var LEADERBOARD_API = "api/run-leaderboard.php";

  // Identificador de dispositivo persistente (no hay cuentas/login): esto es
  // lo único que el servidor confía para saber "quién" reclama el premio —
  // el nombre por sí solo se puede repetir/spoofear, el deviceId no viaja
  // en el HTML visible ni se puede fabricar desde las herramientas del
  // navegador sin ya tener acceso a localStorage de ESE dispositivo.
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

  /* ---- Sonido retro (sintetizado en el momento, sin archivos de audio —
     así el juego no depende de descargar nada ni de derechos de autor) ---- */
  var runAudioCtx = null;
  function getRunAudioCtx() {
    try {
      if (!runAudioCtx) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) runAudioCtx = new Ctx();
      }
      if (runAudioCtx && runAudioCtx.state === "suspended") runAudioCtx.resume();
      return runAudioCtx;
    } catch (e) { return null; }
  }

  function retroBeep(freq, duration, type, startDelay, volume) {
    var ctx = getRunAudioCtx();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || "square";
      osc.frequency.value = freq;
      var start = ctx.currentTime + (startDelay || 0);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume || 0.16, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch (e) {}
  }

  function sfxJump() {
    var ctx = getRunAudioCtx();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "square";
      var start = ctx.currentTime;
      osc.frequency.setValueAtTime(240, start);
      osc.frequency.exponentialRampToValueAtTime(680, start + 0.11);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    } catch (e) {}
  }

  function sfxCoin() {
    retroBeep(988, 0.09, "square", 0, 0.13);
    retroBeep(1319, 0.11, "square", 0.05, 0.13);
  }

  function sfxPowerup() {
    retroBeep(523, 0.08, "triangle", 0, 0.15);
    retroBeep(784, 0.08, "triangle", 0.07, 0.15);
    retroBeep(1047, 0.12, "triangle", 0.14, 0.15);
  }

  function sfxHit() {
    var ctx = getRunAudioCtx();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sawtooth";
      var start = ctx.currentTime;
      osc.frequency.setValueAtTime(180, start);
      osc.frequency.exponentialRampToValueAtTime(55, start + 0.24);
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.28);
    } catch (e) {}
  }

  function sfxGameOver() {
    [392, 349.23, 293.66, 220].forEach(function (f, i) {
      retroBeep(f, 0.3, "square", i * 0.15, 0.15);
    });
  }

  /* Bajo en loop mientras se juega, tipo chiptune — se detiene al chocar o
     salir. Si el admin sube un archivo de música real (dailyPrize.
     toppingsRun.musicFile), esa pista real reemplaza el loop sintetizado;
     si no hay ninguna subida, el comportamiento de siempre no cambia. */
  var runBgMusicTimer = null;
  var runBgAudioEl = null;
  var RUN_BG_PATTERN = [110, 110, 146.83, 110, 130.81, 98, 110, 130.81];
  var RUN_BG_STEP_S = 0.16;

  function runInfo() {
    return (window.__BRAND__ && window.__BRAND__.dailyPrize && window.__BRAND__.dailyPrize.toppingsRun) || {};
  }

  function runMusicConfig() {
    var info = runInfo();
    return {
      file: info.musicFile || "",
      volume: typeof info.musicVolume === "number" ? info.musicVolume : 0.5
    };
  }

  /* ---------------- Escenarios ----------------
     El fondo era uno solo, escrito a mano dentro del dibujo. Ahora es una
     tabla: cada escenario dice de qué color es su cielo, qué silueta va al
     fondo, de qué color es el piso y qué cosas aparecen. El código de dibujo
     es el mismo para los cuatro; lo único que cambia son estos datos.

     `acento` es el color de marca del escenario: tiñe ventanas, luces y
     carteles. Es lo que hace que cada mundo se sienta distinto sin tener que
     escribir un dibujo aparte para cada uno. */
  var ESCENARIOS = {
    ciudad: {
      nombre: "Ciudad TOPPINGS",
      cielo: [[0, "#241631"], [0.55, "#8a3f2c"], [1, "#3a2418"]],
      acento: "255,212,0",
      astro: "luna",
      estrellas: 28, nubes: 5, neblina: 0,
      fondo: "cerros",
      piso: ["#3b3340", "#2a2430", "#171220"],
      carril: "255,232,150",
      props: ["poste", "hidrante", "cono", "caja", "barril"],
      marca: "neon"
    },
    universidad: {
      nombre: "Zona Universitaria",
      cielo: [[0, "#140f2a"], [0.5, "#33245c"], [1, "#241a38"]],
      acento: "255,212,0",
      astro: "luna",
      estrellas: 34, nubes: 3, neblina: 0,
      fondo: "arboles",
      piso: ["#4c4754", "#37333f", "#201d28"],   // concreto, no asfalto
      carril: "230,230,240",
      props: ["poste", "banca", "basura", "cono"],
      marca: "grafiti"
    },
    extrema: {
      nombre: "Noche Extrema",
      cielo: [[0, "#07070f", ], [0.55, "#161628"], [1, "#0a0a14"]],
      acento: "255,70,70",
      astro: "lunaPalida",
      estrellas: 16, nubes: 2, neblina: 0,
      fondo: "puente",
      piso: ["#33333d", "#22222b", "#111119"],
      carril: "255,120,120",
      props: ["torre", "contenedor", "cono"],
      marca: "chorreado",
      rayos: true
    },
    amanecer: {
      nombre: "Amanecer en el Valle",
      cielo: [[0, "#3a2150"], [0.45, "#d9663a"], [0.8, "#f2a95f"], [1, "#f6c98a"]],
      acento: "255,150,30",
      astro: "sol",
      estrellas: 4, nubes: 8, neblina: 0.16,
      fondo: "cerros",
      piso: ["#59493c", "#41352d", "#2a221d"],   // tierra
      carril: "255,240,200",
      props: ["poste", "cono", "caja"],
      marca: "neon"
    }
  };
  /* ---- Los cuatro de temporada ----
     Mismos campos que los otros. `chispas` es lo que cae del cielo (nieve,
     corazones, confeti) y `luces` pinta las ventanas de colores en vez del
     amarillo de siempre. */
  ESCENARIOS.navidad = {
    nombre: "Navidad",
    cielo: [[0, "#04101f"], [0.55, "#0d2b47"], [1, "#123049"]],
    acento: "255,80,80",
    astro: "luna",
    estrellas: 40, nubes: 3, neblina: 0.05,
    fondo: "cerros",
    piso: ["#e8eef5", "#c3cfdb", "#8a99a8"],   // nieve pisada
    carril: "255,255,255",
    props: ["poste", "cono", "caja"],
    marca: "neon",
    chispas: "nieve",
    luces: ["255,80,80", "90,220,120", "255,212,0"]
  };
  ESCENARIOS.amor = {
    nombre: "Amor",
    cielo: [[0, "#3d1533"], [0.5, "#b0446a"], [1, "#f0949c"]],
    acento: "255,110,150",
    astro: "sol",
    estrellas: 8, nubes: 7, neblina: 0.12,
    fondo: "cerros",
    piso: ["#5c3a48", "#452c37", "#2c1c24"],
    carril: "255,200,220",
    props: ["poste", "banca", "cono"],
    marca: "neon",
    chispas: "corazones",
    luces: ["255,110,150", "255,180,200"]
  };
  ESCENARIOS.halloween = {
    nombre: "Halloween",
    cielo: [[0, "#0c0716"], [0.5, "#241141"], [1, "#3d2a12"]],
    acento: "255,140,20",
    astro: "lunaGigante",
    estrellas: 22, nubes: 4, neblina: 0.18,
    fondo: "arboles",
    piso: ["#3a3330", "#282320", "#151210"],
    carril: "170,255,120",
    props: ["poste", "basura", "cono"],
    marca: "chorreado",
    chispas: "murcielagos",
    luces: ["255,140,20", "170,255,120"]
  };
  ESCENARIOS.fiesta = {
    nombre: "Fiesta",
    cielo: [[0, "#170a33"], [0.5, "#3d1466"], [1, "#5c1a5c"]],
    acento: "255,212,0",
    astro: "luna",
    estrellas: 30, nubes: 2, neblina: 0,
    fondo: "cerros",
    piso: ["#413454", "#2e2540", "#1a142a"],
    carril: "255,255,255",
    props: ["poste", "cono", "caja"],
    marca: "neon",
    chispas: "confeti",
    luces: ["255,80,80", "90,220,255", "255,212,0", "180,120,255", "120,255,150"]
  };

  var ORDEN_ESCENARIOS = ["ciudad", "universidad", "extrema", "amanecer"];

  /* Qué temporada es hoy. Fiesta no está: ese no tiene fecha, lo pone Fabián
     cuando hay un evento en el local. */
  function escenarioDeTemporada() {
    var d = new Date();
    var mes = d.getMonth() + 1, dia = d.getDate();
    if ((mes === 10 && dia >= 20) || (mes === 11 && dia <= 2)) return "halloween";
    if ((mes === 12) || (mes === 1 && dia <= 6)) return "navidad";
    if (mes === 2 && dia >= 7 && dia <= 20) return "amor";
    return null;
  }

  /** Cuál toca. "rotar" va cambiando en cada partida. */
  function elegirEscenario() {
    var info = runInfo();
    var pedido = String(info.escenario || "ciudad");

    /* La temporada manda, salvo que Fabián apague el interruptor. Así en
       diciembre sale el de Navidad sin que tenga que acordarse, y aun así
       puede forzar el que quiera apagándolo. */
    var usarTemporada = info.escenarioTemporada === undefined ? true : !!info.escenarioTemporada;
    if (pedido === "auto" || usarTemporada) {
      var temp = escenarioDeTemporada();
      if (temp) return ESCENARIOS[temp];
    }
    // "auto" fuera de temporada cae en la ciudad
    if (pedido === "auto") return ESCENARIOS.ciudad;

    if (pedido === "rotar") {
      // se guarda cuál salió la última vez, para no repetir dos seguidas
      var ultimo = "";
      try { ultimo = localStorage.getItem("toppings_run_escenario") || ""; } catch (e) {}
      var opciones = ORDEN_ESCENARIOS.filter(function (k) { return k !== ultimo; });
      pedido = opciones[Math.floor(Math.random() * opciones.length)];
      try { localStorage.setItem("toppings_run_escenario", pedido); } catch (e) {}
    }
    return ESCENARIOS[pedido] || ESCENARIOS.ciudad;
  }

  /** Las frases de las vallas, las que escriba el negocio en el panel. */
  function frasesDeMarca() {
    var f = runInfo().frases;
    if (!Array.isArray(f)) return [];
    return f.map(function (x) {
      return String((x && typeof x === "object" ? x.texto : x) || "").trim();
    }).filter(function (t) { return t !== ""; }).slice(0, 12);
  }

  function startRunBgMusic() {
    stopRunBgMusic();
    var cfg = runMusicConfig();
    if (cfg.file) {
      if (!runBgAudioEl) runBgAudioEl = new Audio();
      runBgAudioEl.src = cfg.file;
      runBgAudioEl.loop = true;
      runBgAudioEl.volume = cfg.volume;
      runBgAudioEl.currentTime = 0;
      runBgAudioEl.play().catch(function () {});
      return;
    }
    var ctx = getRunAudioCtx();
    if (!ctx) return;
    var step = 0;
    function playStep() {
      var note = RUN_BG_PATTERN[step % RUN_BG_PATTERN.length];
      retroBeep(note, RUN_BG_STEP_S * 0.85, "triangle", 0, 0.07);
      if (step % 4 === 0) retroBeep(note / 2, RUN_BG_STEP_S * 1.6, "square", 0, 0.04);
      step++;
    }
    playStep();
    runBgMusicTimer = setInterval(playStep, RUN_BG_STEP_S * 1000);
  }
  function stopRunBgMusic() {
    if (runBgMusicTimer) clearInterval(runBgMusicTimer);
    runBgMusicTimer = null;
    if (runBgAudioEl) { runBgAudioEl.pause(); runBgAudioEl.currentTime = 0; }
  }

  function boot() {
    var card = document.querySelector('[data-prize-method="toppingsRun"]');
    if (!card) return;

    var stages = {
      intro: $('[data-run-stage="intro"]', card),
      select: $('[data-run-stage="select"]', card),
      name: $('[data-run-stage="name"]', card),
      game: $('[data-run-stage="game"]', card)
    };
    var playBtn = $("[data-run-play]", card);
    var chooseBtns = $$("[data-run-choose]", card);
    var nameForm = $("[data-run-name-form]", card);
    var nameInput = $("[data-run-name-input]", card);
    var canvasWrap = $("[data-run-canvas-wrap]", card);
    var canvas = $("[data-run-canvas]", card);
    var playerEl = $("[data-run-player]", card);
    var livesEl = $("[data-run-lives]", card);
    var coinsEl = $("[data-run-coins]", card);
    var scoreEl = $("[data-run-score]", card);
    var recordEl = $("[data-run-record]", card);
    var multiEl = $("[data-run-multi]", card);
    var powerupBarEl = $("[data-run-powerup-bar]", card);
    var overlay = $("[data-run-overlay]", card);
    var finalScoreEl = $("[data-run-final-score]", card);
    var leaderboardEl = $("[data-run-leaderboard]", card);
    var leaderboardListEl = $("[data-run-leaderboard-list]", card);
    var leaderboardCountdownEl = $("[data-run-leaderboard-countdown]", card);
    var introLeaderboardEl = $("[data-run-leaderboard-intro]", card);
    var introLeaderboardListEl = $("[data-run-leaderboard-intro-list]", card);
    var introLeaderboardTitleEl = $("[data-run-leaderboard-intro-title]", card);
    var claimEl = $("[data-run-claim]", card);
    var claimBtn = $("[data-run-claim-btn]", card);
    var claimCountdownEl = $("[data-run-claim-countdown]", card);
    var eventCountdownEl = $("[data-run-event-countdown]", card);
    var statusEl = $("[data-run-status]", card);
    var prevWinnerEl = $("[data-run-prev-winner]", card);
    var backBtn = $("[data-run-back]", card);
    var restartBtn = $("[data-run-restart]", card);
    var homeBtn = $("[data-run-home]", card);
    var exitBtn = $("[data-run-exit]", card);
    var hintEl = $("[data-run-hint]", card);
    if (!canvas || !canvasWrap || !playBtn) return;

    var ctx = canvas.getContext("2d");

    // Imágenes reales de los personajes (recortadas de las hojas que pasó
    // Fabián y con el fondo ya quitado). Si por algún motivo no cargan
    // todavía, drawCharacter() cae de vuelta a las figuras vectoriales de
    // siempre, así el juego nunca se rompe por esto.
    var skateImg = new Image();
    skateImg.src = "game/assets/skate.png";
    var bmxImg = new Image();
    bmxImg.src = "game/assets/bmx.png";

    /* El juego es una de las tarjetas del carrusel horizontal de premios.
       Al pasar a pantalla completa la tarjeta sale del flujo (position: fixed),
       el carrusel se queda sin ese ancho y el navegador reajusta su
       desplazamiento — por eso, al salir del juego, se veía "deslizarse solo"
       de vuelta a la primera opción. Aquí se recuerda dónde estaba y se
       restaura de golpe al volver. */
    var methodsWrap = document.querySelector("[data-prize-methods]");
    var savedMethodsScroll = 0;

    function showStage(name) {
      var goingFullscreen = name === "game";
      var wasFullscreen = card.classList.contains("is-fullscreen");
      if (methodsWrap && goingFullscreen && !wasFullscreen) {
        savedMethodsScroll = methodsWrap.scrollLeft;
      }

      Object.keys(stages).forEach(function (k) {
        if (stages[k]) stages[k].hidden = k !== name;
      });
      // Mientras se juega, la tarjeta pasa a pantalla completa para que se
      // vea todo grande (antes el canvas quedaba chico, embebido entre el
      // resto del carrusel de premios) — al salir vuelve a su tamaño normal.
      card.classList.toggle("is-fullscreen", goingFullscreen);
      document.body.classList.toggle("run-no-scroll", goingFullscreen);

      if (methodsWrap && !goingFullscreen && wasFullscreen) {
        var restore = function () {
          var prev = methodsWrap.style.scrollBehavior;
          methodsWrap.style.scrollBehavior = "auto"; // sin animación: que no se vea el salto
          methodsWrap.scrollLeft = savedMethodsScroll;
          methodsWrap.style.scrollBehavior = prev;
        };
        restore();
        // y otra vez tras el reflujo, por si el navegador lo reajusta después
        requestAnimationFrame(restore);
      }

      // El carrusel de premios se congela mientras se juega; al salir hay que
      // avisarle para que vuelva a arrancar solo.
      if (!goingFullscreen && wasFullscreen && window.__prizeAutoRefresh) {
        window.__prizeAutoRefresh();
      }
    }

    /* ---- tamaño del canvas: 100% del ancho de su tarjeta, nunca más — así
       nunca causa desplazamiento horizontal de la página. ---- */
    var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
    function resizeCanvas(forzar) {
      var rect = canvasWrap.getBoundingClientRect();
      var nuevoW = Math.max(240, Math.round(rect.width));
      var nuevoH = Math.max(140, Math.round(rect.height));

      /* En el celular, esconder o mostrar la barra de direcciones cambia el
         alto de la ventana y dispara un `resize`. Si redimensionáramos ahí,
         el lienzo se estiraría y encogería en plena partida — que es justo
         lo que se veía. Un cambio CHICO de alto sin cambio de ancho es la
         barra; una rotación cambia el ancho o mueve el alto muchísimo. */
      if (!forzar && W && state && !state.over) {
        var mismoAncho = nuevoW === W;
        var cambioDeAlto = H ? Math.abs(nuevoH - H) / H : 1;
        if (mismoAncho && cambioDeAlto < 0.15) return;
      }

      W = nuevoW;
      H = nuevoH;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      olvidarDegradados();   // los que dependen del tamaño hay que rehacerlos
    }

    /* ---- degradados guardados ----
       Armar un degradado no es gratis: el navegador tiene que construir la
       rampa de colores. Hacerlo en CADA cuadro son cientos de objetos por
       segundo que después hay que recoger; un celular potente lo absorbe sin
       enterarse, uno viejo se traba. Acá se arman una vez y se reusan.

       Los que dependen del tamaño del lienzo se olvidan al redimensionar
       (resizeCanvas los borra). Los de las monedas y el brillo se dibujan en
       coordenadas locales —adentro de un translate— así que valen siempre. */
    var degradados = {};
    function olvidarDegradados() { degradados = {}; }
    var TOPE_DEGRADADOS = 120;
    function degradado(clave, armar) {
      var g = degradados[clave];
      if (!g) {
        // si alguna clave variara más de lo previsto, se vacía y se empieza de
        // nuevo: nunca crece sin control
        if (Object.keys(degradados).length > TOPE_DEGRADADOS) degradados = {};
        g = armar();
        degradados[clave] = g;
      }
      return g;
    }

    /* ---- constantes del juego ---- */
    var GROUND_H = 26;
    var CHAR_X_RATIO = 0.16; // el personaje siempre queda fijo en esta posición horizontal
    var CHAR_SIZE = 34;
    var GRAVITY = 2200;        // px/s²
    var JUMP_VELOCITY = -760;  // px/s
    var BASE_SPEED = 190;      // px/s, velocidad inicial del escenario — arranca despacio
    var ACCEL_PER_S = 8;       // cuánto aumenta la velocidad cada segundo — sin techo, sube para siempre

    var MAX_LIVES = 3;          // con cuántas se arranca
    var MAX_VIDAS = 5;          // hasta dónde puede subir con corazones
    var PROB_CORAZON = 0.05;    // raro a propósito, y solo si le falta vida
    var MONEDAS_POR_BONO = 5;
    var BONO_MONEDAS = 100;
    var INVULN_S = 1.4;
    var COIN_VALUE = 10;
    /* El imán YA atraía monedas, pero con 75 px de radio —poco más que el
       propio personaje— no se notaba y parecía que no hacía nada. */
    var MAGNET_RADIUS = 165;
    var POWERUP_DURATION_MS = { magnet: 6000, turbo: 5000, doubleCoin: 8000, volar: 6000 };
    var POWERUP_ICON = { magnet: "🧲", turbo: "⚡", doubleCoin: "2×", shield: "🛡️", volar: "🪽" };
    // a qué altura se estabiliza mientras vuela
    var ALTURA_VUELO = 110;

    // el multiplicador sube por distancia recorrida, no por tiempo — como la
    // velocidad va acelerando sin techo, entre más rápido vayas más rápido
    // sube el x2, x3... también sin techo
    var MULTIPLIER_STEP_DISTANCE = 2200; // px recorridos para subir un nivel
    var HOLD_MS = 350;         // mantener presionado más de esto = gesto "hold"
    var DOUBLE_TAP_MS = 320;   // dos toques dentro de esta ventana = "doubletap"
    var RAMP_PROMPT_RANGE = 150; // px de anticipación para mostrar el aviso del truco
    var GESTURE_LABEL = { hold: "MANTÉN PARA KICKFLIP", doubletap: "DOBLE TOQUE PARA BACKFLIP" };
    var TRICK_NAME = { hold: "KICKFLIP", doubletap: "BACKFLIP" };

    /* ---- terreno real: el camino no es una línea recta — tiene colinas
       (subida = frena, bajada = acelera, parte física del suelo, no un
       adorno) y abismos reales (si el personaje llega al piso sobre uno,
       cae de verdad y pierde todas las vidas). Barandas para deslizar. ---- */
    var TERRAIN_HILL_H = 46;        // qué tan alto llega una colina
    var BLOQUE_W = 26;              // el escalón que hay que saltar para subir
    var BLOQUE_LLANO_MIN = 190;     // llano obligatorio arriba, antes de bajar
    // el rebote de bajar un escalón: como un 20% de un salto normal
    var SALTITO_ESCALON = JUMP_VELOCITY * 0.2;
    // cuánto se le sigue aceptando el salto después de dejar el suelo
    var COYOTE_S = 0.14;
    // La megarampa y su abismo gigante. Máximo 2 por partida: si saliera
    // seguido dejaría de ser el momento grande de la carrera.
    var MAX_MEGA_POR_PARTIDA = 2;
    var MEGA_RAMPA_W = 74;
    var MEGA_RAMPA_H = 52;
    var MEGA_VELOCITY_MULT = 1.85;
    var TERRAIN_SLOPE_W = 130;      // ancho por defecto de un tramo de subida o bajada
    var TERRAIN_SLOPE_GENTLE_MIN = 140, TERRAIN_SLOPE_GENTLE_MAX = 200; // subida suave: más ancho, menos inclinada
    var TERRAIN_SLOPE_STEEP_MIN = 55, TERRAIN_SLOPE_STEEP_MAX = 90;     // bajada pronunciada: mismo alto, menos ancho
    var TERRAIN_CREST_MIN = 70;     // tramo plano arriba de la colina (o "plataforma")
    var TERRAIN_CREST_MAX = 190;
    var TERRAIN_FLAT_MIN = 560;     // tramo plano/recta entre relieves — largo a propósito, para
    var TERRAIN_FLAT_MAX = 960;     // que los obstáculos normales queden en terreno plano y haya espacio para tomar velocidad
    // los abismos se miden como fracción de lo que alcanza un salto normal a
    // la velocidad actual (ver jumpDistancePx) — así son grandes de verdad,
    // pero siguen siendo saltables sin importar qué tan rápido vaya el juego
    var PIT_BIG_FRAC_MIN = 0.55, PIT_BIG_FRAC_MAX = 0.82;   // abismo grande
    var PIT_SMALL_FRAC_MIN = 0.28, PIT_SMALL_FRAC_MAX = 0.42; // hueco pequeño, más fácil
    var PIT_LANDING_W = 140;        // tramo plano obligatorio justo después de un abismo
    var RAIL_HEIGHT_ABOVE_GROUND = CHAR_SIZE * 1.35;
    var RAIL_BONUS = 90;
    var FALL_DURATION_S = 0.8;

    var character = "skate";
    var playerName = "";
    var state = null;
    var rafId = null;
    var lastTs = null;

    function groundY() { return H - GROUND_H; }

    /* ---- terreno: perfil de elevación continuo, generado por tramos que
       se van agregando por delante del jugador y se descartan cuando ya
       salieron de pantalla — mismo patrón de mover/filtrar que ya usan los
       obstáculos y los pickups. */
    function pushTerrain(w, h0, h1, isPit, extra) {
      var lastX = state.terrain.length ? (state.terrain[state.terrain.length - 1].x + state.terrain[state.terrain.length - 1].w) : W;
      var seg = {
        x: lastX, w: w, h0: h0, h1: h1, isPit: !!isPit,
        stepped: !!(extra && extra.stepped),
        isBridge: !!(extra && extra.isBridge),
        curb: !!(extra && extra.curb),
        // el escalón que hay que saltar para subir (la colisión lo mira)
        bloque: !!(extra && extra.bloque),
        // la carrera de entrada y el vacío del salto grande, para dibujarlos aparte
        megaPista: !!(extra && extra.megaPista),
        megaAbismo: !!(extra && extra.megaAbismo),
        prop: (extra && extra.prop) || null
      };
      state.terrain.push(seg);
    }

    function terrainTailH() {
      return state.terrain.length ? state.terrain[state.terrain.length - 1].h1 : 0;
    }

    function maybeExtendTerrain() {
      var lastX = state.terrain.length ? (state.terrain[state.terrain.length - 1].x + state.terrain[state.terrain.length - 1].w) : W;
      var guard = 0;
      while (lastX < W + 500 && guard < 20) {
        var h = terrainTailH();
        if (Math.abs(h) > 0.5) {
          // a mitad de colina: siempre vuelve a terreno plano — la bajada,
          // que puede ser pronunciada (más angosta) si así se decidió al
          // generar la subida; misma altura, misma física, solo más rápida
          var descW = state.pendingDescentW || TERRAIN_SLOPE_W;
          var descStepped = state.pendingDescentStepped;
          state.pendingDescentW = null;
          state.pendingDescentStepped = false;
          pushTerrain(descW, h, 0, false, descStepped ? { stepped: true } : null);
        } else {
          var roll = Math.random();
          if (roll < 0.40) {
            // recta larga — a veces disfrazada de puente (solo visual)
            var flatW = TERRAIN_FLAT_MIN + Math.random() * (TERRAIN_FLAT_MAX - TERRAIN_FLAT_MIN);
            var isBridge = flatW > 620 && Math.random() < 0.3;
            pushTerrain(flatW, 0, 0, false, {
              isBridge: isBridge,
              curb: !isBridge && Math.random() < 0.4,
              prop: (!isBridge && flatW > 500 && Math.random() < 0.25) ? (Math.random() < 0.5 ? "lamppost" : "hydrant") : null
            });
          } else if (roll < 0.52) {
            // hueco pequeño — fácil de saltar, escala con la velocidad actual
            var jd1 = jumpDistancePx(state.speed);
            var spw = jd1 * (PIT_SMALL_FRAC_MIN + Math.random() * (PIT_SMALL_FRAC_MAX - PIT_SMALL_FRAC_MIN));
            pushTerrain(spw, 0, 0, true);
            pushTerrain(PIT_LANDING_W, 0, 0, false);
          } else if (roll < 0.62) {
            // abismo grande — de verdad grande, pero sigue cabiendo dentro
            // de lo que alcanza un salto normal a la velocidad actual
            var jd2 = jumpDistancePx(state.speed);
            var pw = jd2 * (PIT_BIG_FRAC_MIN + Math.random() * (PIT_BIG_FRAC_MAX - PIT_BIG_FRAC_MIN));
            pushTerrain(pw, 0, 0, true);
            pushTerrain(PIT_LANDING_W, 0, 0, false);
          } else if (state.megaUsados < MAX_MEGA_POR_PARTIDA && state.elapsed > 20 && Math.random() < 0.12) {
            /* ---- El abismo gigante ----
               Nunca, jamás, se genera sin su megarampa: la rampa se empuja
               PRIMERO y en el mismo paso, así no hay forma de que salga el
               vacío solo aunque cambie algo más adelante.

               El ancho sale del alcance CON el impulso de la megarampa, no del
               salto normal, y se deja un margen: así siempre se puede pasar,
               pero hay que usar la rampa de verdad. */
            state.megaUsados++;
            var carrera = 150 + Math.random() * 60;
            pushTerrain(carrera, 0, 0, false, { megaPista: true });

            var alcanceMega = jumpDistancePx(state.speed) * MEGA_VELOCITY_MULT;
            var anchoMega = alcanceMega * 0.72;
            pushTerrain(anchoMega, 0, 0, true, { megaAbismo: true });
            pushTerrain(PIT_LANDING_W + 120, 0, 0, false);

            // la megarampa, justo en el borde de la carrera de entrada
            state.obstacles.push({
              x: state.terrain[state.terrain.length - 3].x + carrera - MEGA_RAMPA_W,
              w: MEGA_RAMPA_W, h: MEGA_RAMPA_H, type: "ramp", triggered: false,
              gesture: "hold", bonusMult: 3, velocityMult: MEGA_VELOCITY_MULT, mega: true
            });
          } else {
            // colina: subida suave (o en escalones) + plataforma arriba;
            /* Colina. La SUBIDA nunca es escalonada — no existen las escaleras
               de subida: o es una rampa, o es un bloque que hay que saltar.
               La bajada sí puede ser escalonada, y esa es la única forma en
               que aparecen escaleras en el juego. */
            var esBloque = Math.random() < 0.45;
            var bajadaEscalonada = Math.random() < 0.45;

            state.pendingDescentW = Math.random() < 0.55
              ? (TERRAIN_SLOPE_STEEP_MIN + Math.random() * (TERRAIN_SLOPE_STEEP_MAX - TERRAIN_SLOPE_STEEP_MIN))
              : TERRAIN_SLOPE_W;
            state.pendingDescentStepped = bajadaEscalonada;

            if (esBloque) {
              /* El bloque: la altura sube de golpe en muy poco ancho, así que
                 hay que saltarlo. Se marca con `bloque` para que la colisión
                 sepa que chocarse de frente cuesta una vida. */
              pushTerrain(BLOQUE_W, TERRAIN_HILL_H, TERRAIN_HILL_H, false, { bloque: true });
              /* Y arriba se fuerza un llano largo ANTES de que pueda venir la
                 bajada: sin esto, uno salta el bloque y ya está cayendo por la
                 escalera sin tiempo de reaccionar. */
              pushTerrain(BLOQUE_LLANO_MIN + Math.random() * 120, TERRAIN_HILL_H, TERRAIN_HILL_H, false);
            } else {
              var ascW = TERRAIN_SLOPE_GENTLE_MIN + Math.random() * (TERRAIN_SLOPE_GENTLE_MAX - TERRAIN_SLOPE_GENTLE_MIN);
              pushTerrain(ascW, 0, TERRAIN_HILL_H, false, null);
              pushTerrain(TERRAIN_CREST_MIN + Math.random() * (TERRAIN_CREST_MAX - TERRAIN_CREST_MIN), TERRAIN_HILL_H, TERRAIN_HILL_H, false);
            }
          }
        }
        lastX = state.terrain[state.terrain.length - 1].x + state.terrain[state.terrain.length - 1].w;
        guard++;
      }
      state.terrain = state.terrain.filter(function (t) { return t.x + t.w > -20; });
    }

    /* ---- Escaleras ----
       El dibujo y la física TIENEN que usar el mismo número de escalones y la
       misma fórmula. Antes no: se dibujaban escalones pero terrainHeightAt()
       devolvía una rampa lisa, así que el personaje pasaba por encima de la
       escalera como si no existiera. De ahí que "las saltara". */
    var TERRAIN_STEPS = 4;

    /** Altura de un tramo escalonado en la posición p (0..1) del tramo. */
    function alturaEscalonada(t, p) {
      var i = Math.min(TERRAIN_STEPS - 1, Math.max(0, Math.floor(p * TERRAIN_STEPS)));
      return t.h0 + (t.h1 - t.h0) * ((i + 1) / TERRAIN_STEPS);
    }

    /* Cuánto puede quedar por debajo de la superficie sin que cuente como
       chocar de frente. Da para subir una rampa o un escalón de escalera, pero
       no para atravesar un bloque de 46 px. */
    var BLOQUE_TOLERANCIA = 16;

    /** El tramo de terreno que está en esa X, o null. */
    function tramoEn(x) {
      for (var i = 0; i < state.terrain.length; i++) {
        var t = state.terrain[i];
        if (x >= t.x && x < t.x + t.w) return t;
      }
      return null;
    }

    /** El perfil de la superficie de un tramo, como lista de puntos. */
    function perfilDeTramo(t) {
      var base = groundY();
      if (!(t.stepped && t.h0 !== t.h1)) {
        return [[t.x, base - t.h0], [t.x + t.w, base - t.h1]];
      }
      var pts = [[t.x, base - t.h0]];
      for (var i = 0; i < TERRAIN_STEPS; i++) {
        var y = base - (t.h0 + (t.h1 - t.h0) * ((i + 1) / TERRAIN_STEPS));
        pts.push([t.x + (t.w * i) / TERRAIN_STEPS, y]);
        pts.push([t.x + (t.w * (i + 1)) / TERRAIN_STEPS, y]);
      }
      return pts;
    }

    /** Un color hexadecimal, más oscuro. Para el subsuelo. */
    function oscurecer(hex, factor) {
      var n = parseInt(hex.slice(1), 16);
      var r = Math.round(((n >> 16) & 255) * (1 - factor));
      var g = Math.round(((n >> 8) & 255) * (1 - factor));
      var b = Math.round((n & 255) * (1 - factor));
      return "rgb(" + r + "," + g + "," + b + ")";
    }

    /** Altura del terreno (encima de la línea base) en una posición X del
     *  mundo — null significa que ahí no hay suelo (abismo). */
    function terrainHeightAt(x) {
      for (var i = 0; i < state.terrain.length; i++) {
        var t = state.terrain[i];
        if (x >= t.x && x < t.x + t.w) {
          if (t.isPit) return null;
          var p = (x - t.x) / t.w;
          // en una escalera la altura va por escalones, igual que el dibujo
          if (t.stepped && t.h0 !== t.h1) return alturaEscalonada(t, p);
          return t.h0 + (t.h1 - t.h0) * p;
        }
      }
      return 0;
    }

    /** Igual que terrainHeightAt pero nunca devuelve null (para obstáculos,
     *  que solo se generan sobre terreno plano y no necesitan caer). */
    function groundYAt(x) {
      var h = terrainHeightAt(x);
      return groundY() - (h || 0);
    }

    /* ---- fondo urbano en paralaje: patrones de edificios que se
       reciclan infinitamente (dos copias desplazadas por el ancho total
       del patrón, técnica estándar de scroll infinito) ---- */
    function buildSkylinePattern(count, minH, maxH, minW, maxW) {
      var items = [];
      var x = 0;
      for (var i = 0; i < count; i++) {
        var w = minW + Math.random() * (maxW - minW);
        var h = minH + Math.random() * (maxH - minH);
        items.push({
          x: x, w: w, h: h, lit: Math.random() > 0.5,
          hasAntenna: Math.random() < 0.25,
          hasTank: Math.random() < 0.2 && w > 30
        });
        x += w + 6 + Math.random() * 14;
      }
      return { items: items, totalW: Math.max(x, 60) };
    }

    /* ---- El cielo ----
       En un celular el lienzo es una columna alta y la acción pasa toda abajo,
       así que arriba sobraba muchísimo espacio vacío. Estas tres capas lo
       llenan SIN tocar el juego: son fondo puro, no chocan con nada.

       Todo se arma una vez por partida y se recicla, igual que los edificios:
       nada de esto crea objetos ni degradados por cuadro. */

    /* Cordillera del fondo. Va detrás de la ciudad y sube bastante más alto,
       que es lo que llena el medio de la pantalla. */
    /* ---- Partículas ----
       Con tope. En un celular viejo, dejar que se acumulen sin límite es
       justo lo que hace que el juego se arrastre: cada una es un círculo
       más por cuadro. Al pasarse, se descarta la más vieja. */
    var TOPE_PARTICULAS = 70;

    function empujarParticula(p) {
      if (state.particles.length >= TOPE_PARTICULAS) state.particles.shift();
      state.particles.push(p);
    }

    /** Nube de polvo al caer. Más fuerte el golpe, más polvo y más abierto. */
    function polvoDeAterrizaje(charX, sueloY, fuerza) {
      var cuantas = 4 + Math.round(fuerza * 6);
      for (var i = 0; i < cuantas; i++) {
        var haciaLaDerecha = i % 2 === 0;
        empujarParticula({
          x: charX + CHAR_SIZE / 2 + (Math.random() - 0.5) * 10,
          y: sueloY - 2,
          vx: (haciaLaDerecha ? 1 : -1) * (25 + Math.random() * 75) * (0.5 + fuerza),
          vy: -25 - Math.random() * 55 * fuerza,
          life: 0.36 + Math.random() * 0.22,
          maxLife: 0.58,
          r: 2 + Math.random() * 3
        });
      }
    }

    function buildMountains(count, minH, maxH, minW, maxW) {
      var items = [];
      var x = 0;
      for (var i = 0; i < count; i++) {
        var w = minW + Math.random() * (maxW - minW);
        var h = minH + Math.random() * (maxH - minH);
        // el pico no va siempre al medio: si no, parecen todos el mismo cerro
        items.push({ x: x, w: w, h: h, pico: 0.3 + Math.random() * 0.4 });
        x += w * (0.55 + Math.random() * 0.25);   // se solapan, como cerros de verdad
      }
      return { items: items, totalW: Math.max(x, 80) };
    }

    /* Nubes que cruzan lento. Cada una es un puñado de círculos. */
    function buildClouds(count) {
      var out = [];
      for (var i = 0; i < count; i++) {
        /* Las bolas se pisan bastante entre sí a propósito: separadas se leen
           como pelotas grises, encimadas se leen como una nube. */
        var bolas = [];
        var n = 4 + Math.floor(Math.random() * 3);
        for (var j = 0; j < n; j++) {
          var t = n === 1 ? 0 : (j / (n - 1)) - 0.5;   // -0.5 .. 0.5
          bolas.push({
            dx: t * 46,
            dy: (0.5 - Math.abs(t)) * -9 + (Math.random() - 0.5) * 4,   // más alta al centro
            r: 15 + (0.5 - Math.abs(t)) * 16 + Math.random() * 4
          });
        }
        out.push({
          x: Math.random(),                 // 0..1 del ancho
          y: 0.06 + Math.random() * 0.5,    // 0..1 del alto del cielo
          escala: 0.75 + Math.random() * 0.8,
          vel: 0.004 + Math.random() * 0.008,
          alpha: 0.05 + Math.random() * 0.035
        });
        out[out.length - 1].bolas = bolas;
      }
      return out;
    }

    /* Vallas publicitarias con las frases del negocio. Se reparten a lo largo
       de un tramo largo y se reciclan, igual que los edificios, así que van
       apareciendo cada tanto en vez de todas juntas. */
    function buildVallas() {
      var frases = frasesDeMarca();
      if (!frases.length) return { items: [], totalW: 1 };
      var items = [];
      var x = 260;
      for (var i = 0; i < frases.length; i++) {
        items.push({
          x: x,
          texto: frases[i],
          alto: 26 + Math.random() * 10,
          /* Bien alto a propósito: el rótulo de TOPPINGS vive entre los 44 y
             los 66 px sobre el suelo, y con postes cortos las vallas le caían
             encima. Desde 70 para arriba nunca se pisan. */
          poste: 72 + Math.random() * 46
        });
        x += 420 + Math.random() * 320;
      }
      return { items: items, totalW: x + 300 };
    }

    /** Lo que cae del cielo en las temporadas. Vacío si el escenario no usa. */
    function buildChispas(esc) {
      if (!esc.chispas) return [];
      var cuantas = esc.chispas === "murcielagos" ? 7 : 26;
      var out = [];
      for (var i = 0; i < cuantas; i++) {
        out.push({
          x: Math.random(),
          y: Math.random(),
          r: esc.chispas === "nieve" ? (1 + Math.random() * 2)
             : esc.chispas === "murcielagos" ? (3 + Math.random() * 2.5)
             : (2 + Math.random() * 2.5),
          vel: 0.04 + Math.random() * 0.11,
          vaiven: 0.6 + Math.random() * 1.4,
          amplitud: 6 + Math.random() * 16,
          giro: 1 + Math.random() * 3,
          semilla: Math.random() * 10,
          alpha: 0.4 + Math.random() * 0.45,
          color: (esc.luces && esc.luces.length)
            ? esc.luces[Math.floor(Math.random() * esc.luces.length)]
            : "255,255,255"
        });
      }
      return out;
    }

    /* Campo de estrellas fijo por partida (no se regenera cada frame) —
       cada una titila a su propio ritmo. Puramente decorativo. */
    function buildStars(count) {
      var stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random(),
          y: Math.random() * 0.62,
          r: 0.6 + Math.random() * 1.2,
          seed: Math.random() * 10,
          speed: 1.2 + Math.random() * 1.6
        });
      }
      return stars;
    }

    function resetGame() {
      var prevRecord = state ? state.record : Number(localStorage.getItem(RECORD_KEY) || 0);
      var esc = elegirEscenario();
      olvidarDegradados();   // el mundo cambió: los degradados viejos ya no sirven
      state = {
        charY: groundY() - CHAR_SIZE,
        velocityY: 0,
        onGround: true,
        falling: false,
        fallT: 0,
        obstacles: [],
        pickups: [],
        particles: [],
        terrain: [],
        pendingDescentW: null,
        pendingDescentStepped: false,
        currentRail: null,
        speed: BASE_SPEED,
        elapsed: 0,
        // El primer obstáculo tarda más en aparecer, para que el jugador
        // agarre ritmo antes de tener que saltar.
        nextSpawnIn: 1500,
        nextPickupIn: 1700,
        score: 0,
        coins: 0,
        lives: MAX_LIVES,
        shieldCharges: 0,
        invulnUntil: 0,
        activePowerups: { magnet: 0, turbo: 0, doubleCoin: 0, volar: 0 },
        trick: null,
        trickText: null,
        multiplier: 1,
        lastGestureType: null,
        lastGestureAt: -999,
        activePrompt: null,
        hasJumpedOnce: false,
        animT: 0,
        dustTimer: 0,
        chispaTimer: 0,
        ultimoEscalon: -1,   // en qué escalón de la escalera va, para el rebote
        pajaros: [],         // obstáculos del aire, solo mientras vuela
        pajaroTimer: 900,
        ultimoEnSuelo: -99,  // cuándo pisó por última vez, para el margen del salto
        enSaltito: false,    // va en el rebote de un escalón (el salto igual vale)
        monedasParaBono: 0,  // cuenta hasta 5 y regala 100 puntos
        megaUsados: 0,       // cuántos abismos gigantes salieron (tope 2)
        aterrizaje: 0,   // 0..1, cuánto se aplasta al caer (se va solo)
        destello: 0,     // 0..1, el fogonazo rojo al chocar
        bgScrollFar: 0,
        bgScrollNear: 0,
        bgScrollCerros: 0,
        groundScroll: 0,
        // el escenario se elige AL EMPEZAR la partida, no a cada cuadro: si
        // estuviera en "ir cambiando", cambiaría de mundo mientras jugás
        esc: esc,
        frases: frasesDeMarca(),
        bgFar: buildSkylinePattern(9, 34, 74, 26, 50),
        bgNear: buildSkylinePattern(7, 20, 46, 22, 40),
        // la capa de más atrás: cerros, árboles o el puente según el mundo
        cerros: buildMountains(7, 90, 190, 130, 230),
        vallas: buildVallas(),
        nubes: buildClouds(esc.nubes),
        chispas: buildChispas(esc),
        estrellaFugaz: null,
        proximaFugaz: 4 + Math.random() * 9,
        rayo: 0,
        proximoRayo: 2 + Math.random() * 5,
        stars: buildStars(esc.estrellas),
        moonSeed: Math.random(),
        record: prevRecord,
        over: false
      };
      // arranca siempre sobre terreno plano, para que el jugador agarre
      // ritmo antes de la primera colina o abismo
      pushTerrain(W + 300, 0, 0, false);
      maybeExtendTerrain();
      if (scoreEl) scoreEl.textContent = "0";
      if (coinsEl) coinsEl.textContent = "🪙 0";
      if (recordEl) recordEl.textContent = "🏆 " + state.record;
      if (overlay) overlay.hidden = true;
      if (leaderboardEl) leaderboardEl.hidden = true;
      if (hintEl) hintEl.classList.remove("is-hidden");
      renderLives();
      renderPowerupBar();
      renderMultiplier();
    }

    function renderMultiplier() {
      if (!multiEl || !state) return;
      if (state.multiplier > 1) {
        multiEl.hidden = false;
        multiEl.textContent = "⚡ ×" + state.multiplier;
      } else {
        multiEl.hidden = true;
      }
    }

    function renderLives() {
      if (!livesEl || !state) return;
      /* Se dibujan tantos huecos como vidas pueda tener AHORA: con los
         corazones puede pasar de 3, y antes esto pintaba siempre 3 fijas, así
         que la cuarta vida no se veía por ningún lado. */
      var huecos = Math.max(MAX_LIVES, state.lives);
      var s = "";
      for (var i = 0; i < huecos; i++) s += (i < state.lives ? "❤️" : "🖤");
      livesEl.textContent = s;
    }

    function renderPowerupBar() {
      if (!powerupBarEl || !state) return;
      var parts = [];
      if (state.shieldCharges > 0) parts.push("🛡️×" + state.shieldCharges);
      ["magnet", "turbo", "doubleCoin", "volar"].forEach(function (k) {
        if (state.activePowerups[k] > 0) {
          parts.push(POWERUP_ICON[k] + Math.ceil(state.activePowerups[k] / 1000) + "s");
        }
      });
      powerupBarEl.textContent = parts.join("  ");
    }

    function jump() {
      if (!state || state.over || state.falling) return;
      state.hasJumpedOnce = true;

      // volando: cada toque lo empuja más arriba, no hay salto normal
      if (state.activePowerups.volar > 0) {
        state.velocityY = Math.min(state.velocityY, 0) + JUMP_VELOCITY * 0.55;
        sfxJump();
        return;
      }

      /* Margen de gracia. Sin esto, bajando una escalera el salto NO salía:
         el saltito de cada escalón pone onGround en false por un instante y
         el toque se perdía. Además hace que el salto se sienta menos duro
         cuando uno toca justo al salir de un borde. */
      var recienEstuvo = (state.elapsed - state.ultimoEnSuelo) < COYOTE_S;
      if (state.onGround || state.enSaltito || recienEstuvo) {
        state.velocityY = JUMP_VELOCITY;
        state.onGround = false;
        state.enSaltito = false;
        state.ultimoEnSuelo = -99;      // que no valga dos veces el mismo margen
        state.currentRail = null; // saltar desde una baranda la suelta, sin bonus
        sfxJump();
      }
    }

    function spawnObstacle() {
      // los obstáculos normales/rampas/barandas solo aparecen sobre terreno
      // plano (nunca en medio de una colina o un abismo) — si justo ahora
      // no es plano, se reintenta pronto en vez de generar algo raro
      if (terrainHeightAt(W) !== 0) return false;

      var roll = Math.random();
      if (roll < 0.32) {
        // rampas de tres tamaños — la grande impulsa más y da más puntos
        var sizeRoll = Math.random();
        var dims = sizeRoll < 0.4
          ? { w: [24, 30], h: [11, 16], bonusMult: 0.7, velocityMult: 1.05 }
          : sizeRoll < 0.75
            ? { w: [30, 40], h: [16, 23], bonusMult: 1, velocityMult: 1.2 }
            : { w: [40, 52], h: [23, 32], bonusMult: 1.5, velocityMult: 1.4 };
        var rw = dims.w[0] + Math.random() * (dims.w[1] - dims.w[0]);
        var rh = dims.h[0] + Math.random() * (dims.h[1] - dims.h[0]);
        var gesture = Math.random() < 0.5 ? "hold" : "doubletap";
        state.obstacles.push({
          x: W + rw, w: rw, h: rh, type: "ramp", triggered: false, gesture: gesture,
          bonusMult: dims.bonusMult, velocityMult: dims.velocityMult
        });
      } else if (roll < 0.46) {
        /* Rieles de dos largos. El largo da bastante más puntos porque hay que
           mantener el equilibrio más tiempo sin saltar. */
        var esLargo = Math.random() < 0.35;
        var railW = esLargo ? (170 + Math.random() * 90) : (60 + Math.random() * 45);
        state.obstacles.push({
          x: W + railW, w: railW, type: "rail", largo: esLargo,
          y: groundYAt(W) - RAIL_HEIGHT_ABOVE_GROUND, grinded: false
        });
      } else {
        var h = 22 + Math.random() * 26;
        var w = 16 + Math.random() * 14;
        state.obstacles.push({ x: W + w, w: w, h: h, type: "obstacle", variant: Math.floor(Math.random() * 3) });
      }
      return true;
    }

    function spawnPickup() {
      var roll = Math.random();
      var type = "coin";
      if (roll > 0.90) type = "volar";     // el más escaso de los poderes
      else if (roll > 0.80) type = "shield";
      else if (roll > 0.66) type = "magnet";
      else if (roll > 0.52) type = "turbo";
      else if (roll > 0.38) type = "doubleCoin";

      /* El corazón es raro de verdad, y solo aparece si le falta alguna vida:
         regalarlo con la vida llena no le sirve a nadie y le quitaría la
         emoción de encontrarlo justo cuando hace falta. */
      if (state.lives < MAX_VIDAS && Math.random() < PROB_CORAZON) type = "heart";

      var groundLevel = groundYAt(W) - CHAR_SIZE * 0.55;
      var jumpLevel = groundYAt(W) - CHAR_SIZE - 30;
      var y = ((type === "coin" || type === "heart") && Math.random() > 0.45) ? jumpLevel : groundLevel;
      state.pickups.push({ x: W + 16, y: y, type: type, r: type === "coin" ? 7 : 11 });
    }

    // Cuánto avanza un salto normal en el aire, a la velocidad actual —
    // sirve de referencia tanto para el espacio entre obstáculos como para
    // el ancho de los abismos, así todo se mantiene justo (difícil pero
    // saltable) sin importar qué tan rápido vaya el escenario.
    function jumpDistancePx(speed) {
      var jumpDuration = (-2 * JUMP_VELOCITY) / GRAVITY; // segundos en el aire
      return speed * jumpDuration;
    }

    // Espacio mínimo entre obstáculos para que un salto normal alcance a
    // librarlos — sin esto, a velocidades altas podrían aparecer imposibles.
    function minGapPx(speed) {
      return jumpDistancePx(speed) * 0.95;
    }

    function collectPickup(p) {
      if (p.type === "coin") {
        var mult = state.activePowerups.doubleCoin > 0 ? 2 : 1;
        state.coins += mult;
        state.score += COIN_VALUE * mult * state.multiplier;
        if (coinsEl) coinsEl.textContent = "🪙 " + state.coins;
        sfxCoin();

        /* Cada 5 monedas, 100 puntos de regalo. Da una meta corta y clara
           mientras corre: junta cinco y algo pasa. */
        state.monedasParaBono += mult;
        while (state.monedasParaBono >= MONEDAS_POR_BONO) {
          state.monedasParaBono -= MONEDAS_POR_BONO;
          state.score += BONO_MONEDAS;
          state.trickText = { text: "🪙 x" + MONEDAS_POR_BONO + " +" + BONO_MONEDAS, life: 1.1 };
        }
      } else if (p.type === "heart") {
        if (state.lives < MAX_VIDAS) state.lives++;
        renderLives();
        state.trickText = { text: "❤️ +1 VIDA", life: 1.3 };
        sfxPowerup();
      } else if (p.type === "shield") {
        state.shieldCharges++;
        sfxPowerup();
      } else {
        state.activePowerups[p.type] = POWERUP_DURATION_MS[p.type];
        sfxPowerup();
      }
      renderPowerupBar();
    }

    function registerHit() {
      if (state.invulnUntil > state.elapsed) return; // ya está parpadeando por el golpe anterior
      if (state.shieldCharges > 0) {
        state.shieldCharges--;
        state.invulnUntil = state.elapsed + INVULN_S;
        state.destello = 0.55;   // el escudo aguanta, pero se nota
        renderPowerupBar();
        return;
      }
      state.destello = 1;
      state.lives--;
      state.invulnUntil = state.elapsed + INVULN_S;
      renderLives();
      if (state.lives <= 0) gameOver();
      else sfxHit();
    }

    // Abismo real: no lo bloquea el escudo, pierde TODAS las vidas de una vez
    // — el personaje ya venía cayendo con su propia animación (ver update()).
    function fallIntoPit() {
      state.lives = 0;
      renderLives();
      sfxHit();
      gameOver();
    }

    // Si el jugador hizo el gesto correcto (mantener/doble toque) justo
    // antes de llegar a la rampa, el truco sale con nombre y más puntos;
    // si solo saltó normal, igual lo lanza la rampa, pero sin el bonus grande.
    function triggerTrick(ramp) {
      var velocityMult = ramp.velocityMult || 1.2;
      var bonusMult = ramp.bonusMult || 1;
      state.velocityY = JUMP_VELOCITY * velocityMult;
      state.onGround = false;
      var matched = state.lastGestureType === ramp.gesture && (state.elapsed - state.lastGestureAt) < 0.6;
      state.trick = {
        active: true, t: 0,
        name: matched ? TRICK_NAME[ramp.gesture] : null,
        bonus: Math.round((matched ? 150 : 40) * bonusMult)
      };
      state.activePrompt = null;
    }

    function update(dt) {
      if (state.over) return;
      state.elapsed += dt;
      var charX = W * CHAR_X_RATIO;
      // sin techo: la velocidad sube para siempre, cada vez más rápido
      state.speed = BASE_SPEED + state.elapsed * ACCEL_PER_S;
      state.groundScroll += dt * state.speed;

      // el x2/x3... sube según el recorrido (distancia real, no tiempo) —
      // como la velocidad acelera sin techo, entre más rápido vas, más rápido
      // sube el multiplicador. Tampoco tiene techo.
      var newMultiplier = 1 + Math.floor(state.groundScroll / MULTIPLIER_STEP_DISTANCE);
      if (newMultiplier !== state.multiplier) { state.multiplier = newMultiplier; renderMultiplier(); }

      var scoreRate = (state.activePowerups.turbo > 0 ? 20 : 10) * state.multiplier;
      state.score += dt * scoreRate;
      if (scoreEl) scoreEl.textContent = String(Math.floor(state.score));
      // El paso de la animación (rueditas, rebote al correr) va más rápido
      // mientras más rápido va el escenario, para que se sienta acorde.
      state.animT += dt * (state.speed / 70);
      state.bgScrollFar += dt * state.speed * 0.15;
      state.bgScrollNear += dt * state.speed * 0.4;
      // los cerros van mucho más lento: es lo que da sensación de distancia
      state.bgScrollCerros += dt * state.speed * 0.05;

      // lo que cae del cielo: baja y vuelve a aparecer arriba
      for (var ci = 0; ci < state.chispas.length; ci++) {
        var ch2 = state.chispas[ci];
        ch2.y += ch2.vel * dt;
        // los murciélagos cruzan en horizontal, no caen
        if (state.esc.chispas === "murcielagos") {
          ch2.y -= ch2.vel * dt;
          ch2.x -= ch2.vel * dt * 0.5;
          if (ch2.x < -0.1) { ch2.x = 1.1; ch2.y = Math.random() * 0.5; }
        } else if (ch2.y > 1.05) {
          ch2.y = -0.05; ch2.x = Math.random();
        }
      }

      // nubes: cruzan solas, no dependen de la velocidad del juego
      for (var ni = 0; ni < state.nubes.length; ni++) {
        var nb = state.nubes[ni];
        nb.x -= nb.vel * dt;
        if (nb.x < -0.2) { nb.x = 1.2; nb.y = 0.08 + Math.random() * 0.42; }
      }

      // relámpagos, solo en Noche Extrema
      if (state.esc.rayos) {
        if (state.rayo > 0) {
          state.rayo = Math.max(0, state.rayo - dt * 3.4);
        } else {
          state.proximoRayo -= dt;
          if (state.proximoRayo <= 0) {
            state.rayo = 1;
            state.proximoRayo = 3 + Math.random() * 7;
          }
        }
      }

      /* Estrella fugaz cada tanto. Dura poco a propósito: si se viera seguido
         dejaría de llamar la atención. */
      if (state.estrellaFugaz) {
        state.estrellaFugaz.t += dt;
        if (state.estrellaFugaz.t > 0.9) state.estrellaFugaz = null;
      } else {
        state.proximaFugaz -= dt;
        if (state.proximaFugaz <= 0) {
          state.estrellaFugaz = {
            t: 0,
            x: 0.15 + Math.random() * 0.6,
            y: 0.06 + Math.random() * 0.3,
            largo: 40 + Math.random() * 45
          };
          state.proximaFugaz = 7 + Math.random() * 12;
        }
      }

      // power-ups activos: cuentan hacia atrás
      var puChanged = false;
      ["magnet", "turbo", "doubleCoin", "volar"].forEach(function (k) {
        if (state.activePowerups[k] > 0) {
          state.activePowerups[k] = Math.max(0, state.activePowerups[k] - dt * 1000);
          puChanged = true;
        }
      });
      if (puChanged) renderPowerupBar();

      // terreno: agrega tramos por delante y descarta los que ya salieron
      state.terrain.forEach(function (t) { t.x -= state.speed * dt; });
      maybeExtendTerrain();

      /* Pájaros. Se mueven y chocan SIEMPRE, no solo mientras dura el poder:
         si dejaran de existir al acabarse el vuelo, desaparecerían de golpe
         en la cara del jugador. Siguen su camino hasta salir de pantalla. */
      var chocaPajaro = false;
      var pxCentro = W * CHAR_X_RATIO + CHAR_SIZE / 2;
      var pyCentro = state.charY + CHAR_SIZE / 2;
      state.pajaros.forEach(function (pa) {
        pa.x -= (state.speed + pa.vx) * dt;
        pa.aleteo += dt * 14;
        var ddx = pxCentro - pa.x, ddy = pyCentro - pa.y;
        if (Math.sqrt(ddx * ddx + ddy * ddy) < pa.r + CHAR_SIZE * 0.36) chocaPajaro = true;
      });
      state.pajaros = state.pajaros.filter(function (pa) { return pa.x > -50; });
      if (chocaPajaro && !state.falling) registerHit();

      if (state.activePowerups.volar > 0) {
        /* ---- Volando ----
           Se sube a una altura de crucero y se queda ahí, con un resorte
           suave en vez de gravedad. Los toques lo empujan más arriba.

           Mientras vuela NO se cae a los abismos ni se engancha en rieles:
           está por encima de todo, que es exactamente la gracia del poder.
           Los obstáculos tampoco lo alcanzan porque son mucho más bajos. */
        state.falling = false;
        state.currentRail = null;
        state.onGround = false;
        var destino = groundY() - CHAR_SIZE - ALTURA_VUELO;
        state.velocityY += (destino - state.charY) * 7 * dt;
        state.velocityY *= 0.92;                       // amortigua el rebote
        state.charY += state.velocityY * dt;
        // que no se salga por arriba de la pantalla
        if (state.charY < 8) { state.charY = 8; state.velocityY = Math.max(0, state.velocityY); }

        /* Los pájaros solo aparecen volando. Sin ellos el poder era gratis:
           subías, no te podía pasar nada y esperabas a que se acabara. Ahora
           el aire también tiene con qué chocarte. */
        state.pajaroTimer -= dt * 1000;
        if (state.pajaroTimer <= 0) {
          state.pajaroTimer = 700 + Math.random() * 900;
          var altoVuelo = groundY() - CHAR_SIZE - ALTURA_VUELO;
          state.pajaros.push({
            x: W + 30,
            y: altoVuelo + (Math.random() - 0.5) * 130,
            r: 9 + Math.random() * 4,
            // vuelan en contra, así que llegan más rápido que el escenario
            vx: state.speed * (0.35 + Math.random() * 0.4),
            aleteo: Math.random() * 6
          });
        }

        // estela de plumitas mientras vuela
        state.dustTimer -= dt * 1000;
        if (state.dustTimer <= 0) {
          state.dustTimer = 70;
          empujarParticula({
            x: W * CHAR_X_RATIO + 4, y: state.charY + CHAR_SIZE * 0.6,
            vx: -state.speed * 0.45, vy: 12 + Math.random() * 26,
            life: 0.45, maxLife: 0.45, r: 1.5 + Math.random() * 2
          });
        }
      } else if (state.falling) {
        // cayendo de verdad al abismo — sigue bajando acelerando, con vuelta
        // de campana, hasta que se acaba la animación y ahí sí termina el juego
        state.fallT += dt;
        state.charY += (420 + state.fallT * 900) * dt;
        if (state.fallT >= FALL_DURATION_S) { fallIntoPit(); return; }
      } else {
        // física del salto / caminata, siguiendo la altura real del terreno
        state.velocityY += GRAVITY * dt;
        state.charY += state.velocityY * dt;

        // ¿aterrizó sobre una baranda? (cayendo, todavía sin deslizarse en
        // ninguna, con el cuerpo llegando a la altura de una que tiene el
        // X debajo del personaje)
        if (!state.currentRail && state.velocityY > 0) {
          for (var ri = 0; ri < state.obstacles.length; ri++) {
            var ro = state.obstacles[ri];
            if (ro.type === "rail" && !ro.grinded && ro.x <= charX && ro.x + ro.w > charX &&
                state.charY + CHAR_SIZE >= ro.y && state.charY + CHAR_SIZE <= ro.y + 18) {
              state.currentRail = ro;
              // el chispazo del momento en que el metal engancha: un golpe
              // fuerte y corto, distinto del chisporroteo de ir deslizándose
              for (var chz = 0; chz < 12; chz++) {
                empujarParticula({
                  x: charX + CHAR_SIZE * 0.5, y: ro.y - 1,
                  vx: -state.speed * (0.3 + Math.random() * 0.8),
                  vy: -40 - Math.random() * 150,
                  life: 0.3 + Math.random() * 0.2, maxLife: 0.5,
                  r: 1.2 + Math.random() * 1.4, chispa: true
                });
              }
              break;
            }
          }
        }
        if (state.currentRail && state.currentRail.x + state.currentRail.w < charX) {
          if (!state.currentRail.grinded) {
            state.currentRail.grinded = true;
            var bono = state.currentRail.largo ? RAIL_BONUS * 2.5 : RAIL_BONUS;
            bono = Math.round(bono);
            state.score += bono;
            state.trickText = {
              text: (state.currentRail.largo ? "¡GRIND LARGO! +" : "¡GRIND! +") + bono,
              life: 1.1
            };
          }
          state.currentRail = null;
        }

        var terrainH = state.currentRail ? null : terrainHeightAt(charX);
        if (terrainH === null && !state.currentRail) {
          // sobre un abismo: si el cuerpo ya llegó al nivel normal del
          // suelo sin haber saltado lo suficiente para pasarlo, se cae de verdad
          if (state.charY >= groundY() - CHAR_SIZE - 2) {
            state.falling = true;
            state.fallT = 0;
            state.onGround = false;
            state.velocityY = 0;
          }
        } else {
          var restY = (state.currentRail ? state.currentRail.y : groundY() - (terrainH || 0)) - CHAR_SIZE;

          /* ¿Se estrelló de frente contra un bloque? Si la superficie está muy
             por encima de sus pies, no está aterrizando encima: le pegó al
             costado. Sin esto el personaje se teletransportaba a la cima del
             bloque como si nada. Cuesta una vida, pero igual se lo sube arriba
             para que la carrera pueda seguir en vez de quedar trabado. */
          if (!state.currentRail && terrainH !== null && state.charY + CHAR_SIZE > (groundY() - terrainH) + BLOQUE_TOLERANCIA) {
            var tramo = tramoEn(charX);
            if (tramo && tramo.bloque) registerHit();
          }

          if (state.charY >= restY) {
            /* Cuánto venía cayendo: lo usan el aplastón del personaje y la
               nube de polvo, para que un salto grande se sienta más pesado
               que bajar un escalón. */
            var golpe = Math.min(1, Math.max(0, state.velocityY / 900));
            var veniaEnElAire = !state.onGround;

            state.charY = restY;
            state.velocityY = 0;
            state.onGround = true;

            if (veniaEnElAire && golpe > 0.12) {
              state.aterrizaje = golpe;          // lo lee drawCharacter
              polvoDeAterrizaje(charX, restY + CHAR_SIZE, golpe);
            }

            /* Bajando una escalera: en cada escalón se le da un empujoncito
               hacia arriba. Sin esto el personaje se arrastra pegado al piso
               y no se ve que esté BAJANDO escalones — que es justo lo que
               Fabián quería ver. Es chico a propósito: no es un salto, es el
               rebote de bajar un escalón. */
            state.ultimoEnSuelo = state.elapsed;   // para el margen de gracia
            state.enSaltito = false;

            var tr = tramoEn(charX);
            if (tr && tr.stepped && tr.h0 > tr.h1) {
              var escalonAhora = Math.floor(((charX - tr.x) / tr.w) * TERRAIN_STEPS);
              if (state.ultimoEscalon !== escalonAhora) {
                state.ultimoEscalon = escalonAhora;
                state.velocityY = SALTITO_ESCALON;
                state.onGround = false;
                // se marca para que el salto siga aceptándose durante el rebote
                state.enSaltito = true;
              }
            } else {
              state.ultimoEscalon = -1;
            }
            if (state.trick && state.trick.active) {
              state.trick.active = false;
              state.score += state.trick.bonus;
              state.trickText = {
                text: (state.trick.name ? "¡" + state.trick.name + "! " : "") + "+" + state.trick.bonus,
                life: 1.1
              };
            }
          }
        }
      }
      if (state.trick && state.trick.active) state.trick.t += dt;
      if (state.trickText) {
        state.trickText.life -= dt;
        if (state.trickText.life <= 0) state.trickText = null;
      }

      // polvo detrás del personaje mientras corre por el suelo
      if (state.onGround) {
        state.dustTimer -= dt * 1000;
        if (state.dustTimer <= 0) {
          state.dustTimer = 90;
          empujarParticula({
            x: W * CHAR_X_RATIO + 6, y: groundYAt(charX) - 3,
            vx: -state.speed * 0.35, vy: -18 - Math.random() * 18,
            life: 0.5, maxLife: 0.5, r: 2 + Math.random() * 2
          });
        }

        /* Chispas al ir montado en un riel. Salen hacia atrás y hacia arriba,
           como cuando raspa el metal. */
        if (state.currentRail) {
          state.chispaTimer = (state.chispaTimer || 0) - dt * 1000;
          if (state.chispaTimer <= 0) {
            state.chispaTimer = 45;
            for (var ch = 0; ch < 2; ch++) {
              empujarParticula({
                x: W * CHAR_X_RATIO + 4, y: state.charY + CHAR_SIZE - 2,
                vx: -state.speed * (0.5 + Math.random() * 0.4),
                vy: -60 - Math.random() * 90,
                life: 0.32, maxLife: 0.32, r: 1.2 + Math.random(),
                chispa: true
              });
            }
          }
        }
      }
      state.particles.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.life -= dt; });
      state.particles = state.particles.filter(function (p) { return p.life > 0; });

      // el aplastón del aterrizaje y el destello del golpe se van solos
      if (state.aterrizaje > 0) state.aterrizaje = Math.max(0, state.aterrizaje - dt * 4.5);
      if (state.destello > 0) state.destello = Math.max(0, state.destello - dt * 3.2);

      // obstáculos/rampas: mover, generar nuevos, descartar los que ya salieron
      state.nextSpawnIn -= dt * 1000;
      if (state.nextSpawnIn <= 0) {
        var spawned = spawnObstacle();
        if (spawned) {
          var gap = minGapPx(state.speed) + Math.random() * 45;
          state.nextSpawnIn = (gap / state.speed) * 1000;
        } else {
          state.nextSpawnIn = 250; // terreno no plano ahora mismo, reintenta pronto
        }
      }
      state.obstacles.forEach(function (o) { o.x -= state.speed * dt; });
      state.obstacles = state.obstacles.filter(function (o) { return o.x + o.w > -10; });

      // monedas y power-ups: mover, generar nuevos, imán si está activo
      state.nextPickupIn -= dt * 1000;
      if (state.nextPickupIn <= 0) {
        spawnPickup();
        state.nextPickupIn = 1400 + Math.random() * 900;
      }
      var charCenterX = W * CHAR_X_RATIO + CHAR_SIZE / 2;
      var charCenterY = state.charY + CHAR_SIZE / 2;
      state.pickups.forEach(function (p) {
        p.x -= state.speed * dt;
        /* El imán se lleva TODO lo que haya en pantalla: monedas, corazones,
           escudos, rayos, otros imanes. Es un imán, no un recogedor de
           monedas — y así se siente el poder de verdad.

           La única excepción es el poder de volar mientras YA se está
           volando: si el imán se lo tragara, el vuelo se renovaría solo una y
           otra vez y la partida se volvería infinita. Ese hay que ir a
           buscarlo. */
        var loIgnora = p.type === "volar" && state.activePowerups.volar > 0;
        if (state.activePowerups.magnet > 0 && !loIgnora) {
          var dx = charCenterX - p.x, dy = charCenterY - p.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAGNET_RADIUS) { p.x += dx * Math.min(1, dt * 6); p.y += dy * Math.min(1, dt * 6); }
        }
      });
      var collected = [];
      if (!state.falling) {
        state.pickups.forEach(function (p) {
          var dx = charCenterX - p.x, dy = charCenterY - p.y;
          if (Math.sqrt(dx * dx + dy * dy) < p.r + CHAR_SIZE * 0.42) collected.push(p);
        });
      }
      if (collected.length) collected.forEach(collectPickup);
      state.pickups = state.pickups.filter(function (p) { return p.x > -30 && collected.indexOf(p) === -1; });

      // colisión (con un pequeño margen de gracia para que se sienta justo)
      var pad = 6;
      var cLeft = charX + pad, cRight = charX + CHAR_SIZE - pad;
      var cTop = state.charY + pad, cBottom = state.charY + CHAR_SIZE - pad;

      // Aviso del gesto: busca la próxima rampa sin activar dentro del rango
      // de anticipación, para mostrar "MANTÉN..." o "DOBLE TOQUE..." a tiempo.
      var upcomingPrompt = null;
      for (var pi = 0; pi < state.obstacles.length; pi++) {
        var po = state.obstacles[pi];
        if (po.type === "ramp" && !po.triggered && po.x > charX && po.x - charX < RAMP_PROMPT_RANGE) {
          upcomingPrompt = po.gesture;
          break;
        }
      }
      state.activePrompt = upcomingPrompt;
      if (hintEl) {
        if (state.activePrompt) {
          hintEl.textContent = GESTURE_LABEL[state.activePrompt];
          hintEl.classList.remove("is-hidden");
        } else {
          hintEl.textContent = "Toca la pantalla para saltar";
          hintEl.classList.toggle("is-hidden", state.hasJumpedOnce);
        }
      }

      if (!state.falling) {
        for (var i = 0; i < state.obstacles.length; i++) {
          var o = state.obstacles[i];
          if (o.type === "ramp") {
            if (!o.triggered && state.onGround && cRight > o.x && cLeft < o.x + o.w) {
              o.triggered = true;
              triggerTrick(o);
            }
            continue;
          }
          if (o.type === "rail") continue; // se maneja arriba, en la física
          var oLeft = o.x, oRight = o.x + o.w;
          var oTop = groundYAt(o.x + o.w / 2) - o.h, oBottom = groundYAt(o.x + o.w / 2);
          if (cRight > oLeft && cLeft < oRight && cBottom > oTop && cTop < oBottom) {
            registerHit();
            if (state.over) return;
          }
        }
      }
    }

    /* ---- fondo: cielo cálido urbano + dos capas de edificios en
       paralaje (silueta), recicladas infinitamente ---- */
    /* Hash determinístico (no Math.random) — el patrón de ventanas debe
       quedar fijo cuadro a cuadro, si no titila como ruido cada frame. */
    function hash01(a, b, c) {
      var n = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
      return n - Math.floor(n);
    }

    function drawSkylineLayer(pattern, scroll, color, litColor) {
      var totalW = pattern.totalW;
      var offset = scroll % totalW;
      pattern.items.forEach(function (b) {
        var bx = b.x - offset;
        [bx, bx + totalW].forEach(function (drawX) {
          if (drawX > W || drawX + b.w < 0) return;
          var top = groundY() - b.h;
          ctx.fillStyle = color;
          ctx.fillRect(drawX, top, b.w, b.h);

          // cuadrícula de ventanas — algunas encendidas, otras apagadas,
          // solo en edificios "lit" para no saturar la capa lejana
          if (b.lit) {
            var cols = Math.max(2, Math.floor(b.w / 8));
            var rows = Math.max(2, Math.floor(b.h / 9));
            var padX = b.w / cols, padY = b.h / rows;
            for (var r = 0; r < rows; r++) {
              for (var c = 0; c < cols; c++) {
                if (hash01(b.x, r, c) < 0.35) continue; // ventana apagada, se deja el hueco
                var wx = drawX + c * padX + padX * 0.28;
                var wy = top + r * padY + padY * 0.28 + 2;
                ctx.fillStyle = litColor;
                ctx.fillRect(wx, wy, padX * 0.42, padY * 0.42);
              }
            }
          }

          // detalles de azotea, ocasionales
          if (b.hasAntenna) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(drawX + b.w * 0.5, top);
            ctx.lineTo(drawX + b.w * 0.5, top - 10);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(drawX + b.w * 0.5, top - 11, 1.4, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,80,80,.7)";
            ctx.fill();
          }
          if (b.hasTank) {
            ctx.fillStyle = color;
            ctx.fillRect(drawX + b.w * 0.62, top - 8, b.w * 0.2, 8);
            ctx.beginPath();
            ctx.moveTo(drawX + b.w * 0.6, top - 8);
            ctx.lineTo(drawX + b.w * 0.62 + b.w * 0.1, top - 13);
            ctx.lineTo(drawX + b.w * 0.82, top - 8);
            ctx.closePath();
            ctx.fill();
          }
        });
      });
    }

    function drawBackground() {
      var esc = state.esc;

      // el cielo lo define el escenario: la clave del caché lleva su nombre
      // para que al cambiar de mundo no se reuse el degradado del anterior
      ctx.fillStyle = degradado("cielo:" + esc.nombre, function () {
        var g = ctx.createLinearGradient(0, 0, 0, groundY());
        for (var i = 0; i < esc.cielo.length; i++) g.addColorStop(esc.cielo[i][0], esc.cielo[i][1]);
        return g;
      });
      ctx.fillRect(0, 0, W, groundY());

      drawAstro();

      // estrellas titilando, fijas por partida
      state.stars.forEach(function (s) {
        var alpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(state.elapsed * s.speed + s.seed));
        ctx.fillStyle = "rgba(255,255,255," + alpha.toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * groundY(), s.r, 0, Math.PI * 2);
        ctx.fill();
      });

      drawNubes();
      drawEstrellaFugaz();

      // la capa de más atrás cambia por completo según el mundo
      if (esc.fondo === "arboles") drawArboles();
      else if (esc.fondo === "puente") drawPuente();
      else drawCerros();

      var tinte = "rgba(" + esc.acento + ",";
      drawSkylineLayer(state.bgFar, state.bgScrollFar, "rgba(18,12,22,.55)", tinte + ".35)");
      drawSkylineLayer(state.bgNear, state.bgScrollNear, "rgba(14,9,16,.8)", tinte + ".55)");
      drawLetreroToppings();
      drawVallas();

      // neblina baja: solo el amanecer la usa, y va DESPUÉS de las siluetas
      // para que se vea el vapor pasando por delante de los cerros
      if (esc.neblina > 0) {
        ctx.fillStyle = degradado("neblina:" + esc.nombre, function () {
          var g = ctx.createLinearGradient(0, groundY() - 150, 0, groundY());
          g.addColorStop(0, "rgba(255,225,190,0)");
          g.addColorStop(1, "rgba(255,225,190," + esc.neblina + ")");
          return g;
        });
        ctx.fillRect(0, groundY() - 150, W, 150);
      }

      if (esc.rayos) drawRayo();
      if (esc.chispas) drawChispas();
    }

    /* Lo que cae del cielo en las temporadas: nieve, corazones, murciélagos o
       confeti. Es una sola pasada con las mismas partículas; solo cambia cómo
       se dibuja cada una, así que sale barato aunque se vea muy distinto. */
    function drawChispas() {
      var tipo = state.esc.chispas;
      var alto = groundY();
      for (var i = 0; i < state.chispas.length; i++) {
        var c = state.chispas[i];
        var x = c.x * W + Math.sin(state.elapsed * c.vaiven + c.semilla) * c.amplitud;
        var y = c.y * alto;

        if (tipo === "nieve") {
          ctx.fillStyle = "rgba(255,255,255," + c.alpha.toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(x, y, c.r, 0, Math.PI * 2); ctx.fill();
        } else if (tipo === "corazones") {
          ctx.fillStyle = "rgba(255,120,160," + c.alpha.toFixed(2) + ")";
          ctx.font = (c.r * 5).toFixed(0) + "px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("♥", x, y);
        } else if (tipo === "murcielagos") {
          // dos arcos que aletean: alcanza para leerse como murciélago
          var ala = Math.sin(state.elapsed * 9 + c.semilla) * c.r * 1.1;
          ctx.strokeStyle = "rgba(20,14,26," + (c.alpha + 0.25).toFixed(2) + ")";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x - c.r * 2.2, y + ala);
          ctx.quadraticCurveTo(x, y - c.r * 1.6, x + c.r * 2.2, y + ala);
          ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(" + c.color + "," + c.alpha.toFixed(2) + ")";
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(state.elapsed * c.giro + c.semilla);
          ctx.fillRect(-c.r, -c.r * 0.5, c.r * 2, c.r);
          ctx.restore();
        }
      }
      ctx.lineWidth = 1;
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }

    /* Luna, luna pálida o sol, según el mundo. Es el elemento que más rápido
       le dice al ojo si es de noche o de día. */
    function drawAstro() {
      var esc = state.esc;
      var x = W * (0.72 + state.moonSeed * 0.15);
      var y = groundY() * 0.16;
      var r = esc.astro === "sol" ? 21 : esc.astro === "lunaGigante" ? 46 : 15;

      var cuerpo = esc.astro === "sol" ? "#ffe9a8"
                 : esc.astro === "lunaPalida" ? "#c9c9d8"
                 : esc.astro === "lunaGigante" ? "#ffcf7a" : "#fff4d6";
      var halo = esc.astro === "sol" ? "255,200,110"
               : esc.astro === "lunaPalida" ? "200,200,225"
               : esc.astro === "lunaGigante" ? "255,160,40" : "255,244,214";
      var fuerza = esc.astro === "sol" ? 0.4
                 : esc.astro === "lunaPalida" ? 0.14
                 : esc.astro === "lunaGigante" ? 0.34 : 0.25;

      /* El halo se arma centrado en (0,0) y se mueve con translate: así no
         depende de dónde caiga y alcanza con guardarlo una vez. */
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = degradado("halo:" + esc.nombre, function () {
        var g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 3.4);
        g.addColorStop(0, "rgba(" + halo + "," + fuerza + ")");
        g.addColorStop(1, "rgba(" + halo + ",0)");
        return g;
      });
      ctx.beginPath(); ctx.arc(0, 0, r * 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.fillStyle = cuerpo;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // el cráter que le da volumen a la luna; el sol va limpio
      if (esc.astro !== "sol") {
        ctx.fillStyle = "rgba(120,110,130,.30)";
        ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.2, r * 0.9, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* Cordillera. Un solo camino relleno para las dos vueltas del patrón:
       menos llamadas al canvas que dibujar cerro por cerro. */
    function drawCerros() {
      var p = state.cerros;
      var totalW = p.totalW;
      var offset = state.bgScrollCerros % totalW;
      var base = groundY();

      ctx.fillStyle = "rgba(30,18,34,.72)";
      ctx.beginPath();
      ctx.moveTo(-10, base);
      for (var vuelta = 0; vuelta < 2; vuelta++) {
        for (var i = 0; i < p.items.length; i++) {
          var c = p.items[i];
          var x0 = c.x - offset + vuelta * totalW;
          if (x0 > W + 60 || x0 + c.w < -60) continue;
          ctx.lineTo(x0, base);
          ctx.lineTo(x0 + c.w * c.pico, base - c.h);
          ctx.lineTo(x0 + c.w, base);
        }
      }
      ctx.lineTo(W + 10, base);
      ctx.closePath();
      ctx.fill();

      /* Nieve/niebla en las puntas: una pincelada clara arriba de cada pico.
         Es lo que hace que se lean como cerros y no como triángulos. */
      ctx.fillStyle = "rgba(255,235,205,.10)";
      for (var v2 = 0; v2 < 2; v2++) {
        for (var j = 0; j < p.items.length; j++) {
          var m = p.items[j];
          var mx = m.x - offset + v2 * totalW;
          if (mx > W + 60 || mx + m.w < -60) continue;
          var px = mx + m.w * m.pico;
          var py = base - m.h;
          var caida = m.h * 0.22;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + m.w * 0.16, py + caida);
          ctx.lineTo(px - m.w * 0.16, py + caida);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    /* Arboleda de la zona universitaria. Se reusa el patrón de los cerros
       (mismo array, misma vuelta) pero cada "pico" se dibuja como copa de
       árbol: tronco + tres bochas. */
    function drawArboles() {
      var p = state.cerros;
      var totalW = p.totalW;
      var offset = state.bgScrollCerros % totalW;
      var base = groundY();

      for (var v = 0; v < 2; v++) {
        for (var i = 0; i < p.items.length; i++) {
          var a = p.items[i];
          var x = a.x - offset + v * totalW + a.w * 0.5;
          if (x > W + 80 || x < -80) continue;
          var alto = a.h * 0.62;
          var rc = 26 + (a.w % 17);

          ctx.fillStyle = "rgba(20,26,20,.85)";
          ctx.fillRect(x - 3, base - alto * 0.55, 6, alto * 0.55);

          ctx.fillStyle = "rgba(26,40,30,.9)";
          ctx.beginPath();
          ctx.arc(x, base - alto * 0.62, rc, 0, Math.PI * 2);
          ctx.arc(x - rc * 0.72, base - alto * 0.48, rc * 0.72, 0, Math.PI * 2);
          ctx.arc(x + rc * 0.72, base - alto * 0.5, rc * 0.78, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* Puente colgante de Noche Extrema: dos torres, el cable colgando entre
       ellas y las tirantas verticales. Con luces rojas de aviso arriba. */
    function drawPuente() {
      var totalW = Math.max(520, W * 1.4);
      var offset = state.bgScrollCerros % totalW;
      var base = groundY();
      var altoTorre = Math.min(groundY() * 0.55, 230);

      for (var v = 0; v < 2; v++) {
        var x0 = -offset + v * totalW;
        var x1 = x0 + totalW * 0.62;
        if (x0 > W + 200 && x1 > W + 200) continue;

        var tabla = base - altoTorre * 0.34;

        // la calzada
        ctx.fillStyle = "rgba(16,16,24,.85)";
        ctx.fillRect(x0 - 40, tabla, (x1 - x0) + 80, 5);

        // el cable principal, colgando entre las dos torres
        ctx.strokeStyle = "rgba(70,70,92,.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, base - altoTorre);
        ctx.quadraticCurveTo((x0 + x1) / 2, base - altoTorre * 0.42, x1, base - altoTorre);
        ctx.stroke();

        // tirantas: se calcula la parábola del cable para colgarlas de ahí
        ctx.strokeStyle = "rgba(70,70,92,.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var t = 0.08; t < 0.96; t += 0.09) {
          var tx = x0 + (x1 - x0) * t;
          var u = 1 - t;
          var ty = u * u * (base - altoTorre) +
                   2 * u * t * (base - altoTorre * 0.42) +
                   t * t * (base - altoTorre);
          ctx.moveTo(tx, ty); ctx.lineTo(tx, tabla);
        }
        ctx.stroke();

        // las dos torres, con su luz de aviso
        [x0, x1].forEach(function (tx) {
          ctx.fillStyle = "rgba(22,22,32,.92)";
          ctx.fillRect(tx - 5, base - altoTorre, 10, altoTorre);
          ctx.fillStyle = "rgba(255,70,70," + (0.45 + 0.45 * Math.sin(state.elapsed * 3)).toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(tx, base - altoTorre - 4, 3, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.lineWidth = 1;
    }

    /** Relámpago: un fogonazo blanco corto en todo el cielo. */
    function drawRayo() {
      if (!(state.rayo > 0)) return;
      // dos golpes seguidos, como los relámpagos de verdad
      var f = state.rayo;
      var alpha = (f > 0.75 ? (1 - f) * 4 : f) * 0.16;
      if (alpha <= 0) return;
      ctx.fillStyle = "rgba(210,225,255," + alpha.toFixed(3) + ")";
      ctx.fillRect(0, 0, W, groundY());
    }

    /* Las vallas con las frases del negocio. Viajan con la ciudad cercana,
       así que pasan al mismo ritmo que los edificios de adelante. */
    function drawVallas() {
      var p = state.vallas;
      if (!p.items.length) return;
      var totalW = p.totalW;
      var offset = state.bgScrollNear % totalW;
      var base = groundY();
      var esc = state.esc;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (var v = 0; v < 2; v++) {
        for (var i = 0; i < p.items.length; i++) {
          var c = p.items[i];
          var x = c.x - offset + v * totalW;
          if (x > W + 150 || x < -150) continue;

          ctx.font = "800 12px system-ui, -apple-system, sans-serif";
          var ancho = Math.min(W * 0.62, ctx.measureText(c.texto).width + 26);
          var alto = 30;
          var top = base - c.poste - alto;

          // los dos postes
          ctx.fillStyle = "rgba(10,8,14,.9)";
          ctx.fillRect(x - ancho / 2 + 6, top + alto, 3, c.poste);
          ctx.fillRect(x + ancho / 2 - 9, top + alto, 3, c.poste);

          // el tablero y su marco encendido
          ctx.fillStyle = "rgba(18,13,22,.94)";
          ctx.fillRect(x - ancho / 2, top, ancho, alto);
          ctx.strokeStyle = "rgba(" + esc.acento + ",.6)";
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x - ancho / 2 + 0.5, top + 0.5, ancho - 1, alto - 1);
          ctx.lineWidth = 1;

          ctx.fillStyle = "rgba(" + esc.acento + ",.95)";
          ctx.fillText(c.texto, x, top + alto / 2);
        }
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    function drawNubes() {
      var alto = groundY();
      for (var i = 0; i < state.nubes.length; i++) {
        var n = state.nubes[i];
        var cx = n.x * W, cy = n.y * alto;
        ctx.fillStyle = "rgba(255,228,205," + n.alpha.toFixed(3) + ")";
        /* TODOS los círculos en un solo trazo y un solo relleno. Rellenándolos
           de a uno, el alpha se suma donde se pisan y la nube se ve como un
           montón de pelotas; en un trazo único queda una sola mancha pareja. */
        ctx.beginPath();
        for (var j = 0; j < n.bolas.length; j++) {
          var b = n.bolas[j];
          ctx.moveTo(cx + b.dx * n.escala + b.r * n.escala, cy + b.dy * n.escala);
          ctx.arc(cx + b.dx * n.escala, cy + b.dy * n.escala, b.r * n.escala, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }

    function drawEstrellaFugaz() {
      var f = state.estrellaFugaz;
      if (!f) return;
      // aparece y se apaga con el mismo gesto, para que no corte de golpe
      var vida = f.t / 0.9;
      var alpha = Math.sin(vida * Math.PI) * 0.85;
      var x = f.x * W + vida * f.largo * 1.6;
      var y = f.y * groundY() + vida * f.largo * 0.6;
      ctx.strokeStyle = "rgba(255,246,224," + alpha.toFixed(2) + ")";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - f.largo * 0.9, y - f.largo * 0.34);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    /* Un letrero de TOPPINGS en el horizonte, apoyado en la ciudad. Late
       despacio, como un aviso de neón. Es lo único de marca en el fondo. */
    /* La marca dentro del mundo. Cambia de forma según el escenario, que es
       lo que hace que se sienta parte del lugar y no un logo pegado encima:
       rótulo de neón en la ciudad, grafiti en el muro de la universidad, y
       letras chorreadas en Noche Extrema. */
    function drawLetreroToppings() {
      var totalW = state.bgNear.totalW;
      var x = W * 0.62 - (state.bgScrollNear % (totalW * 2));
      // el letrero viaja con la ciudad y reaparece cada dos vueltas
      if (x < -220) x += totalW * 2;
      if (x > W + 40 || x < -220) return;

      var acento = state.esc.acento;
      var base = groundY() - 44;

      if (state.esc.marca === "grafiti") {
        /* Muro pintado. Va pegado al piso y con la letra torcida, como una
           pinta de verdad — un cartel prolijo ahí quedaría fuera de lugar. */
        var mh = 46, mw = 190;
        var my = groundY() - mh;
        ctx.fillStyle = "rgba(58,54,64,.95)";
        ctx.fillRect(x, my, mw, mh);
        ctx.fillStyle = "rgba(30,28,36,.6)";
        for (var lad = 0; lad < 3; lad++) ctx.fillRect(x, my + lad * 16, mw, 1);

        ctx.save();
        ctx.translate(x + mw / 2, my + mh / 2);
        ctx.rotate(-0.045);
        ctx.font = "900 26px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(12,10,16,.9)";
        ctx.strokeText("TOPPINGS", 0, 0);
        ctx.fillStyle = "rgba(" + acento + ",.92)";
        ctx.fillText("TOPPINGS", 0, 0);
        ctx.restore();
        ctx.lineWidth = 1;
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
        return;
      }

      if (state.esc.marca === "chorreado") {
        // letras grandes con chorreados colgando, sobre el muro industrial
        ctx.save();
        ctx.translate(x + 90, groundY() - 62);
        ctx.font = "900 30px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(8,8,12,.95)";
        ctx.strokeText("TOPPINGS", 0, 0);
        ctx.fillStyle = "rgba(" + acento + ",.85)";
        ctx.fillText("TOPPINGS", 0, 0);
        // los chorreados: se reparten a lo ancho de la palabra
        ctx.fillStyle = "rgba(" + acento + ",.55)";
        for (var ch = 0; ch < 6; ch++) {
          var cx = -70 + ch * 28;
          ctx.fillRect(cx, 12, 2, 8 + hash01(ch, 3, 0) * 16);
        }
        ctx.restore();
        ctx.lineWidth = 1;
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
        return;
      }

      // neón: el rótulo colgado, latiendo
      var pulso = 0.72 + 0.28 * Math.sin(state.elapsed * 2.2);
      ctx.fillStyle = "rgba(10,7,12,.9)";
      ctx.fillRect(x + 8, base, 3, 44);
      ctx.fillRect(x + 62, base, 3, 44);

      ctx.fillStyle = "rgba(16,10,18,.92)";
      ctx.fillRect(x, base - 20, 74, 22);
      ctx.strokeStyle = "rgba(" + acento + "," + (pulso * 0.75).toFixed(2) + ")";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x + 0.5, base - 19.5, 73, 21);
      ctx.lineWidth = 1;

      ctx.fillStyle = "rgba(" + acento + "," + pulso.toFixed(2) + ")";
      ctx.font = "800 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("TOPPINGS", x + 37, base - 9);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    /* ---- figura temporal en dos ruedas — mientras corre por el suelo
       rebota un poco y las ruedas giran (más rápido mientras más rápido
       va el juego); en el aire se inclina, y durante un truco gira. ---- */
    function drawWheel(cx, cy, r, angle) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.restore();
    }

    function drawCharacter(charX) {
      var doingTrick = state.trick && state.trick.active;
      var bob = (state.onGround && !doingTrick) ? Math.sin(state.animT * 9) * 2.5 : 0;
      var tilt = state.falling
        ? state.fallT * 14 // vuelta de campana cayendo al abismo
        : doingTrick
        ? (state.trick.t * 7)
        : (state.onGround ? 0 : Math.max(-0.3, Math.min(0.3, state.velocityY / 2600)));
      var wheelAngle = state.animT * 6;
      var cx = charX + CHAR_SIZE / 2;
      var cy = state.charY + CHAR_SIZE / 2 + bob;
      var flashing = state.invulnUntil > state.elapsed;

      var img = character === "bmx" ? bmxImg : skateImg;
      var imgReady = img.complete && img.naturalWidth > 0;

      // sombra en el suelo — se achica y aclara mientras más alto salta;
      // desaparece mientras cae de verdad a un abismo
      if (!state.falling) {
        var groundHere = groundYAt(charX);
        var heightOffGround = Math.max(0, groundHere - (state.charY + CHAR_SIZE));
        var shadowShrink = Math.max(0.35, 1 - heightOffGround / 90);
        ctx.save();
        ctx.globalAlpha = Math.max(0.12, 0.32 * shadowShrink);
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(cx, groundHere - 1, (CHAR_SIZE * 0.5) * shadowShrink, 4 * shadowShrink, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      // se va desvaneciendo mientras se hunde en el abismo
      var fallFade = state.falling ? Math.max(0, 1 - state.fallT / FALL_DURATION_S) : 1;
      ctx.globalAlpha = (flashing ? (Math.sin(state.elapsed * 30) > 0 ? 1 : 0.35) : 1) * fallFade;
      ctx.translate(cx, cy);
      ctx.rotate(tilt);

      if (imgReady) {
        // Imagen real (recortada de la hoja de personajes) — un poco más
        // grande que la caja de colisión (CHAR_SIZE) para que se vea bien,
        // el tamaño de la colisión en sí no cambia.
        var rh = CHAR_SIZE * 1.55;
        var rw = rh * (img.naturalWidth / img.naturalHeight);

        /* Aplastar y estirar. Es un dibujo solo, sin cuadros de animación:
           al caer se achata y se ensancha, y en el aire se estira un poco
           hacia arriba. Es el truco más viejo del mundo y es el que hace que
           un muñeco quieto parezca que tiene peso.

           Se deforma desde los PIES, no desde el centro: si no, al achatarse
           parecería que flota sobre el piso. */
        var apl = state.aterrizaje || 0;
        var enElAire = !state.onGround && !state.falling && !doingTrick;
        var estira = enElAire ? Math.min(0.13, Math.abs(state.velocityY) / 5200) : 0;
        var escX = 1 + apl * 0.26 - estira * 0.7;
        var escY = 1 - apl * 0.3 + estira;

        ctx.translate(0, rh / 2);      // al piso
        ctx.scale(escX, escY);
        ctx.translate(0, -rh / 2);     // y de vuelta

        ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);
        ctx.restore();
      } else {
      ctx.translate(-CHAR_SIZE / 2, -CHAR_SIZE / 2);

      if (character === "bmx") {
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(2, CHAR_SIZE - 8, CHAR_SIZE - 4, 4);
        ctx.fillRect(CHAR_SIZE - 10, CHAR_SIZE - 16, 2, 10); // manubrio
        drawWheel(6, CHAR_SIZE - 4, 5, wheelAngle);
        drawWheel(CHAR_SIZE - 6, CHAR_SIZE - 4, 5, wheelAngle);
        // remolino de helado soft en dos capas, para que se vea más "soft serve"
        ctx.fillStyle = "#fff8e6";
        ctx.beginPath();
        ctx.moveTo(CHAR_SIZE / 2, 2);
        ctx.quadraticCurveTo(CHAR_SIZE / 2 + 9, 10, CHAR_SIZE / 2, 17);
        ctx.quadraticCurveTo(CHAR_SIZE / 2 - 9, 10, CHAR_SIZE / 2, 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(CHAR_SIZE / 2, 12);
        ctx.quadraticCurveTo(CHAR_SIZE / 2 + 7, 18, CHAR_SIZE / 2, 24);
        ctx.quadraticCurveTo(CHAR_SIZE / 2 - 7, 18, CHAR_SIZE / 2, 12);
        ctx.fill();
        // ojitos
        ctx.fillStyle = "#2a2a2a";
        ctx.beginPath(); ctx.arc(CHAR_SIZE / 2 - 3, 15, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(CHAR_SIZE / 2 + 3, 15, 1.4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(2, CHAR_SIZE - 6, CHAR_SIZE - 4, 5); // patineta
        drawWheel(6, CHAR_SIZE, 3, wheelAngle);
        drawWheel(CHAR_SIZE - 6, CHAR_SIZE, 3, wheelAngle);
        // cuerpo de papa
        ctx.fillStyle = "#c98a4b";
        ctx.beginPath(); ctx.ellipse(CHAR_SIZE / 2, CHAR_SIZE / 2, 12, 16, 0, 0, Math.PI * 2); ctx.fill();
        // brazo (pequeño, se balancea con el rebote)
        ctx.strokeStyle = "#c98a4b"; ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(CHAR_SIZE / 2 - 9, CHAR_SIZE / 2 + 2);
        ctx.lineTo(CHAR_SIZE / 2 - 14, CHAR_SIZE / 2 + 2 + bob * 1.5);
        ctx.stroke();
        // gorra
        ctx.fillStyle = "#1c1c1c";
        ctx.beginPath(); ctx.ellipse(CHAR_SIZE / 2, CHAR_SIZE / 2 - 12, 8, 4, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(CHAR_SIZE / 2 - 2, CHAR_SIZE / 2 - 15, 10, 4);
        // gafas de sol
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(CHAR_SIZE / 2 - 7, CHAR_SIZE / 2 - 7, 14, 4);
      }
      ctx.restore();
      }

      // líneas de movimiento cuando ya va rápido
      if (!doingTrick && state.speed > BASE_SPEED * 1.35) {
        ctx.strokeStyle = "rgba(255,255,255,.28)";
        ctx.lineWidth = 1.5;
        for (var li = 0; li < 3; li++) {
          var ly = state.charY + 6 + li * 9;
          ctx.beginPath(); ctx.moveTo(charX - 4 - li * 6, ly); ctx.lineTo(charX - 12 - li * 6, ly); ctx.stroke();
        }
      }
    }

    function drawPickup(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.type === "coin") {
        var pulse = 1 + Math.sin(state.elapsed * 6 + p.x * 0.05) * 0.08;
        ctx.scale(pulse, pulse);
        ctx.fillStyle = degradado("moneda:" + p.r, function () {
          var g = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, 1, 0, 0, p.r);
          g.addColorStop(0, "#fff6c8");
          g.addColorStop(0.5, "#FFD400");
          g.addColorStop(1, "#c98f00");
          return g;
        });
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(122,90,0,.5)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, p.r - 0.5, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(-p.r * 0.25, -p.r * 0.25, p.r * 0.4, -0.4, 1.1); ctx.stroke();
        ctx.fillStyle = "#7a5a00";
        ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("T", 0, 0.5);
      } else if (p.type === "heart") {
        /* El corazón late y brilla en rojo, distinto de todo lo demás: si es
           raro y vale una vida, tiene que gritar desde lejos. */
        var latido = 1 + Math.sin(state.elapsed * 7 + p.x * 0.04) * 0.14;
        ctx.scale(latido, latido);
        ctx.fillStyle = degradado("brilloCorazon", function () {
          var g = ctx.createRadialGradient(0, 0, 1, 0, 0, 18);
          g.addColorStop(0, "rgba(255,70,110,.5)");
          g.addColorStop(1, "rgba(255,70,110,0)");
          return g;
        });
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
        ctx.font = "17px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("❤️", 0, 0);
      } else {
        ctx.fillStyle = degradado("brillo", function () {
          var g = ctx.createRadialGradient(0, 0, 1, 0, 0, 14);
          g.addColorStop(0, "rgba(255,212,0,.4)");
          g.addColorStop(1, "rgba(255,212,0,0)");
          return g;
        });
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
        ctx.font = "15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(POWERUP_ICON[p.type] === "2×" ? "✨" : POWERUP_ICON[p.type], 0, 0);
      }
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      drawBackground();

      // partículas: el polvo es blanco apagado, las chispas del riel amarillas
      state.particles.forEach(function (p) {
        var vida = Math.max(0, p.life / p.maxLife);
        if (p.chispa) {
          ctx.globalAlpha = vida;
          ctx.fillStyle = vida > 0.5 ? "#fff3b0" : "#ffb02e";
        } else {
          ctx.globalAlpha = vida * 0.5;
          ctx.fillStyle = "#fff";
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // terreno: cada tramo sigue su propia inclinación (o es un abismo sin
      // suelo), en vez de una franja plana — así las colinas y abismos son
      // parte real del camino, no un adorno encima.
      state.terrain.forEach(function (t) {
        if (t.isPit) {
          /* El abismo también baja hasta el fondo: si se quedara en la franja
             de 26 px se vería el cielo abajo y parecería un bache pintado, no
             un vacío. */
          ctx.fillStyle = degradado("hueco", function () {
            var g = ctx.createLinearGradient(0, groundY(), 0, H);
            g.addColorStop(0, "#000");
            g.addColorStop(0.35, "#0d0805");
            g.addColorStop(1, "#000");
            return g;
          });
          ctx.fillRect(t.x, groundY() - 2, t.w, H - groundY() + 2);
          // las paredes del abismo, que es lo que le da la profundidad
          ctx.strokeStyle = "rgba(255,90,60,.55)"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(t.x, groundY()); ctx.lineTo(t.x, H); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(t.x + t.w, groundY()); ctx.lineTo(t.x + t.w, H); ctx.stroke();
          ctx.lineWidth = 1;
          return;
        }
        var ty0 = groundY() - t.h0, ty1 = groundY() - t.h1;
        var piso = state.esc.piso;
        var perfil = perfilDeTramo(t);

        /* El terreno se rellena HASTA ABAJO del lienzo, no en una franja.
           Antes era una losa de 26 px con el cielo asomando por debajo, y por
           eso la carretera parecía flotar y "quebrarse" al subir. Ahora es un
           bloque de tierra: cara de asfalto arriba, y subsuelo hasta el fondo. */
        var tArriba = Math.round(Math.min(ty0, ty1));
        ctx.fillStyle = degradado("subsuelo:" + state.esc.nombre + ":" + tArriba, function () {
          var g = ctx.createLinearGradient(0, tArriba + GROUND_H, 0, H);
          g.addColorStop(0, piso[2]);
          g.addColorStop(1, oscurecer(piso[2], 0.45));
          return g;
        });
        ctx.beginPath();
        ctx.moveTo(perfil[0][0], perfil[0][1]);
        for (var pi = 1; pi < perfil.length; pi++) ctx.lineTo(perfil[pi][0], perfil[pi][1]);
        ctx.lineTo(perfil[perfil.length - 1][0], H);
        ctx.lineTo(perfil[0][0], H);
        ctx.closePath();
        ctx.fill();

        // la cara de arriba: el asfalto propiamente dicho
        ctx.fillStyle = degradado("suelo:" + state.esc.nombre + ":" + tArriba, function () {
          var g = ctx.createLinearGradient(0, tArriba, 0, tArriba + GROUND_H);
          g.addColorStop(0, piso[0]);
          g.addColorStop(0.5, piso[1]);
          g.addColorStop(1, piso[2]);
          return g;
        });
        ctx.beginPath();
        ctx.moveTo(perfil[0][0], perfil[0][1]);
        for (var pj = 1; pj < perfil.length; pj++) ctx.lineTo(perfil[pj][0], perfil[pj][1]);
        for (var pk = perfil.length - 1; pk >= 0; pk--) ctx.lineTo(perfil[pk][0], perfil[pk][1] + GROUND_H);
        ctx.closePath();
        ctx.fill();

        // el filo de la superficie, que es lo que dibuja el borde de la calle
        ctx.strokeStyle = "rgba(" + state.esc.acento + ",.4)";
        ctx.beginPath();
        ctx.moveTo(perfil[0][0], perfil[0][1]);
        for (var pm = 1; pm < perfil.length; pm++) ctx.lineTo(perfil[pm][0], perfil[pm][1]);
        ctx.stroke();
        if (t.isBridge) {
          // puente: puramente decorativo, el terreno debajo sigue plano y sin peligro
          ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(t.x, ty0 - 10); ctx.lineTo(t.x + t.w, ty1 - 10); ctx.stroke();
          ctx.lineWidth = 1;
          for (var bx = t.x + 14; bx < t.x + t.w - 10; bx += 34) {
            ctx.beginPath(); ctx.moveTo(bx, ty0 - 10); ctx.lineTo(bx, ty0); ctx.stroke();
          }
        }
        if (t.curb) {
          ctx.fillStyle = "rgba(255,255,255,.4)";
          ctx.fillRect(t.x, ty0 - 3, 4, 3);
          ctx.fillRect(t.x + t.w - 4, ty1 - 3, 4, 3);
        }
        if (t.prop) {
          var px = t.x + t.w * 0.5, pgy = groundY() - t.h0;
          if (t.prop === "lamppost") {
            ctx.strokeStyle = "rgba(200,200,210,.55)"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(px, pgy); ctx.lineTo(px, pgy - 58); ctx.stroke();
            ctx.fillStyle = "rgba(255,212,0,.5)";
            ctx.beginPath(); ctx.arc(px, pgy - 62, 5, 0, Math.PI * 2); ctx.fill();
          } else if (t.prop === "hydrant") {
            ctx.fillStyle = "rgba(220,60,50,.6)";
            ctx.fillRect(px - 4, pgy - 16, 8, 16);
            ctx.fillRect(px - 6, pgy - 18, 12, 4);
          }
        }
      });

      /* Granito del asfalto. Las posiciones salen de hash01 sobre la distancia
         recorrida, NO de Math.random: si fueran al azar cada cuadro el piso
         titilaría como ruido de televisión. Así viajan pegadas al suelo. */
      var granoPaso = 13;
      var granoBase = Math.floor(state.groundScroll / granoPaso);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      for (var gi = 0; gi < Math.ceil(W / granoPaso) + 2; gi++) {
        var idx = granoBase + gi;
        var gx = idx * granoPaso - state.groundScroll;
        var gh = terrainHeightAt(gx);
        if (gh === null) continue;
        var gyTop = groundY() - gh;
        ctx.fillRect(gx + hash01(idx, 1, 0) * granoPaso, gyTop + 3 + hash01(idx, 2, 0) * (GROUND_H - 8), 2, 2);
      }

      // marcas de carril, siguiendo la altura del terreno en cada punto
      var dashLen = 16, dashGap = 14, dashCycle = dashLen + dashGap;
      var dashOffset = state.groundScroll % dashCycle;
      ctx.fillStyle = "rgba(" + state.esc.carril + ",.30)";
      for (var dx = -dashOffset; dx < W; dx += dashCycle) {
        var dh = terrainHeightAt(dx);
        if (dh === null) continue; // no hay marcas sobre un abismo
        ctx.fillRect(dx, groundY() - dh + GROUND_H * 0.42, dashLen, 2);
      }

      state.obstacles.forEach(function (o) {
        var oGroundY = groundYAt(o.x + o.w / 2);
        var oy = oGroundY - (o.type === "rail" ? 0 : o.h);
        // sombra bajo el obstáculo/rampa, mismo tratamiento que el personaje
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, oGroundY - 1, o.w * 0.55, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (o.type === "rail") {
          var railGrad = ctx.createLinearGradient(o.x, o.y - 3, o.x, o.y + 3);
          railGrad.addColorStop(0, "#fff7d6");
          railGrad.addColorStop(0.5, "#FFD400");
          railGrad.addColorStop(1, "#a87400");
          ctx.fillStyle = railGrad;
          ctx.fillRect(o.x, o.y, o.w, 4);
          ctx.fillStyle = "rgba(120,90,0,.5)";
          ctx.fillRect(o.x + 3, o.y + 4, 2, oGroundY - (o.y + 4));
          ctx.fillRect(o.x + o.w - 5, o.y + 4, 2, oGroundY - (o.y + 4));
          ctx.fillStyle = "rgba(255,255,255,.75)";
          ctx.fillRect(o.x, o.y, o.w, 1);
        } else if (o.type === "ramp") {
          var rampGrad = ctx.createLinearGradient(o.x, oGroundY - o.h, o.x + o.w, oGroundY);
          rampGrad.addColorStop(0, "#FFE666");
          rampGrad.addColorStop(1, "#E0A800");
          ctx.fillStyle = rampGrad;
          ctx.beginPath();
          ctx.moveTo(o.x, oGroundY);
          ctx.lineTo(o.x + o.w, oGroundY);
          ctx.lineTo(o.x + o.w, oGroundY - o.h);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1; ctx.stroke();
          // flechita indicando la subida
          ctx.strokeStyle = "rgba(17,17,17,.55)"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(o.x + o.w * 0.35, oGroundY - o.h * 0.35);
          ctx.lineTo(o.x + o.w * 0.55, oGroundY - o.h * 0.6);
          ctx.lineTo(o.x + o.w * 0.4, oGroundY - o.h * 0.6);
          ctx.stroke();
        } else if (o.variant === 1) {
          // cono de tránsito
          var coneGrad = ctx.createLinearGradient(o.x, oy, o.x + o.w, oy);
          coneGrad.addColorStop(0, "#ff8a3d"); coneGrad.addColorStop(1, "#e8590c");
          ctx.fillStyle = coneGrad;
          ctx.beginPath();
          ctx.moveTo(o.x + o.w / 2, oy);
          ctx.lineTo(o.x + o.w, oGroundY);
          ctx.lineTo(o.x, oGroundY);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,.85)";
          ctx.fillRect(o.x + o.w * 0.14, oy + o.h * 0.52, o.w * 0.72, o.h * 0.14);
        } else if (o.variant === 2) {
          // caja de madera
          var crateGrad = ctx.createLinearGradient(o.x, oy, o.x, oGroundY);
          crateGrad.addColorStop(0, "#c98a4b"); crateGrad.addColorStop(1, "#8a5a2b");
          ctx.fillStyle = crateGrad;
          ctx.fillRect(o.x, oy, o.w, o.h);
          ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 1;
          ctx.strokeRect(o.x + 1, oy + 1, o.w - 2, o.h - 2);
          ctx.beginPath();
          ctx.moveTo(o.x, oy); ctx.lineTo(o.x + o.w, oGroundY);
          ctx.moveTo(o.x + o.w, oy); ctx.lineTo(o.x, oGroundY);
          ctx.stroke();
        } else {
          // caneca de basura
          var canGrad = ctx.createLinearGradient(o.x, oy, o.x + o.w, oy);
          canGrad.addColorStop(0, "#e9ecef"); canGrad.addColorStop(1, "#adb5bd");
          ctx.fillStyle = canGrad;
          ctx.fillRect(o.x, oy + o.h * 0.12, o.w, o.h * 0.88);
          ctx.fillStyle = "#495057";
          ctx.fillRect(o.x - 1, oy, o.w + 2, o.h * 0.16);
          ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(o.x + o.w * 0.3, oy + o.h * 0.35); ctx.lineTo(o.x + o.w * 0.3, oGroundY - 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(o.x + o.w * 0.7, oy + o.h * 0.35); ctx.lineTo(o.x + o.w * 0.7, oGroundY - 2); ctx.stroke();
        }
      });

      state.pickups.forEach(drawPickup);

      /* Los pájaros. Dos arcos que aletean con el cuerpo en medio: alcanza
         para leerse de una, y a este tamaño un dibujo detallado no se vería. */
      state.pajaros.forEach(function (pa) {
        var ala = Math.sin(pa.aleteo) * pa.r * 0.85;
        ctx.strokeStyle = "rgba(30,24,34,.92)";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(pa.x - pa.r * 1.5, pa.y + ala);
        ctx.quadraticCurveTo(pa.x - pa.r * 0.4, pa.y - pa.r * 0.9, pa.x, pa.y);
        ctx.quadraticCurveTo(pa.x + pa.r * 0.4, pa.y - pa.r * 0.9, pa.x + pa.r * 1.5, pa.y + ala);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(30,24,34,.92)";
        ctx.beginPath(); ctx.ellipse(pa.x, pa.y + 1, pa.r * 0.42, pa.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        // el ojo, que es lo que lo hace ver vivo y no una mancha
        ctx.fillStyle = "rgba(255,220,120,.9)";
        ctx.beginPath(); ctx.arc(pa.x - pa.r * 0.18, pa.y, 1.1, 0, Math.PI * 2); ctx.fill();
      });

      /* El aura del imán. Sin esto la gente agarraba el 🧲 y no pasaba nada
         visible, así que parecía que el power-up estaba roto. */
      if (state.activePowerups.magnet > 0) {
        var mx = W * CHAR_X_RATIO + CHAR_SIZE / 2;
        var my = state.charY + CHAR_SIZE / 2;
        var pulsoIman = 0.85 + 0.15 * Math.sin(state.elapsed * 5);
        ctx.strokeStyle = "rgba(120,190,255," + (0.16 * pulsoIman).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mx, my, MAGNET_RADIUS * pulsoIman, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(120,190,255," + (0.10 * pulsoIman).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(mx, my, MAGNET_RADIUS * 0.62 * pulsoIman, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }

      drawCharacter(W * CHAR_X_RATIO);

      if (state.trickText) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, state.trickText.life));
        var ttx = W * CHAR_X_RATIO + CHAR_SIZE / 2, tty = state.charY - 12 - (1.1 - state.trickText.life) * 18;
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(17,17,17,.85)";
        ctx.strokeText(state.trickText.text, ttx, tty);
        ctx.fillStyle = "#FFD400";
        ctx.fillText(state.trickText.text, ttx, tty);
        ctx.restore();
      }

      drawLineasDeVelocidad();
      drawDestello();
    }

    /* Rayas horizontales que cruzan la pantalla cuando el escenario ya va
       rápido. Aparecen de a poco: si estuvieran desde el arranque no se
       notaría que el juego se está acelerando, que es justo lo que cuentan. */
    function drawLineasDeVelocidad() {
      var exceso = (state.speed - BASE_SPEED * 1.5) / (BASE_SPEED * 2);
      if (exceso <= 0) return;
      var fuerza = Math.min(1, exceso);
      var cuantas = 5;
      ctx.strokeStyle = "rgba(255,255,255," + (0.05 + fuerza * 0.13).toFixed(3) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 0; i < cuantas; i++) {
        // cada raya tiene su propia altura y su propio ciclo, para que no
        // parezcan un peine bajando junto
        var ciclo = (state.groundScroll * (0.8 + i * 0.12) + i * 240) % (W + 200);
        var x = W + 100 - ciclo;
        var y = groundY() * (0.12 + hash01(i, 7, 0) * 0.72);
        var largo = 30 + hash01(i, 9, 0) * 55 * fuerza;
        ctx.moveTo(x, y);
        ctx.lineTo(x - largo, y);
      }
      ctx.stroke();
    }

    /** Fogonazo al chocar: tiñe la pantalla un instante. */
    function drawDestello() {
      if (!(state.destello > 0)) return;
      ctx.fillStyle = "rgba(255,70,70," + (state.destello * 0.26).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    function gameOver() {
      state.over = true;
      stopRunBgMusic();
      sfxGameOver();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      var finalScore = Math.floor(state.score);
      var isRecord = finalScore > state.record;
      if (isRecord) {
        state.record = finalScore;
        localStorage.setItem(RECORD_KEY, String(finalScore));
        if (recordEl) recordEl.textContent = "🏆 " + finalScore;
      }
      if (finalScoreEl) finalScoreEl.textContent = "Puntos: " + finalScore + (isRecord ? " · 🏆 ¡Nuevo récord!" : "");
      if (overlay) overlay.hidden = false;
      if (leaderboardEl) leaderboardEl.hidden = true;
      submitScoreAndShowLeaderboard(finalScore);
    }

    /* ---- ranking: se manda el puntaje al terminar la partida y se muestra
       el top del período (nunca rompe el juego si falla). El deviceId viaja
       en cada envío — es lo único que el servidor usa para decidir después
       quién puede reclamar el premio del #1. ---- */
    function submitScoreAndShowLeaderboard(finalScore) {
      if (!playerName) return;
      fetch(LEADERBOARD_API + "?action=submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: playerName, score: finalScore, deviceId: getDeviceId() })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) return;
          lastStatus = res;
          // El servidor ignora los puntajes mientras el evento está congelado
          // (esperando a que el ganador reclame) — aquí se le avisa al jugador.
          if (eventIsFrozen(res) && finalScoreEl) {
            finalScoreEl.textContent += " · ⚠️ El evento terminó: estos puntos no cuentan para el ranking.";
          }
          renderLeaderboard(res);
        })
        .catch(function (e) { console.warn("[toppings-run] no se pudo guardar el puntaje:", e); });
    }

    /* ---- premio al #1 del ranking: solo el dispositivo del ganador puede
       reclamar — la validación real ocurre en el servidor (ver run-leaderboard.php,
       acción "claim"); aquí solo se refleja lo que el servidor ya decidió, nunca
       se decide nada en el cliente. ---- */
    var claimCountdownTimer = null;

    function formatClaimCountdown(ms) {
      if (ms <= 0) return "00:00:00";
      var totalSec = Math.floor(ms / 1000);
      var h = Math.floor(totalSec / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      return pad(h) + ":" + pad(m) + ":" + pad(s);
    }

    /* ---- Estado del evento, a la vista de todos en la pantalla de inicio:
       mientras corre, cuánto falta para que termine; cuando termina, quién
       ganó y en cuánto se reinicia el sistema de puntos (el ranking queda
       congelado en ese lapso — ver run-leaderboard.php, acción "submit"). ---- */
    var eventCountdownTimer = null;
    var lastStatus = null;

    function eventIsFrozen(res) {
      return !!(res && res.claim && res.claim.status !== "waiting");
    }

    /* La pantalla de inicio mostraba cuatro bloques a la vez (cuenta atrás,
       ganador anterior en 3 líneas, top 3, y una pista larga de reclamo):
       demasiado texto para una tarjeta de celular. Ahora queda el top 3 con
       un reloj chico al lado, y UNA sola línea que dice lo único que el
       jugador necesita saber en ese momento. */
    /* El nombre del periodo sale de la configuración del panel, para que el
       cliente sepa si el top es de la hora, del día o de la semana. */
    function periodLabel(type) {
      if (type === "hourly") return "de esta hora";
      if (type === "daily") return "de hoy";
      return "de esta semana";
    }

    function shortLine(res) {
      var mine = res.mine;
      var top = (res.top && res.top.length) ? res.top[0] : null;

      if (eventIsFrozen(res)) {
        return res.canClaim
          ? "🥇 ¡Ganaste! Reclama tu premio abajo"
          : "Este evento ya cerró. Espera el siguiente para volver a competir.";
      }
      if (mine && mine.rank === 1) return "🥇 Vas primero — aguanta hasta el final";
      if (mine && top) {
        return "Vas " + mine.rank + "º · te faltan " + (top.score - mine.score) + " puntos para el 1º";
      }
      if (top) return "Supera " + top.score + " puntos para quedar primero";
      return "¡Sé el primero en jugar!";
    }

    /* ---- "Ganaste el evento anterior" ----
       El que quedó primero puede volver un día o dos después, cuando ya hay
       otro evento corriendo. Si le mostráramos el evento nuevo de una, nunca
       se enteraría de que ganó el anterior. Así que primero se le cuenta, y
       el evento nuevo aparece recién cuando cierra el mensaje.

       Lo de "ya lo vio" se guarda por PERIODO, no como un sí/no: si gana otra
       vez la semana siguiente, se le vuelve a avisar. */
    var GANE_KEY = "toppings_run_gane_visto";
    var avisoGane = null;

    function yaVioSuVictoria(periodo) {
      try { return localStorage.getItem(GANE_KEY) === periodo; } catch (e) { return false; }
    }

    /** Los datos del evento pasado para ESTE jugador, gane o no. */
    function resultadoPasado(res) {
      if (res.eventoPasado) return res.eventoPasado;
      // servidor viejo: solo sabía del ganador
      if (res.ganePasado) {
        return {
          puesto: 1, score: res.ganePasado.score, name: res.ganePasado.name,
          jugadores: 0, periodStart: res.ganePasado.periodStart, gano: true
        };
      }
      return null;
    }

    /** "2º", "3º"… en palabras cortas, que es como lo lee la gente. */
    function ordinal(n) {
      return n === 1 ? "1º" : n === 2 ? "2º" : n === 3 ? "3º" : (n + "º");
    }

    function mostrarAvisoGane(res) {
      var g = resultadoPasado(res);
      if (!g) return;
      var periodo = g.periodStart || "";
      var gano = !!g.gano;
      if (avisoGane && avisoGane.parentNode) avisoGane.parentNode.removeChild(avisoGane);

      avisoGane = document.createElement("div");
      avisoGane.className = "run-prev-win" + (gano ? "" : " is-perdio");
      avisoGane.setAttribute("data-run-prev-win", "");

      /* Al que ganó se le cuenta dónde está su premio. Al resto se le dice en
         qué puesto quedó — antes no se enteraban de nada: volvían y ya estaba
         el evento nuevo corriendo como si el anterior nunca hubiera pasado. */
      /* Cuándo fue. Importa: si alguien vuelve cinco días después, decirle
         "el evento anterior" a secas es confuso —en el medio hubo otros—, y
         además no entendería por qué le hablan de algo que no recuerda. */
      var dias = Number(g.diasAtras) || 0;
      var cuando = dias <= 0 ? "el evento anterior"
                 : dias === 1 ? "el evento de ayer"
                 : "el evento de hace " + dias + " días";
      var titulo = dias <= 0 ? "EVENTO ANTERIOR" : "TU ÚLTIMO EVENTO";

      var cuerpo = gano
        ? '<p class="run-prev-win-title">🏆 ¡GANASTE ' + escHtml(titulo) + "!</p>" +
          '<p class="run-prev-win-text">En ' + escHtml(cuando) + " quedaste <strong>#1</strong> con " +
            escHtml(String(g.score || 0)) + " puntos" +
            (periodo ? " · " + escHtml(periodo) : "") + ".</p>" +
          '<p class="run-prev-win-text">Tu premio ya está guardado en <strong>🎁 ' +
            escHtml(etiquetaRegalo()) + "</strong>, arriba. Mostralo en el local para reclamarlo.</p>"
        : '<p class="run-prev-win-title">🎮 ' + escHtml(titulo) + "</p>" +
          '<p class="run-prev-win-text">En ' + escHtml(cuando) + " quedaste <strong>" +
            escHtml(ordinal(g.puesto)) + "</strong> con " +
            escHtml(String(g.score || 0)) + " puntos" +
            (g.jugadores > 1 ? " entre " + escHtml(String(g.jugadores)) + " jugadores" : "") +
            (periodo ? " · " + escHtml(periodo) : "") + ".</p>" +
          '<p class="run-prev-win-text">Esa vez no ganaste el premio — <strong>solo el 1º se lo lleva</strong>. ' +
            "¡Ya hay otro evento corriendo y podés intentarlo de nuevo!</p>";

      avisoGane.innerHTML =
        '<button type="button" class="run-prev-win-close" aria-label="Cerrar">&times;</button>' +
        cuerpo +
        '<button type="button" class="run-prev-win-ok">VER EL EVENTO NUEVO</button>';

      function cerrar() {
        try { localStorage.setItem(GANE_KEY, periodo); } catch (e) {}
        if (avisoGane && avisoGane.parentNode) avisoGane.parentNode.removeChild(avisoGane);
        avisoGane = null;
        if (lastStatus) renderEventStatus(lastStatus);   // ahora sí, el evento nuevo
      }
      avisoGane.querySelector(".run-prev-win-close").addEventListener("click", cerrar);
      avisoGane.querySelector(".run-prev-win-ok").addEventListener("click", cerrar);
      card.insertBefore(avisoGane, card.firstChild);
    }

    /* El nombre del botón de premios lo pone el negocio desde el panel; acá se
       lee del mismo sitio para que el mensaje diga exactamente lo que el
       cliente ve arriba. */
    function etiquetaRegalo() {
      var el = document.querySelector("[data-gift-label]");
      var txt = el ? (el.textContent || "").trim() : "";
      return txt || "Mis premios";
    }

    function renderEventStatus(res) {
      clearInterval(eventCountdownTimer);
      lastStatus = res;

      /* Si jugó el evento pasado y todavía no vio cómo le fue, el evento
         nuevo espera: se le tapa hasta que cierre el mensaje. Vale para
         TODOS los que jugaron, no solo para el que ganó. */
      var pasado = resultadoPasado(res);
      if (pasado && !yaVioSuVictoria(pasado.periodStart || "")) {
        mostrarAvisoGane(res);
        if (leaderboardEl) leaderboardEl.hidden = true;
        if (statusEl) statusEl.hidden = true;
        if (eventCountdownEl) eventCountdownEl.hidden = true;
        if (prevWinnerEl) prevWinnerEl.hidden = true;
        return;
      }

      var frozen = eventIsFrozen(res);
      var clockOffset = Date.now() - res.serverNow;

      /* Ganador del evento ANTERIOR. Mientras el evento corre sale del
         historial; cuando ya terminó, el ganador de este evento pasa a ser
         "el anterior" para todos los demás. Siempre se dice de qué evento
         se trata — antes ponía solo "Ganó Fabián" y no se entendía cuándo. */
      if (prevWinnerEl) {
        var prev = frozen
          ? res.winner
          : ((res.history && res.history.length) ? res.history[0] : null);
        if (prev && prev.name) {
          // Una sola línea discreta al pie: es un dato de contexto, no la
          // información principal de la tarjeta.
          prevWinnerEl.innerHTML =
            "🏆 Ganador del evento anterior: " +
            '<strong>' + escHtml(prev.name) + "</strong> · " + prev.score + " pts";
          prevWinnerEl.hidden = false;
        } else {
          prevWinnerEl.hidden = true;
        }
      }

      if (statusEl) {
        statusEl.textContent = shortLine(res);
        statusEl.hidden = false;
        statusEl.classList.toggle("is-leading", !frozen && !!(res.mine && res.mine.rank === 1));
        statusEl.classList.toggle("is-won", frozen && !!res.canClaim);
      }

      // Un solo reloj: mientras corre el evento marca lo que falta para que
      // termine; una vez terminado, cuándo vuelve a abrirse.
      var target = frozen
        ? (res.claim && res.claim.windowEndsAtMs)
        : res.periodEndAtMs;
      if (!eventCountdownEl || !target) {
        if (eventCountdownEl) eventCountdownEl.hidden = true;
        return;
      }
      var paint = function () {
        var msLeft = Math.max(0, target - (Date.now() - clockOffset));
        eventCountdownEl.innerHTML = frozen
          ? '<span class="run-event-clock-label">🔄 El próximo evento empieza en</span><span class="run-event-clock-time">' + formatClaimCountdown(msLeft) + "</span>"
          : '<span class="run-event-clock-label">⏱️ Este evento termina en</span><span class="run-event-clock-time">' + formatClaimCountdown(msLeft) + "</span>";
        eventCountdownEl.hidden = false;
      };
      paint();
      eventCountdownTimer = setInterval(paint, 1000);
    }

    /* El botón de reclamar se ve SIEMPRE (no solo cuando el evento ya
       terminó) con 3 estados, para que cualquiera pueda ver en tiempo real
       si va ganando:
       - Gris, deshabilitado: no eres el top 1 ahora mismo.
       - Amarillo (color de "vas ganando"), deshabilitado: eres el top 1
         pero el evento todavía no termina — si alguien te pasa antes de
         que termine, vuelve a gris.
       - Amarillo, habilitado: el evento ya terminó y de verdad eres tú
         quien puede reclamar (esto lo decide el servidor, nunca el cliente). */
    function renderClaimUI(res) {
      if (!claimEl) return;
      clearInterval(claimCountdownTimer);
      claimEl.hidden = false;
      var claim = res.claim || {};
      var finished = claim.status === "available";
      var isTop1 = !!(res.mine && res.mine.rank === 1);

      if (claimBtn) {
        claimBtn.hidden = false;
        claimBtn.classList.remove("is-eligible", "is-leading");
        if (finished && res.canClaim) {
          claimBtn.disabled = false;
          claimBtn.classList.add("is-eligible");
        } else {
          claimBtn.disabled = true;
          if (isTop1 && !finished) claimBtn.classList.add("is-leading");
        }
      }

      // La pista larga desapareció: lo que antes explicaba ya lo dice en una
      // línea el estado de arriba, y el color del propio botón.
      if (claimCountdownEl && finished && res.canClaim && claim.windowEndsAtMs) {
        var clockOffset = Date.now() - res.serverNow;
        var paint = function () {
          var msLeft = Math.max(0, claim.windowEndsAtMs - (Date.now() - clockOffset));
          claimCountdownEl.textContent = "⏳ Te quedan " + formatClaimCountdown(msLeft);
          claimCountdownEl.hidden = false;
        };
        paint();
        claimCountdownTimer = setInterval(paint, 1000);
      } else if (claimCountdownEl) {
        claimCountdownEl.hidden = true;
      }
    }

    function claimPrize() {
      if (!claimBtn || !claimBtn.classList.contains("is-eligible")) return;
      claimBtn.disabled = true;
      fetch(LEADERBOARD_API + "?action=claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: playerName || localStorage.getItem(NAME_KEY) || "", deviceId: getDeviceId() })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            // El ranking se reinicia solo al reclamar (ver run-leaderboard.php)
            // así que el próximo fetchIntroLeaderboard() ya refleja el
            // período nuevo — no hace falta tocar el botón/hint a mano aquí.
            var runInfo = (window.__BRAND__ && window.__BRAND__.dailyPrize && window.__BRAND__.dailyPrize.toppingsRun) || {};
            var winnerName = playerName || localStorage.getItem(NAME_KEY) || "";
            var claimMsg = "Hola TOPPINGS! Quedé #1 en Toppings Run 🛹 Mi nombre es " + winnerName;
            if (window.__openClaimResult) {
              window.__openClaimResult(res, runInfo.rankingPrizeText, claimMsg, { icon: runInfo.prizeIcon });
            }
          } else {
            claimBtn.disabled = false;
            alert((res && res.error) || "No se pudo reclamar el premio.");
          }
          fetchIntroLeaderboard();
        })
        .catch(function () {
          claimBtn.disabled = false;
          alert("No se pudo conectar con el servidor.");
        });
    }

    /* ---- top del período + estado del premio en la pantalla de inicio,
       antes de jugar. Se repite sola para que el botón/contador se
       actualicen sin recargar la página. ---- */
    /* Pinta la pantalla de inicio con un estado del ranking ya recibido.
       Está separado de la consulta a propósito: al cambiar el nombre, el
       propio servidor devuelve el ranking ya corregido, y usarlo directo
       evita depender de una segunda consulta que puede llegar antes de que
       el cambio quede guardado. */
    function applyIntroStatus(res) {
      // `ok` solo viene en la respuesta de `status`; el ranking que devuelve
      // `rename` no lo trae, así que no se puede exigir.
      if (!res || res.ok === false || !res.top) return;
      if (!introLeaderboardEl || !introLeaderboardListEl) return;
      if (introLeaderboardTitleEl) {
        introLeaderboardTitleEl.textContent = "🏆 Top 3 " + periodLabel(res.rankingType);
      }
      var top3 = (res.top || []).slice(0, 3);
      if (top3.length) {
        introLeaderboardListEl.innerHTML = top3.map(function (r) {
          var mine = res.mine && res.mine.rank === r.rank;
          return '<li' + (mine ? ' class="is-mine"' : "") + '><span class="run-lb-rank">' + r.rank + '</span>' +
            '<span class="run-lb-name">' + escHtml(r.name) + (mine ? " (TÚ)" : "") + '</span>' +
            '<span class="run-lb-score">' + r.score + '</span></li>';
        }).join("");
        introLeaderboardEl.hidden = false;
      }
      renderEventStatus(res);
      renderClaimUI(res);
    }

    function fetchIntroLeaderboard() {
      if (!introLeaderboardEl || !introLeaderboardListEl) return;
      var params = "?action=status&deviceId=" + encodeURIComponent(getDeviceId());
      var name = localStorage.getItem(NAME_KEY);
      if (name) params += "&name=" + encodeURIComponent(name);
      // `_` rompe cualquier caché intermedia: este proyecto ya tuvo respuestas
      // JSON servidas viejas por el servidor web, no por el navegador.
      params += "&_=" + Date.now();
      fetch(LEADERBOARD_API + params, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(applyIntroStatus)
        .catch(function (e) { console.warn("[toppings-run] no se pudo cargar el top del ranking:", e); });
    }

    function renderLeaderboard(res) {
      if (!leaderboardEl || !leaderboardListEl) return;
      var rows = res.top || [];
      var html = rows.map(function (r) {
        var mine = res.mine && res.mine.rank === r.rank && res.mine.name === r.name;
        return '<li class="' + (mine ? "is-mine" : "") + '">' +
          '<span class="run-lb-rank">' + r.rank + '</span>' +
          '<span class="run-lb-name">' + escHtml(r.name) + (mine ? " (TÚ)" : "") + '</span>' +
          '<span class="run-lb-score">' + r.score + '</span></li>';
      }).join("");
      var mineIsShown = res.mine && rows.some(function (r) { return r.rank === res.mine.rank; });
      if (res.mine && !mineIsShown) {
        html += '<li class="is-mine is-outside">' +
          '<span class="run-lb-rank">' + res.mine.rank + '</span>' +
          '<span class="run-lb-name">' + escHtml(res.mine.name) + ' (TÚ)</span>' +
          '<span class="run-lb-score">' + res.mine.score + '</span></li>';
      }
      leaderboardListEl.innerHTML = html;
      if (leaderboardCountdownEl && typeof res.weekEndsAtMs === "number" && typeof res.serverNow === "number") {
        var msLeft = Math.max(0, res.weekEndsAtMs - res.serverNow);
        var days = Math.floor(msLeft / 86400000);
        var hours = Math.floor((msLeft % 86400000) / 3600000);
        leaderboardCountdownEl.textContent = "Termina en " + days + "d " + hours + "h";
      }
      leaderboardEl.hidden = false;
    }

    function loop(ts) {
      if (lastTs == null) lastTs = ts;
      var dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      update(dt);
      draw();
      if (state && !state.over) rafId = requestAnimationFrame(loop);
    }

    function startGame() {
      resizeCanvas(true);   // al empezar sí se mide de cero
      resetGame();
      lastTs = null;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      startRunBgMusic();
    }

    function beginGame(name) {
      playerName = name;
      if (playerEl) playerEl.textContent = name.toUpperCase();
      showStage("game");
      startGame();
    }

    // El saludo del inicio llama esto cuando el cliente cambia su nombre,
    // para que el juego (si está a la vista) también quede al día sin
    // necesidad de recargar la página.
    /* El saludo del inicio llama esto al cambiar el nombre. Recibe también el
       ranking que devuelve el propio servidor tras renombrar (`status`), que
       es la fuente confiable: ya viene con el nombre corregido.

       Se repinta en tres pasos, de menos a más confiable, para que nunca
       quede el nombre viejo en pantalla:
         1. la fila propia, al instante, sin red de por medio;
         2. cualquier fila que todavía muestre el nombre viejo — cubre el caso
            de que el puntaje esté guardado bajo otra llave y el servidor no
            lo reconozca como "mío";
         3. el estado que devolvió el servidor, o una consulta si no vino. */
    window.__renameGameName = function (newName, status) {
      var oldName = playerName;
      playerName = newName;
      if (playerEl && !playerEl.hidden && stages.game && !stages.game.hidden) {
        playerEl.textContent = newName.toUpperCase();
      }

      if (introLeaderboardListEl) {
        var mia = introLeaderboardListEl.querySelector("li.is-mine .run-lb-name");
        if (mia) mia.textContent = newName + " (TÚ)";
        if (oldName) {
          Array.prototype.forEach.call(
            introLeaderboardListEl.querySelectorAll(".run-lb-name"),
            function (el) {
              var txt = el.textContent.replace(" (TÚ)", "");
              if (txt === oldName) {
                el.textContent = newName + (el.textContent.indexOf(" (TÚ)") !== -1 ? " (TÚ)" : "");
              }
            }
          );
        }
      }

      if (status && status.top) applyIntroStatus(status);
      else fetchIntroLeaderboard();
    };

    playBtn.addEventListener("click", function () {
      // Si el evento ya terminó, el ranking está congelado: se puede jugar,
      // pero el puntaje no se guarda hasta que se reinicie. Se avisa antes.
      if (eventIsFrozen(lastStatus)) {
        var resetTxt = "";
        if (lastStatus.claim && lastStatus.claim.windowEndsAtMs) {
          var clockOffset = Date.now() - lastStatus.serverNow;
          var msLeft = Math.max(0, lastStatus.claim.windowEndsAtMs - (Date.now() - clockOffset));
          resetTxt = " Vuelve en " + formatClaimCountdown(msLeft) + ".";
        }
        var proceed = function () { showStage("select"); };
        if (window.__askConfirm) {
          window.__askConfirm({
            title: "EL EVENTO YA TERMINÓ",
            text: "Los puntos que hagas ahora no cuentan para el ranking." + resetTxt,
            yesLabel: "Jugar por diversión",
            noLabel: "Ahora no"
          }, proceed);
        } else {
          proceed();
        }
        return;
      }
      showStage("select");
    });
    if (claimBtn) claimBtn.addEventListener("click", claimPrize);

    chooseBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        character = btn.getAttribute("data-run-choose") === "bmx" ? "bmx" : "skate";
        // Reconoce el nombre si ya está guardado (de la fidelidad, el
        // cronómetro, el asistente, etc.) — si no, lo pide antes de jugar.
        var existingName = localStorage.getItem(NAME_KEY);
        if (existingName) {
          beginGame(existingName);
        } else {
          showStage("name");
          if (nameInput) { nameInput.value = ""; nameInput.focus(); }
        }
      });
    });

    if (nameForm) {
      nameForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = (nameInput.value || "").trim();
        if (!name) return;
        function proceed() {
          // deja el nombre registrado en el servidor además de guardarlo aquí,
          // para que el aviso de nombre repetido funcione en todo el sitio
          if (window.__setCustomerName) window.__setCustomerName(name);
          else localStorage.setItem(NAME_KEY, name);
          if (window.__renderHeroGreeting) window.__renderHeroGreeting();
          beginGame(name);
        }
        if (window.__checkNameThenProceed) window.__checkNameThenProceed(name, proceed, null);
        else proceed();
      });
    }

    // Volver de "elige tu personaje" a la pantalla de inicio (ranking, evento
    // y premio) sin tener que empezar una partida.
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        showStage("intro");
        fetchIntroLeaderboard();
      });
    }

    if (restartBtn) restartBtn.addEventListener("click", function () { startGame(); });

    function exitToIntro() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (state) state.over = true;
      stopRunBgMusic();
      showStage("intro");
    }
    if (homeBtn) homeBtn.addEventListener("click", exitToIntro);
    if (exitBtn) exitBtn.addEventListener("click", exitToIntro);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && card.classList.contains("is-fullscreen")) exitToIntro();
    });

    // El salto siempre es instantáneo al presionar (nunca se retrasa
    // esperando a ver si es un mantener/doble-toque) — el gesto se detecta
    // aparte, solo para decidir qué truco sale al tocar una rampa.
    var pressStartedAt = 0;
    var recentTapTimes = [];

    function markGesture(type) {
      if (!state) return;
      state.lastGestureType = type;
      state.lastGestureAt = state.elapsed;
    }

    function onPressStart() {
      pressStartedAt = performance.now();
      jump();
    }
    function onPressEnd() {
      var duration = performance.now() - pressStartedAt;
      if (duration >= HOLD_MS) {
        markGesture("hold");
        recentTapTimes = [];
        return;
      }
      var now = performance.now();
      recentTapTimes.push(now);
      recentTapTimes = recentTapTimes.filter(function (t) { return now - t < DOUBLE_TAP_MS; });
      if (recentTapTimes.length >= 2) {
        markGesture("doubletap");
        recentTapTimes = [];
      }
    }

    canvasWrap.addEventListener("pointerdown", function (e) { e.preventDefault(); onPressStart(); });
    canvasWrap.addEventListener("pointerup", function (e) { e.preventDefault(); onPressEnd(); });
    canvasWrap.addEventListener("pointercancel", function () { pressStartedAt = 0; });

    document.addEventListener("keydown", function (e) {
      if (!stages.game || stages.game.hidden) return;
      if (e.code === "Space" || e.code === "ArrowUp") {
        if (!e.repeat) { e.preventDefault(); onPressStart(); }
        else e.preventDefault();
      }
    });
    document.addEventListener("keyup", function (e) {
      if (!stages.game || stages.game.hidden) return;
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); onPressEnd(); }
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!stages.game || stages.game.hidden) return;
        resizeCanvas();
      }, 150);
    });

    if (recordEl) recordEl.textContent = "🏆 " + Number(localStorage.getItem(RECORD_KEY) || 0);
    showStage("intro");
    fetchIntroLeaderboard();
    /* Se repite mientras la pantalla de inicio esté visible, para que el
       contador, el botón de reclamar y los NOMBRES del top se actualicen
       solos, sin recargar la página — incluso si quien se cambió el nombre
       fue otra persona desde su propio celular.
       Cada 3s, el mismo ritmo que la tarjeta y el cronómetro, para que se
       sienta igual de inmediato en toda la página. */
    setInterval(function () {
      if (stages.intro && !stages.intro.hidden) fetchIntroLeaderboard();
    }, 3000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
