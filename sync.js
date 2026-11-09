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
function freshMeta(familiaId, userId) {
  return { familiaId, userId, lastPull: '1970-01-01T00:00:00Z', hashes: {}, anexos: {}, autores: {} };
}

/* ---------------- Família ----------------
   Os dados pertencem à FAMÍLIA, não à pessoa. `familia` é a resposta de
   minha_familia() no Supabase (id, nome, papel, membros, convites) e fica
   guardada no aparelho para aparecer mesmo sem internet. */
const FAMILIA_KEY = 'miaumigo:familia';
let familia = (() => { try { return JSON.parse(localStorage.getItem(FAMILIA_KEY)) || null; } catch { return null; } })();
function setFamilia(f) {
  familia = f;
  try { if (f) localStorage.setItem(FAMILIA_KEY, JSON.stringify(f)); else localStorage.removeItem(FAMILIA_KEY); } catch { /* cheio */ }
}
let trocaDeFamiliaEsperada = false; // aceitar convite / sair: o próprio app trocou de família
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
  async rpc(fn, args = {}) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  },
  async pull(familiaId, since) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('registros')
        .select('id,tipo,dados,excluido,updated_at,updated_by')
        .eq('familia_id', familiaId)
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
      const { error } = await sb.from('registros').upsert(rows.slice(i, i + 500), { onConflict: 'familia_id,id' });
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

/* ---------------- Dono dos dados do aparelho ----------------
   Os dados locais pertencem a UMA família (db.owner = id da família,
   db.ownerUser = quem estava logado). Se a família mudar (outra conta
   entrou, a pessoa saiu ou foi removida da família), os dados locais são
   apagados (nunca enviados) e os da família atual são baixados da nuvem.
   Isso impede que dados de uma família vazem para outra. */

const localDataCount = async () => {
  const n = Object.values(COLLECTIONS).reduce((s, name) => s + db[name].length, 0);
  const a = await IDB.all().then((x) => x.length).catch(() => 0);
  return n + a;
};

/** Apaga os dados deste aparelho (mantém só preferências como horário dos lembretes). */
async function wipeLocal() {
  clearTimeout(syncTimer);
  await IDB.clear().catch(() => {});
  const keep = { lembretes: db.config.lembretes, horario: db.config.horario };
  db = emptyDB();
  Object.assign(db.config, keep);
  persistLocal();
  meta = null;
  localStorage.removeItem(SYNC_KEY);
  render();
}

let ownerPromptOpen = false;

/** Garante que os dados locais são da família `fam` (da conta `uid`). Retorna false se precisa perguntar ao usuário. */
async function ensureOwner(fam, uid) {
  const fid = fam.id;
  if (db.owner === fid && db.ownerUser === uid) return true;
  const claim = () => { db.owner = fid; db.ownerUser = uid; persistLocal(); return true; };
  const herdaMeta = () => { if (meta?.userId === uid && !meta.familiaId) { meta.familiaId = fid; meta.autores ||= {}; saveMeta(); } };
  const sozinho = (fam.membros || []).length <= 1;

  if (db.owner === fid) return claim();                                    // mesma família, outra pessoa dela: os dados são da família
  if (db.owner && db.owner === uid) {                                      // versão 1.4: dono era a própria conta
    if (sozinho) { herdaMeta(); return claim(); }                          // a família dela é a conta migrada: mantém tudo
    await wipeLocal(); return claim();
  }
  if (db.owner) {                                                          // outra família (ou outra conta)
    const saiu = db.ownerUser === uid && !trocaDeFamiliaEsperada;
    const nomeAntigo = db.ownerNome;
    await wipeLocal();
    if (saiu) toast(`Você não faz mais parte da família${nomeAntigo ? ` “${nomeAntigo}”` : ''}. Os dados dela foram apagados deste aparelho.`);
    return claim();
  }
  if (meta?.userId === uid && sozinho) { herdaMeta(); return claim(); }    // versão antiga, já sincronizada com esta conta
  if (meta?.userId || meta?.familiaId) { await wipeLocal(); return claim(); } // versão antiga, de outra conta
  if (!(await localDataCount())) return claim();                           // aparelho vazio
  askAdopt(fid, uid);                                                      // dados sem dono: a pessoa decide
  return false;
}

function askAdopt(fid, uid) {
  if (ownerPromptOpen) return;
  ownerPromptOpen = true;
  const nomes = db.pets.map((p) => p.nome).slice(0, 4).join(', ');
  const resumo = [
    db.pets.length ? `${db.pets.length} pet${db.pets.length > 1 ? 's' : ''}${nomes ? ` (${esc(nomes)})` : ''}` : '',
    db.cuidados.length ? `${db.cuidados.length} cuidado${db.cuidados.length > 1 ? 's' : ''}` : '',
    db.gastos.length ? `${db.gastos.length} gasto${db.gastos.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ');
  openSheet('Dados neste aparelho', `
    <div class="menu">
      <p>Encontramos dados salvos neste aparelho que não estão ligados a nenhuma conta${resumo ? `: <b>${resumo}</b>` : ''}.</p>
      <p>Se forem seus, junte à sua conta. Se forem de outra pessoa, descarte: eles não serão enviados.</p>
      <button class="btn" data-action="adopt-local" data-uid="${esc(uid)}" data-fid="${esc(fid)}">${icon('cloud', { size: 18 })}Juntar à minha conta</button>
      <button class="btn danger" data-action="discard-local" data-uid="${esc(uid)}" data-fid="${esc(fid)}">${icon('trash-2', { size: 18 })}Descartar dados do aparelho</button>
    </div>`, null);
}

/** Há algo no aparelho que ainda não foi para a nuvem? */
async function hasPendingChanges() {
  if (!meta) return (await localDataCount()) > 0;
  const present = new Set();
  for (const name of Object.values(COLLECTIONS)) {
    for (const rec of db[name]) {
      present.add(rec.id);
      if (meta.hashes[rec.id]?.h !== hashOf(rec)) return true;
    }
  }
  if (Object.keys(meta.hashes).some((id) => !present.has(id))) return true;
  const anexos = await IDB.all().catch(() => []);
  return anexos.some((a) => !meta.anexos[a.id]) || Object.keys(meta.anexos).some((id) => !anexos.some((a) => a.id === id));
}

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
    /* 0. Família atual (decide de quem são os dados) */
    const fam = await remote.rpc('minha_familia');
    if (uid !== remote.userId()) { setSyncStatus('idle'); return; } // a conta mudou durante a chamada
    setFamilia(fam);
    if (!(await ensureOwner(fam, uid))) { setSyncStatus('idle'); return; } // aguardando a pessoa decidir
    trocaDeFamiliaEsperada = false;
    if (db.ownerNome !== fam.nome) { db.ownerNome = fam.nome; persistLocal(); }
    const fid = fam.id;
    if (!meta || meta.familiaId !== fid) { meta = freshMeta(fid, uid); saveMeta(); }
    meta.autores ||= {};

    /* 1. Pull */
    const rows = await remote.pull(fid, meta.lastPull);
    let changedLocal = false;
    const remoteAnexos = [];
    for (const row of rows) {
      if (row.updated_at > meta.lastPull) meta.lastPull = row.updated_at;
      if (row.updated_by) meta.autores[row.id] = { by: row.updated_by, at: row.updated_at };
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
        if (meta.hashes[rec.id]?.h !== h) out.push({ row: { familia_id: fid, id: rec.id, tipo, dados: rec, excluido: false }, h });
      }
    }
    for (const [id, info] of Object.entries(meta.hashes)) {
      if (!present.has(id)) out.push({ row: { familia_id: fid, id, tipo: info.t, dados: {}, excluido: true }, h: null });
    }
    if (out.length) {
      await remote.upsert(out.map((o) => o.row));
      const agora = new Date().toISOString();
      for (const { row, h } of out) {
        if (h) { meta.hashes[row.id] = { h, t: row.tipo }; meta.autores[row.id] = { by: uid, at: agora }; }
        else { delete meta.hashes[row.id]; delete meta.autores[row.id]; }
      }
    }
    saveMeta();
    if (changedLocal) { persistLocal(); render(); }

    /* 3. Anexos */
    await syncAttachments(fid, remoteAnexos);

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

async function syncAttachments(fid, remoteRows) {
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
    const path = `${fid}/${a.id}`;
    await remote.upload(path, a.blob, a.tipo);
    const { blob, ...info } = a;
    await remote.upsert([{ familia_id: fid, id: a.id, tipo: 'anexo', dados: { ...info, path }, excluido: false }]);
    meta.anexos[a.id] = { path };
    saveMeta();
  }

  // apagados no aparelho
  const gone = Object.entries(meta.anexos).filter(([id]) => !localIds.has(id));
  if (gone.length) {
    await remote.remove(gone.map(([, v]) => v.path));
    await remote.upsert(gone.map(([id]) => ({ familia_id: fid, id, tipo: 'anexo', dados: {}, excluido: true })));
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

/** Sincroniza e espera terminar (inclusive uma sincronização que já estava rodando). */
async function syncAndWait() {
  const idle = async () => { while (syncState.running) await new Promise((r) => setTimeout(r, 150)); };
  await idle();
  await syncNow();
  await idle();
  return syncState.status === 'ok';
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

/** Botão "Minha conta" do topo: avatar + pontinho com o status da sincronização. */
function syncBadge() {
  const map = !isLoggedIn() ? { cls: 'off', label: 'Sem conta' }
    : syncState.status === 'syncing' ? { cls: 'spin', label: 'Sincronizando…' }
    : syncState.status === 'error' ? { cls: 'err', label: 'Erro ao sincronizar' }
    : syncState.status === 'offline' ? { cls: 'off', label: 'Sem internet: sincroniza quando voltar' }
    : { cls: 'ok', label: 'Sincronizado' };
  return `<button class="me-btn sync-badge ${map.cls}" data-action="profile" aria-label="Minha conta (${map.label})" title="${map.label}">${avatarConta()}<span class="sync-dot" aria-hidden="true"></span></button>`;
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
    </div>
    ${isAdmin ? `<button class="btn ghost" data-action="go-painel">${icon('sparkles', { size: 18 })}Painel de uso</button>` : ''}`;
}

/* ---------------- Painel de uso (administradores) ----------------
   Quem é administrador é decidido NO BANCO (tabela app_admins, função
   painel_metricas em supabase/painel.sql). Aqui só escondemos o botão. */

let isAdmin = false;
const painel = { dados: null, carregando: false, erro: '', em: null };

async function checkAdmin() {
  if (!sb || !session) { isAdmin = false; return; }
  const { data, error } = await sb.rpc('is_admin');
  isAdmin = !error && data === true;
  if (document.getElementById('sheet').open && document.querySelector('.menu .account')) settingsSheet();
  if (route().name === 'painel') render();
}

async function carregarPainel() {
  painel.carregando = true;
  painel.erro = '';
  if (route().name === 'painel') render();
  const { data, error } = await sb.rpc('painel_metricas');
  painel.carregando = false;
  if (error) painel.erro = /negado|42501/.test(error.message + error.code) ? 'Acesso negado.' : authError(error);
  else { painel.dados = data; painel.em = new Date(); }
  if (route().name === 'painel') render();
}

const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
const fmtDia = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

/** Colunas por dia (uma medida só, cor do app). Barras com ponta arredondada e vão de 2px. */
function dayBars(serie, key, unidade) {
  const W = 340, H = 150, L = 26, R = 6, T = 10, B = 24;
  const vals = serie.map((d) => d[key] || 0);
  const max = Math.max(1, ...vals);
  const slot = (W - L - R) / serie.length;
  const bw = Math.max(2, slot - 2);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const base = H - B;
  const bars = serie.map((d, i) => {
    const v = vals[i];
    const x = L + i * slot + 1;
    const tip = `${fmtDia(d.dia)} · ${fmtN(v)} ${v === 1 ? unidade[0] : unidade[1]}`;
    let mark = '';
    if (v > 0) {
      const top = y(v), h = base - top, r = Math.min(4, h, bw / 2);
      mark = `<path class="bar-mark" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z"/>`;
    }
    return `<g class="bar-hit" data-tip="${tip}">${mark}<rect x="${x - 1}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/></g>`;
  }).join('');
  const meio = Math.floor(serie.length / 2);
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras por dia, últimos 30 dias">
      <line class="grid" x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}"/>
      <line class="axis-line" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>
      <text class="axis" x="${L - 6}" y="${y(max) + 4}" text-anchor="end">${fmtN(max)}</text>
      <text class="axis" x="${L - 6}" y="${base + 4}" text-anchor="end">0</text>
      ${bars}
      <text class="axis" x="${L}" y="${H - 6}">${fmtDia(serie[0].dia)}</text>
      <text class="axis" x="${L + meio * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${fmtDia(serie[meio].dia)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">hoje</text>
    </svg>`;
}

/** Barras horizontais com rótulo e valor (proporção de um total). */
function hbars(entradas) {
  const total = entradas.reduce((s, [, v]) => s + v, 0) || 1;
  const max = Math.max(1, ...entradas.map(([, v]) => v));
  if (!entradas.length) return '<p class="hint">Nada registrado ainda.</p>';
  return `<div class="bars">${entradas.map(([rotulo, v, ic]) => `
    <div class="bar-row">
      <div class="bar-top"><span class="meta-ico">${ic ? icon(ic, { size: 16 }) : ''}${esc(rotulo)}</span><span>${fmtN(v)} <small class="pct">${Math.round((v / total) * 100)}%</small></span></div>
      <div class="bar"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></div>
    </div>`).join('')}</div>`;
}

function viewPainel() {
  const head = `
    <div class="top">
      <div>
        <a class="back" href="#/inicio">${icon('chevron-left', { size: 18 })}Início</a>
        <h1>Painel de uso</h1>
        <p class="sub">${painel.em ? `Atualizado às ${painel.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Só você vê esta tela'}</p>
      </div>
      ${isAdmin ? `<button class="icon-btn ${painel.carregando ? 'spinning' : ''}" data-action="painel-atualizar" aria-label="Atualizar métricas">${icon('refresh-cw')}</button>` : ''}
    </div>`;

  if (!isAdmin) return head + `<div class="card">${emptyState('lock', 'Acesso restrito', 'Este painel é exclusivo da administração do Miaumigo.')}</div>`;
  if (!painel.dados && !painel.carregando && !painel.erro) setTimeout(carregarPainel, 0);
  if (!painel.dados) {
    return head + (painel.erro
      ? `<div class="card">${emptyState('cloud-off', 'Não consegui carregar', esc(painel.erro), '<button class="btn" data-action="painel-atualizar">Tentar de novo</button>')}</div>`
      : '<div class="card"><p class="hint">Carregando métricas…</p></div>');
  }

  const d = painel.dados;
  const u = d.usuarios, a = d.ativos, c = d.conteudo, s = d.armazenamento;
  const serie = d.serie_30d || [];
  const provedores = Object.entries(u.por_provedor || {}).map(([k, v]) => [k === 'google' ? 'Google' : k === 'email' ? 'E-mail e senha' : k, v, k === 'google' ? 'user' : 'mail']).sort((x, y) => y[1] - x[1]);
  const especies = Object.entries(c.pets_por_especie || {}).map(([k, v]) => [SPECIES[k]?.label || k, v, SPECIES[k]?.icon || 'paw-print']).sort((x, y) => y[1] - x[1]);
  const tipos = Object.entries(c.cuidados_por_tipo || {}).map(([k, v]) => [CARE_TYPES[k]?.label || k, v, CARE_TYPES[k]?.icon || 'clipboard-list']).sort((x, y) => y[1] - x[1]);
  const mb = (s.bytes || 0) / 1048576;
  const comPet = c.familias_com_pet ?? c.contas_com_pet;
  const media = comPet ? (c.pets / comPet) : 0;
  const f = d.familias;

  return head + `
    <div class="stats">
      <div class="card stat"><div class="num">${fmtN(u.total)}</div><div class="lbl">contas</div></div>
      <div class="card stat"><div class="num">${fmtN(u.novos_7d)}</div><div class="lbl">novas em 7 dias</div></div>
      <div class="card stat"><div class="num">${fmtN(a.d7)}</div><div class="lbl">ativas em 7 dias</div></div>
    </div>

    <section class="section">
      <div class="section-head"><h2>Contas ativas por dia</h2></div>
      <div class="card chart painel-chart">
        <p class="chart-sub">Contas que registraram alguma alteração, últimos 30 dias</p>
        ${serie.length ? dayBars(serie, 'ativos', ['conta ativa', 'contas ativas']) : '<p class="hint">Sem dados.</p>'}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Novos cadastros por dia</h2></div>
      <div class="card chart painel-chart">
        ${serie.length ? dayBars(serie, 'cadastros', ['cadastro', 'cadastros']) : '<p class="hint">Sem dados.</p>'}
        <details class="chart-table">
          <summary>Ver os 30 dias em tabela</summary>
          <table class="ctable"><thead><tr><th>Dia</th><th>Ativas</th><th>Cadastros</th></tr></thead>
            <tbody>${[...serie].reverse().map((x) => `<tr><td>${fmtDia(x.dia)}</td><td>${fmtN(x.ativos)}</td><td>${fmtN(x.cadastros)}</td></tr>`).join('')}</tbody>
          </table>
        </details>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Engajamento</h2></div>
      <div class="stats">
        <div class="card stat"><div class="num">${fmtN(a.d1)}</div><div class="lbl">ativas hoje</div></div>
        <div class="card stat"><div class="num">${fmtN(a.d30)}</div><div class="lbl">ativas em 30 dias</div></div>
        <div class="card stat"><div class="num">${fmtN(a.login_7d)}</div><div class="lbl">entraram em 7 dias</div></div>
      </div>
    </section>

    ${f ? `
    <section class="section">
      <div class="section-head"><h2>Famílias</h2>${f.compartilhadas ? `<span class="tag">até ${fmtN(f.maior)} pessoas</span>` : ''}</div>
      <div class="stats">
        <div class="card stat"><div class="num">${fmtN(f.total)}</div><div class="lbl">famílias</div></div>
        <div class="card stat"><div class="num">${fmtN(f.compartilhadas)}</div><div class="lbl">compartilhadas (2+ pessoas)</div></div>
        <div class="card stat"><div class="num">${fmtN(f.pessoas_em_compartilhadas)}</div><div class="lbl">pessoas nelas</div></div>
      </div>
      <div class="stats" style="margin-top:10px">
        <div class="card stat"><div class="num">${fmtN(f.convites_30d)}</div><div class="lbl">convites em 30 dias</div></div>
        <div class="card stat"><div class="num">${fmtN(f.aceitos_30d)}</div><div class="lbl">aceitos</div></div>
        <div class="card stat"><div class="num">${fmtN(f.revogados_30d)}</div><div class="lbl">cancelados</div></div>
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Como as pessoas entram</h2></div>
      <div class="card">${hbars(provedores)}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Conteúdo cadastrado</h2>${media ? `<span class="tag">${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pets por ${c.familias_com_pet !== undefined ? 'família' : 'conta'}</span>` : ''}</div>
      <div class="stats">
        <div class="card stat"><div class="num">${fmtN(c.pets)}</div><div class="lbl">pets</div></div>
        <div class="card stat"><div class="num">${fmtN(c.cuidados)}</div><div class="lbl">cuidados</div></div>
        <div class="card stat"><div class="num">${fmtN(c.gastos)}</div><div class="lbl">gastos</div></div>
      </div>
      <div class="stats" style="margin-top:10px">
        <div class="card stat"><div class="num">${fmtN(c.pesos)}</div><div class="lbl">pesagens</div></div>
        <div class="card stat"><div class="num">${fmtN(c.racoes)}</div><div class="lbl">pacotes de ração</div></div>
        <div class="card stat"><div class="num">${fmtN(c.anexos)}</div><div class="lbl">anexos</div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Pets por espécie</h2></div>
      <div class="card">${hbars(especies)}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Cuidados por tipo</h2></div>
      <div class="card">${hbars(tipos)}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Armazenamento de anexos</h2></div>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="card stat"><div class="num">${fmtN(s.arquivos)}</div><div class="lbl">arquivos</div></div>
        <div class="card stat"><div class="num">${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</div><div class="lbl">de 1 GB grátis</div></div>
      </div>
    </section>

    <p class="hint">Só números agregados: nenhum dado pessoal de usuários aparece aqui.</p>`;
}

/* dica ao passar o mouse/tocar nas barras dos gráficos */
const chartTip = document.createElement('div');
chartTip.className = 'chart-tip';
chartTip.setAttribute('role', 'tooltip');
document.body.appendChild(chartTip);
document.addEventListener('pointerover', (e) => {
  const g = e.target.closest('[data-tip]');
  document.querySelectorAll('.bar-hit.hover').forEach((x) => x !== g && x.classList.remove('hover'));
  if (!g) { chartTip.classList.remove('show'); return; }
  g.classList.add('hover');
  chartTip.textContent = g.dataset.tip;
  const r = g.getBoundingClientRect();
  chartTip.classList.add('show');
  const w = chartTip.offsetWidth;
  chartTip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  chartTip.style.top = `${r.top - chartTip.offsetHeight - 8 + window.scrollY}px`;
});
window.addEventListener('scroll', () => chartTip.classList.remove('show'), { passive: true });

/* ---------------- Tela de login ---------------- */

const googleEnabled = () => syncConfigured && cfg.googleLogin === true;
let authMode = 'entrar';   // entrar | criar | recuperar
let authNotice = '';       // mensagem informativa no topo do formulário

// Logo oficial do Google (exigido pelas diretrizes do botão "Fazer login com o Google")
const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function viewEntrar() {
  if (!syncConfigured) { setTimeout(() => { location.hash = '#/inicio'; }, 0); return ''; }
  if (isLoggedIn()) { setTimeout(() => { location.hash = destinoAposLogin(); }, 0); return ''; }

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
        ${!authNotice && typeof conviteGuardado === 'function' && conviteGuardado() ? `<p class="auth-notice" role="status">${icon('users', { size: 18 })}<span>Você recebeu um convite para uma família. Entre ou crie sua conta para aceitar.</span></p>` : ''}

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

      ${typeof canInstall === 'function' && canInstall() ? `<button type="button" class="btn plain install-cta" data-action="install">${icon('smartphone', { size: 18 })}Instalar o app no celular</button>` : ''}
      <p class="auth-foot">É gratuito. Seus dados ficam guardados na sua conta e sincronizados entre aparelhos.<br>
        <a href="privacidade.html">Política de Privacidade</a></p>
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
  if (!confirm('Sair da conta? Por segurança, os dados deste aparelho serão apagados. Eles continuam guardados na sua conta e voltam quando você entrar de novo.')) return;
  await syncNow(); // envia o que faltar antes de sair
  if (await hasPendingChanges()) {
    const ok = confirm('Algumas alterações ainda não foram enviadas para a nuvem (sem internet?). Se sair agora, elas serão perdidas. Sair mesmo assim?');
    if (!ok) return;
  }
  closeSheet();
  await sb.auth.signOut(); // o evento SIGNED_OUT apaga o aparelho e volta para o login
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
    case 'adopt-local':
    case 'discard-local': {
      const uid = el.dataset.uid;
      if (uid !== remote.userId()) { closeSheet(); break; } // a conta mudou nesse meio-tempo
      const go = async () => {
        if (el.dataset.action === 'discard-local') await wipeLocal();
        db.owner = el.dataset.fid;
        db.ownerUser = uid;
        persistLocal();
        ownerPromptOpen = false;
        closeSheet();
        toast(el.dataset.action === 'discard-local' ? 'Dados do aparelho descartados' : 'Dados juntados à sua conta');
        syncNow();
      };
      if (el.dataset.action === 'discard-local' && !confirm('Descartar os dados deste aparelho? Eles não estão em nenhuma conta e não poderão ser recuperados.')) break;
      go();
      break;
    }
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
    case 'go-painel': closeSheet(); location.hash = '#/painel'; break;
    case 'painel-atualizar': if (isAdmin && !painel.carregando) carregarPainel(); break;
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
        // o app só funciona com conta: sem sessão, vai para o login
        try { localStorage.removeItem('miaumigo:semConta'); } catch { /* resto da versão antiga */ }
        const r = route().name;
        if (!s && r !== 'entrar') location.hash = '#/entrar';
        if (s && r === 'entrar') location.hash = destinoAposLogin();
        splashReady('auth');
      }
      if (s && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) checkAdmin();
      if (event === 'SIGNED_OUT') {
        // saiu da conta: os dados do aparelho são apagados e o acesso fica bloqueado
        isAdmin = false;
        setFamilia(null);
        Object.assign(painel, { dados: null, erro: '', em: null });
        ownerPromptOpen = false;
        closeSheet();
        wipeLocal();
        authMode = 'entrar';
        location.hash = '#/entrar';
        if (wasLoggedIn) toast('Você saiu da conta.');
      }
      if (event === 'PASSWORD_RECOVERY') authSheet('nova');
      if (event === 'SIGNED_IN' && db.owner && db.owner !== s?.user?.id) {
        wipeLocal(); // dados de outra conta: nem chegam a aparecer
      }
      if (event === 'SIGNED_IN' && !wasLoggedIn) {
        authNotice = '';
        if (route().name === 'entrar') location.hash = destinoAposLogin();
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
window.__setSyncRemote = (r) => { remote = r || supabaseRemote; meta = null; localStorage.removeItem(SYNC_KEY); setFamilia(null); updateSyncUI(); render(); };
