<?php
/**
 * Canjear Código de Premio — el admin define una palabra (o cualquier texto)
 * en el panel y la reparte; el cliente la escribe en el panel 🎁 y se le
 * desbloquea el premio, que después reclama igual que cualquier otro (con el
 * botón "Reclamar" y el PIN del empleado).
 *
 * Solo hay DOS formas de pagar, y las dos ya existían:
 *   - issuePrizeCode()      -> cualquier premio que entregue un mesero
 *                              (producto gratis, descuento, bebida, adición,
 *                              participación especial, o lo que se invente
 *                              después: el premio es texto que el admin
 *                              escribe, no una opción del código)
 *   - grantRuletaTickets()  -> un tiro en la Ruleta
 *
 * Mismo molde que ruleta.php: jsonOut(), sesión toppings_admin_sess,
 * requireAdminAuth().
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/redeem-lib.php';
require_once __DIR__ . '/codes-lib.php';
require_once __DIR__ . '/ruleta-lib.php';

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

$MAX_NAME_CHARS = 60;
$MAX_CODE_CHARS = 60;

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }

function requireAdminAuth() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';

$body = null;
if ($method === 'POST') {
  $parsed = json_decode(file_get_contents('php://input'), true);
  $body = is_array($parsed) ? $parsed : array();
  // La acción se lee también del cuerpo, como en premio.php: no hacerlo es
  // exactamente el fallo que dejó el cambio de nombre sin efecto en el
  // ranking durante días, respondiendo ok:false en silencio.
  if ($action === '' && isset($body['action'])) $action = (string) $body['action'];
} else {
  $body = array();
}

switch ($action) {

  /* ---------------- público: canjear ---------------- */
  case 'redeem': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);

    $code = isset($body['code']) ? trim((string) $body['code']) : '';
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if (function_exists('mb_substr')) {
      $name = mb_substr($name, 0, $MAX_NAME_CHARS);
      $code = mb_substr($code, 0, $MAX_CODE_CHARS);
    }
    if ($code === '') jsonOut(array('ok' => false, 'reason' => 'not_found'), 400);
    if ($deviceId === '') jsonOut(array('ok' => false, 'error' => 'Falta identificar el dispositivo.'), 400);

    $outcome = array('ok' => false, 'reason' => 'not_found');

    // Validar, contar, pagar y registrar ocurre TODO dentro de un mismo
    // candado. Si no, dos personas canjeando el último cupo al mismo tiempo
    // lo obtendrían las dos.
    redeemWithWriteLock(function ($state) use ($code, $deviceId, $name, &$outcome) {
      $idx = redeemFindCodeIndex($state['codes'], $code);
      if ($idx === null) { $outcome = array('ok' => false, 'reason' => 'not_found'); return null; }

      $c = $state['codes'][$idx];
      if (empty($c['active'])) { $outcome = array('ok' => false, 'reason' => 'inactive'); return null; }

      $now = redeemNowMs();
      if (isset($c['expiresAt']) && $c['expiresAt'] !== null && $now >= (int) $c['expiresAt']) {
        $outcome = array('ok' => false, 'reason' => 'expired');
        return null;
      }

      $uses = redeemCountUses($state, $c['id'], $deviceId);
      $perPerson = isset($c['usesPerPerson']) && (int) $c['usesPerPerson'] > 0 ? (int) $c['usesPerPerson'] : 1;
      if ($uses['mine'] >= $perPerson) { $outcome = array('ok' => false, 'reason' => 'already_used'); return null; }

      $maxUses = isset($c['maxUses']) ? (int) $c['maxUses'] : -1;
      if ($maxUses >= 0 && $uses['total'] >= $maxUses) { $outcome = array('ok' => false, 'reason' => 'max_uses'); return null; }

      // Se paga con los mecanismos que ya existen — el premio en sí es texto
      // que el admin escribió, así que agregar un premio nuevo en el futuro
      // no requiere tocar nada de este archivo.
      $granted = null;
      if (isset($c['rewardType']) && $c['rewardType'] === 'wheelSpins') {
        $count = isset($c['wheelSpinCount']) && (int) $c['wheelSpinCount'] > 0 ? (int) $c['wheelSpinCount'] : 1;
        $hours = isset($c['wheelTicketExpiryHours']) && $c['wheelTicketExpiryHours'] > 0 ? (float) $c['wheelTicketExpiryHours'] : 24;
        $ids = grantRuletaTickets($deviceId, $name, 'redeem', $count, $hours);
        if (!$ids) { $outcome = array('ok' => false, 'error' => 'No se pudo otorgar el premio. Intenta de nuevo.'); return null; }
        $granted = array('type' => 'wheelSpins', 'count' => count($ids), 'ticketIds' => $ids);
        $outcome = array(
          'ok' => true,
          'rewardType' => 'wheelSpins',
          'spins' => count($ids),
          'prizeName' => $count > 1 ? ($count . ' tiros en la Ruleta') : 'Un tiro en la Ruleta',
          'prizeIcon' => '🎡',
        );
      } else {
        $prizeName = isset($c['prizeName']) && $c['prizeName'] !== '' ? (string) $c['prizeName'] : 'Premio especial';
        $prizeIcon = isset($c['prizeIcon']) && $c['prizeIcon'] !== '' ? (string) $c['prizeIcon'] : '🎁';
        $hours = isset($c['prizeExpiryHours']) && $c['prizeExpiryHours'] > 0 ? (float) $c['prizeExpiryHours'] : 24;
        $record = issuePrizeCode($deviceId, $name, 'redeem', $prizeName, $prizeIcon, $hours);
        if (!$record) { $outcome = array('ok' => false, 'error' => 'No se pudo otorgar el premio. Intenta de nuevo.'); return null; }
        $granted = array('type' => 'prize', 'prizeCode' => $record['code'], 'prizeName' => $prizeName);
        $outcome = array(
          'ok' => true,
          'rewardType' => 'prize',
          'prizeName' => $prizeName,
          'prizeIcon' => $prizeIcon,
          'expiresAt' => $record['expiresAt'],
        );
      }

      // Se registra recién después de pagar: si el pago falló, el cupo no se
      // consume.
      $state['redemptions'][] = array(
        'codeId' => $c['id'],
        'code' => $c['code'],
        'deviceId' => $deviceId,
        'name' => $name,
        'redeemedAt' => $now,
        'granted' => $granted,
      );
      return $state;
    });

    jsonOut($outcome, $outcome['ok'] ? 200 : 400);
  }

  /* ---------------- panel: leer ---------------- */
  case 'admin-list': {
    requireAdminAuth();
    $state = redeemReadState();
    $codes = array();
    foreach ($state['codes'] as $c) {
      $uses = redeemCountUses($state, $c['id'], '');
      $c['usedCount'] = $uses['total'];
      $c['redemptions'] = array();
      foreach ($state['redemptions'] as $r) {
        if (isset($r['codeId']) && $r['codeId'] === $c['id']) {
          $c['redemptions'][] = array(
            'name' => isset($r['name']) ? $r['name'] : '',
            'redeemedAt' => isset($r['redeemedAt']) ? $r['redeemedAt'] : null,
          );
        }
      }
      $codes[] = $c;
    }
    jsonOut(array('ok' => true, 'codes' => $codes, 'serverNow' => redeemNowMs()));
  }

  /* ---------------- panel: guardar la lista completa ---------------- */
  case 'admin-save': {
    requireAdminAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);

    $codesIn = isset($body['codes']) && is_array($body['codes']) ? $body['codes'] : array();
    $codesOut = array();
    $vistos = array();
    foreach ($codesIn as $c) {
      $norm = redeemNormalizeCode($c);
      if (!$norm) continue;
      // dos cupones con la misma palabra harían que uno nunca se pudiera
      // canjear (la búsqueda encuentra el primero), así que se rechaza
      $lower = function_exists('mb_strtolower') ? mb_strtolower($norm['code']) : strtolower($norm['code']);
      if (isset($vistos[$lower])) {
        jsonOut(array('ok' => false, 'error' => 'Hay dos códigos con la misma palabra: "' . $norm['code'] . '". Cada código debe ser distinto.'), 400);
      }
      $vistos[$lower] = true;
      $codesOut[] = $norm;
    }

    // Los canjes ya hechos NO se tocan: son el registro histórico de quién usó
    // qué. Si se elimina un cupón, sus canjes quedan huérfanos y dejan de
    // contarse, que es justo lo que se espera.
    redeemWithWriteLock(function ($state) use ($codesOut) {
      $state['codes'] = $codesOut;
      return $state;
    });

    jsonOut(array('ok' => true, 'count' => count($codesOut)));
  }

  /* ---------------- panel: generar una palabra al azar ---------------- */
  case 'admin-gen': {
    requireAdminAuth();
    jsonOut(array('ok' => true, 'code' => genPrizeCode()));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
