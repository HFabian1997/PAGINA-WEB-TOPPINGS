<?php
/**
 * Historial del negocio, separado por categoría — y la lista de clientes.
 *
 * No inventa almacenamiento: lee lo que ya guardan los demás archivos y lo
 * ordena. El esqueleto es prize-codes.json, que desde siempre marca de qué
 * dinámica salió cada premio (`source`); a eso se le suman las participaciones
 * de las categorías que sí las registran.
 *
 * Lo que NO se puede mostrar, y el panel lo dice: el cronómetro de cuenta
 * regresiva, la tarjeta y el reto solo dejan rastro cuando alguien GANA.
 * premio.json se reinicia cada día (ensureFreshDay) y los sellos de la tarjeta
 * nunca salen del celular del cliente.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/codes-lib.php';
require_once __DIR__ . '/ruleta-lib.php';
require_once __DIR__ . '/redeem-lib.php';
require_once __DIR__ . '/stoptime-lib.php';
require_once __DIR__ . '/customers-lib.php';

session_name('toppings_admin_sess');
session_set_cookie_params(array(
  'lifetime' => 60 * 60 * 24 * 30,
  'path' => '/',
  'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
  'httponly' => true,
  'samesite' => 'Lax',
));
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$CONTENT_FILE = __DIR__ . '/../admin/content.json';
$RUN_FILE = toppingsDataFile('run-leaderboard.json');
$PREMIO_FILE = toppingsDataFile('premio.json');
$PRESENCE_FILE = toppingsDataFile('presence.json');
$MAX_ROWS = 200;

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }
function hNowMs() { return (int) round(microtime(true) * 1000); }
function hRequireAdmin() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}
function hReadJson($file, $fallback) {
  if (!file_exists($file)) return $fallback;
  $raw = @file_get_contents($file);
  $d = $raw ? json_decode($raw, true) : null;
  return is_array($d) ? $d : $fallback;
}

/** Desde qué instante cuenta el periodo pedido. null = todo. */
function hDesde($period) {
  if ($period === 'day') return strtotime('today') * 1000;
  if ($period === 'week') return strtotime('-7 days') * 1000;
  if ($period === 'month') return strtotime('-30 days') * 1000;
  return null;
}

/** Días tras los cuales el historial se borra solo (0 = nunca). */
function hAutoDeleteDays() {
  global $CONTENT_FILE;
  $c = hReadJson($CONTENT_FILE, array());
  $n = isset($c['history']['autoDeleteDays']) ? (int) $c['history']['autoDeleteDays'] : 0;
  return $n > 0 ? $n : 0;
}

/** Un premio que el cliente todavía puede reclamar NUNCA se borra: sería
    quitarle algo que ya ganó y aún no recogió. */
function hCodeProtegido($c) {
  $s = isset($c['status']) ? $c['status'] : '';
  return $s === 'available' || $s === 'waiting';
}

/**
 * Borrado automático de lo viejo. Se aplica al leer, como expireCodes() y
 * ruletaExpireTickets() — este hosting no tiene cron y todo el proyecto ya
 * funciona así. Nunca toca un premio que el cliente todavía puede reclamar.
 */
function hAutoPrune() {
  global $RUN_FILE, $PREMIO_FILE;
  $dias = hAutoDeleteDays();
  if ($dias <= 0) return;
  $corte = (time() - $dias * 86400) * 1000;

  codesWithWriteLock(function ($state) use ($corte) {
    $antes = count($state['codes']);
    $state['codes'] = array_values(array_filter($state['codes'], function ($c) use ($corte) {
      if (hCodeProtegido($c)) return true;
      return !isset($c['issuedAt']) || (int) $c['issuedAt'] >= $corte;
    }));
    return count($state['codes']) !== $antes ? $state : null;
  });

  stWithWriteLock(function ($state) use ($corte) {
    $antes = count($state['attempts']);
    $state['attempts'] = array_values(array_filter($state['attempts'], function ($a) use ($corte) {
      return !isset($a['startedAt']) || (int) $a['startedAt'] >= $corte;
    }));
    return count($state['attempts']) !== $antes ? $state : null;
  });

  redeemWithWriteLock(function ($state) use ($corte) {
    $antes = count($state['redemptions']);
    $state['redemptions'] = array_values(array_filter($state['redemptions'], function ($r) use ($corte) {
      return !isset($r['redeemedAt']) || (int) $r['redeemedAt'] >= $corte;
    }));
    return count($state['redemptions']) !== $antes ? $state : null;
  });

  ruletaWithWriteLock(function ($state) use ($corte) {
    $antes = count($state['tickets']);
    $state['tickets'] = array_values(array_filter($state['tickets'], function ($t) use ($corte) {
      if (isset($t['status']) && $t['status'] === 'available') return true;   // sin usar: se queda
      return !isset($t['grantedAt']) || (int) $t['grantedAt'] >= $corte;
    }));
    return count($state['tickets']) !== $antes ? $state : null;
  });
}

$CATS = array(
  'cronometro' => array('icon' => '⏱️', 'label' => 'Cronómetro'),
  'stoptime'   => array('icon' => '⏱️', 'label' => 'Detén el tiempo'),
  'loyalty'    => array('icon' => '🎟️', 'label' => 'Tarjeta de fidelidad'),
  'challenge'  => array('icon' => '🎯', 'label' => 'Reto del día'),
  'toppingsRun'=> array('icon' => '🛹', 'label' => 'TOPPINGS RUN'),
  'ruleta'     => array('icon' => '🎡', 'label' => 'Ruleta'),
  'redeem'     => array('icon' => '🎟️', 'label' => 'Códigos de premio'),
);

$ESTADOS = array(
  'available' => 'Disponible', 'waiting' => 'Esperando entrega', 'delivered' => 'Entregado',
  'expired' => 'Vencido', 'void' => 'Anulado',
);

/** Filas de premios de una categoría, sacadas del libro compartido. */
function hFilasPremios($cat, $desde) {
  global $ESTADOS;
  $state = codesReadState();
  $out = array();
  foreach ($state['codes'] as $c) {
    if (!isset($c['source']) || $c['source'] !== $cat) continue;
    $ts = isset($c['issuedAt']) ? (int) $c['issuedAt'] : 0;
    if ($desde !== null && $ts < $desde) continue;
    $out[] = array(
      'ts' => $ts,
      'name' => isset($c['name']) && $c['name'] !== '' ? $c['name'] : '(sin nombre)',
      'kind' => 'prize',
      'text' => '🏆 Ganó ' . (isset($c['prizeName']) ? $c['prizeName'] : 'un premio'),
      'status' => isset($ESTADOS[$c['status']]) ? $ESTADOS[$c['status']] : $c['status'],
    );
  }
  return $out;
}

/** Participaciones propias de cada categoría (las que sí quedan registradas). */
function hFilasParticipacion($cat, $desde) {
  global $RUN_FILE, $PREMIO_FILE;
  $out = array();

  if ($cat === 'stoptime') {
    $st = stReadState();
    foreach ($st['attempts'] as $a) {
      if (empty($a['stoppedAt'])) continue;
      $ts = (int) $a['startedAt'];
      if ($desde !== null && $ts < $desde) continue;
      if (!empty($a['won'])) continue;   // los que ganaron ya salen como premio
      $seg = isset($a['elapsedMs']) ? number_format($a['elapsedMs'] / 1000, 2) : '?';
      $out[] = array(
        'ts' => $ts,
        'name' => isset($a['name']) && $a['name'] !== '' ? $a['name'] : '(sin nombre)',
        'kind' => 'play',
        'text' => (!empty($a['rejected']) ? '⚠️ Tiempo no válido' : '❌ Falló') . ' — se detuvo en ' . $seg . ' s',
        'status' => null,
      );
    }
  }

  if ($cat === 'toppingsRun') {
    $run = hReadJson($RUN_FILE, array());
    $hist = isset($run['history']) && is_array($run['history']) ? $run['history'] : array();
    foreach ($hist as $h) {
      $ts = isset($h['claimedAt']) && $h['claimedAt'] ? (int) $h['claimedAt'] : 0;
      if ($ts === 0 && isset($h['periodStart'])) $ts = strtotime($h['periodStart']) * 1000;
      if ($desde !== null && $ts < $desde) continue;
      $out[] = array(
        'ts' => $ts,
        'name' => isset($h['name']) ? $h['name'] : '(sin nombre)',
        'kind' => 'play',
        'text' => '🥇 Top 1 con ' . (isset($h['score']) ? $h['score'] : 0) . ' puntos · ' . (isset($h['periodStart']) ? $h['periodStart'] : ''),
        'status' => isset($h['outcome']) && $h['outcome'] === 'claimed' ? 'Reclamado' : 'Sin reclamar',
      );
    }
  }

  if ($cat === 'ruleta') {
    $r = ruletaReadState();
    foreach ($r['tickets'] as $t) {
      if (!isset($t['status']) || $t['status'] !== 'used' || empty($t['result'])) continue;
      $ts = isset($t['result']['spunAt']) ? (int) $t['result']['spunAt'] : (int) $t['grantedAt'];
      if ($desde !== null && $ts < $desde) continue;
      if (!empty($t['result']['claimable'])) continue;   // ese ya salió como premio
      $out[] = array(
        'ts' => $ts,
        'name' => isset($t['name']) && $t['name'] !== '' ? $t['name'] : '(sin nombre)',
        'kind' => 'play',
        'text' => '🎡 Giró y le salió "' . (isset($t['result']['prizeName']) ? $t['result']['prizeName'] : '—') . '"',
        'status' => null,
      );
    }
  }

  if ($cat === 'redeem') {
    $rd = redeemReadState();
    foreach ($rd['redemptions'] as $x) {
      $ts = isset($x['redeemedAt']) ? (int) $x['redeemedAt'] : 0;
      if ($desde !== null && $ts < $desde) continue;
      $out[] = array(
        'ts' => $ts,
        'name' => isset($x['name']) && $x['name'] !== '' ? $x['name'] : '(sin nombre)',
        'kind' => 'play',
        'text' => '🎟️ Canjeó el código "' . (isset($x['code']) ? $x['code'] : '') . '"',
        'status' => null,
      );
    }
  }

  if ($cat === 'challenge') {
    $p = hReadJson($PREMIO_FILE, array());
    $stk = isset($p['stikers']) && is_array($p['stikers']) ? $p['stikers'] : array();
    foreach ($stk as $s) {
      $ts = isset($s['date']) ? strtotime($s['date']) * 1000 : 0;
      if ($desde !== null && $ts < $desde) continue;
      $out[] = array(
        'ts' => $ts,
        'name' => isset($s['alt']) && $s['alt'] !== '' ? $s['alt'] : '(sin nombre)',
        'kind' => 'play',
        'text' => '📷 Subió una foto de prueba',
        'status' => null,
      );
    }
  }

  return $out;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$body = array();
if ($method === 'POST') {
  $parsed = json_decode(file_get_contents('php://input'), true);
  $body = is_array($parsed) ? $parsed : array();
  if ($action === '' && isset($body['action'])) $action = (string) $body['action'];
}

switch ($action) {

  /* ---------------- cuántos hay en cada categoría ---------------- */
  case 'summary': {
    hRequireAdmin();
    hAutoPrune();   // el borrado automático se aplica al abrir la pestaña
    $out = array();
    foreach ($CATS as $key => $meta) {
      $n = count(hFilasPremios($key, null)) + count(hFilasParticipacion($key, null));
      $out[] = array('cat' => $key, 'icon' => $meta['icon'], 'label' => $meta['label'], 'total' => $n);
    }
    jsonOut(array('ok' => true, 'cats' => $out, 'autoDeleteDays' => hAutoDeleteDays(), 'serverNow' => hNowMs()));
  }

  /* ---------------- el historial de una categoría ---------------- */
  case 'list': {
    hRequireAdmin();
    $cat = isset($_GET['cat']) ? (string) $_GET['cat'] : '';
    if (!isset($CATS[$cat])) jsonOut(array('ok' => false, 'error' => 'Categoría no reconocida.'), 400);
    $period = isset($_GET['period']) ? (string) $_GET['period'] : 'all';
    $desde = hDesde($period);

    $filas = array_merge(hFilasPremios($cat, $desde), hFilasParticipacion($cat, $desde));
    usort($filas, function ($a, $b) { return (int) $b['ts'] - (int) $a['ts']; });
    $total = count($filas);

    jsonOut(array(
      'ok' => true,
      'cat' => $cat,
      'label' => $CATS[$cat]['label'],
      'period' => $period,
      'total' => $total,
      'rows' => array_slice($filas, 0, $MAX_ROWS),
      // en estas tres no hay forma de saber quién participó sin ganar
      'onlyWinners' => in_array($cat, array('cronometro', 'loyalty'), true),
      'serverNow' => hNowMs(),
    ));
  }

  /* ---------------- reiniciar el historial de UNA categoría ---------------- */
  case 'reset': {
    hRequireAdmin();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $cat = isset($body['cat']) ? (string) $body['cat'] : '';
    if (!isset($CATS[$cat])) jsonOut(array('ok' => false, 'error' => 'Categoría no reconocida.'), 400);

    $protegidos = 0;

    // premios de esa categoría (se conservan los que aún se pueden reclamar)
    codesWithWriteLock(function ($state) use ($cat, &$protegidos) {
      $quedan = array();
      foreach ($state['codes'] as $c) {
        if (isset($c['source']) && $c['source'] === $cat) {
          if (hCodeProtegido($c)) { $quedan[] = $c; $protegidos++; }
          continue;
        }
        $quedan[] = $c;
      }
      $state['codes'] = $quedan;
      return $state;
    });

    // y las participaciones propias de la categoría
    if ($cat === 'stoptime') {
      stWithWriteLock(function ($state) { $state['attempts'] = array(); return $state; });
    } elseif ($cat === 'redeem') {
      redeemWithWriteLock(function ($state) { $state['redemptions'] = array(); return $state; });
    } elseif ($cat === 'ruleta') {
      ruletaWithWriteLock(function ($state) {
        // solo los tiros ya usados: los que la gente todavía no giró se quedan
        $state['tickets'] = array_values(array_filter($state['tickets'], function ($t) {
          return isset($t['status']) && $t['status'] === 'available';
        }));
        return $state;
      });
    } elseif ($cat === 'toppingsRun') {
      $run = hReadJson($RUN_FILE, null);
      if (is_array($run)) {
        $run['history'] = array();
        $tmp = $RUN_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
        if (@file_put_contents($tmp, json_encode($run, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) {
          if (!@rename($tmp, $RUN_FILE)) @unlink($tmp);
        }
      }
    } elseif ($cat === 'challenge') {
      $p = hReadJson($PREMIO_FILE, null);
      if (is_array($p)) {
        $p['stikers'] = array();
        $tmp = $PREMIO_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
        if (@file_put_contents($tmp, json_encode($p, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) {
          if (!@rename($tmp, $PREMIO_FILE)) @unlink($tmp);
        }
      }
    }

    jsonOut(array('ok' => true, 'kept' => $protegidos));
  }

  /* ---------------- lista de clientes ---------------- */
  case 'customers': {
    hRequireAdmin();
    $q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
    // el registro vive en su propio archivo (customers.json); si todavía no
    // existe, customersRead() lo siembra con lo que haya en el del ranking
    $reg = customersRead();
    $names = $reg['customers'];
    $codes = codesReadState();
    $pres = hReadJson($PRESENCE_FILE, array());
    $seen = isset($pres['seen']) && is_array($pres['seen']) ? $pres['seen'] : array();

    // premios por dispositivo, de una sola pasada
    $porDispositivo = array();
    foreach ($codes['codes'] as $c) {
      $d = isset($c['deviceId']) ? $c['deviceId'] : '';
      if ($d === '') continue;
      if (!isset($porDispositivo[$d])) $porDispositivo[$d] = array('total' => 0, 'delivered' => 0, 'pending' => 0, 'last' => null);
      $porDispositivo[$d]['total']++;
      if ($c['status'] === 'delivered') $porDispositivo[$d]['delivered']++;
      if (hCodeProtegido($c)) $porDispositivo[$d]['pending']++;
      $ts = isset($c['issuedAt']) ? (int) $c['issuedAt'] : 0;
      if ($porDispositivo[$d]['last'] === null || $ts > $porDispositivo[$d]['last']) $porDispositivo[$d]['last'] = $ts;
    }

    /* Desde cuándo cuenta una visita. "hoy" y "mes" son de calendario (desde
       las 00:00 de hoy / desde el día 1), no "las últimas 24 h": es lo que
       espera uno al mirar la lista. La semana son los últimos 7 días. */
    $periodo = isset($_GET['periodo']) ? (string) $_GET['periodo'] : 'todos';
    if (!in_array($periodo, array('hoy', 'semana', 'mes', 'todos'), true)) $periodo = 'todos';
    $desde = 0;
    if ($periodo === 'hoy')     $desde = strtotime('today') * 1000;
    if ($periodo === 'semana')  $desde = (time() - 7 * 24 * 3600) * 1000;
    if ($periodo === 'mes')     $desde = strtotime('first day of this month 00:00') * 1000;

    $totalSinFiltro = 0;
    foreach ($names as $unInfo) {
      if (is_array($unInfo) && isset($unInfo['name']) && trim((string) $unInfo['name']) !== '') $totalSinFiltro++;
    }

    $qLower = function_exists('mb_strtolower') ? mb_strtolower($q) : strtolower($q);
    $out = array();
    foreach ($names as $deviceId => $info) {
      $nombre = is_array($info) && isset($info['name']) ? (string) $info['name'] : '';
      if ($nombre === '') continue;
      if ($q !== '') {
        $nLower = function_exists('mb_strtolower') ? mb_strtolower($nombre) : strtolower($nombre);
        if (strpos($nLower, $qLower) === false) continue;
      }
      $p = isset($porDispositivo[$deviceId]) ? $porDispositivo[$deviceId] : array('total' => 0, 'delivered' => 0, 'pending' => 0, 'last' => null);

      /* La última visita sale del registro del cliente, no de presence.json:
         ese solo guarda los últimos 5 minutos (sirve para "cuántos hay
         conectados ahora") y por eso esta columna salía casi siempre vacía. */
      $ultimaVisita = is_array($info) && isset($info['lastSeenAt']) ? (int) $info['lastSeenAt'] : 0;
      $enLinea = isset($seen[$deviceId]);        // activo en los últimos 5 min
      if ($enLinea && (int) $seen[$deviceId] > $ultimaVisita) $ultimaVisita = (int) $seen[$deviceId];

      if ($desde > 0 && $ultimaVisita < $desde) continue;   // filtro hoy/semana/mes

      $out[] = array(
        'deviceId' => $deviceId,
        'name' => $nombre,
        'updatedAt' => is_array($info) && isset($info['updatedAt']) ? (int) $info['updatedAt'] : 0,
        'lastSeen' => $ultimaVisita > 0 ? $ultimaVisita : null,
        'online' => $enLinea,
        'prizes' => $p['total'],
        'delivered' => $p['delivered'],
        'pending' => $p['pending'],
      );
    }
    usort($out, function ($a, $b) {
      $x = $a['lastSeen'] ? $a['lastSeen'] : $a['updatedAt'];
      $y = $b['lastSeen'] ? $b['lastSeen'] : $b['updatedAt'];
      return $y - $x;
    });

    jsonOut(array('ok' => true, 'total' => count($out), 'totalSinFiltro' => $totalSinFiltro,
      'periodo' => $periodo, 'customers' => array_slice($out, 0, 300), 'serverNow' => hNowMs()));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
