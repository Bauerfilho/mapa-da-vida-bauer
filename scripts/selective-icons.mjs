import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Reescrita mecânica de imports próprios. Os ícones continuam vindo da dependência declarada.
const source = new URL("../src/", import.meta.url).pathname;
const protectedPaths = new Set(["App.tsx", "main.tsx"]);
const changed = [];
const symbols = new Set();

function visit(directory, relative = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = join(relative, entry.name);
    if (entry.isDirectory()) {
      if (name !== "mobile") visit(join(directory, entry.name), name);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(name) || protectedPaths.has(name)) continue;
    const file = join(directory, entry.name);
    const before = readFileSync(file, "utf8");
    const after = before.replace(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']@phosphor-icons\/react["'];?/g, (statement, wholeType, body) => {
      const items = body.split(",").map((part) => part.trim()).filter(Boolean);
      const types = [];
      const values = [];
      for (const item of items) {
        if (wholeType || item.startsWith("type ")) { types.push(item.replace(/^type\s+/, "")); continue; }
        if (!/^[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.test(item)) throw new Error(`Import não reconhecido: ${name}: ${item}`);
        const symbol = item.split(/\s+as\s+/)[0];
        symbols.add(symbol);
        values.push(`import { ${item} } from "@phosphor-icons/react/dist/csr/${symbol}";`);
      }
      if (!values.length) return statement;
      return [...values, ...(types.length ? [`import type { ${types.join(", ")} } from "@phosphor-icons/react";`] : [])].join("\n");
    });
    if (after !== before) {
      changed.push(name);
      if (!process.argv.includes("--check")) writeFileSync(file, after);
    }
  }
}
visit(source);
console.log(JSON.stringify({ dryRun: process.argv.includes("--check"), changed, distinctIcons: symbols.size }));
