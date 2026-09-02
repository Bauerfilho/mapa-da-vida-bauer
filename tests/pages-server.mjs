// Servidor de prova: somente a subpasta real, sem fallback que esconda 404 de assets.
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../dist/client/", import.meta.url));
const base = "/mapa-da-vida-bauer/";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".md": "text/plain" };

export function startPagesServer(port = 0) {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!pathname.startsWith(base)) { response.writeHead(404).end("Fora da subpasta Pages"); return; }
      const relative = pathname.slice(base.length) || "index.html";
      const target = path.resolve(directory, relative);
      if (!target.startsWith(`${path.resolve(directory)}${path.sep}`)) { response.writeHead(403).end(); return; }
      const bytes = await readFile(target);
      response.writeHead(200, { "content-type": types[path.extname(target)] ?? "application/octet-stream", "cache-control": "no-cache" });
      response.end(bytes);
    } catch {
      response.writeHead(404).end("Arquivo ausente");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startPagesServer(4191);
  console.log("Prova Pages em http://127.0.0.1:4191/mapa-da-vida-bauer/");
}
