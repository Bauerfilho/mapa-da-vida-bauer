import type { ClinicalReferenceItem, ClinicalReferenceSource } from "./clinicalReference";

// Seleção pública revisada em 02/09/2026. Não é base integral, prescrição ou catálogo de oferta local.
const cidSource: ClinicalReferenceSource = { label: "SES-GO · CID-10 de referência", url: "https://fhir.saude.go.gov.br/r4/reds-go/CodeSystem-BRCID10.html" };
const examSource: ClinicalReferenceSource = { label: "SES-GO · tabela SUS de referência", url: "https://fhir.saude.go.gov.br/r4/reds-go/CodeSystem-BRTabelaSUS.html" };
const manualSource: ClinicalReferenceSource = { label: "Ministério da Saúde · Manual 2022", url: "https://atencaoprimaria.es.gov.br/Media/AtencaoPrimaria/Mulher/Manual%20Gesta%C3%A7%C3%A3o%20Alto%20Risco%202022.pdf" };
const cidScope = "Seleção educacional · REDS-GO 1.0.3, metadado histórico. Consulta em 02/09/2026 não significa atualização integral da CID. Confirme a versão exigida pela unidade.";
const examScope = "Nomenclatura pública histórica · REDS-GO, atualização informada em 02/12/2022. Não comprova competência SIGTAP atual, oferta ou autorização no SISCV.";
const medicineScope = "Referência de identidade e cautelas, não prescrição. Consulta em 02/09/2026; via, apresentação, contexto e bula precisam ser conferidos.";
const cid = (code: string, title: string, aliases: string[], related: string[] = [], caution?: string): ClinicalReferenceItem => ({
  id: `cid-${code}`, kind: "cid", code, title, aliases,
  category: /^[OZ]/.test(code) ? "Gestação e obstetrícia" : "Clínica e sintomas",
  summary: "Código de referência para consulta; a seleção depende do registro clínico e das regras da unidade.",
  cautions: [caution ?? "O termo de busca não estabelece diagnóstico. Confira especificidade, inclusões, exclusões e eventual código complementar."],
  related, sources: [cidSource], scope: cidScope,
});
const exam = (id: string, title: string, code: string | undefined, aliases: string[], summary: string, related: string[]): ClinicalReferenceItem => ({
  id, kind: "exam", title, ...(code ? { code } : {}), aliases, summary, related,
  category: title.includes("ULTRASSONOGRAFIA") ? "Imagem" : "Laboratório",
  cautions: ["Termos relacionados ajudam a diferenciar nomes; não são exames indicados automaticamente nem um pacote de pedidos."], sources: [examSource], scope: examScope,
});
const medicine = (id: string, title: string, aliases: string[], category: string, summary: string, cautions: string[], sources: ClinicalReferenceSource[]): ClinicalReferenceItem => ({
  id, kind: "medicine", title, aliases, category, summary, cautions, related: [], sources, scope: medicineScope,
  gestationalReference: true,
});
const brand = (id: string, title: string, presentation: string, aliases: string[], summary: string, cautions: string[], sources: ClinicalReferenceSource[]): ClinicalReferenceItem => ({
  ...medicine(id, title, aliases, "Identificação de apresentação", summary, cautions, sources),
  presentation, gestationalReference: false,
  scope: "Somente identificação documental da apresentação nomeada. Não informa indicação, dose, segurança gestacional, disponibilidade ou situação atual de todas as apresentações da marca.",
});

export const CLINICAL_CATALOG: readonly ClinicalReferenceItem[] = [
  cid("Z32.1", "Gravidez confirmada", ["teste positivo"], ["Pré-natal", "Supervisão de gravidez"], "Confirmação da gravidez não equivale a supervisão pré-natal normal."),
  cid("Z34.0", "Supervisão de primeira gravidez normal", ["pré-natal", "primigesta", "primeira gestação"]),
  cid("Z34.8", "Supervisão de outra gravidez normal", ["pré-natal", "multigesta"]),
  cid("Z34.9", "Supervisão de gravidez normal, não especificada", ["pré-natal habitual", "gestação normal"]),
  cid("Z35.9", "Supervisão não especificada de gravidez de alto risco", ["pré-natal alto risco"]),
  cid("O13", "Hipertensão gestacional (induzida pela gravidez) sem proteinúria significativa", ["pressão alta gestacional", "hipertensão na gestação"], ["Pré-eclâmpsia"], "Este descritor não substitui os critérios diagnósticos; a ausência de proteinúria não exclui toda apresentação de pré-eclâmpsia."),
  cid("O14.9", "Pré-eclâmpsia não especificada", ["pré-eclâmpsia"], ["Hipertensão gestacional"]),
  cid("O20.0", "Ameaça de aborto", ["ameaça de abortamento"], ["Sangramento inicial"]),
  cid("O20.9", "Hemorragia do início da gravidez, não especificada", ["sangramento inicial", "sangramento na gravidez"]),
  cid("O21.9", "Vômitos da gravidez, não especificados", ["enjoo gestacional", "náusea na gravidez"]),
  cid("O23.0", "Infecções do rim na gravidez", ["pielonefrite gestacional"]),
  cid("O23.1", "Infecções da bexiga na gravidez", ["cistite gestacional"]),
  cid("O23.4", "Infecção não especificada do trato urinário na gravidez", ["ITU gestacional", "infecção urinária gestação"], ["Cistite gestacional", "Pielonefrite gestacional"]),
  cid("O23.5", "Infecções do trato genital na gravidez", ["infecção genital gestacional"]),
  cid("O24.4", "Diabetes mellitus que surge durante a gravidez", ["diabetes gestacional", "DMG"]),
  cid("O99.0", "Anemia complicando a gravidez, o parto e o puerpério", ["anemia gestacional"]),
  cid("N39.0", "Infecção do trato urinário de localização não especificada", ["ITU", "infecção urinária"], ["Disúria", "Cistite", "ITU gestacional"]),
  cid("N30.0", "Cistite aguda", ["infecção da bexiga", "cistite"], ["Infecção urinária"]),
  cid("R30.0", "Disúria", ["ardência ao urinar", "dor ao urinar"], ["Infecção urinária", "Cistite"], "Disúria é um sintoma. A busca não confirma infecção urinária."),
  cid("R51", "Cefaleia", ["dor de cabeça"], ["Enxaqueca", "Cefaleia tensional"], "Cefaleia é um sintoma; não converter em enxaqueca ou pré-eclâmpsia pela busca. Não acrescentar extensão americana R51.9."),
  cid("G43.9", "Enxaqueca, sem especificação", ["migrânea", "enxaqueca"]),
  cid("G44.2", "Cefaleia tensional", ["dor tensional"]),
  cid("D50.9", "Anemia por deficiência de ferro não especificada", ["anemia ferropriva"]),
  cid("D64.9", "Anemia não especificada", ["anemia"], ["Anemia ferropriva", "Anemia gestacional"]),
  cid("I10", "Hipertensão essencial (primária)", ["HAS", "hipertensão arterial"]),
  cid("E11.9", "Diabetes mellitus não-insulino-dependente, sem complicações", ["diabetes tipo 2", "DM2"], [], "A expressão histórica do descritor não significa que a pessoa não possa usar insulina."),
  cid("R11", "Náusea e vômitos", ["enjoo", "vômito", "náusea"]),
  cid("R10.4", "Outras dores abdominais e as não especificadas", ["dor na barriga", "dor abdominal"]),
  cid("J06.9", "Infecção aguda das vias aéreas superiores não especificada", ["IVAS"]),
  cid("K21.9", "Doença de refluxo gastroesofágico sem esofagite", ["refluxo", "DRGE"]),
  cid("B37.3", "Candidíase da vulva e da vagina", ["candidíase vaginal"]),
  cid("M54.5", "Dor lombar baixa", ["lombalgia"]),

  exam("exam-hemogram", "HEMOGRAMA COMPLETO", "0202020380", ["hemograma", "hemograma completo"], "Não equivale a leucograma isolado.", ["Ferritina"]),
  exam("exam-glucose", "DOSAGEM DE GLICOSE", "0202010473", ["glicemia em jejum", "glicemia", "glicose"], "Jejum qualifica a coleta nesta referência; a ficha não define preparo.", ["Hemoglobina glicada"]),
  exam("exam-urinalysis", "ANALISE DE CARACTERES FISICOS, ELEMENTOS E SEDIMENTO DA URINA", "0202050017", ["EAS", "urina tipo I", "urina tipo 1", "sumário de urina"], "Exame de urina não é cultura bacteriana.", ["Urocultura", "Antibiograma"]),
  exam("exam-culture", "CULTURA DE BACTERIAS P/ IDENTIFICACAO", "0202080080", ["urocultura", "cultura de urina"], "O descritor é amplo; o material urinário precisa ser especificado no contexto do pedido.", ["Antibiograma", "EAS"]),
  exam("exam-antibiogram", "ANTIBIOGRAMA", "0202080013", ["antibiograma", "teste de sensibilidade"], "Não é o mesmo procedimento que a identificação por cultura.", ["Urocultura"]),
  exam("exam-culture-antibiogram", "Urocultura com antibiograma · componentes distintos", undefined, ["urocultura com antibiograma"], "Código único não confirmado. Cultura e antibiograma estão apresentados separadamente; não foi criado código composto.", ["Urocultura", "Antibiograma"]),
  exam("exam-us-ob", "ULTRASSONOGRAFIA OBSTETRICA", "0205020143", ["USG obstétrico", "ultrassom obstétrico"], "Não torna Doppler e morfológico equivalentes ao exame obstétrico simples.", ["USG obstétrico com Doppler", "USG transvaginal"]),
  exam("exam-us-doppler", "ULTRASSONOGRAFIA OBSTETRICA C/ DOPPLER COLORIDO E PULSADO", "0205020151", ["USG obstétrico com Doppler", "Doppler obstétrico"], "Item diferente da ultrassonografia obstétrica sem Doppler.", ["USG obstétrico"]),
  exam("exam-us-tv", "ULTRASSONOGRAFIA TRANSVAGINAL", "0205020186", ["USG transvaginal", "ultrassom transvaginal", "TVUS"], "A via do exame não determina, sozinha, indicação nem interpretação gestacional.", ["USG obstétrico"]),
  exam("exam-hba1c", "DOSAGEM DE HEMOGLOBINA GLICOSILADA", "0202010503", ["HbA1c", "hemoglobina glicada", "glicada"], "Exame distinto da glicemia; não fazer substituição automática.", ["Glicemia em jejum"]),
  exam("exam-creatinine", "DOSAGEM DE CREATININA", "0202010317", ["creatinina"], "Não é clearance de creatinina.", []),
  exam("exam-ferritin", "DOSAGEM DE FERRITINA", "0202010384", ["ferritina"], "Não é ferro sérico.", ["Hemograma"]),

  medicine("med-paracetamol", "Paracetamol", ["Tylenol", "Tylenol isolado"], "Analgésico / antitérmico", "Tylenol de princípio ativo isolado: conferir apresentação antes de associar nome e composição.", ["Na gestação, o uso exige avaliação profissional; não há autorização universal nesta ficha.", "Não somar produtos com paracetamol. Considerar doença hepática e álcool.", "Tylenol DC contém também cafeína e não é equivalente à formulação isolada."], [{ label: "Tylenol · identidade e advertências", url: "https://www.tylenol.com.br/duvidas-frequentes" }]),
  medicine("med-dimenhydrinate", "Dimenidrinato", ["Dramin Capsgel", "Dramin"], "Antiemético", "Dramin Capsgel oral; a bula consultada inclui náuseas/vômitos da gravidez sob orientação.", ["Pode causar sonolência e comprometer atenção. Avaliar associação com álcool e outros sedativos.", "Confirmar via e apresentação; não extrapolar a produtos combinados."], [{ label: "Mantecorp · bula Dramin", url: "https://www.mantecorpsaude.com.br/assets/bulas/dramin-bula-profissional.pdf" }]),
  medicine("med-dimenhydrinate-b6", "Dimenidrinato + piridoxina", ["Dramin B6"], "Antiemético", "Identidade da combinação oral confirmada na página do fabricante.", ["Bula integral da apresentação pendente de conferência; isto não é revisão completa das contraindicações.", "Não confundir com doxilamina + piridoxina ou apresentações injetáveis. Uso depende de avaliação."], [{ label: "Mantecorp · Dramin B6", url: "https://www.mantecorpsaude.com.br/produtos/dramin-b6" }]),
  medicine("med-ondansetron", "Ondansetrona", ["Vonau", "Vonau Flash"], "Antiemético", "Vonau Flash oral de desintegração; consultar a bula específica.", ["A bula brasileira consultada recomenda não utilizar no primeiro trimestre. Isso não autoriza automaticamente o uso depois dele.", "Avaliar QT, alterações eletrolíticas e interações serotoninérgicas. Nenhuma dose é inferida."], [{ label: "Biolab · bula Vonau Flash", url: "https://cdn.biolabfarma.com.br/imagens/7896112401605-Bula.Pdf" }]),
  medicine("med-fosfomycin", "Fosfomicina trometamol", ["Monuril"], "Antibacteriano urinário", "Monuril oral: referência de trato urinário baixo sob avaliação, não de infecção renal.", ["Não extrapolar para pielonefrite. Conferir função renal, alergias e contexto microbiológico.", "A redação da bula e as orientações de diretriz não são idênticas sobre esquema na gestação. Esta ficha não resolve a divergência nem define dose ou duração."], [{ label: "Zambon · bula Monuril", url: "https://databaseprodotti.zambon.com/sites/default/files/product_downloads/Bula%20do%20Profissional%20de%20Sa%C3%BAde%20-%20Monuril%20%281%29.pdf" }, manualSource]),
  medicine("med-nitrofurantoin", "Nitrofurantoína", ["Macrodantina"], "Antibacteriano urinário", "Macrodantina oral: identidade confirmada. Contexto gestacional de infecção urinária baixa requer avaliação.", ["Avaliar função renal, deficiência de G6PD e proximidade do parto. Não é opção para pielonefrite.", "Bula integral específica pendente de conferência; não foi criado limite automático de liberação por semana."], [{ label: "Mantecorp · identidade Macrodantina", url: "https://www.mantecorpsaude.com.br/produtos/macrodantina" }, { label: "EAU · infecções urológicas", url: "https://uroweb.org/guidelines/urological-infections/chapter/the-guideline" }, manualSource]),
  medicine("med-clotrimazole", "Clotrimazol vaginal", ["Gino-Canesten", "Gino Canesten", "Gino-Canesten 1"], "Antifúngico vaginal", "A família comercial não define a formulação nem o esquema apropriado para a gestação.", ["Formulação e esquema precisam de avaliação. A apresentação Gino-Canesten 1 não é escolha padrão automática para gestantes.", "Na gravidez, o comprimido vaginal da apresentação consultada deve ser inserido sem aplicador, somente sob orientação profissional. Isso não define a formulação ou o esquema apropriado."], [{ label: "Bayer · bula da apresentação consultada", url: "https://www.bulario.bayer.com.br/cuidados-com-a-saude/gino-canesten-comprimido-vaginal" }, { label: "FEBRASGO / Femina · 2024", url: "https://femina.org.br/wp-content/uploads/sites/12/articles_xml/0100-7254-femina-52-3-0154/0100-7254-femina-52-3-0154.pdf" }]),
  medicine("med-alginate", "Alginato de sódio + bicarbonato de potássio", ["LuftaGastro", "Lufta Gastro original"], "Antirrefluxo de barreira", "Composição da formulação original identificada na página do fabricante.", ["Necessita avaliação de composição e comorbidades. Não equivale à formulação Dupla Ação.", "Pode alterar absorção de outros medicamentos, inclusive ferro. Bula integral e revisão regulatória da apresentação não foram verificadas.", "Linguagem promocional ou categoria por letras não prova segurança gestacional universal."], [{ label: "Reckitt · identidade LuftaGastro", url: "https://www.reckittsaude.com.br/product-list/luftagastro/" }]),

  brand("brand-syntocinon", "Ocitocina", "Syntocinon · solução injetável", ["Syntocinon", "Syntocinon injetável"], "Identificação em bula histórica do fabricante: solução injetável em ampola, não spray nasal.", ["Documento histórico com vias intramuscular/intravenosa; a enumeração não orienta administração.", "Registro e comercialização atuais não foram confirmados. Esta ficha não valida uso na gestação."], [{ label: "Viatris · bula histórica Syntocinon", url: "https://www.viatris.com.br/-/media/project/common/viatriscombr/pdf/leaflets_legacy_myl_brazil/syntocinon_injetavel_bula_paciente.pdf" }]),
  brand("brand-methergin", "Maleato de metilergometrina", "Methergin · solução injetável histórica", ["Methergin", "Methergin injetável"], "Bula arquivada identificada como antiga pelo fabricante. Não é ocitocina nem equivalente a Syntocinon.", ["O cabeçalho histórico enumera vias subcutânea, intramuscular e intravenosa. Isso não é orientação clínica atual.", "Registro e comercialização atuais não foram verificados; não inferir dose, técnica ou uso gestacional."], [{ label: "Novartis · bula antiga Methergin", url: "https://portal.novartis.com.br/medicamentos/wp-content/uploads/2021/10/00_OLD_Bula-METHERGIN-Solucao-Injetavel-Paciente.pdf" }]),
  brand("brand-plasil", "Cloridrato de metoclopramida", "Plasil · comprimido oral", ["Plasil", "Plasil comprimido", "Plasil oral"], "A bula recuperada confirma comprimido oral. A forma monoidratada é expressa em equivalente anidro na composição.", ["Não usar a ficha para ampola, gotas ou outra apresentação.", "Identidade confirmada por documento ligado pelo fabricante; não representa conferência regulatória de todas as embalagens."], [{ label: "Sanofi · bula Plasil comprimido", url: "https://sm.far.br/assets/pdfs/bula_183260318_1533477248_p.pdf" }]),
  brand("brand-buscopan", "Butilbrometo de escopolamina", "Buscopan simples · drágea oral", ["Buscopan", "Buscopan simples", "Buscopan drágea"], "A composição da drágea simples não contém a dipirona do Buscopan Composto.", ["Preserve o nome completo do sal; não reduzir a escopolamina sem qualificá-lo.", "Via oral confirmada nesta ficha; não confirma apresentação injetável nem segurança gestacional."], [{ label: "Fabricante · bula Buscopan drágeas", url: "https://www.buscopan.com.br/bula-buscopan" }]),
  brand("brand-buscopan-composto", "Butilbrometo de escopolamina + dipirona monoidratada", "Buscopan Composto · comprimido revestido oral", ["Buscopan Composto", "Buscopan composto comprimido", "Buscopan"], "Composto e simples são composições diferentes; o sufixo faz parte da identificação.", ["A ficha é de comprimido revestido oral, não de ampola ou gotas.", "Não é equivalência de uso, recomendação de combinação nem autorização para gestantes."], [{ label: "Fabricante · bula Buscopan Composto", url: "https://www.buscopan.com.br/bula-buscopan-composto" }]),
  brand("brand-ferinject", "Carboximaltose férrica", "Ferinject · solução intravenosa", ["Ferinject", "carboximaltose"], "Solução injetável em frasco-ampola de uso intravenoso conforme a apresentação documentada.", ["Não é o sacarato de hidróxido férrico de Noripurum EV. Produtos de ferro não são intercambiáveis só pelo nome da classe.", "Nenhuma conversão de dose, outra via ou indicação é fornecida."], [{ label: "Blanver · bula Ferinject", url: "https://blanver.com.br/wp-content/uploads/2026/07/01_Ferinject_Bula_Paciente.pdf" }]),
  brand("brand-noripurum-ev", "Sacarato de hidróxido férrico", "Noripurum EV · solução intravenosa", ["Noripurum EV", "Noripurum intravenoso", "Noripurum"], "O sufixo EV diferencia a apresentação intravenosa das apresentações orais.", ["A bula desta apresentação exclui uso intramuscular. Isso não é instrução de administração.", "Não confundir com carboximaltose férrica ou ferripolimaltose oral; não há conversão de dose nesta ficha."], [{ label: "Blanver · bula Noripurum EV", url: "https://blanver.com.br/wp-content/uploads/2026/03/01_Noripurum-EV_Bula_Paciente.pdf" }]),
  brand("brand-noripurum-oral", "Ferripolimaltose", "Noripurum · comprimido mastigável oral", ["Noripurum mastigável", "Noripurum oral", "Noripurum"], "Comprimido mastigável oral, conforme a seção específica da bula consultada.", ["Não equivale a Noripurum EV. Noripurum Fólico acrescenta outro componente e não é alias desta ficha.", "A identidade não implica indicação ou validação gestacional."], [{ label: "Blanver · bula Noripurum oral", url: "https://blanver.com.br/wp-content/uploads/2025/07/bula_Noripurum_Paciente.pdf" }]),
  brand("brand-dactil-ob", "Cloridrato de piperidolato + hesperidina complexo + ácido ascórbico revestido", "Dactil OB · referência histórica", ["Dactil OB", "Dactil"], "Referência histórica: descontinuação definitiva comunicada pela Sanofi em 10/06/2025. Não é apresentado como produto disponível.", ["A drágea oral contém três componentes, não somente piperidolato.", "Identificar um nome antigo não autoriza uso, disponibilidade ou substituição."], [{ label: "Sanofi · bula histórica Dactil OB", url: "https://sm.far.br/assets/pdfs/bula_183260309_1726238245_p.pdf" }, { label: "Sanofi · comunicado de descontinuação", url: "https://www.sanofi.com.br/pt/noticias/informacoes-de-produtos/2025-6-10-comunicado-sobre-a-descontinuacao-definitiva-da-fabricacao-importacao-do-medicamento-dactil-ob" }]),
  brand("brand-dramin-b6-dl", "Dimenidrinato + cloridrato de piridoxina + glicose + frutose", "Dramin B6 DL · solução intravenosa", ["Dramin B6 DL", "Dramin DL"], "Identificação em documento administrativo público original, não em bula integral: quatro componentes e via intravenosa.", ["DL não é a apresentação oral Dramin B6 do outro grupo de referência.", "A ata não confirma bula completa, registro atual, estoque ou conduta. Não é fonte de segurança gestacional."], [{ label: "SMS São Paulo · Ata 16/2025", url: "https://prefeitura.sp.gov.br/documents/d/saude/ata01625-pdf-1" }]),
];

export const CLINICAL_PORTALS = [
  { label: "Central de Regulação de Goiânia · SISCV", url: "https://www.goiania.go.gov.br/sing_servicos/central-de-regulacao/", note: "Portal municipal confirmado. Acesso institucional; sistema da sua maternidade não foi confirmado." },
  { label: "SIGTAP · consultar competência", url: "https://sigtap.datasus.gov.br/tabela-unificada/app/sec/inicio.jsp", note: "Catálogo nacional. Um código não confirma disponibilidade ou agendamento." },
  { label: "Anvisa · bulas e registros", url: "https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/bulas-e-rotulos", note: "Conferir apresentação, princípio ativo e bula vigente." },
] as const;

export const EARLY_PREGNANCY_MILESTONES = [
  { period: "Por volta da 5ª semana", title: "Saco gestacional", description: "Pode começar a ser visualizado pela via transvaginal. A datação e a qualidade do exame influenciam o achado." },
  { period: "Gestação inicial", title: "Vesícula vitelínica", description: "É uma das estruturas procuradas no exame inicial; não foi definido um prazo obrigatório isolado para sua presença." },
  { period: "Por volta da 6ª semana", title: "Atividade cardíaca embrionária", description: "Costuma tornar-se identificável nesse período. A ausência isolada não permite concluir perda gestacional." },
] as const;
export const EARLY_PREGNANCY_SOURCES = [manualSource, { label: "ISUOG · gestação inicial, 2025", url: "https://www.isuog.org/clinical-resources/patient-information-series/patient-information-pregnancy-conditions/early-pregnancy/normal-early-pregnancy-ultrasound.html" }];
