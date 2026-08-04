<?php
/**
 * Dónde viven los datos del negocio.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El despliegue de Hostinger (`hosting_deployStaticWebsite`) no superpone
 * archivos: REEMPLAZA public_html entero. Todo lo que no vaya dentro del
 * paquete desaparece del servidor.
 *
 * Los datos vivían en `api/data/`, o sea dentro de public_html, y como no
 * viajan en el paquete (son de los clientes, no del código), cada despliegue
 * los borraba: la ruleta quedaba sin premios, el registro de clientes vacío y
 * los códigos perdidos. Comprobado el 2026-08-04 registrando dos nombres,
 * desplegando y viendo que volvían a figurar libres.
 *
 * La solución es sacarlos de public_html. Una carpeta hermana no la toca el
 * despliegue, así que ahí quedan a salvo pase lo que pase con el código.
 *
 *   .../domains/<dominio>/
 *       public_html/          <- lo que el despliegue reemplaza
 *       toppings-data/        <- acá viven los datos, intactos
 *
 * Si por lo que sea no se puede escribir afuera (otro hosting, permisos), se
 * sigue usando la carpeta de siempre: es mejor funcionar con el riesgo viejo
 * que romperse.
 */

if (!function_exists('toppingsDataDir')) {

  /** Los archivos que se traen de la ubicación vieja la primera vez. */
  function toppingsDataArchivos() {
    return array(
      'run-leaderboard.json', 'premio.json', 'ruleta.json', 'prize-codes.json',
      'redeem-codes.json', 'stoptime.json', 'customers.json', 'notifications.json',
      'presence.json', 'page-editor.json', 'assistant-throttle.json',
    );
  }

  function toppingsDataDirVieja() { return __DIR__ . '/data'; }

  /**
   * Devuelve la carpeta de datos, ya creada y comprobada. Se resuelve una sola
   * vez por petición.
   */
  function toppingsDataDir() {
    static $dir = null;
    if ($dir !== null) return $dir;

    $vieja = toppingsDataDirVieja();

    // hermana de public_html: el despliegue no llega hasta acá
    $afuera = dirname(dirname(__DIR__)) . '/toppings-data';

    if (!is_dir($afuera)) @mkdir($afuera, 0755, true);

    if (is_dir($afuera) && is_writable($afuera)) {
      toppingsDataMigrar($vieja, $afuera);
      $dir = $afuera;
    } else {
      // no se pudo salir de public_html: se sigue como antes
      if (!is_dir($vieja)) @mkdir($vieja, 0755, true);
      $dir = $vieja;
    }
    return $dir;
  }

  /**
   * Trae lo que haya quedado en la carpeta vieja, una sola vez.
   *
   * Solo copia lo que NO exista ya afuera: si el archivo nuevo existe, manda
   * ese. Así no se pisa lo bueno con una sobra vieja.
   */
  function toppingsDataMigrar($vieja, $nueva) {
    $marca = $nueva . '/.migrado';
    if (file_exists($marca)) return;
    if (!is_dir($vieja)) { @file_put_contents($marca, date('c')); return; }

    foreach (toppingsDataArchivos() as $nombre) {
      $origen = $vieja . '/' . $nombre;
      $destino = $nueva . '/' . $nombre;
      if (!file_exists($origen) || file_exists($destino)) continue;
      $contenido = @file_get_contents($origen);
      if ($contenido === false) continue;
      // se escribe con el mismo cuidado que el resto: temporal + rename
      $tmp = $destino . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
      if (@file_put_contents($tmp, $contenido) !== false) {
        if (!@rename($tmp, $destino)) @unlink($tmp);
      }
    }
    @file_put_contents($marca, date('c'));
  }

  /** Ruta completa de un archivo de datos. */
  function toppingsDataFile($nombre) {
    return toppingsDataDir() . '/' . $nombre;
  }

  /**
   * Los .lock van SIEMPRE junto a los datos: un candado en otra carpeta no
   * protege nada si dos procesos usan carpetas distintas.
   */
  function toppingsLockFile($nombre) {
    return toppingsDataDir() . '/' . $nombre;
  }

  /** Para el diagnóstico: ¿quedaron a salvo del despliegue o no? */
  function toppingsDataAfuera() {
    return toppingsDataDir() !== toppingsDataDirVieja();
  }
}
