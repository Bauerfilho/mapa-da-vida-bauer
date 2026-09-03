# Atualização de aparência — aurora vinho B

Direção escolhida pelo Bauer em setembro de 2026: aurora vinho viva, grade rubi fina e tipografia original do Mentor. O cabeçalho tem somente um botão sem texto: sol no escuro, lua no claro. A pausa do fundo fica em Arquivo → Preferências → Leitura e movimento.

## Preservação

Esta atualização não muda dados, catálogos médicos, rotinas de armazenamento, identidade do proprietário ou conteúdo das áreas. Experimentos de SOAP persistente, HUB móvel e Obstetrícia Clara não fazem parte deste release. Ícones e fontes são as dependências já existentes; o runtime móvel protegido permanece sem alterações.

## Comportamento

- Tema e pausa são preferências locais; não contêm informação pessoal.
- O fundo para quando a página fica oculta e retorna sem salto do relógio.
- Movimento reduzido é respeitado; o controle informa a pausa efetiva.
- Sem WebGL, a grade estática permanece e o aviso não cobre o botão de tema. Uma superfície gráfica inválida fica oculta.
- A escolha claro/escuro permanece disponível offline.
- Atualizações usam o mecanismo de cache existente; não apagar dados nem reinstalar o PWA para trocar de tema.

## Verificações do delta

Typecheck e integridade dos 28 arquivos protegidos passaram. O pacote recebeu testes de movimento/pausa, preferências conflitantes, fallback gráfico, contraste de superfícies, navegação, cache e registros sintéticos offline. A revisão independente do Copilot apontou quatro defeitos, corrigidos e aprovados na R1. A inspeção visual encontrou quatro problemas em três telas, todos resolvidos na rechecagem. Essas provas são técnicas, não validação clínica.
