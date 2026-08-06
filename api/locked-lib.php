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

  function lockedDefaultState() { return array('prizes' => array(), 'history' => array()); }

  function lockedNormalize($state) {
    if (!is_array($state) || !isset($state['prizes']) || !is_array($state['prizes'])) {
      return lockedDefaultState();
    }
    $state['prizes'] = array_values($state['prizes']);
    /* Los premios que se repiten vuelven a estar programados después de que
       alguien los gana, así que el ganador no puede quedarse en la fila: se
       guarda aparte. Los de una sola vez siguen igual que siempre. */
    if (!isset($state['history']) || !is_array($state['history'])) $state['history'] = array();
    $state['history'] = array_values($state['history']);
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

  /**
   * ¿Cuándo vuelve a abrirse este premio, contando desde `$desde`?
   *
   * Cuatro formas, que son las cuatro que se pueden elegir en el panel:
   *   una          → nunca; se gana una vez y se acabó
   *   cadaHoras    → cada N horas contadas desde la fecha original, de modo
   *                  que "cada 24 horas" cae siempre a la misma hora del día
   *                  por más que la gente reclame tarde
   *   horasDelDia  → a unas horas fijas ("15:00, 18:00, 20:00"), todos los días
   *   trasReclamo  → N horas después del reclamo, corriéndose con cada uno
   *
   * Devuelve 0 si no hay próxima (o si la configuración no da para calcularla).
   */
  function lockedProximaFecha($p, $desde) {
    $repite = isset($p['repite']) ? (string) $p['repite'] : 'una';
    $hora = 3600 * 1000;

    if ($repite === 'trasReclamo') {
      $n = isset($p['cadaHoras']) ? (float) $p['cadaHoras'] : 0;
      return $n > 0 ? (int) round($desde + $n * $hora) : 0;
    }

    if ($repite === 'cadaHoras') {
      $n = isset($p['cadaHoras']) ? (float) $p['cadaHoras'] : 0;
      $paso = (int) round($n * $hora);
      if ($paso <= 0) return 0;
      $sig = isset($p['unlockAt']) ? (int) $p['unlockAt'] : (int) $desde;
      // se avanza en pasos exactos desde la fecha original, no desde el reclamo
      if ($sig <= $desde) {
        $saltos = (int) ceil((($desde - $sig) + 1) / $paso);
        $sig += $saltos * $paso;
      }
      return $sig;
    }

    if ($repite === 'horasDelDia') {
      $horas = isset($p['horas']) && is_array($p['horas']) ? $p['horas'] : array();
      if (!count($horas)) return 0;
      $seg = (int) floor($desde / 1000);
      for ($d = 0; $d < 8; $d++) {
        $dia = date('Y-m-d', $seg + $d * 86400);
        $delDia = array();
        foreach ($horas as $h) {
          $t = strtotime($dia . ' ' . trim((string) $h) . ':00');
          if ($t !== false) $delDia[] = $t * 1000;
        }
        sort($delDia);
        foreach ($delDia as $ms) if ($ms > $desde) return (int) $ms;
      }
      return 0;
    }

    return 0;
  }

  /**
   * Después de que alguien gana: si el premio se repite, el ganador se archiva
   * y la fila vuelve a quedar programada para la próxima vez. Si es de una sola
   * vez, no se toca nada y el ganador se queda en la fila como hasta ahora.
   *
   * Se llama SIEMPRE dentro del candado de escritura, junto con el reclamo.
   */
  function lockedRearmar(&$state, $i) {
    if (!isset($state['prizes'][$i]) || !is_array($state['prizes'][$i])) return;
    $p = $state['prizes'][$i];
    $repite = isset($p['repite']) ? (string) $p['repite'] : 'una';
    if ($repite === 'una' || $repite === '') return;

    $desde = isset($p['claimedAt']) ? (int) $p['claimedAt'] : lockedNowMs();
    $proxima = lockedProximaFecha($p, $desde);

    $state['history'][] = array(
      'id' => (isset($p['id']) ? $p['id'] : '') . '_' . $desde,
      'prizeId' => isset($p['id']) ? $p['id'] : '',
      'prizeName' => isset($p['prizeName']) ? $p['prizeName'] : '',
      'prizeIcon' => isset($p['prizeIcon']) ? $p['prizeIcon'] : '🎁',
      'tipo' => isset($p['tipo']) ? $p['tipo'] : 'escrito',
      'status' => 'reclamado',
      'winnerName' => isset($p['winnerName']) ? $p['winnerName'] : null,
      'winnerDeviceId' => isset($p['winnerDeviceId']) ? $p['winnerDeviceId'] : null,
      'claimedAt' => $desde,
    );

    // sin próxima fecha calculable el premio se apaga en vez de quedar suelto
    $p['status'] = $proxima > 0 ? 'programado' : 'cancelado';
    if ($proxima > 0) $p['unlockAt'] = $proxima;
    $p['winnerName'] = null;
    $p['winnerDeviceId'] = null;
    $p['claimedAt'] = null;
    $p['reservedUntil'] = null;
    $state['prizes'][$i] = $p;
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

  /**
   * Todos los premios que alguien ya se llevó, del más reciente al más viejo.
   * Están en dos sitios: los de una sola vez se quedan en su propia fila, y los
   * que se repiten se archivan aparte al rearmarse.
   */
  function lockedHistorial($state) {
    $ganados = array();
    $fuentes = array($state['prizes'], isset($state['history']) ? $state['history'] : array());
    foreach ($fuentes as $lista) {
      foreach ($lista as $p) {
        if (!is_array($p)) continue;
        if (!isset($p['status']) || $p['status'] !== 'reclamado') continue;
        if (empty($p['winnerName'])) continue;
        $ganados[] = $p;
      }
    }
    usort($ganados, function ($a, $b) {
      return ((int) $b['claimedAt']) - ((int) $a['claimedAt']);
    });
    return $ganados;
  }

  /** El último que alguien se llevó, para la línea del ganador anterior. */
  function lockedUltimoGanador($state) {
    $ganados = lockedHistorial($state);
    return count($ganados) ? $ganados[0] : null;
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
      $out['tipo'] = isset($actual['tipo']) ? $actual['tipo'] : 'escrito';
      if ($out['tipo'] === 'ruleta') $out['giros'] = isset($actual['giros']) ? (int) $actual['giros'] : 1;
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
