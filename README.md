# Miaumigo 🐾

App web para gerenciar a vida dos seus pets: perfil, saúde, peso e gastos.
Funciona sem instalar nada e os dados ficam salvos no próprio navegador.

## Como rodar

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Depois abra http://localhost:5173.

## O que tem

- **Pets**: perfil com foto, espécie, raça, sexo, nascimento (idade calculada), castração, microchip, veterinário e observações.
- **Saúde e agenda**: vacinas, vermífugo, antipulgas, remédios, consultas e banho. Com repetição: ao marcar como feito, o próximo é agendado sozinho.
- **Peso**: histórico com gráfico e variação desde a última pesagem.
- **Carteirinha de vacinação**: vacinas, vermífugos e antipulgas aplicados, com a próxima dose. Imprime ou salva em PDF e pode ser compartilhada como texto (WhatsApp, e-mail).
- **Ração**: pacote atual com peso e consumo diário; mostra quanto resta, até quando dura, avisa quando está acabando e lança o preço nos gastos. Guarda o histórico e calcula o custo médio por dia.
- **Anexos**: fotos e PDFs (receitas, exames, comprovantes) em cada cuidado. Ficam no IndexedDB do navegador, fotos reduzidas para até 1600 px, limite de 10 MB por arquivo.
- **Gastos**: por mês, por categoria e por pet, com comparação com o mês anterior.
- **Início**: atrasados, próximos cuidados, total do mês e aviso de aniversário.
- **Lembretes**: cada cuidado pode avisar no dia, 1, 3 ou 7 dias antes, no horário escolhido em Configurações.
  - *Notificações do navegador*: disparam quando o app está aberto ou volta a ser aberto (um app web não consegue acordar sozinho sem servidor de push).
  - *Calendário do celular*: “Enviar para o calendário” gera um `.ics` com alertas e repetição; o aviso chega mesmo com o app fechado.
- **Instalável (PWA)**: funciona offline e pode ser adicionado à tela inicial do celular.
- **Backup**: exportar e importar em JSON, incluindo os anexos (engrenagem na tela inicial). Tema claro, escuro ou automático.

## Abertura e login

- **Splash screen** animada na cor do app; some quando o app carregou e o login foi verificado (mín. ~1 s, máx. 4 s). Ícones PNG (192, 512, maskable e Apple) em `icons/` para a abertura nativa do Android emendar na animação.
- **Tela de login** na primeira abertura: Continuar com o Google, e-mail e senha (entrar, criar conta, recuperar senha) ou "Usar sem conta" (lembrado no aparelho).
- **Login com Google**: projeto `Miaumigo` no Google Cloud (conta pessoal), tela de consentimento em produção, escopos só de e-mail e perfil. Ligado por `googleLogin: true` em `config.js`. Se o e-mail do Google já tiver conta, o Supabase une as duas.
- **Política de privacidade** pública em `privacidade.html` (exigida pelo Google).

## Conta e sincronização (Supabase)

Opcional: sem conta, tudo funciona só no aparelho. Com conta, os dados viram uma cópia sincronizada na nuvem.

- **Configurar**: siga [`supabase/CONFIGURAR.md`](supabase/CONFIGURAR.md) (criar projeto, rodar [`schema.sql`](supabase/schema.sql), ajustar o login) e preencha `config.js` com a URL e a chave publicável.
- **Como funciona**: offline primeiro. Sincroniza ao abrir o app, ~2,5 s depois de cada alteração, ao voltar para o app, ao reconectar e a cada minuto. Baixa o que mudou na nuvem, envia o que mudou no aparelho (inclusive exclusões) e sincroniza os anexos no Storage.
- **Conflito**: se o mesmo registro mudar nos dois lados, vale o do aparelho que está sincronizando.
- **Segurança**: regras de acesso (RLS) no banco e no Storage; cada pessoa só vê os próprios dados. A chave no app é a publicável (pública); a secret/service_role nunca vai para o app.
- **Apagar todos os dados** com a conta conectada apaga só o aparelho e sai da conta; a nuvem fica intacta.
- Biblioteca: `@supabase/supabase-js` 2.118.0, embutida em `vendor/` para o app abrir offline.

## Ícones

[Lucide](https://lucide.dev) v1.69.0 (licença ISC), estilo outline. Os SVGs usados ficam embutidos em `icons.js`, então o app não depende de CDN. Para adicionar um ícone, pegue o conteúdo do SVG em `https://unpkg.com/lucide-static@1.69.0/icons/<nome>.svg` e inclua no objeto `ICONS`.

## Arquivos

- `index.html`: estrutura e navegação
- `styles.css`: visual (mobile first, modo escuro)
- `app.js`: dados, telas, formulários e lembretes
- `sync.js`: login, conta e sincronização com o Supabase
- `config.js`: URL e chave publicável do Supabase
- `supabase/`: SQL do banco e guia de configuração
- `vendor/supabase.js`: cliente do Supabase
- `icons.js`: ícones Lucide embutidos
- `sw.js`, `manifest.webmanifest`, `icon.svg`: PWA (offline, instalação e notificações)
- `serve.ps1`: servidor local em PowerShell

## Menu "Minha conta" (v1.4)

- O avatar no topo do início abre o menu: Configurações (uma tela única com Lembretes, Aparência, Calendário e Conta), Instalar o app, Painel de uso (só administradores), Ajuda e sobre, Sair.
- "Baixar meus dados" (Configurações → Conta) substitui o backup/importação.
- **Instalar o app** (`install.js`): no Android/computador abre a janela nativa de instalação; no iPhone mostra o passo a passo do Safari; em navegadores internos (WhatsApp, Instagram) orienta a abrir no navegador.

## Manter o Supabase ativo

O plano gratuito pausa após 7 dias sem atividade. A tarefa `.github/workflows/manter-ativo.yml` chama `ping()` (`supabase/ping.sql`) todo dia às 08:17. Se falhar, o GitHub avisa por e-mail. O GitHub desativa tarefas agendadas após 60 dias sem commits no repositório (avisa antes); para reativar, faça um commit ou clique em "Enable workflow" na aba Actions.
