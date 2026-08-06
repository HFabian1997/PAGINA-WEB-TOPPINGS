<?php
require_once __DIR__ . '/data-path.php';
/**
 * 🔒 Premio Bloqueado — un premio secreto con cuenta regresiva que se lleva la
 * PRIMERA persona que lo reclame.
 *
 * Lo delicado acá es que no puede haber dos ganadores. No hay base de datos
 * donde abrir una transacción, pero sí el mismo mecanismo que ya usa el
 * cronómetro en premio.php: comprobar y escribir DENTRO del mismo candado
 * exclusivo. Dos personas que toquen en el mismo instante entran en fila; la
 * segunda se encuentra el premio ya tomado.
 *
 * Nada se calcula con tareas programadas: el estado se evalúa al leer, igual
 * que expireCodes(). Al abrir el archivo se resuelve si ya pasó la hora, si
 * alguna reserva venció y cuál es el premio que toca ahora.
 */

if (!function_exists('lockedRead')) {

  function lockedDataFile() { return toppingsDataFile('locked-prize.json'); }
  function lockedLockFile() { return toppingsDataFile('locked-prize.lock'); }

  /** Cuánto se le guarda el premio a alguien mientras escribe su nombre. */
  function lockedReservaMs() { return 3 * 60 * 1000; }

  function lockedNowMs() { return (int) round(microtime(true) * 1000); }

  function lockedDefaultState() { return array('prizes' => array()); }

  function lockedNormalize($state) {
    if (!is_array($state) || !isset($state['prizes']) || !is_array($state['prizes'])) {
      return lockedDefaultState();
    }
    $state['prizes'] = array_values($state['prizes']);
    return $state;
  }

  function lockedReadRaw() {
    $f = lockedDataFile();
    if (!file_exists($f)) return lockedDefaultState();
    $raw = @file_get_contents($f);
    $d = $raw ? json_decode($raw, true) : null;
    return lockedNormalize($d);
  }

  function lockedWriteAtomic($state) {
    $f = lockedDataFile();
    $dir = dirname($f);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $f . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    return true;
  }

  /**
   * Todo lo que escribe pasa por acá. El candado se toma ANTES de leer y se
   * suelta DESPUÉS de escribir: entre esas dos cosas nadie más entra, que es
   * exactamente lo que impide dos ganadores.
   */
  function lockedWithWriteLock($cb) {
    $lock = lockedLockFile();
    $dir = dirname($lock);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen($lock, 'c');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $state = lockedReadRaw();
    $res = $cb($state);
    if (is_array($res)) lockedWriteAtomic($res);
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($res) ? $res : $state;
  }

  /**
   * Pone al día los estados sin tocar el disco: si ya pasó la hora pasa a
   * desbloqueado, y si una reserva venció el premio vuelve a estar libre.
   * Devuelve true si algo cambió, para que quien llame decida si guardar.
   */
  function lockedRefrescar(&$state) {
    $ahora = lockedNowMs();
    $cambio = false;
    foreach ($state['prizes'] as &$p) {
      if (!is_array($p)) continue;
      $estado = isset($p['status']) ? $p['status'] : 'programado';
      if ($estado === 'reclamado' || $estado === 'cancelado') continue;

      // una reserva abandonada libera el premio
      if ($estado === 'reservado') {
        $hasta = isset($p['reservedUntil']) ? (int) $p['reservedUntil'] : 0;
        if ($ahora > $hasta) {
          $p['status'] = 'desbloqueado';
          $p['reservedUntil'] = null;
          $p['winnerDeviceId'] = null;
          $p['winnerName'] = null;
          $cambio = true;
        }
        continue;
      }

      $unlock = isset($p['unlockAt']) ? (int) $p['unlockAt'] : 0;
      if ($estado === 'programado' && $unlock > 0 && $ahora >= $unlock) {
        $p['status'] = 'desbloqueado';
        $cambio = true;
      }
    }
    unset($p);
    return $cambio;
  }

  /** Lee dejando los estados al día (y guardando solo si hizo falta). */
  function lockedRead() {
    $state = lockedReadRaw();
    if (lockedRefrescar($state)) {
      lockedWithWriteLock(function ($st) {
        lockedRefrescar($st);
        return $st;
      });
      $state = lockedReadRaw();
    }
    return $state;
  }

  /**
   * El premio que le toca a la gente ahora mismo: el más próximo que todavía
   * no se reclamó ni se canceló. Si el de hoy ya lo ganó alguien, el siguiente
   * ocupa su lugar solo — sin que Fabián tenga que configurar nada.
   */
  function lockedActual($state) {
    $vivos = array();
    foreach ($state['prizes'] as $p) {
      if (!is_array($p)) continue;
      $estado = isset($p['status']) ? $p['status'] : 'programado';
      if ($estado === 'reclamado' || $estado === 'cancelado') continue;
      $vivos[] = $p;
    }
    if (!count($vivos)) return null;
    usort($vivos, function ($a, $b) {
      return ((int) $a['unlockAt']) - ((int) $b['unlockAt']);
    });
    return $vivos[0];
  }

  /** El último que alguien se llevó, para la línea del ganador anterior. */
  function lockedUltimoGanador($state) {
    $ganados = array();
    foreach ($state['prizes'] as $p) {
      if (!is_array($p)) continue;
      if (!isset($p['status']) || $p['status'] !== 'reclamado') continue;
      if (empty($p['winnerName'])) continue;
      $ganados[] = $p;
    }
    if (!count($ganados)) return null;
    usort($ganados, function ($a, $b) {
      return ((int) $b['claimedAt']) - ((int) $a['claimedAt']);
    });
    return $ganados[0];
  }

  function lockedBuscarIndice($state, $id) {
    foreach ($state['prizes'] as $i => $p) {
      if (is_array($p) && isset($p['id']) && $p['id'] === $id) return $i;
    }
    return null;
  }

  /**
   * Lo que ve el cliente. Mientras está bloqueado NO viaja el nombre del
   * premio ni su ícono: si viajaran, bastaría con mirar la red del navegador
   * para saber qué es, y deja de ser un premio secreto.
   */
  function lockedEstadoPublico($state, $deviceId) {
    $actual = lockedActual($state);
    $ahora = lockedNowMs();
    $ultimo = lockedUltimoGanador($state);

    $out = array(
      'ok' => true,
      'serverNow' => $ahora,
      'hayPremio' => false,
      'estado' => 'ninguno',
      'ganadorAnterior' => $ultimo ? $ultimo['winnerName'] : null,
    );
    if (!$actual) return $out;

    $estado = $actual['status'];
    $desbloqueado = ($estado === 'desbloqueado' || $estado === 'reservado');

    $out['hayPremio'] = true;
    $out['id'] = $actual['id'];
    $out['unlockAt'] = (int) $actual['unlockAt'];
    $out['estado'] = $desbloqueado ? 'desbloqueado' : 'bloqueado';

    // el premio se revela SOLO cuando ya se desbloqueó
    if ($desbloqueado) {
      $out['prizeName'] = $actual['prizeName'];
      $out['prizeIcon'] = isset($actual['prizeIcon']) ? $actual['prizeIcon'] : '🎁';
    }

    // si está reservado por otro, este cliente ya no puede reclamarlo
    if ($estado === 'reservado') {
      $mio = isset($actual['winnerDeviceId']) && $actual['winnerDeviceId'] === $deviceId;
      $out['reservadoPorOtro'] = !$mio;
      $out['esperandoMiNombre'] = $mio;
    }
    return $out;
  }
}
