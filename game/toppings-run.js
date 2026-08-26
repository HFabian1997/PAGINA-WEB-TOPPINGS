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

  /* El trueno: ruido grave y corto, distinto del golpe normal para que se
     entienda qué te pegó. */
  /* El susto: un chirrido corto y agudo. Distinto de todo lo demás para
     que el cuerpo lo registre antes que el ojo. */
  function sfxSusto() {
    retroBeep(880, 0.12, "sawtooth", 0, 0.1);
    retroBeep(1320, 0.1, "square", 0.06, 0.08);
  }

  function sfxRayo() {
    retroBeep(70, 0.34, "sawtooth", 0, 0.22);
    retroBeep(48, 0.5, "triangle", 0.05, 0.18);
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
      fondo: "avenida", sinCiudad: true,
      piso: ["#3b3340", "#2a2430", "#171220"],
      carril: "255,232,150",
      props: ["poste", "hidrante", "cono", "caja", "barril"]
    },
    universidad: {
      nombre: "Zona Universitaria",
      cielo: [[0, "#140f2a"], [0.5, "#33245c"], [1, "#241a38"]],
      acento: "255,212,0",
      astro: "luna",
      estrellas: 34, nubes: 3, neblina: 0,
      fondo: "campus", sinCiudad: true,
      piso: ["#4c4754", "#37333f", "#201d28"],   // concreto, no asfalto
      carril: "230,230,240",
      props: ["poste", "banca", "basura", "cono"]
    },
    extrema: {
      nombre: "Noche Extrema",
      cielo: [[0, "#07070f", ], [0.55, "#161628"], [1, "#0a0a14"]],
      acento: "255,70,70",
      astro: "lunaPalida",
      estrellas: 16, nubes: 2, neblina: 0,
      fondo: "puenteReal", sinCiudad: true,
      piso: ["#33333d", "#22222b", "#111119"],
      carril: "255,120,120",
      props: ["torre", "contenedor", "cono"],
      rayos: true
    },
    amanecer: {
      nombre: "Amanecer en el Valle",
      cielo: [[0, "#3a2150"], [0.45, "#d9663a"], [0.8, "#f2a95f"], [1, "#f6c98a"]],
      acento: "255,150,30",
      astro: "sol",
      estrellas: 4, nubes: 8, neblina: 0.16,
      fondo: "valle", sinCiudad: true,
      piso: ["#59493c", "#41352d", "#2a221d"],   // tierra
      carril: "255,240,200",
      props: ["poste", "cono", "caja"]
    }
  };
  /* ---- Los cuatro de temporada ----
     Mismos campos que los otros. `chispas` es lo que cae del cielo (nieve,
     corazones, confeti) y `luces` pinta las ventanas de colores en vez del
     amarillo de siempre. */
  ESCENARIOS.navidad = {
    nombre: "Navidad",
    letrero: "FELIZ NAVIDAD",
    cielo: [[0, "#04101f"], [0.55, "#0d2b47"], [1, "#123049"]],
    acento: "255,80,80",
    astro: "luna",
    estrellas: 40, nubes: 3, neblina: 0.05,
    fondo: "puebloNevado", sinCiudad: true,
    piso: ["#e8eef5", "#c3cfdb", "#8a99a8"],   // nieve pisada
    carril: "255,255,255",
    props: ["poste", "cono", "caja"],
    chispas: "nieve",
    luces: ["255,80,80", "90,220,120", "255,212,0"],
    reglas: { abismo: "hielo" }
  };
  ESCENARIOS.amor = {
    nombre: "Amor",
    letrero: "FELIZ DÍA DEL AMOR",
    cielo: [[0, "#3d1533"], [0.5, "#b0446a"], [1, "#f0949c"]],
    acento: "255,110,150",
    astro: "sol",
    estrellas: 8, nubes: 7, neblina: 0.12,
    fondo: "atardecerAmor", sinCiudad: true,
    piso: ["#5c3a48", "#452c37", "#2c1c24"],
    carril: "255,200,220",
    props: ["poste", "banca", "cono"],
    chispas: "corazones",
    luces: ["255,110,150", "255,180,200"],
    reglas: { abismo: "corazones" }
  };
  ESCENARIOS.halloween = {
    nombre: "Halloween",
    letrero: "DULCE O TRUCO",
    cielo: [[0, "#0c0716"], [0.5, "#241141"], [1, "#3d2a12"]],
    acento: "255,140,20",
    astro: "lunaGigante",
    estrellas: 22, nubes: 4, neblina: 0.18,
    fondo: "puebloHalloween", sinCiudad: true,
    piso: ["#3a3330", "#282320", "#151210"],
    carril: "170,255,120",
    props: ["poste", "basura", "cono"],
    chispas: "murcielagos",
    luces: ["255,140,20", "170,255,120"],
    reglas: { abismo: "monstruo" }
  };
  ESCENARIOS.fiesta = {
    nombre: "Fiesta",
    letrero: "¡QUE SIGA LA FIESTA!",
    cielo: [[0, "#170a33"], [0.5, "#3d1466"], [1, "#5c1a5c"]],
    acento: "255,212,0",
    astro: "luna",
    estrellas: 30, nubes: 2, neblina: 0,
    fondo: "tarima", sinCiudad: true,
    piso: ["#413454", "#2e2540", "#1a142a"],
    carril: "255,255,255",
    props: ["poste", "cono", "caja"],
    chispas: "confeti",
    luces: ["255,80,80", "90,220,255", "255,212,0", "180,120,255", "120,255,150"]
  };

  /* ---- Las tres familias de temporada ----

     Cada familia comparte UNA mecánica —el susto, el hielo, los corazones— y
     dentro de ella los cuatro son lugares distintos, no la misma pintura de
     otro color. Esa fue la condición: cuatro mapas de Halloween que solo
     cambiaran de paleta repetirían el problema que veníamos de arreglar.

     El primero de cada familia es el que ya existía, y no se toca. */

  /* 🎃 HALLOWEEN — la mecánica es el susto */

  ESCENARIOS.halloween2 = {
    nombre: "Cementerio",
    cielo: [[0, "#0a0512"], [0.5, "#1a0b24"], [1, "#2b1236"]],
    acento: "150,255,140",
    astro: "lunaGigante",
    estrellas: 20, nubes: 4, neblina: 0.5,
    fondo: "cementerio", sinCiudad: true,
    piso: ["#3a3040", "#282030", "#150f1c"],
    carril: "180,255,170",
    props: ["lapida", "cruz", "arbolSeco"],
    chispas: "murcielagos",
    letrero: "DESCANSA EN PAZ",
    frases: ["🎃 NOCHE DE BRUJAS", "👻 ENTRA SI TE ATREVES", "🕯️ SALCHIPAPA EMBRUJADA"],
    reglas: { abismo: "monstruo", sustos: 4200, clima: "neblina", velocidad: 0.96 }
  };

  ESCENARIOS.halloween3 = {
    nombre: "Casa Embrujada",
    cielo: [[0, "#1a0a0a"], [0.5, "#2a1010"], [1, "#3a1a12"]],
    acento: "255,140,40",
    astro: "",
    estrellas: 0, nubes: 0, neblina: 0.28,
    fondo: "casona", sinCiudad: true,
    piso: ["#4a3226", "#33221a", "#1c1210"],
    carril: "255,190,120",
    props: ["candelabro", "cuadro", "telarana"],
    letrero: "NO MIRES ATRÁS",
    frases: ["🕯️ PASA SI PUEDES", "🖼️ TE ESTÁN MIRANDO", "🎃 CASA DEL TERROR"],
    reglas: { abismo: "monstruo", sustos: 3000, mezcla: { rampa: 0.26, riel: 0.40 } }
  };

  ESCENARIOS.halloween4 = {
    nombre: "Bosque Muerto",
    cielo: [[0, "#050b08"], [0.5, "#0d1a12"], [1, "#16281c"]],
    acento: "120,255,180",
    astro: "lunaPalida",
    estrellas: 34, nubes: 3, neblina: 0.62,
    fondo: "bosqueMuerto", sinCiudad: true,
    piso: ["#2e3228", "#1f231c", "#111410"],
    carril: "150,255,200",
    props: ["arbolSeco", "hongo", "piedra"],
    chispas: "murcielagos",
    letrero: "BOSQUE MUERTO",
    frases: ["👀 ALGO TE SIGUE", "🌫️ NO TE PIERDAS", "🎃 SALCHI DEL BOSQUE"],
    reglas: { abismo: "monstruo", sustos: 2600, clima: "neblina", terreno: { recta: 0.36, huecoChico: 0.50, abismo: 0.64 } }
  };

  /* 🎄 NAVIDAD — la mecánica es el hielo */

  ESCENARIOS.navidad2 = {
    nombre: "Bosque de Pinos",
    cielo: [[0, "#061426"], [0.55, "#0f3050"], [1, "#1b4a68"]],
    acento: "180,240,255",
    astro: "luna",
    estrellas: 46, nubes: 5, neblina: 0.3,
    fondo: "pinos", sinCiudad: true,
    piso: ["#dfe8f2", "#a9bdd0", "#6d8298"],
    carril: "255,255,255",
    props: ["pino", "muneco", "trineo"],
    chispas: "nieve",
    luces: ["255,90,90", "120,255,140", "255,220,120"],
    letrero: "FELIZ NAVIDAD",
    frases: ["🎄 FELICES FIESTAS", "❄️ SALCHIPAPA NAVIDEÑA", "🎁 REGALO PARA VOS"],
    reglas: { abismo: "hielo", hielo: 0.55, clima: "neblina", velocidad: 0.97 }
  };

  ESCENARIOS.navidad3 = {
    nombre: "Taller de Santa",
    cielo: [[0, "#2a1010"], [0.5, "#43181a"], [1, "#5c2420"]],
    acento: "255,220,120",
    astro: "",
    estrellas: 0, nubes: 0, neblina: 0.1,
    fondo: "taller", sinCiudad: true,
    piso: ["#8a5a3a", "#5f3d28", "#37231a"],
    carril: "255,235,170",
    props: ["regalo", "engranaje", "caja"],
    chispas: "confeti",
    luces: ["255,90,90", "120,255,140", "255,220,120"],
    letrero: "TALLER DE SANTA",
    frases: ["🎁 ENVOLVIENDO SALCHIS", "⚙️ A TODA MÁQUINA", "🎅 YA CASI ES NAVIDAD"],
    reglas: { abismo: "hielo", hielo: 0.25, mezcla: { rampa: 0.38, riel: 0.58 }, velocidad: 1.06 }
  };

  ESCENARIOS.navidad4 = {
    nombre: "Trineo en el Cielo",
    cielo: [[0, "#050d20"], [0.5, "#122a52"], [1, "#2a4f8a"]],
    acento: "255,240,180",
    astro: "luna",
    estrellas: 70, nubes: 12, neblina: 0.2,
    fondo: "nubes", sinCiudad: true,
    piso: ["#eef4ff", "#c3d3ea", "#8fa4c4"],
    carril: "255,255,255",
    props: ["reno", "campana", "estrella"],
    chispas: "nieve",
    letrero: "¡ARRE, RENOS!",
    frases: ["🦌 VOLANDO BAJITO", "🔔 SUENAN LAS CAMPANAS", "🎄 DESDE EL CIELO"],
    // el salto queda NORMAL: la gravedad rara es solo de la Luna
    reglas: { abismo: "hielo", hielo: 0.7, terreno: { recta: 0.34, huecoChico: 0.48, abismo: 0.66 } }
  };

  /* 💗 AMOR Y AMISTAD — la mecánica son los corazones */

  ESCENARIOS.amor2 = {
    nombre: "Parque de Novios",
    cielo: [[0, "#3a1836"], [0.5, "#7a3050"], [1, "#c25a70"]],
    acento: "255,160,190",
    astro: "sol",
    estrellas: 0, nubes: 6, neblina: 0.16,
    fondo: "parque", sinCiudad: true,
    piso: ["#6a4a52", "#4a333a", "#2a1c22"],
    carril: "255,200,220",
    props: ["banca", "globo", "farol"],
    chispas: "corazones",
    letrero: "PARA LOS DOS",
    frases: ["💗 VENÍ CON TU AMOR", "🎈 2X1 EN PAREJA", "💕 SALCHI PARA COMPARTIR"],
    reglas: { abismo: "corazones", corazones: 3.5, velocidad: 0.95 }
  };

  ESCENARIOS.amor3 = {
    nombre: "Cielo de Corazones",
    cielo: [[0, "#7a2a52"], [0.5, "#c04a78"], [1, "#f090b0"]],
    acento: "255,120,170",
    astro: "",
    estrellas: 0, nubes: 10, neblina: 0.3,
    fondo: "nubesRosa", sinCiudad: true,
    piso: ["#e8a8c0", "#c07898", "#8a4a6a"],
    carril: "255,230,240",
    props: ["globo", "corazon", "nube"],
    chispas: "corazones",
    letrero: "PURO AMOR",
    frases: ["💖 HOY TODO ES ROSA", "☁️ EN LAS NUBES", "💘 FLECHAZO SEGURO"],
    // el salto queda NORMAL: la gravedad rara es solo de la Luna
    reglas: { abismo: "corazones", corazones: 5, velocidad: 0.92 }
  };

  ESCENARIOS.amor4 = {
    nombre: "Callejón de los Candados",
    cielo: [[0, "#2a1428"], [0.5, "#54243e"], [1, "#8a3c58"]],
    acento: "255,180,120",
    astro: "luna",
    estrellas: 16, nubes: 3, neblina: 0.2,
    fondo: "callejon", sinCiudad: true,   // el callejón ya dibuja su propia pared; la silueta le quedaba encima
    piso: ["#4a3a44", "#332830", "#1c161c"],
    carril: "255,215,180",
    props: ["candado", "farol", "reja"],
    chispas: "corazones",
    letrero: "AQUÍ SE QUEDA",
    frases: ["🔒 DEJÁ TU CANDADO", "💗 PROMESA CUMPLIDA", "🌉 EL CALLEJÓN"],
    reglas: { abismo: "corazones", corazones: 2.8, mezcla: { rampa: 0.24, riel: 0.52 } }
  };

  /* ---- Los cuatro con reglas propias ----
     A diferencia de los ocho anteriores, estos no cambian solo de color:
     cada uno trae un bloque `reglas` que altera cómo se juega. Es lo que hace
     que se SIENTAN distintos y no solo que se vean distintos. */

  /* 🌕 La Luna. Gravedad baja: los saltos salen largos y flotados, y eso se
     nota en el primer toque. En vez de pájaros caen meteoritos, y caen cuando
     vas alto — no solo volando. */
  ESCENARIOS.luna = {
    nombre: "La Luna",
    cielo: [[0, "#02030a"], [0.6, "#070a18"], [1, "#0d1024"]],
    acento: "180,200,255",
    astro: "tierra",              // la Tierra en el cielo, no la luna
    estrellas: 90, nubes: 0, neblina: 0,
    fondo: "crateres",
    sinCiudad: true,
    piso: ["#9a9694", "#6e6a68", "#413e3d"],
    carril: "220,225,235",
    props: ["bandera", "roca", "antena"],
    reglas: { abismo: "grieta",
      gravedad: 0.42,             // el salto dura más del doble
      velocidad: 0.92,            // un pelo más lento: si no, es imposible leer el terreno
      aire: "meteoritos",
      mezcla: { rampa: 0.22, riel: 0.44 },
    }
  };

  /* 🌿 Selva del Putumayo. Abismos anchos con lianas colgando: te agarrás en
     el aire, te columpiás y al soltar salís disparado. Denso, verde y con
     lluvia suave. */
  ESCENARIOS.selva = {
    nombre: "Selva del Putumayo",
    sinCiudad: true,
    cielo: [[0, "#123024"], [0.5, "#1d5238"], [1, "#2f7248"]],
    acento: "120,230,140",
    astro: "",
    estrellas: 0, nubes: 3, neblina: 0.18,
    fondo: "selva",
    piso: ["#4a3d2a", "#33291c", "#1d1610"],
    carril: "200,230,170",
    props: ["helecho", "tronco", "piedra", "totumo"],
    reglas: { abismo: "pantano",
      lianas: true,
      clima: "lluvia",
      // más abismos anchos que en la ciudad: son el escenario de la liana
      terreno: { recta: 0.34, huecoChico: 0.44, abismo: 0.60 },
      mezcla: { rampa: 0.20, riel: 0.30 },   // pocos rieles, muchos obstáculos de piso
    }
  };

  /* 🌊 El Río. Los abismos son cascadas. Casi no hay obstáculos de piso: acá
     todo es saltar bien y a tiempo. */
  ESCENARIOS.rio = {
    nombre: "El Río",
    sinCiudad: true,
    /* Se le bajó el verde al cielo: con el turquesa plano de antes, el agua
       y el fondo quedaban del mismo color y no se distinguía nada. */
    cielo: [[0, "#07293a"], [0.5, "#14586e"], [1, "#2d8f96"]],
    acento: "120,220,235",
    astro: "sol",
    estrellas: 0, nubes: 6, neblina: 0.12,
    fondo: "rio",
    piso: ["#5b5344", "#3f3930", "#25211b"],
    carril: "200,240,245",
    props: ["junco", "piedra", "tronco"],
    reglas: {
      abismo: "cascada",
      // el camino es casi todo huecos: menos recta, muchos más abismos
      terreno: { recta: 0.26, huecoChico: 0.50, abismo: 0.74 },
      // y arriba del piso casi no hay nada con qué chocar
      mezcla: { rampa: 0.34, riel: 0.52 },
      velocidad: 1.05,
    }
  };

  /* ⛈️ Tormenta. Llueve, cae neblina y caen rayos con aviso. El más nervioso
     de los cuatro. */
  ESCENARIOS.tormenta = {
    nombre: "Tormenta",
    cielo: [[0, "#0a0d14"], [0.55, "#1d2430"], [1, "#39404b"]],
    acento: "150,190,255",
    astro: "",
    estrellas: 0, nubes: 9, neblina: 0.42,
    fondo: "tormenta", sinCiudad: true,   // el aguacero en la sierra: una ciudad iluminada ahí no tiene sentido
    piso: ["#39383e", "#28272c", "#16151a"],
    carril: "210,220,240",
    props: ["poste", "cono", "barril"],
    rayos: true,
    reglas: { abismo: "rejilla",
      clima: "rayos",
      velocidad: 1.08,
      mezcla: { rampa: 0.30, riel: 0.50 },
    }
  };

  /* Los que entran en "Ir cambiando". Los de temporada no están: esos salen
     por fecha, no por rotación. */
  /* Los grupos de "ir cambiando". Antes rotaba entre una lista fija; ahora
     se puede elegir de qué grupo salen los mapas. */
  var GRUPOS = {
    normales: ["ciudad", "universidad", "extrema", "amanecer", "fiesta"],
    mecanicas: ["luna", "tormenta", "selva", "rio"],
    temporada: ["halloween", "halloween2", "halloween3", "halloween4",
                "navidad", "navidad2", "navidad3", "navidad4",
                "amor", "amor2", "amor3", "amor4"]
  };
  /* Cada temporada es TAMBIÉN un grupo por su cuenta. Antes solo existía
     `temporada` con los doce juntos, así que no había manera de pedir
     "solo los cuatro de Navidad". Se arman abajo, a partir de FAMILIAS,
     para que no haya dos listas de lo mismo que se puedan desincronizar. */
  GRUPOS.todos = GRUPOS.normales.concat(GRUPOS.mecanicas, GRUPOS.temporada);

  // "rotar" a secas = normales + los de mecánica, que es lo que rotaba antes
  var ORDEN_ESCENARIOS = GRUPOS.normales.concat(GRUPOS.mecanicas);

  /* Solo las usa el enganche de pruebas (?qa=1). Sin ese parámetro nunca
     cambian de valor, así que el juego real ni se entera de que existen. */
  var qaEscenario = null;
  var qaInmune = false;

  /* Qué temporada es hoy. Fiesta no está: ese no tiene fecha, lo pone Fabián
     cuando hay un evento en el local. */
  /* Cada temporada es una FAMILIA de cuatro mapas. El primero de cada una es
     el que existía antes, para que quien no configure nada vea lo de siempre. */
  var FAMILIAS = {
    halloween: ["halloween", "halloween2", "halloween3", "halloween4"],
    navidad: ["navidad", "navidad2", "navidad3", "navidad4"],
    amor: ["amor", "amor2", "amor3", "amor4"]
  };

  /* Y acá se enchufan como grupos de rotación: rotar_halloween, rotar_navidad
     y rotar_amor salen de la misma lista que usa la temporada automática. */
  Object.keys(FAMILIAS).forEach(function (fam) { GRUPOS[fam] = FAMILIAS[fam]; });

  /** Qué temporada es hoy, o null. Devuelve la FAMILIA, no un mapa suelto. */
  function familiaDeTemporada() {
    var d = new Date();
    var mes = d.getMonth() + 1, dia = d.getDate();
    if ((mes === 10 && dia >= 20) || (mes === 11 && dia <= 2)) return "halloween";
    if ((mes === 12) || (mes === 1 && dia <= 6)) return "navidad";
    if (mes === 2 && dia >= 7 && dia <= 20) return "amor";
    return null;
  }

  /**
   * Cuál de los cuatro de una familia. El panel puede fijar uno o dejarlo en
   * "ir cambiando", que elige otro distinto del anterior en cada partida.
   */
  function elegirDeFamilia(fam) {
    var lista = FAMILIAS[fam] || [];
    if (!lista.length) return null;
    var elegido = String(runInfo()["escenario_" + fam] || "rotar");

    if (elegido !== "rotar" && ESCENARIOS[elegido] && lista.indexOf(elegido) !== -1) return elegido;

    var clave = "toppings_run_temp_" + fam;
    var ultimo = "";
    try { ultimo = localStorage.getItem(clave) || ""; } catch (e) {}
    var opciones = lista.filter(function (k) { return k !== ultimo; });
    var salida = opciones[Math.floor(Math.random() * opciones.length)] || lista[0];
    try { localStorage.setItem(clave, salida); } catch (e) {}
    return salida;
  }

  /** A qué temporada pertenece un mapa, o "" si no es de ninguna. */
  function familiaDelMapa(clave) {
    var fams = Object.keys(FAMILIAS);
    for (var i = 0; i < fams.length; i++) {
      if (FAMILIAS[fams[i]].indexOf(clave) !== -1) return fams[i];
    }
    return "";
  }

  /** Compatibilidad: devuelve un mapa concreto de la temporada de hoy. */
  function escenarioDeTemporada() {
    var fam = familiaDeTemporada();
    return fam ? elegirDeFamilia(fam) : null;
  }

  /** Cuál toca. "rotar" va cambiando en cada partida. */
  function elegirEscenario() {
    if (qaEscenario && ESCENARIOS[qaEscenario]) return ESCENARIOS[qaEscenario];
    var info = runInfo();
    var pedido = String(info.escenario || "ciudad");

    /* ¿Eligió una temporada A MANO? Puede ser el grupo entero
       (`rotar_navidad`) o un mapa suelto de esa familia (`navidad3`). */
    var grupoPedido = pedido.indexOf("rotar_") === 0 ? pedido.slice(6) : "";
    var eligioTemporada = !!FAMILIAS[grupoPedido] || !!familiaDelMapa(pedido);

    /* La temporada automática manda, salvo dos casos:

         - que Fabián apague el interruptor, o
         - que él YA haya elegido una temporada a mano.

       Lo segundo es nuevo, y es lo que faltaba: sin eso, pedir "solo los de
       Navidad" en octubre devolvía los de Halloween, y desde afuera se veía
       como que el selector no funcionaba. Una elección explícita le gana
       siempre a una automática. */
    var usarTemporada = info.escenarioTemporada === undefined ? true : !!info.escenarioTemporada;
    if (!eligioTemporada && (pedido === "auto" || usarTemporada)) {
      var temp = escenarioDeTemporada();
      if (temp) return ESCENARIOS[temp];
    }
    // "auto" fuera de temporada cae en la ciudad
    if (pedido === "auto") return ESCENARIOS.ciudad;

    /* "Ir cambiando", con o sin grupo: rotar_normales, rotar_mecanicas,
       rotar_temporada, rotar_todos, o "rotar" a secas (lo de siempre). */
    if (pedido.indexOf("rotar") === 0) {
      /* Si pidió un grupo de temporada, manda lo que haya elegido en
         "En Halloween usar…": si ahí fijó un mapa, sale ese. Son dos campos
         del mismo panel y tienen que estar de acuerdo. */
      if (FAMILIAS[grupoPedido]) {
        var deLaFamilia = elegirDeFamilia(grupoPedido);
        if (deLaFamilia && ESCENARIOS[deLaFamilia]) return ESCENARIOS[deLaFamilia];
      }
      var grupo = pedido === "rotar" ? ORDEN_ESCENARIOS
                : (GRUPOS[pedido.slice(6)] || ORDEN_ESCENARIOS);
      // solo los que de verdad existen, por si alguno se quita más adelante
      grupo = grupo.filter(function (k) { return !!ESCENARIOS[k]; });
      if (!grupo.length) return ESCENARIOS.ciudad;

      var ultimo = "";
      try { ultimo = localStorage.getItem("toppings_run_escenario") || ""; } catch (e) {}
      var opciones = grupo.filter(function (k) { return k !== ultimo; });
      if (!opciones.length) opciones = grupo;    // si el grupo tiene uno solo
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

  /* ---------------- Letreros ----------------

     El letrero grande decía "TOPPINGS" escrito a mano dentro del dibujo, en
     cinco lugares distintos. Ahora sale de acá, con este orden:

       1. lo que Fabián haya puesto en el panel
       2. si no puso nada, lo que traiga el mapa (los de Navidad dicen
          "FELIZ NAVIDAD" sin que tenga que configurar nada)
       3. y si no, "TOPPINGS"

     Las vallas chicas siguen la misma regla. */

  /**
   * Los textos de los letreros GRANDES. Es una lista, no uno solo: se pueden
   * repartir varios distintos por el mapa, igual que las frases de las vallas
   * chicas. Acepta también el formato viejo (un texto suelto) por si quedó
   * guardado así.
   */
  var LETRERO_MAX_LETRAS = 26;

  function letrerosGrandes(esc) {
    var puesto = runInfo().letreroGrande;
    var lista = [];

    if (Array.isArray(puesto)) {
      lista = puesto.map(function (x) {
        return String((x && typeof x === "object" ? x.texto : x) || "").trim();
      }).filter(function (t) { return t !== ""; });
    } else if (typeof puesto === "string" && puesto.trim()) {
      lista = [puesto.trim()];
    }
    if (lista.length) return lista.slice(0, 8).map(recortarLetrero);

    // sin nada configurado: lo que traiga el mapa, y si no, la marca
    if (esc && esc.letrero) return [recortarLetrero(esc.letrero)];
    return ["TOPPINGS"];
  }

  /* Corta por PALABRA, no a la mitad de una. Antes "ABIERTO DE MARTES A
     DOMINGO" quedaba como "ABIERTO DE MARTES A DOMING", que se lee como un
     error del sistema y no como un texto largo. */
  function recortarLetrero(t) {
    t = String(t).trim();
    if (t.length <= LETRERO_MAX_LETRAS) return t;
    var corte = t.slice(0, LETRERO_MAX_LETRAS);
    var esp = corte.lastIndexOf(" ");
    return (esp > LETRERO_MAX_LETRAS * 0.5 ? corte.slice(0, esp) : corte).trim();
  }

  /** El primero de la lista. Lo usa la pantalla de pruebas. */
  function letreroGrande(esc) { return letrerosGrandes(esc)[0]; }

  /** Las frases de las vallas chicas: las del panel le ganan a las del mapa. */
  function frasesParaEscenario(esc) {
    var delPanel = frasesDeMarca();
    if (delPanel.length) return delPanel;
    if (esc && Array.isArray(esc.frases)) return esc.frases.slice(0, 12);
    return [];
  }

  /* ---- La valla del ganador del evento anterior ----
     Se muestra DENTRO del juego, en la primera valla de cada partida. El
     ranking de afuera no se toca: son dos cosas distintas y esta se puede
     apagar por su cuenta desde el panel.

     El dato se guarda cuando llega la respuesta del ranking, no se pide
     aparte: el juego ya la recibe para pintar la tarjeta. */
  var ganadorAnterior = null;

  function vallaGanadorActiva() {
    var v = runInfo().vallaGanador;
    return v === undefined ? true : !!v;   // encendida por defecto
  }

  function vallaDelGanador() {
    if (!vallaGanadorActiva() || !ganadorAnterior || !ganadorAnterior.name) return null;
    return {
      ganador: true,
      nombre: String(ganadorAnterior.name).slice(0, 18),
      puntos: Number(ganadorAnterior.score) || 0
    };
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
    var lbUpEl = $("[data-run-lb-up]", card);
    var lbDownEl = $("[data-run-lb-down]", card);
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

    /* ---- Meteoritos de la Luna ----

       Antes caían desde arriba, casi verticales, y avisaban con una marca
       en el suelo. No se podían esquivar, y no por falta de tiempo: daban
       1,40 s cuando un pájaro da entre 0,86 y 1,12 s.

       El problema era de DÓNDE venían. En un juego de correr lo único que
       podés cambiar es la altura, y una roca que baja sobre tu cabeza no se
       esquiva con altura: subir te mete adentro, y bajar en la Luna es lento
       porque la gravedad es la mitad.

       Ahora entran por el costado, como un pájaro pero más lentos, y se ven
       venir todo el recorrido. El aviso es la roca. */
    var METEORITO_ALTURA_MIN = 70;      // desde qué altura salen
    var METEORITO_CADA = [700, 1400];   // cada cuánto sale uno, yendo alto
    /* Cuánto más rápido que el escenario se acercan. Un pájaro va entre 1,35
       y 1,75; estos van más lento a propósito, para poder esquivarlos. */
    var METEORITO_CIERRE = [1.00, 1.15];
    var METEORITO_CAIDA = [30, 55];     // cuánto bajan mientras cruzan, en px/s
    /* A qué altura del piso llegan. Dentro de este rango, a veces hay que
       saltarlo y a veces conviene quedarse abajo — eso es lo que lo hace una
       decisión y no un reflejo. */
    var METEORITO_LLEGADA = [45, 125];

    /** Arma un meteorito que entra por el borde derecho.
     *
     *  Se elige primero A QUÉ ALTURA VA A LLEGAR, y recién después desde
     *  dónde sale. Al revés no se puede garantizar que sea esquivable: la
     *  altura de llegada es lo único que decide si se puede pasar por
     *  encima o por debajo. */
    function nuevoMeteorito(alturaLlegada) {
      var base = groundY();
      var xSalida = W + 30;
      var xLlegada = W * CHAR_X_RATIO;

      var cierre = METEORITO_CIERRE[0] + Math.random() * (METEORITO_CIERRE[1] - METEORITO_CIERRE[0]);
      var vy = METEORITO_CAIDA[0] + Math.random() * (METEORITO_CAIDA[1] - METEORITO_CAIDA[0]);
      if (alturaLlegada == null) {
        alturaLlegada = METEORITO_LLEGADA[0] + Math.random() * (METEORITO_LLEGADA[1] - METEORITO_LLEGADA[0]);
      }

      // cuánto tarda en llegar, y cuánto baja en ese rato
      var tramo = (xSalida - xLlegada) / Math.max(1, state.speed * cierre);
      var ySalida = (base - alturaLlegada) - vy * tramo;

      return {
        x: xSalida,
        y: ySalida,
        vx: state.speed * (cierre - 1),   // lo que se acerca por encima del escenario
        vy: vy,
        r: 7 + Math.random() * 5,
        giro: Math.random() * 6
      };
    }

    /* Rayos de la Tormenta. Solo uno a la vez: dos cayendo juntos no se
       podrían esquivar. */
    var RAYO_AVISO_MS = 620;
    var RAYO_GOLPE_MS = 260;
    var RAYO_CADA = [2600, 5200];
    var RAYO_ANCHO = 16;
    var RAYO_ALTURA_SEGURA = 34;   // saltando más alto que esto, el rayo pasa por debajo

    // el multiplicador sube por distancia recorrida, no por tiempo — como la
    // velocidad va acelerando sin techo, entre más rápido vayas más rápido
    // sube el x2, x3... también sin techo
    var MULTIPLIER_STEP_DISTANCE = 2200; // px recorridos para subir un nivel
    var HOLD_MS = 350;         // mantener presionado más de esto = gesto "hold"
    var DOUBLE_TAP_MS = 320;   // dos toques dentro de esta ventana = "doubletap"
    var RAMP_PROMPT_RANGE = 150; // px de anticipación para mostrar el aviso del truco
    var GESTURE_LABEL = { hold: "MANTÉN PARA KICKFLIP", doubletap: "DOBLE TOQUE PARA BACKFLIP" };
    var TRICK_NAME = { hold: "KICKFLIP", doubletap: "BACKFLIP" };

    /* ---- Reglas propias de cada mundo ----
       Hasta acá la tabla de escenarios era solo pintura: cielo, colores,
       adornos. Los ocho mundos corrían con la misma gravedad, la misma
       velocidad y la misma mezcla de obstáculos, y por eso se veían distintos
       pero se sentían iguales.

       Ahora un escenario puede cambiar también cómo se juega. Todos estos
       campos son OPCIONALES: el que no los declare se comporta exactamente
       igual que antes, así que los mundos que ya existían no cambian nada. */

    function escReglas() {
      return (state && state.esc && state.esc.reglas) || {};
    }

    /** Gravedad de este mundo. En la Luna es baja: los saltos salen largos y
     *  flotados, y eso se siente en el primer salto. */
    function gravedadActual() {
      var g = escReglas().gravedad;
      return GRAVITY * (typeof g === "number" ? g : 1);
    }

    function velocidadBaseActual() {
      var v = escReglas().velocidad;
      return BASE_SPEED * (typeof v === "number" ? v : 1);
    }

    /* Los cortes de spawnObstacle(). Por defecto son los de siempre:
       hasta .28 rampa, hasta .46 riel, el resto obstáculo de piso.
       Un mundo puede correrlos — el Río casi no tiene obstáculos de piso
       porque ahí lo que importa es saltar los abismos. */
    var MEZCLA_POR_DEFECTO = { rampa: 0.32, riel: 0.46 };
    function mezclaActual() {
      var m = escReglas().mezcla;
      if (!m) return MEZCLA_POR_DEFECTO;
      return {
        rampa: typeof m.rampa === "number" ? m.rampa : MEZCLA_POR_DEFECTO.rampa,
        riel: typeof m.riel === "number" ? m.riel : MEZCLA_POR_DEFECTO.riel
      };
    }

    /** Qué te ataca por el aire: "pajaros" (lo de siempre) o "meteoritos". */
    function peligroAereo() { return escReglas().aire || "pajaros"; }

    /** Cómo se dibuja el vacío: "" (normal), "cascada" o "agua". */
    function estiloAbismo() { return escReglas().abismo || ""; }

    /** Si los abismos anchos de este mundo traen lianas para columpiarse. */
    function tieneLianas() { return !!escReglas().lianas; }

    /** "lluvia" | "rayos" | "neblina" | "" */
    function climaActual() { return escReglas().clima || ""; }

    /* Los cortes del generador de TERRENO (recta / hueco chico / abismo
       grande). Son otros que los de spawnObstacle: estos deciden la forma del
       camino, aquellos qué se para encima. En el Río se corren fuerte hacia
       los abismos, que es lo que lo vuelve un mapa de puro salto. */
    var TERRENO_POR_DEFECTO = { recta: 0.40, huecoChico: 0.52, abismo: 0.62 };
    function terrenoActual() {
      var t = escReglas().terreno;
      if (!t) return TERRENO_POR_DEFECTO;
      return {
        recta: typeof t.recta === "number" ? t.recta : TERRENO_POR_DEFECTO.recta,
        huecoChico: typeof t.huecoChico === "number" ? t.huecoChico : TERRENO_POR_DEFECTO.huecoChico,
        abismo: typeof t.abismo === "number" ? t.abismo : TERRENO_POR_DEFECTO.abismo
      };
    }

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
          var terr = terrenoActual();
          if (roll < terr.recta) {
            // recta larga — a veces disfrazada de puente (solo visual)
            var flatW = TERRAIN_FLAT_MIN + Math.random() * (TERRAIN_FLAT_MAX - TERRAIN_FLAT_MIN);
            var isBridge = flatW > 620 && Math.random() < 0.3;
            pushTerrain(flatW, 0, 0, false, {
              isBridge: isBridge,
              curb: !isBridge && Math.random() < 0.4,
              prop: (!isBridge && flatW > 500 && Math.random() < 0.25) ? (Math.random() < 0.5 ? "lamppost" : "hydrant") : null
            });
          } else if (roll < terr.huecoChico) {
            // hueco pequeño — fácil de saltar, escala con la velocidad actual
            var jd1 = jumpDistancePx(state.speed);
            var spw = jd1 * (PIT_SMALL_FRAC_MIN + Math.random() * (PIT_SMALL_FRAC_MAX - PIT_SMALL_FRAC_MIN));
            pushTerrain(spw, 0, 0, true);
            pushTerrain(PIT_LANDING_W, 0, 0, false);
          } else if (roll < terr.abismo && tieneLianas()) {
            /* En la Selva el abismo grande viene con su liana. Se genera todo
               junto, así que no hay forma de que salga el vacío pelado. */
            generarAbismoConLiana();
          } else if (roll < terr.abismo) {
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
        speed: BASE_SPEED * ((esc.reglas && typeof esc.reglas.velocidad === "number") ? esc.reglas.velocidad : 1),
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
        meteoritos: [],      // los de la Luna: caen cuando vas alto
        meteoritoTimer: 700,
        golpesMeteorito: 0,  // cuántos pegaron: lo usa la prueba de esquive
        rayoCaida: null,     // el rayo peligroso de la Tormenta (uno a la vez)
        rayoTimer: 2600,
        susto: null,         // el de Halloween: asusta, no hace daño
        sustoTimer: 3200,
        hieloHasta: 0,       // mientras dure, el aterrizaje resbala
        lianas: [],          // las de la Selva, colgando sobre los abismos
        lianaActual: null,   // de cuál está agarrado ahora
        lianaVaivenes: 0,
        lianaImpulso: 1,     // el empujón extra tras soltar
        lianaImpulsoHasta: 0,
        ultimoEnSuelo: -99,  // cuándo pisó por última vez, para el margen del salto
        enSaltito: false,    // va en el rebote de un escalón (el salto igual vale)
        monedasParaBono: 0,  // cuenta hasta 5 y regala 100 puntos
        megaUsados: 0,       // cuántos abismos gigantes salieron (tope 2)
        aterrizaje: 0,   // 0..1, cuánto se aplasta al caer (se va solo)
        destello: 0,     // 0..1, el fogonazo rojo al chocar
        bgScrollFar: 0,
        bgScrollNear: 0,
        bgScrollCerros: 0,
        /* Avanza igual que el piso. Las capas de los fondos se apoyan en
           este y cada una toma su fracción: 0.1 = va al 10% de lo que va
           el suelo. Antes se apoyaban en `bgScrollCerros`, que ya venía
           reducido al 5%, y encima se multiplicaba de nuevo — el fondo
           terminaba moviéndose al 0,4% y se veía congelado. */
        bgScroll: 0,
        groundScroll: 0,
        // el escenario se elige AL EMPEZAR la partida, no a cada cuadro: si
        // estuviera en "ir cambiando", cambiaría de mundo mientras jugás
        esc: esc,
        frases: frasesDeMarca(),
        bgFar: buildSkylinePattern(9, 34, 74, 26, 50),
        bgNear: buildSkylinePattern(7, 20, 46, 22, 40),
        // la capa de más atrás: cerros, árboles o el puente según el mundo
        cerros: buildMountains(7, 90, 190, 130, 230),
        carteles: buildCarteles(esc),
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

      // colgado de una liana, el toque suelta en vez de saltar
      if (state.lianaActual) { soltarLiana(); return; }

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
      var mezcla = mezclaActual();
      if (roll < mezcla.rampa) {
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
      } else if (roll < mezcla.riel) {
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
      if (state.lives < MAX_VIDAS && Math.random() < PROB_CORAZON * multCorazones()) type = "heart";

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
      var jumpDuration = (-2 * JUMP_VELOCITY) / gravedadActual(); // segundos en el aire
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

    /* ---- Lianas (Selva del Putumayo) ----

       CÓMO FUNCIONA, Y POR QUÉ ASÍ

       El personaje está FIJO en su posición horizontal: lo que se mueve es el
       mundo. Si la liana estuviera clavada al mundo, al agarrarse quedaría
       arrastrado hacia el borde izquierdo de la pantalla, y todo el motor
       asume que su x no cambia.

       Por eso, al agarrarla, la liana pasa a colgar SOBRE el personaje y se
       columpian juntos. Visualmente se lee igual —te agarrás, te columpiás,
       salís disparado— y no hay que tocar nada del resto.

       LA REGLA DURA, igual que la megarampa: un abismo con liana NUNCA se
       genera sin su liana, y el ancho sale de lo que el columpio alcanza. Y
       el impulso al soltar tiene PISO: soltar en mal momento igual cruza,
       soltar bien cruza más lejos y da más puntos. Un abismo imposible sería
       un error, no un desafío. */

    var LIANA_LARGO = 96;           // de dónde cuelga hasta donde se agarra
    var LIANA_ANG_INICIAL = -0.72;  // arranca inclinada hacia atrás
    var LIANA_VEL_INICIAL = 2.9;    // qué tan fuerte sale el columpio
    var LIANA_IMPULSO_MIN = 1.15;   // el piso: aunque sueltes mal, cruzás
    var LIANA_IMPULSO_MAX = 1.75;   // soltando en el punto justo
    var LIANA_MAX_VAIVENES = 2;     // sin soltar, después de esto se cae
    var LIANA_AGARRE_ANCHO = 24;   // angosto: hay que estar en la cuerda
    var LIANA_AGARRE_ALTO = 46;    // generoso a lo largo de la cuerda

    /** Cuánto avanza un salto normal desde la liana, ya con el impulso. */
    function alcanceConLiana(speed) {
      return jumpDistancePx(speed) * LIANA_IMPULSO_MIN;
    }

    /* Genera el abismo con su liana, las dos cosas en el mismo paso para que
       no exista forma de que salga el vacío solo. */
    function generarAbismoConLiana() {
      var alcanceNormal = jumpDistancePx(state.speed);
      /* La liana va a poco más de medio salto normal desde el borde: se llega
         cómodo aunque el salto no sea perfecto. */
      var hastaLiana = alcanceNormal * 0.52;
      var desdeLiana = alcanceConLiana(state.speed) * 0.62;
      var ancho = hastaLiana + desdeLiana;

      var inicio = state.terrain.length
        ? (state.terrain[state.terrain.length - 1].x + state.terrain[state.terrain.length - 1].w)
        : W;
      pushTerrain(ancho, 0, 0, true, { abismoLiana: true });
      pushTerrain(PIT_LANDING_W + 60, 0, 0, false);

      state.lianas.push({
        x: inicio + hastaLiana,
        anclaY: groundY() - CHAR_SIZE - LIANA_LARGO - 40,
        ang: LIANA_ANG_INICIAL * 0.6,   // colgando, con un vaivén suave
        velAng: 0,
        libre: true,                    // todavía nadie la agarró
        usada: false,
        fase: Math.random() * 6
      });
    }

    /** ¿Está el personaje tocando esta liana, en el aire y sin agarrar otra? */
    /**
     * ¿Se puede agarrar esta liana?
     *
     * Era una simple comprobación de distancia, y por eso se agarraba desde
     * CUALQUIER lado: por detrás cuando ya habías pasado, o por arriba
     * cayéndole encima. Se sentía pegajoso y arbitrario.
     *
     * Ahora hay que llegarle de frente, como en la vida real:
     *  - la liana tiene que estar ADELANTE o a la altura del personaje,
     *    nunca ya pasada;
     *  - la zona de agarre es angosta a lo ancho y alta a lo largo de la
     *    cuerda: se agarra la cuerda, no un aura alrededor.
     */
    function puedeAgarrar(li) {
      if (!li.libre || state.lianaActual || state.onGround || state.falling) return false;
      var cx = W * CHAR_X_RATIO + CHAR_SIZE / 2;
      var cy = state.charY + CHAR_SIZE / 2;

      var px = li.x + Math.sin(li.ang) * LIANA_LARGO;
      var py = li.anclaY + Math.cos(li.ang) * LIANA_LARGO;

      // ya la pasaste: no se agarra por detrás
      if (px < cx - CHAR_SIZE * 0.25) return false;

      /* Zona angosta a lo ancho (hay que estar EN la cuerda) y generosa a lo
         alto (se agarra en cualquier punto del tramo agarrable). */
      var dx = Math.abs(cx - px);
      if (dx > LIANA_AGARRE_ANCHO) return false;
      var dy = cy - py;
      return dy > -LIANA_AGARRE_ALTO && dy < LIANA_AGARRE_ALTO * 0.5;
    }

    function agarrarLiana(li) {
      li.libre = false;
      li.usada = true;
      state.lianaActual = li;
      state.lianaVaivenes = 0;
      // el impulso del columpio sale de la carrera: si venías rápido, columpia más
      li.ang = LIANA_ANG_INICIAL;
      li.velAng = LIANA_VEL_INICIAL;
      state.velocityY = 0;
      state.onGround = false;
      sfxJump();
    }

    /**
     * Soltar. El impulso depende de dónde estés en el arco —soltar adelante y
     * subiendo es lo mejor— pero nunca baja del piso que garantiza cruzar.
     */
    function soltarLiana() {
      var li = state.lianaActual;
      if (!li) return;
      /* El mejor momento es con la liana adelante (ang > 0) y todavía
         subiendo (velAng > 0). Eso da 1 en la escala; lo peor da 0. */
      var calidad = Math.max(0, Math.min(1, (Math.sin(li.ang) + 1) / 2 * (li.velAng > 0 ? 1 : 0.45)));
      var impulso = LIANA_IMPULSO_MIN + (LIANA_IMPULSO_MAX - LIANA_IMPULSO_MIN) * calidad;

      state.lianaActual = null;
      state.onGround = false;
      // sale hacia arriba, con más fuerza cuanto mejor haya soltado
      state.velocityY = JUMP_VELOCITY * (0.78 + 0.32 * calidad);
      state.lianaImpulso = impulso;
      state.lianaImpulsoHasta = state.elapsed + 1.4;

      if (calidad > 0.72) {
        state.trickText = { text: "🌿 ¡BUEN COLUMPIO!", life: 1.2 };
        state.score += 60 * state.multiplier;
      }
      sfxJump();
    }

    /* El columpio en sí. Se llama cada cuadro mientras esté agarrado. */
    function moverLiana(dt) {
      var li = state.lianaActual;
      if (!li) return;
      // péndulo, con un poco de amortiguación para que no oscile eternamente
      var g = gravedadActual() / 100;
      li.velAng += -(g / (LIANA_LARGO / 100)) * Math.sin(li.ang) * dt;
      li.velAng *= 0.996;
      li.ang += li.velAng * dt;

      // el personaje cuelga de la punta
      var py = li.anclaY + Math.cos(li.ang) * LIANA_LARGO;
      state.charY = py - CHAR_SIZE / 2;

      // cada vez que cruza el punto más bajo cuenta un vaivén
      if (li.ang * li.angPrevio < 0) state.lianaVaivenes++;
      li.angPrevio = li.ang;

      /* Si no suelta, se cae. La liana da impulso, no transporte gratis: sin
         costo dejaría de ser una decisión. */
      if (state.lianaVaivenes > LIANA_MAX_VAIVENES) {
        state.lianaActual = null;
        state.velocityY = 0;
      }
    }

    /* ---- Las tres mecánicas de temporada ----
       Cada familia de mapas comparte una. Es lo que hace que cuatro mapas de
       Halloween sean cuatro lugares del mismo mundo y no cuatro paletas. */

    /** Cada cuántos ms aparece un susto. 0 = este mapa no tiene. */
    function sustosCada() {
      var s = escReglas().sustos;
      return typeof s === "number" ? s : 0;
    }

    /** Cuánto resbala el suelo (0 = agarre normal, 1 = patinadero). */
    function hieloActual() {
      var h = escReglas().hielo;
      return typeof h === "number" ? Math.max(0, Math.min(1, h)) : 0;
    }

    /** Multiplica la probabilidad del corazón. */
    function multCorazones() {
      var c = escReglas().corazones;
      return typeof c === "number" ? c : 1;
    }

    /* ---- Sustos (Halloween) ----
       Aparece algo de golpe y se va. AVISA POCO a propósito —esa es la
       gracia— pero NUNCA quita vida ni empuja al personaje: solo asusta.
       Un susto que además te mata sin poder reaccionar se siente tramposo, y
       terminarías con gente evitando el mapa en vez de disfrutarlo. */
    var SUSTO_TIPOS = ["fantasma", "mano", "apagon", "ojos"];

    function actualizarSustos(dt) {
      if (!sustosCada()) return;

      if (state.susto) {
        state.susto.t += dt;
        state.susto.x -= state.speed * dt * (state.susto.tipo === "fantasma" ? 0.55 : 1);
        if (state.susto.t > state.susto.dura) state.susto = null;
        return;
      }
      state.sustoTimer -= dt * 1000;
      if (state.sustoTimer > 0) return;

      state.sustoTimer = sustosCada() * (0.7 + Math.random() * 0.7);
      var tipo = SUSTO_TIPOS[Math.floor(Math.random() * SUSTO_TIPOS.length)];
      state.susto = {
        tipo: tipo,
        t: 0,
        dura: tipo === "apagon" ? 0.42 : 1.3,
        x: tipo === "mano" ? (W * CHAR_X_RATIO + 40 + Math.random() * 120) : W + 40,
        y: tipo === "ojos" ? (groundY() - 120 - Math.random() * 90) : 0,
        semilla: Math.random()
      };
      sfxSusto();
    }

    function dibujarSusto() {
      var s = state.susto;
      if (!s) return;
      var vida = 1 - s.t / s.dura;              // se desvanece al irse
      ctx.save();

      if (s.tipo === "apagon") {
        // se va la luz un instante: lo más barato y lo que más asusta
        ctx.fillStyle = "rgba(0,0,0," + (0.82 * Math.min(1, vida * 2.2)).toFixed(2) + ")";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        return;
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, vida * 1.6));

      if (s.tipo === "fantasma") {
        var fy = groundY() - 120 + Math.sin(s.t * 4) * 22;
        ctx.fillStyle = "rgba(225,230,255,.72)";
        ctx.beginPath();
        ctx.arc(s.x, fy, 20, Math.PI, 0);
        ctx.lineTo(s.x + 20, fy + 26);
        // el borde ondulado de abajo
        for (var o = 0; o < 4; o++) {
          ctx.quadraticCurveTo(s.x + 15 - o * 10, fy + (o % 2 ? 34 : 20), s.x + 10 - o * 10, fy + 26);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(20,16,30,.9)";
        ctx.beginPath(); ctx.arc(s.x - 7, fy - 3, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s.x + 7, fy - 3, 3.2, 0, Math.PI * 2); ctx.fill();

      } else if (s.tipo === "mano") {
        // una mano que sale del suelo y se vuelve a meter
        var salida = Math.sin(Math.min(1, s.t / s.dura) * Math.PI) * 34;
        var my = groundYAt(s.x);
        ctx.fillStyle = "rgba(120,130,120,.9)";
        ctx.fillRect(s.x - 5, my - salida, 10, salida);
        for (var d = 0; d < 4; d++) {
          ctx.fillRect(s.x - 7 + d * 4, my - salida - 9, 2.6, 10);
        }

      } else {  // ojos que se abren en la oscuridad
        var abre = Math.sin(Math.min(1, s.t / s.dura) * Math.PI);
        ctx.fillStyle = "rgba(255,190,60,.95)";
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 7, 4.5 * abre, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(s.x + 22, s.y + 3, 7, 4.5 * abre, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(30,10,10,.9)";
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.2 * abre, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s.x + 22, s.y + 3, 2.2 * abre, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    /* ---- Enganche de pruebas ----
       Solo existe si la dirección trae `?qa=1`. Sin esto no hay forma honesta
       de comprobar los mapas: el personaje muere a los pocos segundos jugando
       con toques simulados, y cosas como el meteorito o el rayo aparecen cada
       varios segundos y solo bajo ciertas condiciones.

       No cambia nada del juego real: sin el parámetro, `window.__runQA` ni
       siquiera se define. */
    if (/[?&]qa=1/.test(location.search)) {
      window.__runQA = {
        /** Fuerza un mundo. Hay que reiniciar la partida para que se aplique. */
        escenario: function (clave) { qaEscenario = clave || null; },

        /** Que no muera, para poder mirar el mapa con calma. */
        inmune: function (on) { qaInmune = on !== false; },

        /** Hace aparecer un meteorito ya mismo, sin esperar ni ir alto.
         *  `alturaLlegada` (px sobre el piso) permite ponerlo justo en la
         *  trayectoria del personaje o justo fuera, que es como se comprueba
         *  que de verdad se puede esquivar. */
        meteorito: function (alturaLlegada) {
          if (!state) return false;
          state.meteoritos.push(nuevoMeteorito(alturaLlegada));
          return true;
        },

        /** Hace caer un rayo ya mismo. */
        rayo: function (x) {
          if (!state) return false;
          state.rayoCaida = {
            x: typeof x === "number" ? x : (W * CHAR_X_RATIO + 140),
            aviso: RAYO_AVISO_MS, golpe: 0, cobrado: false, zig: 0.5
          };
          return true;
        },

        /** Lo que hace falta para medir sin tener que adivinar. */
        info: function () {
          if (!state) return null;
          return {
            escenario: state.esc.nombre,
            gravedad: gravedadActual(),
            velocidadBase: velocidadBaseActual(),
            velocidadAhora: Math.round(state.speed),
            aire: peligroAereo(),
            clima: climaActual(),
            abismo: estiloAbismo(),
            lianas: tieneLianas(),
            mezcla: mezclaActual(),
            terreno: terrenoActual(),
            alturaSobreSuelo: Math.round((groundY() - CHAR_SIZE) - state.charY),
            meteoritos: state.meteoritos.length,
            golpesMeteorito: state.golpesMeteorito,
            // dónde está el abismo más cercano que ya se ve en pantalla
            sustos: sustosCada(),
            sustoActivo: state.susto ? state.susto.tipo : null,
            hielo: hieloActual(),
            corazones: multCorazones(),
            letrero: letreroGrande(state.esc),
            vallaGanador: state.carteles.items.some(function (c) { return c.tipo === "ganador"; }),
            carteles: state.carteles.items.length,
            abismoEnPantalla: (function () {
              for (var q = 0; q < state.terrain.length; q++) {
                var t = state.terrain[q];
                if (t.isPit && t.x < W && t.x + t.w > 0) return Math.round(t.x);
              }
              return null;
            })(),
            lianas: state.lianas.length,
            colgado: !!state.lianaActual,
            impulsoLiana: Math.round(state.lianaImpulso * 100) / 100,
            rayoActivo: !!state.rayoCaida,
            vidas: state.lives,
            obstaculos: state.obstacles.map(function (o) { return o.type; }),
            pickups: state.pickups.map(function (p) { return p.type; }),
            maxVidas: MAX_VIDAS,
          };
        },

        /** Pone una liana justo delante, para probar el columpio sin
         *  esperar a que salga un abismo. */
        liana: function () {
          if (!state) return false;
          state.lianas.push({
            x: W * CHAR_X_RATIO + 120,
            anclaY: groundY() - CHAR_SIZE - LIANA_LARGO - 40,
            ang: 0, velAng: 0, libre: true, usada: false, fase: 0
          });
          return true;
        },

        /** Genera un abismo con liana, para comprobar que siempre se cruza. */
        abismoLiana: function () {
          if (!state) return false;
          generarAbismoConLiana();
          return true;
        },

        /**
         * Revisa que NINGÚN abismo con liana sea imposible.
         *
         * Para cada uno comprueba las dos mitades por separado: llegar del
         * borde a la liana con un salto normal, y de la liana al otro lado
         * con el impulso MÍNIMO (el peor caso: soltar en mal momento).
         * Si alguna falla, ese abismo sería una trampa.
         */
        revisarLianas: function (cuantos) {
          if (!state) return null;
          cuantos = cuantos || 40;
          var malos = [], peorMargen = 999;
          for (var n = 0; n < cuantos; n++) {
            var antes = state.terrain.length;
            generarAbismoConLiana();
            var seg = state.terrain[antes];          // el tramo del abismo
            if (!seg || !seg.isPit) { malos.push({ n: n, por: "no se generó el vacío" }); continue; }

            var salto = jumpDistancePx(state.speed);
            var hastaLiana = salto * 0.52;
            var desdeLiana = seg.w - hastaLiana;
            var alcanceMin = salto * LIANA_IMPULSO_MIN;

            var margenIda = salto - hastaLiana;          // cuánto sobra para llegar a la liana
            var margenVuelta = alcanceMin - desdeLiana;  // cuánto sobra para cruzar
            peorMargen = Math.min(peorMargen, margenIda, margenVuelta);
            if (margenIda <= 0 || margenVuelta <= 0) {
              malos.push({ n: n, ancho: Math.round(seg.w), margenIda: Math.round(margenIda), margenVuelta: Math.round(margenVuelta) });
            }
          }
          return { revisados: cuantos, imposibles: malos.length, detalle: malos.slice(0, 5),
                   peorMargenPx: Math.round(peorMargen) };
        },

        /** Lo cuelga de una liana directamente, sin depender de que el salto
         *  coincida. Sirve para mirar el columpio y para que la prueba sea
         *  repetible en vez de depender del azar. */
        colgar: function () {
          if (!state) return false;
          var li = {
            x: W * CHAR_X_RATIO + CHAR_SIZE / 2,
            anclaY: groundY() - CHAR_SIZE - LIANA_LARGO - 40,
            ang: 0, velAng: 0, libre: true, usada: false, fase: 0
          };
          state.lianas.push(li);
          agarrarLiana(li);
          return true;
        },

        /** Hace saltar un susto ya mismo. */
        susto: function (tipo) {
          if (!state) return false;
          state.susto = {
            tipo: tipo || "fantasma", t: 0,
            dura: tipo === "apagon" ? 0.42 : 1.3,
            x: tipo === "mano" ? (W * CHAR_X_RATIO + 60) : W * 0.7,
            y: groundY() - 150, semilla: 0.5
          };
          return true;
        },

        /** Simula que hubo un ganador anterior, para probar la valla. */
        ganador: function (nombre, puntos) {
          ganadorAnterior = nombre ? { name: nombre, score: puntos || 0 } : null;
          return true;
        },

        /** Suelta la liana ya mismo (para medir el impulso). */
        soltar: function () { soltarLiana(); return true; },

        /** Cómo quedan medidos los letreros grandes con los textos actuales.
         *  Sirve para comprobar que se ajustan en vez de salirse. */
        letreros: function () {
          if (!state) return null;
          /* Devuelve TODOS los carteles con su posición y ancho, para poder
             comprobar que ninguno se superpone con el de al lado. */
          var previo = null;
          return state.carteles.items.map(function (c) {
            var fila = { tipo: c.tipo, texto: c.texto || c.nombre, x: Math.round(c.x),
                         ancho: Math.round(c.ancho) };
            if (c.tipo === "grande") {
              var m = medirLetrero(c.texto);
              fila.letra = m.tam;
              fila.cabeEnPantalla = m.cajaW <= W * 0.82 + 1;
            }
            // el hueco entre el borde de este y el del anterior
            if (previo) fila.huecoConElAnterior = Math.round((c.x - c.ancho / 2) - (previo.x + previo.ancho / 2));
            previo = c;
            return fila;
          });
        },

        /** Cuál de los cuatro elegiría esa temporada ahora mismo. Hace falta
         *  porque la fecha no se puede cambiar desde la prueba. */
        deTemporada: function (fam) { return elegirDeFamilia(fam); },

        /** Qué temporada es hoy según la fecha (null fuera de temporada). */
        temporadaHoy: function () { return familiaDeTemporada(); },

        /** Cuánto se sale el letrero de su caja medida, DE VERDAD.
         *
         *  Hace falta porque `anchoDeCartel()` reserva un margen fijo para
         *  que los carteles no se pisen, y ese margen tiene que salir de una
         *  medición y no de una estimación: el neón desborda con el halo, y
         *  cuánto desborda depende del texto.
         *
         *  Se pinta en un lienzo aparte —cambiando `ctx` un momento— y se
         *  recorre columna por columna buscando dónde deja de haber tinta. */
        medirDesborde: function (texto, umbral) {
          umbral = umbral || 12;                 // por debajo de esto no se ve
          var m = medirLetrero(texto);
          var lienzo = document.createElement("canvas");
          lienzo.width = Math.ceil(m.cajaW) + 600;
          lienzo.height = H;
          var real = ctx;
          ctx = lienzo.getContext("2d");
          var cx = lienzo.width / 2;
          try { dibujarUnLetrero(cx, texto, state.esc, state.esc.acento); }
          finally { var px = ctx.getImageData(0, 0, lienzo.width, lienzo.height).data; ctx = real; }

          var izq = -1, der = -1;
          for (var x = 0; x < lienzo.width; x++) {
            var pintado = false;
            for (var y = 0; y < H; y += 2) {
              if (px[(y * lienzo.width + x) * 4 + 3] >= umbral) { pintado = true; break; }
            }
            if (pintado) { if (izq < 0) izq = x; der = x; }
          }
          if (izq < 0) return { error: "no pintó nada" };
          var anchoReal = der - izq + 1;

          /* De paso se mide QUÉ TAN ENCENDIDO está: el píxel más brillante
             del rótulo. Muestreando esto a lo largo del tiempo se comprueba
             que el letrero late de verdad, y no que solo parece. */
          var pico = 0;
          for (var i = 0; i < px.length; i += 4) {
            var lum = (px[i] * 0.30 + px[i + 1] * 0.59 + px[i + 2] * 0.11) * (px[i + 3] / 255);
            if (lum > pico) pico = lum;
          }

          /* Hasta dónde baja el dibujo. Si no llega al piso, el letrero está
             colgado del aire — que es justo lo que pasaba con los de madera. */
          var abajo = -1;
          for (var fy = H - 1; fy >= 0 && abajo < 0; fy--) {
            for (var fx = 0; fx < lienzo.width; fx += 2) {
              if (px[(fy * lienzo.width + fx) * 4 + 3] >= 40) { abajo = fy; break; }
            }
          }

          return {
            texto: texto,
            cajaMedida: Math.round(m.cajaW),
            anchoPintado: anchoReal,
            desborde: Math.round(anchoReal - m.cajaW),   // total, los dos lados
            porLado: Math.round((anchoReal - m.cajaW) / 2),
            brillo: Math.round(pico),                    // 0 = apagado, 255 = a full
            llegaHastaY: abajo,                          // la fila más baja que pinta
            elPisoEstaEnY: Math.round(H - GROUND_H)
          };
        },

        /** Dibuja UN cuadro ya mismo, y opcionalmente adelanta el reloj.
         *
         *  Hace falta porque el navegador congela `requestAnimationFrame`
         *  cuando la pestaña no está a la vista, y entonces no hay forma de
         *  mirar el resultado. Con esto la prueba no depende de que la
         *  ventana esté abierta. */
        cuadro: function (segundos) {
          if (!state) return false;
          if (segundos) {
            state.elapsed += segundos;
            state.bgScrollCerros += state.speed * 0.05 * segundos;
            state.bgScroll += state.speed * segundos;
            state.bgScrollFar += state.speed * 0.3 * segundos;
            state.bgScrollNear += state.speed * 0.6 * segundos;
          }
          draw();
          return true;
        },

        /** Arranca una partida nueva sin pasar por los botones. Hace falta
         *  para recorrer los 21 mundos de un tirón en una sola prueba. */
        reiniciar: function () { startGame(); return true; },

        /** Qué mapa saldría con la configuración actual, sin tener que
         *  arrancar la partida. Es lo que permite comprobar el selector
         *  muchas veces seguidas y ver el reparto real. */
        cualSaldria: function () {
          var esc = elegirEscenario();
          var clave = "";
          Object.keys(ESCENARIOS).forEach(function (k) { if (ESCENARIOS[k] === esc) clave = k; });
          return clave;
        },

        /** Los contadores de desplazamiento, para poder comprobar a qué
         *  velocidad se mueve cada plano. Comparar píxeles no sirve acá: los
         *  fondos tienen patrones que se repiten (ventanas, troncos) y la
         *  comparación se engancha con la repetición y da cualquier número.
         *  Esto es lo que de verdad entra al dibujo. */
        scrolls: function () {
          if (!state) return null;
          return {
            piso: state.groundScroll,
            fondos: state.bgScroll,          // el que usan las capas
            carteles: state.bgScroll * 0.86,
            velocidad: state.speed
          };
        },

        /** Busca el "fantasma": letras duplicadas asomando detrás del texto.
         *
         *  Se pinta el letrero en un lienzo aparte y se recorre una línea
         *  horizontal por el medio de las letras contando los BORDES (saltos
         *  de claro a oscuro). Un texto limpio tiene dos bordes por trazo:
         *  entra y sale. Si hay una segunda copia corrida, aparecen bordes
         *  de más, y eso es lo que el ojo lee como "hay algo atrás". */
        buscarFantasma: function (texto) {
          var m = medirLetrero(texto);
          var lienzo = document.createElement("canvas");
          lienzo.width = Math.ceil(m.cajaW) + 200;
          lienzo.height = H;
          var real = ctx;
          ctx = lienzo.getContext("2d");
          /* Fondo OPACO antes de dibujar. El halo va en modo "suma", y
             sumado sobre transparencia deja pixeles de color fuerte pero
             casi sin opacidad. Midiendo solo el color, esos pixeles se leian
             tan claros como las letras: en la Ciudad daba 46 trazos donde
             hay 12. Con fondo opaco el calculo es el mismo que en pantalla. */
          ctx.fillStyle = "#0e0c14";
          ctx.fillRect(0, 0, lienzo.width, lienzo.height);
          var px;
          try { dibujarUnLetrero(lienzo.width / 2, texto, state.esc, state.esc.acento); }
          finally { px = ctx.getImageData(0, 0, lienzo.width, lienzo.height).data; ctx = real; }

          /* La fila que cruza las letras. Se calcula desde groundY(), no
             desde H: el letrero se apoya en el piso, que está GROUND_H más
             arriba del borde del lienzo. Y se prueban varias filas del
             centro quedándose con la que más bordes cruza, porque el alto
             de las mayúsculas no llega hasta el borde de la caja. */
          var medio = Math.round(H - GROUND_H - LETRERO_ALTURA + m.cajaH / 2);
          var perfil = [], bordes = 0, picos = 0;
          for (var d = -6; d <= 6; d += 2) {
            var fila = medio + d, tmp = [];
            for (var x = 0; x < lienzo.width; x++) {
              var i = (fila * lienzo.width + x) * 4;
              tmp.push(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11);
            }
            /* El umbral va ALTO a propósito. Las letras son casi blancas
               (250 y pico) y el resplandor de ambiente es mucho más tenue.
               Con el umbral a la mitad, el halo tambien lo pasaba y se
               contaba como si fueran letras: en la Ciudad daba 21 trazos
               donde hay 12. Al 75% solo entra el núcleo del texto. */
            var mx = Math.max.apply(null, tmp), mn = Math.min.apply(null, tmp);
            var u = mn + (mx - mn) * 0.75, b = 0;
            for (var k = 1; k < tmp.length; k++) if ((tmp[k-1] >= u) !== (tmp[k] >= u)) b++;
            if (b > bordes) { bordes = b; perfil = tmp; }
          }
          // se cuentan los cruces por la mitad entre lo más claro y lo más oscuro
          var max = Math.max.apply(null, perfil), min = Math.min.apply(null, perfil);
          var umbral = min + (max - min) * 0.75;
          for (var k2 = 1; k2 < perfil.length; k2++) {
            var antes = perfil[k2 - 1] >= umbral, ahora = perfil[k2] >= umbral;
            if (ahora && !antes) picos++;
          }
          /* Los escalones intermedios son la marca del fantasma: una copia
             corrida deja un nivel de gris entre el fondo y la letra. */
          var escalones = 0;
          var bajo = min + (max - min) * 0.22, alto = min + (max - min) * 0.72;
          for (var j = 0; j < perfil.length; j++) {
            if (perfil[j] > bajo && perfil[j] < alto) escalones++;
          }
          return { texto: texto, trazos: picos, bordes: bordes,
                   pixelesEnGrisIntermedio: escalones,
                   porcentajeGris: Math.round(escalones / perfil.length * 100) };
        },

        /** La lista de mundos, para recorrerlos todos en una prueba. */
        mundos: function () { return Object.keys(ESCENARIOS); },
      };
    }

    function registerHit() {
      if (qaInmune) return;                           // modo prueba: se mira sin morir
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
      state.speed = velocidadBaseActual() + state.elapsed * ACCEL_PER_S;
      /* El impulso de la liana. Como el personaje no avanza —avanza el
         mundo— "llegar más lejos" es que el mundo corra más rápido mientras
         dura el envión. Se desvanece en vez de cortarse de golpe, para que no
         se sienta un frenazo. */
      if (state.hieloHasta > state.elapsed) {
        state.speed *= state.hieloFuerza || 1;
      }
      if (state.lianaImpulsoHasta > state.elapsed) {
        var restante = (state.lianaImpulsoHasta - state.elapsed) / 1.4;
        state.speed *= 1 + (state.lianaImpulso - 1) * restante;
      }
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
      // y este va como el piso: es la referencia de las capas de los fondos
      state.bgScroll += dt * state.speed;

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
      /* ---- Meteoritos (solo en la Luna) ----
         Reemplazan a los pájaros, pero con una diferencia importante: los
         pájaros solo salen mientras usás el poder de volar, y estos salen
         SIEMPRE que vayas alto — con la gravedad baja de la Luna eso pasa en
         cada salto, así que el aire deja de ser terreno seguro.

         Entran por el costado y cruzan despacio, bajando de a poco. Se ven
         venir todo el trayecto: ese es el aviso. */
      if (peligroAereo() === "meteoritos") {
        var alturaSobreSuelo = (groundY() - CHAR_SIZE) - state.charY;
        var vaAlto = alturaSobreSuelo > METEORITO_ALTURA_MIN;

        if (vaAlto) {
          state.meteoritoTimer -= dt * 1000;
          if (state.meteoritoTimer <= 0) {
            state.meteoritoTimer = METEORITO_CADA[0] + Math.random() * (METEORITO_CADA[1] - METEORITO_CADA[0]);
            state.meteoritos.push(nuevoMeteorito());
          }
        }

        state.meteoritos.forEach(function (me) {
          // avanza contra el escenario, como un pájaro pero más despacio
          me.x -= (state.speed + me.vx) * dt;
          me.y += me.vy * dt;          // y va bajando: sigue siendo una roca
          me.giro += dt * 5;

          var mdx = pxCentro - me.x, mdy = pyCentro - me.y;
          if (Math.sqrt(mdx * mdx + mdy * mdy) < me.r + CHAR_SIZE * 0.36) {
            chocaPajaro = true;      // el mismo camino de daño que los pájaros
            me.y = 9999;             // y desaparece, para no golpear dos veces
            state.golpesMeteorito++; // solo para poder probar que se esquiva
          }
        });
        // se van los que reventaron contra el suelo o se salieron por la izquierda
        state.meteoritos = state.meteoritos.filter(function (me) {
          if (me.y > groundY() - 4) {
            // polvito al reventar contra el suelo
            for (var k = 0; k < 5; k++) {
              state.particles.push({
                x: me.x, y: groundY(), vx: (Math.random() - 0.5) * 90,
                vy: -Math.random() * 70, life: 0.4, max: 0.4, tipo: "polvo"
              });
            }
            return false;
          }
          return me.x > -60;
        });
      }

      /* ---- Rayos que caen (solo en Tormenta) ----
         Distinto del destello de Noche Extrema, que es puro adorno: este
         golpea. Avisa primero con una marca que parpadea en el suelo y recién
         después baja — igual que los meteoritos, para que sea reacción.

         Solo puede haber uno a la vez: dos rayos cayendo juntos no se pueden
         esquivar y se sentiría injusto. */
      if (climaActual() === "rayos") {
        if (state.rayoCaida) {
          var rc = state.rayoCaida;
          if (rc.aviso > 0) {
            rc.aviso -= dt * 1000;
            rc.x -= state.speed * dt;      // la marca viaja con el suelo
            if (rc.aviso <= 0) { rc.golpe = RAYO_GOLPE_MS; state.rayo = 1; sfxRayo(); }
          } else {
            rc.golpe -= dt * 1000;
            rc.x -= state.speed * dt;
            /* El golpe dura un instante y solo cobra si estás ABAJO.
               Esto no es un detalle: el personaje no se puede mover de lado,
               así que si el rayo cobrara siempre no habría forma de
               esquivarlo y dejaría de ser un peligro para volverse un
               impuesto. Saltar es la respuesta, y la marca en el suelo
               avisa 620 ms antes — tiempo de sobra para reaccionar. */
            var charIzq = W * CHAR_X_RATIO, charDer = charIzq + CHAR_SIZE;
            var alturaChar = (groundY() - CHAR_SIZE) - state.charY;
            if (rc.golpe > RAYO_GOLPE_MS - 90 && !rc.cobrado &&
                rc.x > charIzq - RAYO_ANCHO / 2 && rc.x < charDer + RAYO_ANCHO / 2 &&
                alturaChar < RAYO_ALTURA_SEGURA && !state.falling) {
              rc.cobrado = true;
              registerHit();
            }
            if (rc.golpe <= 0) state.rayoCaida = null;
          }
        } else {
          state.rayoTimer -= dt * 1000;
          if (state.rayoTimer <= 0) {
            state.rayoTimer = RAYO_CADA[0] + Math.random() * (RAYO_CADA[1] - RAYO_CADA[0]);
            state.rayoCaida = {
              // adelante del personaje, para que se vea venir
              x: W * CHAR_X_RATIO + 120 + Math.random() * (W * 0.5),
              aviso: RAYO_AVISO_MS, golpe: 0, cobrado: false,
              zig: Math.random()
            };
          }
        }
      }

      /* ---- Lianas: viajan con el mundo y se pueden agarrar al pasar ----
         La que ya está agarrada NO viaja: en ese momento cuelga sobre el
         personaje y se columpian juntos. */
      if (state.lianas.length) {
        state.lianas.forEach(function (li) {
          if (li !== state.lianaActual) {
            li.x -= state.speed * dt;
            // vaivén suave de la que todavía nadie tocó, para que se note viva
            if (li.libre) { li.fase += dt * 1.6; li.ang = Math.sin(li.fase) * 0.22; }
          }
          if (puedeAgarrar(li)) agarrarLiana(li);
        });
        state.lianas = state.lianas.filter(function (li) {
          return li === state.lianaActual || li.x > -140;
        });
      }

      actualizarSustos(dt);

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
        /* Colgado de una liana manda el péndulo: él fija la altura, así que
           acá NO se integra la gravedad ni se vuelve a mover el personaje —
           si no, se sumarían dos movimientos y saldría volando. */
        if (state.lianaActual) {
          moverLiana(dt);
        } else {
          state.velocityY += gravedadActual() * dt;
          state.charY += state.velocityY * dt;
        }

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
          if (state.charY >= groundY() - CHAR_SIZE - 2 && !qaInmune) {
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

              /* Hielo (Navidad): al caer no frenás en seco, seguís
                 deslizando. Como el personaje no avanza —avanza el mundo—,
                 deslizar es que el mundo corra más rápido un instante.
                 Es el mismo truco que el impulso de la liana. */
              var hielo = hieloActual();
              if (hielo > 0) {
                state.hieloHasta = state.elapsed + 0.55 + hielo * 0.5;
                state.hieloFuerza = 1 + hielo * 0.42;
                for (var pt = 0; pt < 6; pt++) {
                  state.particles.push({
                    x: charX + Math.random() * CHAR_SIZE, y: restY + CHAR_SIZE,
                    vx: -60 - Math.random() * 120, vy: -Math.random() * 40,
                    life: 0.45, max: 0.45, tipo: "polvo"
                  });
                }
              }
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

    /* ---- La luz que une el mapa ----

       El fondo, el piso, los obstáculos y el personaje se dibujaban uno
       encima del otro sin nada en común: cada cosa traía su propia paleta y
       el resultado se veía como calcomanías pegadas sobre una foto.

       Esta pasada va AL FINAL, cuando ya está todo dibujado, y los mete a
       los tres en la misma luz. Son tres cosas baratas:

         1. el tinte del mundo, apenas, sobre todo el cuadro
         2. la viñeta, que cierra los bordes y lleva el ojo al centro

       La neblina de distancia NO va acá: esa tiene que quedar detrás del
       personaje y del piso, o los borronea a ellos también. Va con el
       fondo, que es a lo que le corresponde.

       Lo importante es que va después de todo. Si fuera antes, sería una
       capa más de fondo y no cambiaría nada. */

    /* La neblina de distancia: lo lejano se ve más lavado porque hay aire
       en el medio. Se apoya en el color de abajo del cielo, así cada mundo
       tiñe la suya sin configurar nada.

       Va DETRÁS del piso y del personaje. Encima de ellos los borronearía,
       que es lo contrario de lo que se busca. */
    function nieblaDeDistancia() {
      var esc = state.esc;
      var base = groundY();
      var colorLejos = esc.cielo[esc.cielo.length - 1][1];
      ctx.fillStyle = degradado("aire:" + esc.nombre + ":" + W + "x" + H, function () {
        var g = ctx.createLinearGradient(0, base - 165, 0, base);
        g.addColorStop(0, conAlfa(colorLejos, 0));
        g.addColorStop(1, conAlfa(colorLejos, 0.11));
        return g;
      });
      ctx.fillRect(0, base - 165, W, 165);
    }

    /* ---- La pasada de luz final ----

       El tinte del mundo y la viñeta no cambian NUNCA mientras dure la
       partida: dependen del mapa y del tamaño del lienzo, y nada más. Aun
       así se estaban pintando de cero en cada cuadro, dos veces la pantalla
       entera, una de ellas cambiando el modo de composición.

       En un celular eso es de lo más caro que hay: la GPU trabaja por
       baldosas, y cada cambio de composición la obliga a cortar lo que está
       haciendo y empezar de nuevo.

       Ahora las dos se dibujan UNA vez en una imagen aparte y después se
       estampa esa imagen. Una sola orden, sin cambios de modo. */
    var capaDeLuz = null, capaDeLuzClave = "";

    function prepararCapaDeLuz(esc) {
      var clave = esc.nombre + ":" + W + "x" + H;
      if (capaDeLuz && capaDeLuzClave === clave) return capaDeLuz;

      var lienzo = document.createElement("canvas");
      lienzo.width = Math.max(1, Math.round(W));
      lienzo.height = Math.max(1, Math.round(H));
      var c = lienzo.getContext("2d");

      // el tinte del mundo
      c.fillStyle = "rgba(" + esc.acento + ",.045)";
      c.fillRect(0, 0, W, H);

      // la viñeta encima
      var g = c.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.30,
                                     W * 0.5, H * 0.46, Math.max(W, H) * 0.78);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.62, "rgba(0,0,0,.10)");
      g.addColorStop(1, "rgba(0,0,0,.40)");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);

      capaDeLuz = lienzo;
      capaDeLuzClave = clave;
      return capaDeLuz;
    }

    function luzDeAmbiente() {
      ctx.drawImage(prepararCapaDeLuz(state.esc), 0, 0, W, H);
    }

    /** Pasa un "#rrggbb" a "rgba(r,g,b,a)". Hace falta porque los cielos
     *  están escritos en hexadecimal y la neblina necesita transparencia. */
    function conAlfa(hex, alfa) {
      var h = String(hex).replace("#", "");
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      if (isNaN(n)) return "rgba(0,0,0," + alfa + ")";
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alfa + ")";
    }


    /* ---- Medidor de rendimiento ----

       Se enciende agregando ?fps=1 a la dirección. Sin eso no existe: ni
       se dibuja ni se calcula nada.

       Hace falta porque el rendimiento SOLO se puede medir en el aparato
       de verdad. Desde una computadora con GPU todo da bien y no se
       aprende nada del celular de un cliente.

       Muestra tres cosas:
         · los cuadros por segundo
         · los milisegundos del cuadro más lento del último segundo, que es
           lo que se siente como tirón (el promedio los esconde)
         · cuántos cuadros del último segundo pasaron de 20 ms */
    var MEDIR_FPS = /[?&]fps=1/.test(location.search);
    var fpsDatos = { marcas: [], ultimo: 0, cuadros: 0, peor: 0, lentos: 0, texto: "" };

    function anotarCuadro(ahora) {
      if (!MEDIR_FPS) return;
      if (fpsDatos.ultimo) {
        var dt = ahora - fpsDatos.ultimo;
        fpsDatos.cuadros++;
        if (dt > fpsDatos.peor) fpsDatos.peor = dt;
        if (dt > 20) fpsDatos.lentos++;
      }
      fpsDatos.ultimo = ahora;
      if (!fpsDatos.desde) fpsDatos.desde = ahora;
      if (ahora - fpsDatos.desde >= 1000) {
        fpsDatos.texto = fpsDatos.cuadros + " fps · peor " + fpsDatos.peor.toFixed(0) +
                         " ms · " + fpsDatos.lentos + " tirones";
        fpsDatos.cuadros = 0; fpsDatos.peor = 0; fpsDatos.lentos = 0; fpsDatos.desde = ahora;
      }
    }

    function dibujarMedidor() {
      if (!MEDIR_FPS || !fpsDatos.texto) return;
      ctx.save();
      ctx.font = "700 11px system-ui, -apple-system, sans-serif";
      var an = ctx.measureText(fpsDatos.texto).width + 14;
      ctx.fillStyle = "rgba(0,0,0,.72)";
      ctx.fillRect(6, 6, an, 20);
      ctx.fillStyle = "#7CFF9B";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(fpsDatos.texto, 13, 17);
      ctx.restore();
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
      else if (esc.fondo === "crateres") drawCrateres();
      else if (esc.fondo === "selva") drawSelva();
      else if (esc.fondo === "rio") drawRio();
      else if (esc.fondo === "cementerio") drawCementerio();
      else if (esc.fondo === "casona") drawCasona();
      else if (esc.fondo === "bosqueMuerto") drawBosqueMuerto();
      else if (esc.fondo === "pinos") drawPinos();
      else if (esc.fondo === "taller") drawTaller();
      else if (esc.fondo === "nubes") drawCieloNubes("255,255,255");
      else if (esc.fondo === "nubesRosa") drawCieloNubes("255,190,215");
      else if (esc.fondo === "parque") drawParque();
      else if (esc.fondo === "callejon") drawCallejon();
      else if (esc.fondo === "avenida") drawAvenida();
      else if (esc.fondo === "campus") drawCampus();
      else if (esc.fondo === "puenteReal") drawPuenteReal();
      else if (esc.fondo === "valle") drawValle();
      else if (esc.fondo === "puebloNevado") drawPuebloNevado();
      else if (esc.fondo === "atardecerAmor") drawAtardecerAmor();
      else if (esc.fondo === "puebloHalloween") drawPuebloHalloween();
      else if (esc.fondo === "tarima") drawTarima();
      else if (esc.fondo === "tormenta") drawTormenta();
      /* `drawCerros()` queda de respaldo: si algún escenario nuevo no
         declara fondo, tiene algo que dibujar en vez de un vacío. */
      else drawCerros();

      var tinte = "rgba(" + esc.acento + ",";
      /* Las dos capas de edificios se dibujaban siempre. En la Luna, la Selva
         y el Río no pinta nada una ciudad de fondo: un escenario puede
         apagarlas con `sinCiudad`. Los que ya existían no la declaran, así
         que siguen igual. */
      if (!esc.sinCiudad) {
        drawSkylineLayer(state.bgFar, state.bgScrollFar, "rgba(18,12,22,.55)", tinte + ".35)");
        drawSkylineLayer(state.bgNear, state.bgScrollNear, "rgba(14,9,16,.8)", tinte + ".55)");
      }
      volcarLuces();         // todas las luces del fondo, de una sola vez
      nieblaDeDistancia();   // el aire entre el fondo y el frente
      drawCarteles();

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
      /* Un escenario puede no tener astro. Antes, dejarlo vacío caía en el
         valor por defecto y salía la luna igual — en plena tormenta, con el
         cielo tapado de nubes, no tiene sentido. */
      if (!esc.astro) return;
      var r = esc.astro === "sol" ? 21 : esc.astro === "lunaGigante" ? 46 : esc.astro === "tierra" ? 38 : 15;

      var cuerpo = esc.astro === "tierra" ? "#3b7fd4"
                 : esc.astro === "sol" ? "#ffe9a8"
                 : esc.astro === "lunaPalida" ? "#c9c9d8"
                 : esc.astro === "lunaGigante" ? "#ffcf7a" : "#fff4d6";
      var halo = esc.astro === "tierra" ? "90,150,235"
               : esc.astro === "sol" ? "255,200,110"
               : esc.astro === "lunaPalida" ? "200,200,225"
               : esc.astro === "lunaGigante" ? "255,160,40" : "255,244,214";
      var fuerza = esc.astro === "tierra" ? 0.3
                 : esc.astro === "sol" ? 0.4
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

      /* La Tierra lleva continentes, nubes girando y el terminador. Es el
         único astro que se ve de cerca, así que un disco liso se nota. */
      if (esc.astro === "tierra") {
        var gt = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        gt.addColorStop(0, "#4d90e8");
        gt.addColorStop(0.7, "#2f6ec4");
        gt.addColorStop(1, "#123a72");
        ctx.fillStyle = gt;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = "rgba(80,170,110,.78)";
        [[-0.34, -0.24, 0.36, 0.26], [0.24, 0.1, 0.3, 0.32], [-0.12, 0.46, 0.24, 0.17]]
          .forEach(function (c) {
            ctx.beginPath();
            ctx.ellipse(x + c[0] * r, y + c[1] * r, c[2] * r, c[3] * r, c[0], 0, Math.PI * 2);
            ctx.fill();
          });
        // las nubes, girando despacio; las del otro lado no se ven
        ctx.fillStyle = "rgba(255,255,255,.3)";
        for (var nb = 0; nb < 6; nb++) {
          var ang = state.elapsed * 0.05 + nb * 1.1;
          if (Math.cos(ang) < 0) continue;
          ctx.beginPath();
          ctx.ellipse(x + Math.sin(ang) * r * 0.72, y + (az(nb, 3) - 0.5) * r * 1.3,
                      r * 0.28, r * 0.1, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // el terminador: el borde donde se hace de noche
        var sg = ctx.createLinearGradient(x - r, y, x + r, y);
        sg.addColorStop(0, "rgba(0,0,0,0)");
        sg.addColorStop(0.5, "rgba(0,0,0,0)");
        sg.addColorStop(1, "rgba(0,0,0,.55)");
        ctx.fillStyle = sg;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
      }

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

    /* ---- La identidad de cada abismo, en poco espacio ----
       Debajo del suelo hay 26 px. Cada mundo aporta: el color de su filo, el
       color del resplandor que sube del fondo, y qué se dibuja en el borde.
       Todo lo demás es negro, que es lo que hace que se lea como un vacío. */
    var ABISMO_TEMA = {
      cascada:   { filo: "190,235,245", brillo: "60,170,200", borde: "agua" },
      hielo:     { filo: "225,245,255", brillo: "90,170,210", borde: "carambanos" },
      monstruo:  { filo: "235,228,210", brillo: "190,30,50",  borde: "dientes", late: true },
      corazones: { filo: "255,150,190", brillo: "200,50,110", borde: "corazones" },
      pantano:   { filo: "140,190,100", brillo: "60,120,50",  borde: "burbujas" },
      grieta:    { filo: "190,186,182", brillo: "40,60,120",  borde: "estrellas" },
      rejilla:   { filo: "150,170,200", brillo: "70,90,120",  borde: "vapor" }
    };

    function vacioTematico(t, tema) {
      var base = groundY();
      var hondo = H - base;
      var dentroX = t.x + ABISMO_PARED;
      var dentroW = Math.max(2, t.w - ABISMO_PARED * 2);

      /* El vacío: negro casi todo, con el color del mundo subiendo desde el
         fondo como un resplandor. No llena — insinúa. */
      var pulso = tema.late ? (0.6 + 0.4 * Math.sin(state.elapsed * 3)) : 1;
      var g = ctx.createLinearGradient(0, base, 0, H);
      g.addColorStop(0, "#000");
      g.addColorStop(0.55, "rgba(" + tema.brillo + ",0.10)");
      g.addColorStop(1, "rgba(" + tema.brillo + "," + (0.30 * pulso).toFixed(2) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(dentroX, base, dentroW, hondo);

      // el filo: la línea de color justo donde se corta el suelo
      ctx.fillStyle = "rgba(" + tema.filo + ",.85)";
      ctx.fillRect(dentroX, base, dentroW, 2.5);

      // y el detalle del borde, que es lo que dice de qué mundo se trata
      dibujarBordeTema(t, tema, dentroX, dentroW, base);
    }

    function dibujarBordeTema(t, tema, x0, w, base) {
      ctx.save();
      switch (tema.borde) {
        case "agua":
          // hilos cortos que se despeñan, y espuma en el labio
          ctx.strokeStyle = "rgba(" + tema.filo + ",.5)";
          ctx.lineWidth = 1.4;
          var flujo = (state.elapsed * 380) % 26;
          for (var h = 2; h < w; h += 11) {
            ctx.beginPath();
            ctx.moveTo(x0 + h, base + ((h * 3 + flujo) % 10));
            ctx.lineTo(x0 + h + 1, base + 16 + ((h * 5) % 8));
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(255,255,255,.8)";
          for (var e = 0; e < w; e += 8) {
            ctx.beginPath(); ctx.ellipse(x0 + e, base + 1, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill();
          }
          break;

        case "carambanos":
          ctx.fillStyle = "rgba(" + tema.filo + ",.9)";
          for (var c = 1; c < w; c += 12) {
            ctx.beginPath();
            ctx.moveTo(x0 + c, base);
            ctx.lineTo(x0 + c + 2.5, base + 6 + ((c * 7) % 9));
            ctx.lineTo(x0 + c + 5, base);
            ctx.closePath(); ctx.fill();
          }
          break;

        case "dientes":
          ctx.fillStyle = "rgba(" + tema.filo + ",.95)";
          for (var d = 0; d < w; d += 14) {
            var dw = 7 + ((d * 7) % 4);
            ctx.beginPath();
            ctx.moveTo(x0 + d, base);
            ctx.lineTo(x0 + d + dw / 2, base + 11 + ((d * 11) % 6));
            ctx.lineTo(x0 + d + dw, base);
            ctx.closePath(); ctx.fill();
          }
          break;

        case "corazones":
          ctx.fillStyle = "rgba(" + tema.filo + ",.75)";
          var sube = (state.elapsed * 22) % 26;
          for (var co = 4; co < w; co += 18) {
            var cy = base + 24 - sube - ((co * 5) % 10);
            if (cy < base + 2) continue;
            corazonEn(x0 + co, cy, 3);
          }
          break;

        case "burbujas":
          ctx.fillStyle = "rgba(" + tema.filo + ",.5)";
          for (var bu = 5; bu < w; bu += 16) {
            var by = base + 22 - ((state.elapsed * 30 + bu * 6) % 22);
            ctx.beginPath(); ctx.arc(x0 + bu, by, 2 + ((bu * 3) % 2), 0, Math.PI * 2); ctx.fill();
          }
          // la película verde del labio
          ctx.fillStyle = "rgba(" + tema.filo + ",.35)";
          ctx.fillRect(x0, base + 2, w, 2);
          break;

        case "estrellas":
          // se ve el espacio al otro lado de la grieta
          ctx.fillStyle = "rgba(255,255,255,.8)";
          for (var es = 0; es < 9; es++) {
            var ex = x0 + ((es * 47) % Math.max(1, w));
            var ey = base + 4 + ((es * 29) % 20);
            ctx.beginPath(); ctx.arc(ex, ey, 0.7 + (es % 3) * 0.4, 0, Math.PI * 2); ctx.fill();
          }
          break;

        case "vapor":
          ctx.strokeStyle = "rgba(" + tema.filo + ",.4)";
          ctx.lineWidth = 1.6;
          for (var rj = 4; rj < w; rj += 10) {
            ctx.beginPath(); ctx.moveTo(x0 + rj, base + 2); ctx.lineTo(x0 + rj, base + 12); ctx.stroke();
          }
          ctx.fillStyle = "rgba(200,215,235,.14)";
          for (var vp = 6; vp < w; vp += 22) {
            var vy = base + 14 - ((state.elapsed * 26 + vp * 3) % 18);
            ctx.beginPath(); ctx.arc(x0 + vp, vy, 5, 0, Math.PI * 2); ctx.fill();
          }
          break;
      }
      ctx.restore();
    }

    var ABISMO_PARED = 9;     // cuánto mide el corte del terreno a cada lado
    var ABISMO_SOMBRA = 54;   // hasta dónde baja la sombra del borde

    /* ---- Lo que hace que un abismo se LEA como abismo ----

       Los abismos temáticos (cascada, hielo, corazones, pantano) se veían
       como parte del terreno: al llenarlos de contenido se perdía lo que el
       pozo negro original sí tenía —las paredes del corte y la sombra del
       borde— y el ojo los leía como una superficie más, no como un hueco.

       Estas dos funciones devuelven eso, y se llaman en TODOS los estilos:

         marcoAbismo()  -> el corte del terreno a los dos lados, con sus capas
                           de tierra a la vista, dibujado ANTES del contenido
         bordeAbismo()  -> la sombra que cae desde el labio, dibujada DESPUÉS

       Con el contenido en el medio, queda: pared · profundidad · pared. */

    /** Las dos paredes verticales del corte, con las capas del terreno. */
    function marcoAbismo(t) {
      var piso = state.esc.piso || ["#3b3340", "#2a2430", "#171220"];
      var base = groundY();
      var hondo = H - base;

      [t.x, t.x + t.w].forEach(function (bx, lado) {
        var haciaDentro = lado === 0 ? 1 : -1;
        // la pared: más oscura hacia abajo, como tierra en sombra
        var g = ctx.createLinearGradient(0, base, 0, H);
        g.addColorStop(0, piso[1]);
        g.addColorStop(0.45, piso[2]);
        g.addColorStop(1, "#000");
        ctx.fillStyle = g;
        ctx.fillRect(lado === 0 ? bx : bx - ABISMO_PARED, base, ABISMO_PARED, hondo);

        // el labio: la franja de asfalto que sobresale sobre el vacío
        ctx.fillStyle = piso[0];
        ctx.fillRect(lado === 0 ? bx - 3 : bx - ABISMO_PARED, base - 4, ABISMO_PARED + 3, 6);

        // dos vetas de tierra, que es lo que delata que esto es un CORTE
        ctx.fillStyle = "rgba(0,0,0,.28)";
        ctx.fillRect(lado === 0 ? bx : bx - ABISMO_PARED, base + 13, ABISMO_PARED, 2);
        ctx.fillRect(lado === 0 ? bx : bx - ABISMO_PARED, base + 31, ABISMO_PARED, 1.5);

        // piedritas sueltas asomando del corte
        ctx.fillStyle = "rgba(255,255,255,.10)";
        for (var p = 0; p < 4; p++) {
          ctx.fillRect(bx + haciaDentro * (2 + p * 3), base + 8 + p * 17, 3, 2);
        }
      });
    }

    /** La sombra que cae desde el borde hacia adentro. Va DESPUÉS del
     *  contenido: es lo que lo empuja visualmente hacia abajo. */
    function bordeAbismo(t) {
      var base = groundY();

      // sombra del labio, de arriba hacia abajo
      var g = ctx.createLinearGradient(0, base, 0, base + ABISMO_SOMBRA);
      g.addColorStop(0, "rgba(0,0,0,.85)");
      g.addColorStop(0.5, "rgba(0,0,0,.4)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(t.x, base, t.w, ABISMO_SOMBRA);

      // y una sombra desde cada pared hacia el centro, para que el hueco no
      // se vea como un rectángulo pegado sino como algo con volumen
      var gi = ctx.createLinearGradient(t.x, 0, t.x + Math.min(30, t.w * 0.3), 0);
      gi.addColorStop(0, "rgba(0,0,0,.5)");
      gi.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gi;
      ctx.fillRect(t.x, base, Math.min(30, t.w * 0.3), H - base);

      var gd = ctx.createLinearGradient(t.x + t.w, 0, t.x + t.w - Math.min(30, t.w * 0.3), 0);
      gd.addColorStop(0, "rgba(0,0,0,.5)");
      gd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gd;
      ctx.fillRect(t.x + t.w - Math.min(30, t.w * 0.3), base, Math.min(30, t.w * 0.3), H - base);

      // la línea del filo, que marca dónde termina el suelo firme
      ctx.strokeStyle = "rgba(0,0,0,.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(t.x, base); ctx.lineTo(t.x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(t.x + t.w, base); ctx.lineTo(t.x + t.w, H); ctx.stroke();
      ctx.lineWidth = 1;
    }

    /* ---- Herramientas para fondos con profundidad ----

       Los fondos eran triángulos planos (drawCerros) o círculos apilados
       (drawSelva). Se veían como lo que eran: formas de relleno.

       Lo que hace que un fondo se lea como un lugar no es el detalle de cada
       cosa —a esta escala no se distingue— sino TRES capas a distinta
       distancia, cada una más clara y más lenta que la de adelante, con una
       banda de neblina entre medio. Eso es lo que da aire y profundidad.

       Estas funciones son la caja de herramientas; cada mundo compone la suya. */

    /** Un valor estable entre 0 y 1 a partir de números enteros. Sirve para
     *  que cada elemento tenga su variación propia y NO parpadee entre
     *  cuadros, que es lo que pasaría usando Math.random() al dibujar. */
    function az(a, b) {
      var n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return n - Math.floor(n);
    }

    /** La banda de neblina que separa una capa de la siguiente. */
    function bandaNeblina(alturaDesdeSuelo, alto, color, alpha) {
      var y = groundY() - alturaDesdeSuelo;
      var g = ctx.createLinearGradient(0, y - alto, 0, y + 6);
      g.addColorStop(0, "rgba(" + color + ",0)");
      g.addColorStop(0.6, "rgba(" + color + "," + alpha + ")");
      g.addColorStop(1, "rgba(" + color + ",0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - alto, W, alto + 6);
    }

    /**
     * Recorre una capa repetida a lo ancho. `dibujar(x, i, semilla)` pinta un
     * elemento; el resto —el desplazamiento, las dos vueltas y el descarte de
     * lo que no se ve— lo maneja esto.
     *
     * `velocidad` es qué tan rápido pasa: 0.35 es lejos, 1 es el suelo.
     */
    /* `cuantos` es de cuántos elementos es el patrón antes de repetirse.
       Eran 14 fijos, y con separaciones chicas eso significaba que el
       paisaje volvía a empezar cada pocos cientos de píxeles — se notaba, y
       es una de las razones por las que los mapas se sentían chicos.
       Subiéndolo, el mismo mundo tarda mucho más en repetirse. */
    /* `velocidad` es la fracción de lo que se mueve el piso: 0.1 va al 10%,
       0.9 casi acompaña al personaje. Eso es lo que da la profundidad —
       cada plano se corre distinto y el ojo lo lee como distancia. */
    function capa(separacion, velocidad, dibujar, cuantos) {
      cuantos = cuantos || 14;
      var total = separacion * cuantos;
      var off = (state.bgScroll * velocidad) % total;
      for (var vuelta = 0; vuelta < 2; vuelta++) {
        for (var i = 0; i < cuantos; i++) {
          var x = i * separacion - off + vuelta * total;
          if (x > W + 240 || x < -240) continue;
          dibujar(x, i, az(i, separacion));
        }
      }
    }

    /* ---- Herramientas para armar fondos ----

       Seis mapas compartían el mismo fondo de cerros y por eso se veían
       iguales: Ciudad, Amanecer, Navidad, Amor, Fiesta y Tormenta. Y ese
       fondo era UNA capa de triángulos de un color, sin profundidad.

       Lo que le faltaba no era pintura, era una capa más. Estas tres
       funciones son la parte que se repite entre todos los fondos; cada mapa
       las combina distinto y le suma lo suyo. */

    /* ---- Piezas para armar fondos ----

       Veintiún mapas con fondos ricos serían veintiún bloques de dibujo casi
       iguales si no existiera esto. Acá está lo que se repite; cada mapa lo
       combina distinto y le agrega lo suyo.

       Las tres cosas que hacen que un fondo se vea bien, y que están todas
       resueltas acá:

         PROFUNDIDAD  — tres o cuatro planos, cada uno más lento y más lavado
                        que el de adelante
         LUZ          — focos propios (ventanas, faroles, fuego) que iluminan
                        lo que tienen alrededor
         MOVIMIENTO   — cosas que se mueven por su cuenta y no solo porque
                        el escenario se desplaza */

    /** Un foco de luz que ilumina lo que tiene alrededor. Va en modo suma,
     *  que es lo que hace que se vea como luz y no como una mancha clara. */
    /* Un foco de luz.

       Antes armaba un degradado nuevo en CADA llamada, y se llama muchas
       veces por cuadro (faroles, ventanas, calabazas). Construir la rampa
       de color no es gratis y encima deja basura que después hay que
       recoger; en un celular flojo eso se siente como tirones.

       Ahora el degradado se dibuja una vez en una imagen chica, centrada en
       el cero, y se reusa estirándola. La imagen se guarda por color, que
       es lo único que la cambia de verdad. */
    var focos = {};
    var FOCO_TAM = 128;

    function imagenDeFoco(color) {
      if (focos[color]) return focos[color];
      var l = document.createElement("canvas");
      l.width = l.height = FOCO_TAM;
      var c = l.getContext("2d");
      var r = FOCO_TAM / 2;
      var g = c.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(" + color + ",1)");
      g.addColorStop(0.45, "rgba(" + color + ",.31)");
      g.addColorStop(1, "rgba(" + color + ",0)");
      c.fillStyle = g;
      c.fillRect(0, 0, FOCO_TAM, FOCO_TAM);
      focos[color] = l;
      return l;
    }

    /* Los focos NO se dibujan en el momento: se anotan y se pintan todos
       juntos al final, en un solo bloque.

       Cada foco cambiaba el modo de composición y lo devolvía. Con doce
       faroles eso son doce idas y vueltas por cuadro, y la GPU de un
       celular trabaja por baldosas: cada cambio la obliga a cortar lo que
       estaba haciendo, guardar la baldosa y volver a cargarla. Es de lo más
       caro que se puede hacer.

       Juntándolos, el cambio de modo ocurre UNA vez por tanda. */
    var lucesPendientes = [];

    function luzPuntual(x, y, radio, color, fuerza) {
      var a = 0.42 * fuerza;
      if (a <= 0.004 || radio <= 0) return;          // no se vería: no se dibuja
      if (x + radio < 0 || x - radio > W) return;    // fuera de pantalla
      lucesPendientes.push([x, y, radio, color, a > 1 ? 1 : a]);
    }

    /** Pinta de una vez todas las luces anotadas. */
    function volcarLuces() {
      if (!lucesPendientes.length) return;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < lucesPendientes.length; i++) {
        var l = lucesPendientes[i];
        ctx.globalAlpha = l[4];
        ctx.drawImage(imagenDeFoco(l[3]), l[0] - l[2], l[1] - l[2], l[2] * 2, l[2] * 2);
      }
      ctx.restore();
      lucesPendientes.length = 0;
    }

    /** Una nube con volumen: varios bultos de distinto tamaño y una panza
     *  más oscura abajo. Una elipse sola se lee como una mancha. */
    function nubeVolumen(x, y, r, color, alpha, panza) {
      ctx.fillStyle = "rgba(" + color + "," + alpha + ")";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.85, y + r * 0.22, r * 0.72, 0, Math.PI * 2);
      ctx.arc(x - r * 0.9, y + r * 0.18, r * 0.66, 0, Math.PI * 2);
      ctx.arc(x + r * 0.3, y - r * 0.45, r * 0.6, 0, Math.PI * 2);
      ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.54, 0, Math.PI * 2);
      ctx.fill();
      if (panza) {
        ctx.fillStyle = "rgba(" + panza + "," + (alpha * 0.7).toFixed(3) + ")";
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.55, r * 1.5, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /** Follaje: un contorno irregular en vez de un círculo. La diferencia
     *  entre un árbol y una paleta de helado es justamente el borde. */
    function follaje(x, y, r, color, semilla) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (var a = 0; a <= 13; a++) {
        var ang = (a / 13) * Math.PI * 2;
        var rr = r * (0.72 + az(semilla * 13 + a, 7) * 0.5);
        var px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr * 0.86;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }

    /** Las ventanas de un edificio, con algunas encendidas. `respira` hace
     *  que unas pocas se prendan y apaguen: es lo que hace que el fondo se
     *  vea habitado en vez de dibujado. */
    function ventanas(x, top, w, h, luz, densidad, semilla, respira) {
      var pasoX = 9, pasoY = 13;
      var cols = Math.max(1, Math.floor((w - 6) / pasoX));
      var filas = Math.max(1, Math.floor((h - 12) / pasoY));
      for (var c = 0; c < cols; c++) {
        for (var f = 0; f < filas; f++) {
          var d = az(semilla * 31 + c * 7, f * 11 + 3);
          if (d > densidad) continue;
          var a = 1;
          if (respira && d < densidad * 0.22) {
            // esta ventana es de las que se apagan de a ratos
            a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(state.elapsed * 0.7 + semilla + c + f * 2));
          }
          ctx.globalAlpha = a;
          ctx.fillStyle = luz;
          ctx.fillRect(x + 4 + c * pasoX, top + 8 + f * pasoY, 4, 6);
          ctx.globalAlpha = 1;
        }
      }
    }

    /** Una bandada cruzando el cielo. Cada bicho lleva su altura, su
     *  velocidad y su aleteo, para que no parezcan un grupo pegado. */
    function bandada(cuantos, color, altoMin, altoAlto, velocidad, tipo) {
      var base = groundY();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      for (var b = 0; b < cuantos; b++) {
        var propia = velocidad * (0.6 + az(b, 3) * 0.9);
        var bx = W + 60 - ((state.elapsed * propia + b * 211) % (W + 200));
        var by = altoMin + az(b, 9) * (altoAlto - altoMin);
        var ala = Math.sin(state.elapsed * (7 + az(b, 5) * 5) + b) * 4;
        var esc = 0.7 + az(b, 11) * 0.7;
        if (tipo === "murcielago") {
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(bx - 6 * esc, by - ala - 2, bx - 12 * esc, by + 1);
          ctx.quadraticCurveTo(bx - 6 * esc, by + 3, bx, by + 3);
          ctx.quadraticCurveTo(bx + 6 * esc, by + 3, bx + 12 * esc, by + 1);
          ctx.quadraticCurveTo(bx + 6 * esc, by - ala - 2, bx, by);
          ctx.fill();
        } else {
          ctx.lineWidth = 1.6 * esc;
          ctx.beginPath();
          ctx.moveTo(bx - 7 * esc, by + ala);
          ctx.quadraticCurveTo(bx, by - 4 * esc, bx + 7 * esc, by + ala);
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1;
    }

    /** Pasto o matorral del primer plano, meciéndose. Va bajito, pegado al
     *  piso: es lo que le da un borde vivo al camino. */
    function maleza(sep, vel, alto, color, cuantos) {
      var base = groundY();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      capa(sep, vel, function (x, i, s) {
        var h = alto * (0.5 + s);
        for (var t = 0; t < 3; t++) {
          var tx = x + (t - 1) * 4;
          var mece = Math.sin(state.elapsed * 1.9 + i + t) * (2 + s * 3);
          ctx.beginPath();
          ctx.moveTo(tx, base);
          ctx.quadraticCurveTo(tx + mece * 0.4, base - h * 0.6, tx + mece, base - h);
          ctx.stroke();
        }
      }, cuantos);
      ctx.lineWidth = 1;
    }

    /** Polvo, ceniza, polen: motas que flotan a contraluz. Cuesta cuatro
     *  líneas y es lo que le saca el aire de vacío a un fondo. */
    function motas(cuantas, color, velocidad, tam) {
      var base = groundY();
      ctx.fillStyle = color;
      for (var m = 0; m < cuantas; m++) {
        var mx = (az(m, 17) * (W + 140)) - ((state.elapsed * velocidad * (0.5 + az(m, 4)) + m * 53) % (W + 140)) + 70;
        var my = (az(m, 23) * base * 0.85) + Math.sin(state.elapsed * 0.8 + m) * 9;
        ctx.beginPath();
        ctx.arc(mx, my, tam * (0.5 + az(m, 29)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /** Una cordillera, en UN SOLO trazo.
     *
     *  En un solo trazo a propósito: si cada cerro se pintara por separado,
     *  donde se cruzan el color se acumularía y se verían los bordes de cada
     *  triángulo en vez de una silueta. */
    function cordillera(sep, vel, alto, variacion, color, cuantos) {
      var base = groundY();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-240, base);
      capa(sep, vel, function (x, i, s) {
        var h = alto + s * variacion;
        ctx.lineTo(x, base);
        /* Cuatro vértices y no uno: un cerro con la arista quebrada se lee
           como roca; con una sola punta se lee como un triángulo. */
        ctx.lineTo(x + sep * (0.22 + s * 0.16), base - h * (0.62 + s * 0.2));
        ctx.lineTo(x + sep * (0.42 + s * 0.22), base - h);
        ctx.lineTo(x + sep * (0.72 - s * 0.14), base - h * (0.5 + s * 0.26));
        ctx.lineTo(x + sep, base);
      }, cuantos);
      ctx.lineTo(W + 240, base);
      ctx.closePath();
      ctx.fill();
    }

    /** Una fila de edificios con ventanas encendidas. `luz` es el color de
     *  las ventanas; `densidad` cuántas están prendidas (0 a 1). */
    function manzana(sep, vel, alto, variacion, color, luz, densidad, remates, cuantos) {
      var base = groundY();
      capa(sep, vel, function (x, i, s) {
        var w = sep * (0.46 + s * 0.34);
        var h = alto + s * variacion;
        var top = base - h;
        ctx.fillStyle = color;
        ctx.fillRect(x, top, w, h);

        /* Los remates son lo que hace que una silueta se lea como una ciudad
           y no como una fila de cajas: tanques de agua, antenas, azoteas. */
        if (remates) {
          var tipo = Math.floor(az(i, sep + 3) * 3);
          ctx.fillRect(x + w * 0.2, top - 4, w * 0.6, 4);           // la azotea
          if (tipo === 0) {                                          // antena
            ctx.fillRect(x + w * 0.48, top - 18, 2, 18);
          } else if (tipo === 1) {                                   // tanque
            ctx.fillRect(x + w * 0.24, top - 12, w * 0.3, 12);
            ctx.fillRect(x + w * 0.3, top - 16, w * 0.18, 4);
          }
        }

        ventanas(x, top, w, h, luz, densidad, i + sep, true);
      }, cuantos);
    }

    /** Una arboleda. `pino` cambia la copa redonda por un triángulo. */
    function arboleda(sep, vel, alto, variacion, tronco, copa, pino, cuantos) {
      var base = groundY();
      capa(sep, vel, function (x, i, s) {
        var h = alto + s * variacion;
        ctx.fillStyle = tronco;
        ctx.fillRect(x - 3, base - h * 0.42, 6, h * 0.42);
        ctx.fillStyle = copa;
        if (pino) {
          for (var n = 0; n < 3; n++) {
            var ancho = (h * 0.34) * (1 - n * 0.24);
            var y = base - h * 0.34 - n * h * 0.2;
            ctx.beginPath();
            ctx.moveTo(x - ancho, y);
            ctx.lineTo(x, y - h * 0.3);
            ctx.lineTo(x + ancho, y);
            ctx.closePath(); ctx.fill();
          }
        } else {
          var r = h * 0.3;
          ctx.beginPath();
          ctx.arc(x, base - h * 0.66, r, 0, Math.PI * 2);
          ctx.arc(x - r * 0.7, base - h * 0.52, r * 0.7, 0, Math.PI * 2);
          ctx.arc(x + r * 0.7, base - h * 0.54, r * 0.74, 0, Math.PI * 2);
          ctx.fill();
        }
      }, cuantos);
    }

    /* ---- 🏙️ Ciudad TOPPINGS ----
       Una avenida de noche: cuatro profundidades de torres, un tren elevado
       cruzando al fondo, azoteas con carteles, y los faroles de la calle. */
    function drawAvenida() {
      var base = groundY();

      // 1. las torres lejanas, casi disueltas en el aire
      manzana(112, 0.10, 190, 130, "rgba(34,24,46,.42)", "rgba(255,215,150,.22)", 0.12, true, 34);

      // el tren elevado, que cruza cada tanto
      (function () {
        var largoVia = 3400;
        var t = (state.elapsed * 120) % (largoVia + W + 400);
        var vy = base - 208;
        ctx.fillStyle = "rgba(24,18,32,.6)";
        ctx.fillRect(0, vy + 16, W, 4);
        for (var c = 0; c < W; c += 74) ctx.fillRect(c, vy + 20, 5, 40);
        if (t < W + 300) {
          var tx = W + 220 - t;
          for (var v = 0; v < 4; v++) {
            var cx = tx + v * 52;
            if (cx < -60 || cx > W + 60) continue;
            ctx.fillStyle = "rgba(48,42,62,.92)";
            ctx.fillRect(cx, vy - 14, 46, 30);
            ctx.fillStyle = "rgba(255,225,160,.75)";
            for (var vn = 0; vn < 4; vn++) ctx.fillRect(cx + 5 + vn * 11, vy - 8, 7, 9);
          }
          luzPuntual(tx + 10, vy, 90, "255,220,160", 0.5);
        }
      })();

      bandaNeblina(190, 110, "255,190,150", 0.10);

      // 2. las torres medias, con ventanas que respiran
      manzana(84, 0.24, 140, 105, "rgba(24,16,32,.7)", "rgba(255,208,120,.5)", 0.22, true, 30);

      // carteles de azotea, apagándose y prendiéndose
      capa(196, 0.24, function (x, i, s) {
        if (s < 0.5) return;
        var alto = 150 + s * 90;
        var an = 34 + s * 22;
        var late = 0.35 + 0.65 * Math.abs(Math.sin(state.elapsed * 1.1 + i * 2));
        ctx.fillStyle = "rgba(16,10,20,.9)";
        ctx.fillRect(x, base - alto - 26, an, 22);
        ctx.strokeStyle = "rgba(255,120,90," + (late * 0.8).toFixed(2) + ")";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, base - alto - 24, an - 4, 18);
        ctx.lineWidth = 1;
        luzPuntual(x + an / 2, base - alto - 15, 44, "255,120,90", late * 0.55);
      }, 26);

      bandaNeblina(110, 80, "255,180,140", 0.09);

      // 3. la fila de adelante: locales en planta baja, toldos y letreritos
      manzana(66, 0.42, 96, 70, "rgba(16,10,22,.88)", "rgba(255,196,96,.62)", 0.3, true, 37);
      capa(66, 0.42, function (x, i, s) {
        var an = 66 * (0.46 + s * 0.34);
        // la vidriera encendida de la planta baja
        ctx.fillStyle = "rgba(255,205,130,.30)";
        ctx.fillRect(x + 3, base - 26, an - 6, 20);
        // el toldo a rayas
        var col = az(i, 3) > 0.5 ? "220,70,70" : "60,140,180";
        for (var r = 0; r < 5; r++) {
          ctx.fillStyle = "rgba(" + (r % 2 ? col : "235,232,225") + ",.85)";
          ctx.fillRect(x + 2 + r * ((an - 4) / 5), base - 32, (an - 4) / 5, 7);
        }
        luzPuntual(x + an / 2, base - 20, 40, "255,200,130", 0.4);
      }, 37);

      // 4. los faroles de la avenida
      capa(158, 0.66, function (x, i, s) {
        if (s < 0.42) return;
        var alto = 92 + s * 30;
        ctx.fillStyle = "rgba(10,7,14,.96)";
        ctx.fillRect(x - 2.5, base - alto, 5, alto);
        ctx.beginPath();
        ctx.moveTo(x, base - alto);
        ctx.quadraticCurveTo(x + 12, base - alto - 6, x + 21, base - alto + 2);
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,7,14,.96)"; ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,232,180,.95)";
        ctx.fillRect(x + 17, base - alto + 2, 9, 4);
        luzPuntual(x + 21, base - alto + 6, 76, "255,215,150", 0.85);
      }, 24);

      motas(14, "rgba(255,220,170,.16)", 26, 1.4);
    }

    /* ---- 🎓 Zona Universitaria ----
       El campus de noche: el bloque de la facultad con sus pasillos
       iluminados, la cancha con torres de luz, murales, y la arboleda. */
    function drawCampus() {
      var base = groundY();

      cordillera(230, 0.08, 118, 66, "rgba(30,26,54,.4)", 22);
      bandaNeblina(150, 100, "170,180,235", 0.09);

      // el bloque de la facultad: largo, con los pasillos encendidos
      capa(240, 0.2, function (x, i, s) {
        var an = 190 + s * 90, al = 118 + s * 46;
        var top = base - al;
        ctx.fillStyle = "rgba(28,24,48,.82)";
        ctx.fillRect(x, top, an, al);
        // las bandas horizontales de los pisos, que es lo que la hace facultad
        for (var piso = 0; piso < 4; piso++) {
          var py = top + 14 + piso * (al / 4.4);
          ctx.fillStyle = "rgba(200,214,255,.20)";
          ctx.fillRect(x + 6, py, an - 12, 8);
          // y algunas oficinas prendidas
          for (var o = 0; o < 7; o++) {
            if (az(i * 17 + piso, o) > 0.34) continue;
            ctx.fillStyle = "rgba(230,238,255,.62)";
            ctx.fillRect(x + 10 + o * ((an - 20) / 7), py, 12, 8);
          }
        }
        // el letrero de la entrada
        ctx.fillStyle = "rgba(120,190,255,.5)";
        ctx.fillRect(x + an * 0.3, top - 9, an * 0.4, 6);
      }, 20);

      // las torres de luz de la cancha, con su cono bajando
      capa(206, 0.38, function (x, i, s) {
        if (s < 0.46) return;
        var alto = 156 + s * 48;
        ctx.fillStyle = "rgba(18,16,32,.92)";
        ctx.fillRect(x - 3, base - alto, 6, alto);
        for (var tr = 0; tr < 4; tr++) ctx.fillRect(x - 8, base - alto * (0.3 + tr * 0.2), 16, 3);
        ctx.fillStyle = "rgba(240,246,255,.9)";
        ctx.fillRect(x - 16, base - alto - 10, 32, 10);
        // el cono de luz hacia el piso
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        var g = ctx.createLinearGradient(x, base - alto, x, base);
        g.addColorStop(0, "rgba(215,230,255,.16)");
        g.addColorStop(1, "rgba(215,230,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 16, base - alto);
        ctx.lineTo(x - 76, base); ctx.lineTo(x + 76, base); ctx.lineTo(x + 16, base - alto);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        luzPuntual(x, base - alto - 4, 100, "215,230,255", 0.7);
      }, 18);

      // el muro con murales, delante de la cancha
      capa(150, 0.55, function (x, i, s) {
        var an = 128, al = 40 + s * 14;
        ctx.fillStyle = "rgba(46,42,60,.9)";
        ctx.fillRect(x, base - al, an, al);
        // manchas de pintura, cada muro el suyo
        var tonos = ["255,90,120", "120,200,255", "255,205,90", "150,255,180"];
        for (var mm = 0; mm < 4; mm++) {
          ctx.fillStyle = "rgba(" + tonos[(i + mm) % 4] + ",.4)";
          ctx.beginPath();
          ctx.ellipse(x + 18 + mm * 30, base - al * (0.4 + az(i, mm) * 0.4),
                      12 + az(i + mm, 2) * 9, 8 + az(i, mm + 3) * 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }, 21);

      arboleda(78, 0.68, 108, 62, "rgba(24,22,20,.92)", "rgba(28,54,44,.94)", false, 50);
      maleza(38, 0.9, 16, "rgba(30,58,44,.75)", 135);
      motas(10, "rgba(200,220,255,.12)", 20, 1.2);
    }

    /* ---- 🌄 Amanecer en el Valle ----
       Cinco planos que se van aclarando con la distancia, el sol saliendo
       entre dos cerros, el río abajo y el humo de las casas del valle. */
    function drawValle() {
      var base = groundY();

      cordillera(260, 0.07, 168, 104, "rgba(146,104,132,.34)", 20);
      bandaNeblina(210, 110, "255,220,190", 0.18);
      cordillera(200, 0.13, 136, 88, "rgba(120,74,108,.46)", 22);
      bandaNeblina(160, 100, "255,212,175", 0.16);

      // el río del valle, brillando con el sol
      (function () {
        var ry = base - 96;
        ctx.fillStyle = "rgba(255,214,168,.30)";
        ctx.beginPath();
        ctx.moveTo(-20, ry + 16);
        for (var rx = -20; rx <= W + 20; rx += 24) {
          ctx.lineTo(rx, ry + 10 + Math.sin(rx / 60 + state.elapsed * 0.25) * 5);
        }
        ctx.lineTo(W + 20, ry + 22); ctx.lineTo(-20, ry + 26);
        ctx.closePath(); ctx.fill();
        // los destellos del agua
        ctx.fillStyle = "rgba(255,248,225,.5)";
        for (var d = 0; d < 16; d++) {
          var dx = (az(d, 7) * W + state.elapsed * 6) % W;
          var brillo = Math.abs(Math.sin(state.elapsed * 2 + d * 1.7));
          if (brillo < 0.7) continue;
          ctx.fillRect(dx, ry + 12 + az(d, 3) * 8, 5, 1.5);
        }
      })();

      cordillera(150, 0.24, 104, 66, "rgba(88,54,84,.62)", 24);

      // las casitas del valle, con su humo
      capa(168, 0.34, function (x, i, s) {
        if (s < 0.4) return;
        var an = 26 + s * 14, al = 20 + s * 10;
        var top = base - 58 - al;
        ctx.fillStyle = "rgba(70,44,58,.9)";
        ctx.fillRect(x, top, an, al);
        ctx.beginPath();
        ctx.moveTo(x - 4, top); ctx.lineTo(x + an / 2, top - 12); ctx.lineTo(x + an + 4, top);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,210,150,.55)";
        ctx.fillRect(x + an * 0.32, top + al * 0.35, an * 0.34, al * 0.4);
        ctx.fillStyle = "rgba(235,225,215,.14)";
        for (var hu = 0; hu < 4; hu++) {
          var sube = (state.elapsed * 11 + hu * 15 + i * 9) % 56;
          ctx.beginPath();
          ctx.arc(x + an * 0.75 + Math.sin(sube / 11) * 6, top - 16 - sube, 3 + sube / 11, 0, Math.PI * 2);
          ctx.fill();
        }
      }, 22);

      bandaNeblina(90, 80, "255,204,162", 0.14);
      arboleda(96, 0.56, 92, 52, "rgba(48,30,32,.9)", "rgba(58,46,44,.9)", false, 34);
      arboleda(60, 0.8, 58, 34, "rgba(34,22,24,.94)", "rgba(40,32,30,.94)", false, 76);
      maleza(34, 1, 20, "rgba(72,54,42,.8)", 168);

      bandada(7, "rgba(60,40,50,.55)", 60, 190, 24, "ave");
      motas(16, "rgba(255,220,180,.2)", 18, 1.6);
    }

    /* ---- 🌲 Bosque de Pinos ----
       Cuatro filas de pinos cada vez más oscuras, nieve acumulada en las
       ramas, y la nevada cayendo entre medio. */
    function drawPinos() {
      var base = groundY();

      cordillera(240, 0.07, 150, 90, "rgba(120,140,175,.32)", 20);
      bandaNeblina(190, 110, "225,238,255", 0.20);
      arboleda(94, 0.16, 118, 60, "rgba(52,62,76,.5)", "rgba(48,72,80,.5)", true, 26);
      bandaNeblina(140, 90, "220,235,252", 0.16);
      arboleda(70, 0.32, 138, 74, "rgba(38,46,58,.75)", "rgba(30,58,62,.78)", true, 30);

      /* La nieve encima de las ramas. Es el detalle que separa "pinos" de
         "pinos en invierno": sin esto es el mismo bosque de cualquier mapa. */
      capa(70, 0.32, function (x, i, s) {
        var h = 138 + s * 74;
        ctx.fillStyle = "rgba(235,245,255,.7)";
        for (var n = 0; n < 3; n++) {
          var an = (h * 0.34) * (1 - n * 0.24);
          var y = base - h * 0.34 - n * h * 0.2;
          ctx.beginPath();
          ctx.moveTo(x - an, y);
          ctx.lineTo(x, y - h * 0.3);
          ctx.lineTo(x + an, y);
          ctx.lineTo(x + an * 0.62, y);
          ctx.lineTo(x, y - h * 0.3 + 9);
          ctx.lineTo(x - an * 0.62, y);
          ctx.closePath(); ctx.fill();
        }
      }, 30);

      arboleda(52, 0.58, 160, 80, "rgba(22,28,36,.94)", "rgba(20,42,44,.95)", true, 64);

      // troncos caídos y matorral nevado al pie
      capa(184, 0.8, function (x, i, s) {
        if (s < 0.55) return;
        ctx.fillStyle = "rgba(38,32,30,.92)";
        ctx.save();
        ctx.translate(x, base - 7);
        ctx.rotate((az(i, 4) - 0.5) * 0.3);
        ctx.fillRect(-26, -5, 52, 10);
        ctx.fillStyle = "rgba(232,244,255,.8)";
        ctx.fillRect(-26, -7, 52, 4);
        ctx.restore();
      }, 25);

      motas(26, "rgba(255,255,255,.5)", 30, 1.8);
    }

    /* ---- 🌫️ Bosque Muerto ----
       Troncos secos y retorcidos en cuatro planos, niebla espesa entre
       ellos, cuervos posados y ojos que se abren en la oscuridad. */
    function drawBosqueMuerto() {
      var base = groundY();

      ctx.fillStyle = "rgba(28,24,32,.45)";
      ctx.fillRect(0, base - 260, W, 260);

      /** Un tronco seco: sube torcido y se abre en ramas peladas. */
      function tronco(x, alto, grosor, color, semilla) {
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.lineWidth = grosor;
        var curva = (az(semilla, 3) - 0.5) * 26;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + curva, base - alto * 0.55, x + curva * 1.5, base - alto);
        ctx.stroke();
        var cima = { x: x + curva * 1.5, y: base - alto };
        for (var r = 0; r < 5; r++) {
          var ang = -Math.PI / 2 + (r - 2) * 0.42 + (az(semilla, r) - 0.5) * 0.3;
          var largo = alto * (0.18 + az(semilla + r, 2) * 0.2);
          var mece = Math.sin(state.elapsed * 0.9 + semilla + r) * 3;
          ctx.lineWidth = grosor * 0.42;
          ctx.beginPath();
          ctx.moveTo(cima.x, cima.y + alto * 0.14);
          ctx.quadraticCurveTo(cima.x + Math.cos(ang) * largo * 0.5, cima.y + Math.sin(ang) * largo * 0.5,
                               cima.x + Math.cos(ang) * largo + mece, cima.y + Math.sin(ang) * largo);
          ctx.stroke();
          // una ramita más, para que no sea una estrella
          ctx.lineWidth = grosor * 0.24;
          ctx.beginPath();
          ctx.moveTo(cima.x + Math.cos(ang) * largo * 0.6, cima.y + Math.sin(ang) * largo * 0.6);
          ctx.lineTo(cima.x + Math.cos(ang + 0.5) * largo * 0.95, cima.y + Math.sin(ang + 0.5) * largo * 0.9);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
        ctx.lineWidth = 1;
      }

      capa(126, 0.14, function (x, i, s) { tronco(x, 150 + s * 70, 5, "rgba(66,60,70,.4)", i); }, 24);
      bandaNeblina(170, 120, "150,150,170", 0.16);
      capa(96, 0.3, function (x, i, s) { tronco(x, 180 + s * 84, 7, "rgba(46,42,52,.72)", i + 40); }, 28);
      bandaNeblina(110, 90, "140,140,162", 0.18);
      capa(74, 0.54, function (x, i, s) { tronco(x, 216 + s * 96, 10, "rgba(26,24,32,.94)", i + 80); }, 42);

      /* Los ojos. Se abren, miran un rato y se cierran — nunca todos a la
         vez, para que se sienta que hay algo y no que es un adorno. */
      capa(148, 0.54, function (x, i, s) {
        var ciclo = (state.elapsed * 0.4 + az(i, 9) * 6) % 6;
        if (ciclo > 1.6) return;
        var abre = Math.sin((ciclo / 1.6) * Math.PI);
        var oy = base - 60 - az(i, 5) * 130;
        ctx.fillStyle = "rgba(255,214,90," + (abre * 0.85).toFixed(2) + ")";
        ctx.beginPath(); ctx.ellipse(x - 5, oy, 2.6, 2.6 * abre, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 5, oy, 2.6, 2.6 * abre, 0, 0, Math.PI * 2); ctx.fill();
        luzPuntual(x, oy, 22, "255,200,80", abre * 0.4);
      }, 32);

      // cuervos posados que de a ratos levantan vuelo
      bandada(4, "rgba(14,12,18,.8)", 50, 150, 30, "ave");
      maleza(40, 0.9, 22, "rgba(48,44,40,.8)", 129);
      motas(20, "rgba(190,190,200,.14)", 14, 2);
    }

    /* ---- ☁️ Trineo en el Cielo ----
       Un cielo con tres alturas de nubes, claros por donde se ve el suelo
       lejísimos, auroras y el trineo cruzando. */
    function drawCieloNubes(color) {
      var base = groundY();
      var rosa = color !== "255,255,255";

      // la aurora del fondo
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var a = 0; a < 3; a++) {
        var ax = W * (0.2 + a * 0.3) + Math.sin(state.elapsed * 0.3 + a) * 40;
        var g = ctx.createLinearGradient(ax, 0, ax + 60, base * 0.7);
        var tono = rosa ? "255,150,200" : "140,230,220";
        g.addColorStop(0, "rgba(" + tono + ",0)");
        g.addColorStop(0.5, "rgba(" + tono + ",.13)");
        g.addColorStop(1, "rgba(" + tono + ",0)");
        ctx.fillStyle = g;
        ctx.fillRect(ax - 70, 0, 160, base * 0.75);
      }
      ctx.restore();

      /* Tres bandas de nubes, cada una en SU franja de altura y sin
         solaparse con las otras. Antes las tres cubrían el mismo rango y se
         apilaban hasta tapar el cielo entero: quedaba una masa blanca en vez
         de un cielo con nubes. */
      [[0.10, 0.10, 0.26, 34, 0.13],
       [0.24, 0.30, 0.44, 44, 0.18],
       [0.46, 0.52, 0.70, 56, 0.24]].forEach(function (cfg, k) {
        capa(230, cfg[0], function (x, i, s) {
          if (s < 0.28) return;                 // claros por donde se ve el fondo
          var y = base * (cfg[1] + s * (cfg[2] - cfg[1]));
          nubeVolumen(x, y, cfg[3] * (0.6 + s * 0.6), color, cfg[4],
                      rosa ? "220,120,170" : "170,190,220");
        }, 20 - k * 2);
      });

      // el suelo lejísimos, asomando entre las nubes
      ctx.fillStyle = rosa ? "rgba(150,70,120,.28)" : "rgba(70,100,130,.3)";
      ctx.beginPath();
      ctx.moveTo(-20, base);
      capa(210, 0.16, function (x, i, s) {
        ctx.lineTo(x, base);
        ctx.lineTo(x + 70, base - 34 - s * 30);
        ctx.lineTo(x + 150, base - 16 - s * 14);
        ctx.lineTo(x + 210, base);
      }, 18);
      ctx.lineTo(W + 20, base);
      ctx.closePath(); ctx.fill();

      // el trineo, cruzando cada tanto bien arriba
      (function () {
        var vuelta = (state.elapsed * 46) % (W + 900);
        var tx = W + 120 - vuelta;
        if (tx < -260 || tx > W + 120) return;
        var ty = 60 + Math.sin(state.elapsed * 0.8) * 14;
        ctx.strokeStyle = rosa ? "rgba(120,40,80,.8)" : "rgba(40,50,70,.8)";
        ctx.lineWidth = 2;
        for (var r = 0; r < 4; r++) {
          var rx = tx + r * 26;
          ctx.beginPath();
          ctx.moveTo(rx, ty); ctx.lineTo(rx + 12, ty + 3); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(rx + 4, ty - 1); ctx.lineTo(rx + 1, ty - 7); ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.fillStyle = rosa ? "rgba(190,40,90,.9)" : "rgba(180,40,50,.9)";
        ctx.fillRect(tx + 108, ty - 8, 30, 13);
        ctx.fillStyle = "rgba(255,225,150,.9)";
        ctx.fillRect(tx + 112, ty - 5, 6, 6);
        luzPuntual(tx + 122, ty, 54, rosa ? "255,150,190" : "255,220,150", 0.6);
      })();

      motas(22, rosa ? "rgba(255,190,220,.4)" : "rgba(255,255,255,.4)", 22, 1.8);
    }

    /* ---- 💗 Amor: Atardecer Rosado ----
       Cinco planos de cerros que se van aclarando, el sol bajando, globos
       que suben, pájaros en pareja y los faroles del paseo. */
    function drawAtardecerAmor() {
      var base = groundY();

      cordillera(255, 0.07, 158, 96, "rgba(176,96,146,.32)", 20);
      bandaNeblina(200, 120, "255,196,222", 0.17);
      cordillera(195, 0.13, 128, 80, "rgba(146,64,116,.44)", 22);
      bandaNeblina(150, 100, "255,184,212", 0.15);
      cordillera(145, 0.23, 100, 62, "rgba(110,42,88,.58)", 24);

      // los globos, cada uno con su ritmo de subida
      capa(118, 0.34, function (x, i, s) {
        if (s < 0.34) return;
        var sube = (state.elapsed * (6 + s * 11) + i * 43) % 320;
        var y = base - 40 - sube;
        var r = 7 + s * 7;
        var vaiven = Math.sin(state.elapsed * 0.9 + i) * 7;
        var tono = az(i, 3);
        var color = tono > 0.66 ? "255,120,170" : tono > 0.33 ? "255,170,190" : "250,90,140";
        ctx.fillStyle = "rgba(" + color + ",.82)";
        ctx.beginPath();
        ctx.ellipse(x + vaiven, y, r, r * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
        // el brillito del globo, que es lo que lo hace globo y no círculo
        ctx.fillStyle = "rgba(255,235,245,.5)";
        ctx.beginPath(); ctx.ellipse(x + vaiven - r * 0.35, y - r * 0.4, r * 0.24, r * 0.32, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(" + color + ",.82)";
        ctx.beginPath();
        ctx.moveTo(x + vaiven - 2, y + r * 1.1); ctx.lineTo(x + vaiven + 2, y + r * 1.1);
        ctx.lineTo(x + vaiven, y + r * 1.4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(255,200,220,.4)";
        ctx.beginPath();
        ctx.moveTo(x + vaiven, y + r * 1.4);
        ctx.quadraticCurveTo(x + vaiven - 4, y + r * 1.4 + 9, x + vaiven + 2, y + r * 1.4 + 18);
        ctx.stroke();
      }, 26);

      // la arboleda del paseo, en flor
      capa(96, 0.5, function (x, i, s) {
        var h = 104 + s * 56;
        ctx.fillStyle = "rgba(64,32,50,.9)";
        ctx.fillRect(x - 4, base - h * 0.44, 8, h * 0.44);
        follaje(x, base - h * 0.68, h * 0.3, "rgba(226,120,168,.85)", i);
        follaje(x - h * 0.2, base - h * 0.54, h * 0.2, "rgba(240,150,190,.8)", i + 9);
        follaje(x + h * 0.2, base - h * 0.56, h * 0.21, "rgba(210,104,156,.82)", i + 17);
        // pétalos cayendo del árbol
        for (var pt = 0; pt < 3; pt++) {
          var cae = (state.elapsed * 22 + pt * 30 + i * 17) % (h * 0.7);
          ctx.fillStyle = "rgba(255,180,210,.55)";
          ctx.beginPath();
          ctx.ellipse(x + Math.sin(cae / 14 + pt) * 12, base - h * 0.62 + cae, 2.6, 1.6,
                      cae / 12, 0, Math.PI * 2);
          ctx.fill();
        }
      }, 30);

      // los faroles, con corazoncitos colgando
      capa(150, 0.68, function (x, i, s) {
        if (s < 0.4) return;
        var alto = 88 + s * 26;
        ctx.fillStyle = "rgba(48,22,40,.96)";
        ctx.fillRect(x - 2.5, base - alto, 5, alto);
        ctx.fillStyle = "rgba(255,225,240,.95)";
        ctx.beginPath(); ctx.arc(x, base - alto - 3, 5, 0, Math.PI * 2); ctx.fill();
        luzPuntual(x, base - alto - 3, 66, "255,170,205", 0.8);
        // el corazoncito del poste
        var late = 1 + Math.sin(state.elapsed * 3 + i) * 0.12;
        ctx.fillStyle = "rgba(255,110,160,.9)";
        corazonEn(x, base - alto * 0.62, 4 * late);
      }, 26);

      bandada(6, "rgba(120,50,90,.5)", 60, 200, 22, "ave");
      maleza(36, 0.92, 18, "rgba(96,50,74,.75)", 146);
      motas(18, "rgba(255,190,220,.22)", 16, 1.7);
    }

    /* ---- 🌳 Parque de Novios ----
       El parque de noche: la fuente del centro, bancas con parejas, faroles,
       globos atados y el sendero con sus setos. */
    function drawParque() {
      var base = groundY();

      cordillera(240, 0.08, 120, 70, "rgba(60,40,72,.4)", 20);
      bandaNeblina(160, 100, "230,180,220", 0.11);
      arboleda(112, 0.2, 128, 62, "rgba(38,28,44,.62)", "rgba(52,38,58,.62)", false, 24);

      // la fuente, con el agua saltando
      capa(430, 0.34, function (x, i, s) {
        var r = 42;
        ctx.fillStyle = "rgba(72,58,84,.92)";
        ctx.beginPath(); ctx.ellipse(x, base - 12, r, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(140,190,230,.5)";
        ctx.beginPath(); ctx.ellipse(x, base - 14, r - 7, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(72,58,84,.92)";
        ctx.fillRect(x - 5, base - 46, 10, 34);
        ctx.beginPath(); ctx.ellipse(x, base - 46, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
        // los chorros
        ctx.strokeStyle = "rgba(190,230,255,.55)";
        ctx.lineWidth = 1.6;
        for (var ch = -2; ch <= 2; ch++) {
          if (!ch) continue;
          var salto = Math.abs(Math.sin(state.elapsed * 1.4 + ch)) * 12;
          ctx.beginPath();
          ctx.moveTo(x, base - 50);
          ctx.quadraticCurveTo(x + ch * 12, base - 66 - salto, x + ch * 24, base - 20);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        luzPuntual(x, base - 30, 90, "150,200,255", 0.4);
      }, 12);

      // las bancas con parejas
      capa(178, 0.52, function (x, i, s) {
        if (s < 0.36) return;
        // la banca
        ctx.fillStyle = "rgba(74,48,36,.95)";
        ctx.fillRect(x - 26, base - 20, 52, 5);
        ctx.fillRect(x - 26, base - 34, 52, 4);
        ctx.fillStyle = "rgba(44,30,26,.95)";
        ctx.fillRect(x - 24, base - 20, 4, 20);
        ctx.fillRect(x + 20, base - 20, 4, 20);
        // la pareja, apoyada una en la otra
        var respira = Math.sin(state.elapsed * 1.1 + i) * 1.2;
        ctx.fillStyle = "rgba(28,18,30,.92)";
        ctx.beginPath(); ctx.arc(x - 9, base - 40 + respira, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - 15, base - 36 + respira, 12, 17);
        ctx.beginPath(); ctx.arc(x + 8, base - 39 - respira, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x + 2, base - 35 - respira, 12, 16);
        // el corazón que les sale de a ratos
        var ciclo = (state.elapsed * 0.5 + az(i, 7) * 4) % 4;
        if (ciclo < 1.5) {
          ctx.fillStyle = "rgba(255,120,170," + (0.8 * (1 - ciclo / 1.5)).toFixed(2) + ")";
          corazonEn(x, base - 52 - ciclo * 22, 4);
        }
      }, 24);

      // los faroles del sendero
      capa(134, 0.7, function (x, i, s) {
        if (s < 0.44) return;
        var alto = 82 + s * 24;
        ctx.fillStyle = "rgba(34,24,40,.96)";
        ctx.fillRect(x - 2.5, base - alto, 5, alto);
        ctx.fillRect(x - 8, base - 3, 16, 3);
        ctx.fillStyle = "rgba(255,232,190,.95)";
        ctx.beginPath();
        ctx.moveTo(x - 6, base - alto); ctx.lineTo(x + 6, base - alto);
        ctx.lineTo(x + 4, base - alto - 13); ctx.lineTo(x - 4, base - alto - 13);
        ctx.closePath(); ctx.fill();
        luzPuntual(x, base - alto - 6, 84, "255,215,160", 0.85);
      }, 30);

      // los setos del borde
      capa(58, 0.86, function (x, i, s) {
        follaje(x, base - 9 - s * 6, 13 + s * 7, "rgba(30,58,44,.9)", i);
      }, 85);

      motas(16, "rgba(255,210,230,.18)", 14, 1.6);
    }

    /* ---- 🔒 Callejón de los Candados ----
       El callejón angosto: paredes a los dos lados, la reja llena de
       candados, ropa tendida arriba, grafitis y el neón de un local. */
    function drawCallejon() {
      var base = groundY();

      // el fondo del callejón: la pared del final
      var g = ctx.createLinearGradient(0, base - 300, 0, base);
      g.addColorStop(0, "rgba(30,22,38,.9)");
      g.addColorStop(1, "rgba(48,34,52,.9)");
      ctx.fillStyle = g;
      ctx.fillRect(0, base - 300, W, 300);

      // los ladrillos
      ctx.fillStyle = "rgba(20,14,26,.28)";
      for (var f = 0; f < 14; f++) {
        var fy = base - 300 + f * 22;
        ctx.fillRect(0, fy, W, 1.5);
        for (var c = 0; c < W; c += 34) ctx.fillRect(c + (f % 2 ? 17 : 0), fy, 1.5, 22);
      }

      // las ventanas de los edificios de arriba, con ropa tendida entre ellas
      capa(122, 0.3, function (x, i, s) {
        var vy = base - 250 + s * 60;
        ctx.fillStyle = "rgba(16,12,22,.9)";
        ctx.fillRect(x, vy, 30, 40);
        if (az(i, 3) < 0.55) {
          ctx.fillStyle = "rgba(255,210,140,.55)";
          ctx.fillRect(x + 3, vy + 3, 24, 34);
          luzPuntual(x + 15, vy + 20, 54, "255,200,130", 0.4);
        }
        // el balconcito
        ctx.fillStyle = "rgba(28,20,34,.9)";
        ctx.fillRect(x - 4, vy + 40, 38, 3);
        for (var bb = 0; bb < 5; bb++) ctx.fillRect(x - 2 + bb * 8, vy + 40, 1.5, 9);
      }, 24);

      // la ropa tendida, colgando y meciéndose
      capa(122, 0.3, function (x, i, s) {
        var cy = base - 214 + s * 40;
        ctx.strokeStyle = "rgba(180,170,190,.4)";
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.quadraticCurveTo(x + 61, cy + 16, x + 122, cy);
        ctx.stroke();
        var colores = ["220,90,110", "90,150,220", "240,220,180", "150,210,140"];
        for (var pr = 0; pr < 4; pr++) {
          var px = x + 20 + pr * 26;
          var t = (px - x) / 122;
          var py = cy + Math.sin(t * Math.PI) * 16;
          var mece = Math.sin(state.elapsed * 1.4 + i + pr) * 3;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(mece * 0.03);
          ctx.fillStyle = "rgba(" + colores[(i + pr) % 4] + ",.8)";
          ctx.fillRect(-7, 0, 14, 18);
          ctx.restore();
        }
      }, 24);

      // los grafitis de la pared
      capa(196, 0.55, function (x, i, s) {
        var tonos = ["255,90,140", "120,220,255", "255,205,90", "160,255,170"];
        ctx.save();
        ctx.translate(x, base - 96 - s * 40);
        ctx.rotate((az(i, 4) - 0.5) * 0.2);
        for (var t = 0; t < 3; t++) {
          ctx.fillStyle = "rgba(" + tonos[(i + t) % 4] + ",.32)";
          ctx.beginPath();
          ctx.ellipse(t * 22, az(i, t) * 14, 16 + az(i + t, 2) * 10, 11 + az(i, t + 5) * 8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }, 20);

      /* La reja de los candados: es el lugar. Cada candado con su color y su
         brillito, y algunos con un corazón grabado. */
      ctx.fillStyle = "rgba(24,18,30,.95)";
      ctx.fillRect(0, base - 92, W, 4);
      ctx.fillRect(0, base - 40, W, 4);
      capa(15, 0.8, function (x) { ctx.fillRect(x, base - 92, 2.5, 92); }, 220);

      capa(23, 0.8, function (x, i, s) {
        var cy = base - 84 + az(i, 3) * 40;
        var tam = 4 + s * 3;
        var tono = az(i, 9);
        var color = tono > 0.72 ? "255,120,160" : tono > 0.42 ? "212,196,140" : "180,190,205";
        ctx.fillStyle = "rgba(" + color + ",.92)";
        ctx.fillRect(x - tam / 2, cy, tam, tam * 1.15);
        ctx.strokeStyle = "rgba(" + color + ",.92)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, cy, tam * 0.42, Math.PI, 0);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,255,255,.35)";
        ctx.fillRect(x - tam / 2 + 1, cy + 1, 1.4, tam * 0.5);
        if (tono > 0.72) {
          ctx.fillStyle = "rgba(255,80,130,.9)";
          corazonEn(x, cy + tam * 0.6, 1.7);
        }
      }, 199);

      // el neón de un local, al fondo del callejón
      capa(520, 0.55, function (x, i, s) {
        var late = 0.55 + 0.45 * Math.abs(Math.sin(state.elapsed * 1.7 + i));
        var y = base - 150;
        ctx.save();
        ctx.shadowColor = "rgba(255,90,150,.9)";
        ctx.shadowBlur = 16 * late;
        ctx.strokeStyle = "rgba(255,120,170," + late.toFixed(2) + ")";
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 9, y + 3); ctx.quadraticCurveTo(x, y + 13, x + 9, y + 3);
        ctx.stroke();
        ctx.restore();
        ctx.lineWidth = 1;
        luzPuntual(x, y, 110, "255,110,160", late * 0.7);
      }, 8);

      motas(12, "rgba(255,190,215,.14)", 12, 1.5);
    }

    /* ---- 🌉 Noche Extrema ----
       El puente colgante sobre el vacío: torres altas con sus travesaños, los
       tirantes en abanico, tráfico cruzando abajo, y el río muy al fondo. */
    function drawPuenteReal() {
      var base = groundY();

      cordillera(240, 0.08, 128, 88, "rgba(28,28,44,.55)", 20);
      bandaNeblina(150, 110, "130,145,190", 0.10);
      cordillera(170, 0.15, 96, 62, "rgba(20,20,32,.72)", 22);

      // el río allá abajo, con el reflejo de las luces
      (function () {
        var ry = base - 78;
        ctx.fillStyle = "rgba(40,52,86,.5)";
        ctx.fillRect(0, ry, W, 30);
        ctx.fillStyle = "rgba(120,150,220,.16)";
        for (var d = 0; d < 20; d++) {
          var dx = (az(d, 5) * W + state.elapsed * 8) % W;
          ctx.fillRect(dx, ry + 4 + az(d, 9) * 22, 7 + az(d, 3) * 12, 1.4);
        }
      })();

      var totalW = Math.max(620, W * 1.6);
      /* Al 26% del piso: el puente está lejos pero no tanto como los cerros.
         Iba con el contador viejo, que lo dejaba prácticamente clavado. */
      var offset = (state.bgScroll * 0.26) % totalW;
      var altoTorre = Math.min(base * 0.72, 300);
      var tabla = base - altoTorre * 0.34;

      for (var v = 0; v < 2; v++) {
        var x0 = -offset + v * totalW;
        var x1 = x0 + totalW * 0.58;
        if (x0 > W + 300 && x1 > W + 300) continue;

        // la calzada, con su viga de celosía debajo
        ctx.fillStyle = "rgba(22,22,34,.94)";
        ctx.fillRect(x0 - 80, tabla, (x1 - x0) + 160, 7);
        ctx.fillStyle = "rgba(15,15,24,.85)";
        ctx.fillRect(x0 - 80, tabla + 7, (x1 - x0) + 160, 4);
        ctx.strokeStyle = "rgba(48,48,66,.6)"; ctx.lineWidth = 1;
        for (var ce = x0 - 80; ce < x1 + 80; ce += 18) {
          ctx.beginPath();
          ctx.moveTo(ce, tabla + 11); ctx.lineTo(ce + 9, tabla + 24); ctx.lineTo(ce + 18, tabla + 11);
          ctx.stroke();
        }

        // el cable principal colgando entre torres, con las péndolas
        ctx.strokeStyle = "rgba(96,96,126,.7)"; ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x0, base - altoTorre + 12);
        ctx.quadraticCurveTo((x0 + x1) / 2, tabla - 14, x1, base - altoTorre + 12);
        ctx.stroke();
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = "rgba(86,86,112,.5)";
        for (var pe = 1; pe < 18; pe++) {
          var t = pe / 18;
          var px = x0 + (x1 - x0) * t;
          var py = (1 - t) * (1 - t) * (base - altoTorre + 12) + 2 * (1 - t) * t * (tabla - 14) + t * t * (base - altoTorre + 12);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, tabla); ctx.stroke();
        }

        // las torres
        [x0, x1].forEach(function (tx) {
          var gt = ctx.createLinearGradient(tx - 9, 0, tx + 9, 0);
          gt.addColorStop(0, "rgba(66,66,88,.96)");
          gt.addColorStop(0.5, "rgba(36,36,52,.96)");
          gt.addColorStop(1, "rgba(18,18,28,.96)");
          ctx.fillStyle = gt;
          ctx.fillRect(tx - 9, base - altoTorre, 18, altoTorre);
          ctx.fillStyle = "rgba(14,14,24,.92)";
          for (var tv = 0; tv < 4; tv++) ctx.fillRect(tx - 14, base - altoTorre * (0.28 + tv * 0.2), 28, 6);
          var late = 0.3 + 0.7 * Math.abs(Math.sin(state.elapsed * 1.5));
          ctx.fillStyle = "rgba(255,70,70," + late.toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(tx, base - altoTorre - 5, 3.4, 0, Math.PI * 2); ctx.fill();
          luzPuntual(tx, base - altoTorre - 5, 30, "255,60,60", late * 0.7);
        });

        /* Tráfico cruzando el puente. Va a su propia velocidad y en los dos
           sentidos: es lo que hace que el puente esté vivo y no sea una
           maqueta. */
        for (var au = 0; au < 5; au++) {
          var dir = au % 2 ? 1 : -1;
          var largo = (x1 - x0) + 160;
          var t2 = ((state.elapsed * (56 + au * 13) + au * 173) % largo);
          var ax = dir > 0 ? (x0 - 80 + t2) : (x1 + 80 - t2);
          if (ax < -30 || ax > W + 30) continue;
          ctx.fillStyle = dir > 0 ? "rgba(255,230,170,.85)" : "rgba(255,90,80,.85)";
          ctx.fillRect(ax, tabla - 5, 7, 3);
          luzPuntual(ax + 3, tabla - 4, 26, dir > 0 ? "255,230,170" : "255,90,80", 0.5);
        }
      }

      motas(10, "rgba(160,180,220,.1)", 14, 1.4);
    }

    /* ---- 🎉 Fiesta ----
       La tarima con su parrilla de luces, los haces barriendo, pantallas a
       los costados, humo, confeti y el público saltando. */
    function drawTarima() {
      var base = groundY();
      var colores = ["255,80,140", "120,200,255", "255,212,0", "140,255,170", "190,120,255"];

      manzana(150, 0.12, 130, 70, "rgba(26,16,40,.55)", "rgba(190,140,255,.26)", 0.16, false, 22);
      bandaNeblina(150, 100, "180,120,255", 0.1);

      var altoTarima = 120;

      // el humo de la tarima, que es donde se apoyan los haces
      ctx.fillStyle = "rgba(200,160,255,.05)";
      for (var hm = 0; hm < 6; hm++) {
        var hx = ((state.elapsed * 12 + hm * 120) % (W + 260)) - 130;
        ctx.beginPath();
        ctx.ellipse(hx, base - altoTarima * 0.5 + Math.sin(state.elapsed * 0.5 + hm) * 12, 110, 46, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // los haces, desde la parrilla
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var h = 0; h < 6; h++) {
        var origen = W * (0.1 + h * 0.16);
        var ang = -Math.PI / 2 + Math.sin(state.elapsed * (0.6 + h * 0.17) + h * 1.3) * 0.85;
        var largo = base * 1.05;
        var oy = base - altoTarima + 6;
        var gh = ctx.createLinearGradient(origen, oy, origen + Math.cos(ang) * largo, oy + Math.sin(ang) * largo);
        gh.addColorStop(0, "rgba(" + colores[h % 5] + ",.26)");
        gh.addColorStop(0.6, "rgba(" + colores[h % 5] + ",.08)");
        gh.addColorStop(1, "rgba(" + colores[h % 5] + ",0)");
        ctx.fillStyle = gh;
        ctx.beginPath();
        ctx.moveTo(origen, oy);
        ctx.lineTo(origen + Math.cos(ang - 0.075) * largo, oy + Math.sin(ang - 0.075) * largo);
        ctx.lineTo(origen + Math.cos(ang + 0.075) * largo, oy + Math.sin(ang + 0.075) * largo);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // las pantallas de los costados, con barras que bailan
      [W * 0.08, W * 0.92].forEach(function (px, k) {
        var an = 74, al = 92;
        var top = base - altoTarima - al - 6;
        ctx.fillStyle = "rgba(10,8,18,.95)";
        ctx.fillRect(px - an / 2, top, an, al);
        for (var b = 0; b < 7; b++) {
          var h2 = (0.2 + 0.8 * Math.abs(Math.sin(state.elapsed * (3 + b * 0.6) + k * 2 + b))) * (al - 12);
          ctx.fillStyle = "rgba(" + colores[b % 5] + ",.8)";
          ctx.fillRect(px - an / 2 + 6 + b * 9, top + al - 6 - h2, 6, h2);
        }
        ctx.strokeStyle = "rgba(70,60,90,.9)"; ctx.lineWidth = 2;
        ctx.strokeRect(px - an / 2, top, an, al);
        ctx.lineWidth = 1;
      });

      // la estructura: parrilla arriba y torres de andamio
      ctx.fillStyle = "rgba(14,10,22,.95)";
      ctx.fillRect(0, base - altoTarima, W, 10);
      ctx.fillRect(0, base - altoTarima - 4, W, 3);
      for (var t = 0; t <= 5; t++) {
        var tx = W * (t / 5);
        ctx.fillRect(tx - 4, base - altoTarima, 8, altoTarima);
        // las cruces del andamio
        ctx.strokeStyle = "rgba(40,32,54,.9)"; ctx.lineWidth = 1.6;
        for (var cr = 0; cr < 4; cr++) {
          var cy = base - altoTarima + 14 + cr * (altoTarima / 4.4);
          ctx.beginPath();
          ctx.moveTo(tx - 4, cy); ctx.lineTo(tx + 4, cy + altoTarima / 4.4); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(tx + 4, cy); ctx.lineTo(tx - 4, cy + altoTarima / 4.4); ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // los focos colgados
      for (var fo = 0; fo < 12; fo++) {
        var fx = W * ((fo + 0.5) / 12);
        var pr = 0.4 + 0.6 * Math.abs(Math.sin(state.elapsed * 4.5 + fo * 0.9));
        ctx.fillStyle = "rgba(" + colores[fo % 5] + "," + pr.toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(fx, base - altoTarima + 15, 4, 0, Math.PI * 2); ctx.fill();
        luzPuntual(fx, base - altoTarima + 15, 40, colores[fo % 5], pr * 0.5);
      }

      // el público, de espaldas, saltando y con los brazos arriba
      capa(22, 0.42, function (x, i, s) {
        var salto = Math.abs(Math.sin(state.elapsed * (2.2 + s * 1.4) + i)) * 8;
        var alto = 30 + s * 14;
        ctx.fillStyle = "rgba(8,5,12,.88)";
        ctx.beginPath(); ctx.arc(x, base - alto - salto, 5 + s * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - 5, base - alto - salto + 4, 10, alto);
        // los brazos, algunos levantados
        if (az(i, 3) > 0.45) {
          ctx.lineWidth = 2.4; ctx.strokeStyle = "rgba(8,5,12,.88)";
          ctx.beginPath();
          ctx.moveTo(x - 4, base - alto - salto + 8);
          ctx.lineTo(x - 9, base - alto - salto - 8 - Math.sin(state.elapsed * 3 + i) * 3);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + 4, base - alto - salto + 8);
          ctx.lineTo(x + 9, base - alto - salto - 8 - Math.cos(state.elapsed * 3 + i) * 3);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }, 109);

      // confeti cayendo
      for (var cf = 0; cf < 30; cf++) {
        var cx2 = (az(cf, 11) * (W + 80)) - ((state.elapsed * 22 + cf * 37) % (W + 80)) + 40;
        var cy2 = ((state.elapsed * 74 + cf * 61) % (base + 40)) - 20;
        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(state.elapsed * 3 + cf);
        ctx.fillStyle = "rgba(" + colores[cf % 5] + ",.85)";
        ctx.fillRect(-2, -3.5, 4, 7);
        ctx.restore();
      }
    }

    /* ---- ⛈️ Tormenta ----
       Nubarrones en tres alturas, cerros apagados por el agua, pinos
       doblados por el viento, la cortina de lluvia y los charcos del piso. */
    function drawTormenta() {
      var base = groundY();

      // tres alturas de nubarrones, cada una más oscura y más rápida
      /* Cada capa en su franja, y con claros. Tapando todo el cielo el mapa
         quedaba en una sola mancha gris y no se veía que las nubes se movían
         a distinta velocidad, que es lo que da la sensación de tormenta. */
      [[0.08, 0.10, "150,158,186", 34, 20, 56],
       [0.18, 0.16, "96,102,130", 44, 62, 40],
       [0.32, 0.22, "52,56,78", 54, 108, 26]]
        .forEach(function (cfg, k) {
          capa(200, cfg[0], function (x, i, s) {
            if (s < 0.24) return;
            nubeVolumen(x, cfg[4] + s * cfg[5], cfg[3] * (0.55 + s * 0.6), cfg[2], cfg[1], "34,36,52");
          }, 20 - k * 2);
        });

      cordillera(220, 0.11, 130, 86, "rgba(34,40,54,.55)", 20);
      bandaNeblina(160, 110, "140,155,185", 0.18);
      cordillera(160, 0.2, 96, 60, "rgba(24,30,42,.7)", 22);

      /* Los pinos doblados. El viento se ve porque TODOS se doblan para el
         mismo lado y al mismo compás, no cada uno por su cuenta. */
      var racha = Math.sin(state.elapsed * 0.9) * 0.10 + 0.1;
      capa(76, 0.36, function (x, i, s) {
        var h = 108 + s * 60;
        ctx.save();
        ctx.translate(x, base);
        ctx.rotate(racha + Math.sin(state.elapsed * 2.2 + i) * 0.025);
        ctx.fillStyle = "rgba(22,28,34,.86)";
        ctx.fillRect(-3, -h * 0.42, 6, h * 0.42);
        ctx.fillStyle = "rgba(24,44,46,.86)";
        for (var n = 0; n < 3; n++) {
          var an = (h * 0.32) * (1 - n * 0.24);
          var y = -h * 0.34 - n * h * 0.2;
          ctx.beginPath();
          ctx.moveTo(-an, y); ctx.lineTo(0, y - h * 0.3); ctx.lineTo(an, y);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }, 28);

      // la maleza, doblada por la misma racha
      ctx.strokeStyle = "rgba(30,46,44,.8)";
      ctx.lineWidth = 1.8;
      capa(34, 0.8, function (x, i, s) {
        var h = 14 + s * 14;
        var dobla = racha * 60 + Math.sin(state.elapsed * 3 + i) * 4;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + dobla * 0.4, base - h * 0.6, x + dobla, base - h);
        ctx.stroke();
      }, 135);
      ctx.lineWidth = 1;

      /* La cortina de agua: gotas largas, todas con la misma inclinación que
         el viento. Es lo que da la sensación de estar adentro del aguacero. */
      ctx.save();
      ctx.strokeStyle = "rgba(185,210,240,.15)";
      ctx.lineWidth = 1.1;
      for (var g = 0; g < 90; g++) {
        var gx = (az(g, 3) * (W + 160)) - ((state.elapsed * 380 + g * 23) % (W + 160)) + 80;
        var gy = ((state.elapsed * 1150 + g * 67) % (base + 70)) - 40;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx - 7, gy + 26);
        ctx.stroke();
      }
      ctx.restore();

      // los charcos y las salpicaduras del piso
      ctx.fillStyle = "rgba(150,180,215,.14)";
      for (var ch = 0; ch < 12; ch++) {
        /* Los charcos están en el piso, así que van al ritmo del piso.
           Con el contador de los cerros quedaban casi quietos mientras el
           camino pasaba de largo por debajo. */
        var px = ((az(ch, 7) * W * 2) - state.bgScroll * 0.94) % (W + 120);
        if (px < -60) px += W + 120;
        ctx.beginPath();
        ctx.ellipse(px, base - 3, 16 + az(ch, 2) * 14, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(200,220,245,.25)";
      for (var sp = 0; sp < 14; sp++) {
        var spx = az(sp, 13) * W;
        var fase = (state.elapsed * 3 + sp * 0.7) % 1;
        ctx.beginPath();
        ctx.arc(spx, base - 2, fase * 9, Math.PI, 0);
        ctx.stroke();
      }
    }

    /* ---- 🎃 Halloween: Pueblo de Calabazas ----
       El pueblo torcido: nada tiene ángulos rectos, las ventanas laten como
       si adentro hubiera una vela, hay calabazas encendidas en cada puerta y
       murciélagos cruzando delante de la luna. */
    function drawPuebloHalloween() {
      var base = groundY();

      cordillera(240, 0.08, 138, 90, "rgba(42,26,50,.5)", 20);
      bandaNeblina(170, 110, "180,140,200", 0.13);
      arboleda(126, 0.2, 122, 60, "rgba(30,20,30,.6)", "rgba(38,26,42,.6)", false, 24);

      // la torre de la iglesia, que se ve de lejos
      capa(430, 0.28, function (x, i, s) {
        var al = 190 + s * 60;
        ctx.fillStyle = "rgba(30,20,34,.9)";
        ctx.fillRect(x, base - al, 40, al);
        ctx.beginPath();
        ctx.moveTo(x - 8, base - al); ctx.lineTo(x + 20, base - al - 52); ctx.lineTo(x + 48, base - al);
        ctx.closePath(); ctx.fill();
        // el reloj, encendido
        var late = 0.5 + 0.5 * Math.sin(state.elapsed * 1.3 + i);
        ctx.fillStyle = "rgba(255,190,90," + (0.35 + late * 0.4).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(x + 20, base - al * 0.82, 9, 0, Math.PI * 2); ctx.fill();
        luzPuntual(x + 20, base - al * 0.82, 40, "255,180,70", late * 0.5);
      }, 12);

      bandaNeblina(110, 90, "170,130,190", 0.14);

      // las casas torcidas, cada una con su inclinación
      capa(104, 0.46, function (x, i, s) {
        var an = 52 + s * 30, al = 74 + s * 46;
        var top = base - al;
        ctx.save();
        ctx.translate(x + an / 2, base);
        ctx.rotate((az(i, 5) - 0.5) * 0.10);
        ctx.translate(-an / 2, -base);

        ctx.fillStyle = "rgba(26,17,30,.96)";
        ctx.fillRect(0, top, an, al);
        // el techo, también torcido para su lado
        ctx.beginPath();
        ctx.moveTo(-9, top);
        ctx.lineTo(an * (0.4 + az(i, 2) * 0.24), top - 30 - s * 12);
        ctx.lineTo(an + 9, top);
        ctx.closePath(); ctx.fill();
        // las tejas
        ctx.strokeStyle = "rgba(46,32,50,.8)"; ctx.lineWidth = 1;
        for (var tj = 1; tj < 4; tj++) {
          ctx.beginPath();
          ctx.moveTo(-9 + tj * 3, top - tj * 7); ctx.lineTo(an + 9 - tj * 3, top - tj * 7);
          ctx.stroke();
        }

        // las ventanas, latiendo como una vela adentro
        var vela = 0.5 + 0.5 * Math.sin(state.elapsed * 2.6 + i * 1.7) * Math.sin(state.elapsed * 5.1 + i);
        var alfa = (0.45 + vela * 0.45).toFixed(2);
        [[0.16, 0.2], [0.58, 0.2], [0.34, 0.56]].forEach(function (v, k) {
          if (az(i, k + 6) > 0.78) return;
          var vx = an * v[0], vy = top + al * v[1];
          ctx.fillStyle = "rgba(255,150,45," + alfa + ")";
          ctx.fillRect(vx, vy, an * 0.24, al * 0.19);
          // la cruz del marco
          ctx.strokeStyle = "rgba(20,12,22,.9)";
          ctx.beginPath();
          ctx.moveTo(vx + an * 0.12, vy); ctx.lineTo(vx + an * 0.12, vy + al * 0.19);
          ctx.moveTo(vx, vy + al * 0.095); ctx.lineTo(vx + an * 0.24, vy + al * 0.095);
          ctx.stroke();
        });
        ctx.restore();
        luzPuntual(x + an / 2, top + al * 0.4, 60, "255,150,50", 0.35);
      }, 26);

      // las calabazas de las puertas
      capa(120, 0.68, function (x, i, s) {
        if (s < 0.42) return;
        var late = 0.6 + 0.4 * Math.sin(state.elapsed * 3.4 + i * 2.1);
        var r = 10 + s * 5;
        // el cuerpo, con sus gajos
        ctx.fillStyle = "rgba(214,108,26,.95)";
        ctx.beginPath(); ctx.ellipse(x, base - r * 0.85, r, r * 0.86, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(160,74,16,.7)"; ctx.lineWidth = 1;
        for (var gj = -1; gj <= 1; gj++) {
          ctx.beginPath();
          ctx.ellipse(x, base - r * 0.85, r * (0.32 + Math.abs(gj) * 0.3), r * 0.86, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(60,110,40,.9)";
        ctx.fillRect(x - 1.5, base - r * 1.85, 3, 6);
        // la cara encendida
        ctx.fillStyle = "rgba(255,232,130," + late.toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, base - r * 1.1); ctx.lineTo(x - r * 0.12, base - r * 0.72);
        ctx.lineTo(x - r * 0.76, base - r * 0.72); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.5, base - r * 1.1); ctx.lineTo(x + r * 0.76, base - r * 0.72);
        ctx.lineTo(x + r * 0.12, base - r * 0.72); ctx.closePath(); ctx.fill();
        ctx.fillRect(x - r * 0.55, base - r * 0.52, r * 1.1, 3);
        luzPuntual(x, base - r, 46, "255,170,50", late * 0.8);
      }, 33);

      bandada(9, "rgba(16,10,20,.85)", 46, 250, 34, "murcielago");
      maleza(42, 0.92, 20, "rgba(44,32,44,.8)", 125);
      motas(14, "rgba(200,160,220,.12)", 16, 1.8);
    }

    /* ---- ⚰️ Cementerio ----
       Lápidas en tres profundidades, cruces torcidas, rejas, la niebla baja
       arrastrándose, y luces fatuas que flotan entre las tumbas. */
    function drawCementerio() {
      var base = groundY();

      cordillera(250, 0.07, 132, 84, "rgba(38,34,50,.44)", 18);
      bandaNeblina(180, 110, "150,150,180", 0.14);
      arboleda(140, 0.18, 132, 62, "rgba(28,24,34,.6)", "rgba(32,28,40,.6)", false, 22);

      /** Una lápida. `tipo` cambia entre losa, cruz y obelisco: con una sola
       *  forma repetida el cementerio parece un teclado. */
      function lapida(x, alto, an, color, tipo, semilla) {
        ctx.fillStyle = color;
        ctx.save();
        ctx.translate(x, base);
        ctx.rotate((az(semilla, 3) - 0.5) * 0.16);     // torcidas, que es lo que las hace viejas
        if (tipo === 0) {
          ctx.beginPath();
          ctx.moveTo(-an / 2, 0); ctx.lineTo(-an / 2, -alto + an / 2);
          ctx.arc(0, -alto + an / 2, an / 2, Math.PI, 0);
          ctx.lineTo(an / 2, 0); ctx.closePath(); ctx.fill();
        } else if (tipo === 1) {
          ctx.fillRect(-an * 0.18, -alto, an * 0.36, alto);
          ctx.fillRect(-an * 0.55, -alto * 0.76, an * 1.1, an * 0.32);
        } else {
          ctx.beginPath();
          ctx.moveTo(-an / 2, 0); ctx.lineTo(-an * 0.34, -alto);
          ctx.lineTo(an * 0.34, -alto); ctx.lineTo(an / 2, 0);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }

      capa(96, 0.26, function (x, i, s) {
        lapida(x, 34 + s * 20, 22 + s * 10, "rgba(58,56,68,.55)", Math.floor(az(i, 2) * 3), i);
      }, 28);
      bandaNeblina(112, 84, "160,160,190", 0.16);
      capa(76, 0.48, function (x, i, s) {
        lapida(x, 46 + s * 30, 28 + s * 14, "rgba(78,76,90,.85)", Math.floor(az(i, 5) * 3), i + 20);
      }, 36);

      // la reja de hierro, delante de las tumbas
      capa(20, 0.7, function (x, i, s) {
        ctx.fillStyle = "rgba(20,18,26,.85)";
        ctx.fillRect(x, base - 40, 2.5, 40);
        ctx.beginPath(); ctx.arc(x + 1.2, base - 42, 2.4, 0, Math.PI * 2); ctx.fill();
        if (i % 6 === 0) ctx.fillRect(x - 2, base - 52, 6, 52);   // el poste cada tantos barrotes
      }, 200);
      ctx.fillStyle = "rgba(20,18,26,.85)";
      ctx.fillRect(0, base - 30, W, 2.5);

      /* Luces fatuas: flotan entre las tumbas, suben y bajan y se apagan de a
         ratos. Es lo que hace que el cementerio se vea embrujado y no solo
         oscuro. */
      for (var f = 0; f < 7; f++) {
        var fx = ((az(f, 13) * (W + 200)) - ((state.elapsed * 11 * (0.5 + az(f, 2)) + f * 97) % (W + 200))) + 100;
        var fy = base - 30 - Math.abs(Math.sin(state.elapsed * 0.5 + f * 1.3)) * 90;
        var vivo = 0.35 + 0.65 * Math.abs(Math.sin(state.elapsed * 0.9 + f * 2.2));
        ctx.fillStyle = "rgba(160,255,210," + (vivo * 0.8).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(fx, fy, 2.4, 0, Math.PI * 2); ctx.fill();
        luzPuntual(fx, fy, 34, "120,255,190", vivo * 0.6);
      }

      // la niebla que se arrastra por el piso
      ctx.fillStyle = "rgba(190,200,215,.10)";
      for (var nb = 0; nb < 7; nb++) {
        var nx = ((state.elapsed * 9 + nb * 130) % (W + 300)) - 150;
        ctx.beginPath();
        ctx.ellipse(nx, base - 6 + Math.sin(state.elapsed * 0.6 + nb) * 3, 90, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      bandada(5, "rgba(14,12,18,.75)", 60, 190, 26, "murcielago");
      motas(16, "rgba(180,190,210,.13)", 12, 2);
    }

    /* ---- 🏚️ Casa Embrujada ----
       Adentro: el zócalo de madera, el empapelado despegado, los cuadros
       que siguen con la mirada, candelabros que gotean y la escalera. */
    function drawCasona() {
      var base = groundY();

      // la pared: empapelado con su franja y su moldura
      var g = ctx.createLinearGradient(0, base - 320, 0, base);
      g.addColorStop(0, "rgba(38,24,26,.96)");
      g.addColorStop(0.55, "rgba(58,36,34,.96)");
      g.addColorStop(1, "rgba(34,22,24,.96)");
      ctx.fillStyle = g;
      ctx.fillRect(0, base - 320, W, 320);

      // las rayas del empapelado
      ctx.fillStyle = "rgba(90,58,50,.22)";
      capa(26, 0.5, function (x) { ctx.fillRect(x, base - 320, 9, 320); }, 110);
      // la moldura y el zócalo
      ctx.fillStyle = "rgba(70,44,36,.9)";
      ctx.fillRect(0, base - 216, W, 7);
      ctx.fillStyle = "rgba(46,28,24,.95)";
      ctx.fillRect(0, base - 46, W, 46);
      ctx.fillStyle = "rgba(84,52,40,.7)";
      ctx.fillRect(0, base - 46, W, 3);

      /* El empapelado despegado. Tiras que cuelgan y se mecen: es el detalle
         que dice "abandonada" sin tener que dibujar telarañas por todos
         lados. */
      capa(178, 0.5, function (x, i, s) {
        if (s < 0.42) return;
        var largo = 40 + s * 60;
        var arriba = base - 216 + 7;
        var mece = Math.sin(state.elapsed * 0.8 + i) * 5;
        ctx.fillStyle = "rgba(24,16,18,.9)";
        ctx.beginPath();
        ctx.moveTo(x, arriba);
        ctx.quadraticCurveTo(x + 8 + mece, arriba + largo * 0.6, x + 3 + mece, arriba + largo);
        ctx.lineTo(x + 20 + mece, arriba + largo - 6);
        ctx.quadraticCurveTo(x + 24, arriba + largo * 0.5, x + 22, arriba);
        ctx.closePath(); ctx.fill();
      }, 24);

      // los cuadros, con los ojos siguiendo al jugador
      capa(160, 0.5, function (x, i, s) {
        var an = 46 + s * 22, al = 60 + s * 26;
        var top = base - 176 - s * 22;
        ctx.fillStyle = "rgba(96,66,30,.95)";
        ctx.fillRect(x - 4, top - 4, an + 8, al + 8);
        ctx.fillStyle = "rgba(128,92,44,.9)";
        ctx.fillRect(x - 2, top - 2, an + 4, al + 4);
        ctx.fillStyle = "rgba(22,16,20,.96)";
        ctx.fillRect(x, top, an, al);
        // la figura del retrato
        ctx.fillStyle = "rgba(52,40,44,.9)";
        ctx.beginPath(); ctx.arc(x + an / 2, top + al * 0.34, an * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + an * 0.18, top + al); ctx.lineTo(x + an * 0.3, top + al * 0.52);
        ctx.lineTo(x + an * 0.7, top + al * 0.52); ctx.lineTo(x + an * 0.82, top + al);
        ctx.closePath(); ctx.fill();
        /* Los ojos apuntan al personaje. Es barato y es lo único que hace
           que un cuadro dé impresión. */
        var haciaX = Math.max(-1, Math.min(1, (W * CHAR_X_RATIO - (x + an / 2)) / 120));
        ctx.fillStyle = "rgba(255,236,180,.9)";
        ctx.beginPath(); ctx.arc(x + an / 2 - an * 0.09 + haciaX * 2, top + al * 0.32, 1.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + an / 2 + an * 0.09 + haciaX * 2, top + al * 0.32, 1.7, 0, Math.PI * 2); ctx.fill();
      }, 22);

      // los candelabros de pared
      capa(132, 0.66, function (x, i, s) {
        if (s < 0.4) return;
        var y = base - 132;
        ctx.fillStyle = "rgba(88,66,34,.95)";
        ctx.fillRect(x - 8, y, 16, 4);
        ctx.fillRect(x - 1.5, y, 3, 12);
        for (var v = -1; v <= 1; v++) {
          var vx = x + v * 7;
          ctx.fillStyle = "rgba(228,220,196,.9)";
          ctx.fillRect(vx - 1.5, y - 13, 3, 13);
          var llama = 0.6 + 0.4 * Math.sin(state.elapsed * 7 + i + v * 2);
          ctx.fillStyle = "rgba(255,196,80," + llama.toFixed(2) + ")";
          ctx.beginPath();
          ctx.ellipse(vx + Math.sin(state.elapsed * 5 + v) * 0.8, y - 17, 2, 4.4 * llama, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        luzPuntual(x, y - 14, 74, "255,180,80", 0.7);
      }, 29);

      // la escalera del fondo, cada tanto
      capa(560, 0.5, function (x, i, s) {
        ctx.fillStyle = "rgba(28,18,20,.95)";
        for (var e = 0; e < 9; e++) {
          ctx.fillRect(x + e * 16, base - 46 - e * 13, 18, 13);
          ctx.fillStyle = "rgba(56,36,32,.9)";
          ctx.fillRect(x + e * 16, base - 46 - e * 13, 18, 3);
          ctx.fillStyle = "rgba(28,18,20,.95)";
        }
        ctx.strokeStyle = "rgba(74,48,36,.9)"; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, base - 74); ctx.lineTo(x + 9 * 16, base - 74 - 8 * 13); ctx.stroke();
        ctx.lineWidth = 1;
      }, 10);

      motas(20, "rgba(210,190,160,.14)", 9, 1.7);
    }

    /* ---- 🎄 Navidad: Pueblo Nevado ----
       El pueblo bajo la nieve: montañas al fondo, pinos nevados, casas con
       humo y guirnaldas, el árbol de la plaza, y la nieve acumulada. */
    function drawPuebloNevado() {
      var base = groundY();
      var luces = state.esc.luces || ["255,80,80", "90,220,120", "255,212,0"];

      cordillera(250, 0.07, 156, 96, "rgba(126,148,182,.34)", 20);
      bandaNeblina(200, 120, "225,240,255", 0.18);
      cordillera(180, 0.14, 118, 74, "rgba(96,118,152,.46)", 22);
      arboleda(104, 0.24, 108, 54, "rgba(44,52,64,.68)", "rgba(36,66,64,.7)", true, 26);
      bandaNeblina(130, 90, "220,238,255", 0.15);

      // el árbol de la plaza, con sus luces de colores
      capa(470, 0.36, function (x, i, s) {
        var al = 150 + s * 40;
        ctx.fillStyle = "rgba(30,52,44,.95)";
        for (var n = 0; n < 4; n++) {
          var an = (al * 0.3) * (1 - n * 0.2);
          var y = base - al * 0.24 - n * al * 0.19;
          ctx.beginPath();
          ctx.moveTo(x - an, y); ctx.lineTo(x, y - al * 0.28); ctx.lineTo(x + an, y);
          ctx.closePath(); ctx.fill();
        }
        // las luces en espiral
        for (var lz = 0; lz < 22; lz++) {
          var t = lz / 22;
          var lx = x + Math.sin(lz * 1.5) * (al * 0.28) * (1 - t);
          var ly = base - al * 0.2 - t * al * 0.72;
          var brilla = 0.4 + 0.6 * Math.abs(Math.sin(state.elapsed * 2.4 + lz * 0.8));
          ctx.fillStyle = "rgba(" + luces[lz % luces.length] + "," + brilla.toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        // la estrella de la punta
        var est = 0.6 + 0.4 * Math.sin(state.elapsed * 1.8);
        ctx.fillStyle = "rgba(255,235,150," + est.toFixed(2) + ")";
        ctx.beginPath();
        for (var p = 0; p < 10; p++) {
          var ang = -Math.PI / 2 + p * Math.PI / 5;
          var rr = p % 2 ? 3 : 8;
          var px = x + Math.cos(ang) * rr, py = base - al * 0.98 + Math.sin(ang) * rr;
          if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
        luzPuntual(x, base - al * 0.6, 120, "255,220,150", 0.55);
      }, 10);

      // las casas del pueblo
      capa(114, 0.5, function (x, i, s) {
        var an = 62 + s * 30, al = 54 + s * 30;
        var top = base - al;
        ctx.fillStyle = "rgba(52,42,58,.96)";
        ctx.fillRect(x, top, an, al);
        // las vigas de la fachada
        ctx.fillStyle = "rgba(70,52,44,.7)";
        ctx.fillRect(x, top + al * 0.5, an, 3);
        ctx.fillRect(x + an * 0.46, top, 3, al);
        // el techo con su nieve
        ctx.fillStyle = "rgba(36,28,42,.96)";
        ctx.beginPath();
        ctx.moveTo(x - 8, top); ctx.lineTo(x + an / 2, top - 28); ctx.lineTo(x + an + 8, top);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(240,248,255,.94)";
        ctx.beginPath();
        ctx.moveTo(x - 8, top); ctx.lineTo(x + an / 2, top - 28); ctx.lineTo(x + an + 8, top);
        ctx.lineTo(x + an + 3, top + 5); ctx.lineTo(x + an / 2, top - 21); ctx.lineTo(x - 3, top + 5);
        ctx.closePath(); ctx.fill();
        // los carámbanos del alero
        ctx.fillStyle = "rgba(220,240,255,.8)";
        for (var cb = 0; cb < 6; cb++) {
          var cx2 = x - 2 + cb * (an / 5.5);
          ctx.beginPath();
          ctx.moveTo(cx2, top + 4); ctx.lineTo(cx2 + 2, top + 4);
          ctx.lineTo(cx2 + 1, top + 8 + az(i, cb) * 9); ctx.closePath(); ctx.fill();
        }

        // la ventana encendida y la puerta
        ctx.fillStyle = "rgba(255,206,124,.9)";
        ctx.fillRect(x + an * 0.12, top + al * 0.28, an * 0.26, al * 0.28);
        ctx.fillRect(x + an * 0.62, top + al * 0.28, an * 0.26, al * 0.28);
        ctx.fillStyle = "rgba(96,54,40,.95)";
        ctx.fillRect(x + an * 0.38, top + al * 0.55, an * 0.24, al * 0.45);
        luzPuntual(x + an / 2, top + al * 0.4, 70, "255,200,120", 0.5);

        // la chimenea y su humo
        ctx.fillStyle = "rgba(46,36,50,.96)";
        ctx.fillRect(x + an * 0.74, top - 32, 10, 20);
        ctx.fillStyle = "rgba(238,244,252,.9)";
        ctx.fillRect(x + an * 0.72, top - 34, 14, 4);
        ctx.fillStyle = "rgba(226,232,242,.15)";
        for (var hu = 0; hu < 5; hu++) {
          var sube = (state.elapsed * 13 + hu * 13 + i * 11) % 66;
          ctx.beginPath();
          ctx.arc(x + an * 0.79 + Math.sin(sube / 12 + i) * 8, top - 38 - sube, 3.5 + sube / 10, 0, Math.PI * 2);
          ctx.fill();
        }

        // la guirnalda del alero
        for (var gz = 0; gz < 6; gz++) {
          var brilla = 0.45 + 0.55 * Math.abs(Math.sin(state.elapsed * 2 + i + gz));
          ctx.fillStyle = "rgba(" + luces[(i + gz) % luces.length] + "," + brilla.toFixed(2) + ")";
          ctx.beginPath();
          ctx.arc(x + 4 + gz * (an / 6), top + 6 + Math.sin(gz * 1.2) * 3, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }, 26);

      // muñecos de nieve y montículos al frente
      capa(210, 0.74, function (x, i, s) {
        if (s < 0.55) return;
        ctx.fillStyle = "rgba(244,250,255,.95)";
        ctx.beginPath(); ctx.arc(x, base - 9, 9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, base - 22, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, base - 32, 5.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(30,26,34,.9)";
        ctx.fillRect(x - 6, base - 39, 12, 3);
        ctx.fillRect(x - 4, base - 45, 8, 6);
        ctx.beginPath(); ctx.arc(x - 2, base - 33, 1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 2, base - 33, 1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(230,120,40,.95)";
        ctx.beginPath();
        ctx.moveTo(x, base - 31); ctx.lineTo(x + 7, base - 30); ctx.lineTo(x, base - 29);
        ctx.closePath(); ctx.fill();
      }, 21);
    }

    /* ---- 🧸 Taller de Santa ----
       Adentro del taller: engranajes girando en la pared, cintas
       transportadoras con regalos, estanterías y las lámparas colgando. */
    function drawTaller() {
      var base = groundY();

      // la pared de tablones
      var g = ctx.createLinearGradient(0, base - 300, 0, base);
      g.addColorStop(0, "rgba(52,32,26,.96)");
      g.addColorStop(1, "rgba(74,46,34,.96)");
      ctx.fillStyle = g;
      ctx.fillRect(0, base - 300, W, 300);
      ctx.fillStyle = "rgba(38,24,20,.5)";
      capa(38, 0.28, function (x) { ctx.fillRect(x, base - 300, 2.5, 300); }, 50);
      for (var tb = 0; tb < 6; tb++) ctx.fillRect(0, base - 300 + tb * 50, W, 2);

      // los engranajes de la pared, girando de a pares y en sentido opuesto
      capa(150, 0.3, function (x, i, s) {
        var r = 22 + s * 20;
        var y = base - 200 - s * 60;
        var giro = state.elapsed * (0.5 + s * 0.5) * (i % 2 ? -1 : 1);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(giro);
        ctx.fillStyle = "rgba(122,86,44,.85)";
        for (var d = 0; d < 10; d++) {
          ctx.save(); ctx.rotate((d / 10) * Math.PI * 2);
          ctx.fillRect(-r * 0.14, -r - r * 0.22, r * 0.28, r * 0.3);
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(64,42,24,.9)";
        ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }, 22);

      // la estantería con cajas
      capa(120, 0.44, function (x, i, s) {
        var top = base - 150;
        ctx.fillStyle = "rgba(58,36,26,.95)";
        ctx.fillRect(x, top, 106, 5);
        ctx.fillRect(x, top + 46, 106, 5);
        var colores = ["205,58,58", "56,158,88", "212,176,60", "76,120,200"];
        for (var c = 0; c < 4; c++) {
          if (az(i, c) > 0.8) continue;
          var cw = 18 + az(i, c + 4) * 8;
          ctx.fillStyle = "rgba(" + colores[(i + c) % 4] + ",.9)";
          ctx.fillRect(x + 4 + c * 26, top - 20, cw, 20);
          ctx.fillStyle = "rgba(255,238,190,.85)";
          ctx.fillRect(x + 4 + c * 26 + cw * 0.42, top - 20, 3, 20);
        }
      }, 22);

      /* La cinta transportadora, con los regalos avanzando por su cuenta.
         Va a su propia velocidad: si se moviera con el escenario, parecería
         pintada en la pared. */
      (function () {
        var cy = base - 62;
        ctx.fillStyle = "rgba(38,26,22,.96)";
        ctx.fillRect(0, cy, W, 13);
        ctx.fillStyle = "rgba(70,50,38,.9)";
        var paso = 18, off = (state.elapsed * 52) % paso;
        for (var r = -paso; r < W + paso; r += paso) ctx.fillRect(r + off, cy, 3, 13);
        // los rodillos de abajo
        ctx.fillStyle = "rgba(96,70,44,.8)";
        for (var rr = 0; rr < W; rr += 44) {
          ctx.beginPath(); ctx.arc(rr + 22, cy + 16, 5, 0, Math.PI * 2); ctx.fill();
        }
        // los regalos
        var colores = ["205,58,58", "56,158,88", "212,176,60", "76,120,200", "180,90,190"];
        for (var p = 0; p < 8; p++) {
          var px = ((state.elapsed * 52 + p * 118) % (W + 160)) - 80;
          var an = 20 + az(p, 3) * 14, al = 16 + az(p, 5) * 12;
          ctx.fillStyle = "rgba(" + colores[p % 5] + ",.95)";
          ctx.fillRect(px, cy - al, an, al);
          ctx.fillStyle = "rgba(255,240,200,.9)";
          ctx.fillRect(px + an * 0.4, cy - al, 4, al);
          ctx.fillRect(px, cy - al * 0.55, an, 3);
          // el moño
          ctx.beginPath();
          ctx.arc(px + an * 0.4 + 2, cy - al - 3, 3.4, 0, Math.PI * 2); ctx.fill();
        }
      })();

      // las lámparas colgando del techo
      capa(146, 0.5, function (x, i, s) {
        var largo = 40 + s * 34;
        ctx.strokeStyle = "rgba(30,20,16,.9)"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, largo); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(96,70,40,.95)";
        ctx.beginPath();
        ctx.moveTo(x - 15, largo + 14); ctx.lineTo(x - 5, largo);
        ctx.lineTo(x + 5, largo); ctx.lineTo(x + 15, largo + 14);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,226,160,.95)";
        ctx.beginPath(); ctx.arc(x, largo + 15, 4.4, 0, Math.PI * 2); ctx.fill();
        luzPuntual(x, largo + 18, 96, "255,210,140", 0.75);
      }, 20);

      motas(14, "rgba(255,225,180,.14)", 11, 1.6);
    }

    /* ---- 🌿 Selva del Putumayo ----
       Cinco planos: montañas con bruma, la masa de selva, árboles gigantes
       con sus raíces tabla, helechos al frente y luciérnagas entre medio.
       Rayos de sol bajando entre las copas. */
    function drawSelva() {
      var base = groundY();

      // 1. las montañas del fondo, casi disueltas
      cordillera(230, 0.10, 156, 96, "rgba(48,92,74,.42)", 20);
      bandaNeblina(200, 120, "190,225,200", 0.20);
      cordillera(170, 0.17, 122, 70, "rgba(34,76,56,.55)", 22);
      bandaNeblina(150, 100, "175,215,190", 0.16);

      /* 2. La masa de selva: copas irregulares en UN solo trazo, para que el
            alpha no se acumule donde se cruzan y se vea una mancha. */
      ctx.fillStyle = "rgba(24,62,40,.88)";
      ctx.beginPath();
      capa(78, 0.32, function (x, i, s) {
        var h = 108 + s * 70;
        var r = 34 + s * 20;
        ctx.moveTo(x + r, base - h);
        ctx.arc(x, base - h, r, 0, Math.PI * 2);
        ctx.moveTo(x + r * 1.6, base - h * 0.74);
        ctx.arc(x + r * 0.85, base - h * 0.74, r * 0.8, 0, Math.PI * 2);
        ctx.moveTo(x - r * 0.5, base - h * 0.68);
        ctx.arc(x - r * 1.15, base - h * 0.68, r * 0.72, 0, Math.PI * 2);
      }, 28);
      ctx.fill();

      // 3. los rayos de sol que se cuelan entre las copas
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var ry = 0; ry < 4; ry++) {
        var rx = W * (0.15 + ry * 0.25) + Math.sin(state.elapsed * 0.2 + ry) * 26;
        var g = ctx.createLinearGradient(rx, base - 230, rx + 40, base);
        g.addColorStop(0, "rgba(215,255,190,.13)");
        g.addColorStop(1, "rgba(215,255,190,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(rx - 16, base - 230); ctx.lineTo(rx + 16, base - 230);
        ctx.lineTo(rx + 62, base); ctx.lineTo(rx + 14, base);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // 4. los árboles gigantes, con raíces tabla y bejucos
      capa(148, 0.52, function (x, i, s) {
        var h = 250 + s * 90;
        // el tronco, que se ensancha abajo
        ctx.fillStyle = "rgba(30,44,32,.95)";
        ctx.beginPath();
        ctx.moveTo(x - 7, base - h);
        ctx.lineTo(x + 7, base - h);
        ctx.lineTo(x + 13, base);
        ctx.lineTo(x - 13, base);
        ctx.closePath(); ctx.fill();
        // las raíces tabla
        for (var rz = -1; rz <= 1; rz += 2) {
          ctx.beginPath();
          ctx.moveTo(x + rz * 10, base - 44);
          ctx.quadraticCurveTo(x + rz * 20, base - 20, x + rz * 32, base);
          ctx.lineTo(x + rz * 12, base);
          ctx.closePath(); ctx.fill();
        }
        // las copas de arriba
        follaje(x, base - h - 6, 42 + s * 16, "rgba(20,54,34,.95)", i);
        follaje(x - 34, base - h + 20, 28 + s * 10, "rgba(26,64,40,.92)", i + 5);
        follaje(x + 34, base - h + 16, 30 + s * 11, "rgba(18,50,32,.94)", i + 11);
        // los bejucos colgando de las ramas
        ctx.strokeStyle = "rgba(34,74,44,.7)";
        ctx.lineWidth = 2;
        for (var bj = -1; bj <= 1; bj++) {
          var bx = x + bj * 30;
          var largo = 50 + az(i, bj + 4) * 80;
          ctx.beginPath();
          ctx.moveTo(bx, base - h + 14);
          ctx.quadraticCurveTo(bx + Math.sin(state.elapsed * 0.6 + i + bj) * 9, base - h + 14 + largo * 0.6,
                               bx + 4, base - h + 14 + largo);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }, 22);

      // 5. los helechos del primer plano
      capa(64, 0.82, function (x, i, s) {
        if (s < 0.3) return;
        var alto = 34 + s * 40;
        ctx.strokeStyle = "rgba(16,44,26,.95)";
        ctx.lineWidth = 2.2;
        for (var hj = 0; hj < 5; hj++) {
          var ang = -Math.PI / 2 + (hj - 2) * 0.4;
          var mece = Math.sin(state.elapsed * 1.3 + i + hj) * 3;
          ctx.beginPath();
          ctx.moveTo(x, base);
          ctx.quadraticCurveTo(x + Math.cos(ang) * alto * 0.5, base + Math.sin(ang) * alto * 0.75,
                               x + Math.cos(ang) * alto + mece, base + Math.sin(ang) * alto * 0.9);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }, 74);

      // 6. las luciérnagas, que es lo que hace que la selva se vea viva
      for (var lu = 0; lu < 14; lu++) {
        var lx = ((az(lu, 19) * (W + 200)) - ((state.elapsed * 13 * (0.4 + az(lu, 3)) + lu * 89) % (W + 200))) + 100;
        var ly = base - 20 - Math.abs(Math.sin(state.elapsed * 0.6 + lu * 1.4)) * 140;
        var vivo = Math.abs(Math.sin(state.elapsed * 1.6 + lu * 2.1));
        if (vivo < 0.25) continue;
        ctx.fillStyle = "rgba(215,255,140," + (vivo * 0.9).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(lx, ly, 1.8, 0, Math.PI * 2); ctx.fill();
        luzPuntual(lx, ly, 20, "190,255,120", vivo * 0.5);
      }

      motas(16, "rgba(220,255,200,.12)", 10, 1.8);
    }

    /* ---- 🏞️ El Río ----
       El cañón: paredes de roca a los dos lados, cascadas de distinta altura
       con su bruma, garzas cruzando, juncos y piedras en el agua. */
    function drawRio() {
      var base = groundY();

      cordillera(240, 0.09, 180, 104, "rgba(44,100,110,.5)", 20);
      bandaNeblina(210, 120, "195,240,246", 0.22);
      cordillera(175, 0.17, 142, 78, "rgba(30,78,90,.66)", 22);

      /* Las cascadas: son el mapa. Tres tamaños, con hilos que bajan de
         verdad y bruma donde revientan. */
      capa(196, 0.28, function (x, i, s) {
        if (s < 0.3) return;
        var alto = 92 + s * 96;
        var an = 12 + s * 20;
        var arriba = base - alto;

        // el corte de roca de donde sale
        ctx.fillStyle = "rgba(22,60,70,.85)";
        ctx.fillRect(x - 10, arriba - 10, an + 20, 12);

        var g = ctx.createLinearGradient(0, arriba, 0, base);
        g.addColorStop(0, "rgba(228,250,255,.62)");
        g.addColorStop(0.6, "rgba(180,232,244,.36)");
        g.addColorStop(1, "rgba(150,215,230,.14)");
        ctx.fillStyle = g;
        ctx.fillRect(x, arriba, an, alto);

        // los hilos de agua bajando
        ctx.strokeStyle = "rgba(245,254,255,.38)";
        ctx.lineWidth = 1.2;
        for (var h = 0; h < 5; h++) {
          var corre = (state.elapsed * (230 + h * 30) + h * 37 + i * 19) % alto;
          ctx.beginPath();
          ctx.moveTo(x + 2 + h * (an / 5), arriba + corre);
          ctx.lineTo(x + 2 + h * (an / 5), arriba + Math.min(alto, corre + 26));
          ctx.stroke();
        }
        ctx.lineWidth = 1;

        // la bruma donde revienta
        ctx.fillStyle = "rgba(232,250,254,.16)";
        for (var b = 0; b < 6; b++) {
          var sube = (state.elapsed * 24 + b * 9 + i * 5) % 38;
          ctx.beginPath();
          ctx.arc(x + an / 2 + Math.sin(sube / 7 + b) * 14, base - 8 - sube, 7 + sube / 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        luzPuntual(x + an / 2, base - 24, 70, "200,245,255", 0.35);
      }, 20);

      bandaNeblina(110, 90, "215,248,252", 0.18);

      // las piedras del cauce, con el agua rompiendo contra ellas
      capa(126, 0.6, function (x, i, s) {
        if (s < 0.4) return;
        var r = 12 + s * 14;
        ctx.fillStyle = "rgba(52,66,72,.94)";
        ctx.beginPath();
        for (var a = 0; a <= 9; a++) {
          var ang = Math.PI + (a / 9) * Math.PI;
          var rr = r * (0.8 + az(i * 7 + a, 3) * 0.4);
          var px = x + Math.cos(ang) * rr, py = base + Math.sin(ang) * rr * 0.7;
          if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
        // la espuma alrededor
        ctx.fillStyle = "rgba(240,252,255,.4)";
        ctx.beginPath();
        ctx.ellipse(x, base - 2, r * 1.3, 3.4 + Math.abs(Math.sin(state.elapsed * 2 + i)) * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }, 28);

      // las palmas del borde
      capa(120, 0.66, function (x, i, s) {
        if (s < 0.34) return;
        var alto = 110 + s * 66;
        var py = base - alto;
        ctx.strokeStyle = "rgba(18,48,46,.94)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + 13, py + 38, x + 4, py);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(16,58,52,.94)";
        for (var h2 = 0; h2 < 7; h2++) {
          var ang2 = -Math.PI / 2 + (h2 - 3) * 0.44;
          var mece = Math.sin(state.elapsed * 1.1 + i + h2) * 3;
          ctx.beginPath();
          ctx.moveTo(x + 4, py);
          ctx.quadraticCurveTo(x + 4 + Math.cos(ang2) * 28, py + Math.sin(ang2) * 28 - 9,
                               x + 4 + Math.cos(ang2) * 50 + mece, py + Math.sin(ang2) * 50 + 11);
          ctx.quadraticCurveTo(x + 4 + Math.cos(ang2) * 26, py + Math.sin(ang2) * 26 + 3, x + 4, py);
          ctx.fill();
        }
      }, 32);

      // los juncos del primer plano
      ctx.strokeStyle = "rgba(24,62,54,.85)";
      ctx.lineWidth = 2;
      capa(38, 0.9, function (x, i, s) {
        if (s < 0.35) return;
        var alto = 30 + s * 34;
        var mece = Math.sin(state.elapsed * 1.6 + i) * 7;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + mece * 0.4, base - alto * 0.6, x + mece, base - alto);
        ctx.stroke();
        // la espiga de arriba
        ctx.fillStyle = "rgba(96,74,42,.85)";
        ctx.beginPath();
        ctx.ellipse(x + mece, base - alto - 3, 2, 6, mece * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }, 135);
      ctx.lineWidth = 1;

      // las garzas cruzando el cañón
      bandada(4, "rgba(235,245,250,.7)", 70, 210, 20, "ave");
      motas(14, "rgba(220,250,255,.16)", 12, 1.6);
    }

    /* ---- 🌕 La Luna ----
       El mar de la tranquilidad: cráteres a tres distancias, la Tierra
       saliendo en el horizonte, restos de misión y polvo levantándose. */
    function drawCrateres() {
      var base = groundY();

      /* La Tierra NO se dibuja acá: la pinta `drawAstro()`, que ya la tiene
         como `astro: "tierra"` en el escenario. Dibujarla también en el
         fondo salían dos, una encima de la otra. */
      // las cordilleras de polvo
      cordillera(250, 0.08, 150, 92, "rgba(78,76,84,.5)", 20);
      cordillera(180, 0.16, 112, 66, "rgba(58,56,64,.7)", 22);

      /* Los cráteres del fondo: elipses con el borde iluminado de un lado y
         la sombra del otro. Sin el par luz/sombra se ven como manchas. */
      capa(130, 0.3, function (x, i, s) {
        var r = 26 + s * 30;
        var y = base - 34 - s * 40;
        ctx.fillStyle = "rgba(42,40,48,.7)";
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(140,138,148,.5)";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.34, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        ctx.lineWidth = 1;
      }, 26);

      // los cráteres del frente, más marcados
      capa(104, 0.58, function (x, i, s) {
        if (s < 0.3) return;
        var r = 20 + s * 26;
        var y = base - 8;
        ctx.fillStyle = "rgba(30,28,36,.85)";
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(168,166,176,.6)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y - 1, r, r * 0.3, 0, Math.PI, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
        // las piedras que saltaron al formarse
        ctx.fillStyle = "rgba(96,94,104,.7)";
        for (var pd = 0; pd < 4; pd++) {
          ctx.fillRect(x - r + az(i, pd) * r * 2, y - 4 - az(i, pd + 4) * 10, 3, 2.4);
        }
      }, 32);

      // restos de misión: bandera, antena y el módulo
      capa(340, 0.66, function (x, i, s) {
        var cual = i % 3;
        if (cual === 0) {
          // la bandera, tiesa porque no hay aire
          ctx.fillStyle = "rgba(190,190,200,.9)";
          ctx.fillRect(x, base - 46, 2.4, 46);
          ctx.fillStyle = "rgba(200,60,60,.9)";
          ctx.fillRect(x + 2, base - 46, 24, 15);
          ctx.fillStyle = "rgba(230,230,240,.85)";
          ctx.fillRect(x + 2, base - 41, 24, 2);
          ctx.fillRect(x + 2, base - 36, 24, 2);
        } else if (cual === 1) {
          // la antena parabólica
          ctx.fillStyle = "rgba(150,150,162,.9)";
          ctx.fillRect(x - 1.5, base - 34, 3, 34);
          ctx.beginPath();
          ctx.ellipse(x, base - 40, 15, 9, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(70,70,82,.9)";
          ctx.beginPath();
          ctx.ellipse(x + 1, base - 40, 12, 7, -0.4, 0, Math.PI * 2);
          ctx.fill();
          var parpadeo = 0.4 + 0.6 * Math.abs(Math.sin(state.elapsed * 2 + i));
          ctx.fillStyle = "rgba(255,90,90," + parpadeo.toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(x, base - 36, 2, 0, Math.PI * 2); ctx.fill();
        } else {
          // el módulo, con sus patas
          ctx.fillStyle = "rgba(184,168,110,.9)";
          ctx.fillRect(x - 16, base - 30, 32, 18);
          ctx.fillStyle = "rgba(120,112,80,.9)";
          ctx.fillRect(x - 11, base - 42, 22, 13);
          ctx.strokeStyle = "rgba(150,148,158,.9)";
          ctx.lineWidth = 2;
          [-1, 1].forEach(function (d) {
            ctx.beginPath();
            ctx.moveTo(x + d * 13, base - 14); ctx.lineTo(x + d * 22, base);
            ctx.stroke();
            ctx.fillStyle = "rgba(150,148,158,.9)";
            ctx.beginPath(); ctx.ellipse(x + d * 22, base, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
          });
          ctx.lineWidth = 1;
          luzPuntual(x, base - 34, 44, "255,220,150", 0.35);
        }
      }, 14);

      // el polvo que levanta el personaje al correr: en la Luna cae despacio
      motas(18, "rgba(200,198,210,.16)", 7, 1.5);
    }

    /** Un árbol seco: tronco que se bifurca en ramas cada vez más finas. */
    function ramaSeca(x, base, alto, niveles, semilla, grosor) {
      ctx.lineWidth = grosor;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x + (semilla - 0.5) * 14, base - alto);
      ctx.stroke();
      var cima = base - alto, cx = x + (semilla - 0.5) * 14;
      for (var r = 0; r < 4; r++) {
        var ang = -Math.PI / 2 + (r - 1.5) * 0.7 + (az(r, semilla * 10) - 0.5) * 0.3;
        var lr = alto * (0.26 + az(r, semilla * 7) * 0.2);
        ctx.lineWidth = Math.max(1, grosor * 0.45);
        ctx.beginPath();
        ctx.moveTo(cx, cima + r * 6);
        var ex = cx + Math.cos(ang) * lr, ey = cima + r * 6 + Math.sin(ang) * lr;
        ctx.quadraticCurveTo(cx + Math.cos(ang) * lr * 0.5, cima + r * 6 + Math.sin(ang) * lr * 0.7, ex, ey);
        ctx.stroke();
        // una ramita más
        ctx.lineWidth = Math.max(0.8, grosor * 0.25);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(ang - 0.5) * lr * 0.45, ey + Math.sin(ang - 0.5) * lr * 0.45);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }

    /** Un pino: tres faldas superpuestas, con nieve encima si se pide. */
    function pino(x, base, alto, conNieve) {
      var an = alto * 0.34;
      for (var f = 0; f < 3; f++) {
        var t = f / 3;
        var y = base - alto * (0.34 + t * 0.62);
        var aw = an * (1 - t * 0.32);
        ctx.beginPath();
        ctx.moveTo(x - aw, y + alto * 0.2);
        ctx.lineTo(x, y - alto * 0.1);
        ctx.lineTo(x + aw, y + alto * 0.2);
        ctx.closePath(); ctx.fill();
      }
      if (conNieve) {
        var antes = ctx.fillStyle;
        ctx.fillStyle = "rgba(240,248,255,.85)";
        for (var n = 0; n < 3; n++) {
          var t2 = n / 3;
          var y2 = base - alto * (0.34 + t2 * 0.62);
          var aw2 = an * (1 - t2 * 0.32);
          ctx.beginPath();
          ctx.moveTo(x - aw2, y2 + alto * 0.2);
          ctx.lineTo(x, y2 - alto * 0.1);
          ctx.lineTo(x + aw2 * 0.35, y2 + alto * 0.1);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = antes;
      }
    }

    /** Un corazón lleno, centrado en (x,y). */
    function corazonEn(x, y, r) {
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      ctx.bezierCurveTo(x - r * 1.6, y - r * 0.4, x - r * 0.3, y - r * 1.5, x, y - r * 0.5);
      ctx.bezierCurveTo(x + r * 0.3, y - r * 1.5, x + r * 1.6, y - r * 0.4, x, y + r);
      ctx.fill();
    }

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
    /* ---- Letreros grandes ----

       Antes había UNO solo y casi todos los mapas lo dibujaban con el estilo
       "neón": un rótulo de 74 px de ancho con letra de 11. Chiquito. Los
       únicos grandes eran Noche Extrema, Halloween y el Callejón, que usan
       otros estilos.

       Ahora TODOS son grandes, se ajustan solos al texto que tengan, y puede
       haber varios distintos repartidos por el mapa: la lista sale del panel
       igual que las frases de las vallas chicas.

       El estilo (neón, grafiti, chorreado, madera) cambia CÓMO se ve, no
       cuánto mide: eso lo decide el texto. */

    var LETRERO_FUENTE_MAX = 34;
    var LETRERO_FUENTE_MIN = 17;
    var LETRERO_ANCHO_MAX_FRAC = 0.82;   // del ancho del lienzo

    /** Baja el tamaño de la letra hasta que el texto entre en pantalla:
     *  así un texto largo no se sale y uno corto sale bien grande. */
    function medirLetrero(texto) {
      var maxAncho = W * LETRERO_ANCHO_MAX_FRAC;
      var tam = LETRERO_FUENTE_MAX;
      var ancho;
      while (tam > LETRERO_FUENTE_MIN) {
        ctx.font = "900 " + tam + "px system-ui, -apple-system, sans-serif";
        ancho = ctx.measureText(texto).width;
        if (ancho <= maxAncho - 40) break;
        tam -= 1;
      }
      ctx.font = "900 " + tam + "px system-ui, -apple-system, sans-serif";
      ancho = ctx.measureText(texto).width;
      return { tam: tam, textoW: ancho, cajaW: Math.min(maxAncho, ancho + 40), cajaH: tam + 20 };
    }

    /* ---- Todos los carteles en UNA sola pista ----

       POR QUÉ

       Antes había dos pistas separadas: las vallas chicas por un lado y los
       letreros grandes por otro. Cada una se repetía cada cierta distancia, y
       como esas distancias eran distintas, tarde o temprano coincidían y un
       cartel quedaba encima del otro. No era cuestión de ajustar números: con
       dos ciclos independientes el choque es cuestión de tiempo.

       Ahora se colocan todos en la misma lista, uno detrás de otro, dejando
       entre cada par la distancia que hace falta según lo que MIDEN de verdad.
       Así el choque no es improbable: es imposible.

       El orden alterna grande / chica / grande / chica para que no salgan
       todos los grandes juntos. */

    var CARTEL_SEPARACION = 90;   // aire mínimo entre el borde de uno y el del siguiente

    /** Cuánto ocupa a lo ancho un cartel, para poder separarlos bien.
     *
     *  Ojo con el letrero grande: el neón NO se queda dentro de su caja
     *  medida — el halo se sale, y se sale más cuanto más grande es el
     *  cartel. Medido con `__runQA.medirDesborde()`: hasta 18 px por lado
     *  en un letrero de 279 px, o sea cerca del 7% del ancho.
     *
     *  Por eso la reserva es una FRACCIÓN y no un número fijo: uno fijo
     *  alcanza para los cortos y se queda corto justo en los largos, que
     *  son los que se pisaban. */
    var LETRERO_DESBORDE = 0.18;   // del ancho de la caja, repartido entre los dos lados
    var LETRERO_DESBORDE_MIN = 26; // piso, para los letreros de una o dos letras

    function anchoDeCartel(c) {
      if (c.tipo === "grande") {
        var caja = medirLetrero(c.texto).cajaW;
        return caja + Math.max(LETRERO_DESBORDE_MIN, caja * LETRERO_DESBORDE);
      }
      if (c.tipo === "ganador") {
        ctx.font = "800 11px system-ui, -apple-system, sans-serif";
        return Math.max(126, ctx.measureText(c.nombre).width + 40);
      }
      ctx.font = "800 12px system-ui, -apple-system, sans-serif";
      return Math.min(W * 0.62, ctx.measureText(c.texto).width + 26);
    }

    function buildCarteles(esc) {
      var grandes = letrerosGrandes(esc).map(function (t) { return { tipo: "grande", texto: t }; });
      var chicas = frasesParaEscenario(esc).map(function (t) {
        return {
          tipo: "valla", texto: t,
          alto: 26 + Math.random() * 10,
          /* Bien alto a propósito: el letrero grande vive entre los 44 y los
             112 px sobre el suelo, y con postes cortos las vallas le caían
             encima aunque estuvieran separadas a lo ancho. */
          poste: 72 + Math.random() * 46
        };
      });

      var vg = vallaDelGanador();
      var orden = [];
      /* La del ganador va primera, para que se vea al arrancar la partida
         —que es cuando la persona está mirando— y no a mitad de camino. */
      if (vg) orden.push({ tipo: "ganador", nombre: vg.nombre, puntos: vg.puntos, alto: 34, poste: 78 });

      // se intercalan: grande, chica, grande, chica...
      var i = 0, j = 0;
      while (i < grandes.length || j < chicas.length) {
        if (i < grandes.length) orden.push(grandes[i++]);
        if (j < chicas.length) orden.push(chicas[j++]);
      }
      if (!orden.length) return { items: [], totalW: 1 };

      /* Se colocan uno tras otro con la distancia que hace falta según lo que
         mide cada uno. El primero arranca lejos para que no aparezca encima
         del jugador al empezar. */
      var x = 300;
      var anchoPrevio = 0;
      orden.forEach(function (c, k) {
        var an = anchoDeCartel(c);
        if (k > 0) x += anchoPrevio / 2 + an / 2 + CARTEL_SEPARACION;
        c.x = x;
        c.ancho = an;
        anchoPrevio = an;
      });

      /* El total tiene que dejar sitio para que el último no se pise con el
         primero al dar la vuelta. */
      var ultimo = orden[orden.length - 1];
      var total = ultimo.x + ultimo.ancho / 2 + orden[0].ancho / 2 + CARTEL_SEPARACION + 300;
      return { items: orden, totalW: total };
    }

    /** Dibuja todos los carteles, cada uno según su tipo. */
    function drawCarteles() {
      var p = state.carteles;
      if (!p.items.length) return;
      var totalW = p.totalW;
      /* Al 86% del piso: los carteles están plantados al borde del camino,
         apenas más atrás que el personaje. Iban al 40%, y al lado de un
         primer plano que ahora se mueve al 90% parecían estar más lejos
         que los arbustos que tienen detrás. */
      var offset = (state.bgScroll * 0.86) % totalW;
      var esc = state.esc;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (var v = 0; v < 2; v++) {
        for (var i = 0; i < p.items.length; i++) {
          var c = p.items[i];
          var x = c.x - offset + v * totalW;
          if (x > W + 320 || x < -320) continue;

          if (c.tipo === "grande") dibujarUnLetrero(x, c.texto, esc, esc.acento);
          else if (c.tipo === "ganador") dibujarVallaGanador(x, c, esc);
          else dibujarVallaChica(x, c, esc);
        }
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 1;
    }

    /* ---- Las vallas chicas ----

       Van en el mismo idioma que el letrero grande: chapa oscura, marco
       encendido y su resplandor en el piso. Pero SIN parpadeo, a propósito:
       si todo late, nada resalta. El grande es el que se lleva la mirada;
       estas acompañan.

       Los postes son los mismos de `postesLetrero()`, en chico. */

    /** Los dos postes de una valla, con su placa en el suelo. */
    function postesValla(x, an, desdeY, hastaY) {
      var alto = hastaY - desdeY;
      [x - an / 2 + 7, x + an / 2 - 7].forEach(function (px) {
        var g = ctx.createLinearGradient(px - 2, 0, px + 2, 0);
        g.addColorStop(0, "rgba(58,54,66,.96)");
        g.addColorStop(1, "rgba(18,16,24,.96)");
        ctx.fillStyle = g;
        ctx.fillRect(px - 2, desdeY, 4, alto);
        ctx.fillStyle = "rgba(26,23,32,.96)";
        ctx.fillRect(px - 5, hastaY - 3, 10, 3);
      });
    }

    /** La chapa encendida: marco con brillo y letra con un halo corto. */
    function chapaEncendida(x, top, an, al, acento, fuerza) {
      var g = ctx.createLinearGradient(0, top, 0, top + al);
      g.addColorStop(0, "rgba(28,24,36,.96)");
      g.addColorStop(1, "rgba(15,12,20,.96)");
      cajaRedonda(x - an / 2, top, an, al, 4);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();
      ctx.shadowColor = "rgba(" + acento + ",.9)";
      ctx.shadowBlur = 7;
      cajaRedonda(x - an / 2 + 1, top + 1, an - 2, al - 2, 3);
      ctx.strokeStyle = "rgba(" + acento + "," + fuerza + ")";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 1;
    }

    function dibujarVallaGanador(x, c, esc) {
      var base = groundY();
      var an = c.ancho, al = 42;
      var top = base - c.poste - al;

      postesValla(x, an, top + al, base);
      resplandorEnElPiso(x, an * 0.7, esc.acento, 0.55);
      chapaEncendida(x, top, an, al, esc.acento, 0.9);

      ctx.font = "700 9px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.fillText("🏆 GANADOR ANTERIOR", x, top + 11);

      ctx.save();
      ctx.shadowColor = "rgba(" + esc.acento + ",.9)";
      ctx.shadowBlur = 8;
      ctx.font = "800 13px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(" + esc.acento + ",.98)";
      ctx.fillText(c.nombre, x, top + 24);
      ctx.restore();

      ctx.font = "700 10px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.fillText(c.puntos + " pts", x, top + 35);
    }

    function dibujarVallaChica(x, c, esc) {
      var base = groundY();
      ctx.font = "800 12px system-ui, -apple-system, sans-serif";
      var an = c.ancho, al = 30;
      var top = base - c.poste - al;

      postesValla(x, an, top + al, base);
      resplandorEnElPiso(x, an * 0.6, esc.acento, 0.35);
      chapaEncendida(x, top, an, al, esc.acento, 0.72);

      ctx.save();
      ctx.shadowColor = "rgba(" + esc.acento + ",.85)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "rgba(" + esc.acento + ",.96)";
      ctx.fillText(c.texto, x, top + al / 2);
      ctx.restore();
    }

    /* ---- El letrero grande: un solo neón, en los 21 mapas ----

       Antes había cuatro estilos: neón, grafiti pintado en un muro,
       chorreado, y una tabla de madera colgada de dos cuerdas. Solo el neón
       encendía y latía, así que en diez mapas el letrero salía apagado, y
       en los de madera parecía colgado del aire.

       Ahora hay uno solo y va en todos: rótulo encendido, con su tubo de
       neón latiendo, parado sobre dos postes clavados en el piso —igual que
       las vallas chicas— y con el resplandor cayendo sobre el suelo.

       Lo que cambia de un mapa a otro es el COLOR (el acento de cada mundo)
       y el material del poste, no la forma. Así todos se ven encendidos y
       aun así cada mundo conserva lo suyo. */

    var LETRERO_ALTURA = 132;    // del piso al borde de abajo del rótulo

    /** Rectángulo con las esquinas redondeadas. El canvas viejo de algunos
     *  teléfonos no trae ctx.roundRect, así que se arma a mano. */
    function cajaRedonda(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    /** Los dos postes que lo sostienen, con su base y su refuerzo. */
    function postesLetrero(cx, an, desdeY, hastaY) {
      var alto = hastaY - desdeY;
      var izq = cx - an / 2 + 10;
      var der = cx + an / 2 - 10;

      [izq, der].forEach(function (px) {
        // el poste: más claro del lado que da la luz, para que tenga volumen
        var g = ctx.createLinearGradient(px - 3, 0, px + 3, 0);
        g.addColorStop(0, "rgba(66,62,74,.98)");
        g.addColorStop(0.45, "rgba(38,35,45,.98)");
        g.addColorStop(1, "rgba(20,18,26,.98)");
        ctx.fillStyle = g;
        ctx.fillRect(px - 3, desdeY, 6, alto);

        // la placa de anclaje al piso
        ctx.fillStyle = "rgba(28,25,34,.98)";
        ctx.fillRect(px - 8, hastaY - 4, 16, 4);
        ctx.fillStyle = "rgba(80,76,90,.5)";
        ctx.fillRect(px - 8, hastaY - 4, 16, 1);
      });

      // el refuerzo en diagonal, que es lo que hace que se vea PARADO
      ctx.strokeStyle = "rgba(46,42,54,.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(izq, desdeY + alto * 0.42);
      ctx.lineTo(der, desdeY + alto * 0.20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(der, desdeY + alto * 0.42);
      ctx.lineTo(izq, desdeY + alto * 0.20);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    /** El charco de luz que el letrero tira sobre el piso. Es lo que lo
     *  integra al mapa: sin esto se ve pegoteado encima del fondo. */
    function resplandorEnElPiso(cx, an, acento, fuerza) {
      var base = groundY();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(cx, base, 0, cx, base, an * 0.85);
      g.addColorStop(0, "rgba(" + acento + "," + (0.20 * fuerza).toFixed(3) + ")");
      g.addColorStop(0.5, "rgba(" + acento + "," + (0.07 * fuerza).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + acento + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, base, an * 0.85, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ---- El letrero grande ----

       El neón se sacó: el tubo, el halo y el parpadeo hacían que el texto
       compitiera con su propio brillo y se leyera peor, sobre todo en los
       mapas claros.

       Queda un cartel de verdad: chapa, marco, texto sólido, y los dos
       postes clavados en el piso. Sigue en los 21 mapas, y sigue tomando el
       color del mundo — pero para el marco y los detalles, no para hacerlo
       brillar. */

    /* ---- El letrero grande: un LED de verdad ----

       QUÉ HACE QUE ALGO SE VEA ENCENDIDO

       No es el brillo sobre las letras. Un cartel apagado con letras claras
       también tiene contraste. Lo que dice "esto es una luz" es que
       ILUMINA LO QUE TIENE ALREDEDOR:

         · un halo suave en el aire, detrás del cartel
         · la luz cayendo sobre los postes que lo sostienen
         · un charco de luz en el piso, justo debajo
         · el reflejo en la propia chapa, alrededor del texto

       Todo eso va DETRÁS y DEBAJO del rótulo, nunca encima. Por eso puede
       sumarse sin tocar la lectura — y está comprobado: el texto sigue dando
       los mismos trazos y bordes que dibujado sin ningún brillo.

       El intento anterior fallaba porque metía el brillo ENCIMA de las
       letras: el resplandor rellenaba los huecos entre ellas y las pegaba. */

    /** Cuánto brillo aguanta el color de este mapa.
     *
     *  El texto es casi blanco (claridad 251). Si el acento del mapa es
     *  igual de claro —el del Trineo en el Cielo es 238— su resplandor sale
     *  tan brillante como las letras y rellena los huecos entre ellas: las
     *  junta, que es exactamente el defecto que había que sacar.
     *
     *  Con un acento oscuro no hay problema y va a fuerza completa. */
    function fuerzaDelBrillo(acento) {
      var p = String(acento).split(",");
      var lum = (+p[0] || 0) * 0.3 + (+p[1] || 0) * 0.59 + (+p[2] || 0) * 0.11;
      return Math.max(0.42, Math.min(1, (255 - lum) / 85));
    }

    /** El aire iluminado alrededor del cartel. Suave y ancho: una luz real
     *  se desvanece con la distancia, no tiene borde. */
    function auraDelLetrero(cx, cy, an, al, acento, fuerza) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var r = Math.max(an, al) * 0.95;
      var g = ctx.createRadialGradient(cx, cy, Math.min(an, al) * 0.3, cx, cy, r);
      g.addColorStop(0, "rgba(" + acento + "," + (0.13 * fuerza).toFixed(3) + ")");
      g.addColorStop(0.45, "rgba(" + acento + "," + (0.05 * fuerza).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + acento + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /** El charco de luz en el piso. Es lo que apoya el cartel en el mundo:
     *  sin esto se ve pegado encima del fondo, como una calcomanía. */
    function luzEnElPiso(cx, an, acento, fuerza) {
      var base = groundY();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(cx, base, 0, cx, base, an * 0.8);
      g.addColorStop(0, "rgba(" + acento + "," + (0.16 * fuerza).toFixed(3) + ")");
      g.addColorStop(0.5, "rgba(" + acento + "," + (0.05 * fuerza).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + acento + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, base, an * 0.8, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function dibujarUnLetrero(cx, texto, esc, acento) {
      var m = medirLetrero(texto);
      var base = groundY();
      var an = m.cajaW, al = m.cajaH;
      var top = base - LETRERO_ALTURA;
      var pie = top + al;
      var mediaY = top + al / 2;

      // respira, sin tirones: cada cartel con su ritmo según su texto
      var semilla = texto.length + texto.charCodeAt(0) % 17;
      var luz = 0.88 + 0.12 * Math.sin(state.elapsed * 1.6 + semilla);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // ---- 1. la luz, ANTES que nada: queda detrás de todo ----
      auraDelLetrero(cx, mediaY, an, al, acento, luz);
      luzEnElPiso(cx, an, acento, luz);

      postesLetrero(cx, an, pie, base);

      /* La luz cayendo sobre los postes. Es un detalle chico y es de lo que
         más convence: un cartel encendido ilumina su propia estructura. */
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(" + acento + "," + (0.22 * luz).toFixed(2) + ")";
      [cx - an / 2 + 10, cx + an / 2 - 10].forEach(function (px) {
        var g = ctx.createLinearGradient(0, pie, 0, base);
        g.addColorStop(0, "rgba(" + acento + "," + (0.3 * luz).toFixed(2) + ")");
        g.addColorStop(1, "rgba(" + acento + ",0)");
        ctx.fillStyle = g;
        ctx.fillRect(px - 3, pie, 6, base - pie);
      });
      ctx.restore();

      // ---- 2. la chapa ----
      var chapa = ctx.createLinearGradient(0, top, 0, pie);
      chapa.addColorStop(0, "rgba(30,26,38,.97)");
      chapa.addColorStop(0.55, "rgba(17,14,23,.97)");
      chapa.addColorStop(1, "rgba(25,21,32,.97)");
      cajaRedonda(cx - an / 2, top, an, al, 6);
      ctx.fillStyle = chapa;
      ctx.fill();

      /* El reflejo dentro de la chapa: la luz del texto rebotando en el
         fondo del cartel. Va acá, entre la chapa y el texto, y es muy tenue
         a propósito — si sube, vuelve a comerse los huecos entre letras. */
      ctx.save();
      cajaRedonda(cx - an / 2, top, an, al, 6);
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      var rebote = ctx.createRadialGradient(cx, mediaY, 0, cx, mediaY, an * 0.55);
      rebote.addColorStop(0, "rgba(" + acento + "," + (0.10 * luz).toFixed(3) + ")");
      rebote.addColorStop(1, "rgba(" + acento + ",0)");
      ctx.fillStyle = rebote;
      ctx.fillRect(cx - an / 2, top, an, al);
      ctx.restore();

      // el marco, encendido
      cajaRedonda(cx - an / 2 + 1, top + 1, an - 2, al - 2, 5);
      ctx.strokeStyle = "rgba(" + acento + "," + (0.6 * luz).toFixed(2) + ")";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.lineWidth = 1;

      /* ---- 3. el texto ----
         Una sola llamada a la fuente, un solo par de coordenadas. Si esto se
         toca y una pasada queda con otro tamaño, vuelve el fantasma. */
      ctx.font = "900 " + m.tam + "px system-ui, -apple-system, sans-serif";

      ctx.save();
      ctx.shadowColor = "rgba(" + acento + ",1)";

      /* El desenfoque va PROPORCIONAL al tamaño de la letra, no fijo.
         Con 12 px fijos, en un texto corto (letra de 34) el halo es un
         tercio de la altura y se ve bien; pero un texto largo se achica
         hasta 17 px, y ahí esos mismos 12 px son casi toda la letra: el
         resplandor se come los huecos y junta las palabras. */
      var fz = fuerzaDelBrillo(acento);
      ctx.shadowBlur = m.tam * 0.35 * luz * fz;
      ctx.fillStyle = "rgba(" + acento + "," + (0.5 * luz * fz).toFixed(2) + ")";
      ctx.fillText(texto, cx, mediaY);
      ctx.shadowBlur = m.tam * 0.15 * luz * fz;
      ctx.fillText(texto, cx, mediaY);

      // el tubo: nítido, sin desenfoque, casi blanco como el LED encendido
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,251,242," + (0.92 + 0.08 * luz).toFixed(2) + ")";
      ctx.fillText(texto, cx, mediaY);

      ctx.restore();
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
          /* ---- El vacío, con la identidad de cada mundo ----

             PRIMER INTENTO, Y POR QUÉ FALLÓ

             Llené cada abismo con su tema —cascada, hielo, corazones— y
             quedaron pareciendo terreno, no huecos. La causa es de espacio:
             debajo de la línea del suelo hay 26 píxeles y nada más
             (groundY() = H - GROUND_H). En 26 px no entra un dibujo; lo que
             entra es una franja de color, y una franja de color se lee como
             una superficie.

             El pozo negro original funcionaba justamente porque era negro:
             en 26 px, el negro se lee como "esto no tiene fondo".

             CÓMO SE HACE BIEN

             El abismo es SIEMPRE un vacío oscuro. El tema aparece solo en el
             filo —los primeros píxeles— y como un resplandor que sube desde
             abajo. Alcanza para saber en qué mundo estás y no le quita nada
             de profundidad al hueco. */
          var estilo = estiloAbismo();

          if (estilo) {
            var tema = ABISMO_TEMA[estilo];
            if (tema) {
              marcoAbismo(t);
              vacioTematico(t, tema);
              bordeAbismo(t);
              return;
            }
          }

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

      dibujarSusto();

      /* Lianas. La que está agarrada se dibuja colgando SOBRE el personaje
         —es lo que hace que el truco de no mover su x no se note— y las
         libres, ancladas donde están en el mundo. */
      state.lianas.forEach(function (li) {
        var agarrada = (li === state.lianaActual);
        var ax = agarrada ? (W * CHAR_X_RATIO + CHAR_SIZE / 2) - Math.sin(li.ang) * LIANA_LARGO : li.x;
        var ay = li.anclaY;
        var px = ax + Math.sin(li.ang) * LIANA_LARGO;
        var py = ay + Math.cos(li.ang) * LIANA_LARGO;

        ctx.save();
        // la cuerda, con una curva para que no parezca un palo
        ctx.strokeStyle = agarrada ? "rgba(120,200,120,.95)" : "rgba(60,110,64,.85)";
        ctx.lineWidth = agarrada ? 4 : 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(ax + (px - ax) * 0.45, ay + (py - ay) * 0.62, px, py);
        ctx.stroke();

        // hojas a lo largo
        ctx.fillStyle = agarrada ? "rgba(140,220,140,.9)" : "rgba(48,110,60,.85)";
        for (var hj = 1; hj <= 3; hj++) {
          var t = hj / 4;
          var hx = ax + (px - ax) * t, hy = ay + (py - ay) * t;
          ctx.beginPath();
          ctx.ellipse(hx + (hj % 2 ? 5 : -5), hy, 6, 2.6, hj % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // el nudo del extremo, que es donde se agarra
        ctx.fillStyle = agarrada ? "rgba(170,240,170,.95)" : "rgba(74,130,78,.9)";
        ctx.beginPath(); ctx.arc(px, py, agarrada ? 6 : 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      /* El rayo de la Tormenta: primero la marca que late en el suelo,
         después el zigzag. Se dibuja antes que los meteoritos porque va
         detrás de todo lo demás del aire. */
      if (state.rayoCaida) {
        var rc2 = state.rayoCaida;
        var sy2 = groundYAt(rc2.x);
        if (rc2.aviso > 0) {
          var p2 = 0.4 + 0.6 * Math.abs(Math.sin(rc2.aviso / 60));
          ctx.save();
          ctx.strokeStyle = "rgba(170,200,255," + p2.toFixed(2) + ")";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(rc2.x, sy2 - 2, RAYO_ANCHO, 6, 0, 0, Math.PI * 2); ctx.stroke();
          // una columna tenue que baja del cielo, para mirar hacia arriba
          var gg = ctx.createLinearGradient(0, 0, 0, sy2);
          gg.addColorStop(0, "rgba(170,200,255,0)");
          gg.addColorStop(1, "rgba(170,200,255," + (p2 * 0.22).toFixed(3) + ")");
          ctx.fillStyle = gg;
          ctx.fillRect(rc2.x - RAYO_ANCHO / 2, 0, RAYO_ANCHO, sy2);
          ctx.restore();
        } else if (rc2.golpe > 0) {
          ctx.save();
          ctx.strokeStyle = "rgba(235,245,255,.95)";
          ctx.lineWidth = 3.2;
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(rc2.x, 0);
          var pasos = 7;
          for (var z = 1; z <= pasos; z++) {
            var t2 = z / pasos;
            var zx = rc2.x + Math.sin((z + rc2.zig * 5) * 2.1) * 16 * (1 - t2 * 0.5);
            ctx.lineTo(zx, sy2 * t2);
          }
          ctx.stroke();
          // el resplandor alrededor, más ancho y transparente
          ctx.strokeStyle = "rgba(150,190,255,.35)";
          ctx.lineWidth = 10;
          ctx.stroke();
          // el impacto en el suelo
          ctx.fillStyle = "rgba(235,245,255,.5)";
          ctx.beginPath(); ctx.ellipse(rc2.x, sy2 - 2, RAYO_ANCHO * 1.4, 8, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      /* Meteoritos. Vienen del costado, así que la estela apunta atrás y
         arriba —de donde vienen— y no hacia arriba a secas. */
      state.meteoritos.forEach(function (me) {
        ctx.save();
        var colaX = me.x + 54, colaY = me.y - 22;
        var g = ctx.createLinearGradient(colaX, colaY, me.x, me.y);
        g.addColorStop(0, "rgba(255,170,80,0)");
        g.addColorStop(1, "rgba(255,190,110,.75)");
        ctx.strokeStyle = g;
        ctx.lineWidth = me.r * 0.9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(colaX, colaY);
        ctx.lineTo(me.x, me.y);
        ctx.stroke();

        ctx.translate(me.x, me.y);
        ctx.rotate(me.giro);
        ctx.fillStyle = "#6b6360";
        ctx.beginPath();
        // roca irregular, no un círculo
        for (var a = 0; a < 7; a++) {
          var ang = (a / 7) * Math.PI * 2;
          var rr = me.r * (0.78 + ((a * 37) % 10) / 22);
          if (a === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
          else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,150,70,.55)";
        ctx.beginPath(); ctx.arc(-me.r * 0.25, -me.r * 0.25, me.r * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
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
      /* Va acá y no antes: es una pasada sobre TODO lo dibujado. Si fuera
         más arriba, sería una capa más de fondo. */
      volcarLuces();         // las que anotaron los carteles
      luzDeAmbiente();
      drawDestello();
      dibujarMedidor();
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
        // se guarda para la valla de adentro del juego (se pinta al empezar
        // la partida, no acá)
        ganadorAnterior = (prev && prev.name) ? { name: prev.name, score: prev.score } : null;
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

    /* ---- Ranking largo: alto fijo, se desplaza por dentro ----
       El servidor manda hasta 50 jugadores. Si se pintaran todos a lo largo,
       la tarjeta del juego crecería hasta empujar todo lo de abajo, así que la
       lista tiene alto fijo y se desplaza adentro. Las flechas existen porque
       arrastrar con el dedo dentro de una lista corta que a su vez está dentro
       de una página que también se desplaza sale mal en el celular: se termina
       moviendo la página en vez de la lista. */

    function ajustarFlechasRanking() {
      if (!leaderboardListEl || !lbUpEl || !lbDownEl) return;
      var hayDeMas = leaderboardListEl.scrollHeight > leaderboardListEl.clientHeight + 2;
      lbUpEl.hidden = !hayDeMas;
      lbDownEl.hidden = !hayDeMas;
      if (!hayDeMas) return;
      var arriba = leaderboardListEl.scrollTop;
      var tope = leaderboardListEl.scrollHeight - leaderboardListEl.clientHeight;
      lbUpEl.disabled = arriba <= 1;
      lbDownEl.disabled = arriba >= tope - 1;
    }

    /* Deja la fila propia a la vista sin arrancarla al medio de un salto: si
       ya se ve, no se toca nada. */
    function mostrarMiFila() {
      if (!leaderboardListEl) return;
      var mia = leaderboardListEl.querySelector(".is-mine");
      if (!mia) return;
      var arriba = mia.offsetTop;
      var alto = leaderboardListEl.clientHeight;
      if (arriba >= leaderboardListEl.scrollTop && arriba + mia.offsetHeight <= leaderboardListEl.scrollTop + alto) return;
      leaderboardListEl.scrollTop = Math.max(0, arriba - alto / 2 + mia.offsetHeight / 2);
      ajustarFlechasRanking();
    }

    function desplazarRanking(haciaAbajo) {
      if (!leaderboardListEl) return;
      // tres filas por toque: se avanza de verdad sin perder de vista dónde ibas
      var fila = leaderboardListEl.querySelector("li");
      var paso = (fila ? fila.offsetHeight + 4 : 26) * 3;
      leaderboardListEl.scrollTop += haciaAbajo ? paso : -paso;
      ajustarFlechasRanking();
    }

    if (lbUpEl) lbUpEl.addEventListener("click", function () { desplazarRanking(false); });
    if (lbDownEl) lbDownEl.addEventListener("click", function () { desplazarRanking(true); });
    if (leaderboardListEl) leaderboardListEl.addEventListener("scroll", ajustarFlechasRanking);

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
      ajustarFlechasRanking();
      mostrarMiFila();
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
      anotarCuadro(ts);       // solo hace algo con ?fps=1
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
