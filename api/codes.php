<?php
/**
 * Códigos de premio unificados — sin base de datos, mismo patrón de archivo
 * JSON con escritura atómica + candado que ya usan premio.php/
 * run-leaderboard.php/ruleta.php. Cubre TODAS las dinámicas (cronómetro,
 * fidelidad, reto, Toppings Run, Ruleta): un solo código, un solo flujo de
 * "Reclamar premio" (cliente) -> "Entregar premio" (empleado con PIN).
 *
 * Estados de un código, siempre uno solo:
 *   available  -> recién ganado, el cliente todavía no pidió la entrega
 *   waiting    -> el cliente ya pidió la entrega, esperando a un empleado
 *   delivered  -> un empleado confirmó la entrega
 *   expired    -> venció el plazo sin llegar a "delivered"
 *   void       -> anulado a mano desde el panel admin
 */
date_default_timezone_set('America/Bogota');
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

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }

function requireAdminAuth() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

/** PIN de empleados configurado desde el panel admin (distinto de la clave de admin). */
function employeePin() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return '';
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  return is_array($content) && isset($content['deliverySettings']['pin']) ? trim((string) $content['deliverySettings']['pin']) : '';
}

function checkEmployeePin($submitted) {
  $real = employeePin();
  $submitted = trim((string) $submitted);
  if ($real === '' || $submitted === '') return false;
  return hash_equals($real, $submitted);
}

/** Vista pública de un código (nunca expone deviceId). */
function publicCodeView($c) {
  return array(
    'code' => $c['code'], 'prizeName' => $c['prizeName'], 'prizeIcon' => $c['prizeIcon'],
    'source' => $c['source'], 'status' => $c['status'], 'issuedAt' => $c['issuedAt'], 'expiresAt' => $c['expiresAt'],
  );
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {

  case 'lookup': {
    $code = isset($_GET['code']) ? trim((string) $_GET['code']) : '';
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    if ($code === '' || $deviceId === '') jsonOut(array('ok' => true, 'reason' => 'not_found'));

    $reason = 'not_found';
    $found = null;
    codesWithWriteLock(function ($state) use ($code, $deviceId, &$reason, &$found) {
      expireCodes($state);
      $idx = findCodeIndex($state['codes'], $code);
      if ($idx === null) { $reason = 'not_found'; return $state; }
      $c = $state['codes'][$idx];
      if (!hash_equals((string) $c['deviceId'], (string) $deviceId)) { $reason = 'wrong_device'; return $state; }
      if ($c['status'] === 'void') { $reason = 'void'; return $state; }
      if ($c['status'] === 'expired') { $reason = 'expired'; return $state; }
      if ($c['status'] === 'waiting') { $reason = 'already_waiting'; return $state; }
      if ($c['status'] === 'delivered') { $reason = 'already_delivered'; return $state; }
      $reason = 'ok';
      $found = $c;
      return $state;
    });

    if ($reason !== 'ok') jsonOut(array('ok' => true, 'reason' => $reason));
    jsonOut(array('ok' => true, 'reason' => 'ok', 'prize' => publicCodeView($found)));
  }

  case 'request-delivery': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $code = isset($body['code']) ? trim((string) $body['code']) : '';
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if ($code === '' || $deviceId === '') jsonOut(array('ok' => false, 'reason' => 'not_found'), 400);

    $reason = 'not_found';
    $result = null;
    codesWithWriteLock(function ($state) use ($code, $deviceId, $name, &$reason, &$result) {
      expireCodes($state);
      $idx = findCodeIndex($state['codes'], $code);
      if ($idx === null) { $reason = 'not_found'; return $state; }
      $c = &$state['codes'][$idx];
      if (!hash_equals((string) $c['deviceId'], (string) $deviceId)) { $reason = 'wrong_device'; return $state; }
      if ($c['status'] === 'void') { $reason = 'void'; return $state; }
      if ($c['status'] === 'expired') { $reason = 'expired'; return $state; }
      if ($c['status'] === 'waiting') { $reason = 'already_waiting'; return $state; }
      if ($c['status'] === 'delivered') { $reason = 'already_delivered'; return $state; }
      $c['status'] = 'waiting';
      $c['requestedAt'] = codesNowMs();
      if ($name !== '') $c['name'] = $name;
      $reason = 'ok';
      $result = $c;
      unset($c);
      return $state;
    });

    if ($reason !== 'ok') jsonOut(array('ok' => false, 'reason' => $reason), 400);
    jsonOut(array('ok' => true, 'prize' => publicCodeView($result)));
  }

  case 'my-status': {
    $code = isset($_GET['code']) ? trim((string) $_GET['code']) : '';
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    if ($code === '' || $deviceId === '') jsonOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);

    $found = null;
    codesWithWriteLock(function ($state) use ($code, $deviceId, &$found) {
      expireCodes($state);
      $idx = findCodeIndex($state['codes'], $code);
      if ($idx !== null && hash_equals((string) $state['codes'][$idx]['deviceId'], (string) $deviceId)) {
        $found = $state['codes'][$idx];
      }
      return $state;
    });

    if (!$found) jsonOut(array('ok' => false, 'error' => 'No encontrado.'), 404);
    jsonOut(array('ok' => true, 'status' => $found['status'], 'deliveredAt' => $found['deliveredAt']));
  }

  case 'mine': {
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    if ($deviceId === '') jsonOut(array('ok' => true, 'codes' => array()));

    $mine = array();
    codesWithWriteLock(function ($state) use ($deviceId, &$mine) {
      expireCodes($state);
      $now = codesNowMs();
      foreach ($state['codes'] as $c) {
        if (!hash_equals((string) $c['deviceId'], (string) $deviceId)) continue;
        $pending = $c['status'] === 'available' || $c['status'] === 'waiting';
        // los que acaban de vencer se muestran igual (en rojo) durante 24h,
        // para que el cliente se entere y los pueda cerrar — después de eso
        // dejan de aparecer solos, sin borrar nada del archivo
        $recentlyExpired = $c['status'] === 'expired' && isset($c['expiresAt']) && ($now - $c['expiresAt']) < 24 * 60 * 60 * 1000;
        if ($pending || $recentlyExpired) $mine[] = publicCodeView($c);
      }
      return $state;
    });
    jsonOut(array('ok' => true, 'codes' => $mine));
  }

  case 'employee-pending': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $pin = isset($body['pin']) ? (string) $body['pin'] : '';
    if (!checkEmployeePin($pin)) jsonOut(array('ok' => false, 'error' => 'PIN incorrecto.'), 401);

    $list = array();
    codesWithWriteLock(function ($state) use (&$list) {
      expireCodes($state);
      foreach ($state['codes'] as $c) {
        if ($c['status'] === 'waiting') {
          $list[] = array(
            'code' => $c['code'], 'name' => $c['name'], 'prizeName' => $c['prizeName'],
            'prizeIcon' => $c['prizeIcon'], 'source' => $c['source'], 'requestedAt' => $c['requestedAt'],
          );
        }
      }
      return $state;
    });
    usort($list, function ($a, $b) { return $a['requestedAt'] - $b['requestedAt']; });
    jsonOut(array('ok' => true, 'pending' => $list));
  }

  case 'employee-deliver': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $pin = isset($body['pin']) ? (string) $body['pin'] : '';
    if (!checkEmployeePin($pin)) jsonOut(array('ok' => false, 'error' => 'PIN incorrecto.'), 401);
    $code = isset($body['code']) ? trim((string) $body['code']) : '';
    $employeeName = isset($body['employeeName']) ? trim((string) $body['employeeName']) : '';
    if ($employeeName === '') $employeeName = 'Empleado';
    if ($code === '') jsonOut(array('ok' => false, 'error' => 'Falta el código.'), 400);

    $errorMsg = null;
    codesWithWriteLock(function ($state) use ($code, $employeeName, &$errorMsg) {
      expireCodes($state);
      $idx = findCodeIndex($state['codes'], $code);
      if ($idx === null) { $errorMsg = 'No se encontró ese código.'; return $state; }
      if ($state['codes'][$idx]['status'] !== 'waiting') { $errorMsg = 'Este código ya no está esperando entrega.'; return $state; }
      $state['codes'][$idx]['status'] = 'delivered';
      $state['codes'][$idx]['deliveredAt'] = codesNowMs();
      $state['codes'][$idx]['deliveredBy'] = $employeeName;
      return $state;
    });

    if ($errorMsg) jsonOut(array('ok' => false, 'error' => $errorMsg), 400);
    jsonOut(array('ok' => true));
  }

  case 'admin-search': {
    requireAdminAuth();
    $q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
    $statusFilter = isset($_GET['status']) ? trim((string) $_GET['status']) : '';
    $state = codesWithWriteLock(function ($s) { expireCodes($s); return $s; });
    $results = array();
    $qLower = mb_strtolower($q);
    foreach ($state['codes'] as $c) {
      if ($statusFilter !== '' && $c['status'] !== $statusFilter) continue;
      if ($q !== '') {
        $nameMatch = strpos(mb_strtolower((string) $c['name']), $qLower) !== false;
        $codeMatch = strcasecmp((string) $c['code'], $q) === 0;
        if (!$nameMatch && !$codeMatch) continue;
      }
      $results[] = array(
        'code' => $c['code'], 'name' => $c['name'], 'source' => $c['source'], 'prizeName' => $c['prizeName'],
        'status' => $c['status'], 'issuedAt' => $c['issuedAt'], 'expiresAt' => $c['expiresAt'],
        'requestedAt' => $c['requestedAt'], 'deliveredAt' => $c['deliveredAt'], 'deliveredBy' => $c['deliveredBy'],
      );
    }
    usort($results, function ($a, $b) { return $b['issuedAt'] - $a['issuedAt']; });
    jsonOut(array('ok' => true, 'results' => array_slice($results, 0, 100)));
  }

  case 'admin-void': {
    requireAdminAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $code = isset($body['code']) ? trim((string) $body['code']) : '';
    if ($code === '') jsonOut(array('ok' => false, 'error' => 'Falta el código.'), 400);

    $errorMsg = null;
    codesWithWriteLock(function ($state) use ($code, &$errorMsg) {
      $idx = findCodeIndex($state['codes'], $code);
      if ($idx === null) { $errorMsg = 'No se encontró ese código.'; return $state; }
      if ($state['codes'][$idx]['status'] === 'delivered') { $errorMsg = 'No se puede anular un premio ya entregado.'; return $state; }
      $state['codes'][$idx]['status'] = 'void';
      return $state;
    });

    if ($errorMsg) jsonOut(array('ok' => false, 'error' => $errorMsg), 400);
    jsonOut(array('ok' => true));
  }

  case 'admin-stats': {
    requireAdminAuth();
    $state = codesWithWriteLock(function ($s) { expireCodes($s); return $s; });

    $byStatus = array('available' => 0, 'waiting' => 0, 'delivered' => 0, 'expired' => 0, 'void' => 0);
    $bySource = array();
    $byPrize = array();
    foreach ($state['codes'] as $c) {
      if (isset($byStatus[$c['status']])) $byStatus[$c['status']]++;
      if (!isset($bySource[$c['source']])) $bySource[$c['source']] = 0;
      $bySource[$c['source']]++;
      if ($c['status'] === 'delivered') {
        if (!isset($byPrize[$c['prizeName']])) $byPrize[$c['prizeName']] = 0;
        $byPrize[$c['prizeName']]++;
      }
    }
    arsort($byPrize);
    $mostDelivered = $byPrize ? array_key_first($byPrize) : null;

    jsonOut(array(
      'ok' => true,
      'total' => count($state['codes']),
      'byStatus' => $byStatus,
      'bySource' => $bySource,
      'mostDeliveredPrize' => $mostDelivered,
    ));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
