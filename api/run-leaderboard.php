<?php
/**
 * Ranking de TOPPINGS RUN — sin base de datos, un archivo JSON con escritura
 * atómica (temporal + rename) y candado solo para escritores, lectura
 * siempre directa (mismo patrón que premio.php/content.php).
 *
 * Ahora además maneja el ciclo completo de "premio al #1 del ranking":
 * el tipo (diario/semanal) se configura desde admin/content.json; cuando el
 * período activo termina, el estado pasa a "available" (el ganador tiene 24h
 * para reclamar, el ranking queda congelado — no se aceptan más puntajes);
 * si reclama o si vencen las 24h sin hacerlo, se registra en el historial y
 * el ranking se reinicia solo. Toda la máquina de estados se evalúa de forma
 * perezosa (en cada request se llama ensureRankingState()) porque este
 * hosting no tiene cron — el mismo truco que ensureFreshDay/ensureFreshWeek
 * ya usaban en premio.php.
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

$DATA_DIR = __DIR__ . '/data';
$DATA_FILE = $DATA_DIR . '/run-leaderboard.json';
$LOCK_FILE = $DATA_DIR . '/run-leaderboard.lock';
$CONTENT_FILE = __DIR__ . '/../admin/content.json';
$TOP_N = 5;
$MAX_NAME_CHARS = 24;
$MAX_NAMES = 3000;
$CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }

function requireAdminAuth() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

/** Lee el tipo de ranking configurado desde el panel (admin/content.json). */
function configuredRankingType() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return 'weekly';
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $type = is_array($content) && isset($content['dailyPrize']['toppingsRun']['rankingType'])
    ? $content['dailyPrize']['toppingsRun']['rankingType'] : 'weekly';
  return in_array($type, array('daily', 'hourly'), true) ? $type : 'weekly';
}

/** Lee, para el ranking, si el admin lo configuró como premio directo o
    como "giro(s) en la Ruleta" — mismo patrón que configuredRankingType(). */
function toppingsRunRewardConfig() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return array('rewardType' => 'direct');
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $cfg = is_array($content) && isset($content['dailyPrize']['toppingsRun']) ? $content['dailyPrize']['toppingsRun'] : array();
  return array(
    'rewardType' => isset($cfg['rewardType']) ? $cfg['rewardType'] : 'direct',
    'wheelSpinCount' => isset($cfg['wheelSpinCount']) && $cfg['wheelSpinCount'] > 0 ? (int) $cfg['wheelSpinCount'] : 1,
    'wheelTicketExpiryHours' => isset($cfg['wheelTicketExpiryHours']) && $cfg['wheelTicketExpiryHours'] > 0 ? (float) $cfg['wheelTicketExpiryHours'] : 24,
  );
}

/** Nombre/ícono del premio del ranking y vigencia de su código — mismo
    patrón que toppingsRunRewardConfig(). */
function toppingsRunPrizeConfig() {
  global $CONTENT_FILE;
  $default = array('prizeName' => 'Premio del ranking', 'prizeIcon' => '🏆', 'codeExpiryHours' => 24);
  if (!file_exists($CONTENT_FILE)) return $default;
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $cfg = is_array($content) && isset($content['dailyPrize']['toppingsRun']) ? $content['dailyPrize']['toppingsRun'] : array();
  return array(
    'prizeName' => isset($cfg['prizeName']) && $cfg['prizeName'] !== '' ? (string) $cfg['prizeName'] : $default['prizeName'],
    'prizeIcon' => isset($cfg['prizeIcon']) && $cfg['prizeIcon'] !== '' ? (string) $cfg['prizeIcon'] : $default['prizeIcon'],
    'codeExpiryHours' => isset($cfg['codeExpiryHours']) && $cfg['codeExpiryHours'] > 0 ? (float) $cfg['codeExpiryHours'] : 24,
  );
}

function nowMs() { return (int) round(microtime(true) * 1000); }

/** Lunes de esta semana (America/Bogota), como fecha Y-m-d. */
function currentWeekStartDate() {
  $dow = (int) date('N'); // 1=lunes .. 7=domingo
  return date('Y-m-d', strtotime('today -' . ($dow - 1) . ' days'));
}

function newPeriodStart($type) {
  if ($type === 'hourly') return date('Y-m-d H:00');
  return $type === 'daily' ? date('Y-m-d') : currentWeekStartDate();
}

function periodEndForType($type, $startDateStr) {
  if ($type === 'hourly') return (strtotime($startDateStr . ':00') + 3600) * 1000;
  $days = $type === 'daily' ? 1 : 7;
  return (strtotime($startDateStr . ' 00:00:00') + $days * 86400) * 1000;
}

function defaultState() {
  $type = configuredRankingType();
  $start = newPeriodStart($type);
  return array(
    'rankingType' => $type,
    'periodStart' => $start,
    'periodEndAtMs' => periodEndForType($type, $start),
    'scores' => array(),
    // Registro permanente de nombres: deviceId => {name, updatedAt}. Vive
    // aparte de 'scores' a propósito — los puntajes se borran cada vez que
    // termina un evento, pero el nombre que eligió cada persona NO, porque
    // sirve para avisar cuando alguien más quiere usar el mismo nombre
    // (aunque nunca haya jugado: cronómetro, tarjeta, reto, etc.).
    'names' => array(),
    'winner' => null,
    'claim' => array('status' => 'waiting', 'windowEndsAtMs' => null, 'claimedAt' => null, 'claimedName' => null, 'claimedDevice' => null),
    'history' => array(),
  );
}

function normalizeState($state) {
  $default = defaultState();
  if (!is_array($state)) return $default;
  foreach ($default as $key => $val) {
    if (!isset($state[$key])) $state[$key] = $val;
  }
  if (!is_array($state['scores'])) $state['scores'] = array();
  // Compatibilidad con el formato anterior del ranking (antes de este
  // sistema de reclamo), donde cada puntaje era solo un número: "nombre" =>
  // 8000. Se convierte al vuelo al formato nuevo {score, deviceId} sin
  // deviceId (ese jugador no podrá reclamar hasta que vuelva a jugar y su
  // dispositivo quede registrado con un puntaje mayor).
  foreach ($state['scores'] as $name => $info) {
    if (!is_array($info)) $state['scores'][$name] = array('score' => (int) $info, 'deviceId' => null, 'updatedAt' => null);
  }
  // Migración a formato por dispositivo: antes la llave del ranking era el
  // nombre escrito ("Fabian" => {score, deviceId}), lo que hacía que dos
  // personas distintas con el mismo nombre se pisaran el puntaje entre sí.
  // Ahora la llave es el ID del dispositivo (nunca visible para el cliente)
  // y el nombre queda como un dato editable dentro de cada registro — así
  // dos "Fabián" en dispositivos distintos quedan como dos filas separadas,
  // y cambiarse el nombre no puede pisar el puntaje de otra persona. Se
  // detecta el formato viejo por la forma de la llave (nuestros deviceId
  // siempre empiezan con "d_"; las llaves ya migradas sin deviceId real
  // quedan como "legacy_<hash>") — así esta migración corre una sola vez
  // y no hace nada en las siguientes lecturas.
  /* El formato viejo se reconoce por la FORMA DEL VALOR, no por la llave.
     Antes se miraba si la llave empezaba por "d_" o "legacy_", y eso era
     frágil: cualquier ID de dispositivo con otro prefijo disparaba la
     migración y reescribía los nombres de todas las filas poniéndoles la
     llave como nombre. Pasó de verdad y dejó el ranking con nombres del
     tipo "legacy_5aadb8…" a la vista del cliente.

     En el formato viejo el valor era el puntaje suelto (un número) o un
     objeto sin 'name', porque el nombre estaba en la llave. */
  $needsScoreMigration = false;
  foreach ($state['scores'] as $key => $info) {
    if (!is_array($info) || !isset($info['name'])) { $needsScoreMigration = true; break; }
  }
  if ($needsScoreMigration) {
    $migrated = array();
    foreach ($state['scores'] as $oldKey => $info) {
      // Las filas que YA tienen 'name' están en el formato nuevo: se dejan
      // intactas, con su llave. Solo se convierten las viejas, donde el
      // nombre estaba en la llave.
      if (is_array($info) && isset($info['name'])) {
        $migrated[$oldKey] = $info;
        continue;
      }
      $score = is_array($info) ? (int) (isset($info['score']) ? $info['score'] : 0) : (int) $info;
      $deviceId = (is_array($info) && !empty($info['deviceId']))
        ? (string) $info['deviceId']
        : ('legacy_' . md5((string) $oldKey));
      $row = array(
        'name' => (string) $oldKey,
        'score' => $score,
        'updatedAt' => (is_array($info) && isset($info['updatedAt'])) ? $info['updatedAt'] : null
      );
      if (isset($migrated[$deviceId])) {
        if ($row['score'] > (int) $migrated[$deviceId]['score']) $migrated[$deviceId] = $row;
      } else {
        $migrated[$deviceId] = $row;
      }
    }
    $state['scores'] = $migrated;
  }
  if (!is_array($state['claim'])) $state['claim'] = $default['claim'];
  if (!is_array($state['history'])) $state['history'] = array();
  if (!is_array($state['names'])) $state['names'] = array();
  return $state;
}

/** Guarda (o actualiza) el nombre elegido por un dispositivo en el registro
 *  permanente. Se llama desde register-name, submit y rename, para que el
 *  aviso de "ese nombre ya está en uso" funcione sin importar por dónde se
 *  haya registrado la persona. */
/**
 * Un dispositivo puede no tener fila propia en el ranking aunque su puntaje
 * SÍ esté guardado: pasa con datos migrados o con respaldos reconstruidos,
 * donde la fila quedó bajo una llave que no es el ID real de nadie.
 *
 * Si existe una fila con ese mismo nombre y sin dueño real, se le traspasa a
 * este dispositivo. Así deja de haber dos filas de la misma persona y el
 * cambio de nombre pasa a verse de verdad en el ranking.
 *
 * $lookFor: nombre a buscar. Si viene vacío se usa el último que este
 * dispositivo haya registrado en el servidor.
 */
function adoptScoreRow(&$state, $deviceId, $lookFor) {
  if (isset($state['scores'][$deviceId])) return false;
  $lookFor = trim((string) $lookFor);
  if ($lookFor === '' && isset($state['names'][$deviceId])) {
    $lookFor = trim((string) $state['names'][$deviceId]);
  }
  if ($lookFor === '') return false;

  foreach ($state['scores'] as $key => $info) {
    if ((string) $key === (string) $deviceId) continue;
    if (strcasecmp((string) $info['name'], $lookFor) !== 0) continue;
    unset($state['scores'][$key]);
    $state['scores'][$deviceId] = $info;
    return true;
  }
  return false;
}

function rememberName(&$state, $deviceId, $name) {
  $deviceId = trim((string) $deviceId);
  $name = trim((string) $name);
  if ($deviceId === '' || $name === '') return;
  $state['names'][$deviceId] = array('name' => $name, 'updatedAt' => nowMs());
  // tope de seguridad: si algún día crece mucho, se quedan los más recientes
  if (count($state['names']) > $GLOBALS['MAX_NAMES']) {
    uasort($state['names'], function ($a, $b) { return (int) $b['updatedAt'] - (int) $a['updatedAt']; });
    $state['names'] = array_slice($state['names'], 0, $GLOBALS['MAX_NAMES'], true);
  }
}

/** ¿Otro dispositivo ya usa este nombre? Mira el registro permanente y, por
 *  si acaso, también los puntajes del evento en curso. */
function nameTakenByOther($state, $name, $deviceId) {
  $needle = function_exists('mb_strtolower') ? mb_strtolower($name) : strtolower($name);
  foreach ($state['names'] as $ownerId => $info) {
    $owner = function_exists('mb_strtolower') ? mb_strtolower((string) $info['name']) : strtolower((string) $info['name']);
    if ($owner === $needle && (string) $ownerId !== '' && !hash_equals((string) $ownerId, (string) $deviceId)) return true;
  }
  foreach ($state['scores'] as $ownerId => $info) {
    $owner = function_exists('mb_strtolower') ? mb_strtolower((string) $info['name']) : strtolower((string) $info['name']);
    if ($owner === $needle && (string) $ownerId !== '' && !hash_equals((string) $ownerId, (string) $deviceId)) return true;
  }
  return false;
}

function readState() {
  global $DATA_FILE;
  if (!file_exists($DATA_FILE)) return defaultState();
  $raw = @file_get_contents($DATA_FILE);
  $data = $raw ? json_decode($raw, true) : null;
  return normalizeState($data);
}

function writeStateAtomic($state) {
  global $DATA_FILE;
  $dir = dirname($DATA_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $tmp = $DATA_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
  if (@file_put_contents($tmp, $json) === false) return false;
  if (!@rename($tmp, $DATA_FILE)) { @unlink($tmp); return false; }
  return true;
}

function withWriteLock($callback) {
  global $LOCK_FILE, $DATA_DIR;
  if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0755, true);
  $lockFp = @fopen($LOCK_FILE, 'c');
  if (!$lockFp) jsonOut(array('ok' => false, 'error' => 'No se pudo bloquear el ranking.'), 500);
  flock($lockFp, LOCK_EX);
  $state = readState();
  $result = $callback($state);
  if (is_array($result)) writeStateAtomic($result);
  flock($lockFp, LOCK_UN);
  fclose($lockFp);
  return is_array($result) ? $result : $state;
}

function computeWinner($scores) {
  $best = null;
  foreach ($scores as $deviceId => $info) {
    $score = (int) $info['score'];
    if ($best === null || $score > $best['score']) {
      $best = array('name' => $info['name'], 'score' => $score, 'deviceId' => $deviceId);
    }
  }
  return $best;
}

function resetPeriod(&$state, $type) {
  $start = newPeriodStart($type);
  $state['rankingType'] = $type;
  $state['periodStart'] = $start;
  $state['periodEndAtMs'] = periodEndForType($type, $start);
  $state['scores'] = array();
  $state['winner'] = null;
  $state['claim'] = array('status' => 'waiting', 'windowEndsAtMs' => null, 'claimedAt' => null, 'claimedName' => null, 'claimedDevice' => null);
}

function appendHistory(&$state, $outcome) {
  $entry = array(
    'name' => $state['winner'] ? $state['winner']['name'] : null,
    'score' => $state['winner'] ? $state['winner']['score'] : null,
    'rankingType' => $state['rankingType'],
    'periodStart' => $state['periodStart'],
    'outcome' => $outcome, // 'claimed' | 'expired' | 'admin-reset'
    'endedAt' => $state['periodEndAtMs'],
    'claimedAt' => $outcome === 'claimed' ? nowMs() : null,
  );
  array_unshift($state['history'], $entry);
  $state['history'] = array_slice($state['history'], 0, 30);
}

/**
 * Máquina de estados evaluada en cada request: aplica el tipo configurado
 * desde el panel (si cambió y todavía no hay ganador determinado), y avanza
 * "waiting" -> "available" -> ("claimed" | "expired") -> "waiting" según la
 * hora del servidor. Nunca depende de un cron.
 */
function ensureRankingState(&$state) {
  $configured = configuredRankingType();
  if ($state['claim']['status'] === 'waiting' && $configured !== $state['rankingType']) {
    resetPeriod($state, $configured);
  }

  $now = nowMs();

  if ($state['claim']['status'] === 'waiting' && $now >= $state['periodEndAtMs']) {
    $winner = computeWinner($state['scores']);
    if ($winner && $winner['score'] > 0) {
      $state['winner'] = $winner;
      $state['claim']['status'] = 'available';
      $state['claim']['windowEndsAtMs'] = $state['periodEndAtMs'] + $GLOBALS['CLAIM_WINDOW_MS'];
    } else {
      resetPeriod($state, $state['rankingType']);
    }
  }

  if ($state['claim']['status'] === 'available' && $now >= $state['claim']['windowEndsAtMs']) {
    appendHistory($state, 'expired');
    resetPeriod($state, $state['rankingType']);
  }
}

function buildPublicPayload($state, $requesterName, $requesterDevice) {
  $scores = $state['scores'];
  uasort($scores, function ($a, $b) {
    return (int) $b['score'] - (int) $a['score'];
  });
  $ranked = array();
  $i = 0;
  $mine = null;
  foreach ($scores as $deviceId => $info) {
    $i++;
    $score = (int) $info['score'];
    $row = array('rank' => $i, 'name' => $info['name'], 'score' => $score);
    if ($i <= $GLOBALS['TOP_N']) $ranked[] = $row;
    if ($requesterDevice !== '' && hash_equals((string) $deviceId, (string) $requesterDevice)) $mine = $row;
  }

  $claim = $state['claim'];
  $winner = $state['winner'] ? array('name' => $state['winner']['name'], 'score' => $state['winner']['score']) : null;
  $canClaim = false;
  if ($claim['status'] === 'available' && $state['winner'] && $requesterDevice !== '' &&
      isset($state['winner']['deviceId']) && $state['winner']['deviceId'] !== null &&
      hash_equals((string) $state['winner']['deviceId'], (string) $requesterDevice)) {
    $canClaim = true;
  }

  $history = array_map(function ($h) {
    return array(
      'name' => $h['name'], 'score' => $h['score'], 'rankingType' => $h['rankingType'],
      'periodStart' => $h['periodStart'], 'outcome' => $h['outcome'], 'claimedAt' => $h['claimedAt'],
    );
  }, array_slice($state['history'], 0, 10));

  return array(
    'ok' => true,
    'rankingType' => $state['rankingType'],
    'periodStart' => $state['periodStart'],
    'periodEndAtMs' => $state['periodEndAtMs'],
    'serverNow' => nowMs(),
    'top' => $ranked,
    'mine' => $mine,
    'winner' => $winner,
    'claim' => array(
      'status' => $claim['status'],
      'windowEndsAtMs' => $claim['windowEndsAtMs'],
      'claimedName' => $claim['claimedName'],
    ),
    'canClaim' => $canClaim,
    'history' => $history,
    // compatibilidad con el nombre anterior del campo, por si algo viejo lo espera
    'weekStart' => $state['periodStart'],
    'weekEndsAtMs' => $state['periodEndAtMs'],
  );
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

/* Si la acción no viene en la dirección, se busca dentro del mensaje — igual
   que hace premio.php. Sin este respaldo, una llamada que mande la acción
   solo en el cuerpo cae en "acción no reconocida" y falla en silencio: eso
   fue exactamente lo que dejó el cambio de nombre sin efecto en el ranking
   durante días, mientras en la tarjeta sí funcionaba. */
if ($action === '' && $method === 'POST') {
  $rawBody = file_get_contents('php://input');
  $parsedBody = json_decode($rawBody, true);
  if (is_array($parsedBody) && isset($parsedBody['action'])) {
    $action = (string) $parsedBody['action'];
  }
}

switch ($action) {

  case 'status': {
    $name = isset($_GET['name']) ? trim((string) $_GET['name']) : '';
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    $state = readState();
    ensureRankingState($state);
    jsonOut(buildPublicPayload($state, $name, $deviceId));
  }

  // Solo lectura: ¿algún otro dispositivo ya usa este nombre en el ranking?
  // Se usa para el aviso "ESE NOMBRE YA ESTÁ EN USO" antes de guardar un
  // nombre nuevo — es solo una advertencia, no una restricción real (dos
  // personas pueden terminar con el mismo nombre si así lo deciden).
  case 'check-name': {
    $name = isset($_GET['name']) ? trim((string) $_GET['name']) : '';
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    $taken = false;
    if ($name !== '') {
      $state = readState();
      $taken = nameTakenByOther($state, $name, $deviceId);
    }
    jsonOut(array('ok' => true, 'taken' => $taken));
  }

  /* Deja registrado el nombre que eligió este dispositivo, sin importar por
     dónde lo haya puesto (saludo, juego, cronómetro, tarjeta, reto). Es lo
     que permite que check-name funcione para todos, no solo para quienes
     jugaron. */
  case 'register-name': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if ($deviceId === '' || $name === '') jsonOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    else $name = substr($name, 0, $MAX_NAME_CHARS);

    withWriteLock(function ($state) use ($deviceId, $name) {
      rememberName($state, $deviceId, $name);
      return $state;
    });
    jsonOut(array('ok' => true));
  }

  case 'submit': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    $score = isset($body['score']) ? (int) $body['score'] : -1;
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    if ($name === '' || $score < 0 || $deviceId === '') jsonOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    else $name = substr($name, 0, $MAX_NAME_CHARS);
    $score = min($score, 999999);
    if (function_exists('mb_substr')) $deviceId = mb_substr($deviceId, 0, 64);

    $final = withWriteLock(function ($state) use ($name, $score, $deviceId) {
      ensureRankingState($state);
      rememberName($state, $deviceId, $name);
      // El ranking queda congelado mientras hay un ganador esperando reclamar:
      // nadie puede seguir acumulando puntos ni superar al ganador.
      if ($state['claim']['status'] !== 'waiting') return $state;
      // Antes de crear fila nueva, se intenta adoptar una que ya exista con
      // este mismo nombre pero guardada bajo otra llave (respaldos
      // reconstruidos, migraciones). Sin esto quedaban dos filas del mismo
      // jugador y al renombrarse solo cambiaba una.
      if (!isset($state['scores'][$deviceId])) adoptScoreRow($state, $deviceId, $name);
      if (!isset($state['scores'][$deviceId])) {
        $state['scores'][$deviceId] = array('name' => $name, 'score' => $score, 'updatedAt' => nowMs());
      } else {
        // el nombre mostrado siempre se refresca, aunque el puntaje de esta
        // partida no supere el mejor guardado
        $state['scores'][$deviceId]['name'] = $name;
        if ($score > (int) $state['scores'][$deviceId]['score']) {
          $state['scores'][$deviceId]['score'] = $score;
          $state['scores'][$deviceId]['updatedAt'] = nowMs();
        }
      }
      return $state;
    });

    jsonOut(buildPublicPayload($final, $name, $deviceId));
  }

  case 'claim': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    if ($deviceId === '') jsonOut(array('ok' => false, 'error' => 'Falta identificar el dispositivo.'), 400);

    $claimed = false;
    $errorMsg = null;
    $claimName = $name;
    $final = withWriteLock(function ($state) use ($name, $deviceId, &$claimed, &$errorMsg, &$claimName) {
      ensureRankingState($state);
      // Toda la validación real ocurre aquí, en el servidor — sin importar
      // qué muestre o permita hacer clic el navegador del cliente.
      if ($state['claim']['status'] !== 'available' || !$state['winner']) {
        $errorMsg = 'No hay ningún premio disponible para reclamar en este momento.';
        return $state;
      }
      $winnerDevice = isset($state['winner']['deviceId']) ? (string) $state['winner']['deviceId'] : '';
      if ($winnerDevice === '' || !hash_equals($winnerDevice, (string) $deviceId)) {
        $errorMsg = 'Solo el jugador que ocupe el puesto #1 puede reclamar este premio.';
        return $state;
      }
      $claimName = $name !== '' ? $name : $state['winner']['name'];
      $state['claim']['status'] = 'claimed';
      $state['claim']['claimedAt'] = nowMs();
      $state['claim']['claimedName'] = $claimName;
      $state['claim']['claimedDevice'] = $deviceId;
      appendHistory($state, 'claimed');
      $claimed = true;
      // Se reinicia automáticamente: todos los dispositivos vuelven a 0 puntos.
      resetPeriod($state, $state['rankingType']);
      return $state;
    });

    if (!$claimed) jsonOut(array('ok' => false, 'error' => $errorMsg ?: 'No se pudo reclamar el premio.'), 403);

    $response = array('ok' => true, 'claimed' => true, 'status' => buildPublicPayload($final, $name, $deviceId));
    $rewardCfg = toppingsRunRewardConfig();
    if ($rewardCfg['rewardType'] === 'wheelSpins') {
      $ticketIds = grantRuletaTickets($deviceId, $claimName, 'toppingsRun', $rewardCfg['wheelSpinCount'], $rewardCfg['wheelTicketExpiryHours']);
      if ($ticketIds) $response['wheelGranted'] = array('count' => count($ticketIds));
    } else {
      $prizeCfg = toppingsRunPrizeConfig();
      $record = issuePrizeCode($deviceId, $claimName, 'toppingsRun', $prizeCfg['prizeName'], $prizeCfg['prizeIcon'], $prizeCfg['codeExpiryHours']);
      if ($record) $response['codeGranted'] = array('code' => $record['code'], 'prizeName' => $record['prizeName'], 'prizeIcon' => $record['prizeIcon'], 'expiresAt' => $record['expiresAt']);
    }
    jsonOut($response);
  }

  case 'rename': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $newName = isset($body['newName']) ? trim((string) $body['newName']) : '';
    $oldName = isset($body['oldName']) ? trim((string) $body['oldName']) : '';
    if ($deviceId === '' || $newName === '') jsonOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);
    if (function_exists('mb_substr')) $newName = mb_substr($newName, 0, $MAX_NAME_CHARS);
    else $newName = substr($newName, 0, $MAX_NAME_CHARS);

    $final = withWriteLock(function ($state) use ($deviceId, $newName, $oldName) {
      ensureRankingState($state);
      rememberName($state, $deviceId, $newName);
      if (!isset($state['scores'][$deviceId])) adoptScoreRow($state, $deviceId, $oldName);
      if (isset($state['scores'][$deviceId])) {
        $state['scores'][$deviceId]['name'] = $newName;
      }
      if ($state['winner'] && !empty($state['winner']['deviceId']) && hash_equals((string) $state['winner']['deviceId'], $deviceId)) {
        $state['winner']['name'] = $newName;
      }
      if (!empty($state['claim']['claimedDevice']) && hash_equals((string) $state['claim']['claimedDevice'], $deviceId)) {
        $state['claim']['claimedName'] = $newName;
      }
      return $state;
    });

    jsonOut(array('ok' => true, 'status' => buildPublicPayload($final, $newName, $deviceId)));
  }

  case 'admin-status': {
    requireAdminAuth();
    $state = withWriteLock(function ($s) { ensureRankingState($s); return $s; });
    jsonOut(array('ok' => true, 'state' => array(
      'rankingType' => $state['rankingType'],
      'periodStart' => $state['periodStart'],
      'periodEndAtMs' => $state['periodEndAtMs'],
      'serverNow' => nowMs(),
      'winner' => $state['winner'],
      'claim' => $state['claim'],
      'history' => array_slice($state['history'], 0, 20),
    )));
  }

  case 'admin-reset': {
    requireAdminAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $final = withWriteLock(function ($state) {
      ensureRankingState($state);
      if ($state['winner'] && $state['claim']['status'] !== 'waiting') {
        appendHistory($state, 'admin-reset');
      }
      resetPeriod($state, configuredRankingType());
      return $state;
    });
    jsonOut(array('ok' => true, 'state' => array(
      'rankingType' => $final['rankingType'],
      'periodStart' => $final['periodStart'],
      'periodEndAtMs' => $final['periodEndAtMs'],
      'claim' => $final['claim'],
    )));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
