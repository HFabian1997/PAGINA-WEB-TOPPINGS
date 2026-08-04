<?php
/**
 * Suscripciones a las notificaciones del celular.
 *
 * El navegador le da a cada aparato una dirección única (endpoint) más dos
 * llaves; acá se guardan para poder mandarle notificaciones después, aunque
 * tenga la página cerrada.
 *
 * Este archivo NO decide qué notificar — de eso se encargan notifications.php
 * (las que manda Fabián) y cron.php (las automáticas).
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/webpush-lib.php';
require_once __DIR__ . '/push-subs-lib.php';

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

function pOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }
function pRequireAdmin() {
  if (empty($_SESSION['authed'])) pOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
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

  /* -------- el navegador pregunta con qué llave suscribirse -------- */
  case 'key': {
    $cfg = pushConfig();
    pOut(array(
      'ok' => pushHabilitado(),
      'publicKey' => isset($cfg['publicKey']) ? $cfg['publicKey'] : null,
    ));
  }

  /* -------- el cliente acepta recibir notificaciones -------- */
  case 'subscribe': {
    if ($method !== 'POST') pOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $sub = isset($body['subscription']) && is_array($body['subscription']) ? $body['subscription'] : array();
    $endpoint = isset($sub['endpoint']) ? trim((string) $sub['endpoint']) : '';
    $keys = isset($sub['keys']) && is_array($sub['keys']) ? $sub['keys'] : array();
    $p256 = isset($keys['p256dh']) ? (string) $keys['p256dh'] : '';
    $auth = isset($keys['auth']) ? (string) $keys['auth'] : '';

    if ($deviceId === '' || $endpoint === '') pOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);
    $agente = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
    psGuardar($deviceId, $endpoint, $p256, $auth, $agente);
    pOut(array('ok' => true, 'activo' => true));
  }

  /* -------- el cliente apaga las notificaciones -------- */
  case 'unsubscribe': {
    if ($method !== 'POST') pOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $endpoint = isset($body['endpoint']) ? trim((string) $body['endpoint']) : '';
    if ($deviceId === '') pOut(array('ok' => false, 'error' => 'Falta el aparato.'), 400);
    psQuitar($deviceId, $endpoint);
    pOut(array('ok' => true, 'activo' => false));
  }

  /* -------- ¿este aparato está suscrito? -------- */
  case 'status': {
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    pOut(array(
      'ok' => true,
      'activo' => $deviceId !== '' ? psActivo($deviceId) : false,
      'disponible' => pushHabilitado(),
    ));
  }

  /* -------- panel: mandarse una de prueba -------- */
  case 'test': {
    /* Entra la sesión del panel o la clave del cron; lo segundo permite
       probar desde fuera sin usar la contraseña de Fabián. Sin deviceId va a
       todos los suscritos, que es lo que hace falta al estrenar esto. */
    $cfg = pushConfig();
    $secreto = isset($_GET['secret']) ? (string) $_GET['secret'] : '';
    $conClave = !empty($cfg['cronSecret']) && hash_equals((string) $cfg['cronSecret'], $secreto);
    if (!$conClave) {
      pRequireAdmin();
      if ($method !== 'POST') pOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    }

    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    if ($deviceId === '' && isset($_GET['deviceId'])) $deviceId = trim((string) $_GET['deviceId']);

    $destinos = $deviceId !== '' ? array($deviceId) : ($conClave ? psTodos() : array());
    if (!count($destinos)) {
      pOut(array('ok' => false, 'error' => 'Todavía no hay ningún aparato con las notificaciones activadas.'), 400);
    }

    $datos = array(
      'title' => 'TOPPINGS 🍟',
      'body' => '✅ Las notificaciones quedaron activadas.',
      'tag' => 'prueba',
      'url' => '/',
    );
    $detalle = array();
    $enviadas = 0;
    require_once __DIR__ . '/webpush-lib.php';
    foreach ($destinos as $dev) {
      foreach (psDe($dev) as $s) {
        $r = pushEnviar($s, $datos);
        psAnotarResultado($dev, $s['endpoint'], $r['ok'], $r['muerta']);
        if ($r['ok']) $enviadas++;
        $detalle[] = array('code' => $r['code'], 'ok' => $r['ok'], 'error' => $r['error']);
      }
    }
    pOut(array('ok' => $enviadas > 0, 'enviadas' => $enviadas, 'aparatos' => count($detalle), 'detalle' => $detalle));
  }

  /**
   * Diagnóstico: qué puede hacer ESTE servidor. Sirve para saber si el
   * hosting trae el OpenSSL completo o si hay que mandar las push sin texto.
   * No revela ningún secreto: solo dice sí/no a cada capacidad.
   */
  case 'diag': {
    /* Entra la sesión del panel o la clave del cron. Lo segundo es para poder
       revisarlo desde afuera sin tener que iniciar sesión con la contraseña
       de Fabián. No devuelve ningún secreto: solo sí/no a cada capacidad. */
    $cfg = pushConfig();
    $secreto = isset($_GET['secret']) ? (string) $_GET['secret'] : '';
    $conClave = !empty($cfg['cronSecret']) && hash_equals((string) $cfg['cronSecret'], $secreto);
    if (!$conClave) pRequireAdmin();
    $caps = pushCapacidades();
    $st = psRead();
    $aparatos = 0;
    foreach ($st['devices'] as $d) {
      if (!empty($d['enabled']) && !empty($d['subs'])) $aparatos += count($d['subs']);
    }
    pOut(array(
      'ok' => true,
      'php' => PHP_VERSION,
      'capacidades' => $caps,
      'puedeCifrar' => pushPuedeCifrar(),
      'clientesSuscritos' => count(psTodos()),
      'aparatosSuscritos' => $aparatos,
    ));
  }

  /**
   * Diagnóstico del cifrado: cifra un texto fijo para una llave de prueba y
   * devuelve el resultado. Sirve para comprobar desde afuera que el cifrado
   * de este servidor produce algo que un navegador podría descifrar, sin
   * tener que molestar a nadie con notificaciones de prueba.
   *
   * Solo con la clave del cron. No toca ninguna suscripción real.
   */
  case 'diag-cifrado': {
    $cfg = pushConfig();
    $secreto = isset($_GET['secret']) ? (string) $_GET['secret'] : '';
    if (empty($cfg['cronSecret']) || !hash_equals((string) $cfg['cronSecret'], $secreto)) {
      pOut(array('ok' => false, 'error' => 'No autorizado.'), 401);
    }
    $p256 = isset($_GET['p256dh']) ? (string) $_GET['p256dh'] : '';
    $auth = isset($_GET['auth']) ? (string) $_GET['auth'] : '';
    $texto = isset($_GET['texto']) ? (string) $_GET['texto'] : 'hola';
    if ($p256 === '' || $auth === '') pOut(array('ok' => false, 'error' => 'Faltan las llaves de prueba.'), 400);

    $cuerpo = pushCifrar($texto, $p256, $auth);
    if ($cuerpo === null) pOut(array('ok' => false, 'error' => 'pushCifrar devolvió null.'), 500);

    /* También la firma VAPID, para poder comprobar desde afuera que el JWT
       está bien armado antes de molestar a nadie con una push de prueba.
       El destino es fijo a propósito: si se aceptara uno cualquiera, esto
       serviría para pedir firmas nuestras hacia donde sea. */
    $auth3 = vapidAuthHeader('https://fcm.googleapis.com/fcm/send/diagnostico');

    pOut(array(
      'ok' => true,
      'largo' => strlen($cuerpo),
      'cuerpo' => base64_encode($cuerpo),
      'vapid' => $auth3,
    ));
  }

  default:
    pOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
