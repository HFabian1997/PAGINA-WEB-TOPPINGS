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
require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/customers-lib.php';
require_once __DIR__ . '/visits-lib.php';

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

$DATA_FILE = toppingsDataFile('presence.json');
$LOCK_FILE = toppingsDataFile('presence.lock');
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
      /* Cambió el día: antes de tirar la lista del día que terminó, se
         archiva en visits.json. Ese archivo lo lee solo el panel, así que
         presence.json —que se escribe en cada latido de cada visitante— se
         queda igual de chico que siempre. Es la razón por la que el historial
         de visitas no vive acá. */
      if (!isset($state['dailyDevices'][$hoy])) {
        foreach ($state['dailyDevices'] as $diaViejo => $listaVieja) {
          if ($diaViejo !== $hoy && is_array($listaVieja) && count($listaVieja)) {
            visitsArchivarDia($diaViejo, $listaVieja);
          }
        }
        $state['dailyDevices'] = array($hoy => array());
      }
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

    /* Y queda anotado en el registro del cliente. presence.json solo sirve
       para "cuántos hay ahora" (borra lo de hace más de 5 minutos), así que
       sin esto no se podría saber quién vino esta semana o este mes. Solo
       escribe si pasaron 10 minutos desde la última vez. */
    customersTouch($deviceId);

    /* Si el panel borró a este cliente de la lista pero su celular todavía
       tiene el nombre guardado, acá vuelve a entrar. Borrar un cliente es una
       limpieza de la lista, no una expulsión: quien vuelve, reaparece.

       customersTouch() no alcanza para esto porque solo actualiza a quien YA
       está en el registro — a propósito, para no llenarlo de anónimos. Por eso
       se reinscribe solo cuando el latido trae un nombre. */
    $nombre = isset($body['name']) ? trim((string) $body['name']) : '';
    if ($nombre !== '' && customerName($deviceId) === '') {
      if (function_exists('mb_substr')) $nombre = mb_substr(strip_tags($nombre), 0, 60);
      rememberCustomer($deviceId, $nombre);
    }

    jsonOut(array('ok' => true));
  }

  /**
   * Quiénes, no cuántos.
   *
   * Es lo que hace que las tarjetas del panel se puedan tocar: hasta ahora
   * decían "Conectados ahora: 3" y no había forma de saber quiénes eran.
   *
   * `que=ahora`  -> los que están en la página en este momento
   * `que=periodo`-> los que entraron dentro del período pedido
   */
  case 'who': {
    if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
    global $VIVO_MS;
    $state = pRead();
    $now = pNowMs();
    $hoy = date('Y-m-d');
    $que = isset($_GET['que']) ? (string) $_GET['que'] : 'ahora';
    $periodo = isset($_GET['periodo']) ? (string) $_GET['periodo'] : 'hoy';
    if (!in_array($periodo, array('hoy', 'semana', 'mes', 'todos'), true)) $periodo = 'hoy';

    $hoyLista = isset($state['dailyDevices'][$hoy]) && is_array($state['dailyDevices'][$hoy])
      ? $state['dailyDevices'][$hoy] : array();

    if ($que === 'ahora') {
      $ids = array();
      foreach ($state['seen'] as $id => $ts) {
        if ($now - (int) $ts <= $VIVO_MS) $ids[] = (string) $id;
      }
    } else {
      $vst = visitsRead();
      $ids = visitsDispositivosDesde($vst, visitsDesdeDia($periodo), $hoyLista);
    }

    /* Se le pone nombre a cada uno. Quien nunca dio el suyo sale como
       "Cliente sin nombre": esconderlo haría que la lista no cuadre con el
       número de la tarjeta, y eso se lee como un error. */
    $reg = customersRead();
    $filas = array();
    foreach ($ids as $id) {
      $nombre = isset($reg['customers'][$id]['name']) ? trim((string) $reg['customers'][$id]['name']) : '';
      $filas[] = array(
        'deviceId' => $id,
        'name' => $nombre !== '' ? $nombre : null,
        'lastSeen' => isset($state['seen'][$id]) ? (int) $state['seen'][$id] : 0,
        'online' => isset($state['seen'][$id]) && ($now - (int) $state['seen'][$id]) <= $VIVO_MS,
      );
    }
    /* Primero los que tienen nombre y más recientes: los anónimos no aportan
       nada mirándolos y no tiene sentido que encabecen la lista. */
    usort($filas, function ($a, $b) {
      if (($a['name'] === null) !== ($b['name'] === null)) return $a['name'] === null ? 1 : -1;
      return $b['lastSeen'] - $a['lastSeen'];
    });

    jsonOut(array(
      'ok' => true,
      'que' => $que,
      'periodo' => $periodo,
      'total' => count($filas),
      'rows' => array_slice($filas, 0, 300),
      'serverNow' => $now,
    ));
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
