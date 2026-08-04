<?php
/**
 * Quién aceptó recibir notificaciones en el celular.
 *
 * Una persona puede tener VARIOS aparatos (el celular, la tablet, el
 * computador del negocio), así que se guarda una lista por deviceId. La clave
 * de cada suscripción es su `endpoint`: es la dirección única que le da el
 * navegador, y sirve para no guardar la misma dos veces cuando recarga la
 * página.
 *
 * Mismo patrón de escritura que el resto: candado + archivo temporal + rename.
 */

if (!function_exists('psRead')) {

  function psDataFile() { return __DIR__ . '/data/push-subs.json'; }
  function psLockFile() { return __DIR__ . '/data/push-subs.lock'; }

  function psRead() {
    $f = psDataFile();
    if (!file_exists($f)) return array('devices' => array());
    $raw = @file_get_contents($f);
    $d = $raw ? json_decode($raw, true) : null;
    if (!is_array($d) || !isset($d['devices']) || !is_array($d['devices'])) return array('devices' => array());
    return $d;
  }

  function psWriteAtomic($state) {
    $f = psDataFile();
    $dir = dirname($f);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $f . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    return true;
  }

  function psWithLock($cb) {
    $lock = psLockFile();
    $dir = dirname($lock);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen($lock, 'c');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $state = psRead();
    $res = $cb($state);
    if (is_array($res)) psWriteAtomic($res);
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($res) ? $res : $state;
  }

  /** Guarda (o actualiza) una suscripción para este aparato. */
  function psGuardar($deviceId, $endpoint, $p256dh, $auth, $agente) {
    $deviceId = trim((string) $deviceId);
    $endpoint = trim((string) $endpoint);
    if ($deviceId === '' || $endpoint === '') return false;

    psWithLock(function ($st) use ($deviceId, $endpoint, $p256dh, $auth, $agente) {
      if (!isset($st['devices'][$deviceId]) || !is_array($st['devices'][$deviceId])) {
        $st['devices'][$deviceId] = array('subs' => array(), 'enabled' => true);
      }
      $d = &$st['devices'][$deviceId];
      if (!isset($d['subs']) || !is_array($d['subs'])) $d['subs'] = array();
      $d['enabled'] = true;   // volver a suscribirse reactiva los avisos

      $ahora = (int) round(microtime(true) * 1000);
      $nueva = array(
        'endpoint' => $endpoint,
        'p256dh' => (string) $p256dh,
        'auth' => (string) $auth,
        'agent' => function_exists('mb_substr')
          ? mb_substr((string) $agente, 0, 160) : substr((string) $agente, 0, 160),
        'createdAt' => $ahora,
        'lastOkAt' => null,
        'fails' => 0,
      );

      // si ya estaba, se actualiza en su lugar (no se duplica)
      $encontrada = false;
      foreach ($d['subs'] as $i => $s) {
        if (isset($s['endpoint']) && $s['endpoint'] === $endpoint) {
          $nueva['createdAt'] = isset($s['createdAt']) ? $s['createdAt'] : $ahora;
          $nueva['lastOkAt'] = isset($s['lastOkAt']) ? $s['lastOkAt'] : null;
          $d['subs'][$i] = $nueva;
          $encontrada = true;
          break;
        }
      }
      if (!$encontrada) $d['subs'][] = $nueva;

      // tope por aparato, por si alguien limpia datos mil veces
      if (count($d['subs']) > 5) $d['subs'] = array_slice($d['subs'], -5);
      $d['subs'] = array_values($d['subs']);
      unset($d);
      return $st;
    });
    return true;
  }

  /** El cliente apagó las notificaciones (o borró una suscripción concreta). */
  function psQuitar($deviceId, $endpoint = '') {
    $deviceId = trim((string) $deviceId);
    if ($deviceId === '') return false;
    psWithLock(function ($st) use ($deviceId, $endpoint) {
      if (!isset($st['devices'][$deviceId])) return null;
      if ($endpoint === '') {
        // apagó del todo: se marca y se vacían las suscripciones
        $st['devices'][$deviceId]['enabled'] = false;
        $st['devices'][$deviceId]['subs'] = array();
        return $st;
      }
      $st['devices'][$deviceId]['subs'] = array_values(array_filter(
        $st['devices'][$deviceId]['subs'],
        function ($s) use ($endpoint) { return !isset($s['endpoint']) || $s['endpoint'] !== $endpoint; }
      ));
      return $st;
    });
    return true;
  }

  /** Las suscripciones vivas de un cliente. Vacío si las apagó. */
  function psDe($deviceId) {
    $st = psRead();
    if (!isset($st['devices'][$deviceId])) return array();
    $d = $st['devices'][$deviceId];
    if (empty($d['enabled'])) return array();
    return isset($d['subs']) && is_array($d['subs']) ? $d['subs'] : array();
  }

  /** ¿Este cliente puede recibir push? (para la columna del panel) */
  function psActivo($deviceId) { return count(psDe($deviceId)) > 0; }

  /** Todos los deviceId que pueden recibir push. */
  function psTodos() {
    $st = psRead();
    $out = array();
    foreach ($st['devices'] as $deviceId => $d) {
      if (empty($d['enabled'])) continue;
      if (!isset($d['subs']) || !count($d['subs'])) continue;
      $out[] = $deviceId;
    }
    return $out;
  }

  /**
   * Anota el resultado de un envío. Las suscripciones que el navegador declara
   * muertas (404/410) se borran solas; nadie tiene que limpiarlas a mano.
   */
  function psAnotarResultado($deviceId, $endpoint, $ok, $muerta) {
    psWithLock(function ($st) use ($deviceId, $endpoint, $ok, $muerta) {
      if (!isset($st['devices'][$deviceId]['subs'])) return null;
      $subs = $st['devices'][$deviceId]['subs'];
      $cambio = false;
      foreach ($subs as $i => $s) {
        if (!isset($s['endpoint']) || $s['endpoint'] !== $endpoint) continue;
        if ($muerta) { unset($subs[$i]); $cambio = true; break; }
        if ($ok) {
          $subs[$i]['lastOkAt'] = (int) round(microtime(true) * 1000);
          $subs[$i]['fails'] = 0;
        } else {
          $subs[$i]['fails'] = (isset($s['fails']) ? (int) $s['fails'] : 0) + 1;
          // tras muchos fallos seguidos tampoco tiene sentido insistir
          if ($subs[$i]['fails'] >= 10) { unset($subs[$i]); }
        }
        $cambio = true;
        break;
      }
      if (!$cambio) return null;
      $st['devices'][$deviceId]['subs'] = array_values($subs);
      return $st;
    });
  }

  /**
   * Manda una notificación a TODOS los aparatos de un cliente.
   * Devuelve cuántas salieron bien.
   */
  function psEnviarA($deviceId, $datos) {
    require_once __DIR__ . '/webpush-lib.php';
    $subs = psDe($deviceId);
    $enviadas = 0;
    foreach ($subs as $s) {
      $r = pushEnviar($s, $datos);
      psAnotarResultado($deviceId, $s['endpoint'], $r['ok'], $r['muerta']);
      if ($r['ok']) $enviadas++;
    }
    return $enviadas;
  }
}
