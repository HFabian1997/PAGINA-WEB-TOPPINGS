<?php
require_once __DIR__ . '/data-path.php';
/**
 * Códigos de premio canjeables ("cupones") — la palabra o frase que el admin
 * reparte y el cliente escribe en el panel 🎁 para desbloquear un premio.
 *
 * OJO con la diferencia frente a prize-codes.json (codes-lib.php): ese es el
 * libro de premios YA ENTREGADOS a un dispositivo (uno por premio, con su
 * estado available/waiting/delivered). Este archivo guarda otra cosa: la lista
 * de cupones reutilizables que el admin definió, más el registro de quién usó
 * cada uno. Mezclarlos rompería expireCodes() y las estadísticas del panel.
 *
 * Tampoco va en content.json: los canjes los escribe el cliente en cualquier
 * momento, y content.json se sobrescribe COMPLETO cada vez que el admin
 * guarda — se perderían. Mismo motivo por el que la ruleta tiene su propio
 * archivo.
 *
 * Mismo patrón de archivo JSON con escritura atómica + candado que ya usan
 * premio.php / ruleta-lib.php / codes-lib.php.
 */

if (!function_exists('redeemDataFile')) {
  function redeemDataFile() { return toppingsDataFile('redeem-codes.json'); }
  function redeemLockFile() { return toppingsDataFile('redeem-codes.lock'); }

  function redeemDefaultState() {
    return array('codes' => array(), 'redemptions' => array());
  }

  function redeemNormalizeState($state) {
    $default = redeemDefaultState();
    if (!is_array($state)) return $default;
    foreach ($default as $key => $val) {
      if (!isset($state[$key])) $state[$key] = $val;
    }
    if (!is_array($state['codes'])) $state['codes'] = array();
    if (!is_array($state['redemptions'])) $state['redemptions'] = array();
    return $state;
  }

  function redeemReadState() {
    $file = redeemDataFile();
    if (!file_exists($file)) return redeemDefaultState();
    $raw = @file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    return redeemNormalizeState($data);
  }

  function redeemWriteStateAtomic($state) {
    $file = redeemDataFile();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
  }

  function redeemWithWriteLock($callback) {
    $lockFile = redeemLockFile();
    $dir = dirname($lockFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $lockFp = @fopen($lockFile, 'c');
    if (!$lockFp) return null;
    flock($lockFp, LOCK_EX);
    $state = redeemReadState();
    $result = $callback($state);
    if (is_array($result)) redeemWriteStateAtomic($result);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return is_array($result) ? $result : $state;
  }

  function redeemNowMs() { return (int) round(microtime(true) * 1000); }

  /**
   * Busca el cupón por su palabra, SIN distinguir mayúsculas — igual que
   * findCodeIndex() en codes-lib.php. Así "amigo", "Amigo" y "AMIGO" son el
   * mismo cupón: el cliente lo escribe como quiera.
   */
  function redeemFindCodeIndex($codes, $code) {
    $code = trim((string) $code);
    if ($code === '') return null;
    foreach ($codes as $i => $c) {
      if (isset($c['code']) && strcasecmp((string) $c['code'], $code) === 0) return $i;
    }
    return null;
  }

  /**
   * Cuántas veces se usó un cupón en total, y cuántas esta persona.
   *
   * `$desdeMs` es la ventana para reutilizar: si el cupón se puede volver a
   * usar cada tantas horas, solo cuentan los canjes de esta persona dentro de
   * ese plazo. Los de antes ya no estorban, y por eso el mismo código le sirve
   * de nuevo. Con 0 se cuentan todos, que es como funcionó siempre.
   *
   * `total` NO se filtra nunca: el tope total del cupón es de por vida.
   *
   * Devuelve además `mias`, las horas exactas de esos canjes ordenadas de más
   * viejo a más nuevo, para poder decirle a la persona cuándo se le libera.
   */
  function redeemCountUses($state, $codeId, $deviceId, $desdeMs = 0) {
    $total = 0;
    $mias = array();
    foreach ($state['redemptions'] as $r) {
      if (!isset($r['codeId']) || $r['codeId'] !== $codeId) continue;
      $total++;
      if ($deviceId === '' || !isset($r['deviceId']) || $r['deviceId'] !== $deviceId) continue;
      $cuando = isset($r['redeemedAt']) ? (int) $r['redeemedAt'] : 0;
      if ($desdeMs > 0 && $cuando < $desdeMs) continue;   // fuera de la ventana
      $mias[] = $cuando;
    }
    sort($mias);
    return array('total' => $total, 'mine' => count($mias), 'mias' => $mias);
  }

  /** Cada cuántos milisegundos se le libera el cupón a la misma persona. */
  function redeemCooldownMs($c) {
    $h = isset($c['cooldownHours']) ? (float) $c['cooldownHours'] : 0;
    return $h > 0 ? (int) round($h * 3600 * 1000) : 0;
  }

  /** Normaliza un cupón que llega del panel, con valores por defecto seguros. */
  function redeemNormalizeCode($c) {
    if (!is_array($c)) return null;
    $code = isset($c['code']) ? trim((string) $c['code']) : '';
    if ($code === '') return null;
    $type = isset($c['rewardType']) && $c['rewardType'] === 'wheelSpins' ? 'wheelSpins' : 'prize';
    return array(
      'id' => isset($c['id']) && $c['id'] !== '' ? (string) $c['id'] : uniqid('rdm_', true),
      'code' => $code,
      'internalName' => isset($c['internalName']) ? (string) $c['internalName'] : '',
      'description' => isset($c['description']) ? (string) $c['description'] : '',
      'rewardType' => $type,
      'prizeName' => isset($c['prizeName']) ? (string) $c['prizeName'] : '',
      'prizeIcon' => isset($c['prizeIcon']) && $c['prizeIcon'] !== '' ? (string) $c['prizeIcon'] : '🎁',
      'prizeExpiryHours' => isset($c['prizeExpiryHours']) && $c['prizeExpiryHours'] > 0 ? (float) $c['prizeExpiryHours'] : 24,
      'wheelSpinCount' => isset($c['wheelSpinCount']) && $c['wheelSpinCount'] > 0 ? (int) $c['wheelSpinCount'] : 1,
      'wheelTicketExpiryHours' => isset($c['wheelTicketExpiryHours']) && $c['wheelTicketExpiryHours'] > 0 ? (float) $c['wheelTicketExpiryHours'] : 24,
      // -1 = sin tope
      'maxUses' => isset($c['maxUses']) ? (int) $c['maxUses'] : -1,
      'usesPerPerson' => isset($c['usesPerPerson']) && (int) $c['usesPerPerson'] > 0 ? (int) $c['usesPerPerson'] : 1,
      // 0 = una sola vez y listo. Con más de 0, a la misma persona se le
      // vuelve a habilitar el cupón pasadas esas horas.
      'cooldownHours' => isset($c['cooldownHours']) && (float) $c['cooldownHours'] > 0 ? (float) $c['cooldownHours'] : 0,
      // null = no vence
      'expiresAt' => isset($c['expiresAt']) && $c['expiresAt'] !== null && $c['expiresAt'] !== '' ? (int) $c['expiresAt'] : null,
      'active' => !empty($c['active']),
      'createdAt' => isset($c['createdAt']) && $c['createdAt'] ? (int) $c['createdAt'] : redeemNowMs(),
    );
  }
}
