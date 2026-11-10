// Miaumigo — envia os lembretes com o app fechado (Web Push).
// Chamada a cada 15 minutos pelo agendador do banco (pg_cron + pg_net),
// com o cabeçalho x-cron-secret. Pergunta ao banco o que está na hora
// (lembretes_para_enviar), envia e marca como enviado (lembretes_marcar).
//
// Segredos (Edge Functions → Secrets): VAPID_PUBLIC, VAPID_PRIVATE, CRON_SECRET.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos no Supabase.
// Implantar com "Verify JWT" DESLIGADO (a proteção é o CRON_SECRET).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  webpush.setVapidDetails('mailto:tavoschlickmann@gmail.com', Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);
  // chave de serviço: nome antigo (SUPABASE_SERVICE_ROLE_KEY) ou o novo formato (SUPABASE_SECRET_KEYS)
  let chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!chave) { try { chave = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* sem chave */ } }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, chave!, { auth: { persistSession: false } });

  const { data, error } = await sb.rpc('lembretes_para_enviar');
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 });

  const enviadas = new Set<string>();
  const mortas = new Set<string>();
  let falhas = 0;
  for (const r of data ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        JSON.stringify({ title: r.titulo, body: r.corpo, tag: r.tag, url: './#/agenda' }),
        { TTL: 60 * 60 * 12 },
      );
      enviadas.add(r.chave);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) mortas.add(r.inscricao); // aparelho desinstalou ou desativou
      else falhas++;
    }
  }

  const { error: e2 } = await sb.rpc('lembretes_marcar', { p_chaves: [...enviadas], p_mortas: [...mortas] });
  return Response.json({ ok: !e2, pendentes: data?.length ?? 0, enviadas: enviadas.size, removidas: mortas.size, falhas, erro: e2?.message });
});
