<?php
/**
 * Las notificaciones al celular se quitaron.
 *
 * Este archivo guardaba la llave privada de las push. Queda vacío a propósito:
 * el despliegue solo SUPERPONE archivos, nunca borra los que faltan, así que
 * la única forma de sacar la llave del servidor es mandar una versión sin
 * ella. Si se borrara el archivo, la copia con la llave se quedaría allá.
 *
 * Se puede eliminar de verdad entrando al administrador de archivos de
 * Hostinger, junto con api/push.php, api/webpush-lib.php,
 * api/push-subs-lib.php, api/data/push-subs.json y manifest.webmanifest.
 */
return array();
