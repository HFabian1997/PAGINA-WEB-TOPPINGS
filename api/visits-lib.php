<?php
require_once __DIR__ . '/data-path.php';
/**
 * 📅 Historial de visitas — qué días vino cada persona.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE APARTE
 *
 * Para poder decir "se conectó 4 veces esta semana" hace falta saber qué días
 * vino cada quien. Eso NO se puede guardar en presence.json: ese archivo se
 * lee y se escribe en CADA latido, de CADA visitante, cada minuto. Meterle
 * noventa días de listas lo volvería lento justo en el camino más caliente
 * del sitio.
 *
 * Así que se separa caliente de frío:
 *
 *   presence.json  -> solo la lista de hoy. Chico. Lo escribe todo el mundo.
 *   visits.json    -> los días anteriores. Crece, pero solo lo lee el panel.
 *
 * El traspaso ocurre una sola vez por día: cuando el primer latido de la
 * madrugada nota que cambió la fecha, archiva la lista del día que terminó.
 *
 * OJO: esto empieza a servir desde el día que se sube. Lo anterior ya se
 * descartó y no hay de dónde sacarlo.
 */

if (!function_exists('visitsRead')) {

  function visitsDataFile() { return toppingsDataFile('visits.json'); }
  function visitsLockFile() { return toppingsLockFile('visits.lock'); }

  /** Cuántos días de historia se guardan. Con 90 días y unas decenas de
   *  visitantes diarios el archivo queda en pocos cientos de KB. */
  function visitsMaxDias() { return 90; }

  function visitsDefaultState() { return array('days' => array()); }

  function visitsNormalize($state) {
    if (!is_array($state) || !isset($state['days']) || !is_array($state['days'])) {
      return visitsDefaultState();
    }
    $limpio = array();
    foreach ($state['days'] as $dia => $lista) {
      if (!is_array($lista)) continue;
      $dia = (string) $dia;
      if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dia)) continue;
      $limpio[$dia] = array_values(array_unique(array_map('strval', $lista)));
    }
    return array('days' => $limpio);
  }

  function visitsReadRaw() {
    $f = visitsDataFile();
    if (!file_exists($f)) return visitsDefaultState();
    $raw = @file_get_contents($f);
    $d = $raw ? json_decode($raw, true) : null;
    return visitsNormalize($d);
  }

  function visitsRead() { return visitsReadRaw(); }

  function visitsWriteAtomic($state) {
    $f = visitsDataFile();
    $dir = dirname($f);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tmp = $f . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    return true;
  }

  function visitsWithWriteLock($cb) {
    $lock = visitsLockFile();
    $dir = dirname($lock);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen($lock, 'c');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $state = visitsReadRaw();
    $res = $cb($state);
    if (is_array($res)) visitsWriteAtomic($res);
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($res) ? $res : $state;
  }

  /**
   * Guarda la lista de un día que terminó.
   *
   * Si ese día ya estaba archivado se fusiona en vez de pisarlo: dos procesos
   * podrían llegar a la vez en el cambio de día y no se puede perder a nadie.
   */
  function visitsArchivarDia($dia, $dispositivos) {
    $dia = (string) $dia;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dia)) return false;
    if (!is_array($dispositivos) || !count($dispositivos)) return false;

    visitsWithWriteLock(function ($state) use ($dia, $dispositivos) {
      $previos = isset($state['days'][$dia]) && is_array($state['days'][$dia]) ? $state['days'][$dia] : array();
      $state['days'][$dia] = array_values(array_unique(array_merge($previos, array_map('strval', $dispositivos))));

      // se descartan los días más viejos del tope
      if (count($state['days']) > visitsMaxDias()) {
        krsort($state['days']);
        $state['days'] = array_slice($state['days'], 0, visitsMaxDias(), true);
      }
      return $state;
    });
    return true;
  }

  /** La fecha (Y-m-d) desde la que cuenta un período. '' = desde siempre. */
  function visitsDesdeDia($periodo) {
    if ($periodo === 'hoy')    return date('Y-m-d');
    if ($periodo === 'semana') return date('Y-m-d', strtotime('-6 days'));
    if ($periodo === 'mes')    return date('Y-m-01');
    return '';
  }

  /**
   * Los días en que vino esta persona, del más nuevo al más viejo.
   *
   * `$hoyDispositivos` es la lista del día en curso, que todavía vive en
   * presence.json y no está archivada — sin ella, "hoy" saldría siempre en 0.
   */
  function visitsDiasDe($state, $deviceId, $desdeDia = '', $hoyDispositivos = array()) {
    $deviceId = (string) $deviceId;
    if ($deviceId === '') return array();
    $dias = array();

    $hoy = date('Y-m-d');
    if (is_array($hoyDispositivos) && in_array($deviceId, $hoyDispositivos, true)) {
      if ($desdeDia === '' || $hoy >= $desdeDia) $dias[] = $hoy;
    }

    foreach ($state['days'] as $dia => $lista) {
      if ($dia === $hoy) continue;                       // ya se contó arriba
      if ($desdeDia !== '' && $dia < $desdeDia) continue;
      if (in_array($deviceId, $lista, true)) $dias[] = $dia;
    }
    rsort($dias);
    return $dias;
  }

  /** Quiénes vinieron en el período (lista de deviceId, sin repetir). */
  function visitsDispositivosDesde($state, $desdeDia = '', $hoyDispositivos = array()) {
    $vistos = array();
    $hoy = date('Y-m-d');

    if (is_array($hoyDispositivos) && ($desdeDia === '' || $hoy >= $desdeDia)) {
      foreach ($hoyDispositivos as $d) $vistos[(string) $d] = true;
    }
    foreach ($state['days'] as $dia => $lista) {
      if ($dia === $hoy) continue;
      if ($desdeDia !== '' && $dia < $desdeDia) continue;
      foreach ($lista as $d) $vistos[(string) $d] = true;
    }
    return array_keys($vistos);
  }
}
