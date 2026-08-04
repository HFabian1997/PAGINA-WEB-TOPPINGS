/* TOPPINGS · service worker
 *
 * Su único trabajo por ahora es recibir las notificaciones del celular y
 * abrirlas donde corresponde. NO guarda copias de la página: el sitio cambia
 * seguido desde el panel y una copia vieja haría que Fabián publique algo y
 * los clientes sigan viendo lo de ayer.
 *
 * Vive en la raíz a propósito: un service worker solo manda sobre las páginas
 * que están en su carpeta o más adentro, y desde /sw.js alcanza a las cinco.
 */

var VERSION = "toppings-sw-1";

/* El deviceId viaja en la dirección con la que se registró el worker
   (/sw.js?d=d_xxx). Acá adentro no hay localStorage, y sin el deviceId no
   podríamos volver a registrar el aparato cuando el navegador rote sus
   llaves. */
var DEVICE_ID = new URL(self.location.href).searchParams.get("d") || "";

self.addEventListener("install", function () {
  // sin copias que preparar: entra a mandar de una
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/* ---------------- llega una notificación ---------------- */

self.addEventListener("push", function (event) {
  var datos = null;
  try { datos = event.data ? event.data.json() : null; } catch (e) { datos = null; }

  /* Si el servidor no pudo cifrar el texto, la push llega vacía. En ese caso
     hay que ir a buscarlo: el navegador OBLIGA a mostrar algo, y si no
     mostramos nada nos quita el permiso de push. */
  if (!datos) {
    event.waitUntil(
      fetch("/api/notifications.php?action=push-pending", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var n = (res && res.ok && res.item) || null;
          return mostrar(n || { title: "TOPPINGS 🍟", body: "Tienes un aviso nuevo.", url: "/" });
        })
        .catch(function () {
          return mostrar({ title: "TOPPINGS 🍟", body: "Tienes un aviso nuevo.", url: "/" });
        })
    );
    return;
  }

  event.waitUntil(mostrar(datos));
});

function mostrar(d) {
  var titulo = d.title || "TOPPINGS 🍟";
  var opciones = {
    body: d.body || "",
    // el icono lo manda el servidor (es el logo que Fabián tenga puesto); si
    // no llega, el navegador pone el suyo por defecto y no pasa nada
    icon: d.icon || undefined,
    badge: d.badge || undefined,
    // el tag hace que un aviso repetido REEMPLACE al anterior en vez de
    // amontonarse; es media defensa contra llenarle la pantalla al cliente
    tag: d.tag || "toppings",
    renotify: !!d.renotify,
    requireInteraction: false,
    data: { url: d.url || "/", tipo: d.tipo || null, ref: d.ref || null }
  };
  return self.registration.showNotification(titulo, opciones);
}

/* ---------------- el cliente toca la notificación ---------------- */

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var d = event.notification.data || {};
  var destino = d.url || "/";

  /* Importante: tocar la notificación NO reclama nada ni abre la ruleta sola.
     Solo lleva a la sección y la deja resaltada; el cliente decide. */
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
      // si ya tiene TOPPINGS abierto, se reusa esa pestaña
      for (var i = 0; i < lista.length; i++) {
        var c = lista[i];
        if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) {
          c.postMessage({ tipo: "toppings-push-click", destino: destino, ref: d.ref, que: d.tipo });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});

/* Si el navegador rota las llaves del aparato, hay que volver a registrarlo o
   las notificaciones dejan de llegar sin que nadie se entere. */
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    self.registration.pushManager.getSubscription()
      .then(function (sub) {
        if (!sub) return null;
        return fetch("/api/push.php?action=subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ deviceId: DEVICE_ID, subscription: sub.toJSON() })
        });
      })
      .catch(function () {})
  );
});
