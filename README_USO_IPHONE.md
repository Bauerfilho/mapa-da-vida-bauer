# Mentor Bauer — uso no iPhone

O Mentor Bauer é uma PWA local-first, pessoal e privada. Os registros ficam no armazenamento do aplicativo no iPhone; o site não consulta bancos, e-mail, calendário, prontuários ou serviços de saúde.

## Instalar na Tela de Início

1. Abra [a versão pessoal no GitHub Pages](https://bauerfilho.github.io/mapa-da-vida-bauer/) no Safari após a publicação concluir. Não há login ChatGPT nesse endereço. Os registros do Site anterior não são transferidos automaticamente: confira o [guia de backup e mudança de endereço](README_GITHUB_PAGES.md).
2. Compartilhe a página pelo menu do Safari; dependendo do layout, a ação fica no botão **Mais** ou diretamente em **Compartilhar**.
3. Selecione **Adicionar à Tela de Início**, mantenha **Abrir como App da Web** ativado e conclua em **Adicionar**.
4. Abra o ícone **Mentor Bauer** com internet e aguarde a conferência do conteúdo essencial para uso offline.

O caminho foi conferido no [manual atual da Apple para iOS 26](https://support.apple.com/pt-br/guide/iphone/iphea86e5236/26/ios/26). A instalação no aparelho físico ainda precisa ser validada nele; não foi automatizada nesta entrega.

Depois disso, o núcleo do aplicativo abre sem internet. Uma atualização só é ativada quando o próprio Mentor mostrar **Atualização pronta** e você tocar nela.

## Memória e recuperação

- Janelas de análise de até **365 dias**. Mudar a janela não apaga os registros guardados.
- Painel padrão: **bimestre civil atual**, com ciclos anteriores e janelas móveis de 7, 30, 60, 180 e 365 dias.
- Registros excluídos: recuperáveis por **60 datas civis**, enquanto o armazenamento local do aplicativo permanecer intacto.
- Campos vazios permanecem desconhecidos; não viram zero, ausência, atraso, falta ou dose pulada.
- Backup portátil: arquivo `.bauerlife` cifrado com AES-256-GCM e chave derivada por PBKDF2-SHA-256.
- A senha do backup não pode ser recuperada. Guarde-a fora do aplicativo.
- O arquivo exportado é cifrado; o banco local do navegador não é cifrado pelo app. A conta e o aparelho também precisam estar protegidos.

A partir do 13º mês, a revisão mensal no Arquivo permite conferir fatos antigos para retirada. A operação exige um backup reaberto e validado, além de confirmação; compromissos pendentes, configurações, dependências e dados recentes permanecem protegidos. Não há exclusão silenciosa por idade.

Faça um backup após uma semana importante e antes de limpar dados do Safari, trocar de aparelho ou reinstalar o app. O status no topo informa quando o último backup foi entregue.

## Centros do aplicativo

- **Hoje:** agora, três prioridades, check-in e próxima ação.
- **Agenda:** tarefas, eventos, metas mínima/boa/padrão-ouro, conflitos e buffers.
- **Registrar:** Internato, Estudos, Medicações, Sono, Alimentação, Humor, Cefaleia, Bruxismo, Finanças, Rotina, Agenda, Ferramentas de IA, Conhecimento e Meus exames.
- **Mentor:** métricas por domínio, janela, amostra, dados ausentes e no máximo três sugestões explicáveis.
- **Arquivo:** busca, histórico, edição por revisão, exclusão recuperável, preferências, backup, restauração, exportações e relatório configurável para consulta.

Em **Hoje → Fechar meu dia**, você pode registrar apenas estado parcial/concluído, uma reflexão e a próxima ação. Esse fluxo curto não fabrica prioridades, blocos nem uma nota geral. O planejamento completo continua disponível em Rotina.

Em **Arquivo → Preferências e metas**, configure opcionalmente Base/Boa/Ouro, referência pessoal de sono, texto ampliado, redução de movimento e contraste reforçado. Campo não configurado continua desconhecido; o aplicativo não inventa metas padrão.

Medicamentos separa regimes e trilho de doses de estoque/reposição e uso SOS. Nenhuma dessas telas recomenda tomar, suspender ou ajustar uma medicação.

Finanças reconhece Mercado Pago, Banco do Brasil e PicPay como instituições informadas. Registra movimentos, contas/faturas, dívidas, juros informados, orçamento, metas, assinaturas recorrentes e retratos de cartões. No cartão, limite, fatura, saldo, fechamento, vencimento e parcelas só entram quando você os informar; o app não pede senha, CVV, token ou número completo.

O check-in rápido da tela Hoje usa energia **1–5**. O diário de Humor usa energia funcional **0–4** e humor **−2 a +2**. As escalas permanecem identificadas e não são convertidas silenciosamente.

O relatório para consulta mantém essas famílias separadas nas médias e na cronologia. Dados sem versão de escala confirmada não entram nas médias; valores numéricos brutos ficam identificados para revisão. Se você criou um relatório anterior reunindo as duas escalas de energia, gere um novo arquivo nesta versão. Os registros originais não foram modificados.

JSON, CSV e relatório TXT não são cifrados. JSON/CSV podem incluir os documentos dos exames, enquanto o relatório TXT usa valores e contagens de documentos. Para backup protegido e restauração, escolha `.bauerlife`.

O diário de Humor permite levar contexto para consulta, incluindo necessidade percebida de sono, mudança do padrão habitual, fatores protetores e mudança medicamentosa relatada. A pergunta de segurança registra somente a resposta dada naquele momento: “sim” não prova ausência de risco, “não” não é diagnóstico, e o aplicativo não monitora emergências nem envia alertas.

## Limites desta versão

- Lembretes com a PWA fechada, HealthKit e sincronização nativa de calendário não estão implementados. Datas anuais podem ser exportadas manualmente como calendário; alertas e importação precisam ser conferidos no aparelho.
- Google/Outlook, e-mail e Open Finance não estão conectados nesta versão; nenhuma credencial é solicitada.
- Cenários de quitação são apenas projeções descritivas baseadas nos valores que você informou; não constituem recomendação financeira, oferta de crédito ou promessa de economia.
- Humor, sono, cefaleia e bruxismo geram descrições e padrões para revisão, não diagnósticos nem alteração de medicação.
- Não registre nomes, prontuários ou qualquer dado identificável de pacientes.

Ao gerar um `.bauerlife`, confirme que ele aparece no app Arquivos ou no destino escolhido no compartilhamento. Se o iPhone informar pouco espaço, preserve esse arquivo antes de limpar o Safari. Armazenamento local de navegador nunca deve ser a única cópia de algo insubstituível.
