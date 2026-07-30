<?php
/**
 * Endpoints de "Detén el tiempo".
 *
 * Sobre la validación del tiempo — vale la pena leerlo antes de cambiar algo:
 *
 * Quien decide si ganó o no es SIEMPRE el servidor, nunca el navegador. Pero el
 * servidor no puede usar solo su propio reloj para medir cuánto duró el intento:
 * entre que el celular manda "detener" y llega el mensaje pasan de 100 a 500 ms
 * de red, así que el tiempo medido acá siempre sería más alto que el que el
 * cliente vio en pantalla, y en dificultad "difícil" sería imposible ganar.
 *
 * Entonces: el celular mide con su propio reloj monótono y manda ese valor, y
 * el servidor lo ACEPTA SOLO SI ES VEROSÍMIL contra su propia medición —
 * nunca puede ser mayor de lo que el servidor vio pasar (más un margen chico
 * por el redondeo), ni tanto menor como para que alguien invente un número.
 * Así el que hace trampa mandando "10000" cuando dejó pasar un minuto queda
 * rechazado, y el que juega normal gana con el tiempo que vio en pantalla.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/stoptime-lib.php';
require_once __DIR__ . '/codes-lib.php';
require_once __DIR__ . '/ruleta-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$CONTENT_FILE = __DIR__ . '/../admin/content.json';
$MAX_NAME_CHARS = 60;

/* Cuánto puede diferir el tiempo que manda el celular del que midió el servidor.
   Arriba: solo el redondeo — el servidor SIEMPRE ve más, porque la red suma.
   Abajo: la ida y vuelta más lenta que se acepta (la del "empezar" más la del
   "detener"). Este número es justo el margen de trampa que queda: quien deje
   pasar más de 2,5 s de más y reporte el tiempo exacto, queda rechazado. Subirlo
   perdona conexiones malas pero agranda ese hueco. */
$SLACK_ARRIBA_MS = 250;
$SLACK_ABAJO_MS = 2500;

function jsonOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }

function stCheckAdminSecret($secret) {
  global $CONTENT_FILE;
  $configured = '';
  if (file_exists($CONTENT_FILE)) {
    $raw = @file_get_contents($CONTENT_FILE);
    $data = $raw ? json_decode($raw, true) : null;
    if (is_array($data) && isset($data['business']['adminSecret'])) {
      $configured = trim((string) $data['business']['adminSecret']);
    }
  }
  return $configured !== '' && $secret !== '' && hash_equals($configured, $secret);
}

/** ¿El código de premio de este intento ya fue reclamado o entregado? */
function stPrizeClaimed($code) {
  if (!$code) return false;
  $state = codesReadState();
  $idx = findCodeIndex($state['codes'], $code);
  if ($idx === null) return false;
  $status = $state['codes'][$idx]['status'];
  return $status === 'waiting' || $status === 'delivered';
}

/** Lo que ve el cliente: su propio intento, sin datos de nadie más. */
function stMyView($state, $deviceId, $cfg) {
  $abierta = $state['roundStatus'] === 'running' && stInWindow($cfg);
  $usados = stCountAttempts($state, $deviceId, $cfg);
  $ganadores = stCountWinners($state);
  $ultimo = stLastAttempt($state, $deviceId);

  $mio = array('state' => 'none', 'elapsedMs' => null, 'prizeCode' => null, 'prizeClaimed' => false);
  if ($ultimo && !empty($ultimo['stoppedAt'])) {
    $mio['state'] = !empty($ultimo['won']) ? 'won' : 'lost';
    $mio['elapsedMs'] = (int) $ultimo['elapsedMs'];
    $mio['prizeCode'] = isset($ultimo['prizeCode']) ? $ultimo['prizeCode'] : null;
    $mio['prizeClaimed'] = stPrizeClaimed($mio['prizeCode']);
  } elseif ($ultimo) {
    $mio['state'] = 'running';   // arrancó y no ha detenido
  }

  return array(
    'ok' => true,
    'roundId' => $state['roundId'],
    'roundStatus' => $state['roundStatus'],
    'roundOpen' => $abierta,
    'inWindow' => stInWindow($cfg),
    'targetMs' => $cfg['targetMs'],
    'precision' => $cfg['precision'],
    'attemptsPerUser' => $cfg['attemptsPerUser'],
    'attemptsUsed' => $usados,
    'attemptsLeft' => max(0, $cfg['attemptsPerUser'] - $usados),
    'winners' => $ganadores,
    'maxWinners' => $cfg['maxWinners'],
    'prizeAvailable' => $cfg['maxWinners'] <= 0 || $ganadores < $cfg['maxWinners'],
    'mine' => $mio,
    'serverNow' => stNowMs(),
  );
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$body = array();
if ($method === 'POST') {
  $parsed = json_decode(file_get_contents('php://input'), true);
  $body = is_array($parsed) ? $parsed : array();
  // la acción también se lee del cuerpo (como premio.php): no hacerlo fue el
  // fallo que dejó el cambio de nombre sin efecto durante días
  if ($action === '' && isset($body['action'])) $action = (string) $body['action'];
}

$cfg = stConfig();

switch ($action) {

  case 'status': {
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    jsonOut(stMyView(stReadState(), $deviceId, $cfg));
  }

  /* ---------------- arranca un intento ---------------- */
  case 'start': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    if ($deviceId === '') jsonOut(array('ok' => false, 'error' => 'Falta identificar el dispositivo.'), 400);

    $out = array('ok' => false, 'error' => 'No se pudo empezar.');
    stWithWriteLock(function ($state) use ($deviceId, $name, $cfg, &$out) {
      if ($state['roundStatus'] !== 'running') {
        $out = array('ok' => false, 'reason' => 'round_closed');
        return null;
      }
      if (!stInWindow($cfg)) {
        $out = array('ok' => false, 'reason' => 'out_of_window');
        return null;
      }
      if (stCountAttempts($state, $deviceId, $cfg) >= $cfg['attemptsPerUser']) {
        $out = array('ok' => false, 'reason' => 'no_attempts');
        return null;
      }
      // un intento sin terminar se reutiliza: si alguien recarga la página a
      // mitad del intento NO recupera el intento, sigue con el mismo
      $abierto = null;
      foreach ($state['attempts'] as $a) {
        if (!isset($a['deviceId'], $a['roundId'])) continue;
        if ($a['deviceId'] !== $deviceId || $a['roundId'] !== $state['roundId']) continue;
        if (!isset($a['stoppedAt']) || $a['stoppedAt'] === null) { $abierto = $a; break; }
      }
      if ($abierto) {
        $out = array('ok' => true, 'attemptId' => $abierto['id'], 'startedAt' => $abierto['startedAt'], 'serverNow' => stNowMs(), 'resumed' => true);
        return null;
      }

      $now = stNowMs();
      $intento = array(
        'id' => uniqid('att_', true),
        'roundId' => $state['roundId'],
        'day' => date('Y-m-d'),
        'deviceId' => $deviceId,
        'name' => $name,
        'startedAt' => $now,
        'stoppedAt' => null,
        'elapsedMs' => null,
        'serverElapsedMs' => null,
        'won' => false,
        'prizeCode' => null,
      );
      $state['attempts'][] = $intento;
      $out = array('ok' => true, 'attemptId' => $intento['id'], 'startedAt' => $now, 'serverNow' => $now, 'resumed' => false);
      return $state;
    });

    jsonOut($out, !empty($out['ok']) ? 200 : 400);
  }

  /* ---------------- detiene el cronómetro y decide ---------------- */
  case 'stop': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $attemptId = isset($body['attemptId']) ? trim((string) $body['attemptId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, $MAX_NAME_CHARS);
    $elapsedCliente = isset($body['elapsedMs']) ? (int) $body['elapsedMs'] : -1;
    if ($deviceId === '' || $attemptId === '') jsonOut(array('ok' => false, 'error' => 'Faltan datos del intento.'), 400);
    if ($elapsedCliente < 0) jsonOut(array('ok' => false, 'error' => 'Tiempo inválido.'), 400);

    $out = array('ok' => false, 'error' => 'No se pudo registrar el intento.');
    stWithWriteLock(function ($state) use ($deviceId, $attemptId, $name, $elapsedCliente, $cfg, &$out) {
      global $SLACK_ARRIBA_MS, $SLACK_ABAJO_MS;

      $idx = null;
      foreach ($state['attempts'] as $i => $a) {
        if (isset($a['id']) && $a['id'] === $attemptId) { $idx = $i; break; }
      }
      if ($idx === null) { $out = array('ok' => false, 'reason' => 'attempt_not_found'); return null; }
      $a = $state['attempts'][$idx];
      // que el intento sea de ESTE dispositivo: sin esto, cualquiera con el id
      // de otro podría cerrarle el intento
      if (!isset($a['deviceId']) || $a['deviceId'] !== $deviceId) { $out = array('ok' => false, 'reason' => 'attempt_not_found'); return null; }
      if (!empty($a['stoppedAt'])) { $out = array('ok' => false, 'reason' => 'already_stopped'); return null; }

      $now = stNowMs();
      $elapsedServidor = $now - (int) $a['startedAt'];

      // El servidor SIEMPRE ve pasar más tiempo que el celular (la red suma).
      // Que el celular reporte MÁS que el servidor solo puede ser trampa.
      if ($elapsedCliente > $elapsedServidor + $SLACK_ARRIBA_MS ||
          $elapsedCliente < $elapsedServidor - $SLACK_ABAJO_MS) {
        // El intento igual se consume y se registra, para que reintentar con
        // números inventados no salga gratis.
        $state['attempts'][$idx]['stoppedAt'] = $now;
        $state['attempts'][$idx]['elapsedMs'] = $elapsedCliente;
        $state['attempts'][$idx]['serverElapsedMs'] = $elapsedServidor;
        $state['attempts'][$idx]['won'] = false;
        $state['attempts'][$idx]['rejected'] = true;
        $out = array('ok' => false, 'reason' => 'time_mismatch', 'serverElapsedMs' => $elapsedServidor);
        return $state;
      }

      $gano = stIsWin($elapsedCliente, $cfg);

      // El tope de ganadores se revisa DENTRO del candado: dos personas que
      // acierten al mismo tiempo no pueden pasar las dos si solo hay un cupo.
      if ($gano && $cfg['maxWinners'] > 0 && stCountWinners($state) >= $cfg['maxWinners']) {
        $gano = false;
        $sinCupo = true;
      } else {
        $sinCupo = false;
      }

      $state['attempts'][$idx]['stoppedAt'] = $now;
      $state['attempts'][$idx]['elapsedMs'] = $elapsedCliente;
      $state['attempts'][$idx]['serverElapsedMs'] = $elapsedServidor;
      $state['attempts'][$idx]['won'] = $gano;
      if ($name !== '') $state['attempts'][$idx]['name'] = $name;

      $codigo = null;
      $tiros = null;
      if ($gano) {
        // El premio entra al MISMO libro de premios que todas las demás
        // dinámicas: aparece en 🎁 Mis Premios y se reclama igual que
        // cualquier otro. No hay un sistema de premios aparte.
        if ($cfg['rewardType'] === 'wheelSpins') {
          $ids = grantRuletaTickets($deviceId, $name, 'stoptime', $cfg['wheelSpinCount'], $cfg['wheelTicketExpiryHours']);
          $tiros = count($ids);
        } else {
          $rec = issuePrizeCode($deviceId, $name, 'stoptime', $cfg['prizeName'], $cfg['prizeIcon'], $cfg['codeExpiryHours']);
          if ($rec) {
            $codigo = $rec['code'];
            $state['attempts'][$idx]['prizeCode'] = $codigo;
          }
        }
      }

      $out = array(
        'ok' => true,
        'won' => $gano,
        'noSlots' => $sinCupo,
        'elapsedMs' => $elapsedCliente,
        'targetMs' => $cfg['targetMs'],
        'prizeCode' => $codigo,
        'prizeName' => $cfg['prizeName'],
        'prizeIcon' => $cfg['prizeIcon'],
        'wheelSpins' => $tiros,
        'attemptsLeft' => max(0, $cfg['attemptsPerUser'] - stCountAttempts($state, $deviceId, $cfg)),
      );
      return $state;
    });

    jsonOut($out, !empty($out['ok']) ? 200 : 400);
  }

  /* ---------------- panel: control de la ronda ---------------- */
  case 'admin-round': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $secret = isset($body['secret']) ? trim((string) $body['secret']) : '';
    if (!stCheckAdminSecret($secret)) jsonOut(array('ok' => false, 'error' => 'Clave de administrador incorrecta.'), 403);
    $op = isset($body['op']) ? (string) $body['op'] : '';
    if (!in_array($op, array('start', 'end', 'reset-participants'), true)) {
      jsonOut(array('ok' => false, 'error' => 'Operación no reconocida.'), 400);
    }

    $final = stWithWriteLock(function ($state) use ($op) {
      if ($op === 'start') {
        $state['roundId'] = uniqid('rnd_', true);
        $state['roundStatus'] = 'running';
        $state['roundStartedAt'] = stNowMs();
        $state['roundEndedAt'] = null;
        return $state;
      }
      if ($op === 'end') {
        $state['roundStatus'] = 'ended';
        $state['roundEndedAt'] = stNowMs();
        return $state;
      }
      if ($op === 'reset-participants') {
        // Se borran solo los intentos de la ronda actual: el histórico de
        // rondas anteriores queda como registro.
        $actual = $state['roundId'];
        $state['attempts'] = array_values(array_filter($state['attempts'], function ($a) use ($actual) {
          return !isset($a['roundId']) || $a['roundId'] !== $actual;
        }));
        return $state;
      }
      return null;
    });

    if (!is_array($final)) jsonOut(array('ok' => false, 'error' => 'No se pudo guardar el estado de la ronda.'), 500);
    jsonOut(array('ok' => true, 'roundId' => $final['roundId'], 'roundStatus' => $final['roundStatus']));
  }

  /* ---------------- panel: resumen de la ronda ---------------- */
  case 'admin-status': {
    $secret = isset($_GET['secret']) ? trim((string) $_GET['secret']) : '';
    if (!stCheckAdminSecret($secret)) jsonOut(array('ok' => false, 'error' => 'Clave de administrador incorrecta.'), 403);
    $state = stReadState();

    $deLaRonda = array();
    foreach ($state['attempts'] as $a) {
      if (isset($a['roundId']) && $a['roundId'] === $state['roundId']) $deLaRonda[] = $a;
    }
    usort($deLaRonda, function ($x, $y) { return (int) $y['startedAt'] - (int) $x['startedAt']; });

    $participantes = array();
    foreach ($deLaRonda as $a) $participantes[$a['deviceId']] = true;

    $lista = array();
    foreach (array_slice($deLaRonda, 0, 60) as $a) {
      $lista[] = array(
        'name' => isset($a['name']) && $a['name'] !== '' ? $a['name'] : '(sin nombre)',
        'startedAt' => (int) $a['startedAt'],
        'stoppedAt' => $a['stoppedAt'],
        'elapsedMs' => $a['elapsedMs'],
        'won' => !empty($a['won']),
        'rejected' => !empty($a['rejected']),
        'prizeCode' => isset($a['prizeCode']) ? $a['prizeCode'] : null,
        'prizeStatus' => (isset($a['prizeCode']) && $a['prizeCode']) ? (stPrizeClaimed($a['prizeCode']) ? 'reclamado' : 'sin reclamar') : null,
      );
    }

    jsonOut(array(
      'ok' => true,
      'roundId' => $state['roundId'],
      'roundStatus' => $state['roundStatus'],
      'roundStartedAt' => $state['roundStartedAt'],
      'roundEndedAt' => $state['roundEndedAt'],
      'inWindow' => stInWindow($cfg),
      'targetMs' => $cfg['targetMs'],
      'precision' => $cfg['precision'],
      'maxWinners' => $cfg['maxWinners'],
      'winners' => stCountWinners($state),
      'participants' => count($participantes),
      'attempts' => count($deLaRonda),
      'log' => $lista,
      'serverNow' => stNowMs(),
    ));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
