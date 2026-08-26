<?php
require_once __DIR__ . '/data-path.php';
/**
 * 🗳️ Votaciones — la gente elige entre varias opciones.
 *
 * POR QUÉ ES GENÉRICO Y NO "EL CONCURSO DE SALCHIPAPAS"
 *
 * La primera votación es un concurso de salchipapas dentro del menú de
 * Comidas, con fotos. Pero la siguiente va a ser "¿qué actividad hacemos
 * mañana?" en el inicio, con opciones de solo texto. Es la misma pieza puesta
 * en otro lado, así que la ubicación NO está en el código: cada votación
 * lleva adentro en qué páginas sale y en qué parte.
 *
 * Cada votación trae también sus propias reglas, porque no todas se juegan
 * igual: un concurso quiere un voto y ya, y una encuesta del día puede querer
 * uno por día.
 *
 * Los votos se guardan en el SERVIDOR, por deviceId. El navegador nunca
 * decide si un voto vale — eso pasó con el botón de reclamar de la tarjeta,
 * que entregaba un premio por cada toque porque nadie comprobaba nada.
 */

if (!function_exists('votesRead')) {

  function votesDataFile() { return toppingsDataFile('votes.json'); }
  function votesLockFile() { return toppingsLockFile('votes.lock'); }

  function votesNowMs() { return (int) round(microtime(true) * 1000); }

  /** Las páginas donde puede aparecer una votación (las mismas que conoce el
   *  sitio en paginaActual(), en main.js). */
  function votesPaginas() {
    return array('inicio', 'comidas', 'helados', 'bebidas', 'secreta');
  }

  function votesDefaultState() { return array('polls' => array(), 'votes' => array()); }

  /* ---------- normalización ---------- */

  function votesNormalizeOption($o, $i) {
    if (!is_array($o)) $o = array();
    $id = isset($o['id']) && $o['id'] !== '' ? (string) $o['id'] : 'opt_' . ($i + 1);
    return array(
      'id' => $id,
      'name' => isset($o['name']) ? (string) $o['name'] : '',
      'image' => isset($o['image']) && $o['image'] !== '' ? (string) $o['image'] : null,
      'note' => isset($o['note']) ? (string) $o['note'] : '',
    );
  }

  function votesNormalizeRules($r) {
    if (!is_array($r)) $r = array();
    $repeat = isset($r['repeat']) ? (string) $r['repeat'] : 'once';
    if (!in_array($repeat, array('once', 'daily', 'changeable'), true)) $repeat = 'once';
    $who = isset($r['who']) ? (string) $r['who'] : 'name';
    if (!in_array($who, array('anyone', 'name', 'qr'), true)) $who = 'name';
    $results = isset($r['results']) ? (string) $r['results'] : 'adminOnly';
    if (!in_array($results, array('hidden', 'public', 'adminOnly'), true)) $results = 'adminOnly';
    return array(
      'repeat' => $repeat,
      'who' => $who,
      'results' => $results,
      'opensAt' => isset($r['opensAt']) && $r['opensAt'] ? (int) $r['opensAt'] : null,
      'closesAt' => isset($r['closesAt']) && $r['closesAt'] ? (int) $r['closesAt'] : null,
    );
  }

  /** Dónde puede caer dentro de la portada, en relación a las secciones que
   *  ya existen. Se guarda así, y no como un número, para que agregar una
   *  sección nueva al inicio no descoloque las votaciones ya configuradas. */
  function votesHomeSitios() {
    return array('start', 'afterHero', 'afterPrizes', 'end');
  }

  /**
   * Dónde aparece.
   *
   * `pages` es una casilla por página. `menuPosition` dice, dentro de una
   * página de menú, antes de qué imagen va — el mismo número que ya usa el
   * carrusel de categoría (main.js:774). `homeAfter` hace lo mismo para la
   * portada, pero por nombre de sección. `fab` es el botón flotante, que
   * puede estar en páginas donde la votación NO se muestra: ahí el botón
   * lleva hasta la página donde sí está.
   */
  function votesNormalizePlacement($p) {
    if (!is_array($p)) $p = array();
    $pages = array();
    $dadas = isset($p['pages']) && is_array($p['pages']) ? $p['pages'] : array();
    foreach (votesPaginas() as $pag) {
      $pages[$pag] = !empty($dadas[$pag]);
    }
    $pos = array();
    $dadasPos = isset($p['menuPosition']) && is_array($p['menuPosition']) ? $p['menuPosition'] : array();
    foreach (array('comidas', 'helados', 'bebidas') as $pag) {
      $pos[$pag] = isset($dadasPos[$pag]) ? max(0, (int) $dadasPos[$pag]) : 0;
    }
    $fab = array();
    $dadasFab = isset($p['fab']) && is_array($p['fab']) ? $p['fab'] : array();
    foreach (votesPaginas() as $pag) {
      $fab[$pag] = !empty($dadasFab[$pag]);
    }
    $homeAfter = isset($p['homeAfter']) ? (string) $p['homeAfter'] : 'afterPrizes';
    if (!in_array($homeAfter, votesHomeSitios(), true)) $homeAfter = 'afterPrizes';

    return array(
      'pages' => $pages,
      'menuPosition' => $pos,
      'homeAfter' => $homeAfter,
      'fab' => $fab,
      'fabText' => isset($p['fabText']) ? (string) $p['fabText'] : '',
    );
  }

  function votesNormalizePoll($p) {
    if (!is_array($p)) return null;
    $id = isset($p['id']) && $p['id'] !== '' ? (string) $p['id'] : null;
    if (!$id) return null;
    $ops = array();
    $dadas = isset($p['options']) && is_array($p['options']) ? array_values($p['options']) : array();
    foreach ($dadas as $i => $o) {
      $op = votesNormalizeOption($o, $i);
      if ($op['name'] === '' && $op['image'] === null) continue;   // opción vacía: se descarta
      $ops[] = $op;
    }
    return array(
      'id' => $id,
      'title' => isset($p['title']) ? (string) $p['title'] : '',
      'text' => isset($p['text']) ? (string) $p['text'] : '',
      'active' => !isset($p['active']) || !empty($p['active']),
      // arranca plegada para no comerse la pantalla; se abre tocándola
      'collapsed' => !empty($p['collapsed']),
      'options' => $ops,
      'rules' => votesNormalizeRules(isset($p['rules']) ? $p['rules'] : null),
      'placement' => votesNormalizePlacement(isset($p['placement']) ? $p['placement'] : null),
      'createdAt' => isset($p['createdAt']) ? (int) $p['createdAt'] : votesNowMs(),
    );
  }

  function votesNormalize($state) {
    if (!is_array($state)) return votesDefaultState();
    $polls = array();
    $dadas = isset($state['polls']) && is_array($state['polls']) ? array_values($state['polls']) : array();
    foreach ($dadas as $p) {
      $n = votesNormalizePoll($p);
      if ($n) $polls[] = $n;
    }
    $votes = isset($state['votes']) && is_array($state['votes']) ? $state['votes'] : array();
    return array('polls' => $polls, 'votes' => $votes);
  }

  /* ---------- disco ---------- */

  function votesReadRaw() {
    $f = votesDataFile();
    if (!file_exists($f)) return votesDefaultState();
    $raw = @file_get_contents($f);
    $d = $raw ? json_decode($raw, true) : null;
    return votesNormalize($d);
  }

  function votesRead() { return votesReadRaw(); }

  function votesWriteAtomic($state) {
    $f = votesDataFile();
    $dir = dirname($f);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tmp = $f . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    return true;
  }

  /** Comprobar y escribir dentro del mismo candado: dos votos simultáneos
   *  entran en fila y el segundo ve el primero ya guardado. */
  function votesWithWriteLock($cb) {
    $lock = votesLockFile();
    $dir = dirname($lock);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen($lock, 'c');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $state = votesReadRaw();
    $res = $cb($state);
    if (is_array($res)) votesWriteAtomic($res);
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($res) ? $res : $state;
  }

  /* ---------- consultas ---------- */

  function votesFindPoll($state, $pollId) {
    foreach ($state['polls'] as $p) {
      if ($p['id'] === (string) $pollId) return $p;
    }
    return null;
  }

  /** Abierta = activa, con opciones, y dentro de sus fechas si las tiene. */
  function votesAbierta($poll) {
    if (!$poll || empty($poll['active']) || !count($poll['options'])) return false;
    $ahora = votesNowMs();
    $r = $poll['rules'];
    if ($r['opensAt'] && $ahora < $r['opensAt']) return false;
    if ($r['closesAt'] && $ahora > $r['closesAt']) return false;
    return true;
  }

  /** Los votos de una persona en una votación, ya normalizados. */
  function votesEntradasDe($state, $pollId, $deviceId) {
    $v = isset($state['votes'][$pollId][$deviceId]) ? $state['votes'][$pollId][$deviceId] : null;
    if (!is_array($v) || !isset($v['entries']) || !is_array($v['entries'])) return array();
    return array_values(array_filter($v['entries'], function ($e) {
      return is_array($e) && isset($e['optionId']);
    }));
  }

  /** El conteo por opción. Se calcula al leer; no se guarda un contador que
   *  se pueda desincronizar de los votos reales. */
  function votesConteo($state, $poll) {
    $tot = array();
    foreach ($poll['options'] as $o) $tot[$o['id']] = 0;
    $porVotacion = isset($state['votes'][$poll['id']]) && is_array($state['votes'][$poll['id']])
      ? $state['votes'][$poll['id']] : array();
    foreach ($porVotacion as $persona) {
      if (!is_array($persona) || !isset($persona['entries']) || !is_array($persona['entries'])) continue;
      foreach ($persona['entries'] as $e) {
        if (!is_array($e) || !isset($e['optionId'])) continue;
        $oid = (string) $e['optionId'];
        if (isset($tot[$oid])) $tot[$oid]++;
      }
    }
    return $tot;
  }

  function votesTotalVotos($conteo) {
    $n = 0;
    foreach ($conteo as $c) $n += (int) $c;
    return $n;
  }

  /** Cuánta gente distinta votó (no es lo mismo que los votos, con "una por día"). */
  function votesPersonas($state, $pollId) {
    return isset($state['votes'][$pollId]) && is_array($state['votes'][$pollId])
      ? count($state['votes'][$pollId]) : 0;
  }

  /**
   * ¿Esta persona puede votar ahora?
   * Devuelve array('ok' => bool, 'reason' => string).
   */
  function votesPuedeVotar($state, $poll, $deviceId) {
    if (!votesAbierta($poll)) return array('ok' => false, 'reason' => 'closed');
    if ((string) $deviceId === '') return array('ok' => false, 'reason' => 'no-device');

    $entries = votesEntradasDe($state, $poll['id'], $deviceId);
    $repeat = $poll['rules']['repeat'];

    if ($repeat === 'once' && count($entries)) {
      return array('ok' => false, 'reason' => 'already');
    }
    if ($repeat === 'daily') {
      $hoy = date('Y-m-d');
      foreach ($entries as $e) {
        $dia = isset($e['day']) ? (string) $e['day'] : date('Y-m-d', (int) ($e['at'] / 1000));
        if ($dia === $hoy) return array('ok' => false, 'reason' => 'already-today');
      }
    }
    // 'changeable' siempre deja: el voto anterior se reemplaza al guardar
    return array('ok' => true, 'reason' => '');
  }

  /**
   * Guarda el voto. Se llama SIEMPRE dentro de votesWithWriteLock(), y vuelve
   * a comprobar acá adentro — comprobar afuera no sirve de nada.
   */
  function votesVotar(&$state, $pollId, $optionId, $deviceId, $nombre = '') {
    $poll = votesFindPoll($state, $pollId);
    if (!$poll) return array('ok' => false, 'reason' => 'not-found');

    $puede = votesPuedeVotar($state, $poll, $deviceId);
    if (!$puede['ok']) return array('ok' => false, 'reason' => $puede['reason']);

    $existe = false;
    foreach ($poll['options'] as $o) {
      if ($o['id'] === (string) $optionId) { $existe = true; break; }
    }
    if (!$existe) return array('ok' => false, 'reason' => 'bad-option');

    $ahora = votesNowMs();
    $deviceId = (string) $deviceId;
    if (!isset($state['votes'][$pollId]) || !is_array($state['votes'][$pollId])) {
      $state['votes'][$pollId] = array();
    }
    $persona = isset($state['votes'][$pollId][$deviceId]) && is_array($state['votes'][$pollId][$deviceId])
      ? $state['votes'][$pollId][$deviceId] : array('entries' => array(), 'name' => null);
    if (!isset($persona['entries']) || !is_array($persona['entries'])) $persona['entries'] = array();

    $entrada = array('optionId' => (string) $optionId, 'at' => $ahora, 'day' => date('Y-m-d'));
    if ($poll['rules']['repeat'] === 'changeable') {
      $persona['entries'] = array($entrada);     // reemplaza, no acumula
    } else {
      $persona['entries'][] = $entrada;
    }
    if ($nombre !== '') $persona['name'] = $nombre;
    $state['votes'][$pollId][$deviceId] = $persona;

    return array('ok' => true, 'optionId' => (string) $optionId);
  }

  /* ---------- lo que se le manda al navegador ---------- */

  /**
   * Una votación tal como la ve el cliente.
   *
   * Cuando los resultados no son públicos, los números NO viajan: se quitan
   * acá, no se esconden con CSS. Si viajaran, cualquiera los vería abriendo
   * las herramientas del navegador y el "oculto" sería mentira.
   */
  function votesPublicPoll($state, $poll, $deviceId) {
    $entries = votesEntradasDe($state, $poll['id'], $deviceId);
    $ultima = count($entries) ? $entries[count($entries) - 1] : null;
    $puede = votesPuedeVotar($state, $poll, $deviceId);

    $ops = array();
    $conteo = votesConteo($state, $poll);
    $total = votesTotalVotos($conteo);
    $publicos = $poll['rules']['results'] === 'public';

    foreach ($poll['options'] as $o) {
      $fila = array('id' => $o['id'], 'name' => $o['name'], 'image' => $o['image'], 'note' => $o['note']);
      if ($publicos) {
        $fila['votes'] = (int) $conteo[$o['id']];
        $fila['percent'] = $total > 0 ? round($conteo[$o['id']] * 100 / $total) : 0;
      }
      $ops[] = $fila;
    }

    return array(
      'id' => $poll['id'],
      'title' => $poll['title'],
      'text' => $poll['text'],
      'collapsed' => !empty($poll['collapsed']),
      'options' => $ops,
      'open' => votesAbierta($poll),
      'repeat' => $poll['rules']['repeat'],
      'who' => $poll['rules']['who'],
      'showResults' => $publicos,
      'closesAt' => $poll['rules']['closesAt'],
      'myVote' => $ultima ? $ultima['optionId'] : null,
      'canVote' => $puede['ok'],
      'reason' => $puede['reason'],
      // el total de votos se muestra siempre: dice "sos parte de algo" sin
      // revelar quién va ganando
      'totalVotes' => $total,
      'placement' => $poll['placement'],
      'serverNow' => votesNowMs(),
    );
  }

  /**
   * Las votaciones que le tocan a una página.
   *
   * Incluye también las que solo traen el BOTÓN flotante acá sin mostrarse:
   * el botón puede estar en Bebidas y llevar al concurso que vive en
   * Comidas. Por eso van dos marcas distintas — `showHere` dice si se pinta
   * el bloque, `fabHere` si se pinta el botón — y una votación puede traer
   * una, la otra, o las dos.
   */
  function votesParaPagina($state, $pagina, $deviceId) {
    $out = array();
    foreach ($state['polls'] as $poll) {
      if (!$poll['active']) continue;
      $aqui = !empty($poll['placement']['pages'][$pagina]);
      $conBoton = !empty($poll['placement']['fab'][$pagina]);
      if (!$aqui && !$conBoton) continue;

      $vista = votesPublicPoll($state, $poll, $deviceId);
      $vista['showHere'] = $aqui;
      $vista['fabHere'] = $conBoton;
      /* Si el botón está acá pero la votación no, hay que saber a dónde
         llevar: la primera página donde sí se muestre. */
      $vista['goTo'] = null;
      if ($conBoton && !$aqui) {
        foreach (votesPaginas() as $otra) {
          if (!empty($poll['placement']['pages'][$otra])) { $vista['goTo'] = $otra; break; }
        }
      }
      $out[] = $vista;
    }
    return $out;
  }

  /** La vista del panel: acá sí van todos los números, siempre. */
  function votesAdminPoll($state, $poll) {
    $conteo = votesConteo($state, $poll);
    $total = votesTotalVotos($conteo);
    $ops = array();
    foreach ($poll['options'] as $o) {
      $ops[] = array(
        'id' => $o['id'], 'name' => $o['name'], 'image' => $o['image'], 'note' => $o['note'],
        'votes' => (int) $conteo[$o['id']],
        'percent' => $total > 0 ? round($conteo[$o['id']] * 100 / $total) : 0,
      );
    }
    $copia = $poll;
    $copia['options'] = $ops;
    $copia['totalVotes'] = $total;
    $copia['voters'] = votesPersonas($state, $poll['id']);
    $copia['open'] = votesAbierta($poll);
    return $copia;
  }
}
