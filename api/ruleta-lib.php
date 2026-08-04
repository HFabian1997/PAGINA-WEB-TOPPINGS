<?php
require_once __DIR__ . '/data-path.php';
/**
 * Funciones compartidas de la Ruleta TOPPINGS, usadas tanto por ruleta.php
 * como por premio.php y run-leaderboard.php (estos últimos las incluyen
 * para otorgar tiros justo después de un reclamo exitoso, cuando el admin
 * configuró esa dinámica como "Giro en la Ruleta" en vez de premio directo).
 *
 * Mismo patrón de archivo JSON con escritura atómica + candado que ya usan
 * premio.php/run-leaderboard.php — así todas las escrituras a ruleta.json
 * quedan serializadas sin importar desde qué script vengan.
 */

if (!function_exists('ruletaDataFile')) {
  function ruletaDataFile() { return toppingsDataFile('ruleta.json'); }
  function ruletaLockFile() { return toppingsDataFile('ruleta.lock'); }

  function ruletaDefaultState() {
    return array(
      'active' => true,
      'title' => 'RULETA TOPPINGS',
      'whatsappNumber' => '',
      'soundEnabled' => true,
      'confettiEnabled' => true,
      'prizeExpiryHours' => 24, // un solo tiempo para cualquier premio ganado en la ruleta, ya no uno por premio
      'prizes' => array(),
      'tickets' => array(),
    );
  }

  function ruletaNormalizeState($state) {
    $default = ruletaDefaultState();
    if (!is_array($state)) return $default;
    foreach ($default as $key => $val) {
      if (!isset($state[$key])) $state[$key] = $val;
    }
    if (!is_array($state['prizes'])) $state['prizes'] = array();
    if (!is_array($state['tickets'])) $state['tickets'] = array();
    return $state;
  }

  function ruletaReadState() {
    $file = ruletaDataFile();
    if (!file_exists($file)) return ruletaDefaultState();
    $raw = @file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    return ruletaNormalizeState($data);
  }

  function ruletaWriteStateAtomic($state) {
    $file = ruletaDataFile();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
  }

  function ruletaWithWriteLock($callback) {
    $lockFile = ruletaLockFile();
    $dir = dirname($lockFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $lockFp = @fopen($lockFile, 'c');
    if (!$lockFp) return null;
    flock($lockFp, LOCK_EX);
    $state = ruletaReadState();
    $result = $callback($state);
    if (is_array($result)) ruletaWriteStateAtomic($result);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return is_array($result) ? $result : $state;
  }

  function ruletaNowMs() { return (int) round(microtime(true) * 1000); }

  /**
   * Marca vencidos los tiros disponibles cuyo plazo ya pasó — misma idea
   * perezosa que ensureFreshDay/ensureRankingState: se evalúa en cada
   * lectura, sin depender de un cron que este hosting no tiene.
   */
  function ruletaExpireTickets(&$state) {
    $now = ruletaNowMs();
    foreach ($state['tickets'] as &$t) {
      if ($t['status'] === 'available' && isset($t['expiresAt']) && $t['expiresAt'] !== null && $now >= $t['expiresAt']) {
        $t['status'] = 'expired';
      }
    }
    unset($t);
  }

  /**
   * Otorga $count tiros nuevos a un dispositivo — llamada desde
   * premio.php/run-leaderboard.php justo después de un reclamo exitoso
   * cuya dinámica esté configurada como recompensa "Giro en la Ruleta".
   */
  function grantRuletaTickets($deviceId, $name, $source, $count, $expiryHours) {
    $deviceId = trim((string) $deviceId);
    $name = trim((string) $name);
    $count = max(1, (int) $count);
    $expiryHours = $expiryHours > 0 ? (float) $expiryHours : 24;
    if ($deviceId === '') return array();

    $issued = array();
    ruletaWithWriteLock(function ($state) use ($deviceId, $name, $source, $count, $expiryHours, &$issued) {
      ruletaExpireTickets($state);
      $now = ruletaNowMs();
      for ($i = 0; $i < $count; $i++) {
        $ticket = array(
          'id' => uniqid('tkt_', true),
          'deviceId' => $deviceId,
          'name' => $name,
          'source' => $source,
          'grantedAt' => $now,
          'expiresAt' => $now + (int) round($expiryHours * 3600000),
          'status' => 'available',
          'result' => null,
        );
        $state['tickets'][] = $ticket;
        $issued[] = $ticket['id'];
      }
      return $state;
    });
    return $issued;
  }
}
