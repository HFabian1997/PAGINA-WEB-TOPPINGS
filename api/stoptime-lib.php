<?php
/**
 * "Detén el tiempo" — el segundo modo del cronómetro. Aparece un cronómetro
 * subiendo y el cliente tiene que detenerlo justo en el tiempo que el admin
 * configuró. Es un modo APARTE: el modo de cuenta regresiva de siempre no se
 * toca (ese vive en premio.php y no pasa por acá).
 *
 * Por qué archivo propio y no premio.json: acá se guardan rondas e intentos
 * de cada dispositivo, que el cliente escribe en cualquier momento y crecen
 * solos. premio.json se reinicia entero al cambiar el día (ensureFreshDay), y
 * eso borraría la ronda en curso a medianoche.
 *
 * Mismo patrón de escritura atómica + candado que ruleta-lib.php / redeem-lib.php.
 */

if (!function_exists('stDataFile')) {
  function stDataFile() { return __DIR__ . '/data/stoptime.json'; }
  function stLockFile() { return __DIR__ . '/data/stoptime.lock'; }

  /* No hay rondas: el juego está siempre disponible dentro de sus fechas, y
     quién puede jugar lo decide únicamente cada cuánto se renuevan los
     intentos (ej. uno cada 12 horas). */
  function stDefaultState() {
    return array(
      'attempts' => array(),   // un registro por intento (histórico completo)
    );
  }

  function stNormalizeState($state) {
    $default = stDefaultState();
    if (!is_array($state)) return $default;
    foreach ($default as $k => $v) {
      if (!isset($state[$k])) $state[$k] = $v;
    }
    if (!is_array($state['attempts'])) $state['attempts'] = array();
    // restos del sistema de rondas anterior: se ignoran sin borrar nada
    unset($state['roundId'], $state['roundStatus'], $state['roundStartedAt'], $state['roundEndedAt'], $state['winners']);
    return $state;
  }

  function stReadState() {
    $file = stDataFile();
    if (!file_exists($file)) return stDefaultState();
    $raw = @file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    return stNormalizeState($data);
  }

  function stWriteStateAtomic($state) {
    $file = stDataFile();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
  }

  function stWithWriteLock($callback) {
    $lockFile = stLockFile();
    $dir = dirname($lockFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $lockFp = @fopen($lockFile, 'c');
    if (!$lockFp) return null;
    flock($lockFp, LOCK_EX);
    $state = stReadState();
    $result = $callback($state);
    if (is_array($result)) stWriteStateAtomic($result);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return is_array($result) ? $result : $state;
  }

  function stNowMs() { return (int) round(microtime(true) * 1000); }

  /** Configuración del modo, tal como la dejó el admin en el panel. */
  function stConfig() {
    $file = __DIR__ . '/../admin/content.json';
    $cfg = array();
    if (file_exists($file)) {
      $raw = @file_get_contents($file);
      $content = $raw ? json_decode($raw, true) : null;
      if (is_array($content) && isset($content['dailyPrize']['cronometro']['stopTime'])) {
        $cfg = $content['dailyPrize']['cronometro']['stopTime'];
      }
    }
    if (!is_array($cfg)) $cfg = array();

    return array(
      'targetMs' => isset($cfg['targetMs']) && $cfg['targetMs'] > 0 ? (int) $cfg['targetMs'] : 10000,
      'precision' => in_array(isset($cfg['precision']) ? $cfg['precision'] : '', array('easy', 'medium', 'hard'), true) ? $cfg['precision'] : 'medium',
      'maxWinners' => isset($cfg['maxWinners']) ? (int) $cfg['maxWinners'] : 1,
      'attemptsPerUser' => isset($cfg['attemptsPerUser']) && (int) $cfg['attemptsPerUser'] > 0 ? (int) $cfg['attemptsPerUser'] : 1,
      // "round" ya no existe: si quedó guardado de antes, se trata como diario
      'attemptsReset' => in_array(isset($cfg['attemptsReset']) ? $cfg['attemptsReset'] : '', array('manual', 'daily', 'interval'), true) ? $cfg['attemptsReset'] : 'daily',
      'attemptsResetAmount' => isset($cfg['attemptsResetAmount']) && $cfg['attemptsResetAmount'] > 0 ? (float) $cfg['attemptsResetAmount'] : 1,
      'attemptsResetUnit' => in_array(isset($cfg['attemptsResetUnit']) ? $cfg['attemptsResetUnit'] : '', array('minutes', 'hours', 'days'), true) ? $cfg['attemptsResetUnit'] : 'days',
      'startAt' => isset($cfg['startAt']) ? (string) $cfg['startAt'] : '',
      'endAt' => isset($cfg['endAt']) ? (string) $cfg['endAt'] : '',
      'prizeName' => isset($cfg['prizeName']) && $cfg['prizeName'] !== '' ? (string) $cfg['prizeName'] : 'Premio del cronómetro',
      'prizeIcon' => isset($cfg['prizeIcon']) && $cfg['prizeIcon'] !== '' ? (string) $cfg['prizeIcon'] : '🎁',
      'codeExpiryHours' => isset($cfg['codeExpiryHours']) && $cfg['codeExpiryHours'] > 0 ? (float) $cfg['codeExpiryHours'] : 24,
      'rewardType' => (isset($cfg['rewardType']) && $cfg['rewardType'] === 'wheelSpins') ? 'wheelSpins' : 'direct',
      'wheelSpinCount' => isset($cfg['wheelSpinCount']) && (int) $cfg['wheelSpinCount'] > 0 ? (int) $cfg['wheelSpinCount'] : 1,
      'wheelTicketExpiryHours' => isset($cfg['wheelTicketExpiryHours']) && $cfg['wheelTicketExpiryHours'] > 0 ? (float) $cfg['wheelTicketExpiryHours'] : 24,
    );
  }

  /** ¿El modo está activo Y dentro de la ventana de fechas configurada? */
  function stInWindow($cfg) {
    $now = time();
    if ($cfg['startAt'] !== '') {
      $t = strtotime($cfg['startAt']);
      if ($t !== false && $now < $t) return false;
    }
    if ($cfg['endAt'] !== '') {
      $t = strtotime($cfg['endAt']);
      if ($t !== false && $now > $t) return false;
    }
    return true;
  }

  /**
   * Margen de acierto según la dificultad elegida:
   *   fácil   -> cae en el mismo segundo que el objetivo
   *   medio   -> ±100 ms
   *   difícil -> la misma centésima exacta (lo que se ve en pantalla)
   */
  function stIsWin($elapsedMs, $cfg) {
    $target = (int) $cfg['targetMs'];
    $elapsed = (int) $elapsedMs;
    if ($cfg['precision'] === 'easy') {
      return intdiv($elapsed, 1000) === intdiv($target, 1000);
    }
    if ($cfg['precision'] === 'hard') {
      return intdiv($elapsed, 10) === intdiv($target, 10);
    }
    return abs($elapsed - $target) <= 100;
  }

  /** Cada cuánto se renuevan los intentos, en milisegundos (modo "interval"). */
  function stIntervalMs($cfg) {
    $amount = (float) $cfg['attemptsResetAmount'];
    if ($amount <= 0) $amount = 1;
    $unit = $cfg['attemptsResetUnit'];
    if ($unit === 'minutes') $unitMs = 60000;
    elseif ($unit === 'hours') $unitMs = 3600000;
    else $unitMs = 86400000;   // days
    return (int) round($amount * $unitMs);
  }

  /**
   * ¿Este intento cae dentro del periodo vigente? La política de reinicio se
   * evalúa acá, al leer — misma idea perezosa que el resto del proyecto, sin
   * depender de un cron que este hosting no tiene.
   *
   *   daily    -> solo los de hoy (día del negocio, America/Bogota)
   *   interval -> solo los de las últimas N horas/días (ventana deslizante)
   *   manual   -> todos, hasta que el admin reinicie participantes
   *
   * Lo usan las dos cuentas: la de intentos (por dispositivo) y la de
   * ganadores (global). Así el tope de ganadores se renueva con el mismo
   * reloj que los intentos, sin un segundo calendario que explicar.
   */
  function stInPeriod($a, $cfg) {
    if ($cfg['attemptsReset'] === 'daily') {
      return isset($a['day']) && $a['day'] === date('Y-m-d');
    }
    if ($cfg['attemptsReset'] === 'interval') {
      return isset($a['startedAt']) && (int) $a['startedAt'] >= stNowMs() - stIntervalMs($cfg);
    }
    return true;   // manual
  }

  /**
   * Los intentos de este dispositivo que CUENTAN ahora mismo.
   *
   * Todo lo que ve el cliente sale de esta misma lista, así que cuando se le
   * renueva el intento también se le limpia la tarjeta (el resultado anterior
   * deja de mostrarse). El premio que hubiera ganado no se pierde: vive en
   * 🎁 Mis Premios, no acá.
   */
  function stAttemptsInWindow($state, $deviceId, $cfg) {
    if ($deviceId === '') return array();
    $out = array();
    foreach ($state['attempts'] as $a) {
      if (!isset($a['deviceId']) || $a['deviceId'] !== $deviceId) continue;
      if (!stInPeriod($a, $cfg)) continue;
      $out[] = $a;
    }
    usort($out, function ($x, $y) { return (int) $x['startedAt'] - (int) $y['startedAt']; });
    return $out;
  }

  function stCountAttempts($state, $deviceId, $cfg) {
    return count(stAttemptsInWindow($state, $deviceId, $cfg));
  }

  /** Cuántos ganadores hay ya en el periodo vigente (de todos los clientes). */
  function stCountWinners($state, $cfg) {
    $n = 0;
    foreach ($state['attempts'] as $a) {
      if (!empty($a['won']) && stInPeriod($a, $cfg)) $n++;
    }
    return $n;
  }

  /** El intento más reciente de este dispositivo dentro de la ventana vigente. */
  function stLastAttempt($state, $deviceId, $cfg) {
    $enVentana = stAttemptsInWindow($state, $deviceId, $cfg);
    return $enVentana ? $enVentana[count($enVentana) - 1] : null;
  }

  /**
   * Cuándo vuelve a tener intentos este dispositivo, en milisegundos. null si
   * todavía le quedan, o si no hay hora fija que mostrar (modo manual: depende
   * de que el admin reinicie participantes).
   */
  function stNextResetMs($state, $deviceId, $cfg) {
    $enVentana = stAttemptsInWindow($state, $deviceId, $cfg);
    if (count($enVentana) < $cfg['attemptsPerUser']) return null;

    if ($cfg['attemptsReset'] === 'daily') {
      // medianoche del negocio, no la del celular (que puede tener otra zona)
      return strtotime('tomorrow') * 1000;
    }
    if ($cfg['attemptsReset'] === 'interval') {
      // la ventana es deslizante: se libera un cupo cuando el intento más
      // viejo de la ventana termina de envejecer
      return (int) $enVentana[0]['startedAt'] + stIntervalMs($cfg);
    }
    return null;   // manual: no hay hora fija que mostrar
  }
}
