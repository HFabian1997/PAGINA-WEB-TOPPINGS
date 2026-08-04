<?php
/**
 * API del panel de administración de TOPPINGS — sin base de datos.
 * Guarda todo en admin/content.json (y regenera lib/manifest.js en cada
 * guardado) para que el panel funcione desde cualquier navegador — incluido
 * el celular — sin pedir una carpeta local.
 */
date_default_timezone_set('America/Bogota');

session_name('toppings_admin_sess');
session_set_cookie_params(array(
  'lifetime' => 60 * 60 * 24 * 30,
  'path' => '/',
  'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
  'httponly' => true,
  'samesite' => 'Lax',
));
session_start();

header('Content-Type: application/json; charset=utf-8');

$CONTENT_FILE = __DIR__ . '/../admin/content.json';
$MANIFEST_FILE = __DIR__ . '/../lib/manifest.js';
$WEBMANIFEST_FILE = __DIR__ . '/../manifest.webmanifest';
$ASSETS_DIR = __DIR__ . '/../assets/img';
$MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
$MAX_IMAGE_DIM = 2000;

function jsonOut($arr, $code = 200) {
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

/**
 * Lee content.json directamente — sin candado. Las escrituras son atómicas
 * (escriben a un archivo temporal y lo renombran encima), así que una
 * lectura nunca puede ver el archivo a medio escribir; el sistema de
 * archivos compartido de Hostinger no siempre respeta flock() en lecturas,
 * así que apoyarse solo en locks para lecturas causaba lecturas a medias.
 */
function readContent() {
  global $CONTENT_FILE;
  if (!file_exists($CONTENT_FILE)) return array();
  $raw = @file_get_contents($CONTENT_FILE);
  $data = $raw ? json_decode($raw, true) : null;
  return is_array($data) ? $data : array();
}

/** Escribe a un archivo temporal y lo renombra encima del original: nunca deja el archivo a medias. */
function writeContentAtomic($data) {
  global $CONTENT_FILE;
  $dir = dirname($CONTENT_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $tmp = $CONTENT_FILE . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
  if (@file_put_contents($tmp, $json) === false) return false;
  if (!@rename($tmp, $CONTENT_FILE)) { @unlink($tmp); return false; }
  return true;
}

/**
 * Serializa lecturas-modificación-escritura con un archivo de candado aparte
 * (dos primeros-ingresos, o dos guardados, al mismo tiempo no deben pisarse).
 * $callback($data) debe devolver el nuevo contenido a guardar, o null si no
 * hay que escribir nada.
 */
function withContentLock($write, $callback) {
  global $CONTENT_FILE;
  $dir = dirname($CONTENT_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $lockFp = @fopen($dir . '/content.lock', 'c');
  if (!$lockFp) jsonOut(array('ok' => false, 'error' => 'No se pudo bloquear el contenido.'), 500);

  flock($lockFp, $write ? LOCK_EX : LOCK_SH);
  $data = readContent();
  $result = $callback($data);
  if ($write && is_array($result)) writeContentAtomic($result);
  flock($lockFp, LOCK_UN);
  fclose($lockFp);
  return is_array($result) ? $result : $data;
}

function requireAuth() {
  if (empty($_SESSION['authed'])) jsonOut(array('ok' => false, 'error' => 'No has iniciado sesión.'), 401);
}

/**
 * El manifest de la aplicación: lo que lee el celular cuando alguien agrega
 * TOPPINGS a su pantalla de inicio (nombre, colores y, sobre todo, el icono).
 *
 * Se genera desde content.json en cada guardado, igual que lib/manifest.js,
 * para que Fabián pueda cambiar el icono desde el panel sin tocar archivos.
 *
 * Ojo con los iconos: el celular los quiere CUADRADOS y del tamaño exacto que
 * se declara. Si se le pasa una foto rectangular diciendo que mide 512x512,
 * Android la estira o la recorta y queda horrible — que es justo lo que
 * pasaba antes. Por eso upload-app-icon los genera cuadrados de verdad.
 *
 * "maskable" es una segunda versión con más aire alrededor: Android recorta
 * el icono en círculo o en cuadrado redondeado según el celular, y sin ese
 * margen se come los bordes del logo.
 */
function buildWebManifest($content) {
  $b = isset($content['business']) && is_array($content['business']) ? $content['business'] : array();
  $nombre = isset($b['name']) && $b['name'] !== '' ? (string) $b['name'] : 'TOPPINGS';
  $lema = isset($b['tagline']) ? (string) $b['tagline'] : '';

  $c = isset($content['customization']) && is_array($content['customization']) ? $content['customization'] : array();
  $fondo = isset($c['backgroundColor']) && $c['backgroundColor'] !== '' ? (string) $c['backgroundColor'] : '#111111';

  $icono = isset($b['appIcon']) && is_array($b['appIcon']) ? $b['appIcon'] : array();
  $sello = isset($icono['updatedAt']) ? (int) $icono['updatedAt'] : 0;
  // el sello al final obliga al celular a volver a bajarlo cuando lo cambia;
  // si no, se queda con el de antes guardado quién sabe cuánto tiempo
  $v = $sello ? ('?v=' . $sello) : '';

  $iconos = array();
  if (!empty($icono['any192']))      $iconos[] = array('src' => $icono['any192'] . $v,      'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any');
  if (!empty($icono['any512']))      $iconos[] = array('src' => $icono['any512'] . $v,      'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any');
  if (!empty($icono['maskable192'])) $iconos[] = array('src' => $icono['maskable192'] . $v, 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'maskable');
  if (!empty($icono['maskable512'])) $iconos[] = array('src' => $icono['maskable512'] . $v, 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable');

  /* Mientras no haya subido un icono propio se usa el logo, pero declarando
     "any" en vez de inventarle un tamaño. Decir que un logo de 700x467 mide
     512x512 es lo que hacía que Android lo estirara y quedara feo. */
  if (!count($iconos) && !empty($b['logo'])) {
    $iconos[] = array('src' => (string) $b['logo'], 'sizes' => 'any', 'purpose' => 'any');
  }

  $m = array(
    'name' => $nombre,
    'short_name' => function_exists('mb_substr') ? mb_substr($nombre, 0, 12) : substr($nombre, 0, 12),
    'description' => $lema,
    'start_url' => '/?fuente=inicio',
    'scope' => '/',
    'display' => 'standalone',
    'orientation' => 'portrait',
    'background_color' => $fondo,
    'theme_color' => $fondo,
    'lang' => 'es-CO',
    'icons' => $iconos,
  );
  return json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
}

function buildManifestJs($content) {
  // manifest.js es público: nunca debe incluir datos secretos.
  $public = $content;
  unset($public['business']['adminSecret']);
  unset($public['deliverySettings']['pin']);
  return "(function () {\n  \"use strict\";\n  window.__BRAND__ = " .
    json_encode($public, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) .
    ";\n})();\n";
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {

  case 'check': {
    $data = readContent();
    $secret = isset($data['business']['adminSecret']) ? trim((string) $data['business']['adminSecret']) : '';
    jsonOut(array('ok' => true, 'authed' => !empty($_SESSION['authed']), 'hasPassword' => $secret !== ''));
  }

  case 'login': {
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = array();
    $password = isset($body['password']) ? trim((string) $body['password']) : '';
    if ($password === '') jsonOut(array('ok' => false, 'error' => 'Escribe una clave.'), 400);

    // Todo el "¿ya hay clave? si no, la que escribas ahora queda guardada"
    // ocurre DENTRO del candado exclusivo, para que dos primeros-ingresos al
    // mismo tiempo (por ejemplo desde dos celulares) no se pisen entre sí.
    $secret = null;
    $bootstrapped = false;
    withContentLock(true, function ($data) use ($password, &$secret, &$bootstrapped) {
      $current = isset($data['business']['adminSecret']) ? trim((string) $data['business']['adminSecret']) : '';
      if ($current === '') {
        if (!isset($data['business']) || !is_array($data['business'])) $data['business'] = array();
        $data['business']['adminSecret'] = $password;
        $secret = $password;
        $bootstrapped = true;
        return $data;
      }
      $secret = $current;
      return null;
    });

    if ($bootstrapped) {
      session_regenerate_id(true);
      $_SESSION['authed'] = true;
      jsonOut(array('ok' => true, 'created' => true));
    }

    if (!hash_equals($secret, $password)) jsonOut(array('ok' => false, 'error' => 'Clave incorrecta.'), 403);
    session_regenerate_id(true);
    $_SESSION['authed'] = true;
    jsonOut(array('ok' => true));
  }

  case 'logout': {
    $_SESSION = array();
    session_destroy();
    jsonOut(array('ok' => true));
  }

  case 'get-content': {
    requireAuth();
    jsonOut(array('ok' => true, 'content' => readContent()));
  }

  case 'save-content': {
    requireAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    $raw = file_get_contents('php://input');
    $incoming = json_decode($raw, true);
    if (!is_array($incoming)) jsonOut(array('ok' => false, 'error' => 'Contenido inválido.'), 400);

    withContentLock(true, function ($data) use ($incoming) { return $incoming; });

    $manifest = buildManifestJs($incoming);
    $manifestTmp = $GLOBALS['MANIFEST_FILE'] . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($manifestTmp, $manifest) === false || !@rename($manifestTmp, $GLOBALS['MANIFEST_FILE'])) {
      @unlink($manifestTmp);
      jsonOut(array('ok' => false, 'error' => 'No se pudo actualizar la página pública.'), 500);
    }

    /* El manifest de la app se rearma también. Si esto falla no se corta el
       guardado: el contenido ya quedó bien y lo único que pasa es que el
       icono de la app sigue como estaba hasta el próximo guardado. */
    $wm = buildWebManifest($incoming);
    $wmFile = $GLOBALS['WEBMANIFEST_FILE'];
    $wmTmp = $wmFile . '.tmp-' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($wmTmp, $wm) === false || !@rename($wmTmp, $wmFile)) @unlink($wmTmp);

    jsonOut(array('ok' => true));
  }

  case 'upload-image': {
    requireAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    if (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
      jsonOut(array('ok' => false, 'error' => 'No se recibió ninguna imagen.'), 400);
    }
    $tmp = $_FILES['image']['tmp_name'];
    $size = filesize($tmp);
    if ($size === false || $size > $MAX_UPLOAD_BYTES) {
      jsonOut(array('ok' => false, 'error' => 'La imagen pesa demasiado (máximo 15MB).'), 400);
    }
    $info = @getimagesize($tmp);
    if (!$info) jsonOut(array('ok' => false, 'error' => 'El archivo no es una imagen válida.'), 400);
    list($width, $height, $type) = $info;
    $allowed = array(IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF);
    if (!in_array($type, $allowed, true)) {
      jsonOut(array('ok' => false, 'error' => 'Formato de imagen no soportado.'), 400);
    }

    switch ($type) {
      case IMAGETYPE_JPEG: $img = @imagecreatefromjpeg($tmp); break;
      case IMAGETYPE_PNG:  $img = @imagecreatefrompng($tmp); break;
      case IMAGETYPE_WEBP: $img = @imagecreatefromwebp($tmp); break;
      case IMAGETYPE_GIF:  $img = @imagecreatefromgif($tmp); break;
      default: $img = false;
    }
    if (!$img) jsonOut(array('ok' => false, 'error' => 'No se pudo procesar la imagen.'), 500);

    // Las fotos de celular traen la rotación en los metadatos EXIF, no en los
    // píxeles — sin esto, muchas fotos subidas desde el celular saldrían de lado.
    if ($type === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
      $exif = @exif_read_data($tmp);
      $orientation = $exif && isset($exif['Orientation']) ? $exif['Orientation'] : 1;
      if ($orientation === 3) { $img = imagerotate($img, 180, 0); }
      elseif ($orientation === 6) { $img = imagerotate($img, -90, 0); list($width, $height) = array($height, $width); }
      elseif ($orientation === 8) { $img = imagerotate($img, 90, 0); list($width, $height) = array($height, $width); }
    }

    imagepalettetotruecolor($img);
    imagealphablending($img, true);
    imagesavealpha($img, true);

    if ($width > $MAX_IMAGE_DIM || $height > $MAX_IMAGE_DIM) {
      $scale = min($MAX_IMAGE_DIM / $width, $MAX_IMAGE_DIM / $height);
      $newW = max(1, (int) round($width * $scale));
      $newH = max(1, (int) round($height * $scale));
      $resized = imagecreatetruecolor($newW, $newH);
      imagealphablending($resized, false);
      imagesavealpha($resized, true);
      imagecopyresampled($resized, $img, 0, 0, 0, 0, $newW, $newH, $width, $height);
      imagedestroy($img);
      $img = $resized;
    }

    if (!is_dir($ASSETS_DIR)) @mkdir($ASSETS_DIR, 0755, true);
    $filename = 'img-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.webp';
    $path = $ASSETS_DIR . '/' . $filename;
    $ok = imagewebp($img, $path, 82);
    imagedestroy($img);
    if (!$ok) jsonOut(array('ok' => false, 'error' => 'No se pudo guardar la imagen.'), 500);

    jsonOut(array('ok' => true, 'path' => 'assets/img/' . $filename));
  }

  /**
   * El icono que se instala en el celular.
   *
   * A diferencia de upload-image, acá NO vale guardar la imagen tal cual: el
   * celular necesita cuadrados exactos de 192 y 512 píxeles. Se generan cuatro
   * PNG a partir de lo que suba Fabián:
   *
   *   any192 / any512            el logo con un poco de aire
   *   maskable192 / maskable512  el logo más chico, para que Android pueda
   *                              recortarlo en círculo sin comerse los bordes
   *
   * Se rellena el fondo con un color en vez de dejarlo transparente porque en
   * la pantalla de inicio un icono transparente queda con un cuadro blanco o
   * gris feo, según el celular.
   *
   * En PNG y no en WebP: el iPhone no toma WebP para el icono de inicio.
   */
  case 'upload-app-icon': {
    requireAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    if (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
      jsonOut(array('ok' => false, 'error' => 'No se recibió ninguna imagen.'), 400);
    }
    $tmp = $_FILES['image']['tmp_name'];
    $size = filesize($tmp);
    if ($size === false || $size > $MAX_UPLOAD_BYTES) {
      jsonOut(array('ok' => false, 'error' => 'La imagen pesa demasiado (máximo 15MB).'), 400);
    }
    $info = @getimagesize($tmp);
    if (!$info) jsonOut(array('ok' => false, 'error' => 'El archivo no es una imagen válida.'), 400);
    list($width, $height, $type) = $info;

    switch ($type) {
      case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($tmp); break;
      case IMAGETYPE_PNG:  $src = @imagecreatefrompng($tmp); break;
      case IMAGETYPE_WEBP: $src = @imagecreatefromwebp($tmp); break;
      case IMAGETYPE_GIF:  $src = @imagecreatefromgif($tmp); break;
      default: $src = false;
    }
    if (!$src) jsonOut(array('ok' => false, 'error' => 'Formato de imagen no soportado.'), 400);
    imagepalettetotruecolor($src);
    imagealphablending($src, true);
    imagesavealpha($src, true);

    // color de fondo que mandó el panel (#rrggbb), o el negro del sitio
    $hex = isset($_POST['bg']) ? trim((string) $_POST['bg']) : '';
    if (!preg_match('/^#?[0-9a-fA-F]{6}$/', $hex)) $hex = '111111';
    $hex = ltrim($hex, '#');
    $bgR = hexdec(substr($hex, 0, 2));
    $bgG = hexdec(substr($hex, 2, 2));
    $bgB = hexdec(substr($hex, 4, 2));
    $transparente = isset($_POST['transparente']) && $_POST['transparente'] === '1';

    if (!is_dir($ASSETS_DIR)) @mkdir($ASSETS_DIR, 0755, true);
    $sello = time();
    $base = 'app-icon-' . $sello;

    /**
     * Dibuja el logo centrado dentro de un cuadrado de $lado, ocupando
     * $ocupa de ancho (0.82 = con un poco de aire; 0.62 = con el margen que
     * necesita Android para recortarlo en círculo).
     */
    $hacer = function ($lado, $ocupa, $archivo) use ($src, $width, $height, $bgR, $bgG, $bgB, $transparente) {
      $lienzo = imagecreatetruecolor($lado, $lado);
      imagealphablending($lienzo, false);
      imagesavealpha($lienzo, true);
      if ($transparente) {
        imagefill($lienzo, 0, 0, imagecolorallocatealpha($lienzo, 0, 0, 0, 127));
      } else {
        imagefill($lienzo, 0, 0, imagecolorallocate($lienzo, $bgR, $bgG, $bgB));
      }
      imagealphablending($lienzo, true);

      // se encoge manteniendo la proporción: nunca se estira ni se recorta
      $cabe = $lado * $ocupa;
      $escala = min($cabe / $width, $cabe / $height);
      $w = max(1, (int) round($width * $escala));
      $h = max(1, (int) round($height * $escala));
      $x = (int) round(($lado - $w) / 2);
      $y = (int) round(($lado - $h) / 2);
      imagecopyresampled($lienzo, $src, $x, $y, 0, 0, $w, $h, $width, $height);

      imagesavealpha($lienzo, true);
      $ok = imagepng($lienzo, $archivo, 6);
      imagedestroy($lienzo);
      return $ok;
    };

    $salidas = array(
      'any192'      => array(192, 0.82),
      'any512'      => array(512, 0.82),
      'maskable192' => array(192, 0.62),
      'maskable512' => array(512, 0.62),
    );
    $rutas = array();
    foreach ($salidas as $clave => $cfg) {
      $nombre = $base . '-' . $clave . '.png';
      if (!$hacer($cfg[0], $cfg[1], $ASSETS_DIR . '/' . $nombre)) {
        imagedestroy($src);
        jsonOut(array('ok' => false, 'error' => 'No se pudo generar el icono.'), 500);
      }
      $rutas[$clave] = 'assets/img/' . $nombre;
    }
    imagedestroy($src);

    $rutas['bg'] = $transparente ? 'transparente' : ('#' . $hex);
    $rutas['updatedAt'] = $sello;
    jsonOut(array('ok' => true, 'appIcon' => $rutas));
  }

  case 'upload-audio': {
    requireAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    if (empty($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
      jsonOut(array('ok' => false, 'error' => 'No se recibió ningún archivo de audio.'), 400);
    }
    $MAX_AUDIO_BYTES = 15 * 1024 * 1024;
    $tmp = $_FILES['audio']['tmp_name'];
    $size = filesize($tmp);
    if ($size === false || $size > $MAX_AUDIO_BYTES) {
      jsonOut(array('ok' => false, 'error' => 'El audio pesa demasiado (máximo 15MB).'), 400);
    }
    $origName = isset($_FILES['audio']['name']) ? $_FILES['audio']['name'] : 'audio';
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $allowedExt = array('mp3', 'ogg', 'wav', 'm4a');
    if (!in_array($ext, $allowedExt, true)) {
      jsonOut(array('ok' => false, 'error' => 'Formato de audio no soportado (usa mp3, ogg, wav o m4a).'), 400);
    }
    $finfo = @finfo_open(FILEINFO_MIME_TYPE);
    $mime = $finfo ? @finfo_file($finfo, $tmp) : '';
    if ($finfo) finfo_close($finfo);
    if ($mime && strpos($mime, 'audio/') !== 0 && $mime !== 'application/octet-stream') {
      jsonOut(array('ok' => false, 'error' => 'El archivo no parece ser un audio válido.'), 400);
    }

    $audioDir = __DIR__ . '/../assets/audio';
    if (!is_dir($audioDir)) @mkdir($audioDir, 0755, true);
    $filename = 'music-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
    $path = $audioDir . '/' . $filename;
    if (!@move_uploaded_file($tmp, $path)) {
      jsonOut(array('ok' => false, 'error' => 'No se pudo guardar el audio.'), 500);
    }

    jsonOut(array('ok' => true, 'path' => 'assets/audio/' . $filename));
  }

  case 'upload-knowledge-doc': {
    requireAuth();
    if ($method !== 'POST') jsonOut(array('ok' => false, 'error' => 'Método no permitido.'), 405);
    if (empty($_FILES['doc']) || $_FILES['doc']['error'] !== UPLOAD_ERR_OK) {
      jsonOut(array('ok' => false, 'error' => 'No se recibió ningún documento.'), 400);
    }
    $MAX_DOC_BYTES = 8 * 1024 * 1024;
    $tmp = $_FILES['doc']['tmp_name'];
    $size = filesize($tmp);
    if ($size === false || $size > $MAX_DOC_BYTES) {
      jsonOut(array('ok' => false, 'error' => 'El documento pesa demasiado (máximo 8MB).'), 400);
    }
    $origName = isset($_FILES['doc']['name']) ? $_FILES['doc']['name'] : 'documento';
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

    if ($ext === 'txt') {
      $text = @file_get_contents($tmp);
      if ($text === false) jsonOut(array('ok' => false, 'error' => 'No se pudo leer el archivo de texto.'), 500);
    } elseif ($ext === 'docx') {
      $text = extractDocxText($tmp);
      if ($text === null) jsonOut(array('ok' => false, 'error' => 'No se pudo leer ese archivo .docx.'), 400);
    } elseif ($ext === 'pdf') {
      $text = extractPdfText($tmp);
      if ($text === null || trim($text) === '') {
        jsonOut(array('ok' => false, 'error' => 'No se pudo extraer texto de ese PDF (si es un PDF escaneado/imagen, prueba subiendo un .docx o .txt en su lugar).'), 400);
      }
    } else {
      jsonOut(array('ok' => false, 'error' => 'Formato no soportado. Usa .txt, .docx o .pdf.'), 400);
    }

    $text = trim(preg_replace("/[ \t]+/", ' ', preg_replace("/\n{3,}/", "\n\n", $text)));
    $MAX_TEXT_CHARS = 20000;
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
      if (mb_strlen($text) > $MAX_TEXT_CHARS) $text = mb_substr($text, 0, $MAX_TEXT_CHARS) . "\n[...documento recortado por longitud...]";
    } elseif (strlen($text) > $MAX_TEXT_CHARS) {
      $text = substr($text, 0, $MAX_TEXT_CHARS) . "\n[...documento recortado por longitud...]";
    }
    if (trim($text) === '') jsonOut(array('ok' => false, 'error' => 'El documento no tiene texto que se pueda leer.'), 400);

    jsonOut(array('ok' => true, 'text' => $text, 'name' => $origName));
  }

  default:
    jsonOut(array('ok' => false, 'error' => 'Acción no reconocida.'), 400);
}

/** Un .docx es un .zip con el texto en word/document.xml. */
function extractDocxText($path) {
  if (!class_exists('ZipArchive')) return null;
  $zip = new ZipArchive();
  if ($zip->open($path) !== true) return null;
  $xml = $zip->getFromName('word/document.xml');
  $zip->close();
  if ($xml === false) return null;

  $xml = str_replace(array('</w:p>', '<w:tab/>', '<w:tab />'), array("\n", "\t", "\t"), $xml);
  $xml = preg_replace('/<w:br\s*\/?>/', "\n", $xml);
  $text = strip_tags($xml);
  $text = html_entity_decode($text, ENT_QUOTES | ENT_XML1, 'UTF-8');
  return $text;
}

/** Extractor de texto de PDF hecho a mano (sin librerías externas, para que
 * funcione en hosting compartido sin Composer): infla los streams
 * comprimidos con FlateDecode (con la función nativa gzuncompress) y saca
 * el texto de los operadores Tj/TJ/' de cada "content stream". No es
 * perfecto (no funciona con PDFs escaneados o con texto como imagen), pero
 * cubre bien los documentos de texto normales (Word/Google Docs a PDF). */
function extractPdfText($path) {
  $bytes = @file_get_contents($path);
  if ($bytes === false) return null;

  $out = array();
  if (!preg_match_all('/<<(.*?)>>\s*stream\r?\n(.*?)\r?\n?endstream/s', $bytes, $matches, PREG_SET_ORDER)) {
    return '';
  }

  foreach ($matches as $m) {
    $dict = $m[1];
    $stream = $m[2];
    if (strpos($dict, 'FlateDecode') !== false) {
      $inflated = @gzuncompress($stream);
      if ($inflated === false) continue;
      $stream = $inflated;
    } elseif (strpos($dict, 'Image') !== false || strpos($dict, '/Filter') !== false) {
      // otros filtros (imágenes, fuentes embebidas, etc.) no traen texto legible
      continue;
    }
    $out[] = pdfContentStreamToText($stream);
  }

  return implode("\n", array_filter($out, function ($s) { return trim($s) !== ''; }));
}

function pdfUnescapeString($s) {
  $map = array('\\n' => "\n", '\\r' => "\r", '\\t' => "\t", '\\(' => '(', '\\)' => ')', '\\\\' => '\\');
  $s = strtr($s, $map);
  $s = preg_replace_callback('/\\\\([0-7]{1,3})/', function ($mm) { return chr(octdec($mm[1]) & 0xFF); }, $s);
  return $s;
}

function pdfContentStreamToText($stream) {
  $pieces = array();

  // Texto simple: (cadena) Tj  ó  (cadena) '
  if (preg_match_all('/\(((?:\\\\.|[^()\\\\])*)\)\s*(?:Tj|\')/s', $stream, $mm)) {
    foreach ($mm[1] as $s) $pieces[] = array('pos' => strpos($stream, $s), 'text' => pdfUnescapeString($s));
  }
  // Texto en arreglo: [ (cadena) -120 (cadena2) ... ] TJ
  if (preg_match_all('/\[((?:[^\[\]])*)\]\s*TJ/s', $stream, $arr)) {
    foreach ($arr[1] as $idx => $group) {
      if (preg_match_all('/\(((?:\\\\.|[^()\\\\])*)\)/s', $group, $inner)) {
        $joined = implode('', array_map('pdfUnescapeString', $inner[1]));
        $pos = strpos($stream, $arr[0][$idx]);
        $pieces[] = array('pos' => $pos, 'text' => $joined);
      }
    }
  }

  usort($pieces, function ($a, $b) { return $a['pos'] - $b['pos']; });
  $lines = array();
  foreach ($pieces as $p) {
    $t = trim($p['text']);
    if ($t !== '') $lines[] = $t;
  }
  return implode("\n", $lines);
}
