# Gate físico — iPhone 16 Pro Max

**Documento:** QA-IP16PM  
**Versão do checklist:** 1.0.0  
**Estado geral:** **NÃO EXECUTADO — PENDENTE EM APARELHO FÍSICO**  
**Regra de aprovação:** nenhum item crítico pode ficar sem resultado e evidência. Este arquivo não afirma que o gate físico passou.

## Identificação da execução

| Campo | Preencher antes do teste |
|---|---|
| Versão/commit do app |  |
| URL privada testada |  |
| Build/hash dos assets |  |
| Modelo | iPhone 16 Pro Max |
| Versão do iOS/Safari |  |
| Espaço livre inicial |  |
| Executor |  |
| Data e fuso |  |
| Dataset | Sintético anual determinístico, 365 dias, 13 domínios |

Resultados permitidos: `PASS`, `FAIL`, `BLOQUEADO` ou `NÃO EXECUTADO`.

## Checklist crítico

| ID | Passo e critério de aprovação | Resultado | Evidência/arquivo | Executor/data |
|---|---|---|---|---|
| INST-01 | Abrir a URL privada no Safari; confirmar que usuário não autorizado não acessa o app | NÃO EXECUTADO |  |  |
| INST-02 | Adicionar à Tela de Início; ícone, nome e abertura `standalone` corretos | NÃO EXECUTADO |  |  |
| INST-03 | Confirmar pedido/estado de armazenamento persistente e espaço disponível | NÃO EXECUTADO |  |  |
| DATA-01 | Salvar um registro em cada um dos 13 domínios e reabrir cada registro no Arquivo | NÃO EXECUTADO |  |  |
| DATA-02 | Confirmar que zero, “não”, ausência confirmada e não registrado permanecem distintos | NÃO EXECUTADO |  |  |
| DATA-03 | Editar um registro com revisão, excluir, desfazer/restaurar e conferir histórico | NÃO EXECUTADO |  |  |
| OFF-01 | Com gravações concluídas, encerrar o web app à força pelo seletor de apps | NÃO EXECUTADO |  |  |
| OFF-02 | Ativar modo avião, reabrir pela Tela de Início e confirmar shell, Hoje, Agenda, Mentor e Arquivo | NÃO EXECUTADO |  |  |
| OFF-03 | Ainda offline, salvar novo registro, fechar e reabrir; dado deve permanecer | NÃO EXECUTADO |  |  |
| OFF-04 | Voltar online; nenhum registro pode duplicar ou desaparecer | NÃO EXECUTADO |  |  |
| BKP-01 | Criar `.bauerlife`, conferir data/idade do último backup e salvar em Arquivos/iCloud Drive | NÃO EXECUTADO |  |  |
| BKP-02 | Em banco/origem vazia, restaurar o backup; comparar 13 domínios, configurações, exclusões e métricas | NÃO EXECUTADO |  |  |
| BKP-03 | Tentar senha errada e arquivo adulterado; banco ativo deve permanecer intacto | NÃO EXECUTADO |  |  |
| EXP-01 | Exportar JSON/CSV e relatório seletivo; conferir período, campos, domínio e aviso de privacidade | NÃO EXECUTADO |  |  |
| PWA-01 | Publicar build posterior; banner de atualização deve aparecer sem interromper edição | NÃO EXECUTADO |  |  |
| PWA-02 | Salvar, aceitar atualização e conferir recarga na nova versão sem perda | NÃO EXECUTADO |  |  |

## Acessibilidade e ergonomia

| ID | Passo e critério de aprovação | Resultado | Evidência/arquivo | Executor/data |
|---|---|---|---|---|
| A11Y-01 | VoiceOver: percorrer as cinco áreas, formulários, métricas e diálogos com nomes/estados corretos | NÃO EXECUTADO |  |  |
| A11Y-02 | VoiceOver: salvar, editar, excluir, desfazer, exportar e restaurar sem gesto visual obrigatório | NÃO EXECUTADO |  |  |
| A11Y-03 | Maior tamanho de texto/Dynamic Type: sem corte, sobreposição ou controle inacessível | NÃO EXECUTADO |  |  |
| A11Y-04 | Zoom do Safari em 200%: fluxo crítico continua legível e operável | NÃO EXECUTADO |  |  |
| A11Y-05 | Contraste e significado não dependem apenas de verde/vermelho/amarelo | NÃO EXECUTADO |  |  |
| IOS-01 | Teclado não cobre campo, erro, Salvar nem navegação; foco e retorno funcionam | NÃO EXECUTADO |  |  |
| IOS-02 | Safe areas respeitadas em retrato, rotação e com barra/ilha dinâmica | NÃO EXECUTADO |  |  |
| IOS-03 | Todos os alvos críticos têm pelo menos 44 pt e não exigem precisão fina | NÃO EXECUTADO |  |  |

## Escala anual e tempos

Carregar o dataset anual antes de medir. Fazer três repetições; registrar mediana e pior valor. Não apagar resultados ruins.

| Medição | Meta de aceite | R1 | R2 | R3 | Mediana/pior | Resultado/evidência |
|---|---:|---:|---:|---:|---:|---|
| Abertura fria online | ≤ 3 s até conteúdo útil |  |  |  |  | NÃO EXECUTADO |
| Abertura fria offline | ≤ 3 s até conteúdo útil |  |  |  |  | NÃO EXECUTADO |
| Abrir Arquivo com 365 dias | ≤ 2 s |  |  |  |  | NÃO EXECUTADO |
| Busca no histórico | ≤ 500 ms percebidos |  |  |  |  | NÃO EXECUTADO |
| Trocar painel 60 → 365 dias | ≤ 2 s |  |  |  |  | NÃO EXECUTADO |
| Salvar registro | ≤ 1 s até confirmação |  |  |  |  | NÃO EXECUTADO |
| Backup anual | ≤ 15 s e UI responsiva |  |  |  |  | NÃO EXECUTADO |
| Restauração anual | ≤ 30 s, progresso visível |  |  |  |  | NÃO EXECUTADO |
| Fechamento diário comum | ≤ 90 s do início à confirmação |  |  |  |  | NÃO EXECUTADO |
| Armazenamento antes/depois | crescimento compatível com dataset/export |  |  |  |  | NÃO EXECUTADO |

## Registro de falhas

| ID relacionado | Severidade | Passos para reproduzir | Esperado × observado | Evidência | Decisão/reteste |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Encerramento do gate

| Campo | Preenchimento obrigatório |
|---|---|
| Itens críticos PASS/total |  |
| Falhas abertas |  |
| Riscos aceitos e responsável |  |
| Commit/build aprovado |  |
| Executor |  |
| Revisor independente |  |
| Data |  |
| Decisão final | **PENDENTE — NÃO EXECUTADO** |

Somente substituir a decisão por `PASS` após anexar evidência dos fluxos em aparelho físico. Testes automatizados de PWA, analytics ou viewport não substituem esta prova.
