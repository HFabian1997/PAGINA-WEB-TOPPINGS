<?php
/**
 * Avisos para los clientes: Fabián le escribe a una persona (o a todos) y le
 * sale una ventana en la página, además de quedar guardado en el botón 🎁 por
 * si la cierra sin leer — para que un código de premio no se pierda.
 *
 * Un aviso con deviceId "*" es para todos. `readBy` sirve para los dos casos:
 * en uno personal marca que ya lo vio, y en uno para todos lleva la lista de
 * quién lo leyó, sin tener que crear una copia por persona.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';
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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$DATA_FILE = toppingsDataFile('notifications.json');
$LOCK_FILE = toppingsDataFile('notifications.lock');
$MAX_ITEMS = 300;
$MAX_TITLE = 80;
$MAX_MSG = 600;

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }
function nNowMs() { return (int) round(microtime(true) * 1000); }
function nRequireAdmin() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

function nRead() {
  global $DATA_FILE;
  if (!file_exists($DATA_FILE)) return array('items' => array());
  $raw = @file_get_contents($DATA_FILE);
  $d = $raw ? json_decode($raw, true) : null;
  if (!is_array($d) || !isset($d['items']) || !is_array($d['items'])) return array('items' => array());
  return $d;
}

function nWriteAtomic($state) {
  global $DATA_FILE;
  $dir = dirname($DATA_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $tmp = $DATA_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
  if (@file_put_contents($tmp, $json) === false) return false;
  if (!@rename($tmp, $DATA_FILE)) { @unlink($tmp); return false; }
  return true;
}

function nWithLock($cb) {
  global $LOCK_FILE;
  $dir = dirname($LOCK_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $fp = @fopen($LOCK_FILE, 'c');
  if (!$fp) return null;
  flock($fp, LOCK_EX);
  $state = nRead();
  $res = $cb($state);
  if (is_array($res)) nWriteAtomic($res);
  flock($fp, LOCK_UN);
  fclose($fp);
  return is_array($res) ? $res : $state;
}

/** Normaliza el premio que lleva un aviso, si es que lleva alguno. */
function nNormalizePrize($body) {
  $tipo = isset($body['prizeType']) ? (string) $body['prizeType'] : 'none';
  if (!in_array($tipo, array('none', 'direct', 'wheelSpins', 'code'), true)) $tipo = 'none';
  if ($tipo === 'none') return array('prizeType' => 'none');
  if ($tipo === 'code') {
    $codigo = isset($body['redeemCode']) ? trim((string) $body['redeemCode']) : '';
    if ($codigo === '') return array('prizeType' => 'none');
    return array('prizeType' => 'code', 'redeemCode' => $codigo);
  }
  if ($tipo === 'wheelSpins') {
    return array(
      'prizeType' => 'wheelSpins',
      'wheelSpinCount' => isset($body['wheelSpinCount']) && (int) $body['wheelSpinCount'] > 0 ? (int) $body['wheelSpinCount'] : 1,
      'prizeExpiryHours' => isset($body['prizeExpiryHours']) && $body['prizeExpiryHours'] > 0 ? (float) $body['prizeExpiryHours'] : 24,
    );
  }
  return array(
    'prizeType' => 'direct',
    'prizeName' => isset($body['prizeName']) && $body['prizeName'] !== '' ? (string) $body['prizeName'] : 'Premio especial',
    'prizeIcon' => isset($body['prizeIcon']) && $body['prizeIcon'] !== '' ? (string) $body['prizeIcon'] : '🎁',
    'prizeExpiryHours' => isset($body['prizeExpiryHours']) && $body['prizeExpiryHours'] > 0 ? (float) $body['prizeExpiryHours'] : 24,
  );
}

/**
 * Entrega el premio de un aviso a un dispositivo, con los mecanismos que ya
 * existen. "code" no entrega nada: el código ya vive en redeem-codes.json y lo
 * canjea el cliente con el flujo de siempre.
 */
function nEntregarPremio($item, $deviceId, $name) {
  $tipo = isset($item['prizeType']) ? $item['prizeType'] : 'none';
  if ($tipo === 'wheelSpins') {
    $ids = grantRuletaTickets($deviceId, $name, 'aviso',
      isset($item['wheelSpinCount']) ? (int) $item['wheelSpinCount'] : 1,
      isset($item['prizeExpiryHours']) ? (float) $item['prizeExpiryHours'] : 24);
    return count($ids) > 0;
  }
  if ($tipo === 'direct') {
    $rec = issuePrizeCode($deviceId, $name, 'aviso',
      isset($item['prizeName']) ? $item['prizeName'] : 'Premio especial',
      isset($item['prizeIcon']) ? $item['prizeIcon'] : '🎁',
      isset($item['prizeExpiryHours']) ? (float) $item['prizeExpiryHours'] : 24);
    return !!$rec;
  }
  return false;
}

/** ¿Este aviso le toca a este dispositivo y todavía no lo leyó? */
function nPendiente($item, $deviceId) {
  $paraTodos = isset($item['deviceId']) && $item['deviceId'] === '*';
  $paraEl = isset($item['deviceId']) && $item['deviceId'] === $deviceId;
  if (!$paraTodos && !$paraEl) return false;
  $leidos = isset($item['readBy']) && is_array($item['readBy']) ? $item['readBy'] : array();
  return !in_array($deviceId, $leidos, true);
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

  /* ---------------- el cliente pregunta si tiene avisos ---------------- */
  case 'mine': {
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    $name = isset($_GET['name']) ? trim((string) $_GET['name']) : '';
    if ($deviceId === '') jsonOut(array('ok' => true, 'items' => array()));

    /* Un aviso PARA TODOS que lleva premio no se puede entregar al enviarlo:
       en ese momento no se sabe a quién. Se entrega acá, la primera vez que
       cada dispositivo lo recibe, y queda anotado en grantedTo para no
       repetirlo. Es una escritura dentro de una consulta, como ya hace
       expireCodes() — solo ocurre una vez por persona y por aviso. */
    $state = nWithLock(function ($st) use ($deviceId, $name) {
      $cambio = false;
      foreach ($st['items'] as &$it) {
        if (!isset($it['deviceId']) || $it['deviceId'] !== '*') continue;
        $tipo = isset($it['prizeType']) ? $it['prizeType'] : 'none';
        if ($tipo !== 'direct' && $tipo !== 'wheelSpins') continue;
        if (!nPendiente($it, $deviceId)) continue;
        if (!isset($it['grantedTo']) || !is_array($it['grantedTo'])) $it['grantedTo'] = array();
        if (in_array($deviceId, $it['grantedTo'], true)) continue;
        if (nEntregarPremio($it, $deviceId, $name)) {
          $it['grantedTo'][] = $deviceId;
          $cambio = true;
        }
      }
      unset($it);
      return $cambio ? $st : null;
    });
    if (!is_array($state)) $state = nRead();

    $out = array();
    foreach ($state['items'] as $it) {
      if (!nPendiente($it, $deviceId)) continue;
      $out[] = array(
        'id' => $it['id'],
        'title' => isset($it['title']) ? $it['title'] : '',
        'message' => isset($it['message']) ? $it['message'] : '',
        'createdAt' => isset($it['createdAt']) ? $it['createdAt'] : null,
        'prizeType' => isset($it['prizeType']) ? $it['prizeType'] : 'none',
        // solo lo que el botón necesita; el resto no le sirve al cliente
        'redeemCode' => isset($it['redeemCode']) ? $it['redeemCode'] : null,
        'prizeName' => isset($it['prizeName']) ? $it['prizeName'] : null,
        'wheelSpinCount' => isset($it['wheelSpinCount']) ? (int) $it['wheelSpinCount'] : 0,
      );
    }
    usort($out, function ($a, $b) { return (int) $a['createdAt'] - (int) $b['createdAt']; });
    jsonOut(array('ok' => true, 'items' => $out, 'serverNow' => nNowMs()));
  }

  /* ---------------- el cliente lo marca como leído ---------------- */
  case 'read': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $id = isset($body['id']) ? trim((string) $body['id']) : '';
    if ($deviceId === '' || $id === '') jsonOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);

    nWithLock(function ($state) use ($deviceId, $id) {
      $cambio = false;
      foreach ($state['items'] as &$it) {
        if (!isset($it['id']) || $it['id'] !== $id) continue;
        if (!isset($it['readBy']) || !is_array($it['readBy'])) $it['readBy'] = array();
        if (!in_array($deviceId, $it['readBy'], true)) { $it['readBy'][] = $deviceId; $cambio = true; }
      }
      unset($it);
      return $cambio ? $state : null;
    });
    jsonOut(array('ok' => true));
  }

  /* ---------------- panel: enviar ---------------- */
  case 'admin-send': {
    nRequireAdmin();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $title = isset($body['title']) ? trim((string) $body['title']) : '';
    $message = isset($body['message']) ? trim((string) $body['message']) : '';
    if ($deviceId === '') jsonOut(array('ok' => false, 'error' => 'Falta a quién enviarlo.'), 400);
    if ($message === '') jsonOut(array('ok' => false, 'error' => 'Escribe el mensaje.'), 400);
    if (function_exists('mb_substr')) {
      $title = mb_substr($title, 0, $MAX_TITLE);
      $message = mb_substr($message, 0, $MAX_MSG);
    }

    $premio = nNormalizePrize($body);
    $entregado = false;

    $creado = null;
    nWithLock(function ($state) use ($deviceId, $title, $message, $premio, &$creado, &$entregado) {
      global $MAX_ITEMS;
      $creado = array_merge(array(
        'id' => uniqid('ntf_', true),
        'deviceId' => $deviceId,           // "*" = para todos
        'title' => $title !== '' ? $title : '📣 TOPPINGS',
        'message' => $message,
        'createdAt' => nNowMs(),
        'readBy' => array(),
        'grantedTo' => array(),
      ), $premio);

      /* A una sola persona el premio se entrega ya. Al enviarlo a todos no se
         puede: se entrega cuando cada uno lo recibe (ver la acción "mine"). */
      if ($deviceId !== '*' && ($premio['prizeType'] === 'direct' || $premio['prizeType'] === 'wheelSpins')) {
        if (nEntregarPremio($creado, $deviceId, '')) {
          $creado['grantedTo'][] = $deviceId;
          $entregado = true;
        }
      }

      $state['items'][] = $creado;
      if (count($state['items']) > $MAX_ITEMS) {
        usort($state['items'], function ($a, $b) { return (int) $b['createdAt'] - (int) $a['createdAt']; });
        $state['items'] = array_slice($state['items'], 0, $MAX_ITEMS);
      }
      return $state;
    });
    jsonOut(array(
      'ok' => true,
      'id' => $creado ? $creado['id'] : null,
      'prizeType' => $premio['prizeType'],
      'granted' => $entregado,
    ));
  }

  /* ---------------- panel: ver los enviados ---------------- */
  case 'admin-list': {
    nRequireAdmin();
    $state = nRead();
    $items = $state['items'];
    usort($items, function ($a, $b) { return (int) $b['createdAt'] - (int) $a['createdAt']; });
    $out = array();
    foreach (array_slice($items, 0, 100) as $it) {
      $out[] = array(
        'id' => $it['id'],
        'deviceId' => $it['deviceId'],
        'toAll' => $it['deviceId'] === '*',
        'title' => isset($it['title']) ? $it['title'] : '',
        'message' => isset($it['message']) ? $it['message'] : '',
        'createdAt' => $it['createdAt'],
        'readCount' => isset($it['readBy']) && is_array($it['readBy']) ? count($it['readBy']) : 0,
        'prizeType' => isset($it['prizeType']) ? $it['prizeType'] : 'none',
        'prizeName' => isset($it['prizeName']) ? $it['prizeName'] : null,
        'redeemCode' => isset($it['redeemCode']) ? $it['redeemCode'] : null,
        'wheelSpinCount' => isset($it['wheelSpinCount']) ? (int) $it['wheelSpinCount'] : 0,
        'grantedCount' => isset($it['grantedTo']) && is_array($it['grantedTo']) ? count($it['grantedTo']) : 0,
      );
    }
    jsonOut(array('ok' => true, 'items' => $out, 'serverNow' => nNowMs()));
  }

  /* ---------------- panel: borrar uno ---------------- */
  case 'admin-delete': {
    nRequireAdmin();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $id = isset($body['id']) ? trim((string) $body['id']) : '';
    if ($id === '') jsonOut(array('ok' => false, 'error' => 'Falta el aviso.'), 400);
    nWithLock(function ($state) use ($id) {
      $state['items'] = array_values(array_filter($state['items'], function ($it) use ($id) {
        return !isset($it['id']) || $it['id'] !== $id;
      }));
      return $state;
    });
    jsonOut(array('ok' => true));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
