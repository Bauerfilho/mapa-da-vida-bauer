# Mentor Bauer — plano de evolução noturna

**Objetivo:** completar os recursos pedidos sem substituir o master verificado, perder dados ou transformar informação desconhecida em conclusão.

**Arquitetura:** manter React/TypeScript, o banco incremental, as revisões, o backup cifrado, o runtime móvel e os cinco centros. Acrescentar módulos pequenos nas superfícies do app; fontes clínicas são catálogo público, consultas hospitalares são efêmeras e exames pessoais são registros privados.

## Restrições globais

- Original `ad2d3ab` e pacote de recuperação intactos. Branch `codex/noturno-2026-09-02` em cópia irmã.
- Palha, vinho, ouro, bússola e composição editorial aceita são a referência visual.
- Cinco centros: Hoje, Agenda, Registrar, Mentor e Arquivo. Nenhum sexto centro.
- Arquivos do runtime protegidos pelo lock permanecem byte a byte iguais.
- O domínio novo `exames` será uma área dentro dos centros existentes; as treze áreas originais não serão removidas nem fundidas.
- Nenhum dado pessoal do objetivo integral entra em código, testes, telemetria ou pesquisa externa.
- Registro de medicação não é prescrição. Não preencher dose/nome ambíguo, não recomendar ajuste e não criar doses tomadas automaticamente.
- CID, exames solicitáveis, SOAP e calculadoras hospitalares não criam fatos pessoais ou dados de pacientes.
- Toda migração, retenção e recuperação passa por testes positivos e negativos; nenhuma exclusão física sem backup confirmado e prévia estável.
- O código pode ir para Git privado; a publicação conserva a origem privada já existente. Não mudar acesso para público.

## CONTEXT_MAP

| Superfície | Mudança necessária | Dependências / prova |
| --- | --- | --- |
| `src/data/repository.ts`, `src/data/dashboard.ts` | Separar estados duradouros de eventos recortados no tempo; impedir duplicidade lógica de dose na transação | Analytics, Agenda, Medicamentos, Arquivo; testes IndexedDB com regime antigo e duas gravações simultâneas |
| `src/domain/laboratory.ts`, `src/features/LaboratoryWorkspace.tsx` | Painéis laboratoriais pessoais, valores/unidades/referências transcritos, documentos locais e evolução comparável | Model, catálogo, backup, revisão, analytics, exportação; teste byte a byte do anexo após restauração |
| `src/domain/clinicalReference.ts`, `src/features/ClinicalToolsWorkspace.tsx` | Busca tolerante a sinônimos/acentos/erros; CID, nomes de exames, marcas/princípios ativos e SOAP efêmero | Fontes verificadas, teclado móvel, acessibilidade, não persistência das consultas |
| `src/domain/annualReminders.ts`, `src/features/AnnualReminders.tsx` | Aniversários e datas anuais, próximos lembretes e ocorrência sem duplicar fatos | Agenda, leitura de estados antigos, edição/revisão; virada anual e 29/02 |
| `src/features/MetricTrends.tsx`, `src/domain/metricSeries.ts`, `src/Prototype.tsx` | Séries reais de sono/energia/estudo/rotina, janela preservada e detalhe por registro | MentorInsights, domínio/arquivo; faltantes não viram zero e unidades incompatíveis não são somadas |
| `src/features/ArchiveWorkspace.tsx`, módulo de retenção próprio | Faxina protegida, backup e orientações de continuidade entre aparelhos | Transações/revisões, backup verificado, estados duradouros protegidos |
| `src/prototype.css` e CSS dos módulos novos | Acabamento coerente, ícone dourado e atalho Orquestrator preto | Capturas no app real; iPhone/Pixel, teclado, foco, texto grande e movimento reduzido |

## Ordem dos marcos

### 1. Base e segurança dos dados

- [x] Restaurar bundle e refs; conferir SHA.
- [x] Reexecutar 208 testes de domínio, 44 Node, TypeScript/build e 28 arquivos protegidos.
- [x] Abrir a interface canônica no navegador interno.
- [x] Conferir privacidade do Site existente: proprietário, uma conta permitida, zero grupos e zero visitantes externos.
- [ ] Teste de regressão: regime criado em 2024 e vigente em 2026 deve gerar 60 horários planejados na janela de 60 dias, sem criar tomadas.
- [ ] Teste de regressão: duas confirmações concorrentes do mesmo regime/data/horário devem produzir exatamente um registro, uma operação e uma trilha coerente.
- [ ] Corrigir os caminhos identificados e revisar o diff independentemente.

### 2. Laboratório pessoal

- [ ] Definir `laboratory-panel-v1`: data de coleta, título, resultados com valor numérico/textual/comparador, unidade, intervalo e referência transcritos; desconhecidos explícitos.
- [ ] Anexo: PDF/JPEG/PNG, limite explícito, bytes base64, tamanho e SHA-256; nunca Blob cru no payload.
- [ ] Ampliar mapas exaustivos/whitelists para `exames`, preservando todos os domínios antigos.
- [ ] Construir captura, linha do tempo, filtro por analito, gráfico de mesma unidade e detalhe do registro.
- [ ] Provar salvar/reabrir/exportar/restaurar incluindo bytes do anexo; rejeitar arquivo/valor/data inválidos sem mutar o dataset.

### 3. Auxílio hospitalar

- [ ] Reutilizar sete calculadoras obstétricas existentes; acrescentar marcos iniciais verificados sem diagnóstico automático por data.
- [ ] Busca local de CID com código, termo canônico, sinônimos, busca aproximada claramente rotulada e alternativas.
- [ ] Catálogo de exames com nomenclatura pública e associações contextualizadas; sistema local desconhecido permanece não confirmado.
- [ ] Referência farmacológica com classes, marcas/princípios ativos, fontes e restrições gestacionais, sem rótulo universal de segurança.
- [ ] SOAP editável e copiável, com campos vazios de entrada, sem identificadores nem persistência e com descarte ao sair da área.
- [ ] Provar consultas sem escrita no IndexedDB/localStorage; navegação/teclado e foco reais.

### 4. Calendário e rotina

- [ ] Acrescentar datas anuais e aniversário sem exigir ano de nascimento.
- [ ] Projetar ocorrências em memória; nunca criar automaticamente fatos realizados.
- [ ] Tratar 29/02 sem inferência silenciosa e preservar lembretes antigos ainda ativos.
- [ ] Explicitar registro de tentativa de dormir e confiança/domínio do tema, sem produzir diagnóstico ou nota geral.

### 5. Métricas e acabamento

- [ ] Séries por indicador com unidade, n, janela, lacunas e acesso aos registros.
- [ ] Ao abrir domínio a partir do Mentor, preservar a janela selecionada.
- [ ] Visões de 60/180/365 dias são janelas móveis; não apagam dados a cada bimestre.
- [ ] Implementar faxina mensal protegida de dados antigos, preservando regimes/contas/lembretes ainda úteis.
- [ ] Testar aparência real e interações, inclusive estados vazios e falhas de leitura.

### 6. Entrega e recuperação

- [ ] Snapshot por marco com nome Noturno-N e hashes.
- [ ] Código validado em GitHub privado, separado de dados pessoais.
- [ ] Publicação no mesmo Site privado; testar estado publicado e atualização explícita sem perda.
- [ ] Descrever exatamente o que funciona localmente, o que exige configuração de conta e o que ainda depende de prova no iPhone físico.
- [ ] Atualizar RESUME e acompanhamento; não repetir tarefas já comprovadas nas rodadas de 30 minutos.

## Alternativas avaliadas

1. **Extensão aditiva do master (escolhida):** reaproveita o trabalho validado e preserva aparência/dados.
2. Reconstrução em nova arquitetura: recusada por contradizer o pacote de recuperação e aumentar risco de retrabalho.
3. Migração imediata dos dados para nuvem: recusada sem prova de acesso/cifragem/sincronização; a primeira publicação mantém dados locais e backup cifrado explícito.

## Registro de testes de navegador da base

Primeira execução seletiva: 24/29 aprovados. Dois testes exigiam servidor na porta documentada 4178; um seletor de título de Rotina era ambíguo. O caso de domínio trocado do backup mutava o primeiro registro sem garantir tipo e podia não mudar nada: instrumento em correção, não evidência de falha da cifra. Um cenário de troca de calculadora USG exige diagnóstico de interação. Nenhum desses resultados foi somado como aprovado.
