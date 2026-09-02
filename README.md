# Mentor Bauer

Aplicativo pessoal para acompanhar rotina, saúde, estudos, compromissos e finanças. A interface aceita — palha, vinho e dourado — permanece organizada em cinco centros.

[Abrir a versão pessoal no GitHub Pages](https://bauerfilho.github.io/mapa-da-vida-bauer/)

Esta implantação serve a interface pessoal publicamente, sem login. Os registros continuam locais ao navegador e não são enviados ao repositório. O endereço anterior não compartilha seu banco automaticamente: confira [acesso no celular, backup e publicação Pages](README_GITHUB_PAGES.md) antes de trocar de instalação. A versão compilada fica disponível após o workflow de publicação concluir.

| Centro | Uso principal |
| --- | --- |
| Hoje | Compromissos, registros rápidos, lembretes e fechamento do dia. |
| Agenda | Horários, tarefas, aniversários e compromissos anuais. |
| Registrar | Áreas pessoais, exames laboratoriais e consulta hospitalar. |
| Mentor | Métricas por valor, dados de origem, bimestres e janelas de até um ano. |
| Arquivo | Histórico, revisão, backup cifrado e manutenção protegida. |

## Continuidade dos dados

Os registros ficam no IndexedDB do navegador, no aparelho e endereço em que foram criados. O Git guarda o código, não o banco pessoal. Atualizar a aplicação pelo botão **Atualização pronta** preserva esse banco; mudar de navegador, perfil ou endereço não transfere os registros automaticamente.

Mantenha cópias pelo Arquivo. O backup é cifrado com a senha escolhida no momento da exportação; a aplicação não guarda essa senha. Sem ela, o arquivo não pode ser recuperado. A cifra protege o arquivo exportado: os registros locais dentro do navegador não são cifrados pelo app. Bloqueio do aparelho e proteção da conta continuam importantes.

A partir do 13º mês, o Arquivo oferece revisão dos fatos antigos. Nada é retirado apenas por idade: é necessário reabrir e conferir um backup que contenha os registros e suas dependências, revisar o lote e confirmar. Configurações, compromissos pendentes e dados recentes permanecem protegidos. A mudança de bimestre muda a análise, nunca apaga o histórico.

JSON, CSV e relatório para consulta são exportações sem cifra. JSON/CSV podem incluir os documentos dos exames; confira o destino antes de compartilhar. Eles não substituem o `.bauerlife`. O relatório de consulta separa energia rápida (1–5), matriz funcional (energia 0–4) e humor legado identificado (1–5), sem converter ou misturar as escalas.

Se um campo antigo estiver marcado como não conhecido, seu valor residual não é divulgado. Uma forma ambígua que não possa ser classificada com segurança interrompe a exportação legível com aviso, sem apagar os registros nem impedir o backup cifrado.

## Apoio hospitalar

Consulta rápida inclui catálogo inicial de CIDs e sinônimos, terminologia de exames, identificação de apresentações comerciais e referências gestacionais com fontes e limites. Não é a tabela completa do CID-10 nem um prescritor. O SOAP é um rascunho temporário: acompanha as ferramentas do Internato e é descartado ao sair dessa área; não entra no banco ou backup. Não insira identificadores de pacientes.

O registro de tomada informa o que foi relatado, não confirma que um esquema farmacológico é apropriado. O app não escolhe doses, substitui medicamentos nem infere adesão a partir de ausência de registro.

## Limites explícitos

- A interface no GitHub Pages é pública; o banco pessoal continua local. A restrição de acesso ao proprietário permanece apenas no Site anterior, que não foi alterado.
- Não há sincronização automática com Google Drive ou entre aparelhos. Um backup pode ser guardado no destino escolhido pelo usuário.
- A exportação de calendário é manual. Alterações posteriores no app não atualizam o arquivo já importado.
- O uso offline foi exercitado em navegador real após carregar a aplicação. Instalação, alertas e permissões no iPhone físico exigem conferência no próprio aparelho.
- Não há promessa de tarefas ou alertas executados com a PWA fechada.

## Desenvolvimento e verificação

Dependências do lockfile, sem scripts de instalação: `npm ci --ignore-scripts`.

- `npm run dev -- --port 4173`: ambiente local.
- `npm run validate`: integridade dos 28 arquivos móveis protegidos, TypeScript, testes de domínio, compilação e testes Node.
- `npm run test:runtime`: jornadas de navegador, inclusive backup, edição, calculadoras, arquivo e runtime móvel.
- `node scripts/verify-pwa-upgrade.mjs --before <build-anterior>/dist/client --after <build-nova>/dist/client --output <pasta-da-prova>`: atualização real na mesma origem e perfil, aceitação pelo botão, igualdade dos registros e escrita/reabertura offline. As duas builds precisam existir e ser diferentes.

O protocolo móvel protegido não deve ser alterado para corrigir a aplicação. Estado de continuidade em `RESUME.md`; marcos e provas em `docs/NOTURNO_MARCOS.md`.
