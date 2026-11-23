// Production entry: serves dist/client assets and hands everything else to the built TanStack Start fetch handler.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const clientDir = join(root, "dist", "client");
const { default: app } = await import(pathToFileURL(join(root, "dist", "server", "server.js")).href);
const port = Number(process.env.PORT ?? 10000);
const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".json": "application/json", ".txt": "text/plain" };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const file = normalize(join(clientDir, decodeURIComponent(url.pathname)));
    if (req.method === "GET" && file.startsWith(clientDir + "/") && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300" });
      createReadStream(file).pipe(res);
      return;
    }
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
    const response = await app.fetch(new Request(url, { method: req.method, headers: req.headers, body, duplex: "half" }));
    // Set-Cookie must go in as an array before writeHead: fromEntries keeps only the last one, and setHeader after writeHead throws.
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(response.status, headers);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Server error");
  }
}).listen(port, "0.0.0.0", () => console.log(`fifthwheel app listening on ${port}`));

// GitHub's schedule fires hours apart, but /admin calls the worker unhealthy after 10 minutes, so the always-on server ticks it itself.
// ponytail: one timer per process; the worker's leases make overlapping instances safe, the GitHub workflow stays as a backup.
const jobSecret = process.env.JOB_SECRET?.trim() ?? "";
if (jobSecret.length >= 32) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const response = await app.fetch(new Request(`http://127.0.0.1:${port}/api/internal/worker`, { method: "POST", headers: { authorization: `Bearer ${jobSecret}` } }));
      if (!response.ok) console.error(`worker pass failed: HTTP ${response.status}`);
    } catch (error) {
      console.error("worker pass failed:", error instanceof Error ? error.message : "unknown error");
    } finally { running = false; }
  };
  setInterval(tick, 5 * 60_000).unref();
  setTimeout(tick, 30_000).unref();
}
