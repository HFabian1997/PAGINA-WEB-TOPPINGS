<?php
/**
 * API mínima para "Premio del día" de TOPPINGS — sin base de datos,
 * solo un archivo JSON en el servidor para que todos los celulares
 * vean el mismo estado (si el premio de hoy ya fue reclamado).
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/customers-lib.php';
require_once __DIR__ . '/ruleta-lib.php';
require_once __DIR__ . '/codes-lib.php';
require_once __DIR__ . '/rename-lib.php';
require_once __DIR__ . '/loyalty-lib.php';
require_once __DIR__ . '/nombres-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
// El estado cambia a cada rato (cronómetro, reclamos) y varios celulares lo
// consultan a la vez — sin esto, el hosting compartido (o cualquier caché
// intermedio) puede servir una respuesta vieja a pesar de que el cliente
// pida "no-store", porque ese encabezado del lado del navegador no controla
// cachés externos entre el navegador y el servidor.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$DATA_DIR = toppingsDataDir();
$DATA_FILE = $DATA_DIR . '/premio.json';
$LOCK_FILE = $DATA_DIR . '/premio.lock';
$UPLOADS_DIR = __DIR__ . '/uploads';
$CONTENT_FILE = __DIR__ . '/../admin/content.json';
$MAX_PHOTO_BYTES = 6 * 1024 * 1024;

function jsonOut($arr, $code = 200) {
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

/**
 * El cronómetro nunca queda bloqueado el resto del día: cuenta regresiva,
 * botón disponible al llegar a cero, y al reclamarlo se restablece por el
 * mismo tiempo — solo queda un aviso de quién ganó hoy con esa forma.
 *
 * La tarjeta de fidelidad NO se bloquea para nadie: cada cliente completa la
 * suya (sellos llevados en su propio celular) y reclama su propio premio —
 * reclamar no afecta a ningún otro cliente. `loyalty` solo guarda el último
 * reclamo a modo informativo, nunca se usa para bloquear un nuevo reclamo.
 *
 * El reto del día sí tiene un límite configurable de ganadores por día
 * (`dailyWinnerLimit` en content.json, por defecto 1) — se guarda como una
 * lista de reclamos de hoy en vez de un solo ganador, y el admin puede
 * reiniciarla manualmente para permitir más ganadores el mismo día.
 */
function defaultLoyalty() { return array('claimed' => false, 'name' => null, 'deviceId' => null, 'claimedAt' => null); }
function defaultChallenge() { return array('claims' => array()); }
function defaultCronometro() { return array('lastClaimName' => null, 'lastClaimDevice' => null, 'lastClaimAt' => null); }

/** Cuántos ganadores del reto del día se permiten hoy (admin-configurable). */
function challengeDailyLimit() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return 1;
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $cfg = is_array($content) && isset($content['dailyPrize']['challenge']) ? $content['dailyPrize']['challenge'] : array();
  $limit = isset($cfg['dailyWinnerLimit']) ? (int) $cfg['dailyWinnerLimit'] : 1;
  return $limit > 0 ? $limit : 1;
}

/** Compara una clave enviada contra la clave de administrador configurada. */
function checkAdminSecret($secret) {
  global $CONTENT_FILE;
  $configuredSecret = '';
  if (file_exists($CONTENT_FILE)) {
    $contentRaw = @file_get_contents($CONTENT_FILE);
    $contentData = $contentRaw ? json_decode($contentRaw, true) : null;
    if (is_array($contentData) && isset($contentData['business']['adminSecret'])) {
      $configuredSecret = trim((string) $contentData['business']['adminSecret']);
    }
  }
  return $configuredSecret !== '' && $secret !== '' && hash_equals($configuredSecret, $secret);
}

function defaultState() {
  return array(
    'day' => date('Y-m-d'),
    'cronometro' => defaultCronometro(),
    'loyalty' => defaultLoyalty(),
    'challenge' => defaultChallenge(),
    'stikers' => array(),
  );
}

function normalizeState($state) {
  if (!is_array($state)) $state = defaultState();
  if (!isset($state['cronometro']) || !is_array($state['cronometro'])) $state['cronometro'] = defaultCronometro();
  if (!isset($state['loyalty']) || !is_array($state['loyalty'])) $state['loyalty'] = defaultLoyalty();
  if (!isset($state['challenge']) || !is_array($state['challenge'])) {
    $state['challenge'] = defaultChallenge();
  } elseif (isset($state['challenge']['claimed'])) {
    // Migración desde el formato anterior (un solo ganador por día) al nuevo
    // formato de lista — para no perder el ganador de hoy ya guardado.
    $old = $state['challenge'];
    $claims = array();
    if (!empty($old['claimed'])) {
      $claims[] = array(
        'name' => isset($old['name']) ? $old['name'] : null,
        'deviceId' => isset($old['deviceId']) ? $old['deviceId'] : null,
        'photo' => isset($old['photo']) ? $old['photo'] : null,
        'claimedAt' => isset($old['claimedAt']) ? $old['claimedAt'] : null,
      );
    }
    $state['challenge'] = array('claims' => $claims);
  }
  if (!isset($state['challenge']['claims']) || !is_array($state['challenge']['claims'])) $state['challenge']['claims'] = array();
  if (!isset($state['stikers']) || !is_array($state['stikers'])) $state['stikers'] = array();
  return $state;
}

/**
 * Lee el estado directamente del archivo — sin candado. Como las escrituras
 * son atómicas (escriben a un archivo temporal y lo renombran encima), una
 * lectura nunca puede ver un archivo a medio escribir; el sistema de
 * archivos compartido de Hostinger no siempre respeta flock() en lecturas,
 * así que apoyarse solo en locks para lecturas causaba lecturas a medias.
 */
function readState() {
  global $DATA_FILE;
  if (!file_exists($DATA_FILE)) return defaultState();
  $raw = @file_get_contents($DATA_FILE);
  $state = $raw ? json_decode($raw, true) : null;
  return normalizeState($state);
}

/** Escribe a un archivo temporal y lo renombra encima del original: nunca deja el archivo a medias. */
function writeStateAtomic($state) {
  global $DATA_FILE;
  $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $tmp = $DATA_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
  if (@file_put_contents($tmp, $json) === false) return false;
  if (!@rename($tmp, $DATA_FILE)) { @unlink($tmp); return false; }
  return true;
}

/**
 * Serializa lecturas-modificación-escritura (dos reclamos al mismo tiempo no
 * deben pisarse). $callback($state) debe devolver el nuevo estado a guardar,
 * o null si no hay que escribir nada.
 */
function withWriteLock($callback) {
  global $LOCK_FILE, $DATA_DIR;
  if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0755, true);
  $lockFp = @fopen($LOCK_FILE, 'c');
  if (!$lockFp) jsonOut(array('ok' => false, 'error' => 'No se pudo bloquear el almacenamiento.'), 500);
  flock($lockFp, LOCK_EX);
  $state = readState();
  $result = $callback($state);
  if (is_array($result)) writeStateAtomic($result);
  flock($lockFp, LOCK_UN);
  fclose($lockFp);
  return is_array($result) ? $result : $state;
}

function ensureFreshDay(&$state) {
  $today = date('Y-m-d');
  if ($state['day'] !== $today) {
    $state['day'] = $today;
    $state['cronometro'] = defaultCronometro();
    $state['loyalty'] = defaultLoyalty();
    $state['challenge'] = defaultChallenge();
  }
}

/** Lee la duración del cronómetro configurada en el panel (minutos/horas → ms). */
function cronometroRepeatMs() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return 0;
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $cfg = is_array($content) && isset($content['dailyPrize']['cronometro']) ? $content['dailyPrize']['cronometro'] : array();
  $amount = isset($cfg['repeatAmount']) ? (float) $cfg['repeatAmount'] : 0;
  if ($amount <= 0) return 0;
  $unit = isset($cfg['repeatUnit']) ? $cfg['repeatUnit'] : 'hours';
  if ($unit === 'seconds') $unitMs = 1000;
  elseif ($unit === 'minutes') $unitMs = 60000;
  else $unitMs = 3600000;
  return (int) round($amount * $unitMs);
}

/**
 * Momento exacto (timestamp del servidor, en milisegundos) en que se puede
 * volver a reclamar el cronómetro. Se calcula UNA sola vez aquí, con la hora
 * del servidor (America/Bogota) — nunca con la hora ni la zona horaria del
 * celular de cada visitante, que puede estar mal configurada o distinta
 * entre dispositivos. Así todos cuentan regresiva hacia el MISMO instante,
 * como un cronómetro de transmisión en vivo.
 */
function cronometroUnlocksAtMs($state) {
  $repeatMs = cronometroRepeatMs();
  if ($repeatMs <= 0) return null;
  $midnightMs = strtotime('today') * 1000;
  $anchorMs = $state['cronometro']['lastClaimAt'] ? $state['cronometro']['lastClaimAt'] : $midnightMs;
  return $anchorMs + $repeatMs;
}

/** Lee, para una de las 4 dinámicas, si el admin la configuró como premio
    directo o como "giro(s) en la Ruleta" — mismo patrón que cronometroRepeatMs(). */
function rewardConfigFor($claimMethod) {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return array('rewardType' => 'direct');
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $cfg = is_array($content) && isset($content['dailyPrize'][$claimMethod]) ? $content['dailyPrize'][$claimMethod] : array();
  return array(
    'rewardType' => isset($cfg['rewardType']) ? $cfg['rewardType'] : 'direct',
    'wheelSpinCount' => isset($cfg['wheelSpinCount']) && $cfg['wheelSpinCount'] > 0 ? (int) $cfg['wheelSpinCount'] : 1,
    'wheelTicketExpiryHours' => isset($cfg['wheelTicketExpiryHours']) && $cfg['wheelTicketExpiryHours'] > 0 ? (float) $cfg['wheelTicketExpiryHours'] : 24,
  );
}

/** Si esta dinámica está configurada para entregar giros de ruleta en vez de
    premio directo, otorga los tiros y devuelve el bloque a sumar a la
    respuesta JSON — si no, devuelve null y el flujo normal sigue igual. */
function maybeGrantWheelReward($claimMethod, $deviceId, $name) {
  $cfg = rewardConfigFor($claimMethod);
  if ($cfg['rewardType'] !== 'wheelSpins') return null;
  $ticketIds = grantRuletaTickets($deviceId, $name, $claimMethod, $cfg['wheelSpinCount'], $cfg['wheelTicketExpiryHours']);
  if (!$ticketIds) return null;
  return array('count' => count($ticketIds));
}

/** Lee, para una de las 4 dinámicas, el nombre/ícono del premio y la vigencia
    de su código — mismo patrón que rewardConfigFor(). */
function prizeConfigFor($claimMethod) {
  global $CONTENT_FILE;
  $default = array('prizeName' => 'Premio sorpresa', 'prizeIcon' => '🎁', 'codeExpiryHours' => 24);
  if (!file_exists($CONTENT_FILE)) return $default;
  $raw = @file_get_contents($CONTENT_FILE);
  $content = $raw ? json_decode($raw, true) : null;
  $cfg = is_array($content) && isset($content['dailyPrize'][$claimMethod]) ? $content['dailyPrize'][$claimMethod] : array();
  return array(
    'prizeName' => isset($cfg['prizeName']) && $cfg['prizeName'] !== '' ? (string) $cfg['prizeName'] : $default['prizeName'],
    'prizeIcon' => isset($cfg['prizeIcon']) && $cfg['prizeIcon'] !== '' ? (string) $cfg['prizeIcon'] : $default['prizeIcon'],
    'codeExpiryHours' => isset($cfg['codeExpiryHours']) && $cfg['codeExpiryHours'] > 0 ? (float) $cfg['codeExpiryHours'] : 24,
  );
}

/** Si esta dinámica está configurada como premio directo (lo normal), genera
    un código único de premio y devuelve el bloque a sumar a la respuesta
    JSON — si está configurada como "Giro en la Ruleta" en vez de esto, esta
    función no hace nada (maybeGrantWheelReward ya se encargó de esa rama). */
function maybeGrantDirectCode($claimMethod, $deviceId, $name) {
  $cfg = rewardConfigFor($claimMethod);
  if ($cfg['rewardType'] !== 'direct') return null;
  $prizeCfg = prizeConfigFor($claimMethod);
  $record = issuePrizeCode($deviceId, $name, $claimMethod, $prizeCfg['prizeName'], $prizeCfg['prizeIcon'], $prizeCfg['codeExpiryHours']);
  if (!$record) return null;
  return array('code' => $record['code'], 'prizeName' => $record['prizeName'], 'prizeIcon' => $record['prizeIcon'], 'expiresAt' => $record['expiresAt']);
}

/** Nunca se expone el deviceId al público — solo el servidor lo usa para
    verificar quién puede reclamar o renombrar un registro. */
function publicState($state) {
  $cronometro = $state['cronometro'];
  $cronometro['unlocksAtMs'] = cronometroUnlocksAtMs($state);
  unset($cronometro['lastClaimDevice']);
  $loyalty = $state['loyalty'];
  unset($loyalty['deviceId']);
  $challengeLimit = challengeDailyLimit();
  $challengeClaims = array_map(function ($c) {
    unset($c['deviceId']);
    return $c;
  }, $state['challenge']['claims']);
  $challenge = array(
    'claims' => array_values($challengeClaims),
    'limit' => $challengeLimit,
    'remaining' => max(0, $challengeLimit - count($challengeClaims)),
  );
  $stikers = array_map(function ($s) {
    unset($s['deviceId']);
    return $s;
  }, $state['stikers']);
  return array(
    'day' => $state['day'],
    'cronometro' => $cronometro,
    'loyalty' => $loyalty,
    'challenge' => $challenge,
    'stikers' => array_values($stikers),
    // El reloj del celular puede estar desfasado del reloj del servidor — el
    // cliente usa esto para corregir su cuenta regresiva y que el botón se
    // active exactamente cuando el servidor (el que de verdad decide) lo
    // permite, no antes ni después.
    'serverNow' => (int) round(microtime(true) * 1000),
  );
}

if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0755, true);
if (!is_dir($UPLOADS_DIR)) @mkdir($UPLOADS_DIR, 0755, true);
if (!file_exists($DATA_FILE)) writeStateAtomic(defaultState());

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($method === 'GET' && $action === 'status') {
  $state = readState();
  ensureFreshDay($state);
  jsonOut(array('ok' => true, 'state' => publicState($state)));
}

if ($method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true);
  if (!is_array($body)) $body = array();
  if (!$action) $action = isset($body['action']) ? (string) $body['action'] : '';

  if ($action === 'claim') {
    $claimMethod = isset($body['method']) ? trim((string) $body['method']) : '';
    $allowed = array('cronometro', 'loyalty', 'challenge');
    if (!in_array($claimMethod, $allowed, true)) {
      jsonOut(array('ok' => false, 'error' => 'Método inválido.'), 400);
    }
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    $name = function_exists('mb_substr') ? mb_substr(strip_tags($name), 0, 60) : substr(strip_tags($name), 0, 60);
    $photoDataUrl = isset($body['photo']) ? (string) $body['photo'] : '';
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    if (function_exists('mb_substr')) $deviceId = mb_substr($deviceId, 0, 64);

    // Queda registrado como cliente sin pedirle el nombre otra vez: acá ya
    // viene, y así el registro se repara solo cuando la gente reclama.
    rememberCustomer($deviceId, $name);

    $outcome = array('ok' => false, 'error' => 'No se pudo procesar el reclamo.');

    withWriteLock(function ($state) use ($claimMethod, $name, $photoDataUrl, $deviceId, &$outcome) {
      ensureFreshDay($state);

      if ($claimMethod === 'cronometro') {
        $unlocksAtMs = cronometroUnlocksAtMs($state);
        if ($unlocksAtMs === null) {
          $outcome = array('ok' => false, 'error' => 'El cronómetro no está configurado.', 'httpCode' => 400);
          return null;
        }
        $nowMs = (int) round(microtime(true) * 1000);
        if ($nowMs < $unlocksAtMs) {
          $outcome = array('ok' => false, 'alreadyClaimed' => true, 'state' => publicState($state));
          return null;
        }
        $state['cronometro']['lastClaimName'] = $name;
        $state['cronometro']['lastClaimDevice'] = $deviceId;
        $state['cronometro']['lastClaimAt'] = $nowMs;
        $outcome = array('ok' => true, 'state' => publicState($state));
        $wheelGranted = maybeGrantWheelReward('cronometro', $deviceId, $name);
        if ($wheelGranted) $outcome['wheelGranted'] = $wheelGranted;
        $codeGranted = maybeGrantDirectCode('cronometro', $deviceId, $name);
        if ($codeGranted) $outcome['codeGranted'] = $codeGranted;
        return $state;
      }

      // La tarjeta de fidelidad no se bloquea entre clientes: cada uno reclama
      // la suya sin afectar a los demás. El reto del día sí tiene un límite de
      // ganadores por día (admin-configurable, por defecto 1).
      if ($claimMethod === 'challenge' && count($state['challenge']['claims']) >= challengeDailyLimit()) {
        $outcome = array('ok' => false, 'alreadyClaimed' => true, 'state' => publicState($state));
        return null;
      }

      /* La tarjeta SÍ se comprueba, aunque sea la de cada quien: hasta acá no
         se miraba nada y el botón entregaba un premio cada vez que se tocaba
         — con una sola tarjeta llena se sacaban cuatro premios seguidos.
         Ahora manda el servidor: sin los sellos completos no hay premio, y al
         reclamar la tarjeta se vacía, así que el segundo toque ya no califica.
         Todo dentro del candado de loyalty.json, o sea que dos toques a la vez
         entran en fila y solo el primero gana. */
      if ($claimMethod === 'loyalty') {
        $reclamo = array('ok' => false, 'reason' => 'error');
        loyaltyWithWriteLock(function ($lstate) use ($deviceId, $name, &$reclamo) {
          $reclamo = loyaltyReclamar($lstate, $deviceId, $name);
          return !empty($reclamo['ok']) ? $lstate : null;
        });
        if (empty($reclamo['ok'])) {
          $motivos = array(
            'no-device'  => 'No pudimos identificar tu tarjeta en este dispositivo.',
            'incomplete' => 'Todavía te faltan sellos para reclamar.',
          );
          $razon = isset($reclamo['reason']) ? $reclamo['reason'] : 'error';
          $outcome = array(
            'ok' => false,
            'alreadyClaimed' => true,
            'error' => isset($motivos[$razon]) ? $motivos[$razon] : 'No se pudo reclamar la tarjeta.',
            'loyaltyCard' => isset($reclamo['card']) ? $reclamo['card'] : null,
            'state' => publicState($state),
          );
          return null;
        }
        $outcomeLoyaltyCard = isset($reclamo['card']) ? $reclamo['card'] : null;
      }

      $photoRel = null;
      if ($claimMethod === 'challenge' && $photoDataUrl) {
        if (!preg_match('#^data:image/(jpe?g|png|webp);base64,#i', $photoDataUrl)) {
          $outcome = array('ok' => false, 'error' => 'Formato de imagen no válido.', 'httpCode' => 400);
          return null;
        }
        $commaPos = strpos($photoDataUrl, ',');
        $b64 = $commaPos !== false ? substr($photoDataUrl, $commaPos + 1) : '';
        $bin = $b64 ? base64_decode($b64, true) : false;
        global $MAX_PHOTO_BYTES;
        if ($bin === false || strlen($bin) === 0 || strlen($bin) > $MAX_PHOTO_BYTES) {
          $outcome = array('ok' => false, 'error' => 'La imagen no es válida o pesa demasiado.', 'httpCode' => 400);
          return null;
        }
        $imgInfo = @getimagesizefromstring($bin);
        $mimeToExt = array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp');
        if (!$imgInfo || !isset($imgInfo['mime']) || !isset($mimeToExt[$imgInfo['mime']])) {
          $outcome = array('ok' => false, 'error' => 'La imagen no es válida.', 'httpCode' => 400);
          return null;
        }
        $ext = $mimeToExt[$imgInfo['mime']];
        global $UPLOADS_DIR;
        $filename = 'stiker-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
        @file_put_contents($UPLOADS_DIR . '/' . $filename, $bin);
        $photoRel = 'api/uploads/' . $filename;
        $state['stikers'][] = array(
          'id' => uniqid('stk_', true),
          'image' => $photoRel,
          'alt' => $name,
          'deviceId' => $deviceId,
          'date' => $state['day'],
        );
      }

      if ($claimMethod === 'loyalty') {
        $state['loyalty']['claimed'] = true;
        $state['loyalty']['name'] = $name;
        $state['loyalty']['deviceId'] = $deviceId;
        $state['loyalty']['claimedAt'] = date('c');
      } else {
        $state['challenge']['claims'][] = array(
          'name' => $name,
          'deviceId' => $deviceId,
          'photo' => $photoRel,
          'claimedAt' => date('c'),
        );
      }

      $outcome = array('ok' => true, 'state' => publicState($state));
      if (isset($outcomeLoyaltyCard)) $outcome['loyaltyCard'] = $outcomeLoyaltyCard;
      $wheelGranted = maybeGrantWheelReward($claimMethod, $deviceId, $name);
      if ($wheelGranted) $outcome['wheelGranted'] = $wheelGranted;
      $codeGranted = maybeGrantDirectCode($claimMethod, $deviceId, $name);
      if ($codeGranted) $outcome['codeGranted'] = $codeGranted;
      return $state;
    });

    $code = isset($outcome['httpCode']) ? $outcome['httpCode'] : ($outcome['ok'] ? 200 : 200);
    unset($outcome['httpCode']);
    jsonOut($outcome, $code);
  }

  if ($action === 'rename') {
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $newName = isset($body['newName']) ? trim((string) $body['newName']) : '';
    if ($deviceId === '' || $newName === '') {
      jsonOut(array('ok' => false, 'error' => 'Faltan datos.'), 400);
    }
    $newName = function_exists('mb_substr') ? mb_substr(strip_tags($newName), 0, 60) : substr(strip_tags($newName), 0, 60);

    $ocupado = nombreNoDisponible($newName, $deviceId);
    if ($ocupado !== null) jsonOut(array('ok' => false, 'taken' => true, 'error' => $ocupado), 409);

    $outcome = array('ok' => true);
    withWriteLock(function ($state) use ($deviceId, $newName, &$outcome) {
      ensureFreshDay($state);
      if (!empty($state['cronometro']['lastClaimDevice']) && hash_equals((string) $state['cronometro']['lastClaimDevice'], $deviceId)) {
        $state['cronometro']['lastClaimName'] = $newName;
      }
      if (!empty($state['loyalty']['deviceId']) && hash_equals((string) $state['loyalty']['deviceId'], $deviceId)) {
        $state['loyalty']['name'] = $newName;
      }
      foreach ($state['challenge']['claims'] as &$c) {
        if (!empty($c['deviceId']) && hash_equals((string) $c['deviceId'], $deviceId)) {
          $c['name'] = $newName;
        }
      }
      unset($c);
      foreach ($state['stikers'] as &$s) {
        if (!empty($s['deviceId']) && hash_equals((string) $s['deviceId'], $deviceId)) {
          $s['alt'] = $newName;
        }
      }
      unset($s);
      $outcome = array('ok' => true, 'state' => publicState($state));
      return $state;
    });

    /* El nombre también tiene que llegar al libro de premios, a los canjes, a
       los tiros de la ruleta y a los intentos del cronómetro — si no, el panel
       sigue mostrando el nombre viejo. Va FUERA del candado de premio.json:
       cada archivo tiene el suyo. */
    $outcome['renamed'] = renameInAllRecords($deviceId, $newName);
    jsonOut($outcome);
  }

  if ($action === 'delete-stiker') {
    $id = isset($body['id']) ? trim((string) $body['id']) : '';
    $secret = isset($body['secret']) ? trim((string) $body['secret']) : '';
    if ($id === '' || !checkAdminSecret($secret)) {
      jsonOut(array('ok' => false, 'error' => 'Clave de administrador inválida.'), 403);
    }

    $outcome = array('ok' => true);
    withWriteLock(function ($state) use ($id, &$outcome) {
      ensureFreshDay($state);
      $found = null;
      $remaining = array();
      foreach ($state['stikers'] as $s) {
        if (isset($s['id']) && $s['id'] === $id) { $found = $s; continue; }
        $remaining[] = $s;
      }
      $state['stikers'] = $remaining;
      if ($found && !empty($found['image'])) {
        $path = __DIR__ . '/../' . $found['image'];
        if (is_file($path)) @unlink($path);
      }
      $outcome = array('ok' => true, 'state' => publicState($state));
      return $state;
    });
    jsonOut($outcome);
  }

  if ($action === 'admin-reset-challenge') {
    $secret = isset($body['secret']) ? trim((string) $body['secret']) : '';
    if (!checkAdminSecret($secret)) {
      jsonOut(array('ok' => false, 'error' => 'Clave de administrador inválida.'), 403);
    }

    $outcome = array('ok' => true);
    withWriteLock(function ($state) use (&$outcome) {
      ensureFreshDay($state);
      $state['challenge'] = defaultChallenge();
      $outcome = array('ok' => true, 'state' => publicState($state));
      return $state;
    });
    jsonOut($outcome);
  }

  /* Reinicia la cuenta regresiva del cronómetro: se borra el ganador de hoy y
     el conteo vuelve a arrancar desde este instante (cronometroUnlocksAtMs
     usa lastClaimAt cuando existe, así que limpiarlo lo devuelve al arranque
     del día... por eso se deja lastClaimAt en "ahora" pero sin nombre: así el
     temporizador cuenta desde cero de nuevo y no queda aviso de ganador). */
  if ($action === 'admin-reset-cronometro') {
    $secret = isset($body['secret']) ? trim((string) $body['secret']) : '';
    if (!checkAdminSecret($secret)) {
      jsonOut(array('ok' => false, 'error' => 'Clave de administrador inválida.'), 403);
    }

    $outcome = array('ok' => true);
    withWriteLock(function ($state) use (&$outcome) {
      ensureFreshDay($state);
      $state['cronometro'] = defaultCronometro();
      $state['cronometro']['lastClaimAt'] = (int) round(microtime(true) * 1000);
      $outcome = array('ok' => true, 'state' => publicState($state));
      return $state;
    });
    jsonOut($outcome);
  }

  jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}

jsonOut(array('ok' => false, 'error' => 'Solicitud no válida.'), 400);
