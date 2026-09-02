import path from "node:path";

// Os sete literais pertencem a dois módulos protegidos; só o resultado em memória muda.
export function pagesAssetsPlugin(root, base) {
  const allowed = new Map([
    [path.join(root, "src/mobile/assets.ts"), ["/assets/iphone/Bezel.png", "/assets/iphone/Keyboard.png", "/assets/android/Keyboard.png", "/assets/android/Pixel10.png"]],
    [path.join(root, "src/mobile/components.tsx"), ["/assets/android/navigation-bar.svg", "/assets/status/status-icons.svg", "/assets/status/ios-status-icons.svg"]],
  ]);
  const transformed = new Set();
  return {
    name: "mentor-pages-protected-asset-base",
    enforce: "pre",
    buildStart() { transformed.clear(); },
    transform(source, id) {
      const file = id.split("?")[0];
      const paths = allowed.get(file);
      if (!paths) return null;
      let code = source;
      for (const asset of paths) {
        const literal = JSON.stringify(asset);
        if (code.split(literal).length !== 2) throw new Error(`Literal protegido inesperado em ${file}: ${asset}`);
        code = code.replace(literal, JSON.stringify(`${base}${asset.slice(1)}`));
      }
      if (/["']\/assets\//.test(code)) throw new Error(`Asset absoluto não mapeado: ${file}`);
      transformed.add(file);
      return { code, map: null };
    },
    generateBundle() {
      if (transformed.size !== allowed.size) throw new Error("O build não percorreu todos os módulos móveis esperados.");
    },
  };
}
