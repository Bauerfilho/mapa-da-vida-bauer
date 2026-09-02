# Registro de validação — Mentor Bauer v1.0

Data: 01/09/2026

## Gates automatizados

- Build de produção TypeScript + Vite: aprovado.
- Integridade do runtime móvel protegido: 28/28 arquivos aprovados.
- Testes de domínio, formulários, métricas, Agenda, Finanças, cartões, assinaturas, cenários descritivos de quitação, relatório para consulta, preferências, Humor, Internato, Estudos, Rotina, importação legada, revisões, limpeza de staging, restauração transacional, Medicamentos e motor obstétrico: 208/208 aprovados.
- Testes Node de analytics, regras do Mentor, PWA, cache offline, CSP e worker de hospedagem: 44/44 aprovados.
- Total de provas automatizadas distintas no gate canônico: 252.
- `git diff --check`: aprovado.

Os 42 cenários browser-backed foram reconhecidos e coletados, incluindo recuperação/edição IndexedDB e sete jornadas obstétricas. O executor local não continha o binário Chromium para executar essa suíte diretamente; por isso eles permanecem separados e não foram somados às 252 provas do gate canônico. As sete jornadas obstétricas foram repetidas manualmente no navegador móvel integrado; a restauração continua em modo safe-merge.

## Provas no navegador móvel

- Agenda: tarefa salva, listada, persistida e incluída no Arquivo.
- Finanças: `1.234,56` preservado como R$ 1.234,56; saída não virou saldo; persistência confirmada após recarregar.
- Arquivo: busca e prévia legível; exclusão exige segunda confirmação; cancelamento preserva o registro.
- Mentor: 13 domínios, janela de 60 dias, n, lacunas, completude e no máximo três próximas ações.
- Humor: escala funcional de −2 a +2 e energia de 0 a 4 sem normalização escondida.
- Cefaleia: ausência confirmada salva detalhes como não aplicáveis, nunca como intensidade zero.
- Internato: escala planejada separada de presença, chegada, saída, intervalo e falta confirmada; plantões noturnos cobertos por testes.
- Obstetrícia: atalho em Registrar abre a subárea de Internato sem criar um sexto centro; o seletor compacto alterna sete calculadoras e preserva rascunhos somente enquanto o workspace permanece aberto.
- Datação: DUM `28/07/2026` em `01/09/2026` retornou `5 sem 0 d` e DPP `04/05/2027`; USG `01/08/2026` com `10+3` retornou `14+6` e DPP `24/02/2027`.
- Conduta de datação: comparação DUM × USG mostra diferença e limiar sem alterar a DPP; DUM incerta torna a tabela não aplicável; ART futura é recusada e ART confirmada tem precedência explícita.
- Maternidade: QBL canônico retornou `450 mL`; índice de choque `120/100` retornou `1,20` com alerta `>1,00`; Apgar `0/10` aos 10 minutos manteve o lembrete seriado até 20 minutos.
- Privacidade obstétrica: não há nome/prontuário nem chamadas a banco, storage, analytics, Arquivo ou backup; sair para Jornada/Voltar/menu inferior desmonta o workspace e reabre todos os campos vazios.
- Acessibilidade obstétrica: abas têm `tabpanel`, foco roving e setas; alvos críticos têm ao menos 44×44 px; texto maior, alto contraste e redução de movimento alcançam o workspace.
- Responsividade obstétrica: os sete modos, inclusive o Apgar denso, foram inspecionados em iPhone e Pixel 10 sem corte da navegação ou dos resultados.
- Medicamentos: regime, dose e horário formam o vínculo; silêncio não vira dose pulada.
- Medicamentos: estoque/reposição e uso SOS têm entradas próprias e não recomendam conduta.
- Estudos: metas Base/Boa/Ouro, planejado × real, questões, active recall, revisão e vínculo com Internato.
- Rotina: capacidade do dia, prioridades, blocos, replanejamento e recuperação sem julgamento moral.
- Importação Beta: JSON reconhecido recebe prévia e snapshot reversível antes de entrar no histórico.
- Edição: registros compatíveis criam uma nova revisão; a versão anterior permanece auditável e o conflito não sobrescreve dados.
- Cartões: limite, fatura, saldo informado, fechamento, vencimento e parcelas permanecem fatos separados; utilização e compromisso só nascem de pares completos.
- Relatório para consulta: período e domínios são escolhidos explicitamente; a geração ocorre no aparelho e não compartilha automaticamente.
- Relatório para consulta: nenhum domínio vem pré-selecionado e o texto integral visto na prévia é o mesmo do arquivo final.
- Preferências: metas de estudo/sono e recursos de acessibilidade continuam separadas dos fatos realizados e podem permanecer indefinidas.
- Assinaturas: permanecem no histórico financeiro, mudam de situação no mesmo registro com justificativa e somente `active_confirmed` entra como obrigação.
- Assinaturas: após salvar pelo formulário contextual, a lista e a contagem de Finanças foram relidas imediatamente sem sair da tela.
- Vencimentos: o trilho curto mantém próximos compromissos visíveis mesmo quando também existem itens atrasados.
- Rotina: “Fechar meu dia” aceita um fechamento factual sem fabricar prioridades, blocos ou nota geral.
- Humor: contexto, fatores protetores e segurança são autorrelatos; o app não classifica diagnóstico nem monitora emergências.
- Teclado: oculto após salvar Agenda/Finanças; navegação inferior volta a responder.
- Backup: erro de criptografia em contexto HTTP inseguro aparece em tela sem alterar dados; a entrega HTTPS é o gate de publicação.
- Console: nenhum erro do aplicativo após recarregamento limpo; mensagens da extensão do navegador foram desconsideradas.

## Integridade da recuperação

- Exportação cifra e reabre o próprio conteúdo antes de liberá-lo.
- O status de último backup só avança depois de o navegador entregar o arquivo ao compartilhamento ou iniciar o download, e nunca regride com confirmações fora de ordem. O usuário ainda deve confirmar a presença do arquivo no app Arquivos/iCloud.
- Comprovantes pendentes de exportações repetidas ficam limitados por conjunto de dados e continuam confirmáveis fora de ordem dentro dessa janela.
- Prévia e aplicação verificam checksum e plano de mesclagem; mudança entre as duas etapas aborta sem escrita.
- Instalação nova recupera fatos e configurações visíveis, incluindo seeds alterados ou excluídos.
- Conflitos são preservados para revisão e não sobrescritos.
- A restauração não transplanta caches ou estado de sincronização. Em uma base limpa, revisões e operações válidas ligadas às entidades recuperadas preservam a trilha auditável; em uma mesclagem com dados locais, conflitos continuam isolados para revisão.

## Limites declarados

- A PWA depende das políticas de armazenamento do iOS; backup externo continua obrigatório para recuperação contra limpeza do Safari.
- Notificações nativas persistentes, HealthKit e calendário do aparelho pertencem à fase Capacitor/iOS.
- Integrações de e-mail, Google/Outlook e Open Finance não fazem parte desta entrega.
- A direção visual e os fluxos principais foram inspecionados anteriormente em viewport móvel. As mudanças funcionais desta consolidação passaram por compilação e testes puros; a reabertura offline, a instalação e a prova física final no iPhone 16 Pro Max ainda dependem da execução do checklist pelo usuário.
- A passagem única do service worker antigo v5 para o v6 pode ter carregado uma página nova antes do primeiro toque de atualização. Desde o v6, cada shell fica imutável; a revisão funcional atual usa o cache pareado `2026-09-01-v11` e só entra após ativação explícita.
