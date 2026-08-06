<?php
require_once __DIR__ . '/data-path.php';
/**
 * Libro compartido de códigos de premio, usado por TODAS las dinámicas
 * (cronómetro, fidelidad, reto, Toppings Run y Ruleta) para que el cliente
 * tenga un solo flujo de "Reclamar premio" -> "Entregar premio" sin importar
 * de dónde vino el premio.
 *
 * Mismo patrón de archivo JSON con escritura atómica + candado que ya usan
 * premio.php/run-leaderboard.php/ruleta-lib.php — todas las escrituras a
 * prize-codes.json quedan serializadas sin importar desde qué script vengan.
 */

if (!function_exists('codesDataFile')) {
  function codesDataFile() { return toppingsDataFile('prize-codes.json'); }
  function codesLockFile() { return toppingsDataFile('prize-codes.lock'); }

  function codesDefaultState() {
    return array('codes' => array());
  }

  function codesNormalizeState($state) {
    $default = codesDefaultState();
    if (!is_array($state)) return $default;
    foreach ($default as $key => $val) {
      if (!isset($state[$key])) $state[$key] = $val;
    }
    if (!is_array($state['codes'])) $state['codes'] = array();
    return $state;
  }

  function codesReadState() {
    $file = codesDataFile();
    if (!file_exists($file)) return codesDefaultState();
    $raw = @file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    return codesNormalizeState($data);
  }

  function codesWriteStateAtomic($state) {
    $file = codesDataFile();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
  }

  function codesWithWriteLock($callback) {
    $lockFile = codesLockFile();
    $dir = dirname($lockFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $lockFp = @fopen($lockFile, 'c');
    if (!$lockFp) return null;
    flock($lockFp, LOCK_EX);
    $state = codesReadState();
    $result = $callback($state);
    if (is_array($result)) codesWriteStateAtomic($result);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return is_array($result) ? $result : $state;
  }

  function codesNowMs() { return (int) round(microtime(true) * 1000); }

  /**
   * Vence perezosamente los códigos "available"/"waiting" cuyo plazo ya
   * pasó sin llegar a "delivered" — misma idea que ruletaExpireTickets:
   * se evalúa en cada lectura, sin depender de un cron que este hosting
   * no tiene.
   */
  function expireCodes(&$state) {
    $now = codesNowMs();
    foreach ($state['codes'] as &$c) {
      if (($c['status'] === 'available' || $c['status'] === 'waiting') && isset($c['expiresAt']) && $now >= $c['expiresAt']) {
        $c['status'] = 'expired';
      }
    }
    unset($c);
  }

  function findCodeIndex($codes, $code) {
    $code = trim((string) $code);
    if ($code === '') return null;
    foreach ($codes as $i => $c) {
      if (strcasecmp((string) $c['code'], $code) === 0) return $i;
    }
    return null;
  }

  function genPrizeCode() {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (O/0, I/1)
    $code = '';
    for ($i = 0; $i < 6; $i++) $code .= $chars[random_int(0, strlen($chars) - 1)];
    return 'TOP-' . $code;
  }

  /**
   * Genera y guarda un código de premio nuevo — llamada desde
   * premio.php/run-leaderboard.php (dinámicas configuradas como premio
   * directo) y desde ruleta.php (al girar y ganar un premio reclamable).
   * Devuelve el registro completo del código recién creado.
   */
  function issuePrizeCode($deviceId, $name, $source, $prizeName, $prizeIcon, $expiryHours, $yaAvisado = true) {
    $deviceId = trim((string) $deviceId);
    $name = trim((string) $name);
    $expiryHours = $expiryHours > 0 ? (float) $expiryHours : 24;
    $yaAvisado = (bool) $yaAvisado;
    $issuedRecord = null;

    codesWithWriteLock(function ($state) use ($deviceId, $name, $source, $prizeName, $prizeIcon, $expiryHours, $yaAvisado, &$issuedRecord) {
      expireCodes($state);
      $now = codesNowMs();
      $code = null;
      // Reintenta si por pura casualidad genera un código que ya existe
      // (colisión extremadamente improbable con 6 caracteres, pero se
      // verifica de todas formas antes de guardar).
      for ($attempt = 0; $attempt < 5; $attempt++) {
        $candidate = genPrizeCode();
        if (findCodeIndex($state['codes'], $candidate) === null) { $code = $candidate; break; }
      }
      if ($code === null) $code = genPrizeCode() . '-' . substr((string) $now, -3);

      $record = array(
        'id' => uniqid('cod_', true),
        'code' => $code,
        'deviceId' => $deviceId,
        'name' => $name,
        'source' => $source,
        'prizeName' => $prizeName,
        'prizeIcon' => $prizeIcon,
        'issuedAt' => $now,
        'expiresAt' => $now + (int) round($expiryHours * 3600000),
        'status' => 'available',
        'requestedAt' => null,
        'deliveredAt' => null,
        'deliveredBy' => null,
        /* Los premios que la persona reclamó a mano nacen avisados: acaba de
           ver la pantalla de "¡Felicidades!". Los que se entregan solos nacen
           SIN avisar, y por eso al volver a entrar le sale la tarjeta.
           Los registros viejos no traen este campo y se tratan como avisados,
           para no soltarle de golpe un aviso por cada premio del pasado. */
        'notified' => $yaAvisado,
      );
      $state['codes'][] = $record;
      $issuedRecord = $record;
      return $state;
    });
    return $issuedRecord;
  }
}
