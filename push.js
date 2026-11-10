'use strict';

/* =========================================================
   Miaumigo — lembretes com o app fechado (Web Push), Premium.
   O aparelho se inscreve no navegador (pushManager) e a inscrição vai
   para o Supabase (registrar_push). A função "lembretes" do servidor
   manda os avisos no horário escolhido (supabase/push.sql e
   supabase/functions/lembretes). Fica em Configurações → Lembretes.
   ========================================================= */

const VAPID_PUBLIC = 'BGL6c7syEHUXiXn4KFVQS3klRY12M0Wtzv0RqLY6lSb7IG_0s8Hd0MPuU8S8z6ECGXpJ0yUTxAArL3vlGhc7zG4'; // chave pública (a privada fica só no Supabase)

const pushSuportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const ehIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const appInstalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushLigado = () => !!db.config.push;

function chaveVapid() {
  const b64 = VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function inscricaoAtual() {
  if (!pushSuportado()) return null;
  const reg = await navigator.serviceWorker.getRegistration(); // não trava se não houver service worker
  return reg?.pushManager ? reg.pushManager.getSubscription() : null;
}

async function registrarInscricao(sub) {
  const j = sub.toJSON();
  await remote.rpc('registrar_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
    p_horario: db.config.horario, p_fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
  });
}

/** Bloco em Configurações → Lembretes. */
function pushSecao() {
  if (!isLoggedIn()) return '';
  const premium = typeof ehPremium !== 'function' || ehPremium();
  let status;
  if (!pushSuportado()) {
    status = ehIOS() && !appInstalado()
      ? 'No iPhone, instale o app na tela inicial (Compartilhar → Adicionar à Tela de Início) e abra por lá para receber lembretes com o app fechado.'
      : 'Este navegador não recebe lembretes com o app fechado. Use o calendário abaixo.';
  } else if (pushLigado()) {
    status = `Você recebe os lembretes às ${esc(db.config.horario)} neste aparelho, mesmo com o app fechado.`;
  } else {
    status = 'Receba os lembretes no horário escolhido mesmo com o app fechado.';
  }
  return `
    <label class="check-field"><input type="checkbox" data-push-toggle ${pushLigado() ? 'checked' : ''} ${pushSuportado() ? '' : 'disabled'}>
      Avisar com o app fechado${premium ? '' : '<span class="premium-tag">Premium</span>'}</label>
    <p>${status}</p>`;
}

async function ativarPush() {
  if (typeof ehPremium === 'function' && !ehPremium()) { premiumSheet('push'); return false; }
  if (!pushSuportado()) { toast('Este aparelho não recebe lembretes com o app fechado.'); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notificações bloqueadas. Libere nas permissões do site.'); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid() });
    await registrarInscricao(sub);
    db.config.push = true;
    db.config.lembretes = true; // os avisos de ração continuam pelo app
    save();
    toast(`Pronto! Lembretes às ${db.config.horario}, mesmo com o app fechado.`);
    return true;
  } catch (e) {
    console.warn('push', e);
    toast(navigator.onLine ? 'Não consegui ativar os lembretes neste aparelho.' : 'Sem internet. Tente de novo quando conectar.');
    return false;
  }
}

async function desativarPush({ silencioso = false } = {}) {
  try {
    const sub = pushSuportado() ? await inscricaoAtual() : null;
    if (sub) {
      await remote.rpc('remover_push', { p_endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } finally {
    db.config.push = false;
    save();
    if (!silencioso) toast('Lembretes com o app fechado desativados neste aparelho.');
  }
}

/** Mantém a inscrição em dia (ao abrir o app e ao mudar o horário). */
async function atualizarPush() {
  if (!pushLigado() || !pushSuportado() || !isLoggedIn() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid() });
    await registrarInscricao(sub);
  } catch { /* tenta de novo na próxima vez */ }
}

/** Ao sair da conta: este aparelho para de receber os lembretes dela. */
async function desligarPushAoSair() {
  if (pushLigado()) await desativarPush({ silencioso: true });
}

document.addEventListener('change', async (e) => {
  if (!e.target.matches?.('[data-push-toggle]')) return;
  const box = e.target;
  box.disabled = true;
  const ok = box.checked ? await ativarPush() : (await desativarPush(), true);
  if (!ok) box.checked = false;
  if (document.getElementById('sheet').open && document.getElementById('sheet-title')?.textContent === 'Configurações') configMenu();
});

// confere a inscrição alguns segundos depois de abrir (quando o login já foi verificado)
setTimeout(atualizarPush, 6000);
