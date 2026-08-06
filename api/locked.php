<?php
/**
 * 🔒 Premio Bloqueado — endpoints del cliente y del panel.
 *
 * La regla de oro está en `claim`: comprobar que ya se desbloqueó, que nadie
 * lo tomó y marcarlo como tomado ocurre TODO dentro del mismo candado, igual
 * que el reclamo del cronómetro en premio.php. Fuera del candado no se decide
 * nada; el navegador nunca decide quién ganó.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/locked-lib.php';
require_once __DIR__ . '/codes-lib.php';
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

$MAX_NAME = 60;

function lkOut($arr, $code = 200) { http_response_code($code); echo json_encode($arr, JSON_UNESCAPED_UNICODE); exit; }

/**
 * Entra la sesión del panel o la clave de servicio (api/push-config.php, que
 * está fuera de git y bloqueada por web). Lo segundo permite comprobar desde
 * fuera que esto entrega un solo ganador, sin usar la contraseña de Fabián.
 */
function lkRequireAdmin() {
  if (!empty($_SESSION['authed'])) return;
  $f = __DIR__ . '/push-config.php';
  $cfg = file_exists($f) ? require $f : array();
  $esperado = is_array($cfg) && !empty($cfg['serviceSecret']) ? (string) $cfg['serviceSecret'] : '';
  $dado = isset($_GET['secret']) ? (string) $_GET['secret'] : '';
  if ($esperado !== '' && hash_equals($esperado, $dado)) return;
  lkOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
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

  /* ---------------- el cliente pregunta cómo va ---------------- */
  case 'state': {
    $deviceId = isset($_GET['deviceId']) ? trim((string) $_GET['deviceId']) : '';
    lkOut(lockedEstadoPublico(lockedRead(), $deviceId));
  }

  /* ---------------- el cliente reclama ----------------
     Acá se decide todo. Nada de esto se puede falsear desde el navegador:
     la hora la pone el servidor y el premio se marca dentro del candado. */
  case 'claim': {
    if ($method !== 'POST') lkOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    // el premio que el cliente tenía a la vista, para poder decirle con
    // precisión "alguien fue más rápido" en vez de un error genérico
    $viendo = isset($body['id']) ? trim((string) $body['id']) : '';
    if (function_exists('mb_substr')) $name = mb_substr(strip_tags($name), 0, $MAX_NAME);
    if ($deviceId === '') lkOut(array('ok' => false, 'error' => 'Falta identificar el dispositivo.'), 400);

    $resultado = array('ok' => false, 'razon' => 'sin-premio');

    lockedWithWriteLock(function ($state) use ($deviceId, $name, $viendo, &$resultado) {
      lockedRefrescar($state);

      /* Si el premio que estaba mirando ya lo ganó otro, se le dice eso —
         aunque ya no quede ninguno disponible. Sin esto, los que llegan
         segundos tarde ven un error genérico y no entienden qué pasó. */
      if ($viendo !== '') {
        $j = lockedBuscarIndice($state, $viendo);
        if ($j !== null && $state['prizes'][$j]['status'] === 'reclamado'
            && $state['prizes'][$j]['winnerDeviceId'] !== $deviceId) {
          $resultado = array('ok' => false, 'razon' => 'ya-reclamado',
                             'ganador' => $state['prizes'][$j]['winnerName']);
          return $state;
        }
      }

      $actual = lockedActual($state);
      if (!$actual) { $resultado = array('ok' => false, 'razon' => 'sin-premio'); return $state; }

      $i = lockedBuscarIndice($state, $actual['id']);
      if ($i === null) { $resultado = array('ok' => false, 'razon' => 'sin-premio'); return $state; }
      $p = $state['prizes'][$i];
      $ahora = lockedNowMs();

      // todavía no es la hora — aunque el celular diga otra cosa
      if ((int) $p['unlockAt'] > $ahora) {
        $resultado = array('ok' => false, 'razon' => 'todavia-bloqueado');
        return $state;
      }
      // alguien más ya lo tomó
      if ($p['status'] === 'reclamado') {
        $resultado = array('ok' => false, 'razon' => 'ya-reclamado', 'ganador' => $p['winnerName']);
        return $state;
      }
      if ($p['status'] === 'reservado') {
        $mio = isset($p['winnerDeviceId']) && $p['winnerDeviceId'] === $deviceId;
        if (!$mio) { $resultado = array('ok' => false, 'razon' => 'ya-reclamado'); return $state; }
        // es el mismo que lo reservó y volvió: se le deja seguir
      }

      /* Llegó primero. Si ya sabemos su nombre se cierra de una; si no, el
         premio queda GUARDADO a su nombre mientras lo escribe, para que nadie
         se lo quite mientras tanto. */
      $p['winnerDeviceId'] = $deviceId;
      if ($name !== '') {
        $p['status'] = 'reclamado';
        $p['winnerName'] = $name;
        $p['claimedAt'] = $ahora;
        $p['reservedUntil'] = null;
        $resultado = array('ok' => true, 'estado' => 'reclamado',
                           'prizeName' => $p['prizeName'], 'prizeIcon' => $p['prizeIcon'], 'id' => $p['id']);
      } else {
        $p['status'] = 'reservado';
        $p['reservedUntil'] = $ahora + lockedReservaMs();
        $resultado = array('ok' => true, 'estado' => 'falta-nombre',
                           'prizeName' => $p['prizeName'], 'prizeIcon' => $p['prizeIcon'], 'id' => $p['id'],
                           'reservadoHasta' => $p['reservedUntil']);
      }
      $state['prizes'][$i] = $p;
      return $state;
    });

    // el código del premio se emite FUERA del candado, para no tenerlo tomado
    // más de lo necesario; a esta altura el ganador ya está decidido
    if (!empty($resultado['ok']) && $resultado['estado'] === 'reclamado') {
      rememberCustomer($deviceId, $name);
      $rec = issuePrizeCode($deviceId, $name, 'premio-bloqueado',
                            $resultado['prizeName'], $resultado['prizeIcon'], 24);
      if ($rec) $resultado['codigo'] = array('code' => $rec['code'], 'expiresAt' => $rec['expiresAt']);
    }
    lkOut($resultado, !empty($resultado['ok']) ? 200 : 409);
  }

  /* ---------------- el ganador escribe su nombre ---------------- */
  case 'set-name': {
    if ($method !== 'POST') lkOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $deviceId = isset($body['deviceId']) ? trim((string) $body['deviceId']) : '';
    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if (function_exists('mb_substr')) $name = mb_substr(strip_tags($name), 0, $MAX_NAME);
    if ($deviceId === '' || $name === '') lkOut(array('ok' => false, 'error' => 'Escribe tu nombre.'), 400);

    $resultado = array('ok' => false, 'razon' => 'sin-premio');
    lockedWithWriteLock(function ($state) use ($deviceId, $name, &$resultado) {
      lockedRefrescar($state);
      foreach ($state['prizes'] as $i => $p) {
        if (!is_array($p) || $p['status'] !== 'reservado') continue;
        if (!isset($p['winnerDeviceId']) || $p['winnerDeviceId'] !== $deviceId) continue;

        $p['status'] = 'reclamado';
        $p['winnerName'] = $name;
        $p['claimedAt'] = lockedNowMs();
        $p['reservedUntil'] = null;
        $state['prizes'][$i] = $p;
        $resultado = array('ok' => true, 'prizeName' => $p['prizeName'],
                           'prizeIcon' => $p['prizeIcon'], 'id' => $p['id']);
        return $state;
      }
      // si venció la reserva mientras escribía, se le dice con claridad
      $resultado = array('ok' => false, 'razon' => 'reserva-vencida');
      return $state;
    });

    if (!empty($resultado['ok'])) {
      rememberCustomer($deviceId, $name);
      $rec = issuePrizeCode($deviceId, $name, 'premio-bloqueado',
                            $resultado['prizeName'], $resultado['prizeIcon'], 24);
      if ($rec) $resultado['codigo'] = array('code' => $rec['code'], 'expiresAt' => $rec['expiresAt']);
    }
    lkOut($resultado, !empty($resultado['ok']) ? 200 : 409);
  }

  /* ---------------- panel ---------------- */
  case 'admin-list': {
    lkRequireAdmin();
    $state = lockedRead();
    $prizes = $state['prizes'];
    usort($prizes, function ($a, $b) { return ((int) $a['unlockAt']) - ((int) $b['unlockAt']); });
    lkOut(array('ok' => true, 'prizes' => $prizes, 'serverNow' => lockedNowMs()));
  }

  case 'admin-save': {
    lkRequireAdmin();
    if ($method !== 'POST') lkOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $entran = isset($body['prizes']) && is_array($body['prizes']) ? $body['prizes'] : array();

    $guardados = null;
    lockedWithWriteLock(function ($state) use ($entran, &$guardados) {
      /* Los premios YA reclamados no se tocan nunca: son el registro de quién
         ganó qué. El panel solo manda los que se pueden editar. */
      $intocables = array();
      foreach ($state['prizes'] as $p) {
        if (is_array($p) && isset($p['status']) && $p['status'] === 'reclamado') $intocables[] = $p;
      }

      $nuevos = array();
      foreach ($entran as $e) {
        if (!is_array($e)) continue;
        $nombre = isset($e['prizeName']) ? trim((string) $e['prizeName']) : '';
        $cuando = isset($e['unlockAt']) ? (int) $e['unlockAt'] : 0;
        if ($nombre === '' || $cuando <= 0) continue;

        $id = isset($e['id']) && $e['id'] !== '' ? (string) $e['id'] : uniqid('lkp_', true);
        $estado = isset($e['status']) ? (string) $e['status'] : 'programado';
        if (!in_array($estado, array('programado', 'desbloqueado', 'reservado', 'cancelado'), true)) {
          $estado = 'programado';
        }
        $nuevos[] = array(
          'id' => $id,
          'prizeName' => $nombre,
          'prizeIcon' => isset($e['prizeIcon']) && $e['prizeIcon'] !== '' ? (string) $e['prizeIcon'] : '🎁',
          'unlockAt' => $cuando,
          'status' => $estado,
          'winnerName' => null,
          'winnerDeviceId' => null,
          'claimedAt' => null,
          'reservedUntil' => null,
        );
      }
      $state['prizes'] = array_merge($intocables, $nuevos);
      $guardados = count($nuevos);
      return $state;
    });
    lkOut(array('ok' => true, 'guardados' => $guardados));
  }

  /**
   * Borrar un ganador del historial. admin-save no puede tocarlos —son el
   * registro de quién ganó qué— así que hace falta una acción aparte para
   * sacar una entrada equivocada o de prueba, que además se le muestra a los
   * clientes como "ganador anterior".
   */
  case 'admin-forget': {
    lkRequireAdmin();
    $id = isset($body['id']) ? trim((string) $body['id']) : '';
    if ($id === '' && isset($_GET['id'])) $id = trim((string) $_GET['id']);
    if ($id === '') lkOut(array('ok' => false, 'error' => 'Falta el premio.'), 400);

    $quitados = 0;
    lockedWithWriteLock(function ($state) use ($id, &$quitados) {
      $antes = count($state['prizes']);
      $state['prizes'] = array_values(array_filter($state['prizes'], function ($p) use ($id) {
        return !(is_array($p) && isset($p['id']) && $p['id'] === $id);
      }));
      $quitados = $antes - count($state['prizes']);
      return $state;
    });
    lkOut(array('ok' => true, 'quitados' => $quitados));
  }

  default:
    lkOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
