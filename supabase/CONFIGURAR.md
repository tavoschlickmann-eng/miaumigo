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

## 4. Me passar duas informações
Em **Project Settings → API** (ou **Data API / API Keys**), copie:
- **Project URL** (ex.: `https://abcdxyz.supabase.co`)
- **Publishable key** (começa com `sb_publishable_`) — ou, em projetos antigos, a **anon public key**.

Essas duas são públicas por natureza: ficam dentro do app e a proteção
dos dados vem das regras do passo 2.

**Nunca** me envie nem coloque no app a **secret key** / **service_role key**
nem a senha do banco.
