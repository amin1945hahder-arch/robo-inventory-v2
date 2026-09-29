/* RoboShelf service worker — pushes for the wrapped APK/EXE apps and PWA.
 * The app posts { type: "SHOW_NOTIFICATION", title, body, tag } messages here;
 * real server pushes arrive via the standard "push" event (VAPID web-push). */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SHOW_NOTIFICATION" && self.registration.showNotification) {
    self.registration.showNotification(data.title || "RoboShelf", {
      body: data.body || "",
      tag: data.tag || "roboshelf",
      renotify: Boolean(data.renotify),
      icon: "/logo.svg",
      badge: "/logo.svg",
      data: { url: data.url || "/" },
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// Real server pushes (VAPID web-push): payload is { title, body, tag, url }.
self.addEventListener("push", (event) => {
  let title = "RoboShelf";
  let body = "New update in the club inventory";
  let tag = "roboshelf-push";
  let url = "/";
  try {
    if (event.data) {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      tag = payload.tag || tag;
      url = payload.url || url;
    }
  } catch (e) {
    if (event.data) body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: "/logo.svg",
      badge: "/logo.svg",
      data: { url },
    }),
  );
});
