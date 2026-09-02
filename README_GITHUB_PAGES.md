# Mentor Bauer pessoal — GitHub Pages

Destino desta versão: [Mentor Bauer no GitHub Pages](https://bauerfilho.github.io/mapa-da-vida-bauer/). A disponibilidade da versão compilada depende de o workflow de publicação terminar com sucesso; o build local, sozinho, não a publica.

Esta é a versão **pessoal**, com a rotina inicial, identificação, modelo, logo e ícones originais. Não é a edição comunitária, não é SaaS e não oferece contas. Publicar o código/interface não publica os registros guardados no navegador. O acesso à página, porém, é público: não há a restrição de conta do antigo Site.

## Abrir no celular

1. Abra o link acima no Safari, com internet, após a publicação terminar.
2. Aguarde o aplicativo carregar e concluir a preparação offline.
3. No menu de compartilhamento do Safari, escolha **Adicionar à Tela de Início** e abra o ícone criado. Os nomes dos menus podem variar conforme o iOS.
4. Confira a abertura pelo ícone antes de depender do modo offline. Testes em Chromium não substituem a validação no seu iPhone físico.

## Os dados do endereço anterior não aparecem automaticamente

GitHub Pages e o Site anterior são origens diferentes. O banco continua se chamando `bauer-life-mentor`, mas pertence ao endereço e ao navegador: **não há migração automática ou leitura do Site antigo**.

Se precisar trazer os registros, faça o backup `.bauerlife` na instalação anterior, confirme que o arquivo foi guardado e use a restauração explícita na nova instalação. A senha é digitada apenas pelo titular na interface. Não coloque o arquivo nem a senha no GitHub, em issues, em conversas de revisão ou em ferramentas de IA. JSON/CSV/TXT não são cifrados; o banco local também não é cifrado pelo app.

O endereço `bauerfilho.github.io` é a mesma origem para todos os seus projetos Pages. O service worker e os caches desta versão ficam limitados à subpasta, mas IndexedDB não é separado por caminho. Evite instalar nesse mesmo domínio outra aplicação que use o mesmo nome de banco; projetos não relacionados na mesma origem devem ser confiáveis. Esta mudança não altera nem limpa banco de outra aplicação.

## Compilação e publicação

```sh
# Usar as dependências travadas do projeto.
npm ci --ignore-scripts
# Build específico de Pages, sem metadados ou conta Sites.
npm run build:pages
# Provas locais da distribuição, com Chromium do Playwright já instalado.
npm run validate:pages
```

`dist/client` é o único artefato enviado ao Pages. A base é `/mapa-da-vida-bauer/`. Um plugin autoral transforma em memória exatamente sete caminhos de assets nos dois módulos protegidos, antes de calcular os nomes dos chunks; nenhum arquivo protegido ou hash de integridade é alterado.

O workflow usa Actions fixadas por SHA oficial, instala o navegador apenas no runner efêmero, executa os testes e publica o artefato estático. Os scripts legados `build`, `validate` e `test:sites` continuam reservados ao empacotamento Sites; não são o caminho de publicação Pages.

O manifesto e o service worker usam seu próprio diretório. O cache `mapa-da-vida-bauer-pages-shell-*` não apaga caches de outras PWAs. A atualização continua exigindo aceitação: uma versão aguardando não substitui silenciosamente a casca em uso.

## Avisos e limites

[Avisos integrais de terceiros](THIRD_PARTY_NOTICES.md) acompanham a distribuição e são servidos como documento, sem fallback para a interface. Eles conservam as licenças de fontes/bibliotecas e **não relicenciam o aplicativo pessoal como MIT**.

Esta implantação não muda conteúdo médico, integrações, dados iniciais ou fluxo de uso. Não conecta bancos, calendário, e-mail ou IA. Não há promessa de alertas com a PWA fechada. O titular conduz a avaliação de uso com Claude; os testes desta implantação são provas técnicas do autor, não revisão independente.
