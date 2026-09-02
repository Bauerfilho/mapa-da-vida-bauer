#!/usr/bin/env node
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { pagesAssetsPlugin } from "./pages-assets-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "/mapa-da-vida-bauer/";
const notices = path.join(root, "THIRD_PARTY_NOTICES.md");
// Avisos são obrigatórios; não se publica uma build que omita as licenças de terceiros.
if (readFileSync(notices).length === 0) throw new Error("THIRD_PARTY_NOTICES.md vazio.");

// Só saídas geradas de outra forma de hospedagem são retiradas; a fonte permanece intacta.
for (const generated of ["dist/server", "dist/.openai"]) rmSync(path.join(root, generated), { recursive: true, force: true });
await build({ root, base, plugins: [pagesAssetsPlugin(root, base)] });
copyFileSync(notices, path.join(root, "dist/client/THIRD_PARTY_NOTICES.md"));
// O marcador informa a servidores compatíveis que o conteúdo já foi compilado.
writeFileSync(path.join(root, "dist/client/.nojekyll"), "");
console.log(`Build pessoal Pages pronta: dist/client → ${base}; sete literais rebaseados antes do hash, runtime sem edição.`);
