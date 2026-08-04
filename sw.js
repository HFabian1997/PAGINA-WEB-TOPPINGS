/* TOPPINGS · service worker — DESACTIVADO
 *
 * Las notificaciones al celular se probaron y se quitaron.
 *
 * Este archivo no se puede borrar sin más: un service worker se queda
 * GUARDADO en el navegador de quien haya entrado mientras estuvo activo, y
 * sigue corriendo aunque el archivo desaparezca del servidor. Si lo
 * borráramos, el navegador se quedaría con la copia vieja para siempre.
 *
 * Por eso queda esta versión, que lo único que hace es desinstalarse a sí
 * misma y borrar todo lo que hubiera guardado. Se puede eliminar de verdad
 * dentro de unos meses, cuando ya no quede nadie con la versión anterior.
 */

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    Promise.all([
      // por si alguna versión anterior dejó algo guardado
      caches.keys().then(function (nombres) {
        return Promise.all(nombres.map(function (n) { return caches.delete(n); }));
      }).catch(function () {}),

      // y se da de baja de las notificaciones antes de irse
      self.registration.pushManager.getSubscription()
        .then(function (sub) { return sub ? sub.unsubscribe() : null; })
        .catch(function () {}),
    ]).then(function () {
      return self.registration.unregister();
    }).then(function () {
      // se recargan las pestañas abiertas para que dejen de estar bajo su control
      return self.clients.matchAll({ type: "window" });
    }).then(function (clientes) {
      clientes.forEach(function (c) { if (c.navigate) c.navigate(c.url); });
    }).catch(function () {})
  );
});
