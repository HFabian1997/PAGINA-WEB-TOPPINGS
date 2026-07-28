<?php
/**
 * Ruleta de Premios TOPPINGS — sin base de datos, mismo patrón de archivo
 * JSON con escritura atómica + candado que ya usan premio.php y
 * run-leaderboard.php. La selección del premio SIEMPRE ocurre aquí, en el
 * servidor, nunca en el navegador — el cliente solo recibe el resultado ya
 * decidido y anima la rueda hasta ese segmento.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/ruleta-lib.php';
require_once __DIR__ . '/codes-lib.php';

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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$CONTENT_FILE = __DIR__ . '/../admin/content.json';
$MAX_NAME_CHARS = 60;

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }

function requireAdminAuth() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

function businessWhatsapp() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return '';
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  return is_array($content) && isset($content['business']['whatsapp']) ? (string) $content['business']['whatsapp'] : '';
}

/** Premios que de verdad pueden salir ahora mismo: activos, dentro de sus
    fechas (si las tienen) y con inventario disponible (o ilimitado). */
function eligiblePrizes($prizes) {
  $today = date('Y-m-d');
  $out = array();
  foreach ($prizes as $p) {
    if (empty($p['active'])) continue;
    if (!empty($p['startDate']) && $today < $p['startDate']) continue;
    if (!empty($p['endDate']) && $today > $p['endDate']) continue;
    $inv = isset($p['inventory']) ? (int) $p['inventory'] : -1;
    if ($inv === 0) continue;
    $out[] = $p;
  }
  return $out;
}

/** Elige un premio ponderado por probabilidad entre los elegibles,
    renormalizando a 100% — así nunca falla aunque algún premio se haya
    agotado o esté fuera de fecha, sin que el admin tenga que recalcular
    nada a mano. */
function pickWeightedPrize($eligible) {
  if (!$eligible) return null;
  $total = 0;
  foreach ($eligible as $p) $total += max(0, (float) $p['probability']);
  if ($total <= 0) return $eligible[array_rand($eligible)];
  $roll = mt_rand() / mt_getrandmax() * $total;
  $acc = 0;
  foreach ($eligible as $p) {
    $acc += max(0, (float) $p['probability']);
    if ($roll <= $acc) return $p;
  }
  return $eligible[count($eligible) - 1];
}

/** Vista pública de un premio: nunca expone probabilidad, inventario ni límites. */
function publicPrize($p) {
  return array(
    'id' => $p['id'], 'name' => $p['name'], 'description' => isset($p['description']) ? $p['description'] : '',
    'icon' => isset($p['icon']) ? $p['icon'] : '🎁', 'color' => isset($p['color']) ? $p['color'] : '#ffd400',
    'order' => isset($p['order']) ? (int) $p['order'] : 0, 'claimable' => !empty($p['claimable']),
  );
}

function publicTicket($t) {
  return array('id' => $t['id'], 'source' => $t['source'], 'grantedAt' => $t['grantedAt'], 'expiresAt' => $t['expiresAt']);
}

function myAvailableTickets($state, $deviceId) {
  if ($deviceId === '') return array();
  $out = array();
  foreach ($state['tickets'] as $t) {
    if ($t['deviceId'] === $deviceId && $t['status'] === 'available') $out[] = publicTicket($t);
  }
  return $out;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {

  case 'status': {
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    $state = ruletaWithWriteLock(function ($s) { ruletaExpireTickets($s); return $s; });
    $prizes = array_values(array_filter($state['prizes'], function ($p) { return !empty($p['active']); }));
    usort($prizes, function ($a, $b) { return (int) $a['order'] - (int) $b['order']; });
    jsonOut(array(
      'ok' => true,
      'active' => !!$state['active'],
      'title' => $state['title'],
      'soundEnabled' => !!$state['soundEnabled'],
      'confettiEnabled' => !!$state['confettiEnabled'],
      'whatsappNumber' => $state['whatsappNumber'] !== '' ? $state['whatsappNumber'] : businessWhatsapp(),
      'prizes' => array_map('publicPrize', array_values($prizes)),
      'myTickets' => myAvailableTickets($state, $deviceId),
      'serverNow' => ruletaNowMs(),
    ));
  }

  case 'spin': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    if ($deviceId === '') jsonOut(array('ok' => false, 'error' => 'Falta identificar el dispositivo.'), 400);

    $outcome = array('ok' => false, 'error' => 'No se pudo procesar el giro.');
    ruletaWithWriteLock(function ($state) use ($deviceId, $name, &$outcome) {
      ruletaExpireTickets($state);

      if (empty($state['active'])) {
        $outcome = array('ok' => false, 'error' => 'La Ruleta TOPPINGS no está disponible en este momento.');
        return $state;
      }

      $ticketIdx = null;
      foreach ($state['tickets'] as $i => $t) {
        if ($t['deviceId'] === $deviceId && $t['status'] === 'available') { $ticketIdx = $i; break; }
      }
      if ($ticketIdx === null) {
        $outcome = array('ok' => false, 'error' => 'No tienes tiros disponibles. Completa una dinámica para conseguir uno.');
        return $state;
      }

      $eligible = eligiblePrizes($state['prizes']);
      if (!$eligible) {
        $outcome = array('ok' => false, 'error' => 'No hay premios configurados en este momento.');
        return $state;
      }
      $prize = pickWeightedPrize($eligible);

      // Descuenta inventario en la misma operación segura (el candado ya
      // está tomado): nunca puede entregarse un premio agotado dos veces.
      foreach ($state['prizes'] as &$p) {
        if ($p['id'] === $prize['id'] && isset($p['inventory']) && (int) $p['inventory'] > 0) {
          $p['inventory'] = (int) $p['inventory'] - 1;
        }
      }
      unset($p);

      $now = ruletaNowMs();
      $claimable = !empty($prize['claimable']);
      // un solo tiempo de vencimiento para cualquier premio de la ruleta,
      // configurado una vez (no por premio individual)
      $expiryHours = isset($state['prizeExpiryHours']) && $state['prizeExpiryHours'] > 0 ? (float) $state['prizeExpiryHours'] : 24;
      // El código en sí (con su vencimiento, entrega y estado) vive en el
      // libro compartido de códigos — el mismo que usan cronómetro/
      // fidelidad/reto/juego — así el cliente reclama un premio de la
      // Ruleta exactamente igual que cualquier otro, con el botón
      // "Reclamar premio".
      $codeRecord = $claimable ? issuePrizeCode($deviceId, $name, 'ruleta', $prize['name'], $prize['icon'], $expiryHours) : null;
      $result = array(
        'prizeId' => $prize['id'],
        'prizeName' => $prize['name'],
        'code' => $codeRecord ? $codeRecord['code'] : null,
        'claimable' => $claimable,
        'spunAt' => $now,
        'codeExpiresAt' => $codeRecord ? $codeRecord['expiresAt'] : null,
      );

      $state['tickets'][$ticketIdx]['status'] = 'used';
      $state['tickets'][$ticketIdx]['name'] = $name !== '' ? $name : $state['tickets'][$ticketIdx]['name'];
      $state['tickets'][$ticketIdx]['result'] = $result;

      $outcome = array(
        'ok' => true,
        'prize' => publicPrize($prize),
        'result' => $result,
        'myTickets' => myAvailableTickets($state, $deviceId),
      );
      return $state;
    });

    jsonOut($outcome, $outcome['ok'] ? 200 : 400);
  }

  case 'admin-config': {
    requireAdminAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();

    $prizesIn = isset($body['prizes']) && is_array($body['prizes']) ? $body['prizes'] : array();
    $prizesOut = array();
    foreach ($prizesIn as $p) {
      if (!is_array($p)) continue;
      $prizesOut[] = array(
        'id' => isset($p['id']) && $p['id'] !== '' ? (string) $p['id'] : uniqid('prz_', true),
        'name' => isset($p['name']) ? (string) $p['name'] : '',
        'description' => isset($p['description']) ? (string) $p['description'] : '',
        'icon' => isset($p['icon']) ? (string) $p['icon'] : '🎁',
        'color' => isset($p['color']) ? (string) $p['color'] : '#ffd400',
        'probability' => isset($p['probability']) ? (float) $p['probability'] : 0,
        'inventory' => isset($p['inventory']) ? (int) $p['inventory'] : -1,
        'dailyLimit' => isset($p['dailyLimit']) ? (int) $p['dailyLimit'] : -1,
        'weeklyLimit' => isset($p['weeklyLimit']) ? (int) $p['weeklyLimit'] : -1,
        'active' => !empty($p['active']),
        'claimable' => !empty($p['claimable']),
        'startDate' => isset($p['startDate']) ? (string) $p['startDate'] : '',
        'endDate' => isset($p['endDate']) ? (string) $p['endDate'] : '',
        'order' => isset($p['order']) ? (int) $p['order'] : 0,
      );
    }

    $final = ruletaWithWriteLock(function ($state) use ($body, $prizesOut) {
      $state['active'] = !empty($body['active']);
      $state['title'] = isset($body['title']) && $body['title'] !== '' ? (string) $body['title'] : 'RULETA TOPPINGS';
      $state['whatsappNumber'] = isset($body['whatsappNumber']) ? (string) $body['whatsappNumber'] : '';
      $state['soundEnabled'] = !empty($body['soundEnabled']);
      $state['confettiEnabled'] = !empty($body['confettiEnabled']);
      $state['prizeExpiryHours'] = isset($body['prizeExpiryHours']) && $body['prizeExpiryHours'] > 0 ? (float) $body['prizeExpiryHours'] : 24;
      $state['prizes'] = $prizesOut;
      return $state;
    });

    $sum = 0;
    foreach ($final['prizes'] as $p) { if (!empty($p['active'])) $sum += (float) $p['probability']; }
    jsonOut(array('ok' => true, 'probabilitySum' => round($sum, 2)));
  }

  case 'admin-status': {
    requireAdminAuth();
    $state = ruletaWithWriteLock(function ($s) { ruletaExpireTickets($s); return $s; });

    // Estas estadísticas son solo de la MECÁNICA de la ruleta (tiros
    // otorgados/usados/disponibles/vencidos, giros de hoy). El ciclo de vida
    // del código del premio en sí (disponible/esperando entrega/entregado/
    // vencido/anulado) ahora vive en el libro compartido — ver la pestaña
    // "Premio del día" para esas estadísticas y la búsqueda de códigos.
    $totalSpins = 0; $issued = 0; $used = 0; $available = 0; $expired = 0;
    $byPrize = array();
    $participants = array();
    $today = date('Y-m-d');
    $spinsToday = 0;

    foreach ($state['tickets'] as $t) {
      $issued++;
      $participants[$t['deviceId']] = true;
      if ($t['status'] === 'available') $available++;
      elseif ($t['status'] === 'expired') $expired++;
      elseif ($t['status'] === 'used') {
        $used++;
        $totalSpins++;
        if (isset($t['grantedAt']) && date('Y-m-d', (int) round($t['result']['spunAt'] / 1000)) === $today) $spinsToday++;
        if (!empty($t['result']['prizeName'])) {
          $pn = $t['result']['prizeName'];
          if (!isset($byPrize[$pn])) $byPrize[$pn] = 0;
          $byPrize[$pn]++;
        }
      }
    }
    arsort($byPrize);
    $mostWon = $byPrize ? array_key_first($byPrize) : null;

    $prizes = $state['prizes'];
    usort($prizes, function ($a, $b) { return (int) $a['order'] - (int) $b['order']; });

    jsonOut(array(
      'ok' => true,
      'active' => !!$state['active'],
      'title' => $state['title'],
      'whatsappNumber' => $state['whatsappNumber'],
      'soundEnabled' => !!$state['soundEnabled'],
      'confettiEnabled' => !!$state['confettiEnabled'],
      'prizeExpiryHours' => isset($state['prizeExpiryHours']) && $state['prizeExpiryHours'] > 0 ? (float) $state['prizeExpiryHours'] : 24,
      'prizes' => array_values($prizes),
      'stats' => array(
        'totalSpins' => $totalSpins,
        'ticketsIssued' => $issued,
        'ticketsUsed' => $used,
        'ticketsAvailable' => $available,
        'ticketsExpired' => $expired,
        'prizesWon' => $used,
        'participants' => count($participants),
        'mostWonPrize' => $mostWon,
        'spinsToday' => $spinsToday,
      ),
    ));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
