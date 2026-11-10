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
- **Segurança**: regras de acesso (RLS) no banco e no Storage; cada pessoa só vê os dados da própria família. A chave no app é a publicável (pública); a secret/service_role nunca vai para o app.
- **Apagar todos os dados** com a conta conectada apaga só o aparelho e sai da conta; a nuvem fica intacta.
- Biblioteca: `@supabase/supabase-js` 2.118.0, embutida em `vendor/` para o app abrir offline.

## Ícones

[Lucide](https://lucide.dev) v1.69.0 (licença ISC), estilo outline. Os SVGs usados ficam embutidos em `icons.js`, então o app não depende de CDN. Para adicionar um ícone, pegue o conteúdo do SVG em `https://unpkg.com/lucide-static@1.69.0/icons/<nome>.svg` e inclua no objeto `ICONS`.

## Arquivos

- `index.html`: estrutura e navegação
- `styles.css`: visual (mobile first, modo escuro)
- `app.js`: dados, telas, formulários e lembretes
- `sync.js`: login, conta e sincronização com o Supabase
- `familia.js`: família, convites e pets "Só meus"
- `notas.js`: notas por pet
- `premium.js`: planos, avisos de Premium e liberação pelo painel
- `conta.js`: trocar senha e excluir conta
- `relatorio.js`: relatório para o veterinário
- `push.js`: lembretes com o app fechado (Web Push)
- `termos.html`, `privacidade.html`: termos de uso e política de privacidade
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

## Família (v1.6)

Cada pessoa tem pets **"Só meus"** (só ela vê) e pode participar de **uma família**, onde todos veem e editam os pets compartilhados.

- **Banco**: [`supabase/familia.sql`](supabase/familia.sql) (v1.5) e depois [`supabase/espacos.sql`](supabase/espacos.sql) (v1.6). Tabelas `familias` (`pessoal = true` é o espaço "Só meus"), `familia_membros` (papel `responsavel` ou `membro`; no máximo um espaço pessoal e uma família por pessoa) e `convites` (link de uso único, expira em 7 dias, revogável). `registros` tem `familia_id` (chave: espaço + id) e `updated_by` (quem alterou, definido pelo servidor).
- **Regras de acesso**: cada pessoa lê e altera só os registros dos próprios espaços (`minhas_familias()`). Arquivos em `anexos/<espaço>/<anexo>`; um arquivo pode ser lido/apagado se estiver na pasta de um espaço da pessoa ou se um anexo de um espaço dela apontar para ele (por isso um pet compartilhado leva os anexos sem mover arquivo). As tabelas de família não têm acesso direto pela API: tudo passa pelas funções `meus_espacos`, `criar_convite` (cria a família no primeiro convite), `revogar_convite`, `ver_convite`, `aceitar_convite`, `compartilhar_pets`, `sair_da_familia` (a última pessoa desfaz a família e os pets voltam para "Só meus"), `remover_membro`, `alterar_papel`, `renomear_familia`.
- **App** (`familia.js`): Minha conta → Família (criar e convidar escolhendo os pets, membros, convites pendentes, compartilhar pets, remover, tornar responsável, sair/desfazer). Perfil do pet: etiqueta "Só meu"/"Família" e "Compartilhar com a família" (sem volta). Pet novo: caixa "Compartilhar com a família". O link `#/convite/<token>` é guardado antes do login. Quem já está numa família precisa sair dela para entrar em outra. Ao aceitar, os pets da pessoa continuam "Só meus".
- **Sincronização**: começa por `meus_espacos()`; baixa cada espaço desde a última alteração dele e envia cada registro para o espaço certo (o pet decide; cuidados, pesos, ração, gastos e anexos acompanham o pet; gasto "Geral" vai para a família). Ao sair ou ser removido, só os dados da família saem do aparelho. Editar mostra "Alterado por Fulana em ..." nos registros da família.
- **Painel de uso**: famílias, compartilhadas, pessoas nelas, pets compartilhados, convites criados/aceitos/cancelados em 30 dias.
- **Testes**: `window.__setSyncRemote(servidorSimulado)` aceita um servidor com `userId`, `rpc`, `pull(espaço, desde)`, `upsert`, `upload`, `download` e `remove`.

## Notas (v1.7)

- Aba **Notas** no perfil de cada pet: linha do tempo agrupada por dia (Hoje, Ontem, …), com data e hora editáveis, texto, foto opcional e quem escreveu ("por Fulana", nos pets da família).
- **Etiquetas** livres, com cor fixa por nome; sugestões Saúde, Vômito, Diarreia, Alimentação, Comportamento e Veterinário, mais as já usadas. Filtro por etiqueta no topo da aba.
- Cada nota é um registro tipo `nota` (`petId`, `data`, `hora`, `texto`, `tags`, `autor`); a foto é um anexo comum ligado à nota pelo campo `careId`. Ao compartilhar um pet, as notas e as fotos vão junto ([`supabase/notas.sql`](supabase/notas.sql)). Interface em `notas.js`.
- **Painel de uso**: total de notas, notas em 7 dias e etiquetas mais usadas.

## Planos: Grátis e Premium (v1.8, ainda sem cobrança)

- **Premium é da família**: quem tem assinatura ativa é Premium, e todos da família dela também (inclusive nos pets "Só meus").
- **Grátis**: cada pessoa cria 1 pet; fotos e anexos (receitas, exames, fotos nas notas) são do Premium. A foto de perfil do pet e o "Baixar meus dados" são grátis para todos.
- **Ao deixar de ser Premium nada é apagado**: os pets a mais e os anexos continuam visíveis e podem ser apagados; só não dá para criar novos.
- **Regras no banco** ([`supabase/premium.sql`](supabase/premium.sql)): tabela `assinaturas` (origem `fundador`, `cortesia`, `teste` e, no futuro, `mercadopago`/`stripe`), função `premium_de()`, gatilho `registros_limites` e regra de envio no Storage. O plano chega ao app em `meus_espacos().plano`.
- **App** (`premium.js`): Minha conta → Seu plano; tela do Premium (R$ 14,90/mês ou R$ 119,90/ano, "assinatura em breve"); avisos ao passar do limite. **Painel de uso**: números do Premium e "Dar Premium" (por e-mail, tipo e prazo) e remover.
- Quem tinha conta antes da v1.8 virou **fundador** (Premium sem prazo).
- **Período de testes (beta aberto)** ([`supabase/beta.sql`](supabase/beta.sql)): enquanto estiver ligado, todo mundo é Premium (`app_config.beta_aberto`, lido por `premium_de()` e `meu_plano()`). Liga e desliga no Painel de uso → Premium. No lançamento, o botão "Tornar contas sem Premium em fundadoras" dá Premium sem prazo para quem testou.

## Conta e segurança (v1.9)

- **Trocar senha** (Configurações → Conta): pede a senha atual. Quem entra com o Google pode **criar uma senha** para também entrar com e-mail.
- **Excluir conta**: mostra o que será apagado (pets "Só meus" e tudo deles; a família, se a pessoa for a única nela), quem assume como responsável e se o Premium acaba; pede para digitar EXCLUIR. Os arquivos são apagados pelo app e o resto no banco por `excluir_minha_conta()` ([`supabase/conta.sql`](supabase/conta.sql)). Os pets da família continuam com as outras pessoas.
- **Limite de tamanho**: cada registro tem no máximo 256 KB (o maior hoje, um pet com foto, tem ~40 KB).
- **Content Security Policy** em `index.html`: só roda código do próprio site e só conversa com o Supabase do projeto (fontes do Google e fotos de perfil do Google liberadas).
- **E-mails de login em português**: modelos prontos em [`supabase/emails-pt.md`](supabase/emails-pt.md). O Supabase só deixa editar os modelos com SMTP próprio, então eles entram junto com o e-mail próprio (Fase 6).

## Relatório, termos e lembretes com o app fechado (v2.0)

- **Relatório para o veterinário** (Premium, `relatorio.js`, rota `#/relatorio/<pet>`): dados do pet, peso (gráfico e tabela), vacinas e preventivos, remédios e consultas, atrasados, próximos cuidados, ração e notas de um período (30 dias a tudo). Impressão/PDF pelo navegador, com o visual da carteirinha.
- **Termos de Uso** em [`termos.html`](termos.html): planos, renovação, cancelamento, arrependimento de 7 dias (CDC), responsabilidade. Links no login, no cadastro, em Ajuda e sobre e no Premium.
- **Lembretes com o app fechado** (Premium, `push.js`): Configurações → Lembretes → "Avisar com o app fechado". O aparelho se inscreve no navegador (Web Push, chave pública VAPID em `push.js`) e a inscrição vai para o banco (`registrar_push`, [`supabase/push.sql`](supabase/push.sql)). No iPhone, só com o app instalado na tela inicial (iOS 16.4+).
  - **Servidor**: função [`supabase/functions/lembretes`](supabase/functions/lembretes/index.ts) (Edge Function, com "Verify JWT" ligado), chamada a cada 15 minutos pelo agendador do banco (`cron.job` "miaumigo-lembretes", via `pg_net`, com a chave pública anon e o cabeçalho `x-cron-secret`). Ela pergunta `lembretes_para_enviar()` (cuidados não feitos cujo aviso — data menos a antecedência, no horário da pessoa — chegou nas últimas 24 h, só para Premium), envia e marca em `push_enviados`; inscrições mortas são apagadas.
  - **Segredos** (Edge Functions → Secrets): `VAPID_PUBLIC`, `VAPID_PRIVATE`, `CRON_SECRET`. A chave privada nunca vai para o app nem para o repositório.
  - Com o push ligado, o app deixa de mostrar os avisos de cuidados ao abrir (evita duplicar); os avisos de ração continuam pelo app. Sair da conta desinscreve o aparelho.

## Manter o Supabase ativo

O plano gratuito pausa após 7 dias sem atividade. A tarefa `.github/workflows/manter-ativo.yml` chama `ping()` (`supabase/ping.sql`) todo dia às 08:17. Se falhar, o GitHub avisa por e-mail. O GitHub desativa tarefas agendadas após 60 dias sem commits no repositório (avisa antes); para reativar, faça um commit ou clique em "Enable workflow" na aba Actions.
