/**
 * Intentionally minimal. The app talks to Convex and the Web Platform only, so
 * no Node bridge is exposed — keeping the renderer fully sandboxed.
 * A tiny marker lets the app (if it ever wants to) detect it is running inside
 * the desktop shell.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("rcDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
});
