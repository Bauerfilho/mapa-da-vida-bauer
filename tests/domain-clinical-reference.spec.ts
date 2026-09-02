import { expect, test } from "@playwright/test";
import { searchClinicalReferences, serializeSoap, normalizeClinicalQuery, createPersonalReference } from "../src/domain/clinicalReference";
import { CLINICAL_CATALOG } from "../src/domain/clinicalCatalog";

test("CID aceita código sem ponto preservando a forma oficial", () => {
  expect(searchClinicalReferences("n390", "cid")[0].item.code).toBe("N39.0");
  expect(searchClinicalReferences("R51", "cid")[0].item.code).toBe("R51");
});
test("acentos e sinônimos levam ao sintoma, não a diagnóstico inferido", () => {
  expect(searchClinicalReferences("dor de cabeca", "cid")[0].item.code).toBe("R51");
  expect(searchClinicalReferences("ardência ao urinar", "cid")[0].item.code).toBe("R30.0");
});

test("nomes digitados juntos preservam sufixos e encontram o termo usual", () => {
  expect(searchClinicalReferences("prenatal", "cid").some((result) => result.item.code === "Z34.0")).toBe(true);
  expect(searchClinicalReferences("DraminB6DL", "medicine")[0]?.item.id).toBe("brand-dramin-b6-dl");
  expect(searchClinicalReferences("DraminB6", "medicine")[0]?.item.id).toBe("med-dimenhydrinate-b6");
});
test("grafia aproximada é rotulada, sem porcentagem diagnóstica", () => {
  const results = searchClinicalReferences("infecao urinaira", "cid");
  expect(results.some((result) => result.item.code === "N39.0")).toBe(true);
  expect(results[0].match).toBe("approximate");
});
test("negação não é descartada para sugerir gravidez confirmada", () => {
  expect(searchClinicalReferences("não grávida", "cid")).toEqual([]);
  expect(searchClinicalReferences("sem gravidez", "cid")).toEqual([]);
  expect(searchClinicalReferences("Diabetes mellitus não-insulino-dependente, sem complicações", "cid")[0].item.code).toBe("E11.9");
});
test("código inexistente não é corrigido silenciosamente", () => {
  expect(searchClinicalReferences("N3Q0", "cid")).toEqual([]);
});
test("catálogo não cria decimais ou códigos combinados", () => {
  for (const code of ["R51", "R11", "I10", "O13"]) expect(CLINICAL_CATALOG.some((item) => item.code === code)).toBe(true);
  const combo = searchClinicalReferences("urocultura com antibiograma", "exam")[0].item;
  expect(combo.code).toBeUndefined();
  expect(combo.related).toContain("Urocultura");
  expect(combo.related).toContain("Antibiograma");
});
test("códigos de procedimento mantêm o zero inicial", () => {
  expect(searchClinicalReferences("EAS", "exam")[0].item.code).toBe("0202050017");
  expect(searchClinicalReferences("glicemia em jejum", "exam")[0].item.code).toBe("0202010473");
});
test("nome comercial retorna a composição verificada sem criar prescrição", () => {
  const item = searchClinicalReferences("Dramin B6", "medicine")[0].item;
  expect(item.title).toContain("piridoxina");
  expect(item.id).not.toBe(searchClinicalReferences("Dramin Capsgel", "medicine")[0].item.id);
  expect(item.cautions.some((note) => /bula.*pendente/i.test(note))).toBe(true);
});

test("apresentações de ferro e B6 DL não são fundidas com marcas parecidas", () => {
  expect(searchClinicalReferences("Noripurum EV", "medicine")[0].item.title).toMatch(/sacarato/i);
  expect(searchClinicalReferences("Noripurum mastigável", "medicine")[0].item.title).toMatch(/ferripolimaltose/i);
  expect(searchClinicalReferences("Ferinject", "medicine")[0].item.title).toMatch(/carboximaltose/i);
  expect(searchClinicalReferences("Dramin B6 DL", "medicine")[0].item.title).toMatch(/frutose/i);
});

test("identificação histórica não vira opção gestacional ou promessa de disponibilidade", () => {
  const dactil = searchClinicalReferences("Dactil OB", "medicine")[0].item;
  expect(dactil.summary).toMatch(/descontinuação/i);
  expect(dactil.gestationalReference).toBe(false);
  const gestational = CLINICAL_CATALOG.filter((item) => item.kind === "medicine" && item.gestationalReference);
  for (const category of new Set(gestational.map((item) => item.category))) expect(gestational.filter((item) => item.category === category).length).toBeLessThanOrEqual(5);
});
test("restrições críticas permanecem nas fichas", () => {
  const ondansetron = searchClinicalReferences("Vonau", "medicine")[0].item;
  const nitro = searchClinicalReferences("Macrodantina", "medicine")[0].item;
  expect(ondansetron.cautions.join(" ")).toMatch(/primeiro trimestre/i);
  expect(nitro.cautions.join(" ")).toContain("G6PD");
  expect(nitro.cautions.join(" ")).toMatch(/pielonefrite/i);
});
test("todas as referências públicas têm fonte e escopo de versão", () => {
  for (const item of CLINICAL_CATALOG) {
    expect(item.sources.length).toBeGreaterThan(0);
    expect(item.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
    expect(item.scope.length).toBeGreaterThan(10);
  }
});
test("consulta é determinística e não altera o catálogo", () => {
  const before = JSON.stringify(CLINICAL_CATALOG);
  expect(searchClinicalReferences("pré-natal", "cid")).toEqual(searchClinicalReferences("pre natal", "cid"));
  expect(JSON.stringify(CLINICAL_CATALOG)).toBe(before);
  expect(normalizeClinicalQuery("  USG — Obstétrico  ")).toBe("usg obstetrico");
});

test("fonte pessoal guarda o mesmo endereço absoluto validado", () => {
  const reference = createPersonalReference({ kind: "exam", title: "Referência de teste", aliases: "", sourceUrl: "https:docs.example/manual" });
  expect(reference.sourceUrl).toBe("https://docs.example/manual");
  expect(() => createPersonalReference({ kind: "exam", title: "Teste", aliases: "", sourceUrl: "javascript:alert(1)" })).toThrow();
  expect(() => createPersonalReference({ kind: "exam", title: "Teste", aliases: "", sourceUrl: "https://login:segredo@example.test/" })).toThrow();
});
test("SOAP conserva texto e quebras sem preencher achados ou conduta", () => {
  const soap = serializeSoap({ subjective: "Relato original.\nSegunda linha.", objective: "", assessment: "Hipótese registrada pelo operador", plan: "" });
  expect(soap).toContain("Relato original.\nSegunda linha.");
  expect(soap).toContain("Hipótese registrada pelo operador");
  expect(soap).toContain("Não preenchido");
  expect(soap).not.toMatch(/normal|prescrever|diagnóstico confirmado/i);
  expect(serializeSoap({ subjective: "", objective: "", assessment: "", plan: "" })).toBe("");
});
