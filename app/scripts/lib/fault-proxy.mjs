// Test-only intercepting HTTPS proxy for api.stripe.com with ONE fault: "cut-response".
// It terminates TLS with a throwaway local CA (trusted via NODE_EXTRA_CA_CERTS only in the test processes), forwards every request
// to the real Stripe, and -- when armed for a METHOD+PATH prefix -- completes the upstream call and then destroys the client socket
// without delivering the answer: Stripe processed the request, the caller sees a network failure (a real timeout/blip).
// Control (plain HTTP to this server): POST /arm?times=N&match=POST%20/v1/refunds   POST /disarm   GET /status
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

export async function startFaultProxy() {
  const dir = mkdtempSync(join(tmpdir(), "fw-fault-proxy-"));
  const sh = (args) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  sh(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=FW Test Fault CA"]);
  sh(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=api.stripe.com"]);
  writeFileSync(join(dir, "ext.cnf"), "subjectAltName=DNS:api.stripe.com\nbasicConstraints=CA:FALSE\n");
  sh(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "2", "-extfile", "ext.cnf"]);
  const secureContext = tls.createSecureContext({ key: readFileSync(join(dir, "leaf.key")), cert: readFileSync(join(dir, "leaf.pem")) });

  let armed = 0; let match = ""; let cuts = 0; const seen = [];
  const mitm = http.createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    seen.push(key); if (seen.length > 200) seen.shift();
    const cut = armed > 0 && key.startsWith(match);
    if (cut) armed--;
    const up = https.request({ host: "api.stripe.com", port: 443, method: req.method, path: req.url, headers: { ...req.headers, host: "api.stripe.com" } }, (upRes) => {
      if (cut) { upRes.resume(); upRes.on("end", () => { cuts++; req.socket.destroy(); }); return; }
      res.writeHead(upRes.statusCode ?? 502, upRes.headers); upRes.pipe(res);
    });
    up.on("error", () => req.socket.destroy());
    req.pipe(up);
  });
  const control = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/arm") { armed = Math.max(1, Number(url.searchParams.get("times") ?? 1)); match = url.searchParams.get("match") ?? ""; }
    else if (req.method === "POST" && url.pathname === "/disarm") { armed = 0; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ armed, match, cuts, seen: seen.slice(-8) }));
  });
  control.on("connect", (req, clientSocket, head) => {
    const host = String(req.url).split(":")[0];
    if (host !== "api.stripe.com") { clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) clientSocket.unshift(head);
    const secure = new tls.TLSSocket(clientSocket, { isServer: true, secureContext });
    secure.on("error", () => clientSocket.destroy());
    mitm.emit("connection", secure);
  });
  await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
  const { port } = control.address();
  return { port, url: `http://127.0.0.1:${port}`, caPath: join(dir, "ca.pem"),
    close: () => new Promise((resolve) => control.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); })) };
}
