# Cobertura do Plano Mestre — Mentor Bauer vNext

**Data da consolidação:** 01/09/2026  
**Identidade:** Bauer Vieira · nº 7 · UNIFIMES  
**Direção visual:** editorial clara em palha, vinho e dourado, com inteligência analítica contextual  
**Estado:** implementação concluída e compilada; destino HTTPS privado restrito à conta do proprietário; gate físico no iPhone ainda pendente

## Regra de produto preservada

O Mentor Bauer não é um painel decorativo nem um “score da vida”. Seu fluxo operacional é:

> registrar um fato → compreender um padrão com contexto → escolher uma próxima ação pequena

Um dado vazio permanece **desconhecido**. Ele não vira ausência, atraso, falta, dose pulada, zero, inadimplência ou falha pessoal. Métricas mostram janela, amostra e dados ausentes. Elementos visuais só permanecem quando registram, explicam ou orientam.

## Cinco centros funcionais

| Centro | Cobertura consolidada |
|---|---|
| **Hoje** | Momento atual, jornada, medicação, até três essenciais, check-in gentil de energia, estado local/offline, backup e fechamento diário curto sem nota geral. |
| **Agenda** | Eventos e tarefas separados, escala, próximos compromissos, conflitos, buffers, carga futura e estado correto “sem escala confirmada”. |
| **Registrar** | Entrada contextual para os 13 domínios, captura rápida e formulários que preservam verdadeiro/falso/desconhecido/não aplicável. |
| **Mentor** | Painéis de 7/30/60/180/365 dias, cobertura dos 13 domínios, `n`, ausentes, incerteza e no máximo três próximas ações explicáveis. |
| **Arquivo** | Histórico canônico de 365 dias, busca, filtros, edição por nova revisão, exclusão recuperável, desfazer, preferências, exportações, relatório seletivo, backup cifrado e restauração segura. |

## Treze domínios e sua utilidade

| Domínio | Registro e memória | Compreensão e próxima ação |
|---|---|---|
| **Internato** | Escala planejada, presença, chegada, saída, intervalo, plantão noturno, falta/troca/dispensa, participação, tópicos e feedback. | Pontualidade sem médias enganosas, horas reais, lacunas clínicas e ligação com revisão de estudo. |
| **Estudos** | Tema, objetivo, método, planejado × real, questões, acertos, confiança, recuperação ativa e revisão. | Metas pessoais Base/Boa/Ouro, cobertura, estimativa, acurácia com amostra e vínculo internato → estudo. |
| **Medicamentos** | Regime, dose, horário planejado, tomada, atraso, pulo confirmado, estoque/reposição e uso SOS. | Adesão usa todos os horários planejados como denominador; silêncio nunca vira dose pulada; nenhuma recomendação de ajuste. |
| **Sono** | Deitar, tentar dormir, adormecer, despertares, acordar, levantar, cochilos e qualidade. | Duração, latência, eficiência, regularidade e referência pessoal configurável, sem avaliar automaticamente quando faltam dados. |
| **Alimentação** | Refeições, omissão confirmada, hidratação incremental, cafeína e apetite. | Ritmo, maiores intervalos e coexistência com sono/cefaleia; sem calorias ou peso por padrão. |
| **Humor** | Humor −2…+2, energia funcional 0…4, ansiedade, irritabilidade, impulsividade, pensamento, funcionamento, sono percebido, fatores protetores, mudança medicamentosa e resposta de segurança. | Tendências e cobertura para revisão clínica; schema v2 mantém v1 compatível; sem diagnóstico, cálculo de risco ou monitoramento contínuo. |
| **Cefaleia** | Dia/crise, duração, intensidade, sinais associados, incapacidade, medicamento agudo e resposta; ausência confirmada separada de desconhecido. | Dias com cefaleia, crises, incapacidade, medicamento agudo e padrões operacionais com amostra explícita. |
| **Bruxismo/ATM** | Check-ins manhã/noite, dor/rigidez, apertamento, limitação, placa e intervenção. | Padrão próprio, relacionado a sono/cefaleia sem fundir os eventos. |
| **Finanças** | Mercado Pago, Banco do Brasil, PicPay e instituições manuais; movimentos, contas, faturas, dívidas, juros, orçamento, metas, cartões, parcelas e assinaturas. | Fluxo de caixa, obrigações 7/30 dias, limites/faturas, cenários descritivos e assinaturas somente quando `active_confirmed`; nenhum pagamento ou credencial. |
| **Rotina** | Capacidade, prioridades, âncoras, blocos, replanejamento, recuperação, reflexão e próxima ação. | Planejamento completo e fechamento rápido separados; replanejar é resultado válido; nenhuma sequência punitiva ou nota geral. |
| **Agenda** | Compromissos com hora e tarefas como objetos distintos. | Conflitos, buffers, carga, atraso explícito e itens sem próxima ação. |
| **Ferramentas de IA** | Ferramenta, projeto, custo, renovação, uso e entrega produzida. | Gasto, sobreposição, custo por entrega e candidatos a testar/manter/reduzir/cancelar, nunca cancelamento automático. |
| **Conhecimento** | Pérolas, dicas do hospital, tópicos, ligações, questões e revisão futura. | Notas a recuperar, assuntos sem revisão e aprendizados convertidos em ação. |

## Memória, privacidade e recuperação

- IndexedDB incremental, isolado por conjunto de dados; fatos sensíveis não ficam em `localStorage`.
- Histórico integral de **365 dias** e painel padrão de **60 dias**.
- Backup `.bauerlife` cifrado, validado antes de ser entregue e confirmado pelo usuário somente após aparecer no compartilhamento/Arquivos.
- Restauração em staging, com checksum, prévia, plano imutável, mesclagem segura, conflitos isolados e trilha de revisões/operações remapeada para o conjunto recuperado.
- Preferências de estudo, sono e acessibilidade entram no backup; configuração local diferente não é sobrescrita silenciosamente.
- Exclusões e edições preservam histórico e permitem recuperação conforme as regras do Arquivo.
- PWA instalável, shell offline versionado e atualização ativada somente por ação explícita.
- Nenhuma telemetria de conteúdo, credencial bancária, CVV, token, dado identificável de paciente ou diagnóstico automático.

## Preferências e acessibilidade

- Metas Base/Boa/Ouro configuráveis e opcionais; vazio não ganha valor inventado.
- Referência e faixa pessoal de sono opcionais.
- Texto ampliado, redução de movimento e contraste reforçado aplicados por classes reais.
- Controles críticos com alvo mínimo próximo de 44 pt.
- Retenção e estado do armazenamento descritos com linguagem honesta, sem prometer que o Safari é uma cópia infalível.

## Entregue agora × fases posteriores

| Entregue nesta implementação | Deliberadamente posterior |
|---|---|
| PWA local-first, offline, 13 domínios, cinco centros, métricas, Mentor, finanças manuais, hub obstétrico efêmero em Internato, importação dos betas, backup/restauração e relatório seletivo. | Google/Outlook em leitura, e-mail seletivo, Open Finance com provedor confiável, sincronização privada opcional. |
| Uso sem login no aparelho e pacote preparado para origem privada. | Capacitor/iOS para notificações locais confiáveis, HealthKit, calendário do aparelho e proteção nativa/Face ID. |
| Atualização explícita do shell e dados locais independentes do cache. | Apple Watch, widgets, App Intents e demais recursos Apple-first. |

## Gates desta consolidação

- TypeScript e build de produção: **PASS**.
- Runtime móvel protegido: **28/28 PASS**.
- Testes puros/de domínio: **208/208 PASS**.
- Testes Node de analytics, Mentor, PWA, cache, CSP e hospedagem: **44/44 PASS**.
- Total automatizado executado nesta bateria: **252 PASS**.
- Worker de hospedagem: **4/4 PASS** — já incluídos nos 44 testes Node.
- Integridade de diff: **PASS**.
- Betas legados: checksums originais preservados.

## Limites que não serão maquiados

- Os cenários browser-backed de IndexedDB estão implementados e compilam, mas o executor atual não possui o Chromium exigido para executá-los.
- O gate físico no **iPhone 16 Pro Max** permanece **NÃO EXECUTADO** até instalação real, modo avião, force-close, backup/restauração, VoiceOver, Dynamic Type, teclado e desempenho anual serem registrados com evidência.
- A origem HTTPS está configurada em modo privado somente para a conta do proprietário, sem grupos ou visitantes externos; o teste físico com um usuário não autorizado ainda integra o checklist do iPhone.
- A PWA local não oferece Face ID próprio. O arquivo externo `.bauerlife` continua obrigatório contra limpeza de dados do Safari, troca de origem, perda ou reinstalação.

O checklist físico detalhado está em `docs/QA_IPHONE_16_PRO_MAX.md`.
