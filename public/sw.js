/* RoboShelf service worker — pushes for the wrapped APK/EXE apps and PWA.
 * The app posts { type: "SHOW_NOTIFICATION", title, body, tag } messages here;
 * when push server support is added later, the "push" listener is already wired. */

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
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});

// Real push messages (future server integration).
self.addEventListener("push", (event) => {
  let title = "RoboShelf";
  let body = "New update in the club inventory";
  try {
    if (event.data) {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
    }
  } catch (e) {
    if (event.data) body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "roboshelf-push",
      icon: "/logo.svg",
      badge: "/logo.svg",
    }),
  );
});
