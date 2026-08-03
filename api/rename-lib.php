<?php
/**
 * Cuando un cliente se cambia el nombre, ese cambio tiene que verse en TODAS
 * las pantallas del panel, no solo en el ranking.
 *
 * Hasta ahora el cambio llegaba a dos sitios (premio.php y
 * run-leaderboard.php), pero el libro de premios, los canjes de códigos, los
 * tiros de la ruleta y los intentos de "Detén el tiempo" guardaban el nombre
 * tal como estaba cuando ocurrieron. Por eso en "Validar / Entregar premios"
 * seguía saliendo el nombre viejo.
 *
 * Se reescribe el histórico a propósito: el nombre acá no es un registro
 * contable, es para que el mesero sepa a quién le entrega. Si el cliente ahora
 * se llama distinto, el mesero necesita ver el nombre de ahora.
 *
 * Cada archivo se toca con su propio candado, uno tras otro. No hay riesgo de
 * trabarse: ningún otro camino del código toma dos de estos candados a la vez,
 * así que no puede haber dos procesos esperándose en orden contrario.
 */

require_once __DIR__ . '/codes-lib.php';
require_once __DIR__ . '/ruleta-lib.php';
require_once __DIR__ . '/redeem-lib.php';
require_once __DIR__ . '/stoptime-lib.php';

if (!function_exists('renameInAllRecords')) {
  /** Devuelve cuántos registros cambió, por archivo (para poder verificarlo). */
  function renameInAllRecords($deviceId, $newName) {
    $deviceId = trim((string) $deviceId);
    $newName = trim((string) $newName);
    $cambios = array('prizeCodes' => 0, 'redeem' => 0, 'ruleta' => 0, 'stoptime' => 0);
    if ($deviceId === '' || $newName === '') return $cambios;

    // premios emitidos
    codesWithWriteLock(function ($state) use ($deviceId, $newName, &$cambios) {
      foreach ($state['codes'] as &$c) {
        if (isset($c['deviceId']) && $c['deviceId'] === $deviceId && (!isset($c['name']) || $c['name'] !== $newName)) {
          $c['name'] = $newName;
          $cambios['prizeCodes']++;
        }
      }
      unset($c);
      return $cambios['prizeCodes'] ? $state : null;
    });

    // canjes de códigos de premio
    redeemWithWriteLock(function ($state) use ($deviceId, $newName, &$cambios) {
      foreach ($state['redemptions'] as &$r) {
        if (isset($r['deviceId']) && $r['deviceId'] === $deviceId && (!isset($r['name']) || $r['name'] !== $newName)) {
          $r['name'] = $newName;
          $cambios['redeem']++;
        }
      }
      unset($r);
      return $cambios['redeem'] ? $state : null;
    });

    // tiros de la ruleta
    ruletaWithWriteLock(function ($state) use ($deviceId, $newName, &$cambios) {
      foreach ($state['tickets'] as &$t) {
        if (isset($t['deviceId']) && $t['deviceId'] === $deviceId && (!isset($t['name']) || $t['name'] !== $newName)) {
          $t['name'] = $newName;
          $cambios['ruleta']++;
        }
      }
      unset($t);
      return $cambios['ruleta'] ? $state : null;
    });

    // intentos de "Detén el tiempo"
    stWithWriteLock(function ($state) use ($deviceId, $newName, &$cambios) {
      foreach ($state['attempts'] as &$a) {
        if (isset($a['deviceId']) && $a['deviceId'] === $deviceId && (!isset($a['name']) || $a['name'] !== $newName)) {
          $a['name'] = $newName;
          $cambios['stoptime']++;
        }
      }
      unset($a);
      return $cambios['stoptime'] ? $state : null;
    });

    return $cambios;
  }
}
