'use strict';

/* =========================================================
   Miaumigo — conta e sincronização (Supabase)

   O app continua "offline primeiro": tudo fica salvo no aparelho e a
   nuvem é uma cópia sincronizada. A cada sincronização:
     1. baixa o que mudou na nuvem desde a última vez (pull);
     2. envia o que mudou no aparelho (push), incluindo exclusões;
     3. faz o mesmo com os anexos (arquivos no Storage).
   Conflito (mesmo registro alterado nos dois lados): vale o do aparelho,
   que é enviado logo em seguida.
   ========================================================= */

const SYNC_KEY = 'miaumigo:sync';
const COLLECTIONS = { pet: 'pets', cuidado: 'cuidados', peso: 'pesos', gasto: 'gastos', racao: 'racoes' };
const PAGE = 1000;

/* ---------------- Estado ---------------- */

const cfg = window.MIAUMIGO_CONFIG || {};
const syncConfigured = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase?.createClient);

let sb = null;
let session = null;
const syncState = { status: 'idle', error: '', lastSync: null, running: false, again: false };

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch { return null; }
}
function freshMeta(userId) {
  return { userId, lastPull: '1970-01-01T00:00:00Z', hashes: {}, anexos: {} };
}
let meta = loadMeta();
function saveMeta() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); } catch { /* cheio */ }
}

/** Hash rápido (cyrb53) para saber se um registro mudou desde a última sincronização. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

function hashOf(obj) {
  const str = stableStringify(obj); // o Postgres reordena as chaves do JSON
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ---------------- Backend ----------------
   Tudo que fala com o Supabase passa por aqui, o que permite testar a
   sincronização com um servidor simulado (window.__setSyncRemote). */

const supabaseRemote = {
  userId: () => session?.user?.id,
  async pull(since) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('registros')
        .select('id,tipo,dados,excluido,updated_at')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  },
  async upsert(rows) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('registros').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,id' });
      if (error) throw error;
    }
  },
  async upload(path, blob, contentType) {
    const { error } = await sb.storage.from('anexos').upload(path, blob, { upsert: true, contentType });
    if (error) throw error;
  },
  async download(path) {
    const { data, error } = await sb.storage.from('anexos').download(path);
    if (error) throw error;
    return data;
  },
  async remove(paths) {
    if (!paths.length) return;
    const { error } = await sb.storage.from('anexos').remove(paths);
    if (error) throw error;
  },
};

let remote = supabaseRemote;
const isLoggedIn = () => !!remote.userId();

/* ---------------- Sincronização ---------------- */

function applyRemote(target, dados) {
  // altera o objeto existente (sem trocar a referência), para não perder
  // edições em formulários que estejam abertos com esse objeto
  for (const k of Object.keys(target)) if (!(k in dados)) delete target[k];
  Object.assign(target, dados);
}

async function syncNow() {
  if (!isLoggedIn()) return;
  if (syncState.running) { syncState.again = true; return; }
  if (!navigator.onLine) { setSyncStatus('offline'); return; }

  syncState.running = true;
  setSyncStatus('syncing');
  try {
    const uid = remote.userId();
    if (!meta || meta.userId !== uid) { meta = freshMeta(uid); saveMeta(); }

    /* 1. Pull */
    const rows = await remote.pull(meta.lastPull);
    let changedLocal = false;
    const remoteAnexos = [];
    for (const row of rows) {
      if (row.updated_at > meta.lastPull) meta.lastPull = row.updated_at;
      if (row.tipo === 'anexo') { remoteAnexos.push(row); continue; }
      const coll = db[COLLECTIONS[row.tipo]];
      if (!coll) continue;
      const idx = coll.findIndex((x) => x.id === row.id);
      const local = idx >= 0 ? coll[idx] : null;
      const known = meta.hashes[row.id];
      const localChanged = local ? hashOf(local) !== known?.h : !!known;

      if (localChanged) continue; // vale o do aparelho; vai no push
      if (row.excluido) {
        if (local) { coll.splice(idx, 1); changedLocal = true; }
        delete meta.hashes[row.id];
      } else {
        const h = hashOf(row.dados);
        if (local && hashOf(local) === h) { meta.hashes[row.id] = { h, t: row.tipo }; continue; } // já igual
        if (local) applyRemote(local, row.dados);
        else coll.push({ ...row.dados });
        meta.hashes[row.id] = { h, t: row.tipo };
        changedLocal = true;
      }
    }

    /* 2. Push (alterados e excluídos no aparelho) */
    const out = [];
    const present = new Set();
    for (const [tipo, name] of Object.entries(COLLECTIONS)) {
      for (const rec of db[name]) {
        present.add(rec.id);
        const h = hashOf(rec);
        if (meta.hashes[rec.id]?.h !== h) out.push({ row: { user_id: uid, id: rec.id, tipo, dados: rec, excluido: false }, h });
      }
    }
    for (const [id, info] of Object.entries(meta.hashes)) {
      if (!present.has(id)) out.push({ row: { user_id: uid, id, tipo: info.t, dados: {}, excluido: true }, h: null });
    }
    if (out.length) {
      await remote.upsert(out.map((o) => o.row));
      for (const { row, h } of out) {
        if (h) meta.hashes[row.id] = { h, t: row.tipo };
        else delete meta.hashes[row.id];
      }
    }
    saveMeta();
    if (changedLocal) { persistLocal(); render(); }

    /* 3. Anexos */
    await syncAttachments(uid, remoteAnexos);

    syncState.lastSync = new Date();
    setSyncStatus('ok');
  } catch (e) {
    console.warn('Sincronização falhou', e);
    setSyncStatus(navigator.onLine ? 'error' : 'offline', e?.message || String(e));
  } finally {
    syncState.running = false;
    if (syncState.again) { syncState.again = false; syncNow(); }
  }
}

async function syncAttachments(uid, remoteRows) {
  let local = [];
  try { local = await IDB.all(); } catch { return; } // sem IndexedDB
  const localIds = new Set(local.map((a) => a.id));
  let changed = false;

  // vindos da nuvem
  for (const row of remoteRows) {
    if (row.excluido) {
      if (meta.anexos[row.id] && localIds.has(row.id)) { await IDB.del(row.id); changed = true; }
      delete meta.anexos[row.id];
    } else if (!localIds.has(row.id) && !meta.anexos[row.id]) {
      const blob = await remote.download(row.dados.path);
      const { path, ...info } = row.dados;
      await IDB.put({ ...info, id: row.id, blob });
      meta.anexos[row.id] = { path };
      localIds.add(row.id);
      changed = true;
    }
  }
  saveMeta();

  // novos no aparelho
  for (const a of local) {
    if (meta.anexos[a.id]) continue;
    const path = `${uid}/${a.id}`;
    await remote.upload(path, a.blob, a.tipo);
    const { blob, ...info } = a;
    await remote.upsert([{ user_id: uid, id: a.id, tipo: 'anexo', dados: { ...info, path }, excluido: false }]);
    meta.anexos[a.id] = { path };
    saveMeta();
  }

  // apagados no aparelho
  const gone = Object.entries(meta.anexos).filter(([id]) => !localIds.has(id));
  if (gone.length) {
    await remote.remove(gone.map(([, v]) => v.path));
    await remote.upsert(gone.map(([id]) => ({ user_id: uid, id, tipo: 'anexo', dados: {}, excluido: true })));
    gone.forEach(([id]) => delete meta.anexos[id]);
    saveMeta();
  }

  if (changed) {
    // recalcula a contagem de anexos exibida nos cuidados
    const all = await IDB.all();
    for (const c of db.cuidados) {
      const n = all.filter((a) => a.careId === c.id).length;
      if ((c.anexos || 0) !== n) c.anexos = n;
    }
    persistLocal();
    render();
  }
}

/** Salva no aparelho sem agendar outra sincronização. */
function persistLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* cheio */ }
}

let syncTimer;
/** Chamado pelo app a cada alteração: sincroniza alguns segundos depois. */
function scheduleSync(delay = 2500) {
  if (!isLoggedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

/* ---------------- Status na interface ---------------- */

function setSyncStatus(status, error = '') {
  syncState.status = status;
  syncState.error = error;
  updateSyncUI();
}

function syncBadge() {
  if (!syncConfigured && remote === supabaseRemote) return '';
  const map = !isLoggedIn()
    ? { ic: 'cloud-off', cls: 'off', label: 'Sem conta: dados só neste aparelho' }
    : syncState.status === 'syncing' ? { ic: 'refresh-cw', cls: 'spin', label: 'Sincronizando…' }
    : syncState.status === 'error' ? { ic: 'cloud-off', cls: 'err', label: 'Erro ao sincronizar' }
    : syncState.status === 'offline' ? { ic: 'cloud-off', cls: 'off', label: 'Sem internet: sincroniza quando voltar' }
    : { ic: 'cloud-check', cls: 'ok', label: 'Sincronizado' };
  return `<button class="icon-btn sync-badge ${map.cls}" data-action="settings" aria-label="${map.label}" title="${map.label}">${icon(map.ic)}</button>`;
}

function syncStatusText() {
  if (!isLoggedIn()) return '';
  if (syncState.status === 'syncing') return 'Sincronizando…';
  if (syncState.status === 'offline') return 'Sem internet. Sincroniza quando a conexão voltar.';
  if (syncState.status === 'error') return `Não consegui sincronizar: ${syncState.error}`;
  if (syncState.lastSync) return `Sincronizado às ${syncState.lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;
  return 'Aguardando a primeira sincronização.';
}

function updateSyncUI() {
  document.querySelectorAll('.sync-badge').forEach((el) => { el.outerHTML = syncBadge(); });
  const st = document.getElementById('sync-status');
  if (st) st.textContent = syncStatusText();
}

/** Bloco "Conta" usado na tela de Configurações. */
function accountSection() {
  if (!syncConfigured) {
    return `
      <h3 class="menu-title">${icon('cloud', { size: 18 })}Conta e sincronização</h3>
      <p>Sincronização ainda não configurada neste app (falta preencher <code>config.js</code>).</p>`;
  }
  if (!isLoggedIn()) {
    return `
      <h3 class="menu-title">${icon('cloud', { size: 18 })}Conta e sincronização</h3>
      <p>Entre para guardar seus dados na nuvem e usar em outros aparelhos. O que já está aqui vai junto.</p>
      <button class="btn" data-action="go-login">${icon('log-in', { size: 18 })}Entrar ou criar conta</button>`;
  }
  return `
    <h3 class="menu-title">${icon('cloud', { size: 18 })}Conta e sincronização</h3>
    <div class="account">
      <span class="ibox">${icon('user')}</span>
      <div class="row-body"><div class="row-title">${esc(session?.user?.email || 'Conectado')}</div><div class="row-sub" id="sync-status">${esc(syncStatusText())}</div></div>
    </div>
    <div class="two">
      <button class="btn plain" data-action="sync-now">${icon('refresh-cw', { size: 18 })}Sincronizar</button>
      <button class="btn plain" data-action="logout">${icon('log-out', { size: 18 })}Sair</button>
    </div>`;
}

/* ---------------- Tela de login ---------------- */

const SKIP_KEY = 'miaumigo:semConta';
const googleEnabled = () => syncConfigured && cfg.googleLogin === true;
let authMode = 'entrar';   // entrar | criar | recuperar
let authNotice = '';       // mensagem informativa no topo do formulário

// Logo oficial do Google (exigido pelas diretrizes do botão "Fazer login com o Google")
const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function viewEntrar() {
  if (!syncConfigured) { setTimeout(() => { location.hash = '#/inicio'; }, 0); return ''; }
  if (isLoggedIn()) { setTimeout(() => { location.hash = '#/inicio'; }, 0); return ''; }

  const titles = { entrar: 'Que bom te ver!', criar: 'Crie sua conta', recuperar: 'Recuperar senha' };
  const subs = {
    entrar: 'Entre para guardar seus pets na nuvem e usar em qualquer aparelho.',
    criar: 'Seus dados ficam salvos com segurança e sincronizados entre aparelhos.',
    recuperar: 'Informe seu e-mail e enviamos um link para criar uma senha nova.',
  };
  const recuperar = authMode === 'recuperar';
  return `
    <div class="auth-screen">
      <div class="auth-hero">
        <div class="auth-logo">${icon('paw-print', { size: 40 })}</div>
        <h1>Miaumigo</h1>
      </div>

      <div class="auth-card card">
        <h2>${titles[authMode]}</h2>
        <p class="auth-sub">${subs[authMode]}</p>
        ${authNotice ? `<p class="auth-notice" role="status">${icon('mail', { size: 18 })}<span>${esc(authNotice)}</span></p>` : ''}

        ${!recuperar && googleEnabled() ? `
          <button type="button" class="btn-google" data-action="google-login">${GOOGLE_G}<span>Continuar com o Google</span></button>
          <div class="auth-divider"><span>ou com e-mail</span></div>` : ''}

        ${!recuperar ? `
          <div class="seg" role="group" aria-label="Entrar ou criar conta">
            <button type="button" data-action="auth-mode" data-mode="entrar" aria-pressed="${authMode === 'entrar'}">Entrar</button>
            <button type="button" data-action="auth-mode" data-mode="criar" aria-pressed="${authMode === 'criar'}">Criar conta</button>
          </div>` : ''}

        <form class="form" data-auth="${authMode}" autocomplete="on">
          <label class="field"><span>E-mail</span>
            <span class="input-ico">${icon('mail', { size: 18 })}<input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="voce@exemplo.com"></span>
          </label>
          ${!recuperar ? `
          <label class="field"><span>Senha</span>
            <span class="input-ico">${icon('lock', { size: 18 })}<input type="password" name="senha" required minlength="6" autocomplete="${authMode === 'entrar' ? 'current-password' : 'new-password'}" placeholder="${authMode === 'criar' ? 'Mínimo de 6 caracteres' : 'Sua senha'}">
              <button type="button" class="pass-toggle" data-action="toggle-pass" aria-label="Mostrar senha">${icon('eye', { size: 18 })}</button>
            </span>
          </label>` : ''}
          <p class="form-error" id="auth-error" role="alert" hidden></p>
          <button class="btn block" type="submit">${{ entrar: 'Entrar', criar: 'Criar conta', recuperar: 'Enviar link' }[authMode]}</button>
        </form>

        ${authMode === 'entrar' ? '<button type="button" class="link-btn auth-forgot" data-action="auth-mode" data-mode="recuperar">Esqueci minha senha</button>' : ''}
        ${recuperar ? '<button type="button" class="link-btn auth-forgot" data-action="auth-mode" data-mode="entrar">Voltar para o login</button>' : ''}
      </div>

      <button type="button" class="auth-skip" data-action="skip-login">Usar sem conta por enquanto</button>
      <p class="auth-foot">Sem conta, seus dados ficam só neste aparelho. Dá para entrar depois em Configurações.</p>
    </div>`;
}

function goLogin(mode = 'entrar') {
  authMode = mode;
  authNotice = '';
  closeSheet();
  if (route().name === 'entrar') render();
  else location.hash = '#/entrar';
}

async function signInWithGoogle(btn) {
  btn.disabled = true;
  btn.classList.add('loading');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
  });
  if (error) { // em caso de sucesso o navegador já saiu da página
    btn.disabled = false;
    btn.classList.remove('loading');
    const err = document.getElementById('auth-error');
    if (err) { err.textContent = authError(error); err.hidden = false; }
  }
}

/** Retorno do Google: o Supabase troca o ?code= pela sessão; aqui só limpamos a URL e tratamos erros. */
function cleanAuthRedirect() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error') && !p.has('error_description')) return;
  const desc = p.get('error_description');
  history.replaceState(null, '', location.pathname + (location.hash || '#/inicio'));
  if (desc) {
    authNotice = '';
    setTimeout(() => toast(/access_denied|cancel/i.test(p.get('error') || '') ? 'Login com o Google cancelado.' : `Não consegui entrar com o Google: ${desc}`), 300);
  }
}

/* ---------------- Login ---------------- */

function authSheet(mode = 'entrar') {
  const titles = { entrar: 'Entrar', criar: 'Criar conta', recuperar: 'Recuperar senha', nova: 'Nova senha' };
  const tabs = mode === 'entrar' || mode === 'criar' ? `
    <div class="seg" role="group" aria-label="Entrar ou criar conta" style="margin-top:0">
      <button type="button" data-action="auth" data-mode="entrar" aria-pressed="${mode === 'entrar'}">Entrar</button>
      <button type="button" data-action="auth" data-mode="criar" aria-pressed="${mode === 'criar'}">Criar conta</button>
    </div>` : '';
  const email = mode !== 'nova' ? `<label class="field"><span>E-mail</span><input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="voce@exemplo.com"></label>` : '';
  const pass = mode !== 'recuperar' ? `
    <label class="field"><span>${mode === 'nova' ? 'Nova senha' : 'Senha'}</span>
      <input type="password" name="senha" required minlength="6" autocomplete="${mode === 'entrar' ? 'current-password' : 'new-password'}" placeholder="${mode === 'entrar' ? '' : 'Mínimo de 6 caracteres'}">
    </label>` : '';
  const submit = { entrar: 'Entrar', criar: 'Criar conta', recuperar: 'Enviar link', nova: 'Salvar senha' }[mode];

  openSheet(titles[mode], `
    <form class="form" autocomplete="on" data-auth="${mode}">
      ${tabs}
      ${mode === 'recuperar' ? '<p class="form-note">Enviamos um link para você criar uma senha nova.</p>' : ''}
      ${email}
      ${pass}
      <p class="form-error" id="auth-error" role="alert" hidden></p>
      <button class="btn block" type="submit">${submit}</button>
      ${mode === 'entrar' ? '<button type="button" class="link-btn" data-action="auth" data-mode="recuperar" style="align-self:center">Esqueci minha senha</button>' : ''}
      ${mode === 'recuperar' ? '<button type="button" class="link-btn" data-action="auth" data-mode="entrar" style="align-self:center">Voltar</button>' : ''}
    </form>`, null);
}

function authError(e) {
  const msg = String(e?.message || e || '');
  const known = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/email not confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
    [/already registered|already exists/i, 'Já existe uma conta com esse e-mail. Tente entrar.'],
    [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
    [/rate limit|too many/i, 'Muitas tentativas. Espere alguns minutos e tente de novo.'],
    [/failed to fetch|network/i, 'Sem conexão com o servidor. Verifique a internet.'],
  ];
  return known.find(([re]) => re.test(msg))?.[1] || msg || 'Algo deu errado.';
}

async function handleAuthSubmit(form) {
  const mode = form.dataset.auth;
  const email = form.email?.value.trim();
  const senha = form.senha?.value;
  const err = form.querySelector('#auth-error');
  const btn = form.querySelector('[type=submit]');
  const redirectTo = location.origin + location.pathname;
  err.hidden = true;
  btn.disabled = true;
  try {
    if (mode === 'entrar') {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      closeSheet(); // a mensagem de boas-vindas vem do evento SIGNED_IN
    } else if (mode === 'criar') {
      const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      closeSheet();
      if (data.session) toast('Conta criada! Sincronizando…');
      else if (form.closest('.auth-screen')) {
        authMode = 'entrar';
        authNotice = `Enviamos um link de confirmação para ${email}. Confirme e depois entre aqui.`;
        render();
      } else toast('Conta criada! Confirme pelo link que enviamos por e-mail.');
    } else if (mode === 'recuperar') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      closeSheet();
      if (form.closest('.auth-screen')) {
        authMode = 'entrar';
        authNotice = `Se houver conta com ${email}, o link para criar uma senha nova chega em instantes.`;
        render();
      } else toast('Se o e-mail tiver conta, o link chega em instantes.');
    } else if (mode === 'nova') {
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) throw error;
      closeSheet();
      toast('Senha alterada');
    }
  } catch (e) {
    err.textContent = authError(e);
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// o formulário de login (na tela ou numa folha) não usa o onSubmit genérico das folhas
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-auth]');
  if (!form) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  handleAuthSubmit(form);
}, true);

/** Esquece a sincronização deste aparelho (usado ao apagar os dados locais). */
async function forgetSync() {
  clearTimeout(syncTimer);
  meta = null;
  localStorage.removeItem(SYNC_KEY);
  if (sb && session) await sb.auth.signOut().catch(() => {});
}

async function logout() {
  if (!confirm('Sair da conta? Seus dados continuam neste aparelho, mas param de sincronizar.')) return;
  await syncNow(); // envia o que faltar antes de sair
  await sb.auth.signOut();
  meta = null;
  localStorage.removeItem(SYNC_KEY);
  localStorage.removeItem(SKIP_KEY);
  closeSheet();
  toast('Você saiu da conta. Seus dados continuam neste aparelho.');
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'auth': if (sb) authSheet(el.dataset.mode); break;
    case 'go-login': if (sb) goLogin(); break;
    case 'auth-mode':
      authMode = el.dataset.mode;
      authNotice = '';
      render();
      document.querySelector('.auth-card input[name=email]')?.focus();
      break;
    case 'google-login': signInWithGoogle(el); break;
    case 'skip-login':
      try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ }
      location.hash = '#/inicio';
      break;
    case 'toggle-pass': {
      const inp = el.parentElement.querySelector('input');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      el.innerHTML = icon(show ? 'eye-off' : 'eye', { size: 18 });
      el.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
      break;
    }
    case 'sync-now': syncNow(); break;
    case 'logout': logout(); break;
  }
});

/* ---------------- Início ---------------- */

if (syncConfigured) {
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    // sessão guardada por projeto: trocar de projeto no config.js não reaproveita login antigo
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: `miaumigo:auth:${new URL(cfg.supabaseUrl).hostname.split('.')[0]}` },
  });

  sb.auth.onAuthStateChange((event, s) => {
    const wasLoggedIn = !!session;
    session = s;
    // não chamar o Supabase direto dentro deste callback (recomendação da biblioteca)
    setTimeout(() => {
      cleanAuthRedirect();
      if (event === 'INITIAL_SESSION') {
        // primeira abertura sem conta: mostra a tela de login (a não ser que a pessoa tenha escolhido seguir sem conta)
        let skipped = false;
        try { skipped = !!localStorage.getItem(SKIP_KEY); } catch { /* ignore */ }
        const r = route().name;
        if (!s && !skipped && ['inicio', ''].includes(r)) location.hash = '#/entrar';
        if (s && r === 'entrar') location.hash = '#/inicio';
        splashReady('auth');
      }
      if (event === 'PASSWORD_RECOVERY') authSheet('nova');
      if (event === 'SIGNED_IN' && !wasLoggedIn) {
        authNotice = '';
        if (route().name === 'entrar') location.hash = '#/inicio';
        toast(`Olá${s?.user?.user_metadata?.name ? `, ${s.user.user_metadata.name.split(' ')[0]}` : ''}! Sincronizando seus dados…`);
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') syncNow();
      updateSyncUI();
      if (document.getElementById('sheet').open && document.querySelector('.menu .account, .menu [data-action="go-login"]')) settingsSheet();
      render();
    }, 0);
  });
} else {
  splashReady('auth'); // sem login configurado: nada a esperar
}

window.addEventListener('online', () => syncNow());
window.addEventListener('offline', () => { if (isLoggedIn()) setSyncStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
setInterval(() => { if (!document.hidden) syncNow(); }, 60 * 1000);

/* Apenas para testes: troca o backend por um simulado. */
window.__setSyncRemote = (r) => { remote = r || supabaseRemote; meta = null; localStorage.removeItem(SYNC_KEY); updateSyncUI(); render(); };
