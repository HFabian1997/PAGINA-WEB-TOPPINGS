<?php
/**
 * UN NOMBRE, UNA PERSONA.
 *
 * Hasta ahora esto era solo un aviso: el cliente veía "ese nombre ya está en
 * uso" y podía apretar "continuar igual". Y ni siquiera hacía falta apretarlo:
 * cortando internet la consulta fallaba y el código seguía de largo a
 * propósito, para no dejar a nadie trabado por un problema de red.
 *
 * Ahora es una regla, y vive del lado del servidor porque es el único lugar
 * donde no se puede esquivar.
 *
 * POR QUÉ ESTÁ EN UN ARCHIVO APARTE
 *
 * Las puertas por donde alguien elige o cambia su nombre están repartidas en
 * dos endpoints (run-leaderboard.php y premio.php), y un endpoint no se puede
 * incluir desde otro: al incluirlo se ejecutaría. Así que la regla vive acá,
 * donde los dos la pueden pedir, y hay UNA sola versión de la verdad.
 *
 * DÓNDE BUSCA
 *
 * En los dos registros que existen, porque un nombre puede haberse anotado en
 * cualquiera de los dos según por dónde entró la persona:
 *
 *   customers.json         quien dejó su nombre en el saludo, la tarjeta, el
 *                          cronómetro o el reto
 *   run-leaderboard.json   `names` (permanente, sobrevive a cada evento) y
 *                          `scores` (los del evento en curso)
 */

require_once __DIR__ . '/data-path.php';
require_once __DIR__ . '/customers-lib.php';

if (!function_exists('nombreNormalizado')) {
  /**
   * Cómo se comparan dos nombres. "juan", "JUAN" y " Juan " son la misma
   * persona: si no, la regla se saltea escribiendo distinto.
   */
  function nombreNormalizado($name) {
    $name = trim((string) $name);
    // los espacios de adentro también: "juan  perez" y "juan perez"
    $name = preg_replace('/\s+/u', ' ', $name);
    return function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
  }

  /**
   * ¿Este nombre lo tiene OTRO dispositivo?
   *
   * `$deviceId` es quien pregunta: se lo excluye a propósito, para que alguien
   * pueda volver a guardar su propio nombre sin que se lo rechace por estar
   * tomado por sí mismo.
   */
  function nombreTomadoPorOtro($name, $deviceId) {
    $needle = nombreNormalizado($name);
    if ($needle === '') return false;
    $deviceId = (string) $deviceId;

    // 1. el registro de clientes
    if (function_exists('customerNameTaken') && customerNameTaken($name, $deviceId)) return true;

    // 2. el archivo del ranking: nombres permanentes y puntajes del evento
    $archivo = toppingsDataFile('run-leaderboard.json');
    if (!file_exists($archivo)) return false;
    $raw = @file_get_contents($archivo);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) return false;

    foreach (array('names', 'scores') as $donde) {
      if (empty($data[$donde]) || !is_array($data[$donde])) continue;
      foreach ($data[$donde] as $ownerId => $info) {
        if (!is_array($info) || !isset($info['name'])) continue;
        if ((string) $ownerId === '' || (string) $ownerId === $deviceId) continue;
        if (nombreNormalizado($info['name']) === $needle) return true;
      }
    }
    return false;
  }

  /** El nombre que este dispositivo ya tiene anotado, o '' si no tiene. */
  function nombreYaAnotado($deviceId) {
    $deviceId = (string) $deviceId;
    if ($deviceId === '') return '';

    $archivo = toppingsDataFile('run-leaderboard.json');
    if (file_exists($archivo)) {
      $raw = @file_get_contents($archivo);
      $data = $raw ? json_decode($raw, true) : null;
      if (is_array($data)) {
        foreach (array('names', 'scores') as $donde) {
          if (!empty($data[$donde][$deviceId]['name'])) return (string) $data[$donde][$deviceId]['name'];
        }
      }
    }
    if (function_exists('customersRead')) {
      $c = customersRead();
      if (!empty($c['customers'][$deviceId]['name'])) return (string) $c['customers'][$deviceId]['name'];
    }
    return '';
  }

  /**
   * ¿Puede este dispositivo usar este nombre al MANDAR PUNTAJE?
   *
   * Mandar puntaje es distinto de elegir nombre, y necesita su propia regla.
   *
   * Si se rechazara igual que las otras puertas, los nombres repetidos que
   * YA existen —de cuando esto era solo un aviso— dejarían a una de las dos
   * personas sin poder jugar, sin entender por qué.
   *
   * Pero dejarlo pasar sin más abre la puerta al revés: alguien podría
   * saltearse el aviso y CREAR un repetido nuevo mandando un puntaje.
   *
   * La regla que sirve para los dos casos: se acepta si este dispositivo YA
   * venía usando ese nombre. Quien lo tenía de antes sigue jugando; quien
   * recién lo intenta, no puede.
   */
  function puedeUsarNombreAlPuntuar($name, $deviceId) {
    if (!nombreTomadoPorOtro($name, $deviceId)) return true;
    return nombreNormalizado(nombreYaAnotado($deviceId)) === nombreNormalizado($name);
  }

  /**
   * El portero de las puertas donde alguien ELIGE o CAMBIA su nombre: el
   * saludo del inicio, el juego, la tarjeta y el renombrado.
   *
   * Devuelve el mensaje de error, o null si el nombre está libre.
   *
   * Mandar puntaje NO usa esta función — usa puedeUsarNombreAlPuntuar(), que
   * es más permisiva a propósito para no dejar sin jugar a los repetidos que
   * ya existían.
   */
  function nombreNoDisponible($name, $deviceId) {
    if (trim((string) $name) === '') return null;   // el vacío lo maneja cada acción
    return nombreTomadoPorOtro($name, $deviceId) ? 'Ese nombre ya está en uso.' : null;
  }

  /**
   * Los nombres que YA están repetidos. Existen porque hasta ahora la regla
   * era saltable; bloquear los nuevos no arregla los viejos, y sin poder
   * verlos el problema queda escondido.
   *
   * Devuelve: nombre => lista de dispositivos que lo usan.
   */
  function nombresRepetidos() {
    $porNombre = array();

    $agregar = function ($nombre, $deviceId, $origen) use (&$porNombre) {
        $k = nombreNormalizado($nombre);
        if ($k === '' || (string) $deviceId === '') return;
        if (!isset($porNombre[$k])) $porNombre[$k] = array('nombre' => trim((string) $nombre), 'dispositivos' => array());
        if (!isset($porNombre[$k]['dispositivos'][(string) $deviceId])) {
          $porNombre[$k]['dispositivos'][(string) $deviceId] = $origen;
        }
    };

    $clientes = function_exists('customersRead') ? customersRead() : array('customers' => array());
    if (!empty($clientes['customers']) && is_array($clientes['customers'])) {
      foreach ($clientes['customers'] as $id => $info) {
        if (is_array($info) && isset($info['name'])) $agregar($info['name'], $id, 'clientes');
      }
    }

    $archivo = toppingsDataFile('run-leaderboard.json');
    if (file_exists($archivo)) {
      $raw = @file_get_contents($archivo);
      $data = $raw ? json_decode($raw, true) : null;
      if (is_array($data)) {
        foreach (array('names', 'scores') as $donde) {
          if (empty($data[$donde]) || !is_array($data[$donde])) continue;
          foreach ($data[$donde] as $id => $info) {
            if (is_array($info) && isset($info['name'])) $agregar($info['name'], $id, $donde === 'names' ? 'ranking' : 'puntajes');
          }
        }
      }
    }

    $repetidos = array();
    foreach ($porNombre as $info) {
      if (count($info['dispositivos']) < 2) continue;
      $repetidos[] = array(
        'nombre' => $info['nombre'],
        'cuantos' => count($info['dispositivos']),
        'dispositivos' => array_keys($info['dispositivos']),
        'origenes' => array_values(array_unique(array_values($info['dispositivos']))),
      );
    }
    usort($repetidos, function ($a, $b) { return $b['cuantos'] - $a['cuantos']; });
    return $repetidos;
  }
}
