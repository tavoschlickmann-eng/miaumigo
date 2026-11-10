# E-mails de login em português (Supabase → Authentication → Emails → Templates)

Cole cada assunto e corpo no modelo correspondente. As variáveis `{{ ... }}` são do Supabase.

## Confirm signup (Confirmar cadastro)
**Assunto:** Confirme seu e-mail no Miaumigo 🐾

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2B2321">
  <h2 style="color:#E8663D">Bem-vindo(a) ao Miaumigo!</h2>
  <p>Falta só confirmar que este e-mail é seu. Toque no botão abaixo:</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#E8663D;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Confirmar meu e-mail</a></p>
  <p style="color:#7A6F6B;font-size:13px">Se você não criou uma conta no Miaumigo, é só ignorar este e-mail.</p>
</div>
```

## Reset password (Redefinir senha)
**Assunto:** Crie uma senha nova no Miaumigo

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2B2321">
  <h2 style="color:#E8663D">Senha nova</h2>
  <p>Recebemos um pedido para criar uma senha nova para {{ .Email }}.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#E8663D;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Criar senha nova</a></p>
  <p style="color:#7A6F6B;font-size:13px">Se não foi você, ignore este e-mail: sua senha atual continua valendo.</p>
</div>
```

## Magic link (Link de acesso)
**Assunto:** Seu link para entrar no Miaumigo

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2B2321">
  <h2 style="color:#E8663D">Entrar no Miaumigo</h2>
  <p>Toque no botão para entrar na sua conta:</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#E8663D;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Entrar</a></p>
  <p style="color:#7A6F6B;font-size:13px">Se não foi você que pediu, ignore este e-mail.</p>
</div>
```

## Change email address (Trocar e-mail)
**Assunto:** Confirme seu novo e-mail no Miaumigo

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2B2321">
  <h2 style="color:#E8663D">Novo e-mail</h2>
  <p>Confirme a troca do e-mail da sua conta de {{ .Email }} para {{ .NewEmail }}:</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#E8663D;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Confirmar novo e-mail</a></p>
  <p style="color:#7A6F6B;font-size:13px">Se não foi você, ignore este e-mail.</p>
</div>
```

## Reauthentication (Código de confirmação)
**Assunto:** Seu código do Miaumigo

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2B2321">
  <h2 style="color:#E8663D">Código de confirmação</h2>
  <p>Use este código para confirmar a ação no Miaumigo:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
  <p style="color:#7A6F6B;font-size:13px">Se não foi você, ignore este e-mail.</p>
</div>
```

## Invite user (Convite) — não usado pelo app (convites são por link), mas fica em português
**Assunto:** Você foi convidado(a) para o Miaumigo

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2B2321">
  <h2 style="color:#E8663D">Você foi convidado(a)!</h2>
  <p>Toque no botão para criar sua conta no Miaumigo:</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#E8663D;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Aceitar convite</a></p>
</div>
```
