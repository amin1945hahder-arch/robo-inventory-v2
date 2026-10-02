/**
 * RoboShelf desktop shell (Electron).
 *
 * The web app is a Vite SPA that uses the History API (React Router) and
 * IndexedDB/localStorage. Loading it from `file://` would break routing and
 * give storage an opaque origin, so instead we serve the built `dist/` folder
 * from a tiny in-process HTTP server on 127.0.0.1 and point the window at it.
 * That keeps routing, storage, service workers and the Convex websocket all
 * behaving exactly as they do in a normal browser tab.
 *
 * No runtime dependencies beyond Electron itself — the static server uses only
 * Node's built-in `http`/`fs`.
 */
const { app, BrowserWindow, shell, Menu } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST = app.isPackaged
  ? path.join(process.resourcesPath, "dist")
  : path.join(__dirname, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      pathname = "/";
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(DIST, normalized);

    // Never escape the dist root.
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stat) => {
      // SPA fallback: unknown paths render the app shell (React Router takes over).
      if (err || !stat.isFile()) filePath = path.join(DIST, "index.html");
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(filePath).on("error", () => res.end()).pipe(res);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

let mainWindow = null;

async function createWindow() {
  const { port } = await startStaticServer();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    title: "RoboShelf",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // External links (t.me, github, datasheets…) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // No application menu: this is a kiosk-style tool, not a document editor.
  Menu.setApplicationMenu(null);

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
