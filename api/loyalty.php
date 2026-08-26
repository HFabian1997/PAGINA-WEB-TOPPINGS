<?php
/**
 * 🎟️ Tarjeta de fidelidad — endpoints del cliente y del panel.
 *
 * El reclamo del premio NO está acá: sigue en premio.php (action=claim con
 * method=loyalty), que es donde se entregan todos los premios del sitio. Lo
 * que hace premio.php ahora es preguntarle a loyalty-lib.php si la tarjeta
 * está completa antes de entregar nada, y vaciarla al entregarlo.
 *
 * Acá viven las otras tres cosas: consultar la tarjeta, sellarla escaneando
 * el QR, y las acciones del panel (dar sellos a mano, reiniciar).
 *
 * Igual que en el resto del sitio, el navegador no decide nada: manda el
 * código del QR y el servidor resuelve si le toca sello o si tiene que
 * esperar.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/loyalty-lib.php';
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
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function loyOut($arr, $code = 200) {
  http_response_code($code);
  echo json_encode($arr, JSON_UNESCAPED_UNICODE);
  exit;
}

function loyRequireAdmin() {
  if (empty($_SESSION['authed'])) loyOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

function loyBody() {
  $raw = file_get_contents('php://input');
  $b = $raw ? json_decode($raw, true) : null;
  return is_array($b) ? $b : array();
}

function loyDevice($b) {
  $d = isset($b['deviceId']) ? trim((string) $b['deviceId']) : '';
  if ($d === '' && isset($_GET['deviceId'])) $d = trim((string) $_GET['deviceId']);
  return function_exists('mb_substr') ? mb_substr($d, 0, 64) : substr($d, 0, 64);
}

function loyName($b) {
  $n = isset($b['name']) ? trim((string) $b['name']) : '';
  $n = strip_tags($n);
  return function_exists('mb_substr') ? mb_substr($n, 0, 60) : substr($n, 0, 60);
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';

/* ---------------- cliente ---------------- */

/** Cuántos sellos tengo. Se consulta al cargar la página. */
if ($method === 'GET' && $action === 'status') {
  $deviceId = loyDevice(array());
  $state = loyaltyRead();
  loyOut(array(
    'ok' => true,
    'active' => loyaltyActiva(),
    'card' => loyaltyPublicCard($state, $deviceId),
  ));
}

if ($method === 'POST') {
  $body = loyBody();
  $deviceId = loyDevice($body);
  $name = loyName($body);

  /**
   * Escaneé el QR. El servidor comprueba el código, la espera y el tope; el
   * navegador solo transmite lo que leyó la cámara.
   */
  if ($action === 'stamp') {
    if ($deviceId === '') loyOut(array('ok' => false, 'reason' => 'no-device', 'error' => 'No pudimos identificar tu dispositivo.'), 400);

    $codigo = isset($body['code']) ? (string) $body['code'] : '';
    if ($name !== '') rememberCustomer($deviceId, $name);

    $res = array('ok' => false, 'reason' => 'error');
    loyaltyWithWriteLock(function ($state) use ($deviceId, $codigo, $name, &$res) {
      $res = loyaltySellar($state, $deviceId, $codigo, $name);
      return !empty($res['ok']) ? $state : null;
    });

    if (empty($res['card'])) {
      $res['card'] = loyaltyPublicCard(loyaltyRead(), $deviceId);
    }
    /* Un mensaje para cada caso: antes, cuando el sello no entraba, la página
       se quedaba igual y el cliente pensaba que el QR no servía. */
    if (empty($res['ok'])) {
      $textos = array(
        'inactive' => 'La tarjeta de fidelidad no está activa en este momento.',
        'mismatch' => 'Ese código no es el del local.',
        'too-soon' => 'Ya sumaste tu sello. Vuelve más tarde para el siguiente.',
        'full'     => '¡Tu tarjeta ya está completa! Reclama tu premio.',
      );
      $r = isset($res['reason']) ? $res['reason'] : 'error';
      $res['error'] = isset($textos[$r]) ? $textos[$r] : 'No se pudo sumar el sello.';
    }
    loyOut($res);
  }

  /* ---------------- panel ---------------- */

  /** La lista de tarjetas, para buscar a alguien y darle un sello. */
  if ($action === 'admin-list') {
    loyRequireAdmin();
    $state = loyaltyRead();
    /* Se pasan los clientes ya registrados para que aparezcan todos, tengan
       sellos o no: hace falta justamente para darle sellos a quien todavía
       no tiene ninguno. */
    $reg = customersRead();
    $clientes = isset($reg['customers']) && is_array($reg['customers']) ? $reg['customers'] : array();
    loyOut(array(
      'ok' => true,
      'required' => loyaltySellosNecesarios(),
      'cooldownHours' => round(loyaltyEsperaMs() / 3600000, 2),
      'cards' => loyaltyListado($state, 1000, $clientes),
    ));
  }

  /**
   * Dar o quitar sellos a mano. Es la red de seguridad del sistema: el
   * cliente que borró el caché del navegador entra como cliente nuevo, y así
   * se le devuelven los sellos que tenía.
   */
  if ($action === 'admin-stamp') {
    loyRequireAdmin();
    $target = isset($body['targetDeviceId']) ? trim((string) $body['targetDeviceId']) : '';
    if ($target === '') loyOut(array('ok' => false, 'error' => 'Falta indicar de quién es la tarjeta.'), 400);
    $delta = isset($body['delta']) ? (int) $body['delta'] : 1;
    if ($delta === 0) loyOut(array('ok' => false, 'error' => 'No hay nada que cambiar.'), 400);
    if ($delta > 60) $delta = 60;
    if ($delta < -60) $delta = -60;

    $res = array('ok' => false);
    loyaltyWithWriteLock(function ($state) use ($target, $delta, $name, &$res) {
      $res = loyaltyAjustarSellos($state, $target, $delta, $name);
      return !empty($res['ok']) ? $state : null;
    });
    loyOut($res);
  }

  /** Todas las tarjetas a cero. */
  if ($action === 'admin-reset') {
    loyRequireAdmin();
    $res = array('ok' => false);
    loyaltyWithWriteLock(function ($state) use (&$res) {
      $res = loyaltyReiniciarTodo($state);
      return $state;
    });
    loyOut($res);
  }
}

loyOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
