# Configurar o Supabase (uma vez, ~10 minutos)

## 1. Criar o projeto
1. Entre em https://supabase.com e crie sua conta (pode ser com o GitHub ou e-mail).
2. **New project**:
   - Nome: `miaumigo`
   - Senha do banco: gere uma e guarde no seu gerenciador de senhas (o app não usa, mas você pode precisar no futuro).
   - Região: **South America (São Paulo)**.
3. Espere o projeto terminar de criar (1 a 2 minutos).

## 2. Criar as tabelas e as regras de acesso
1. No menu lateral, abra **SQL Editor** → **New query**.
2. Cole todo o conteúdo de [`schema.sql`](schema.sql) e clique em **Run**.
3. Deve aparecer *Success. No rows returned*.
4. Depois, do mesmo jeito, rode [`familia.sql`](familia.sql) e [`espacos.sql`](espacos.sql) (famílias e pets "Só meus"), [`painel.sql`](painel.sql) (painel de uso) e [`ping.sql`](ping.sql) (manter ativo). A conferência no fim do `familia.sql` deve mostrar `registros_sem_familia = 0`.

## 3. Ajustar o login
Em **Authentication → URL Configuration**:
- **Site URL**: `http://localhost:5173`
- **Redirect URLs**: adicione `http://localhost:5173/**`
  (quando publicarmos o app, incluímos o endereço definitivo aqui).

Em **Authentication → Sign In / Providers → Email**:
- Deixe **Email** ativado.
- **Confirm email**: ligado é mais seguro (a pessoa confirma pelo link do e-mail).
  Para testar mais rápido, você pode desligar por enquanto.

> O e-mail padrão do Supabase tem limite baixo de envios por hora.
> Para uso real, depois configuramos um SMTP próprio (ex.: Resend).

## 3b. Login com Google (opcional)
1. **Google Cloud Console** (https://console.cloud.google.com) → crie um projeto `Miaumigo`.
2. **Google Auth Platform → Branding/Visão geral**: nome do app `Miaumigo`, e-mail de suporte, público **Externo**.
   Em **Público-alvo**, clique em **Publicar app** (senão só contas de teste conseguem entrar).
3. **Clientes → Criar cliente** → tipo **Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://tavoschlickmann-eng.github.io` e `http://localhost:5173`
   - URIs de redirecionamento autorizados: `https://<ref-do-projeto>.supabase.co/auth/v1/callback`
4. Copie o **Client ID** e o **Client secret**.
5. No Supabase: **Authentication → Sign In / Providers → Google** → ative e cole o Client ID e o Client secret → **Save**.
6. No app, em `config.js`, mude `googleLogin` para `true`.

> O Client secret é secreto: ele vai **só** no painel do Supabase, nunca no código do app.

## 4. Me passar duas informações
Em **Project Settings → API** (ou **Data API / API Keys**), copie:
- **Project URL** (ex.: `https://abcdxyz.supabase.co`)
- **Publishable key** (começa com `sb_publishable_`) — ou, em projetos antigos, a **anon public key**.

Essas duas são públicas por natureza: ficam dentro do app e a proteção
dos dados vem das regras do passo 2.

**Nunca** me envie nem coloque no app a **secret key** / **service_role key**
nem a senha do banco.
