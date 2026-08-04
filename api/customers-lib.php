<?php
require_once __DIR__ . '/data-path.php';
/**
 * Registro de clientes: quién dio su nombre, y cuándo.
 *
 * Vivía dentro de run-leaderboard.json (clave `names`) y tiene archivo propio
 * desde que se perdió una vez. Lo que de verdad lo protege es dónde vive: ver
 * data-path.php — los datos están fuera de public_html porque el despliegue
 * reemplaza esa carpeta entera y borra todo lo que no venga en el paquete.
 *
 * Mismo patrón de escritura atómica + candado que el resto del proyecto.
 */

if (!function_exists('customersDataFile')) {
  function customersDataFile() { return toppingsDataFile('customers.json'); }
  function customersLockFile() { return toppingsDataFile('customers.lock'); }

  function customersDefaultState() { return array('customers' => array()); }

  function customersNormalize($state) {
    if (!is_array($state) || !isset($state['customers']) || !is_array($state['customers'])) {
      return customersDefaultState();
    }
    return $state;
  }

  /**
   * Si el archivo todavía no existe, se siembra con lo que haya en `names` de
   * run-leaderboard.json — así no se pierde nada de lo que quede ahí de antes.
   */
  function customersSeedFromLeaderboard() {
    $file = toppingsDataFile('run-leaderboard.json');
    if (!file_exists($file)) return array();
    $raw = @file_get_contents($file);
    $d = $raw ? json_decode($raw, true) : null;
    if (!is_array($d) || !isset($d['names']) || !is_array($d['names'])) return array();

    $out = array();
    foreach ($d['names'] as $deviceId => $info) {
      if (!is_array($info) || !isset($info['name'])) continue;
      $nombre = trim((string) $info['name']);
      if ($nombre === '') continue;
      $out[$deviceId] = array(
        'name' => $nombre,
        'updatedAt' => isset($info['updatedAt']) ? (int) $info['updatedAt'] : 0,
      );
    }
    return $out;
  }

  function customersRead() {
    $file = customersDataFile();
    if (!file_exists($file)) {
      return array('customers' => customersSeedFromLeaderboard());
    }
    $raw = @file_get_contents($file);
    $d = $raw ? json_decode($raw, true) : null;
    return customersNormalize($d);
  }

  function customersWriteAtomic($state) {
    $file = customersDataFile();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
  }

  function customersWithWriteLock($callback) {
    $lockFile = customersLockFile();
    $dir = dirname($lockFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen($lockFile, 'c');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $state = customersRead();
    $res = $callback($state);
    if (is_array($res)) customersWriteAtomic($res);
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($res) ? $res : $state;
  }

  /**
   * Deja registrado el nombre de este dispositivo. Se llama desde CUALQUIER
   * acción que reciba un nombre (reclamar, jugar, girar, canjear), no solo
   * desde el saludo: así quien ya tenía su nombre guardado en el celular vuelve
   * al registro apenas haga algo, sin que se le vuelva a preguntar.
   *
   * No escribe si el nombre no cambió, para no tocar el archivo de gusto.
   */
  function rememberCustomer($deviceId, $name) {
    $deviceId = trim((string) $deviceId);
    $name = trim((string) $name);
    if ($deviceId === '' || $name === '') return false;

    $MAX = 5000;   // tope de seguridad; se quedan los más recientes
    $guardado = false;

    customersWithWriteLock(function ($state) use ($deviceId, $name, $MAX, &$guardado) {
      $actual = isset($state['customers'][$deviceId]['name']) ? $state['customers'][$deviceId]['name'] : null;
      if ($actual === $name) return null;   // nada que cambiar

      $ahora = (int) round(microtime(true) * 1000);
      $antes = isset($state['customers'][$deviceId]) && is_array($state['customers'][$deviceId])
        ? $state['customers'][$deviceId] : array();
      $state['customers'][$deviceId] = array(
        'name' => $name,
        'updatedAt' => $ahora,
        // si está haciendo algo, está visitando: sirve para el filtro de
        // hoy/semana/mes de la lista de clientes
        'lastSeenAt' => $ahora,
        // no se pierde nada más que hubiera guardado antes
      ) + $antes;
      if (count($state['customers']) > $MAX) {
        uasort($state['customers'], function ($a, $b) { return (int) $b['updatedAt'] - (int) $a['updatedAt']; });
        $state['customers'] = array_slice($state['customers'], 0, $MAX, true);
      }
      $guardado = true;
      return $state;
    });
    return $guardado;
  }

  /**
   * Anota que este cliente pasó por la página.
   *
   * Hacía falta porque presence.json solo sirve para "cuántos hay conectados
   * AHORA": borra todo lo que tenga más de 5 minutos, y la lista por día se
   * reinicia al cambiar el día. Con eso no se puede saber quién vino esta
   * semana o este mes. Acá queda guardado de verdad, junto al cliente.
   *
   * Dos cuidados:
   * - Solo se anota a quien YA está en el registro (o sea, quien dio su
   *   nombre). Si no, el archivo se llenaría de visitantes anónimos.
   * - El latido llega cada minuto; escribir cada vez sería absurdo. Se lee
   *   sin candado y solo se toma el candado si de verdad hay que escribir.
   */
  function customersTouch($deviceId) {
    $deviceId = trim((string) $deviceId);
    if ($deviceId === '') return false;

    $MIN_ENTRE_ESCRITURAS = 10 * 60 * 1000;   // 10 minutos
    $ahora = (int) round(microtime(true) * 1000);

    $state = customersRead();
    if (!isset($state['customers'][$deviceId])) return false;   // todavía no dio su nombre
    $ultimo = isset($state['customers'][$deviceId]['lastSeenAt'])
      ? (int) $state['customers'][$deviceId]['lastSeenAt'] : 0;
    if ($ahora - $ultimo < $MIN_ENTRE_ESCRITURAS) return false;

    customersWithWriteLock(function ($st) use ($deviceId, $ahora, $MIN_ENTRE_ESCRITURAS) {
      if (!isset($st['customers'][$deviceId])) return null;
      // se vuelve a comprobar dentro del candado, por si otro proceso ya lo hizo
      $u = isset($st['customers'][$deviceId]['lastSeenAt']) ? (int) $st['customers'][$deviceId]['lastSeenAt'] : 0;
      if ($ahora - $u < $MIN_ENTRE_ESCRITURAS) return null;
      $st['customers'][$deviceId]['lastSeenAt'] = $ahora;
      return $st;
    });
    return true;
  }

  /** ¿Otro dispositivo ya usa este nombre? (para el aviso de nombre repetido) */
  function customerNameTaken($name, $deviceId) {
    $name = trim((string) $name);
    if ($name === '') return false;
    $needle = function_exists('mb_strtolower') ? mb_strtolower($name) : strtolower($name);
    $state = customersRead();
    foreach ($state['customers'] as $ownerId => $info) {
      if ((string) $ownerId === (string) $deviceId) continue;
      if (!is_array($info) || !isset($info['name'])) continue;
      $owner = function_exists('mb_strtolower') ? mb_strtolower((string) $info['name']) : strtolower((string) $info['name']);
      if ($owner === $needle) return true;
    }
    return false;
  }
}
