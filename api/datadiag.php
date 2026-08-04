<?php
/**
 * ¿Dónde están guardados los datos y están a salvo del próximo despliegue?
 *
 * Existe para poder comprobarlo desde fuera sin entrar al panel. No devuelve
 * rutas absolutas ni contenido: solo si los datos quedaron fuera de
 * public_html, si se puede escribir ahí y cuántos archivos hay.
 */
date_default_timezone_set('America/Bogota');
require_once __DIR__ . '/data-path.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$dir = toppingsDataDir();
$afuera = toppingsDataAfuera();

$archivos = array();
foreach (toppingsDataArchivos() as $nombre) {
  $f = $dir . '/' . $nombre;
  if (file_exists($f)) $archivos[$nombre] = filesize($f);
}

echo json_encode(array(
  'ok' => true,
  // lo único que importa: "afuera" = el despliegue ya no puede borrarlos
  'ubicacion' => $afuera ? 'afuera de public_html' : 'DENTRO de public_html (en riesgo)',
  'aSalvo' => $afuera,
  'escribible' => is_writable($dir),
  'migrado' => file_exists($dir . '/.migrado'),
  'archivos' => $archivos,
), JSON_UNESCAPED_UNICODE);
