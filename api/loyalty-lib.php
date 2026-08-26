<?php
require_once __DIR__ . '/data-path.php';
/**
 * 🎟️ Tarjeta de fidelidad — los sellos, guardados en el servidor.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Los sellos vivían en el localStorage del celular del cliente, y eso traía
 * tres problemas que se vieron en el local:
 *
 *  1. Si el QR le abría OTRO navegador del que usa normalmente (la cámara del
 *     celular abre el navegador por defecto, no el de WhatsApp), ahí tenía
 *     cero sellos y parecía que no le registraba nada.
 *  2. Si borraba datos del navegador, perdía la tarjeta entera.
 *  3. Y lo peor: como el servidor no sabía cuántos sellos tenía nadie,
 *     premio.php entregaba un premio CADA VEZ que se tocaba el botón de
 *     reclamar. Se llegaron a sacar cuatro premios seguidos con una sola
 *     tarjeta.
 *
 * Acá los sellos son del servidor. El celular solo aporta su deviceId.
 *
 * NO puede vivir en premio.json: ese archivo se reinicia cada medianoche
 * (ensureFreshDay), y una tarjeta dura semanas. Por eso tiene el suyo.
 *
 * El deviceId sigue estando en el navegador, así que quien borre el caché
 * entra como cliente nuevo aunque sus sellos sigan guardados acá. Para eso
 * está `loyaltyAjustarSellos()`: el admin se los devuelve a mano.
 */

if (!function_exists('loyaltyRead')) {

  function loyaltyDataFile() { return toppingsDataFile('loyalty.json'); }
  function loyaltyLockFile() { return toppingsLockFile('loyalty.lock'); }

  function loyaltyNowMs() { return (int) round(microtime(true) * 1000); }

  function loyaltyDefaultState() { return array('cards' => array()); }

  function loyaltyDefaultCard() {
    return array(
      'stamps' => 0,
      'lastStampAt' => 0,
      'name' => null,
      'claims' => 0,
      'lastClaimAt' => 0,
      'updatedAt' => 0,
    );
  }

  function loyaltyNormalizeCard($c) {
    $d = loyaltyDefaultCard();
    if (!is_array($c)) return $d;
    $d['stamps']      = max(0, (int) (isset($c['stamps']) ? $c['stamps'] : 0));
    $d['lastStampAt'] = (int) (isset($c['lastStampAt']) ? $c['lastStampAt'] : 0);
    $d['name']        = isset($c['name']) && $c['name'] !== '' ? (string) $c['name'] : null;
    $d['claims']      = max(0, (int) (isset($c['claims']) ? $c['claims'] : 0));
    $d['lastClaimAt'] = (int) (isset($c['lastClaimAt']) ? $c['lastClaimAt'] : 0);
    $d['updatedAt']   = (int) (isset($c['updatedAt']) ? $c['updatedAt'] : 0);
    return $d;
  }

  function loyaltyNormalize($state) {
    if (!is_array($state) || !isset($state['cards']) || !is_array($state['cards'])) {
      return loyaltyDefaultState();
    }
    $limpio = array();
    foreach ($state['cards'] as $id => $card) {
      $id = (string) $id;
      if ($id === '') continue;
      $limpio[$id] = loyaltyNormalizeCard($card);
    }
    return array('cards' => $limpio);
  }

  function loyaltyReadRaw() {
    $f = loyaltyDataFile();
    if (!file_exists($f)) return loyaltyDefaultState();
    $raw = @file_get_contents($f);
    $d = $raw ? json_decode($raw, true) : null;
    return loyaltyNormalize($d);
  }

  function loyaltyRead() { return loyaltyReadRaw(); }

  function loyaltyWriteAtomic($state) {
    $f = loyaltyDataFile();
    $dir = dirname($f);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tmp = $f . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $json) === false) return false;
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    return true;
  }

  /**
   * Comprobar y escribir DENTRO del mismo candado. Es lo que impide que dos
   * toques seguidos al botón de reclamar entreguen dos premios: el segundo
   * entra en fila y se encuentra la tarjeta ya vaciada.
   */
  function loyaltyWithWriteLock($cb) {
    $lock = loyaltyLockFile();
    $dir = dirname($lock);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen($lock, 'c');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $state = loyaltyReadRaw();
    $res = $cb($state);
    if (is_array($res)) loyaltyWriteAtomic($res);
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($res) ? $res : $state;
  }

  /* ---------- configuración (la del panel, en content.json) ---------- */

  function loyaltyConfig() {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $f = __DIR__ . '/../admin/content.json';
    $raw = file_exists($f) ? @file_get_contents($f) : '';
    $content = $raw ? json_decode($raw, true) : null;
    $cfg = is_array($content) && isset($content['dailyPrize']['loyalty']) && is_array($content['dailyPrize']['loyalty'])
      ? $content['dailyPrize']['loyalty']
      : array();
    return $cfg;
  }

  function loyaltyActiva() {
    $c = loyaltyConfig();
    return !isset($c['active']) || !empty($c['active']);
  }

  function loyaltySellosNecesarios() {
    $c = loyaltyConfig();
    $n = isset($c['stampsRequired']) ? (int) $c['stampsRequired'] : 8;
    return $n > 0 ? min(60, $n) : 8;
  }

  function loyaltyCodigoSecreto() {
    $c = loyaltyConfig();
    return isset($c['secretCode']) ? trim((string) $c['secretCode']) : '';
  }

  /**
   * Cuánto hay que esperar entre un sello y el siguiente.
   *
   * Por defecto 20 horas y no 24 a propósito: con 24 en punto, quien vino un
   * martes a las 8 de la noche no podría sellar el miércoles a las 7, y eso
   * se siente como que el sistema falla. 20 deja margen y sigue siendo un
   * sello por día. El panel lo cambia.
   */
  function loyaltyEsperaMs() {
    $c = loyaltyConfig();
    $h = isset($c['stampCooldownHours']) ? (float) $c['stampCooldownHours'] : 20;
    if ($h < 0) $h = 0;
    if ($h > 24 * 30) $h = 24 * 30;
    return (int) round($h * 3600000);
  }

  /* ---------- la tarjeta de un cliente ---------- */

  function loyaltyCard($state, $deviceId) {
    $deviceId = (string) $deviceId;
    return isset($state['cards'][$deviceId])
      ? loyaltyNormalizeCard($state['cards'][$deviceId])
      : loyaltyDefaultCard();
  }

  /** Cuándo podrá volver a sellar (ms epoch); 0 si ya puede. */
  function loyaltyProximoSelloMs($card) {
    $ultimo = (int) $card['lastStampAt'];
    if ($ultimo <= 0) return 0;
    $cuando = $ultimo + loyaltyEsperaMs();
    return $cuando > loyaltyNowMs() ? $cuando : 0;
  }

  /**
   * Lo que ve el cliente. Nunca sale el código secreto del QR ni el deviceId
   * de nadie más.
   */
  function loyaltyPublicCard($state, $deviceId) {
    $card = loyaltyCard($state, $deviceId);
    $req = loyaltySellosNecesarios();
    return array(
      'stamps' => min($req, $card['stamps']),
      'required' => $req,
      'name' => $card['name'],
      'canClaim' => $card['stamps'] >= $req,
      'nextStampAt' => loyaltyProximoSelloMs($card),
      'cooldownHours' => round(loyaltyEsperaMs() / 3600000, 2),
      'claims' => $card['claims'],
      'serverNow' => loyaltyNowMs(),
    );
  }

  /* ---------- las tres cosas que cambian la tarjeta ---------- */

  /**
   * Suma un sello por haber escaneado el QR. Devuelve el motivo del rechazo
   * para poder decírselo al cliente en vez de dejarlo mirando una pantalla
   * que no hace nada — que es lo que pasaba antes.
   *
   * Se llama SIEMPRE dentro de loyaltyWithWriteLock().
   */
  function loyaltySellar(&$state, $deviceId, $codigo, $nombre = '') {
    $deviceId = (string) $deviceId;
    if ($deviceId === '') return array('ok' => false, 'reason' => 'no-device');
    if (!loyaltyActiva()) return array('ok' => false, 'reason' => 'inactive');

    $esperado = loyaltyCodigoSecreto();
    $dado = trim((string) $codigo);
    // hash_equals no sirve acá (el código es público, está impreso en la
    // pared del local); lo que importa es comparar sin distinguir mayúsculas
    if ($esperado === '' || $dado === '' || strcasecmp($dado, $esperado) !== 0) {
      return array('ok' => false, 'reason' => 'mismatch');
    }

    $card = loyaltyCard($state, $deviceId);
    $req = loyaltySellosNecesarios();

    if ($card['stamps'] >= $req) {
      return array('ok' => false, 'reason' => 'full', 'card' => loyaltyPublicCard($state, $deviceId));
    }

    $proximo = loyaltyProximoSelloMs($card);
    if ($proximo > 0) {
      return array(
        'ok' => false,
        'reason' => 'too-soon',
        'nextStampAt' => $proximo,
        'card' => loyaltyPublicCard($state, $deviceId),
      );
    }

    $ahora = loyaltyNowMs();
    $card['stamps'] = min($req, $card['stamps'] + 1);
    $card['lastStampAt'] = $ahora;
    $card['updatedAt'] = $ahora;
    if ($nombre !== '') $card['name'] = $nombre;
    $state['cards'][$deviceId] = $card;

    return array('ok' => true, 'card' => loyaltyPublicCard($state, $deviceId));
  }

  /**
   * Vacía la tarjeta porque se reclamó el premio. Devuelve false si NO había
   * derecho a reclamar — y eso es justamente lo que faltaba antes.
   *
   * Se llama SIEMPRE dentro de loyaltyWithWriteLock().
   */
  function loyaltyReclamar(&$state, $deviceId, $nombre = '') {
    $deviceId = (string) $deviceId;
    if ($deviceId === '') return array('ok' => false, 'reason' => 'no-device');

    $card = loyaltyCard($state, $deviceId);
    $req = loyaltySellosNecesarios();
    if ($card['stamps'] < $req) {
      return array(
        'ok' => false,
        'reason' => 'incomplete',
        'card' => loyaltyPublicCard($state, $deviceId),
      );
    }

    $ahora = loyaltyNowMs();
    $card['stamps'] = 0;          // arranca una tarjeta nueva
    $card['claims'] = $card['claims'] + 1;
    $card['lastClaimAt'] = $ahora;
    $card['updatedAt'] = $ahora;
    if ($nombre !== '') $card['name'] = $nombre;
    $state['cards'][$deviceId] = $card;

    return array('ok' => true, 'card' => loyaltyPublicCard($state, $deviceId));
  }

  /**
   * El admin da o quita sellos a mano. Es la red de seguridad de todo esto:
   * el cliente que borró el caché entra como nuevo, y así se le devuelven los
   * que tenía. También sirve para premiar sin que escaneen.
   *
   * `$delta` positivo suma, negativo quita. No respeta la espera a propósito
   * — el admin es el admin.
   *
   * Se llama SIEMPRE dentro de loyaltyWithWriteLock().
   */
  function loyaltyAjustarSellos(&$state, $deviceId, $delta, $nombre = '') {
    $deviceId = (string) $deviceId;
    if ($deviceId === '') return array('ok' => false, 'reason' => 'no-device');
    $delta = (int) $delta;

    $card = loyaltyCard($state, $deviceId);
    $req = loyaltySellosNecesarios();
    $ahora = loyaltyNowMs();

    $card['stamps'] = max(0, min($req, $card['stamps'] + $delta));
    $card['updatedAt'] = $ahora;
    /* Un sello dado por el admin NO arranca la espera: si el cliente perdió
       la tarjeta y se la devolvemos, tiene que poder volver a sellar cuando
       le toque, no al día siguiente de que se la repusimos. */
    if ($nombre !== '') $card['name'] = $nombre;
    $state['cards'][$deviceId] = $card;

    return array('ok' => true, 'card' => loyaltyPublicCard($state, $deviceId));
  }

  /** Deja todas las tarjetas en cero (el admin empezando de nuevo). */
  function loyaltyReiniciarTodo(&$state) {
    $ahora = loyaltyNowMs();
    foreach ($state['cards'] as $id => $card) {
      $card = loyaltyNormalizeCard($card);
      $card['stamps'] = 0;
      $card['lastStampAt'] = 0;
      $card['updatedAt'] = $ahora;
      $state['cards'][$id] = $card;
    }
    return array('ok' => true, 'cards' => count($state['cards']));
  }

  /**
   * La lista para el panel: quién tiene cuántos sellos.
   *
   * Incluye a TODO cliente registrado, tenga tarjeta o no. Al principio solo
   * salían los que ya tenían sellos, y como las tarjetas arrancaron en cero
   * la lista aparecía vacía — justo cuando más se necesita, que es para
   * reponerle los sellos a alguien que empieza de cero.
   *
   * `$clientes` es el mapa de customers.json (deviceId => datos). Se pasa
   * desde el endpoint para no atar esta librería al registro de clientes.
   */
  function loyaltyListado($state, $limite = 1000, $clientes = array()) {
    $req = loyaltySellosNecesarios();
    $filas = array();
    $vistos = array();

    $fila = function ($id, $card, $nombre, $ultimaVisita) use ($req) {
      return array(
        'deviceId' => (string) $id,
        // el nombre del registro de clientes manda: es el que el cliente
        // eligió y el que puede haber cambiado después
        'name' => $nombre !== null && $nombre !== '' ? $nombre : $card['name'],
        'stamps' => min($req, $card['stamps']),
        'required' => $req,
        'claims' => $card['claims'],
        'lastStampAt' => $card['lastStampAt'],
        'lastClaimAt' => $card['lastClaimAt'],
        'lastSeenAt' => (int) $ultimaVisita,
        'nextStampAt' => loyaltyProximoSelloMs($card),
      );
    };

    foreach ($state['cards'] as $id => $card) {
      $id = (string) $id;
      $vistos[$id] = true;
      $c = isset($clientes[$id]) && is_array($clientes[$id]) ? $clientes[$id] : array();
      $filas[] = $fila($id, loyaltyNormalizeCard($card),
        isset($c['name']) ? $c['name'] : null,
        isset($c['lastSeenAt']) ? $c['lastSeenAt'] : 0);
    }

    foreach ($clientes as $id => $c) {
      $id = (string) $id;
      if (isset($vistos[$id])) continue;
      if (!is_array($c) || !isset($c['name']) || $c['name'] === '') continue;
      $filas[] = $fila($id, loyaltyDefaultCard(), $c['name'],
        isset($c['lastSeenAt']) ? $c['lastSeenAt'] : 0);
    }

    /* Primero los que tienen sellos (son los que estás mirando), y dentro de
       cada grupo los que vinieron hace menos. Así el que acaba de pedir su
       sello está arriba y no hay que buscarlo. */
    usort($filas, function ($a, $b) {
      if ($a['stamps'] !== $b['stamps']) return $b['stamps'] - $a['stamps'];
      $va = max($a['lastSeenAt'], $a['lastStampAt']);
      $vb = max($b['lastSeenAt'], $b['lastStampAt']);
      if ($va !== $vb) return $vb - $va;
      return strcasecmp((string) $a['name'], (string) $b['name']);
    });
    return array_slice($filas, 0, $limite);
  }
}
