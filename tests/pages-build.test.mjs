import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import test from "node:test";
import { startPagesServer } from "./pages-server.mjs";

const output = new URL("../dist/client/", import.meta.url);
const base = "/mapa-da-vida-bauer/";
const origin = "https://bauerfilho.github.io";

test("a build Pages não deixa os sete recursos móveis apontarem para a raiz do domínio", async () => {
  const chunks = (await readdir(new URL("assets/", output))).filter((name) => name.endsWith(".js"));
  const source = (await Promise.all(chunks.map((name) => readFile(new URL(`assets/${name}`, output), "utf8")))).join("\n");
  for (const resource of ["iphone/Bezel.png", "iphone/Keyboard.png", "android/Keyboard.png", "android/Pixel10.png", "android/navigation-bar.svg", "status/status-icons.svg", "status/ios-status-icons.svg"]) {
    assert.equal(source.includes(`"/assets/${resource}"`), false, resource);
    assert.ok(source.includes(`${base}assets/${resource}`), resource);
    await access(new URL(`assets/${resource}`, output));
  }
});

test("manifesto, ícones e scripts compilados pertencem à subpasta pessoal", async () => {
  const manifestUrl = new URL(`${base}manifest.webmanifest`, origin);
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", output), "utf8"));
  for (const field of ["id", "start_url", "scope"]) {
    assert.equal(new URL(manifest[field], manifestUrl).pathname, base, field);
  }
  for (const icon of manifest.icons) assert.ok(new URL(icon.src, manifestUrl).pathname.startsWith(`${base}icons/`));
  const html = await readFile(new URL("index.html", output), "utf8");
  assert.doesNotMatch(html, /src=["']\/src\//);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    assert.ok(new URL(match[1], new URL(base, origin)).pathname.startsWith(base), match[1]);
  }
});

test("os avisos de terceiros são arquivos integrais e nenhum metadado Sites entra na distribuição", async () => {
  const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url));
  assert.deepEqual(await readFile(new URL("THIRD_PARTY_NOTICES.md", output)), notices);
  await assert.rejects(access(new URL(".openai/hosting.json", output)), { code: "ENOENT" });
  await assert.rejects(access(new URL("../.openai/hosting.json", output)), { code: "ENOENT" });
});

test("servidor estrito entrega todos os arquivos pela subpasta e recusa recursos na raiz", async (t) => {
  const server = await startPagesServer();
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  const localOrigin = `http://127.0.0.1:${address.port}`;
  async function inspect(relative = "") {
    let count = 0;
    for (const entry of await readdir(new URL(relative, output), { withFileTypes: true })) {
      const resource = `${relative}${entry.name}`;
      if (entry.isDirectory()) { count += await inspect(`${resource}/`); continue; }
      assert.ok(entry.isFile(), `Symlink inesperado: ${resource}`);
      const response = await fetch(`${localOrigin}${base}${resource}`);
      assert.equal(response.status, 200, resource);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(resource, output)), resource);
      count += 1;
    }
    return count;
  }
  t.diagnostic(`${await inspect()} arquivos exatos acessíveis no prefixo Pages.`);
  assert.equal((await fetch(`${localOrigin}/assets/iphone/Bezel.png`)).status, 404);
  assert.equal((await fetch(`${localOrigin}${base}assets/ausente.js`)).status, 404);
});
