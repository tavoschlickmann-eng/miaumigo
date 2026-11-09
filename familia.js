'use strict';

/* =========================================================
   Miaumigo — Família
   Pets compartilhados: membros, convites por link, sair/remover
   e "quem alterou". As regras valem NO BANCO (supabase/familia.sql);
   aqui fica só a interface. Usa `familia`, `remote`, `meta` e
   `syncAndWait` do sync.js.
   ========================================================= */

const CONVITE_KEY = 'miaumigo:convite';
const conviteGuardado = () => { try { return localStorage.getItem(CONVITE_KEY) || ''; } catch { return ''; } };
function guardarConvite(t) {
  try { if (t) localStorage.setItem(CONVITE_KEY, t); else localStorage.removeItem(CONVITE_KEY); } catch { /* sem storage */ }
}
/** Para onde ir depois do login: o convite aberto antes de entrar, ou o início. */
function destinoAposLogin() {
  const t = conviteGuardado();
  return t ? `#/convite/${t}` : '#/inicio';
}

// Guarda o convite assim que o link é aberto: o login (Google) sai da página e volta sem o endereço.
function capturarConviteDaUrl() {
  const m = location.hash.match(/^#\/convite\/([a-f0-9]{32,80})/i);
  if (m) guardarConvite(m[1].toLowerCase());
}
capturarConviteDaUrl();
window.addEventListener('hashchange', capturarConviteDaUrl);

const minhaConta = () => remote.userId();
const membros = () => familia?.membros || [];
const souResponsavel = () => familia?.papel === 'responsavel';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const dataCurta = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const listaNomes = (nomes) => (nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

function erroFamilia(e) {
  const m = String(e?.message || e || '');
  const known = [
    [/saia da família/i, 'Você já faz parte de uma família. Saia da família atual para entrar em outra.'],
    [/expirado/i, 'Este convite expirou. Peça um link novo para quem convidou.'],
    [/revogado/i, 'Este convite foi cancelado por quem convidou.'],
    [/já usado/i, 'Este convite já foi usado.'],
    [/convite inválido/i, 'Convite não encontrado. Confira se o link está completo.'],
    [/só o responsável/i, 'Só quem é responsável pela família pode fazer isso.'],
    [/limite de convites/i, 'Já existem 10 convites pendentes. Revogue algum para criar outro.'],
    [/única pessoa/i, 'Você é a única pessoa da família.'],
    [/pelo menos um responsável/i, 'A família precisa de pelo menos um responsável.'],
    [/não está na família/i, 'Essa pessoa não está mais na família.'],
  ];
  return known.find(([re]) => re.test(m))?.[1] || authError(e);
}

/* ---------------- Quem alterou ---------------- */

/** Linha "Alterado por Fulana em 08/11 às 14:32" (só aparece em família com 2+ pessoas). */
function autorInfo(id) {
  if (!id || membros().length < 2) return '';
  const a = meta?.autores?.[id];
  if (!a?.by) return '';
  const quem = a.by === minhaConta() ? 'você' : (membros().find((m) => m.user_id === a.by)?.nome || 'alguém que saiu da família');
  const d = new Date(a.at);
  return `<p class="autor-line">${icon('pencil', { size: 14 })}<span>Alterado por <b>${esc(quem)}</b> em ${dataCurta(a.at)} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></p>`;
}

/* ---------------- Menu e tela Família ---------------- */

function avatarMembro(m, size = '') {
  return `<span class="me-avatar ${size}"><span class="me-ini">${esc(iniciais(m.nome || '?'))}</span>${m.foto ? `<img src="${esc(m.foto)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
}

function familiaMenuRow() {
  if (!isLoggedIn()) return '';
  const n = membros().length;
  const sub = n > 1 ? `${n} pessoas · você é ${souResponsavel() ? 'responsável' : 'membro'}` : 'Compartilhe os pets com quem cuida junto';
  return menuRow('menu-familia', 'users', 'Família', sub);
}

const familiaAberta = () => sheet.open && document.getElementById('sheet-title')?.textContent === 'Família';

async function atualizarFamilia() {
  const f = await remote.rpc('minha_familia');
  setFamilia(f);
  return f;
}

function familiaSheet({ recarregar = true } = {}) {
  const f = familia;
  const eu = minhaConta();
  const resp = souResponsavel();
  const ms = membros();
  const convites = f?.convites || [];
  const conteudo = !f ? '<p class="hint">Carregando sua família…</p>' : `
    <div class="menu familia">
      <div class="fam-head">
        <span class="about-logo">${icon('users', { size: 26 })}</span>
        <div class="row-body"><b>${esc(f.nome)}</b><span>${ms.length === 1 ? 'Só você por enquanto' : plural(ms.length, 'pessoa', 'pessoas')}</span></div>
        ${resp ? `<button type="button" class="icon-btn ghost" data-action="fam-renomear" aria-label="Renomear a família">${icon('pencil', { size: 18 })}</button>` : ''}
      </div>
      <p>Todos da família veem e editam os mesmos pets, cuidados, pesos, gastos e ração.</p>

      <h3 class="menu-title">${icon('users', { size: 18 })}Pessoas</h3>
      <div class="menu-list">${ms.map((m) => membroRow(m, eu, resp)).join('')}</div>

      ${resp
        ? `<button type="button" class="btn" data-action="fam-convidar">${icon('user-plus', { size: 18 })}Convidar pessoa</button>`
        : '<p class="form-hint">Só quem é responsável pela família pode convidar pessoas.</p>'}

      ${convites.length ? `
        <h3 class="menu-title">${icon('link', { size: 18 })}Convites pendentes</h3>
        <div class="menu-list">${convites.map(conviteRow).join('')}</div>` : ''}

      ${ms.length > 1 ? `<div class="menu-list fam-sair">${menuRow('fam-sair', 'log-out', 'Sair da família', 'Os pets continuam com a família', { danger: true, chevron: false })}</div>` : ''}
    </div>`;
  openSheet('Família', conteudo, null, { back: profileMenu });
  if (recarregar) {
    atualizarFamilia()
      .then(() => { if (familiaAberta()) familiaSheet({ recarregar: false }); })
      .catch(() => { if (!familia && familiaAberta()) toast('Sem conexão: não consegui carregar a família.'); });
  }
}

function membroRow(m, eu, resp) {
  const voce = m.user_id === eu;
  const inner = `
    ${avatarMembro(m)}
    <span class="row-body">
      <span class="row-title">${esc(m.nome)}${voce ? ' <span class="tag">você</span>' : ''}</span>
      <span class="row-sub">${m.papel === 'responsavel' ? 'Responsável' : 'Membro'}${m.email ? ` · ${esc(m.email)}` : ''}</span>
    </span>`;
  return resp && !voce
    ? `<button type="button" class="menu-row" data-action="fam-membro" data-id="${esc(m.user_id)}">${inner}<span class="menu-chev">${icon('chevron-right', { size: 18 })}</span></button>`
    : `<div class="menu-row static">${inner}</div>`;
}

function conviteRow(c) {
  return `
    <div class="menu-row static convite-row">
      <span class="menu-ico">${icon('link', { size: 20 })}</span>
      <span class="row-body"><span class="row-title">Link de convite</span><span class="row-sub">Criado em ${dataCurta(c.criado_em)} · vale até ${dataCurta(c.expira_em)}</span></span>
      <span class="convite-acoes">
        <button type="button" class="icon-btn ghost" data-action="fam-reenviar" data-token="${esc(c.token)}" data-expira="${esc(c.expira_em)}" aria-label="Enviar de novo">${icon('share-2', { size: 18 })}</button>
        <button type="button" class="icon-btn ghost danger-ico" data-action="fam-revogar" data-token="${esc(c.token)}" aria-label="Revogar convite">${icon('x', { size: 18 })}</button>
      </span>
    </div>`;
}

function membroSheet(userId) {
  const m = membros().find((x) => x.user_id === userId);
  if (!m) { familiaSheet(); return; }
  const outroResp = membros().some((x) => x.papel === 'responsavel' && x.user_id !== userId);
  openSheet('Família', `
    <div class="menu">
      <div class="account">${avatarMembro(m, 'lg')}
        <div class="row-body"><div class="row-title">${esc(m.nome)}</div><div class="row-sub">${esc(m.email || '')}</div>
        <div class="row-sub">${m.papel === 'responsavel' ? 'Responsável' : 'Membro'} desde ${new Date(m.entrou_em).toLocaleDateString('pt-BR')}</div></div>
      </div>
      <div class="menu-list">
        ${m.papel === 'membro'
          ? menuRow('fam-papel', 'crown', 'Tornar responsável', 'Poderá convidar e remover pessoas', { chevron: false, data: { id: m.user_id, papel: 'responsavel' } })
          : (outroResp ? menuRow('fam-papel', 'user', 'Tornar membro', 'Deixa de convidar e remover pessoas', { chevron: false, data: { id: m.user_id, papel: 'membro' } }) : '')}
        ${menuRow('fam-remover', 'user-x', 'Remover da família', 'Perde o acesso aos pets na hora', { danger: true, chevron: false, data: { id: m.user_id } })}
      </div>
    </div>`, null, { back: () => familiaSheet() });
}

function renomearSheet() {
  openSheet('Família', `
    <form class="form" data-fam="renomear" autocomplete="off">
      <label class="field"><span>Nome da família</span><input name="nome" required maxlength="60" value="${esc(familia?.nome || '')}" placeholder="Ex.: Família Schlickmann"></label>
      <p class="form-error" id="fam-error" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn plain" data-action="menu-familia">Cancelar</button>
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>`, null, { back: () => familiaSheet() });
}

/* ---------------- Convidar ---------------- */

const linkConvite = (token) => `${location.origin}${location.pathname}#/convite/${token}`;

function conviteSheet(token, expira) {
  const link = linkConvite(token);
  const texto = `${nomeConta()} convidou você para a família “${familia?.nome || 'Minha família'}” no Miaumigo, para cuidarmos dos pets juntos. Toque no link para entrar (vale até ${dataCurta(expira)}):\n${link}`;
  openSheet('Convidar pessoa', `
    <div class="menu">
      <p>Envie este link para a pessoa. Ela entra (ou cria a conta) e aceita o convite.</p>
      <label class="field"><span>Link do convite</span><input class="invite-link" readonly value="${esc(link)}" data-select-all></label>
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">${icon('message-circle', { size: 18 })}Enviar pelo WhatsApp</a>
      <div class="${navigator.share ? 'two' : 'menu'}">
        <button type="button" class="btn plain" data-action="fam-copiar" data-text="${esc(link)}">${icon('copy', { size: 18 })}Copiar link</button>
        ${navigator.share ? `<button type="button" class="btn plain" data-action="fam-compartilhar" data-text="${esc(texto)}">${icon('share-2', { size: 18 })}Compartilhar</button>` : ''}
      </div>
      <p class="form-hint">Cada link serve para uma pessoa e vale por 7 dias. Você pode cancelá-lo em Família.</p>
    </div>`, null, { back: () => familiaSheet() });
}

async function convidar(btn) {
  btn.disabled = true;
  try {
    const c = await remote.rpc('criar_convite');
    atualizarFamilia().catch(() => {});
    conviteSheet(c.token, c.expira_em);
  } catch (e) {
    toast(erroFamilia(e));
    btn.disabled = false;
  }
}

/* ---------------- Sair, remover, papel ---------------- */

/** Envia o que falta. Sem isso, trocar de família perderia alterações. */
async function enviarPendentes() {
  await syncAndWait();
  if (await hasPendingChanges()) {
    toast('Não consegui enviar suas alterações. Verifique a internet e tente de novo.');
    return false;
  }
  return true;
}

async function sairDaFamilia() {
  const nome = familia?.nome || 'família';
  if (!confirm(`Sair da família “${nome}”?\n\nOs pets continuam com a família e os dados dela serão apagados deste aparelho. Você começa uma família nova, vazia.`)) return;
  try {
    if (!(await enviarPendentes())) return;
    trocaDeFamiliaEsperada = true;
    await remote.rpc('sair_da_familia');
    closeSheet();
    await wipeLocal();
    location.hash = '#/inicio';
    await syncAndWait();
    toast(`Você saiu da família “${nome}”.`);
  } catch (e) {
    trocaDeFamiliaEsperada = false;
    toast(erroFamilia(e));
  }
}

async function removerMembro(userId) {
  const m = membros().find((x) => x.user_id === userId);
  if (!m || !confirm(`Remover ${m.nome} da família?\n\n${m.nome} perde o acesso aos pets na hora. Os pets e tudo o que foi cadastrado continuam com a família.`)) return;
  try {
    await remote.rpc('remover_membro', { p_user: userId });
    await atualizarFamilia();
    familiaSheet({ recarregar: false });
    toast(`${m.nome} foi removido(a) da família`);
  } catch (e) { toast(erroFamilia(e)); }
}

async function alterarPapel(userId, papel) {
  try {
    await remote.rpc('alterar_papel', { p_user: userId, p_papel: papel });
    await atualizarFamilia();
    membroSheet(userId);
    toast(papel === 'responsavel' ? 'Agora essa pessoa também é responsável' : 'Papel alterado para membro');
  } catch (e) { toast(erroFamilia(e)); }
}

async function revogarConvite(token) {
  if (!confirm('Cancelar este convite? O link deixa de funcionar.')) return;
  try {
    await remote.rpc('revogar_convite', { p_token: token });
    await atualizarFamilia();
    familiaSheet({ recarregar: false });
    toast('Convite cancelado');
  } catch (e) { toast(erroFamilia(e)); }
}

/* ---------------- Tela do convite (#/convite/<token>) ---------------- */

const conviteUI = { token: null, dados: null, erro: '', carregando: false, levar: true, enviando: false };

async function carregarConvite() {
  const token = conviteUI.token;
  conviteUI.carregando = true;
  try {
    const d = await remote.rpc('ver_convite', { p_token: token });
    if (conviteUI.token !== token) return;
    conviteUI.dados = d;
    if (d.status !== 'valido' && d.status !== 'em_familia') guardarConvite(''); // não serve mais
  } catch (e) {
    conviteUI.erro = erroFamilia(e);
  } finally {
    conviteUI.carregando = false;
    if (route().name === 'convite') render();
  }
}

function viewConvite(token) {
  token = String(token || '').toLowerCase();
  if (conviteUI.token !== token) Object.assign(conviteUI, { token, dados: null, erro: '', carregando: false, levar: true, enviando: false });
  if (!conviteUI.dados && !conviteUI.carregando && !conviteUI.erro) setTimeout(carregarConvite, 0);

  const casca = (corpo) => `
    <div class="top"><div><a class="back" href="#/inicio" data-action="convite-recusar">${icon('chevron-left', { size: 18 })}Início</a><h1>Convite</h1></div></div>
    <div class="card convite-card">${corpo}</div>`;
  const fim = (ic, titulo, texto, botao = `<button type="button" class="btn" data-action="convite-recusar">Ir para o início</button>`) =>
    casca(`<div class="convite-ico ${ic === 'triangle-alert' ? 'warn' : ''}">${icon(ic, { size: 34 })}</div><h2>${titulo}</h2><p>${texto}</p>${botao}`);

  if (conviteUI.erro) return fim('cloud-off', 'Não consegui abrir o convite', esc(conviteUI.erro), `<button type="button" class="btn" data-action="convite-tentar">Tentar de novo</button>`);
  const d = conviteUI.dados;
  if (!d) return casca('<p class="hint">Abrindo o convite…</p>');

  const fam = `<b>“${esc(d.familia || '')}”</b>`;
  switch (d.status) {
    case 'invalido': return fim('triangle-alert', 'Convite não encontrado', 'Confira se o link está completo ou peça um link novo para quem convidou.');
    case 'expirado': return fim('hourglass', 'Este convite expirou', `O convite para a família ${fam} venceu. Peça um link novo para quem convidou.`);
    case 'revogado': return fim('triangle-alert', 'Convite cancelado', `Quem convidou cancelou este link para a família ${fam}.`);
    case 'usado': return fim('triangle-alert', 'Convite já usado', 'Cada link serve para uma pessoa só. Peça um link novo para quem convidou.');
    case 'ja_membro': guardarConvite(''); return fim('check', 'Você já está nessa família', `Você já faz parte da família ${fam}.`);
    case 'em_familia': return fim('users', 'Você já faz parte de uma família', `Para entrar na família ${fam}, saia primeiro da sua família atual (Minha conta → Família → Sair da família) e abra o link de novo.`,
      `<button type="button" class="btn" data-action="menu-familia">Ver minha família</button><button type="button" class="link-btn" data-action="convite-recusar">Agora não</button>`);
  }

  const pets = d.meus_pets || [];
  const repetidos = pets.filter((p) => p.repetido);
  const levar = conviteUI.levar;
  const escolha = !pets.length ? '' : `
    <div class="convite-pets">
      <p class="convite-q">Você tem ${plural(pets.length, 'pet', 'pets')}: <b>${esc(listaNomes(pets.map((p) => p.nome)))}</b>. Quer levar para a família?</p>
      <div class="seg" role="group" aria-label="Levar meus pets">
        <button type="button" data-action="convite-levar" data-v="1" aria-pressed="${levar}">Levar meus pets</button>
        <button type="button" data-action="convite-levar" data-v="0" aria-pressed="${!levar}">Não levar</button>
      </div>
      ${levar
        ? `<p class="convite-nota">${icon('check', { size: 16 })}<span>Vão junto com cuidados, pesos, ração, gastos e anexos.</span></p>
           ${repetidos.length ? `<p class="convite-nota warn">${icon('triangle-alert', { size: 16 })}<span><b>${esc(listaNomes(repetidos.map((p) => p.nome)))}</b> já ${repetidos.length > 1 ? 'existem' : 'existe'} na família e não ${repetidos.length > 1 ? 'serão trazidos' : 'será trazido'}. ${repetidos.length > 1 ? 'Os seus' : 'O seu'} e tudo ligado a ${repetidos.length > 1 ? 'eles' : 'ele'} serão apagados.</span></p>` : ''}`
        : `<p class="convite-nota warn">${icon('triangle-alert', { size: 16 })}<span>Seus pets e tudo deles (cuidados, pesos, ração, gastos e anexos) serão apagados. Você passa a ver só os pets da família.</span></p>`}
    </div>`;

  return casca(`
    <div class="convite-ico">${icon('users', { size: 34 })}</div>
    <h2>Você foi convidado(a)!</h2>
    <p><b>${esc(d.convidado_por || 'Alguém')}</b> convidou você para a família ${fam} no Miaumigo (${plural(Number(d.membros) || 1, 'pessoa', 'pessoas')}).</p>
    <p class="convite-sub">Na família, todos veem e editam os mesmos pets, cuidados, pesos, gastos e ração. Vale até ${dataCurta(d.expira_em)}.</p>
    ${escolha}
    <button type="button" class="btn block ${conviteUI.enviando ? 'loading' : ''}" data-action="convite-aceitar" ${conviteUI.enviando ? 'disabled' : ''}>${conviteUI.enviando ? 'Entrando…' : 'Entrar na família'}</button>
    <button type="button" class="link-btn" data-action="convite-recusar" ${conviteUI.enviando ? 'disabled' : ''}>Agora não</button>`);
}

/** Apaga no aparelho os pets e tudo ligado a eles (cuidados, anexos, pesos, gastos, ração). */
async function apagarPetsLocais(ids) {
  const set = new Set(ids);
  const careIds = db.cuidados.filter((c) => set.has(c.petId)).map((c) => c.id);
  await deleteAttachmentsOf(careIds);
  db.pets = db.pets.filter((p) => !set.has(p.id));
  db.cuidados = db.cuidados.filter((c) => !set.has(c.petId));
  db.pesos = db.pesos.filter((w) => !set.has(w.petId));
  db.gastos = db.gastos.filter((g) => !set.has(g.petId));
  db.racoes = db.racoes.filter((r) => !set.has(r.petId));
  persistLocal();
}

async function aceitarConvite() {
  const d = conviteUI.dados;
  if (!d || d.status !== 'valido' || conviteUI.enviando) return;
  const token = conviteUI.token;
  const pets = d.meus_pets || [];
  const levar = pets.length ? conviteUI.levar : true;
  const apagar = levar ? pets.filter((p) => p.repetido) : pets;
  let msg = `Entrar na família “${d.familia}”?`;
  if (!levar) msg += `\n\nSeus pets (${listaNomes(pets.map((p) => p.nome))}) e tudo deles serão apagados. Não dá para desfazer.`;
  else if (apagar.length) msg += `\n\n${listaNomes(apagar.map((p) => p.nome))} já existe na família: o seu e tudo ligado a ele serão apagados. Não dá para desfazer.`;
  if (!confirm(msg)) return;

  conviteUI.enviando = true;
  render();
  try {
    // 1. tudo o que está no aparelho vai para a nuvem
    if (!(await enviarPendentes())) return;
    // 2. o que não vai junto é apagado (no aparelho e, sincronizando, na nuvem e nos arquivos)
    if (apagar.length || !levar) {
      if (!levar) {
        await IDB.clear().catch(() => {});
        Object.assign(db, { pets: [], cuidados: [], pesos: [], gastos: [], racoes: [] });
        persistLocal();
      } else await apagarPetsLocais(apagar.map((p) => p.id));
      if (!(await enviarPendentes())) return;
    }
    // 3. entra na família (o banco confere tudo de novo)
    trocaDeFamiliaEsperada = true;
    await remote.rpc('aceitar_convite', { p_token: token, p_levar_pets: levar });
    guardarConvite('');
    await wipeLocal();
    location.hash = '#/inicio';
    await syncAndWait();
    toast(`Bem-vindo(a) à família “${d.familia}”!`);
  } catch (e) {
    trocaDeFamiliaEsperada = false;
    toast(erroFamilia(e));
    conviteUI.dados = null; // recarrega a situação do convite
  } finally {
    conviteUI.enviando = false;
    if (route().name === 'convite') render();
  }
}

/* ---------------- Ações ---------------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'menu-familia':
      if (route().name === 'convite') location.hash = '#/inicio';
      familiaSheet();
      break;
    case 'fam-convidar': convidar(el); break;
    case 'fam-reenviar': conviteSheet(el.dataset.token, el.dataset.expira); break;
    case 'fam-revogar': revogarConvite(el.dataset.token); break;
    case 'fam-membro': membroSheet(el.dataset.id); break;
    case 'fam-remover': removerMembro(el.dataset.id); break;
    case 'fam-papel': alterarPapel(el.dataset.id, el.dataset.papel); break;
    case 'fam-renomear': renomearSheet(); break;
    case 'fam-sair': sairDaFamilia(); break;
    case 'fam-copiar':
      navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Link copiado'), () => toast('Não consegui copiar. Segure o link para copiar.'));
      break;
    case 'fam-compartilhar':
      navigator.share?.({ title: 'Convite para a família no Miaumigo', text: el.dataset.text }).catch(() => {});
      break;
    case 'convite-levar': conviteUI.levar = el.dataset.v === '1'; render(); break;
    case 'convite-aceitar': aceitarConvite(); break;
    case 'convite-tentar': conviteUI.erro = ''; render(); break;
    case 'convite-recusar':
      e.preventDefault();
      guardarConvite('');
      location.hash = '#/inicio';
      break;
  }
});

document.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-select-all]')) e.target.select(); });

// formulário de renomear (não usa o onSubmit genérico das folhas, que salva o app)
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-fam]');
  if (!form) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const btn = form.querySelector('[type=submit]');
  const err = form.querySelector('#fam-error');
  btn.disabled = true;
  try {
    await remote.rpc('renomear_familia', { p_nome: form.nome.value.trim() });
    await atualizarFamilia();
    if (db.ownerNome !== familia.nome) { db.ownerNome = familia.nome; persistLocal(); }
    familiaSheet({ recarregar: false });
    toast('Nome da família atualizado');
  } catch (ex) {
    err.textContent = erroFamilia(ex);
    err.hidden = false;
    btn.disabled = false;
  }
}, true);
