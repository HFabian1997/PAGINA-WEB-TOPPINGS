<?php
/**
 * Editor visual — guarda/lee los overrides de posición, tamaño, texto y
 * visibilidad que el modo edición aplica sobre la página en vivo.
 *
 * Reutiliza la MISMA sesión que api/content.php (mismo session_name,
 * mismo $_SESSION['authed']) — iniciar sesión en el panel de administrador
 * ya autoriza el editor visual, sin sistema de login aparte y sin guardar
 * la contraseña en JS/navegador.
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
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/editor-lib.php';

function editorJsonOut($arr, $code = 200) {
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

function editorRequireAuth() {
  if (empty($_SESSION['authed'])) editorJsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

/**
 * `elements` es un mapa selector -> override, nunca una lista. Un array PHP
 * vacío se codifica como `[]` en JSON (no `{}`), y el cliente lo asignaba
 * directamente a su variable `overrides` — como sigue siendo "un objeto" en
 * JS, las asignaciones por clave funcionaban, pero JSON.stringify() de un
 * array ignora las claves no numéricas, así que cada "Guardar" mandaba un
 * `elements` vacío sin avisar. Forzar `{}` explícito cuando está vacío evita
 * que el cliente reciba ese array ambiguo.
 */
function editorElementsForOutput($elements) {
  return empty($elements) ? new stdClass() : $elements;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {

  /** Público — necesario para aplicar los overrides guardados sobre la página normal, sin sesión. */
  case 'get': {
    $page = isset($_GET['page']) ? $_GET['page'] : '';
    $breakpoint = isset($_GET['breakpoint']) ? $_GET['breakpoint'] : '';
    if (!editorValidPageSlug($page) || !editorValidBreakpoint($breakpoint)) {
      editorJsonOut(array('ok' => false, 'error' => 'Parámetros inválidos.'), 400);
    }
    $state = editorReadState();
    $elements = editorGetPageBreakpoint($state, $page, $breakpoint);
    editorJsonOut(array('ok' => true, 'page' => $page, 'breakpoint' => $breakpoint, 'elements' => editorElementsForOutput($elements)));
  }

  case 'save': {
    editorRequireAuth();
    if ($method !== 'POST') editorJsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $page = isset($body['page']) ? $body['page'] : '';
    $breakpoint = isset($body['breakpoint']) ? $body['breakpoint'] : '';
    $elements = isset($body['elements']) && is_array($body['elements']) ? $body['elements'] : array();
    if (!editorValidPageSlug($page) || !editorValidBreakpoint($breakpoint)) {
      editorJsonOut(array('ok' => false, 'error' => 'Parámetros inválidos.'), 400);
    }

    $saved = null;
    editorWithWriteLock(function ($state) use ($page, $breakpoint, $elements, &$saved) {
      $previous = editorGetPageBreakpoint($state, $page, $breakpoint);

      // Copia de seguridad automática: guarda el estado ANTERIOR en el
      // historial antes de sobrescribir, capado a las últimas N versiones
      // por página+dispositivo — así "Guardar" nunca pierde la versión previa.
      if (!empty($previous)) {
        $historyKey = $page . ':' . $breakpoint;
        $entry = array(
          'id' => uniqid('ver_', true),
          'page' => $page,
          'breakpoint' => $breakpoint,
          'savedAt' => date('c'),
          'elements' => $previous,
        );
        array_unshift($state['history'], $entry);
        $sameKeyCount = 0;
        $filtered = array();
        foreach ($state['history'] as $h) {
          if (($h['page'] . ':' . $h['breakpoint']) === $historyKey) {
            $sameKeyCount++;
            if ($sameKeyCount > EDITOR_MAX_HISTORY_PER_KEY) continue;
          }
          $filtered[] = $h;
        }
        $state['history'] = $filtered;
      }

      if (!isset($state['pages'][$page]) || !is_array($state['pages'][$page])) $state['pages'][$page] = array();
      $state['pages'][$page][$breakpoint] = array('elements' => $elements);
      $saved = $elements;
      return $state;
    });

    editorJsonOut(array('ok' => true, 'elements' => editorElementsForOutput($saved)));
  }

  case 'restore': {
    editorRequireAuth();
    if ($method !== 'POST') editorJsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $versionId = isset($body['versionId']) ? trim((string) $body['versionId']) : '';
    if ($versionId === '') editorJsonOut(array('ok' => false, 'error' => 'Falta el id de la versión.'), 400);

    $restored = null;
    editorWithWriteLock(function ($state) use ($versionId, &$restored) {
      foreach ($state['history'] as $h) {
        if ($h['id'] === $versionId) {
          if (!isset($state['pages'][$h['page']]) || !is_array($state['pages'][$h['page']])) $state['pages'][$h['page']] = array();
          $state['pages'][$h['page']][$h['breakpoint']] = array('elements' => $h['elements']);
          $restored = $h;
          break;
        }
      }
      return $state;
    });

    if (!$restored) editorJsonOut(array('ok' => false, 'error' => 'Versión no encontrada.'), 404);
    editorJsonOut(array('ok' => true, 'page' => $restored['page'], 'breakpoint' => $restored['breakpoint'], 'elements' => editorElementsForOutput($restored['elements'])));
  }

  /** Historial de versiones de una página+dispositivo (para el panel de "Historial de versiones" de una etapa siguiente). */
  case 'history': {
    editorRequireAuth();
    $page = isset($_GET['page']) ? $_GET['page'] : '';
    $breakpoint = isset($_GET['breakpoint']) ? $_GET['breakpoint'] : '';
    $state = editorReadState();
    $results = array();
    foreach ($state['history'] as $h) {
      if ($page !== '' && $h['page'] !== $page) continue;
      if ($breakpoint !== '' && $h['breakpoint'] !== $breakpoint) continue;
      $results[] = array('id' => $h['id'], 'page' => $h['page'], 'breakpoint' => $h['breakpoint'], 'savedAt' => $h['savedAt']);
    }
    editorJsonOut(array('ok' => true, 'history' => $results));
  }

  case 'reset': {
    editorRequireAuth();
    if ($method !== 'POST') editorJsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $page = isset($body['page']) ? $body['page'] : '';
    $breakpoint = isset($body['breakpoint']) ? $body['breakpoint'] : '';
    if (!editorValidPageSlug($page) || !editorValidBreakpoint($breakpoint)) {
      editorJsonOut(array('ok' => false, 'error' => 'Parámetros inválidos.'), 400);
    }

    editorWithWriteLock(function ($state) use ($page, $breakpoint) {
      if (isset($state['pages'][$page][$breakpoint])) unset($state['pages'][$page][$breakpoint]);
      return $state;
    });

    editorJsonOut(array('ok' => true));
  }

  default:
    editorJsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}
