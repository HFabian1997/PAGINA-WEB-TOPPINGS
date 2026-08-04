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
require_once __DIR__ . '/customers-lib.php';
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

/** ¿El mesero ya recibió o entregó este premio? (solo para el panel) */
function stPrizeClaimed($code) {
  if (!$code) return false;
  $state = codesReadState();
  $idx = findCodeIndex($state['codes'], $code);
  if ($idx === null) return false;
  $status = $state['codes'][$idx]['status'];
  return $status === 'waiting' || $status === 'delivered';
}

/** Nombre, ícono y vencimiento del premio que de verdad le tocó, leídos del
    libro de premios. Se leen de ahí y no de la configuración actual: si el
    admin le cambia el nombre al premio, quien ya ganó debe seguir viendo el
    que ganó. */
function stPrizeInfo($code) {
  if (!$code) return null;
  $state = codesReadState();
  $idx = findCodeIndex($state['codes'], $code);
  if ($idx === null) return null;
  $c = $state['codes'][$idx];
  return array(
    'prizeName' => isset($c['prizeName']) ? $c['prizeName'] : null,
    'prizeIcon' => isset($c['prizeIcon']) ? $c['prizeIcon'] : '🎁',
    'expiresAt' => isset($c['expiresAt']) ? $c['expiresAt'] : null,
  );
}

/** Lo que ve el cliente: su propio intento, sin datos de nadie más. */
function stMyView($state, $deviceId, $cfg) {
  $usados = stCountAttempts($state, $deviceId, $cfg);
  $ganadores = stCountWinners($state, $cfg);
  $ultimo = stLastAttempt($state, $deviceId, $cfg);

  $mio = array(
    'state' => 'none', 'elapsedMs' => null, 'prizeCode' => null, 'prizeClaimed' => false,
    'rewardType' => 'prize', 'wheelSpins' => 0,
    'prizeName' => null, 'prizeIcon' => '🎁', 'prizeExpiresAt' => null,
  );
  if ($ultimo && !empty($ultimo['stoppedAt'])) {
    $mio['state'] = !empty($ultimo['won']) ? 'won' : 'lost';
    $mio['elapsedMs'] = (int) $ultimo['elapsedMs'];
    $mio['prizeCode'] = isset($ultimo['prizeCode']) ? $ultimo['prizeCode'] : null;

    /* "Reclamado" acá significa "ya vio la animación del premio", no "el
       mesero ya se lo entregó". Son dos cosas distintas: el código queda en
       waiting/delivered recién cuando lo entregan, y los tiros de Ruleta
       siguen disponibles hasta que gire. Con cualquiera de esos dos el botón
       se quedaría verde después de abrir el regalo. */
    $mio['prizeClaimed'] = !empty($ultimo['revealedAt']);

    // Un premio en tiros de Ruleta no genera código: lo que se gana es el tiro.
    if (!empty($ultimo['wheelSpins'])) {
      $mio['rewardType'] = 'wheelSpins';
      $mio['wheelSpins'] = (int) $ultimo['wheelSpins'];
    } else {
      $info = stPrizeInfo($mio['prizeCode']);
      if ($info) {
        $mio['prizeName'] = $info['prizeName'];
        $mio['prizeIcon'] = $info['prizeIcon'];
        $mio['prizeExpiresAt'] = $info['expiresAt'];
      }
    }
  } elseif ($ultimo) {
    $mio['state'] = 'running';   // arrancó y no ha detenido
  }

  return array(
    'ok' => true,
    'inWindow' => stInWindow($cfg),
    'targetMs' => $cfg['targetMs'],
    'precision' => $cfg['precision'],
    'attemptsPerUser' => $cfg['attemptsPerUser'],
    'attemptsUsed' => $usados,
    'attemptsLeft' => max(0, $cfg['attemptsPerUser'] - $usados),
    'attemptsReset' => $cfg['attemptsReset'],
    // cuándo vuelve a tener intento (null si le quedan, o si depende del admin)
    'nextAttemptAtMs' => stNextResetMs($state, $deviceId, $cfg),
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
    // Queda registrado como cliente sin pedirle el nombre otra vez: acá ya
    // viene, y así el registro se repara solo cuando la gente juega.
    rememberCustomer($deviceId, $name);

    $out = array('ok' => false, 'error' => 'No se pudo empezar.');
    stWithWriteLock(function ($state) use ($deviceId, $name, $cfg, &$out) {
      // Ya no hay rondas: lo único que puede cerrar el juego son las fechas
      // configuradas, y de ahí en más manda el tiempo de reinicio.
      if (!stInWindow($cfg)) {
        $out = array('ok' => false, 'reason' => 'out_of_window');
        return null;
      }
      if (stCountAttempts($state, $deviceId, $cfg) >= $cfg['attemptsPerUser']) {
        $out = array('ok' => false, 'reason' => 'no_attempts');
        return null;
      }
      // Un intento sin terminar se reutiliza: si alguien recarga la página a
      // mitad del intento NO recupera el intento, sigue con el mismo. Se busca
      // solo dentro de la ventana vigente, para que un intento abandonado ayer
      // no se le coma el intento de hoy.
      $abierto = null;
      foreach (stAttemptsInWindow($state, $deviceId, $cfg) as $a) {
        if (!isset($a['stoppedAt']) || $a['stoppedAt'] === null) { $abierto = $a; break; }
      }
      if ($abierto) {
        $out = array('ok' => true, 'attemptId' => $abierto['id'], 'startedAt' => $abierto['startedAt'], 'serverNow' => stNowMs(), 'resumed' => true);
        return null;
      }

      $now = stNowMs();
      $intento = array(
        'id' => uniqid('att_', true),
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
      if ($gano && $cfg['maxWinners'] > 0 && stCountWinners($state, $cfg) >= $cfg['maxWinners']) {
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
      $registroCodigo = null;
      if ($gano) {
        // El premio entra al MISMO libro de premios que todas las demás
        // dinámicas: aparece en 🎁 Mis Premios y se reclama igual que
        // cualquier otro. No hay un sistema de premios aparte.
        if ($cfg['rewardType'] === 'wheelSpins') {
          $ids = grantRuletaTickets($deviceId, $name, 'stoptime', $cfg['wheelSpinCount'], $cfg['wheelTicketExpiryHours']);
          $tiros = count($ids);
          // se guardan para poder decirle después si ya los usó o no
          $state['attempts'][$idx]['wheelSpins'] = $tiros;
          $state['attempts'][$idx]['wheelTicketIds'] = $ids;
        } else {
          $rec = issuePrizeCode($deviceId, $name, 'stoptime', $cfg['prizeName'], $cfg['prizeIcon'], $cfg['codeExpiryHours']);
          if ($rec) {
            $codigo = $rec['code'];
            $registroCodigo = $rec;
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
        /* Mismos dos bloques que devuelven las otras dinámicas (premio.php),
           para que el cliente pueda abrir la MISMA ventana animada del regalo
           con openClaimResult() en vez de inventar una propia. */
        'wheelGranted' => $tiros ? array('count' => $tiros) : null,
        'codeGranted' => $registroCodigo ? array(
          'code' => $registroCodigo['code'],
          'prizeName' => $registroCodigo['prizeName'],
          'prizeIcon' => $registroCodigo['prizeIcon'],
          'expiresAt' => $registroCodigo['expiresAt'],
        ) : null,
      );
      return $state;
    });

    jsonOut($out, !empty($out['ok']) ? 200 : 400);
  }

  /* ---------------- marca que ya vio la animación del premio ----------------
     Es lo que apaga el botón verde. Va aparte del estado del código porque
     "ya abrió el regalo" y "el mesero ya se lo entregó" son cosas distintas. */
  case 'claim': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    if ($deviceId === '') jsonOut(array('ok' => false, 'error' => 'Falta identificar el dispositivo.'), 400);
    // acá no llega el nombre (ya se registró al empezar el intento)

    $out = array('ok' => false, 'reason' => 'not_found');
    stWithWriteLock(function ($state) use ($deviceId, $cfg, &$out) {
      $ultimo = stLastAttempt($state, $deviceId, $cfg);
      if (!$ultimo || empty($ultimo['won'])) { $out = array('ok' => false, 'reason' => 'not_found'); return null; }
      foreach ($state['attempts'] as $i => $a) {
        if (isset($a['id']) && $a['id'] === $ultimo['id']) {
          if (empty($a['revealedAt'])) $state['attempts'][$i]['revealedAt'] = stNowMs();
          $out = array('ok' => true);
          return $state;
        }
      }
      return null;
    });
    jsonOut($out, !empty($out['ok']) ? 200 : 400);
  }

  /* ---------------- panel: dejar jugar a todos otra vez ---------------- */
  case 'admin-reset': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $secret = isset($body['secret']) ? trim((string) $body['secret']) : '';
    if (!stCheckAdminSecret($secret)) jsonOut(array('ok' => false, 'error' => 'Clave de administrador incorrecta.'), 403);

    $final = stWithWriteLock(function ($state) {
      $state['attempts'] = array();
      return $state;
    });
    if (!is_array($final)) jsonOut(array('ok' => false, 'error' => 'No se pudo reiniciar.'), 500);
    jsonOut(array('ok' => true));
  }

  /* ---------------- panel: resumen del periodo ---------------- */
  case 'admin-status': {
    $secret = isset($_GET['secret']) ? trim((string) $_GET['secret']) : '';
    if (!stCheckAdminSecret($secret)) jsonOut(array('ok' => false, 'error' => 'Clave de administrador incorrecta.'), 403);
    $state = stReadState();

    // Los del periodo vigente: es lo que le importa al admin ahora mismo, y
    // coincide con el tope de ganadores que se está aplicando.
    $delPeriodo = array();
    foreach ($state['attempts'] as $a) {
      if (stInPeriod($a, $cfg)) $delPeriodo[] = $a;
    }
    usort($delPeriodo, function ($x, $y) { return (int) $y['startedAt'] - (int) $x['startedAt']; });

    $participantes = array();
    foreach ($delPeriodo as $a) $participantes[$a['deviceId']] = true;

    $lista = array();
    foreach (array_slice($delPeriodo, 0, 60) as $a) {
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
      'inWindow' => stInWindow($cfg),
      'targetMs' => $cfg['targetMs'],
      'precision' => $cfg['precision'],
      'attemptsReset' => $cfg['attemptsReset'],
      'maxWinners' => $cfg['maxWinners'],
      'winners' => stCountWinners($state, $cfg),
      'participants' => count($participantes),
      'attempts' => count($delPeriodo),
      'log' => $lista,
      'serverNow' => stNowMs(),
    ));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
