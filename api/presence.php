<?php
/**
 * Cuánta gente está en la página ahora mismo.
 *
 * Es un latido: cada pestaña abierta manda un "sigo acá" cada minuto y el
 * servidor guarda, por dispositivo, cuándo fue la última vez. No se guarda
 * ningún histórico de navegación: lo que tenga más de 5 minutos se borra en la
 * misma escritura, así que el archivo pesa lo que pesa la gente conectada, no
 * lo que pasó en el día.
 *
 * Es la parte del sitio que más escribe, por eso el pruning va dentro de la
 * misma pasada y no en una segunda vuelta.
 */
date_default_timezone_set('America/Bogota');

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

$DATA_FILE = __DIR__ . '/data/presence.json';
$LOCK_FILE = __DIR__ . '/data/presence.lock';
$VIVO_MS = 2 * 60 * 1000;    // "conectado ahora" = visto en los últimos 2 min
$GUARDAR_MS = 5 * 60 * 1000; // se olvida lo más viejo que esto
$MAX_DIAS = 90;              // el conteo por día no crece para siempre

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }
function pNowMs() { return (int) round(microtime(true) * 1000); }

function pDefault() { return array('seen' => array(), 'daily' => array(), 'dailyDevices' => array()); }

function pRead() {
  global $DATA_FILE;
  if (!file_exists($DATA_FILE)) return pDefault();
  $raw = @file_get_contents($DATA_FILE);
  $d = $raw ? json_decode($raw, true) : null;
  if (!is_array($d)) return pDefault();
  foreach (pDefault() as $k => $v) if (!isset($d[$k]) || !is_array($d[$k])) $d[$k] = $v;
  return $d;
}

function pWriteAtomic($state) {
  global $DATA_FILE;
  $dir = dirname($DATA_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $tmp = $DATA_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
  if (@file_put_contents($tmp, $json) === false) return false;
  if (!@rename($tmp, $DATA_FILE)) { @unlink($tmp); return false; }
  return true;
}

function pWithLock($cb) {
  global $LOCK_FILE;
  $dir = dirname($LOCK_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $fp = @fopen($LOCK_FILE, 'c');
  if (!$fp) return null;
  flock($fp, LOCK_EX);
  $state = pRead();
  $res = $cb($state);
  if (is_array($res)) pWriteAtomic($res);
  flock($fp, LOCK_UN);
  fclose($fp);
  return is_array($res) ? $res : $state;
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

  case 'ping': {
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    if ($deviceId === '') jsonOut(array('ok' => false));

    pWithLock(function ($state) use ($deviceId) {
      global $GUARDAR_MS, $MAX_DIAS;
      $now = pNowMs();
      $hoy = date('Y-m-d');

      // se olvida a los que dejaron de venir: esto es lo que mantiene el
      // archivo del tamaño de la gente conectada
      foreach ($state['seen'] as $id => $ts) {
        if ($now - (int) $ts > $GUARDAR_MS) unset($state['seen'][$id]);
      }
      $state['seen'][$deviceId] = $now;

      /* Cuántos entraron hoy: se guarda la lista de dispositivos del día para
         no contar dos veces a la misma persona, y solo la del día en curso —
         al cambiar el día se queda únicamente el número. */
      if (!isset($state['dailyDevices'][$hoy])) $state['dailyDevices'] = array($hoy => array());
      if (!in_array($deviceId, $state['dailyDevices'][$hoy], true)) {
        $state['dailyDevices'][$hoy][] = $deviceId;
      }
      $state['daily'][$hoy] = count($state['dailyDevices'][$hoy]);

      if (count($state['daily']) > $MAX_DIAS) {
        krsort($state['daily']);
        $state['daily'] = array_slice($state['daily'], 0, $MAX_DIAS, true);
      }
      return $state;
    });
    jsonOut(array('ok' => true));
  }

  case 'count': {
    if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
    $state = pRead();
    $now = pNowMs();
    $vivos = 0;
    foreach ($state['seen'] as $ts) {
      if ($now - (int) $ts <= $VIVO_MS) $vivos++;
    }
    $hoy = date('Y-m-d');
    $ayer = date('Y-m-d', strtotime('yesterday'));
    krsort($state['daily']);
    jsonOut(array(
      'ok' => true,
      'online' => $vivos,
      'today' => isset($state['daily'][$hoy]) ? (int) $state['daily'][$hoy] : 0,
      'yesterday' => isset($state['daily'][$ayer]) ? (int) $state['daily'][$ayer] : 0,
      'daily' => array_slice($state['daily'], 0, 30, true),
      'serverNow' => $now,
    ));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
