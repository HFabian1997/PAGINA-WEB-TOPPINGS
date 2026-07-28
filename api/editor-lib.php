<?php
/**
 * Almacenamiento del editor visual (overrides de posición/tamaño/texto/
 * visibilidad por elemento, por página, por tipo de dispositivo). Mismo
 * patrón atómico (leer directo, escribir a temporal + rename(), candado
 * propio) que ya usan codes-lib.php/premio.php/run-leaderboard.php.
 *
 * El HTML/CSS original del sitio NUNCA se modifica — esto solo guarda
 * "encima" qué overrides aplicar por elemento; el frontend los aplica con
 * JS al cargar la página (igual que ya hace `customization`).
 */

if (!function_exists('editorDataFile')) {
  function editorDataFile() { return __DIR__ . '/data/page-editor.json'; }
  function editorLockFile() { return __DIR__ . '/data/page-editor.lock'; }

  define('EDITOR_MAX_HISTORY_PER_KEY', 20);

  function editorDefaultState() {
    return array('pages' => array(), 'history' => array());
  }

  function editorNormalizeState($state) {
    $default = editorDefaultState();
    if (!is_array($state)) return $default;
    if (!isset($state['pages']) || !is_array($state['pages'])) $state['pages'] = array();
    if (!isset($state['history']) || !is_array($state['history'])) $state['history'] = array();
    return $state;
  }

  function editorReadState() {
    $file = editorDataFile();
    if (!file_exists($file)) return editorDefaultState();
    $raw = @file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    return editorNormalizeState($data);
  }

  function editorWriteStateAtomic($state) {
    $file = editorDataFile();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
  }

  function editorWithWriteLock($callback) {
    $lockFile = editorLockFile();
    $dir = dirname($lockFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $lockFp = @fopen($lockFile, 'c');
    if (!$lockFp) return null;
    flock($lockFp, LOCK_EX);
    $state = editorReadState();
    $result = $callback($state);
    if (is_array($result)) editorWriteStateAtomic($result);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return is_array($result) ? $result : $state;
  }

  function editorNowMs() { return (int) round(microtime(true) * 1000); }

  function editorValidBreakpoint($bp) {
    return in_array($bp, array('mobile', 'tablet', 'desktop'), true);
  }

  /** "index"/"comidas"/etc — nunca una ruta arbitraria, para no poder escribir fuera del esquema esperado. */
  function editorValidPageSlug($slug) {
    return is_string($slug) && preg_match('/^[a-z0-9_-]{1,40}$/', $slug) === 1;
  }

  function editorGetPageBreakpoint($state, $page, $breakpoint) {
    if (isset($state['pages'][$page][$breakpoint]['elements']) && is_array($state['pages'][$page][$breakpoint]['elements'])) {
      return $state['pages'][$page][$breakpoint]['elements'];
    }
    return array();
  }
}
