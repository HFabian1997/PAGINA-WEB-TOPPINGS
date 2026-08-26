<?php
/**
 * 🗳️ Votaciones — endpoints del cliente y del panel.
 *
 * La regla de oro, igual que en el resto del sitio: comprobar y escribir
 * DENTRO del mismo candado. El navegador manda a quién vota; el servidor
 * decide si ese voto vale.
 *
 * Los resultados que no son públicos no se filtran acá por descuido: los
 * quita votesPublicPoll() antes de armar la respuesta, así que ni siquiera
 * salen del servidor.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/votes-lib.php';
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

function vtOut($arr, $code = 200) {
  http_response_code($code);
  echo json_encode($arr, JSON_UNESCAPED_UNICODE);
  exit;
}

function vtRequireAdmin() {
  if (empty($_SESSION['authed'])) vtOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

function vtBody() {
  $raw = file_get_contents('php://input');
  $b = $raw ? json_decode($raw, true) : null;
  return is_array($b) ? $b : array();
}

function vtDevice($b) {
  $d = isset($b['deviceId']) ? trim((string) $b['deviceId']) : '';
  if ($d === '' && isset($_GET['deviceId'])) $d = trim((string) $_GET['deviceId']);
  return function_exists('mb_substr') ? mb_substr($d, 0, 64) : substr($d, 0, 64);
}

function vtName($b) {
  $n = isset($b['name']) ? strip_tags(trim((string) $b['name'])) : '';
  return function_exists('mb_substr') ? mb_substr($n, 0, 60) : substr($n, 0, 60);
}

function vtPagina() {
  $p = isset($_GET['page']) ? (string) $_GET['page'] : 'inicio';
  return in_array($p, votesPaginas(), true) ? $p : 'inicio';
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';

/* ---------------- cliente ---------------- */

/** Las votaciones que le tocan a esta página. Si no hay ninguna, devuelve la
 *  lista vacía y el cliente no pinta nada — sin huecos. */
if ($method === 'GET' && $action === 'status') {
  $deviceId = vtDevice(array());
  $state = votesRead();
  vtOut(array(
    'ok' => true,
    'page' => vtPagina(),
    'polls' => votesParaPagina($state, vtPagina(), $deviceId),
    'serverNow' => votesNowMs(),
  ));
}

if ($method === 'POST') {
  $body = vtBody();
  $deviceId = vtDevice($body);
  $name = vtName($body);

  if ($action === 'vote') {
    if ($deviceId === '') {
      vtOut(array('ok' => false, 'reason' => 'no-device', 'error' => 'No pudimos identificar tu dispositivo.'), 400);
    }
    $pollId = isset($body['pollId']) ? (string) $body['pollId'] : '';
    $optionId = isset($body['optionId']) ? (string) $body['optionId'] : '';
    if ($name !== '') rememberCustomer($deviceId, $name);

    $res = array('ok' => false, 'reason' => 'error');
    votesWithWriteLock(function ($state) use ($pollId, $optionId, $deviceId, $name, &$res) {
      $res = votesVotar($state, $pollId, $optionId, $deviceId, $name);
      return !empty($res['ok']) ? $state : null;
    });

    // se devuelve la votación completa y al día, para que el bloque se
    // repinte con el resultado sin pedir nada más
    $state = votesRead();
    $poll = votesFindPoll($state, $pollId);
    if ($poll) $res['poll'] = votesPublicPoll($state, $poll, $deviceId);

    if (empty($res['ok'])) {
      $textos = array(
        'closed'        => 'Esta votación ya está cerrada.',
        'already'       => 'Ya votaste en esta votación.',
        'already-today' => 'Ya votaste hoy. Vuelve mañana.',
        'not-found'     => 'Esa votación ya no existe.',
        'bad-option'    => 'Esa opción ya no está disponible.',
      );
      $r = isset($res['reason']) ? $res['reason'] : 'error';
      $res['error'] = isset($textos[$r]) ? $textos[$r] : 'No se pudo registrar tu voto.';
    }
    vtOut($res);
  }

  /* ---------------- panel ---------------- */

  if ($action === 'admin-list') {
    vtRequireAdmin();
    $state = votesRead();
    $out = array();
    foreach ($state['polls'] as $poll) $out[] = votesAdminPoll($state, $poll);
    vtOut(array('ok' => true, 'polls' => $out, 'pages' => votesPaginas(), 'serverNow' => votesNowMs()));
  }

  /**
   * Crear o modificar. Guarda la votación entera tal como la dejó el panel.
   * Los VOTOS no se tocan acá: cambiarle el título a una votación en curso no
   * puede borrar lo que la gente ya votó.
   */
  if ($action === 'admin-save') {
    vtRequireAdmin();
    $poll = isset($body['poll']) && is_array($body['poll']) ? $body['poll'] : null;
    if (!$poll) vtOut(array('ok' => false, 'error' => 'Falta la votación.'), 400);
    if (!isset($poll['id']) || $poll['id'] === '') {
      $poll['id'] = 'vot_' . bin2hex(random_bytes(5));
      $poll['createdAt'] = votesNowMs();
    }

    $guardada = null;
    votesWithWriteLock(function ($state) use ($poll, &$guardada) {
      $nueva = votesNormalizePoll($poll);
      if (!$nueva) return null;
      $reemplazada = false;
      foreach ($state['polls'] as $i => $p) {
        if ($p['id'] === $nueva['id']) {
          // se conserva la fecha de creación original
          $nueva['createdAt'] = $p['createdAt'];
          $state['polls'][$i] = $nueva;
          $reemplazada = true;
          break;
        }
      }
      if (!$reemplazada) $state['polls'][] = $nueva;
      $guardada = votesAdminPoll($state, $nueva);
      return $state;
    });

    if (!$guardada) vtOut(array('ok' => false, 'error' => 'No se pudo guardar la votación.'), 400);
    vtOut(array('ok' => true, 'poll' => $guardada));
  }

  /** Borra una votación y sus votos. Las demás quedan intactas. */
  if ($action === 'admin-delete') {
    vtRequireAdmin();
    $pollId = isset($body['pollId']) ? (string) $body['pollId'] : '';
    if ($pollId === '') vtOut(array('ok' => false, 'error' => 'Falta la votación.'), 400);

    $habia = false;
    votesWithWriteLock(function ($state) use ($pollId, &$habia) {
      $quedan = array();
      foreach ($state['polls'] as $p) {
        if ($p['id'] === $pollId) { $habia = true; continue; }
        $quedan[] = $p;
      }
      if (!$habia) return null;
      $state['polls'] = $quedan;
      unset($state['votes'][$pollId]);
      return $state;
    });
    vtOut(array('ok' => $habia, 'error' => $habia ? null : 'Esa votación ya no existe.'));
  }

  /** Borra solo los votos, dejando la votación lista para empezar de nuevo. */
  if ($action === 'admin-reset') {
    vtRequireAdmin();
    $pollId = isset($body['pollId']) ? (string) $body['pollId'] : '';
    if ($pollId === '') vtOut(array('ok' => false, 'error' => 'Falta la votación.'), 400);

    $res = array('ok' => false);
    votesWithWriteLock(function ($state) use ($pollId, &$res) {
      if (!votesFindPoll($state, $pollId)) return null;
      unset($state['votes'][$pollId]);
      $res = array('ok' => true);
      return $state;
    });
    if (empty($res['ok'])) vtOut(array('ok' => false, 'error' => 'Esa votación ya no existe.'), 400);

    $state = votesRead();
    $poll = votesFindPoll($state, $pollId);
    vtOut(array('ok' => true, 'poll' => $poll ? votesAdminPoll($state, $poll) : null));
  }

  /** El detalle de quién votó qué, para revisar un resultado raro. */
  if ($action === 'admin-results') {
    vtRequireAdmin();
    $pollId = isset($body['pollId']) ? (string) $body['pollId'] : '';
    $state = votesRead();
    $poll = votesFindPoll($state, $pollId);
    if (!$poll) vtOut(array('ok' => false, 'error' => 'Esa votación ya no existe.'), 400);

    $nombres = array();
    foreach ($poll['options'] as $o) $nombres[$o['id']] = $o['name'];

    $filas = array();
    $porVotacion = isset($state['votes'][$pollId]) && is_array($state['votes'][$pollId])
      ? $state['votes'][$pollId] : array();
    foreach ($porVotacion as $dev => $persona) {
      if (!is_array($persona) || !isset($persona['entries'])) continue;
      foreach ($persona['entries'] as $e) {
        if (!is_array($e) || !isset($e['optionId'])) continue;
        $filas[] = array(
          'name' => isset($persona['name']) ? $persona['name'] : null,
          'option' => isset($nombres[$e['optionId']]) ? $nombres[$e['optionId']] : '—',
          'at' => isset($e['at']) ? (int) $e['at'] : 0,
        );
      }
    }
    usort($filas, function ($a, $b) { return $b['at'] - $a['at']; });
    vtOut(array('ok' => true, 'poll' => votesAdminPoll($state, $poll), 'log' => array_slice($filas, 0, 300)));
  }
}

vtOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
