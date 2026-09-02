# Design QA — direção 2 + inteligência da direção 3

Data: 01/09/2026
Alvo: iPhone, modo claro editorial palha/vinho/dourado
Referência: direção visual escolhida pelo usuário

## Comparação executada

A referência e a implementação renderizada foram avaliadas juntas no mesmo estado **Hoje**, no mesmo aspecto de tela móvel. Foram conferidos hierarquia, cor, tipografia, divisores, ritmo, CTA principal, três essenciais, check-in, métrica e navegação inferior.

Resultado: a assinatura visual foi preservada — fundo palha, vinho como ação, ouro como orientação, tipografia editorial e ícones lineares. A implementação mantém o insight analítico como instrumento explicável, com janela, amostra e incerteza.

## Desvios deliberados

- Controles interativos mantêm alvo de toque de aproximadamente 44 px ou mais, mesmo quando o mock era mais compacto.
- O insight completo pode exigir uma rolagem curta em telas menores; não foram sacrificados legibilidade nem alvo de toque para caber tudo na primeira dobra.
- A moldura de preview inclui barra de status, Dynamic Island e área segura. A PWA instalada usa a área real do aparelho.
- Estados demonstrativos só aparecem com o parâmetro visual de QA; não entram como fatos pessoais no aplicativo real.

## Gates visuais aprovados

- Sem corte horizontal no iPhone.
- Barra inferior não cobre conteúdo ou teclado.
- Teclado fecha após salvar Agenda e Finanças.
- Folhas inferiores preservam área segura e feedback de erro.
- Estados vazio, desconhecido, confirmação, sucesso, erro e offline são visualmente distintos.
- Nenhum elemento visual existe apenas como decoração: cada um orienta, registra, explica ou abre uma ação.
