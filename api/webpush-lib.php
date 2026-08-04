<?php
/**
 * Web Push estándar (VAPID + RFC 8291), en PHP puro y sin dependencias.
 *
 * No hace falta Firebase ni ningún servicio externo: cada navegador ya trae su
 * propio servidor de push (Chrome usa el de Google, Firefox el de Mozilla,
 * Safari el de Apple). Nosotros solo tenemos que:
 *
 *   1. Firmar un JWT con nuestra llave privada  -> cabecera Authorization
 *   2. Cifrar el mensaje con la llave del cliente -> cuerpo de la petición
 *   3. Hacer un POST al endpoint que nos dio el navegador
 *
 * Todo lo que hace falta viene en PHP 8: openssl_pkey_derive (ECDH),
 * hash_hkdf y openssl_encrypt con aes-128-gcm. pushCapacidades() lo comprueba
 * en el servidor de verdad, porque un hosting compartido podría traer OpenSSL
 * recortado.
 */

if (!function_exists('pushConfig')) {

  /* ---------------- utilidades ---------------- */

  /** base64 "de URL": sin +, sin / y sin los = del final. */
  function b64uEnc($bin) {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
  }
  function b64uDec($txt) {
    $txt = strtr((string) $txt, '-_', '+/');
    $resto = strlen($txt) % 4;
    if ($resto) $txt .= str_repeat('=', 4 - $resto);
    return base64_decode($txt);
  }

  function pushConfig() {
    static $cfg = null;
    if ($cfg === null) {
      $f = __DIR__ . '/push-config.php';
      $cfg = file_exists($f) ? require $f : array();
      if (!is_array($cfg)) $cfg = array();
    }
    return $cfg;
  }

  function pushHabilitado() {
    $c = pushConfig();
    return !empty($c['publicKey']) && !empty($c['privatePem']);
  }

  /** ¿Este servidor puede cifrar el contenido de las push? */
  function pushCapacidades() {
    return array(
      'openssl'      => function_exists('openssl_sign'),
      'ecdh'         => function_exists('openssl_pkey_derive'),
      'hkdf'         => function_exists('hash_hkdf'),
      'aesgcm'       => in_array('aes-128-gcm', openssl_get_cipher_methods(), true),
      'curl'         => function_exists('curl_init'),
      'configurado'  => pushHabilitado(),
    );
  }

  /** ¿Podemos mandar el texto dentro de la push, o toca mandarla vacía? */
  function pushPuedeCifrar() {
    $c = pushCapacidades();
    return $c['ecdh'] && $c['hkdf'] && $c['aesgcm'];
  }

  /* ---------------- firma VAPID ---------------- */

  /**
   * openssl_sign devuelve la firma en DER (una SEQUENCE con dos enteros), pero
   * un JWT ES256 la quiere "cruda": los 32 bytes de R pegados a los 32 de S.
   * Esta función hace esa traducción.
   */
  function derASimpleRS($der) {
    $pos = 0;
    if (!is_string($der) || strlen($der) < 8) return null;
    if (ord($der[$pos++]) !== 0x30) return null;      // SEQUENCE
    $len = ord($der[$pos++]);
    if ($len & 0x80) $pos += ($len & 0x7f);           // longitud larga: se salta

    $leerEntero = function () use ($der, &$pos) {
      if (ord($der[$pos++]) !== 0x02) return null;    // INTEGER
      $n = ord($der[$pos++]);
      $v = substr($der, $pos, $n);
      $pos += $n;
      // DER mete un 0x00 delante si el primer bit está prendido; se quita
      $v = ltrim($v, "\x00");
      return str_pad($v, 32, "\x00", STR_PAD_LEFT);   // y se rellena a 32
    };

    $r = $leerEntero();
    $s = $leerEntero();
    if ($r === null || $s === null) return null;
    return $r . $s;
  }

  /**
   * Arma la cabecera Authorization que le demuestra al servidor de push que
   * el mensaje sale de nosotros. Vale para todos los envíos al mismo origen
   * durante unas horas, así que se guarda en memoria por si mandamos muchas.
   */
  function vapidAuthHeader($endpoint) {
    static $cache = array();
    $partes = parse_url($endpoint);
    if (!$partes || empty($partes['host'])) return null;
    $origen = $partes['scheme'] . '://' . $partes['host'];
    $ahora = time();

    if (isset($cache[$origen]) && $cache[$origen]['exp'] > $ahora + 600) {
      return $cache[$origen]['header'];
    }

    $cfg = pushConfig();
    $exp = $ahora + 12 * 3600;   // 12 h; el máximo que aceptan es 24

    $header  = b64uEnc(json_encode(array('typ' => 'JWT', 'alg' => 'ES256')));
    $payload = b64uEnc(json_encode(array(
      'aud' => $origen,
      'exp' => $exp,
      'sub' => isset($cfg['subject']) ? $cfg['subject'] : 'mailto:admin@toppings',
    ), JSON_UNESCAPED_SLASHES));

    $porFirmar = $header . '.' . $payload;
    $llave = openssl_pkey_get_private($cfg['privatePem']);
    if (!$llave) return null;

    $firmaDer = '';
    if (!openssl_sign($porFirmar, $firmaDer, $llave, OPENSSL_ALGO_SHA256)) return null;
    $firma = derASimpleRS($firmaDer);
    if ($firma === null) return null;

    $jwt = $porFirmar . '.' . b64uEnc($firma);
    $h = 'vapid t=' . $jwt . ', k=' . $cfg['publicKey'];
    $cache[$origen] = array('exp' => $exp, 'header' => $h);
    return $h;
  }

  /* ---------------- cifrado del contenido ---------------- */

  /**
   * Cifra el mensaje para UN cliente concreto, con el esquema aes128gcm que
   * describe el RFC 8291.
   *
   * La idea: generamos un par de llaves de usar y tirar, lo combinamos con la
   * llave pública del cliente (ECDH) y de ahí sale una clave que solo su
   * navegador puede recalcular. Ni el servidor de Google ni nadie en el medio
   * puede leer el texto.
   */
  function pushCifrar($payload, $clientePubB64, $authSecretB64) {
    $clientePub = b64uDec($clientePubB64);
    $authSecret = b64uDec($authSecretB64);
    if (strlen($clientePub) !== 65 || strlen($authSecret) < 16) return null;

    // par de llaves de un solo uso
    $efimera = openssl_pkey_new(array(
      'curve_name' => 'prime256v1',
      'private_key_type' => OPENSSL_KEYTYPE_EC,
    ));
    if (!$efimera) return null;
    $detalles = openssl_pkey_get_details($efimera);
    if (!$detalles || !isset($detalles['ec']['x'], $detalles['ec']['y'])) return null;
    $efimeraPub = "\x04" . str_pad($detalles['ec']['x'], 32, "\x00", STR_PAD_LEFT)
                         . str_pad($detalles['ec']['y'], 32, "\x00", STR_PAD_LEFT);

    // el secreto compartido: lo mismo que va a calcular el navegador
    $pemCliente = ecPubDesdeCrudo($clientePub);
    if (!$pemCliente) return null;
    $compartido = openssl_pkey_derive($pemCliente, $efimera, 32);
    if (!$compartido) return null;

    // de ahí salen la clave y el nonce, tal como manda el RFC
    $info = "WebPush: info\x00" . $clientePub . $efimeraPub;
    $ikm  = hash_hkdf('sha256', $compartido, 32, $info, $authSecret);

    $salt  = random_bytes(16);
    $cek   = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt);

    // relleno mínimo: un 0x02 al final marca dónde termina el mensaje
    $conRelleno = $payload . "\x02";

    $tag = '';
    $cifrado = openssl_encrypt($conRelleno, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($cifrado === false) return null;

    // cabecera: salt(16) + tamaño de registro(4) + largo de la llave(1) + llave(65)
    $cabecera = $salt . pack('N', 4096) . chr(strlen($efimeraPub)) . $efimeraPub;
    return $cabecera . $cifrado . $tag;
  }

  /**
   * OpenSSL no acepta los 65 bytes crudos de una llave pública EC: hay que
   * envolverlos en DER. Como el prefijo para prime256v1 siempre es el mismo,
   * se pega tal cual y listo.
   */
  function ecPubDesdeCrudo($crudo) {
    $prefijo = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01" .
               "\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00";
    $pem = "-----BEGIN PUBLIC KEY-----\n" .
           chunk_split(base64_encode($prefijo . $crudo), 64, "\n") .
           "-----END PUBLIC KEY-----\n";
    $k = openssl_pkey_get_public($pem);
    return $k ? $k : null;
  }

  /* ---------------- el envío ---------------- */

  /**
   * Manda una push a UNA suscripción.
   *
   * Devuelve array('ok'=>bool, 'code'=>int, 'muerta'=>bool). "muerta" en true
   * significa que esa suscripción ya no existe (el cliente desinstaló, borró
   * los datos o revocó el permiso) y hay que sacarla de la lista.
   */
  function pushEnviar($sub, $datos, $ttl = 86400) {
    if (!pushHabilitado()) return array('ok' => false, 'code' => 0, 'muerta' => false, 'error' => 'sin llaves');
    $endpoint = isset($sub['endpoint']) ? $sub['endpoint'] : '';
    if ($endpoint === '') return array('ok' => false, 'code' => 0, 'muerta' => true, 'error' => 'sin endpoint');

    $auth = vapidAuthHeader($endpoint);
    if (!$auth) return array('ok' => false, 'code' => 0, 'muerta' => false, 'error' => 'no se pudo firmar');

    $cabeceras = array(
      'Authorization: ' . $auth,
      'TTL: ' . (int) $ttl,
      'Urgency: normal',
    );
    $cuerpo = '';

    $p256 = isset($sub['p256dh']) ? $sub['p256dh'] : '';
    $authS = isset($sub['auth']) ? $sub['auth'] : '';

    if ($p256 !== '' && $authS !== '' && pushPuedeCifrar()) {
      $cuerpo = pushCifrar(json_encode($datos, JSON_UNESCAPED_UNICODE), $p256, $authS);
      if ($cuerpo === null) return array('ok' => false, 'code' => 0, 'muerta' => false, 'error' => 'no se pudo cifrar');
      $cabeceras[] = 'Content-Encoding: aes128gcm';
      $cabeceras[] = 'Content-Type: application/octet-stream';
      $cabeceras[] = 'Content-Length: ' . strlen($cuerpo);
    } else {
      /* Sin cifrado mandamos la push vacía; el service worker le pide el texto
         al servidor al recibirla. Llega igual, solo que un pelo más lenta. */
      $cabeceras[] = 'Content-Length: 0';
    }

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, array(
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => $cuerpo,
      CURLOPT_HTTPHEADER => $cabeceras,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 10,
      CURLOPT_CONNECTTIMEOUT => 5,
    ));
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errC = curl_error($ch);
    curl_close($ch);

    // 404/410 = esa suscripción ya no existe. 201/202 = aceptada.
    $muerta = ($code === 404 || $code === 410);
    return array(
      'ok' => ($code >= 200 && $code < 300),
      'code' => $code,
      'muerta' => $muerta,
      'error' => $errC !== '' ? $errC : (($code >= 300) ? substr((string) $resp, 0, 200) : null),
    );
  }
}
