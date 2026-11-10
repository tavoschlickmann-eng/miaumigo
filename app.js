'use strict';

/* =========================================================
   Miaumigo — gerenciamento de pets
   Dados salvos no navegador (localStorage), sem servidor.
   Ícones: Lucide (icons.js).
   ========================================================= */

const STORAGE_KEY = 'miaumigo:v1';

const SPECIES = {
  gato: { label: 'Gato', icon: 'cat' },
  cachorro: { label: 'Cachorro', icon: 'dog' },
  coelho: { label: 'Coelho', icon: 'rabbit' },
  roedor: { label: 'Roedor', icon: 'rat' },
  passaro: { label: 'Pássaro', icon: 'bird' },
  peixe: { label: 'Peixe', icon: 'fish' },
  reptil: { label: 'Réptil', icon: 'turtle' },
  outro: { label: 'Outro', icon: 'paw-print' },
};

const CARE_TYPES = {
  vacina: { label: 'Vacina', icon: 'syringe' },
  vermifugo: { label: 'Vermífugo', icon: 'worm' },
  antipulgas: { label: 'Antipulgas', icon: 'bug-off' },
  remedio: { label: 'Remédio', icon: 'pill' },
  consulta: { label: 'Consulta', icon: 'stethoscope' },
  banho: { label: 'Banho e tosa', icon: 'bath' },
  outro: { label: 'Outro', icon: 'clipboard-list' },
};

const EXPENSE_CATS = {
  racao: { label: 'Ração e petiscos', icon: 'utensils' },
  saude: { label: 'Saúde', icon: 'heart-pulse' },
  higiene: { label: 'Higiene', icon: 'sparkles' },
  brinquedos: { label: 'Brinquedos', icon: 'toy-brick' },
  acessorios: { label: 'Acessórios', icon: 'shopping-bag' },
  servicos: { label: 'Serviços', icon: 'scissors' },
  outros: { label: 'Outros', icon: 'package' },
};

const REPEAT_OPTIONS = [
  [0, 'Não repetir'],
  [1, 'Todo dia'],
  [7, 'Toda semana'],
  [15, 'A cada 15 dias'],
  [30, 'Todo mês'],
  [90, 'A cada 3 meses'],
  [180, 'A cada 6 meses'],
  [365, 'Todo ano'],
];

const REMINDER_OPTIONS = [
  [-1, 'Sem lembrete'],
  [0, 'No dia'],
  [1, '1 dia antes'],
  [3, '3 dias antes'],
  [7, '1 semana antes'],
];

const AVATAR_COLORS = ['#FDE2D3', '#E3EDFB', '#E2F4EA', '#F6E3F7', '#FFF1C9', '#DDF3F3'];

/* ---------------- Helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toISO(new Date());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const kg = (v) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
const byDate = (a, b) => a.data.localeCompare(b.data);
const byDateDesc = (a, b) => b.data.localeCompare(a.data);

function fmtDate(s) {
  if (!s) return '';
  const d = parseISO(s);
  const opts = { day: '2-digit', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('pt-BR', opts).replace('.', '');
}

function relDate(s) {
  const n = daysBetween(today(), s);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1 && n < 45) return `em ${n} dias`;
  if (n < -1 && n > -45) return `há ${-n} dias`;
  return fmtDate(s);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function ageText(birth) {
  if (!birth) return '';
  const b = parseISO(birth);
  const t = new Date();
  let months = (t.getFullYear() - b.getFullYear()) * 12 + t.getMonth() - b.getMonth();
  if (t.getDate() < b.getDate()) months--;
  if (months < 0) return '';
  if (months < 1) {
    const d = daysBetween(birth, today());
    return `${d} dia${d === 1 ? '' : 's'}`;
  }
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(months / 12);
  const r = months % 12;
  return `${y} ano${y > 1 ? 's' : ''}` + (r ? ` e ${r} ${r === 1 ? 'mês' : 'meses'}` : '');
}

function daysToBirthday(birth) {
  if (!birth) return null;
  const b = parseISO(birth);
  const t = parseISO(today());
  let next = new Date(t.getFullYear(), b.getMonth(), b.getDate());
  if (next < t) next = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate());
  return Math.round((next - t) / 864e5);
}

function colorFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/* ---------------- Data ---------------- */

const defaultConfig = () => ({ lembretes: false, horario: '09:00', avisados: {} });
const emptyDB = () => ({ pets: [], cuidados: [], pesos: [], gastos: [], racoes: [], notas: [], config: defaultConfig() });

function normalize(d) {
  const base = { ...emptyDB(), ...d };
  base.config = { ...defaultConfig(), ...(d.config || {}) };
  return base;
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* storage indisponível */ }
  return emptyDB();
}

let db = loadDB();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('Não consegui salvar. O armazenamento pode estar cheio.');
  }
  if (typeof scheduleSync === 'function') scheduleSync(); // sync.js
}

const getPet = (id) => db.pets.find((p) => p.id === id);
const petName = (id) => getPet(id)?.nome ?? 'Geral';
const latestWeight = (petId) => db.pesos.filter((w) => w.petId === petId).sort(byDateDesc)[0];
const reminderOf = (c) => (c.lembrete === undefined ? 0 : Number(c.lembrete));
const fullDate = (s) => (s ? parseISO(s).toLocaleDateString('pt-BR') : '');
/** "Alterado por Fulana em ..." no editar (só em família com 2+ pessoas; familia.js). */
/** Etiqueta "Só meu" / "Família" (familia.js). `soPessoal`: só a de "Só meu" (lista de pets). */
const espTag = (p, soPessoal = false) => (typeof petEspacoTag === 'function' && (!soPessoal || !petDaFamilia(p.id)) ? petEspacoTag(p) : '');
/** Botão de anexar: no plano grátis vira um aviso de Premium (sem fechar o formulário aberto). */
function anexarBtn(texto, accept, ic) {
  if (typeof ehPremium === 'function' && !ehPremium()) {
    return `<button type="button" class="btn plain attach-add" data-action="premium-anexo">${icon('lock', { size: 18 })}${texto}<span class="premium-tag">Premium</span></button>
      <p class="premium-dica" hidden>${icon('sparkles', { size: 16 })}<span>Fotos e anexos são do Premium. <button type="button" class="link-btn" data-action="premium" data-motivo="anexos">Conhecer o Premium</button></span></p>`;
  }
  return `<label class="btn plain attach-add">${icon(ic, { size: 18 })}${texto}<input type="file" accept="${accept}" multiple data-attach hidden></label>`;
}
const autorLinha = (rec) => (rec?.id && typeof autorInfo === 'function' ? autorInfo(rec.id) : '');

/* ---- Ração ---- */
const activeFood = (petId) => db.racoes.filter((r) => r.petId === petId && !r.fim).sort((a, b) => b.inicio.localeCompare(a.inicio))[0];

function foodStatus(r) {
  const totalG = r.pesoKg * 1000;
  const usados = r.consumoG * Math.max(0, daysBetween(r.inicio, today()));
  const restanteG = Math.max(0, totalG - usados);
  const dias = Math.floor(restanteG / r.consumoG);
  return { restanteG, dias, fimData: addDays(today(), dias), pct: totalG ? restanteG / totalG : 0, acabando: dias <= (r.aviso ?? 5) };
}

/* ---- Anexos (IndexedDB: fotos e PDFs não cabem no localStorage) ---- */
const IDB = (() => {
  let conn;
  const open = () => (conn ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('miaumigo', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('anexos', { keyPath: 'id' }).createIndex('careId', 'careId');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('anexos', mode);
      const req = fn(t.objectStore('anexos'));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    put: (a) => run('readwrite', (s) => s.put(a)),
    get: (id) => run('readonly', (s) => s.get(id)),
    del: (id) => run('readwrite', (s) => s.delete(id)),
    byCare: (careId) => run('readonly', (s) => s.index('careId').getAll(careId)),
    all: () => run('readonly', (s) => s.getAll()),
    clear: () => run('readwrite', (s) => s.clear()),
  };
})();

async function deleteAttachmentsOf(careIds) {
  const ids = new Set(careIds);
  const all = await IDB.all().catch(() => []);
  await Promise.all(all.filter((a) => ids.has(a.careId)).map((a) => IDB.del(a.id)));
}

/* ---------------- UI state ---------------- */

const ui = {
  petTab: 'saude',
  agendaPet: 'todos',
  month: today().slice(0, 7),
};

/* ---------------- Rendering ---------------- */

const app = $('#app');

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { name: parts[0] || 'inicio', id: parts[1] };
}

/* ---------------- Splash ----------------
   Some quando o app desenhou ('app') e o login foi verificado ('auth', avisado
   pelo sync.js). Fica no mínimo ~1 s para a animação terminar e no máximo 4 s. */
const splashWait = new Set(['app', 'auth']);
function splashReady(part) {
  if (part) splashWait.delete(part);
  if (splashWait.size) return;
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('out')) return;
  const min = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1100;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }, Math.max(0, min - performance.now()));
}
setTimeout(() => { splashWait.clear(); splashReady(); }, 4000);

function render() {
  const r = route();
  const views = {
    inicio: viewHome, pets: viewPets, pet: viewPet, carteira: viewCarteira, agenda: viewAgenda, gastos: viewGastos,
    entrar: (id) => (typeof viewEntrar === 'function' ? viewEntrar(id) : viewHome()), // tela de login (sync.js)
    painel: (id) => (typeof viewPainel === 'function' ? viewPainel(id) : viewHome()), // painel de uso (sync.js)
    convite: (id) => (typeof viewConvite === 'function' ? viewConvite(id) : viewHome()), // convite para a família (familia.js)
    relatorio: (id) => (typeof viewRelatorio === 'function' ? viewRelatorio(id) : viewHome()), // relatório para o veterinário (relatorio.js)
  };
  // o app só funciona com conta: sem login, qualquer tela vira a tela de login
  const mustLogin = typeof syncConfigured !== 'undefined' && syncConfigured && typeof isLoggedIn === 'function' && !isLoggedIn();
  const name = mustLogin ? 'entrar' : r.name;
  const view = views[name] || viewHome;
  app.innerHTML = view(r.id);
  document.body.classList.toggle('no-tabbar', name === 'entrar' && typeof viewEntrar === 'function');

  const activeTab = ['pet', 'carteira', 'relatorio'].includes(r.name) ? 'pets' : (views[r.name] ? r.name : 'inicio');
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === activeTab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function avatar(pet, size = '') {
  const px = { lg: 44, sm: 20 }[size] || 26;
  const inner = pet.foto
    ? `<img src="${esc(pet.foto)}" alt="">`
    : icon(SPECIES[pet.especie]?.icon ?? 'paw-print', { size: px });
  return `<div class="avatar ${size}" style="--av:${colorFor(pet.id)}">${inner}</div>`;
}

function careRow(c, { showPet = true } = {}) {
  const t = CARE_TYPES[c.tipo] ?? CARE_TYPES.outro;
  const n = daysBetween(today(), c.data);
  const state = c.feito ? 'done' : n < 0 ? 'late' : n === 0 ? 'today' : '';
  const repeat = c.repetir ? REPEAT_OPTIONS.find(([d]) => d === c.repetir)?.[1] : '';
  const sub = [
    showPet ? esc(petName(c.petId)) : '',
    `<span class="when">${c.feito ? fmtDate(c.data) : relDate(c.data)}</span>`,
    repeat ? `<span class="meta-ico">${icon('repeat', { size: 13 })}${esc(repeat.toLowerCase())}</span>` : '',
    !c.feito && db.config.lembretes && reminderOf(c) >= 0 ? `<span class="meta-ico" title="Com lembrete">${icon('bell', { size: 13 })}</span>` : '',
    c.anexos ? `<span class="meta-ico" title="Anexos">${icon('paperclip', { size: 13 })}${c.anexos}</span>` : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="row care ${state}">
      <button class="check" data-action="toggle-care" data-id="${c.id}" aria-label="${c.feito ? 'Marcar como pendente' : 'Marcar como feito'}">${icon('check', { size: 16 })}</button>
      <button class="row-main" data-action="edit-care" data-id="${c.id}">
        <div class="row-title"><span class="type-ico">${icon(t.icon, { size: 16 })}</span>${esc(c.titulo || t.label)}</div>
        <div class="row-sub">${sub}</div>
      </button>
    </div>`;
}

function expenseRow(g, { showPet = true } = {}) {
  const cat = EXPENSE_CATS[g.categoria] ?? EXPENSE_CATS.outros;
  const sub = [fmtDate(g.data), showPet && g.petId ? esc(petName(g.petId)) : '', cat.label].filter(Boolean).join(' · ');
  return `
    <button class="row row-btn" data-action="edit-expense" data-id="${g.id}">
      <span class="ibox">${icon(cat.icon)}</span>
      <span class="row-body">
        <div class="row-title">${esc(g.descricao || cat.label)}</div>
        <div class="row-sub">${sub}</div>
      </span>
      <span class="row-end">${brl(g.valor)}</span>
    </button>`;
}

function emptyState(iconName, title, text, buttons = '') {
  return `<div class="empty"><div class="empty-ico">${icon(iconName, { size: 40 })}</div><h2>${title}</h2><p>${text}</p>${buttons ? `<div class="btns">${buttons}</div>` : ''}</div>`;
}

/* ---- Início ---- */
function viewHome() {
  const header = `
    <header class="top">
      <div>
        <h1 class="brand">${icon('paw-print', { size: 26, cls: 'brand-ico' })}Miaumigo</h1>
        <p class="sub">${greeting()}</p>
      </div>
      <div class="top-actions">
        ${typeof syncBadge === 'function' ? syncBadge() : `<button class="icon-btn" data-action="profile" aria-label="Minha conta">${icon('user')}</button>`}
      </div>
    </header>`;

  if (!db.pets.length) {
    return header + (typeof installBanner === 'function' ? installBanner() : '') + `<div class="card">${emptyState('cat', 'Bem-vindo ao Miaumigo!',
      'Cadastre seus pets para acompanhar vacinas, remédios, peso e gastos em um só lugar.',
      '<button class="btn" data-action="add-pet">Cadastrar meu primeiro pet</button>')}</div>`;
  }

  const t = today();
  const pending = db.cuidados.filter((c) => !c.feito).sort(byDate);
  const late = pending.filter((c) => c.data < t);
  const upcoming = pending.filter((c) => c.data >= t).slice(0, 5);
  const monthTotal = db.gastos.filter((g) => g.data.startsWith(t.slice(0, 7))).reduce((s, g) => s + Number(g.valor), 0);

  const birthdays = db.pets
    .map((p) => ({ p, d: daysToBirthday(p.nascimento) }))
    .filter((x) => x.d !== null && x.d <= 7)
    .map(({ p, d }) => `<div class="banner"><span class="banner-ico">${icon('cake', { size: 22 })}</span><span>${d === 0 ? `Hoje é aniversário de <b>${esc(p.nome)}</b>!` : `Aniversário de <b>${esc(p.nome)}</b> ${d === 1 ? 'amanhã' : `em ${d} dias`}.`}</span></div>`)
    .join('');

  const foodBanners = db.pets.map((p) => ({ p, r: activeFood(p.id) }))
    .filter(({ r }) => r && foodStatus(r).acabando)
    .map(({ p, r }) => {
      const d = foodStatus(r).dias;
      return `<a class="banner warn" href="#/pet/${p.id}" data-action="pet-tab" data-tab="racao"><span class="banner-ico">${icon('bone', { size: 22 })}</span><span style="flex:1">A ração de <b>${esc(p.nome)}</b> ${d === 0 ? 'acabou' : `acaba em ~${d} dia${d === 1 ? '' : 's'}`}. Hora de comprar.</span>${icon('chevron-right', { size: 18 })}</a>`;
    }).join('');

  const reminderBanner = !db.config.lembretes && pending.length && !db.config.bannerFechado ? `
    <div class="banner">
      <span class="banner-ico">${icon('bell-ring', { size: 22 })}</span>
      <span style="flex:1">Quer ser avisado antes de cada vacina e remédio?</span>
      <button class="btn sm" data-action="enable-reminders">Ativar</button>
      <button class="icon-btn ghost" data-action="dismiss-banner" aria-label="Agora não">${icon('x', { size: 18 })}</button>
    </div>` : '';

  return header + `
    <div class="pet-strip">
      ${db.pets.map((p) => `<a class="pet-chip" href="#/pet/${p.id}">${avatar(p)}<span>${esc(p.nome)}</span></a>`).join('')}
      <button class="pet-chip add" data-action="add-pet"><div class="avatar">${icon('plus', { size: 24 })}</div><span>Novo</span></button>
    </div>

    <div class="stats" style="margin-top:14px">
      <a class="card stat" href="#/pets"><div class="num">${db.pets.length}</div><div class="lbl">${db.pets.length === 1 ? 'pet' : 'pets'}</div></a>
      <a class="card stat ${late.length ? 'alert' : ''}" href="#/agenda"><div class="num">${late.length}</div><div class="lbl">atrasado${late.length === 1 ? '' : 's'}</div></a>
      <a class="card stat" href="#/gastos"><div class="num">${monthTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</div><div class="lbl">no mês</div></a>
    </div>

    ${typeof installBanner === 'function' ? installBanner() : ''}
    ${reminderBanner}
    ${foodBanners}
    ${birthdays}

    ${late.length ? `
    <section class="section">
      <div class="section-head"><h2 class="h-ico warn">${icon('triangle-alert', { size: 18 })}Atrasados</h2></div>
      <div class="card list">${late.map((c) => careRow(c)).join('')}</div>
    </section>` : ''}

    <section class="section">
      <div class="section-head">
        <h2>Próximos cuidados</h2>
        <button class="link" data-action="add-care">${icon('plus', { size: 16 })}Adicionar</button>
      </div>
      <div class="card list">
        ${upcoming.length ? upcoming.map((c) => careRow(c)).join('') : '<p class="hint">Nada agendado. Que tal registrar a próxima vacina?</p>'}
      </div>
    </section>`;
}

function greeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = contaAtual() ? nomeConta().split(' ')[0] : '';
  return `${g}${nome ? `, ${esc(nome)}` : ''}! Veja como estão seus pets.`;
}

/* ---- Lista de pets ---- */
function viewPets() {
  const header = `
    <header class="top">
      <div><h1>Meus pets</h1><p class="sub">${db.pets.length} cadastrado${db.pets.length === 1 ? '' : 's'}</p></div>
      <button class="btn" data-action="add-pet">${icon('plus', { size: 18 })}Novo pet</button>
    </header>`;

  if (!db.pets.length) {
    return header + `<div class="card">${emptyState('dog', 'Nenhum pet ainda', 'Adicione o primeiro membro peludo (ou não!) da família.',
      '<button class="btn" data-action="add-pet">Cadastrar pet</button>')}</div>`;
  }

  return header + db.pets.map((p) => {
    const w = latestWeight(p.id);
    const meta = [SPECIES[p.especie]?.label, p.raca, ageText(p.nascimento), w ? kg(w.kg) : ''].filter(Boolean).map(esc).join(' · ');
    const pend = db.cuidados.filter((c) => c.petId === p.id && !c.feito && c.data < today()).length;
    return `
      <a class="card pet-card" href="#/pet/${p.id}">
        ${avatar(p)}
        <div style="min-width:0">
          <div class="name">${esc(p.nome)} ${pend ? `<span class="tag">${pend} atrasado${pend > 1 ? 's' : ''}</span>` : ''}${espTag(p, true)}</div>
          <div class="meta">${meta}</div>
        </div>
        <span class="chev">${icon('chevron-right')}</span>
      </a>`;
  }).join('');
}

/* ---- Perfil do pet ---- */
function viewPet(id) {
  const p = getPet(id);
  if (!p) {
    return `<a class="back" href="#/pets">${icon('chevron-left', { size: 18 })}Pets</a><div class="card">${emptyState('search', 'Pet não encontrado', 'Ele pode ter sido removido.')}</div>`;
  }
  const w = latestWeight(p.id);
  const chips = [
    SPECIES[p.especie] ? [SPECIES[p.especie].icon, SPECIES[p.especie].label] : null,
    p.sexo ? (p.sexo === 'F' ? ['venus', 'Fêmea'] : ['mars', 'Macho']) : null,
    w ? ['scale', kg(w.kg)] : null,
    p.castrado ? ['scissors', 'Castrado'] : null,
  ].filter(Boolean);

  const tabs = [['saude', 'Saúde'], ['notas', 'Notas'], ['peso', 'Peso'], ['racao', 'Ração'], ['gastos', 'Gastos']];
  const tabBody = { saude: petHealth, notas: (x) => (typeof petNotas === 'function' ? petNotas(x) : ''), peso: petWeight, racao: petFood, gastos: petExpenses }[ui.petTab] || petHealth;

  return `
    <div class="top" style="margin-bottom:0">
      <a class="back" href="#/pets">${icon('chevron-left', { size: 18 })}Pets</a>
      <button class="icon-btn" data-action="pet-about" data-id="${p.id}" aria-label="Sobre ${esc(p.nome)} e editar perfil">${icon('pencil', { size: 18 })}</button>
    </div>
    <div class="pet-hero">
      ${avatar(p, 'lg')}
      <h1>${esc(p.nome)}</h1>
      <div class="meta">${esc([p.raca, ageText(p.nascimento)].filter(Boolean).join(' · ') || 'Toque no lápis para completar o perfil')}</div>
      <div class="chips">${chips.map(([ic, l]) => `<span class="chip">${icon(ic, { size: 15 })}${esc(l)}</span>`).join('')}</div>
      ${espTag(p)}
      <div class="pet-docs">
        <a class="btn sm ghost" href="#/carteira/${p.id}">${icon('id-card', { size: 16 })}Carteirinha de vacinação</a>
        <button type="button" class="btn sm ghost" data-action="relatorio" data-id="${p.id}">${icon('stethoscope', { size: 16 })}Relatório para o veterinário</button>
      </div>
      ${typeof petCompartilharBtn === 'function' ? petCompartilharBtn(p) : ''}
    </div>
    <div class="seg" role="group" aria-label="Seções do pet">
      ${tabs.map(([k, l]) => `<button data-action="pet-tab" data-tab="${k}" aria-pressed="${ui.petTab === k}">${l}</button>`).join('')}
    </div>
    ${tabBody(p)}`;
}

function petHealth(p) {
  const list = db.cuidados.filter((c) => c.petId === p.id);
  const pending = list.filter((c) => !c.feito).sort(byDate);
  const done = list.filter((c) => c.feito).sort(byDateDesc);
  return `
    <section class="section">
      <div class="section-head"><h2>Pendentes</h2><button class="btn sm ghost" data-action="add-care" data-pet="${p.id}">${icon('plus', { size: 16 })}Cuidado</button></div>
      <div class="card list">${pending.length ? pending.map((c) => careRow(c, { showPet: false })).join('') : '<p class="hint">Tudo em dia!</p>'}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Histórico</h2></div>
      <div class="card list">${done.length ? done.map((c) => careRow(c, { showPet: false })).join('') : '<p class="hint">Os cuidados concluídos aparecem aqui.</p>'}</div>
    </section>`;
}

function petWeight(p) {
  const list = db.pesos.filter((w) => w.petId === p.id).sort(byDate);
  let delta = '';
  if (list.length >= 2) {
    const d = list[list.length - 1].kg - list[list.length - 2].kg;
    if (Math.abs(d) > 0.001) delta = ` <span class="tag">${d > 0 ? '▲' : '▼'} ${kg(Math.abs(d))}</span>`;
  }
  return `
    <section class="section">
      <div class="section-head"><h2>Evolução${delta}</h2><button class="btn sm ghost" data-action="add-weight" data-pet="${p.id}">${icon('plus', { size: 16 })}Pesagem</button></div>
      <div class="card chart">${weightChart(list)}</div>
    </section>
    ${list.length ? `
    <section class="section">
      <div class="section-head"><h2>Registros</h2></div>
      <div class="card list">
        ${[...list].reverse().map((w) => `
          <div class="row">
            <span class="ibox">${icon('scale')}</span>
            <div class="row-body"><div class="row-title">${kg(w.kg)}</div><div class="row-sub">${fmtDate(w.data)}</div></div>
            <button class="del" data-action="delete-weight" data-id="${w.id}" aria-label="Apagar pesagem">${icon('trash-2', { size: 18 })}</button>
          </div>`).join('')}
      </div>
    </section>` : ''}`;
}

function weightChart(list) {
  if (list.length < 2) {
    return `<p class="hint">${list.length ? 'Registre mais uma pesagem para ver o gráfico.' : 'Nenhuma pesagem ainda. Acompanhar o peso ajuda a detectar problemas cedo.'}</p>`;
  }
  const W = 340, H = 160, L = 38, R = 14, T = 14, B = 26;
  const xs = list.map((w) => parseISO(w.data).getTime());
  const ys = list.map((w) => Number(w.kg));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padY = Math.max((y1 - y0) * 0.2, 0.2);
  y0 = Math.max(0, y0 - padY); y1 += padY;
  const sx = (x) => L + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const pts = list.map((w, i) => [sx(xs[i]), sy(ys[i])]);
  const line = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  const area = `${L},${H - B} ${line} ${pts[pts.length - 1][0].toFixed(1)},${H - B}`;
  const ticks = [y0, (y0 + y1) / 2, y1];
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de peso">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</text>`).join('')}
      <polygon class="area" points="${area}" opacity=".6"/>
      <polyline class="line" points="${line}"/>
      ${pts.map(([x, y]) => `<circle class="dot" cx="${x}" cy="${y}" r="4"/>`).join('')}
      <text class="axis" x="${L}" y="${H - 6}">${fmtDate(list[0].data)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtDate(list[list.length - 1].data)}</text>
    </svg>`;
}

function petFood(p) {
  const r = activeFood(p.id);
  const past = db.racoes.filter((x) => x.petId === p.id && x.fim).sort((a, b) => b.inicio.localeCompare(a.inicio));
  const custos = past.filter((x) => x.preco > 0 && daysBetween(x.inicio, x.fim) > 0).map((x) => x.preco / daysBetween(x.inicio, x.fim));
  const custoDia = custos.length ? custos.reduce((a, b) => a + b, 0) / custos.length : null;

  if (!r) {
    return `<section class="section"><div class="card">${emptyState('bone', 'Nenhum pacote em uso',
      'Cadastre o pacote de ração e o consumo diário. O Miaumigo avisa quando estiver acabando.',
      `<button class="btn" data-action="add-food" data-pet="${p.id}">Cadastrar pacote</button>`)}</div></section>`;
  }
  const s = foodStatus(r);
  const fimTxt = s.dias === 0 ? 'Acabou ou acaba hoje' : `Dura até ${fmtDate(s.fimData)} · ${s.dias} dia${s.dias === 1 ? '' : 's'}`;
  return `
    <section class="section">
      <div class="section-head"><h2>Pacote atual</h2><button class="btn sm ghost" data-action="edit-food" data-id="${r.id}">${icon('pencil', { size: 16 })}Ajustar</button></div>
      <div class="card food ${s.acabando ? 'low' : ''}">
        <div class="food-top">
          <span class="ibox">${icon('bone')}</span>
          <div class="row-body">
            <div class="row-title">${esc(r.nome || 'Ração')}</div>
            <div class="row-sub">${kg(r.pesoKg)} · ${r.consumoG} g por dia · aberto em ${fmtDate(r.inicio)}</div>
          </div>
        </div>
        <div class="bar food-bar"><i style="width:${Math.max(2, s.pct * 100)}%"></i></div>
        <div class="food-info">
          <strong>Restam ~${kg(Math.round(s.restanteG / 100) / 10)}</strong>
          <span class="${s.acabando ? 'warn-txt' : ''}">${s.acabando ? icon('triangle-alert', { size: 15 }) : icon('hourglass', { size: 15 })}${fimTxt}</span>
        </div>
      </div>
      <button class="btn block" style="margin-top:12px" data-action="add-food" data-pet="${p.id}">${icon('plus', { size: 18 })}Abri um pacote novo</button>
    </section>
    ${past.length ? `
    <section class="section">
      <div class="section-head"><h2>Pacotes anteriores</h2>${custoDia ? `<span class="tag">~${brl(custoDia)}/dia</span>` : ''}</div>
      <div class="card list">
        ${past.map((x) => `
          <div class="row">
            <span class="ibox">${icon('bone')}</span>
            <div class="row-body">
              <div class="row-title">${esc(x.nome || 'Ração')} · ${kg(x.pesoKg)}</div>
              <div class="row-sub">${fmtDate(x.inicio)} a ${fmtDate(x.fim)} · durou ${daysBetween(x.inicio, x.fim)} dias</div>
            </div>
            ${x.preco ? `<span class="row-end">${brl(x.preco)}</span>` : ''}
          </div>`).join('')}
      </div>
    </section>` : ''}`;
}

function petExpenses(p) {
  const list = db.gastos.filter((g) => g.petId === p.id).sort(byDateDesc);
  const total = list.reduce((s, g) => s + Number(g.valor), 0);
  const year = today().slice(0, 4);
  const yearTotal = list.filter((g) => g.data.startsWith(year)).reduce((s, g) => s + Number(g.valor), 0);
  return `
    <section class="section">
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="card stat"><div class="num">${brl(yearTotal)}</div><div class="lbl">em ${year}</div></div>
        <div class="card stat"><div class="num">${brl(total)}</div><div class="lbl">no total</div></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Gastos</h2><button class="btn sm ghost" data-action="add-expense" data-pet="${p.id}">${icon('plus', { size: 16 })}Gasto</button></div>
      <div class="card list">${list.length ? list.map((g) => expenseRow(g, { showPet: false })).join('') : '<p class="hint">Nenhum gasto registrado para este pet.</p>'}</div>
    </section>`;
}

/** "Sobre" do pet: abre pelo lápis no topo do perfil. */
function petAboutSheet(p) {
  const rows = [
    ['Espécie', SPECIES[p.especie]?.label],
    ['Raça', p.raca],
    ['Sexo', p.sexo === 'F' ? 'Fêmea' : p.sexo === 'M' ? 'Macho' : ''],
    ['Nascimento', p.nascimento ? parseISO(p.nascimento).toLocaleDateString('pt-BR') : ''],
    ['Idade', ageText(p.nascimento)],
    ['Castrado', p.castrado ? 'Sim' : 'Não'],
    ['Microchip', p.microchip],
    ['Veterinário', p.veterinario],
  ].filter(([, v]) => v);
  openSheet(`Sobre ${esc(p.nome)}`, `
    <div class="menu">
      <div class="card info"><dl style="margin:0">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>
      ${p.obs ? `<h3 class="menu-title">${icon('clipboard-list', { size: 18 })}Observações</h3><div class="card notes">${esc(p.obs)}</div>` : ''}
      <button class="btn" data-action="edit-pet" data-id="${p.id}">${icon('pencil', { size: 18 })}Editar perfil</button>
      <button class="btn danger" data-action="delete-pet" data-id="${p.id}">${icon('trash-2', { size: 18 })}Remover pet</button>
    </div>`, null);
}

/* ---- Carteirinha de vacinação ---- */
const PREVENTIVE = ['vacina', 'vermifugo', 'antipulgas'];

function cardData(p) {
  const cares = db.cuidados.filter((c) => c.petId === p.id);
  const nextOf = (c) => (c.proximoId ? db.cuidados.find((x) => x.id === c.proximoId) : null);
  return {
    vacinas: cares.filter((c) => c.tipo === 'vacina' && c.feito).sort(byDateDesc),
    parasitas: cares.filter((c) => ['vermifugo', 'antipulgas'].includes(c.tipo) && c.feito).sort(byDateDesc),
    proximas: cares.filter((c) => PREVENTIVE.includes(c.tipo) && !c.feito).sort(byDate),
    nextOf,
  };
}

function viewCarteira(id) {
  const p = getPet(id);
  if (!p) return `<a class="back" href="#/pets">${icon('chevron-left', { size: 18 })}Pets</a><div class="card">${emptyState('search', 'Pet não encontrado', 'Ele pode ter sido removido.')}</div>`;
  const { vacinas, parasitas, proximas, nextOf } = cardData(p);

  const table = (list, withType) => list.length ? `
    <table class="ctable">
      <thead><tr><th>Data</th><th>${withType ? 'Produto' : 'Vacina'}</th><th>Próxima</th></tr></thead>
      <tbody>${list.map((c) => {
        const n = nextOf(c);
        return `<tr>
          <td>${fullDate(c.data)}</td>
          <td><b>${esc(c.titulo || CARE_TYPES[c.tipo].label)}</b>${withType ? `<small>${CARE_TYPES[c.tipo].label}</small>` : ''}${c.obs ? `<small>${esc(c.obs)}</small>` : ''}</td>
          <td>${n ? fullDate(n.data) : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '<p class="hint">Nenhum registro ainda.</p>';

  const info = [
    ['Espécie', SPECIES[p.especie]?.label], ['Raça', p.raca], ['Sexo', p.sexo === 'F' ? 'Fêmea' : p.sexo === 'M' ? 'Macho' : ''],
    ['Nascimento', fullDate(p.nascimento)], ['Castrado', p.castrado ? 'Sim' : 'Não'], ['Microchip', p.microchip], ['Veterinário', p.veterinario],
  ].filter(([, v]) => v);

  return `
    <div class="top no-print" style="margin-bottom:12px">
      <a class="back" href="#/pet/${p.id}">${icon('chevron-left', { size: 18 })}${esc(p.nome)}</a>
      <div class="top-actions">
        <button class="icon-btn" data-action="share-card" data-id="${p.id}" aria-label="Compartilhar" title="Compartilhar">${icon('share-2')}</button>
        <button class="btn" data-action="print">${icon('printer', { size: 18 })}Imprimir / PDF</button>
      </div>
    </div>

    <article class="carteira card">
      <header class="c-head">
        <span>${icon('paw-print', { size: 20 })}Carteira de vacinação</span>
        <small>Miaumigo</small>
      </header>
      <div class="c-pet">
        ${avatar(p, 'lg')}
        <div>
          <h1>${esc(p.nome)}</h1>
          <p>${esc([SPECIES[p.especie]?.label, p.raca, ageText(p.nascimento)].filter(Boolean).join(' · '))}</p>
        </div>
      </div>
      <dl class="c-info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>

      <h2 class="c-title">${icon('syringe', { size: 18 })}Vacinas</h2>
      ${table(vacinas, false)}

      <h2 class="c-title">${icon('bug-off', { size: 18 })}Vermífugos e antipulgas</h2>
      ${table(parasitas, true)}

      <h2 class="c-title">${icon('calendar-days', { size: 18 })}Próximas doses</h2>
      ${proximas.length ? `<ul class="c-next">${proximas.map((c) => `<li><span>${icon(CARE_TYPES[c.tipo].icon, { size: 16 })}${esc(c.titulo || CARE_TYPES[c.tipo].label)}</span><b>${fullDate(c.data)}</b></li>`).join('')}</ul>` : '<p class="hint">Nenhuma dose agendada.</p>'}

      <footer class="c-foot">Emitida em ${fullDate(today())} pelo app Miaumigo, com base nos registros do tutor.</footer>
    </article>`;
}

async function shareCard(p) {
  const { vacinas, parasitas, proximas, nextOf } = cardData(p);
  const line = (c) => `• ${fullDate(c.data)} – ${c.titulo || CARE_TYPES[c.tipo].label}${nextOf(c) ? ` (próxima: ${fullDate(nextOf(c).data)})` : ''}`;
  const text = [
    `Carteira de vacinação – ${p.nome}`,
    [SPECIES[p.especie]?.label, p.raca, p.nascimento ? `nasc. ${fullDate(p.nascimento)}` : ''].filter(Boolean).join(', '),
    '', 'Vacinas:', ...(vacinas.length ? vacinas.map(line) : ['• nenhum registro']),
    '', 'Vermífugos e antipulgas:', ...(parasitas.length ? parasitas.map(line) : ['• nenhum registro']),
    ...(proximas.length ? ['', 'Próximas doses:', ...proximas.map((c) => `• ${fullDate(c.data)} – ${c.titulo || CARE_TYPES[c.tipo].label}`)] : []),
  ].join('\n');
  try {
    if (navigator.share) { await navigator.share({ title: `Carteira de vacinação – ${p.nome}`, text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Carteirinha copiada. É só colar no WhatsApp ou e-mail.');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Não consegui compartilhar');
  }
}

/* ---- Agenda ---- */
function viewAgenda() {
  const header = `
    <header class="top">
      <div><h1>Agenda</h1><p class="sub">Vacinas, remédios e consultas</p></div>
      <div class="top-actions">
        ${db.cuidados.some((c) => !c.feito) ? `<button class="icon-btn" data-action="export-ics" aria-label="Enviar agenda para o calendário" title="Enviar para o calendário">${icon('calendar-plus')}</button>` : ''}
        <button class="btn" data-action="add-care" ${db.pets.length ? '' : 'disabled'}>${icon('plus', { size: 18 })}Cuidado</button>
      </div>
    </header>`;
  if (!db.pets.length) {
    return header + `<div class="card">${emptyState('calendar-days', 'Agenda vazia', 'Cadastre um pet para começar a agendar cuidados.', '<button class="btn" data-action="add-pet">Cadastrar pet</button>')}</div>`;
  }
  if (ui.agendaPet !== 'todos' && !getPet(ui.agendaPet)) ui.agendaPet = 'todos';

  const filters = `
    <div class="filters">
      <button data-action="agenda-filter" data-pet="todos" aria-pressed="${ui.agendaPet === 'todos'}">Todos</button>
      ${db.pets.map((p) => `<button data-action="agenda-filter" data-pet="${p.id}" aria-pressed="${ui.agendaPet === p.id}">${icon(SPECIES[p.especie]?.icon ?? 'paw-print', { size: 16 })}${esc(p.nome)}</button>`).join('')}
    </div>`;

  const t = today();
  const all = db.cuidados.filter((c) => ui.agendaPet === 'todos' || c.petId === ui.agendaPet);
  const pending = all.filter((c) => !c.feito).sort(byDate);
  const groups = [
    ['Atrasados', pending.filter((c) => c.data < t), 'warn'],
    ['Hoje', pending.filter((c) => c.data === t)],
    ['Próximos 30 dias', pending.filter((c) => c.data > t && c.data <= addDays(t, 30))],
    ['Mais adiante', pending.filter((c) => c.data > addDays(t, 30))],
    ['Concluídos recentemente', all.filter((c) => c.feito).sort(byDateDesc).slice(0, 10)],
  ].filter(([, list]) => list.length);

  const showPet = ui.agendaPet === 'todos';
  return header + filters + (groups.length
    ? groups.map(([title, list, tone]) => `
        <section class="section">
          <div class="section-head"><h2 class="${tone ? `h-ico ${tone}` : ''}">${tone ? icon('triangle-alert', { size: 18 }) : ''}${title}</h2></div>
          <div class="card list">${list.map((c) => careRow(c, { showPet })).join('')}</div>
        </section>`).join('')
    : `<div class="card" style="margin-top:16px">${emptyState('party-popper', 'Nada por aqui', 'Adicione vacinas, vermífugos, remédios ou consultas.', '<button class="btn" data-action="add-care">Adicionar cuidado</button>')}</div>`);
}

/* ---- Gastos ---- */
function viewGastos() {
  const ym = ui.month;
  const list = db.gastos.filter((g) => g.data.startsWith(ym)).sort(byDateDesc);
  const total = list.reduce((s, g) => s + Number(g.valor), 0);
  const prevTotal = db.gastos.filter((g) => g.data.startsWith(shiftMonth(ym, -1))).reduce((s, g) => s + Number(g.valor), 0);

  let cmp = '';
  if (prevTotal > 0) {
    const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
    cmp = pct === 0 ? 'Igual ao mês anterior' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% em relação ao mês anterior`;
  }

  const byCat = Object.entries(
    list.reduce((acc, g) => { acc[g.categoria] = (acc[g.categoria] || 0) + Number(g.valor); return acc; }, {})
  ).sort((a, b) => b[1] - a[1]);
  const max = byCat[0]?.[1] || 1;

  return `
    <header class="top">
      <div><h1>Gastos</h1><p class="sub">Quanto custa tanto amor</p></div>
      <button class="btn" data-action="add-expense">${icon('plus', { size: 18 })}Gasto</button>
    </header>

    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Mês anterior">${icon('chevron-left')}</button>
      <strong>${monthLabel(ym)}</strong>
      <button class="icon-btn" data-action="month" data-delta="1" aria-label="Próximo mês">${icon('chevron-right')}</button>
    </div>

    <div class="card total" style="margin-top:14px">
      <div class="lbl">Total do mês</div>
      <div class="num">${brl(total)}</div>
      ${cmp ? `<div class="cmp">${cmp}</div>` : ''}
    </div>

    ${byCat.length ? `
    <section class="section">
      <div class="section-head"><h2>Por categoria</h2></div>
      <div class="card bars">
        ${byCat.map(([k, v]) => `
          <div class="bar-row">
            <div class="bar-top"><span class="meta-ico">${icon(EXPENSE_CATS[k]?.icon ?? 'package', { size: 16 })}${EXPENSE_CATS[k]?.label ?? k}</span><span>${brl(v)}</span></div>
            <div class="bar"><i style="width:${Math.max(4, (v / max) * 100)}%"></i></div>
          </div>`).join('')}
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Lançamentos</h2></div>
      <div class="card list">${list.length ? list.map((g) => expenseRow(g)).join('') : '<p class="hint">Nenhum gasto neste mês.</p>'}</div>
    </section>`;
}

/* ---------------- Sheet (formulários) ---------------- */

const sheet = $('#sheet');
const sheetBody = $('#sheet-body');
let onSheetSubmit = null;
let pendingPhoto = undefined; // undefined = sem alteração, null = remover, string = nova foto

let sheetBack = null; // função para o botão "voltar" de submenus

function openSheet(title, content, onSubmit, { back = null } = {}) {
  onSheetSubmit = onSubmit;
  sheetBack = back;
  sheetBody.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-head">
        ${back ? `<button class="icon-btn ghost sheet-back" data-action="sheet-back" aria-label="Voltar">${icon('chevron-left')}</button>` : ''}
        <h2 id="sheet-title">${title}</h2>
        <button class="icon-btn" data-action="close-sheet" aria-label="Fechar">${icon('x')}</button>
      </div>
      ${content}
    </div>`;
  enhanceSelects(sheetBody);
  enhanceDates(sheetBody);
  if (!sheet.open) sheet.showModal();
  const first = sheetBody.querySelector('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not(.native-hidden), .select-btn, textarea');
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
}

/* ---- Seletor customizado ----
   O <select> nativo continua no formulário (valor e evento change),
   mas fica escondido; o botão + lista abaixo seguem o visual do app. */

let openSel = null; // { sel, btn, list, active }

function enhanceSelects(root) {
  root.querySelectorAll('select:not([data-enhanced])').forEach((sel) => {
    sel.dataset.enhanced = '1';
    sel.classList.add('native-hidden');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    sel.after(btn);

    const label = sel.closest('label')?.querySelector(':scope > span')?.textContent?.replace('*', '').trim() || '';
    const sync = () => {
      const o = sel.selectedOptions[0];
      btn.innerHTML = `${o?.dataset.icon ? icon(o.dataset.icon, { size: 18, cls: 'opt-ico' }) : ''}<span class="select-val">${esc(o?.textContent ?? '')}</span>${icon('chevron-down', { size: 18, cls: 'select-chev' })}`;
      btn.setAttribute('aria-label', `${label}${label ? ': ' : ''}${o?.textContent ?? ''}`);
    };
    sync();
    sel.addEventListener('change', sync);
    btn.addEventListener('click', () => (openSel?.btn === btn ? closeSelect() : openSelect(sel, btn)));
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openSelect(sel, btn); }
    });
  });
}

function openSelect(sel, btn) {
  closeSelect();
  const list = document.createElement('div');
  list.className = 'select-pop';
  list.setAttribute('popover', 'manual');
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  const uidPrefix = `opt-${uid()}`;
  list.innerHTML = [...sel.options].map((o, i) => `
    <div class="select-opt" role="option" id="${uidPrefix}-${i}" data-i="${i}" aria-selected="${o.selected}">
      ${o.dataset.icon ? icon(o.dataset.icon, { size: 18, cls: 'opt-ico' }) : ''}
      <span>${esc(o.textContent)}</span>
      ${o.selected ? icon('check', { size: 16, cls: 'opt-check' }) : ''}
    </div>`).join('');
  // dentro do <dialog> para não ficar inerte; o popover vai para a camada superior
  (btn.closest('dialog') || document.body).appendChild(list);
  list.showPopover?.();

  placePopover(btn, list, { maxH: 300 });

  btn.setAttribute('aria-expanded', 'true');
  openSel = { sel, btn, list, active: Math.max(0, sel.selectedIndex) };
  setActive(openSel.active);
  list.focus({ preventScroll: true });

  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.select-opt');
    if (opt) chooseOption(Number(opt.dataset.i));
  });
  list.addEventListener('pointermove', (e) => {
    const opt = e.target.closest('.select-opt');
    if (opt) setActive(Number(opt.dataset.i), false);
  });
  list.addEventListener('keydown', onSelectKey);
}

/** Posiciona o popover embaixo do botão, ou em cima se não couber. */
function placePopover(btn, list, { maxH = 300, minW = 0 } = {}) {
  const r = btn.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, minW), window.innerWidth - 16);
  const h = Math.min(list.scrollHeight, maxH);
  const below = window.innerHeight - r.bottom - 12;
  const up = below < h && r.top > below;
  Object.assign(list.style, {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`,
    width: `${w}px`,
    top: up ? `${Math.max(8, r.top - h - 6)}px` : `${r.bottom + 6}px`,
    maxHeight: `${Math.max(160, up ? r.top - 14 : below)}px`,
  });
  list.classList.toggle('up', up);
}

/* ---- Seletor de data ----
   Mesmo princípio: o <input type="date"> fica escondido no formulário. */

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function enhanceDates(root) {
  root.querySelectorAll('input[type=date]:not([data-enhanced])').forEach((inp) => {
    inp.dataset.enhanced = '1';
    inp.classList.add('native-hidden');
    inp.tabIndex = -1;
    inp.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'select-btn date-btn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    inp.after(btn);

    const label = inp.closest('label')?.querySelector(':scope > span')?.textContent?.replace('*', '').trim() || 'Data';
    const sync = () => {
      const v = inp.value;
      const rel = v === today() ? 'hoje' : v === addDays(today(), -1) ? 'ontem' : v === addDays(today(), 1) ? 'amanhã' : '';
      btn.innerHTML = `<span class="select-val ${v ? '' : 'placeholder'}">${v ? fullDate(v) : 'Escolher data'}${rel ? ` <small>${rel}</small>` : ''}</span>${icon('calendar-days', { size: 18, cls: 'select-chev' })}`;
      btn.setAttribute('aria-label', `${label}: ${v ? fullDate(v) : 'sem data'}`);
    };
    sync();
    inp.addEventListener('change', sync);
    btn.addEventListener('click', () => (openSel?.btn === btn ? closeSelect() : openDatePicker(inp, btn)));
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openDatePicker(inp, btn); }
    });
  });
}

function openDatePicker(inp, btn) {
  closeSelect();
  const list = document.createElement('div');
  list.className = 'select-pop datepick';
  list.setAttribute('popover', 'manual');
  list.setAttribute('role', 'dialog');
  list.setAttribute('aria-label', 'Escolher data');
  list.tabIndex = -1;
  (btn.closest('dialog') || document.body).appendChild(list);
  list.showPopover?.();

  const focus = inp.value || clampDate(today(), inp);
  openSel = { kind: 'date', inp, btn, list, focus, view: focus.slice(0, 7) };
  drawDatePicker();
  placePopover(btn, list, { maxH: 420, minW: 296 });
  btn.setAttribute('aria-expanded', 'true');
  list.focus({ preventScroll: true });

  list.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.nav) { openSel.view = shiftMonth(openSel.view, Number(t.dataset.nav)); drawDatePicker(); }
    else if (t.dataset.date) chooseDate(t.dataset.date);
    else if (t.dataset.today !== undefined) chooseDate(today());
    else if (t.dataset.clear !== undefined) chooseDate('');
  });
  list.addEventListener('keydown', onDateKey);
}

const dateDisabled = (iso, inp) => (inp.min && iso < inp.min) || (inp.max && iso > inp.max);
const clampDate = (iso, inp) => (inp.max && iso > inp.max ? inp.max : inp.min && iso < inp.min ? inp.min : iso);

function drawDatePicker() {
  const { inp, list, view, focus } = openSel;
  const [y, m] = view.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const t = today();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISO(d);
    const cls = [
      d.getMonth() !== m - 1 ? 'out' : '',
      iso === inp.value ? 'sel' : '',
      iso === t ? 'today' : '',
      iso === focus ? 'focus' : '',
    ].filter(Boolean).join(' ');
    const longLabel = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `<button type="button" class="day ${cls}" data-date="${iso}" tabindex="-1" aria-label="${longLabel}" aria-pressed="${iso === inp.value}" ${dateDisabled(iso, inp) ? 'disabled' : ''}>${d.getDate()}</button>`;
  }).join('');

  const prevDisabled = inp.min && `${shiftMonth(view, -1)}-31` < inp.min;
  const nextDisabled = inp.max && `${shiftMonth(view, 1)}-01` > inp.max;
  list.innerHTML = `
    <div class="dp-head">
      <button type="button" class="icon-btn ghost" data-nav="-1" aria-label="Mês anterior" ${prevDisabled ? 'disabled' : ''}>${icon('chevron-left', { size: 18 })}</button>
      <strong aria-live="polite">${monthLabel(view)}</strong>
      <button type="button" class="icon-btn ghost" data-nav="1" aria-label="Próximo mês" ${nextDisabled ? 'disabled' : ''}>${icon('chevron-right', { size: 18 })}</button>
    </div>
    <div class="dp-grid dp-week">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="dp-grid">${cells}</div>
    <div class="dp-foot">
      ${inp.required ? '<span></span>' : '<button type="button" class="link-btn" data-clear>Limpar</button>'}
      <button type="button" class="link-btn" data-today ${dateDisabled(t, inp) ? 'disabled' : ''}>Hoje</button>
    </div>`;
}

function chooseDate(iso) {
  const { inp, btn } = openSel;
  if (inp.value !== iso) {
    inp.value = iso;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeSelect();
  btn.focus();
}

function onDateKey(e) {
  const s = openSel;
  const move = (iso) => {
    s.focus = clampDate(iso, s.inp);
    s.view = s.focus.slice(0, 7);
    drawDatePicker();
  };
  const dow = parseISO(s.focus).getDay();
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); move(addDays(s.focus, -1)); break;
    case 'ArrowRight': e.preventDefault(); move(addDays(s.focus, 1)); break;
    case 'ArrowUp': e.preventDefault(); move(addDays(s.focus, -7)); break;
    case 'ArrowDown': e.preventDefault(); move(addDays(s.focus, 7)); break;
    case 'Home': e.preventDefault(); move(addDays(s.focus, -dow)); break;
    case 'End': e.preventDefault(); move(addDays(s.focus, 6 - dow)); break;
    case 'PageUp': case 'PageDown': {
      e.preventDefault();
      const ym = shiftMonth(s.focus.slice(0, 7), e.key === 'PageUp' ? -1 : 1);
      const [yy, mm] = ym.split('-').map(Number);
      const day = Math.min(Number(s.focus.slice(8)), new Date(yy, mm, 0).getDate());
      move(`${ym}-${pad(day)}`);
      break;
    }
    case 'Enter': case ' ': e.preventDefault(); if (!dateDisabled(s.focus, s.inp)) chooseDate(s.focus); break;
    case 'Escape': e.preventDefault(); e.stopPropagation(); { const b = s.btn; closeSelect(); b.focus(); } break;
    case 'Tab': closeSelect(); break;
  }
}

function setActive(i, scroll = true) {
  if (!openSel) return;
  const opts = openSel.list.querySelectorAll('.select-opt');
  i = Math.max(0, Math.min(opts.length - 1, i));
  opts.forEach((o, k) => o.classList.toggle('active', k === i));
  openSel.active = i;
  openSel.list.setAttribute('aria-activedescendant', opts[i].id);
  if (scroll) opts[i].scrollIntoView({ block: 'nearest' });
}

function chooseOption(i) {
  const { sel, btn } = openSel;
  if (sel.selectedIndex !== i) {
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeSelect();
  btn.focus();
}

function onSelectKey(e) {
  const n = openSel.sel.options.length;
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); setActive(openSel.active + 1); break;
    case 'ArrowUp': e.preventDefault(); setActive(openSel.active - 1); break;
    case 'Home': e.preventDefault(); setActive(0); break;
    case 'End': e.preventDefault(); setActive(n - 1); break;
    case 'Enter': case ' ': e.preventDefault(); chooseOption(openSel.active); break;
    case 'Escape': e.preventDefault(); e.stopPropagation(); { const b = openSel.btn; closeSelect(); b.focus(); } break;
    case 'Tab': closeSelect(); break;
    default:
      if (e.key.length === 1) { // digitar a inicial pula para a opção
        const k = e.key.toLowerCase();
        const opts = [...openSel.sel.options];
        const start = openSel.active + 1;
        const idx = [...opts.slice(start), ...opts.slice(0, start)].findIndex((o) => o.textContent.trim().toLowerCase().startsWith(k));
        if (idx >= 0) setActive((start + idx) % n);
      }
  }
}

function closeSelect() {
  if (!openSel) return;
  openSel.btn.setAttribute('aria-expanded', 'false');
  try { openSel.list.hidePopover?.(); } catch { /* ignore */ }
  openSel.list.remove();
  openSel = null;
}

document.addEventListener('pointerdown', (e) => {
  if (openSel && !openSel.list.contains(e.target) && !openSel.btn.contains(e.target)) closeSelect();
});
window.addEventListener('resize', closeSelect);
sheet.addEventListener('scroll', (e) => { if (openSel && e.target !== openSel.list) closeSelect(); }, true);
sheet.addEventListener('cancel', (e) => { if (openSel) { e.preventDefault(); closeSelect(); } });

function closeSheet() {
  closeSelect();
  if (sheet.open) sheet.close();
  onSheetClosed();
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
function onSheetClosed() {
  onSheetSubmit = null;
  pendingPhoto = undefined;
  // cuidado novo cancelado: descarta os anexos que já tinham sido guardados
  if (attachCtx?.draft && !db.cuidados.some((c) => c.id === attachCtx.careId) && !db.notas.some((n) => n.id === attachCtx.careId)) deleteAttachmentsOf([attachCtx.careId]);
  attachCtx = null;
  attachUrls.forEach(URL.revokeObjectURL);
  attachUrls = [];
}
sheet.addEventListener('close', onSheetClosed);
sheet.addEventListener('change', (e) => {
  if (e.target.matches('[data-attach]') && e.target.files.length) {
    addAttachments([...e.target.files]);
    e.target.value = '';
  }
});

const viewer = $('#viewer');
viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });
viewer.addEventListener('close', () => { if (viewer.dataset.url) URL.revokeObjectURL(viewer.dataset.url); viewer.innerHTML = ''; });
sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!onSheetSubmit) return;
  const data = Object.fromEntries(new FormData(e.target).entries());
  const ok = onSheetSubmit(data, e.target);
  if (ok !== false) { closeSheet(); save(); render(); checkReminders(); }
});

const options = (obj, selected) => Object.entries(obj).map(([k, v]) => `<option value="${k}" data-icon="${v.icon}" ${k === selected ? 'selected' : ''}>${v.label}</option>`).join('');
const pairOptions = (pairs, selected) => pairs.map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
const petOptions = (selected, allowNone = false) =>
  (allowNone ? `<option value="" data-icon="house">Geral (sem pet)</option>` : '') +
  db.pets.map((p) => `<option value="${p.id}" data-icon="${SPECIES[p.especie]?.icon ?? 'paw-print'}" ${p.id === selected ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');

/* ---- Pet ---- */
function petForm(pet) {
  const p = pet || { especie: 'gato' };
  pendingPhoto = undefined;
  openSheet(pet ? 'Editar pet' : 'Novo pet', `
    <form class="form" autocomplete="off">
      <div class="photo-pick">
        <div id="photo-preview">${avatar({ ...p, id: p.id || 'novo' }, 'lg')}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="btn sm ghost">${icon('camera', { size: 16 })}Escolher foto<input type="file" accept="image/*" data-photo hidden></label>
          ${p.foto ? `<button type="button" class="btn sm plain" data-action="remove-photo">${icon('trash-2', { size: 16 })}Remover foto</button>` : ''}
        </div>
      </div>
      <label class="field"><span>Nome *</span><input name="nome" required maxlength="40" value="${esc(p.nome)}" placeholder="Ex.: Mingau"></label>
      <div class="two">
        <label class="field"><span>Espécie</span><select name="especie">${options(SPECIES, p.especie)}</select></label>
        <label class="field"><span>Sexo</span>
          <select name="sexo">
            <option value="">—</option>
            <option value="F" data-icon="venus" ${p.sexo === 'F' ? 'selected' : ''}>Fêmea</option>
            <option value="M" data-icon="mars" ${p.sexo === 'M' ? 'selected' : ''}>Macho</option>
          </select>
        </label>
      </div>
      <div class="two">
        <label class="field"><span>Raça</span><input name="raca" maxlength="40" value="${esc(p.raca)}" placeholder="Ex.: SRD"></label>
        <label class="field"><span>Nascimento</span><input type="date" name="nascimento" max="${today()}" value="${esc(p.nascimento)}"></label>
      </div>
      <label class="check-field"><input type="checkbox" name="castrado" ${p.castrado ? 'checked' : ''}> Castrado(a)</label>
      ${!pet && typeof campoCompartilharNovoPet === 'function' ? campoCompartilharNovoPet() : ''}
      ${!pet ? `<label class="field"><span>Peso atual (kg)</span><input type="number" name="peso" step="0.01" min="0" inputmode="decimal" placeholder="Opcional"></label>` : ''}
      <div class="two">
        <label class="field"><span>Microchip</span><input name="microchip" maxlength="30" value="${esc(p.microchip)}"></label>
        <label class="field"><span>Veterinário</span><input name="veterinario" maxlength="60" value="${esc(p.veterinario)}"></label>
      </div>
      <label class="field"><span>Observações</span><textarea name="obs" maxlength="1000" placeholder="Alergias, manias, comida favorita...">${esc(p.obs)}</textarea></label>
      ${autorLinha(pet)}
      <div class="actions">
        <button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>`, (d) => {
    const fields = {
      nome: d.nome.trim(), especie: d.especie, sexo: d.sexo, raca: d.raca.trim(),
      nascimento: d.nascimento, castrado: !!d.castrado, microchip: d.microchip.trim(),
      veterinario: d.veterinario.trim(), obs: d.obs.trim(),
    };
    if (!fields.nome) return false;
    if (pendingPhoto !== undefined) fields.foto = pendingPhoto || '';
    if (pet) {
      Object.assign(pet, fields);
      toast('Perfil atualizado');
    } else {
      const novo = { id: uid(), criadoEm: today(), ...fields };
      if (typeof definirEspacoNovoPet === 'function') definirEspacoNovoPet(novo.id, !!d.compartilhar);
      if (typeof contarPetCriado === 'function') contarPetCriado();
      db.pets.push(novo);
      const peso = parseFloat(String(d.peso).replace(',', '.'));
      if (peso > 0) db.pesos.push({ id: uid(), petId: novo.id, data: today(), kg: peso });
      toast(`${novo.nome} chegou!`);
      ui.petTab = 'saude';
      location.hash = `#/pet/${novo.id}`;
    }
  });
}

async function resizeImage(file, size = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

sheet.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-photo]') || !e.target.files[0]) return;
  try {
    pendingPhoto = await resizeImage(e.target.files[0]);
    $('#photo-preview').innerHTML = `<div class="avatar lg"><img src="${pendingPhoto}" alt=""></div>`;
  } catch {
    toast('Não consegui abrir essa imagem');
  }
});

/* ---- Cuidado ---- */
function careForm(care, petId) {
  if (!db.pets.length) { toast('Cadastre um pet primeiro'); return; }
  const c = care || { tipo: 'vacina', data: today(), petId: petId || (ui.agendaPet !== 'todos' ? ui.agendaPet : db.pets[0].id), repetir: 0, lembrete: 0 };
  const careId = care?.id || uid();
  attachCtx = { careId, draft: !care };
  openSheet(care ? 'Editar cuidado' : 'Novo cuidado', `
    <form class="form" autocomplete="off">
      <div class="two">
        <label class="field"><span>Pet</span><select name="petId">${petOptions(c.petId)}</select></label>
        <label class="field"><span>Tipo</span><select name="tipo">${options(CARE_TYPES, c.tipo)}</select></label>
      </div>
      <label class="field"><span>Descrição</span><input name="titulo" maxlength="60" value="${esc(c.titulo)}" placeholder="Ex.: V4, Antirrábica, Bravecto"></label>
      <div class="two">
        <label class="field"><span>Data</span><input type="date" name="data" required value="${esc(c.data)}"></label>
        <label class="field"><span>Repetir</span><select name="repetir">${pairOptions(REPEAT_OPTIONS, c.repetir || 0)}</select></label>
      </div>
      <label class="field"><span>Lembrete</span>
        <select name="lembrete">${pairOptions(REMINDER_OPTIONS, reminderOf(c))}</select>
        ${db.config.lembretes ? `<small>Aviso às ${esc(db.config.horario)} neste aparelho.</small>` : '<small>Ative as notificações em Configurações para receber o aviso.</small>'}
      </label>
      <label class="field"><span>Anotações</span><textarea name="obs" maxlength="500" placeholder="Dose, clínica, lote da vacina...">${esc(c.obs)}</textarea></label>
      <div class="field">
        <span>Anexos</span>
        <div class="attach-grid" id="attach-grid"></div>
        ${anexarBtn('Adicionar foto ou PDF', 'image/*,application/pdf', 'paperclip')}
        <small>Receitas, exames, comprovante da vacina…</small>
      </div>
      ${care ? `<label class="check-field"><input type="checkbox" name="feito" ${c.feito ? 'checked' : ''}> Já foi feito</label>` : ''}
      ${care && !care.feito ? `<button type="button" class="btn plain" data-action="care-ics" data-id="${care.id}">${icon('calendar-plus', { size: 18 })}Adicionar ao calendário do celular</button>` : ''}
      ${autorLinha(care)}
      <div class="actions">
        ${care ? `<button type="button" class="btn danger" data-action="delete-care" data-id="${care.id}">Apagar</button>` : `<button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>`}
        <button class="btn" type="submit">Salvar</button>
      </div>
      ${!care ? '<small class="form-hint">Dica: com “Repetir”, o próximo é agendado sozinho quando você marcar este como feito.</small>' : ''}
    </form>`, (d) => {
    const fields = { petId: d.petId, tipo: d.tipo, titulo: d.titulo.trim(), data: d.data, repetir: Number(d.repetir), lembrete: Number(d.lembrete), obs: d.obs.trim() };
    if (care) {
      const wasDone = care.feito;
      Object.assign(care, fields, { feito: !!d.feito });
      if (!wasDone && care.feito) scheduleNext(care);
      toast('Cuidado atualizado');
    } else {
      db.cuidados.push({ id: careId, feito: false, anexos: attachCount, ...fields });
      attachCtx = null; // salvo: os anexos ficam
      toast('Cuidado agendado');
    }
  });
  renderAttachments(careId);
}

/* ---- Anexos no formulário ---- */
let attachCtx = null;   // { careId, draft }
let attachCount = 0;
let attachUrls = [];

async function renderAttachments(careId) {
  const grid = $('#attach-grid');
  if (!grid) return;
  attachUrls.forEach(URL.revokeObjectURL);
  attachUrls = [];
  let list = [];
  try { list = (await IDB.byCare(careId)).sort((a, b) => a.criadoEm - b.criadoEm); } catch { /* sem IndexedDB */ }
  attachCount = list.length;
  grid.innerHTML = list.map((a) => {
    const isImg = a.tipo.startsWith('image/');
    const url = URL.createObjectURL(a.blob);
    attachUrls.push(url);
    return `
      <div class="attach">
        <button type="button" class="attach-open" data-action="view-attach" data-id="${a.id}" aria-label="Abrir ${esc(a.nome)}">
          ${isImg ? `<img src="${url}" alt="">` : `<span class="attach-file">${icon('file-text', { size: 26 })}<small>${esc(a.nome)}</small></span>`}
        </button>
        <button type="button" class="attach-del" data-action="delete-attach" data-id="${a.id}" aria-label="Remover anexo">${icon('x', { size: 14 })}</button>
      </div>`;
  }).join('');
}

async function syncAttachCount(careId) {
  const c = db.cuidados.find((x) => x.id === careId) || db.notas.find((x) => x.id === careId);
  if (!c) return;
  c.anexos = (await IDB.byCare(careId)).length;
  save();
  render();
}

async function resizeToBlob(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addAttachments(files) {
  if (!attachCtx) return;
  const { careId } = attachCtx;
  const care = db.cuidados.find((x) => x.id === careId) || db.notas.find((x) => x.id === careId);
  let added = 0;
  for (const file of files) {
    try {
      let blob = file, tipo = file.type, nome = file.name;
      if (tipo.startsWith('image/')) {
        blob = await resizeToBlob(file);
        tipo = 'image/jpeg';
        nome = nome.replace(/\.\w+$/, '') + '.jpg';
      } else if (tipo !== 'application/pdf') {
        toast(`${file.name}: use foto ou PDF`); continue;
      }
      if (blob.size > 10 * 1024 * 1024) { toast(`${file.name} passa de 10 MB`); continue; }
      await IDB.put({ id: uid(), careId, petId: care?.petId ?? null, nome, tipo, blob, criadoEm: Date.now() });
      added++;
    } catch {
      toast(`Não consegui anexar ${file.name}`);
    }
  }
  await renderAttachments(careId);
  if (care) syncAttachCount(careId);
  if (added) toast(added === 1 ? 'Anexo adicionado' : `${added} anexos adicionados`);
}

async function viewAttachment(id) {
  const a = await IDB.get(id);
  if (!a) return;
  const url = URL.createObjectURL(a.blob);
  if (!a.tipo.startsWith('image/')) {
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const viewer = $('#viewer');
  viewer.innerHTML = `
    <div class="viewer-bar">
      <span>${esc(a.nome)}</span>
      <a class="icon-btn" href="${url}" download="${esc(a.nome)}" aria-label="Baixar">${icon('download')}</a>
      <button class="icon-btn" data-action="close-viewer" aria-label="Fechar">${icon('x')}</button>
    </div>
    <img src="${url}" alt="${esc(a.nome)}">`;
  viewer.dataset.url = url;
  viewer.showModal();
}

function scheduleNext(c) {
  if (!c.repetir || c.proximoId) return null;
  const next = {
    id: uid(), serieId: c.serieId || c.id, petId: c.petId, tipo: c.tipo, titulo: c.titulo,
    data: addDays(c.data, c.repetir), repetir: c.repetir, lembrete: reminderOf(c), obs: '', feito: false,
  };
  db.cuidados.push(next);
  c.proximoId = next.id;
  return next;
}

function toggleCare(id) {
  const c = db.cuidados.find((x) => x.id === id);
  if (!c) return;
  c.feito = !c.feito;
  if (c.feito) {
    const next = scheduleNext(c);
    toast(next ? `Feito! Próximo em ${fmtDate(next.data)}` : 'Feito!');
  }
  save(); render();
}

/* ---- Peso ---- */
function weightForm(petId) {
  const last = latestWeight(petId);
  openSheet('Nova pesagem', `
    <form class="form">
      <div class="two">
        <label class="field"><span>Peso (kg) *</span><input type="number" name="kg" step="0.01" min="0.01" required inputmode="decimal" placeholder="${last ? String(last.kg).replace('.', ',') : '4,5'}"></label>
        <label class="field"><span>Data</span><input type="date" name="data" required max="${today()}" value="${today()}"></label>
      </div>
      <div class="actions">
        <button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>`, (d) => {
    const v = parseFloat(String(d.kg).replace(',', '.'));
    if (!(v > 0)) return false;
    db.pesos.push({ id: uid(), petId, data: d.data, kg: v });
    toast('Pesagem registrada');
  });
}

/* ---- Gasto ---- */
function expenseForm(g, petId) {
  const e = g || { categoria: 'racao', data: today(), petId: petId ?? (db.pets.length === 1 ? db.pets[0].id : '') };
  openSheet(g ? 'Editar gasto' : 'Novo gasto', `
    <form class="form" autocomplete="off">
      <div class="two">
        <label class="field"><span>Valor (R$) *</span><input type="number" name="valor" step="0.01" min="0.01" required inputmode="decimal" value="${g ? g.valor : ''}" placeholder="0,00"></label>
        <label class="field"><span>Data</span><input type="date" name="data" required value="${esc(e.data)}"></label>
      </div>
      <label class="field"><span>Descrição</span><input name="descricao" maxlength="60" value="${esc(e.descricao)}" placeholder="Ex.: Ração 10 kg"></label>
      <div class="two">
        <label class="field"><span>Categoria</span><select name="categoria">${options(EXPENSE_CATS, e.categoria)}</select></label>
        <label class="field"><span>Pet</span><select name="petId">${petOptions(e.petId, true)}</select></label>
      </div>
      ${autorLinha(g)}
      <div class="actions">
        ${g ? `<button type="button" class="btn danger" data-action="delete-expense" data-id="${g.id}">Apagar</button>` : `<button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>`}
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>`, (d) => {
    const valor = parseFloat(String(d.valor).replace(',', '.'));
    if (!(valor > 0)) return false;
    const fields = { valor: Math.round(valor * 100) / 100, data: d.data, descricao: d.descricao.trim(), categoria: d.categoria, petId: d.petId || null };
    if (g) { Object.assign(g, fields); toast('Gasto atualizado'); }
    else {
      db.gastos.push({ id: uid(), ...fields });
      ui.month = fields.data.slice(0, 7);
      toast('Gasto registrado');
    }
  });
}

/* ---- Pacote de ração ---- */
function foodForm(r, petId) {
  const prev = activeFood(petId || r?.petId);
  const f = r || { petId, inicio: today(), aviso: 5, nome: prev?.nome, pesoKg: prev?.pesoKg, consumoG: prev?.consumoG, preco: prev?.preco };
  openSheet(r ? 'Ajustar pacote' : 'Pacote de ração', `
    <form class="form" autocomplete="off">
      <label class="field"><span>Ração</span><input name="nome" maxlength="50" value="${esc(f.nome)}" placeholder="Ex.: Golden Gatos Castrados"></label>
      <div class="two">
        <label class="field"><span>Peso do pacote (kg) *</span><input type="number" name="pesoKg" step="0.1" min="0.1" required inputmode="decimal" value="${f.pesoKg ?? ''}" placeholder="10"></label>
        <label class="field"><span>Consumo por dia (g) *</span><input type="number" name="consumoG" step="1" min="1" required inputmode="numeric" value="${f.consumoG ?? ''}" placeholder="60"></label>
      </div>
      <small class="form-hint" style="text-align:left;margin-top:-6px">A quantidade diária vem na tabela da embalagem, pelo peso do pet.</small>
      <div class="two">
        <label class="field"><span>Aberto em</span><input type="date" name="inicio" required max="${today()}" value="${esc(f.inicio)}"></label>
        <label class="field"><span>Avisar quando faltar</span>
          <select name="aviso">${pairOptions([[3, '3 dias'], [5, '5 dias'], [7, '1 semana'], [10, '10 dias']], f.aviso ?? 5)}</select>
        </label>
      </div>
      <label class="field"><span>Preço (R$)</span><input type="number" name="preco" step="0.01" min="0" inputmode="decimal" value="${f.preco ?? ''}" placeholder="Opcional"></label>
      ${!r ? '<label class="check-field"><input type="checkbox" name="lancar" checked> Lançar o preço nos gastos</label>' : ''}
      ${autorLinha(r)}
      <div class="actions">
        ${r ? `<button type="button" class="btn danger" data-action="delete-food" data-id="${r.id}">Apagar</button>` : '<button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>'}
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>`, (d) => {
    const num = (v) => parseFloat(String(v).replace(',', '.'));
    const fields = {
      nome: d.nome.trim(), pesoKg: num(d.pesoKg), consumoG: Math.round(num(d.consumoG)),
      inicio: d.inicio, aviso: Number(d.aviso), preco: num(d.preco) > 0 ? Math.round(num(d.preco) * 100) / 100 : null,
    };
    if (!(fields.pesoKg > 0) || !(fields.consumoG > 0)) return false;
    if (r) {
      Object.assign(r, fields);
      delete db.config.avisados[`racao:${r.id}`];
      toast('Pacote atualizado');
    } else {
      if (prev) prev.fim = fields.inicio < prev.inicio ? prev.inicio : fields.inicio;
      db.racoes.push({ id: uid(), petId: f.petId, ...fields });
      if (d.lancar && fields.preco) {
        db.gastos.push({ id: uid(), petId: f.petId, categoria: 'racao', descricao: `${fields.nome || 'Ração'} ${kg(fields.pesoKg)}`, valor: fields.preco, data: fields.inicio });
      }
      toast(d.lancar && fields.preco ? 'Pacote salvo e lançado nos gastos' : 'Pacote salvo');
    }
  });
}

/* ---------------- Lembretes ---------------- */

const notifSupported = () => 'Notification' in window && window.isSecureContext;

function reminderAt(c) {
  const [hh, mm] = db.config.horario.split(':').map(Number);
  const d = parseISO(addDays(c.data, -reminderOf(c)));
  d.setHours(hh, mm, 0, 0);
  return d;
}

function whenText(c) {
  const n = daysBetween(today(), c.data);
  if (n < 0) return `Atrasado há ${-n} dia${n === -1 ? '' : 's'}`;
  if (n === 0) return 'É hoje';
  if (n === 1) return 'É amanhã';
  return `Em ${n} dias (${fmtDate(c.data)})`;
}

async function showNotification(title, body, tag) {
  const opts = { body, tag, icon: 'icon.svg', badge: 'icon.svg', data: { url: './#/agenda' } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) return await reg.showNotification(title, opts);
    new Notification(title, opts);
  } catch (e) {
    toast(`${title}: ${body}`);
  }
}

/** Dispara as notificações vencidas que ainda não foram mostradas. */
function checkReminders() {
  if (!db.config.lembretes || !notifSupported() || Notification.permission !== 'granted') return;
  const now = new Date();

  // ração acabando (um aviso por pacote, a partir do horário escolhido)
  const [hh, mm] = db.config.horario.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm) {
    db.pets.forEach((p) => {
      const r = activeFood(p.id);
      if (!r || db.config.avisados[`racao:${r.id}`]) return;
      const s = foodStatus(r);
      if (!s.acabando) return;
      showNotification(`A ração de ${p.nome} está acabando`, s.dias ? `Dura mais ~${s.dias} dia${s.dias === 1 ? '' : 's'} (até ${fmtDate(s.fimData)}).` : 'O pacote já deve ter acabado.', `racao-${r.id}`);
      db.config.avisados[`racao:${r.id}`] = Date.now();
      save();
    });
  }

  // com os lembretes do servidor (push) ligados, os de cuidados chegam por lá; aqui só a ração
  const due = db.config.push ? [] : db.cuidados
    .filter((c) => !c.feito && reminderOf(c) >= 0 && getPet(c.petId))
    .filter((c) => reminderAt(c) <= now && !db.config.avisados[`${c.id}@${c.data}`])
    .sort(byDate);
  if (!due.length) return;

  if (due.length === 1) {
    const c = due[0];
    const t = CARE_TYPES[c.tipo] ?? CARE_TYPES.outro;
    showNotification(`${petName(c.petId)}: ${c.titulo || t.label}`, `${t.label} · ${whenText(c)}`, c.id);
  } else {
    const lines = due.slice(0, 4).map((c) => `• ${petName(c.petId)}: ${c.titulo || CARE_TYPES[c.tipo]?.label} (${relDate(c.data)})`);
    if (due.length > 4) lines.push(`e mais ${due.length - 4}`);
    showNotification(`Miaumigo: ${due.length} cuidados pendentes`, lines.join('\n'), 'resumo');
  }

  due.forEach((c) => { db.config.avisados[`${c.id}@${c.data}`] = Date.now(); });
  // limpa marcas de cuidados que não existem mais
  const ids = new Set([...db.cuidados.map((c) => c.id), ...db.racoes.map((r) => `racao:${r.id}`)]);
  for (const k of Object.keys(db.config.avisados)) if (!ids.has(k.split('@')[0])) delete db.config.avisados[k];
  save();
}

async function enableReminders() {
  if (!notifSupported()) {
    toast('Este navegador não suporta notificações. Use “Enviar para o calendário”.');
    return false;
  }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notificações bloqueadas. Libere nas permissões do site.');
    return false;
  }
  db.config.lembretes = true;
  save();
  toast(`Lembretes ativados às ${db.config.horario}`);
  checkReminders();
  return true;
}

/* ---- Exportar para calendário (.ics) ---- */

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}

function buildICS(cares) {
  const [hh, mm] = db.config.horario.split(':');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Miaumigo//Agenda Pet//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Miaumigo'];
  for (const c of cares) {
    const t = CARE_TYPES[c.tipo] ?? CARE_TYPES.outro;
    const start = `${c.data.replace(/-/g, '')}T${hh}${mm}00`;
    const endDate = new Date(parseISO(c.data).setHours(Number(hh), Number(mm) + 30));
    const end = `${toISO(endDate).replace(/-/g, '')}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
    const summary = `${t.label}${c.titulo ? `: ${c.titulo}` : ''} (${petName(c.petId)})`;
    lines.push('BEGIN:VEVENT', `UID:${c.serieId || c.id}@miaumigo`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${icsText(summary)}`);
    if (c.obs) lines.push(`DESCRIPTION:${icsText(c.obs)}`);
    if (c.repetir) {
      const rule = { 1: 'FREQ=DAILY', 7: 'FREQ=WEEKLY', 365: 'FREQ=YEARLY' }[c.repetir] || `FREQ=DAILY;INTERVAL=${c.repetir}`;
      lines.push(`RRULE:${rule}`);
    }
    const lem = reminderOf(c);
    if (lem >= 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, `TRIGGER:${lem ? `-P${lem}D` : '-PT0M'}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function downloadFile(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportICS(cares, name) {
  if (!cares.length) { toast('Nenhum cuidado pendente para exportar'); return; }
  downloadFile(name, buildICS(cares), 'text/calendar;charset=utf-8');
  toast('Abra o arquivo para adicionar ao seu calendário');
}

/* ---- Menu de perfil ("Minha conta") e Configurações ---- */
const APP_VERSION = '2.0.0';
const SUPORTE_EMAIL = 'tavoschlickmann@gmail.com';

const contaAtual = () => (typeof session !== 'undefined' && session?.user) || null;
function nomeConta() {
  const u = contaAtual();
  return u?.user_metadata?.name || u?.user_metadata?.full_name || (u?.email ? u.email.split('@')[0] : 'Você');
}
const iniciais = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

/** Foto da conta (Google) ou as iniciais. */
function avatarConta(size = '') {
  const u = contaAtual();
  const foto = u?.user_metadata?.avatar_url || u?.user_metadata?.picture;
  return `<span class="me-avatar ${size}"><span class="me-ini">${esc(iniciais(nomeConta()))}</span>${foto ? `<img src="${esc(foto)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
}
// foto que não carrega: ficam as iniciais
document.addEventListener('error', (e) => { if (e.target.matches?.('.me-avatar img')) e.target.remove(); }, true);

function menuRow(action, ic, label, sub = '', { danger = false, chevron = true, href = '', data = {} } = {}) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  const inner = `
    <span class="menu-ico">${icon(ic, { size: 20 })}</span>
    <span class="row-body"><span class="row-title">${esc(label)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    ${chevron ? `<span class="menu-chev">${icon(href ? 'external-link' : 'chevron-right', { size: 18 })}</span>` : ''}`;
  return href
    ? `<a class="menu-row" href="${href}" target="_blank" rel="noopener">${inner}</a>`
    : `<button type="button" class="menu-row ${danger ? 'danger' : ''}" data-action="${action}"${attrs}>${inner}</button>`;
}

function profileMenu() {
  const u = contaAtual();
  const admin = typeof isAdmin !== 'undefined' && isAdmin;
  const status = typeof syncStatusText === 'function' ? syncStatusText() : '';
  openSheet('Minha conta', `
    <div class="menu">
      <button type="button" class="account me-card" data-action="sync-now" aria-label="Sincronizar agora">
        ${avatarConta('lg')}
        <span class="row-body">
          <span class="row-title">${esc(nomeConta())}</span>
          ${u?.email ? `<span class="row-sub">${esc(u.email)}</span>` : ''}
          ${status ? `<span class="row-sub sync-line" id="sync-status">${esc(status)}</span>` : ''}
        </span>
      </button>
      <nav class="menu-list" aria-label="Opções da conta">
        ${typeof familiaMenuRow === 'function' ? familiaMenuRow() : ''}
        ${typeof planoMenuRow === 'function' ? planoMenuRow() : ''}
        ${menuRow('menu-config', 'settings', 'Configurações', 'Lembretes, aparência, calendário e conta')}
        ${typeof canInstall === 'function' && canInstall() ? menuRow('install', 'smartphone', 'Instalar o app', 'Ícone na tela inicial do celular') : ''}
        ${admin ? menuRow('go-painel', 'chart-column', 'Painel de uso', 'Visível só para você') : ''}
        ${menuRow('menu-ajuda', 'circle-help', 'Ajuda e sobre', `Versão ${APP_VERSION}`)}
      </nav>
      ${u ? `<nav class="menu-list">${menuRow('logout', 'log-out', 'Sair da conta', '', { danger: true, chevron: false })}</nav>` : ''}
    </div>`, null);
}
const settingsSheet = profileMenu; // nome antigo, usado pelo sync.js

/** Configurações: uma tela só, com as seções em sequência. */
function configMenu() {
  const perm = notifSupported() ? Notification.permission : 'unsupported';
  const lembretesOn = db.config.lembretes && perm === 'granted';
  const status = !notifSupported() ? 'Este navegador não suporta notificações. Use o calendário para receber os avisos.'
    : perm === 'denied' ? 'Notificações bloqueadas no navegador. Libere nas permissões do site.'
    : lembretesOn ? 'Você é avisado quando abre o app ou quando ele está aberto em segundo plano.'
    : 'Ative para ser avisado antes de vacinas, remédios e quando a ração estiver acabando.';
  const theme = document.documentElement.dataset.theme || 'auto';
  const u = contaAtual();
  const provs = (u?.app_metadata?.providers || []).map((p) => ({ google: 'Google', email: 'E-mail e senha' }[p] || p)).join(' e ');

  openSheet('Configurações', `
    <div class="menu form config">
      <section class="config-sec" aria-labelledby="cfg-lembretes">
        <h3 class="menu-title" id="cfg-lembretes">${icon('bell', { size: 18 })}Lembretes</h3>
        <label class="check-field"><input type="checkbox" data-reminder-toggle ${lembretesOn ? 'checked' : ''} ${notifSupported() ? '' : 'disabled'}> Notificações neste aparelho</label>
        <label class="field"><span>Horário do aviso</span><input type="time" data-reminder-time value="${esc(db.config.horario)}"></label>
        <p>${status}</p>
        ${lembretesOn ? `<button class="btn plain" data-action="test-notification">${icon('bell-ring', { size: 18 })}Testar notificação</button>` : ''}
        ${typeof pushSecao === 'function' ? pushSecao() : ''}
      </section>

      <section class="config-sec" aria-labelledby="cfg-aparencia">
        <h3 class="menu-title" id="cfg-aparencia">${icon('palette', { size: 18 })}Aparência</h3>
        <label class="field"><span>Tema</span>
          <select data-theme-select>
            <option value="auto" ${theme === 'auto' ? 'selected' : ''}>Automático (igual ao celular)</option>
            <option value="light" ${theme === 'light' ? 'selected' : ''}>Claro</option>
            <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Escuro</option>
          </select>
        </label>
      </section>

      <section class="config-sec" aria-labelledby="cfg-calendario">
        <h3 class="menu-title" id="cfg-calendario">${icon('calendar-plus', { size: 18 })}Calendário</h3>
        <p>Envie os cuidados pendentes para o calendário do celular. Os alertas vão junto, então você é avisado mesmo com o app fechado.</p>
        <button class="btn plain" data-action="export-ics">${icon('calendar-plus', { size: 18 })}Enviar agenda para o calendário</button>
      </section>

      <section class="config-sec" aria-labelledby="cfg-conta">
        <h3 class="menu-title" id="cfg-conta">${icon('user', { size: 18 })}Conta</h3>
        <div class="info card"><dl style="margin:0">
          <div><dt>E-mail</dt><dd>${esc(u?.email || '—')}</dd></div>
          ${provs ? `<div><dt>Entra com</dt><dd>${esc(provs)}</dd></div>` : ''}
        </dl></div>
        <p>Baixe uma cópia de tudo o que você cadastrou (pets, cuidados, pesos, gastos, ração e anexos). É um direito seu pela LGPD.</p>
        <button class="btn plain" data-action="export">${icon('download', { size: 18 })}Baixar meus dados</button>
        ${typeof contaBotoes === 'function' ? contaBotoes() : ''}
      </section>
    </div>`, null, { back: profileMenu });
}

function ajudaSheet() {
  openSheet('Ajuda e sobre', `
    <div class="menu">
      <div class="about-card">
        <span class="about-logo">${icon('paw-print', { size: 30 })}</span>
        <div><b>Miaumigo</b><span>Versão ${APP_VERSION}</span></div>
      </div>
      <nav class="menu-list">
        ${typeof canInstall === 'function' && canInstall() ? menuRow('install', 'smartphone', 'Como instalar no celular') : ''}
        ${menuRow('', 'mail', 'Enviar sugestão ou relatar problema', SUPORTE_EMAIL, { href: `mailto:${SUPORTE_EMAIL}?subject=${encodeURIComponent(`Miaumigo ${APP_VERSION}`)}` })}
        ${menuRow('', 'file-text', 'Termos de Uso', '', { href: 'termos.html' })}
        ${menuRow('', 'shield-check', 'Política de Privacidade', '', { href: 'privacidade.html' })}
      </nav>
      <p class="form-hint">Ícones: Lucide (ISC). Feito com carinho para quem cuida de pets.</p>
    </div>`, null, { back: profileMenu });
}

function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('miaumigo:theme', t); } catch { /* ignore */ }
}
try { const t = localStorage.getItem('miaumigo:theme'); if (t && t !== 'auto') document.documentElement.dataset.theme = t; } catch { /* ignore */ }

sheet.addEventListener('change', async (e) => {
  if (e.target.matches('[data-theme-select]')) applyTheme(e.target.value);
  if (e.target.matches('[data-reminder-time]') && e.target.value) {
    db.config.horario = e.target.value;
    db.config.avisados = {};
    save(); render();
    toast(`Avisos às ${db.config.horario}`);
    if (typeof atualizarPush === 'function') atualizarPush();
  }
  if (e.target.matches('[data-reminder-toggle]')) {
    if (e.target.checked) {
      const ok = await enableReminders();
      if (!ok) e.target.checked = false;
    } else {
      db.config.lembretes = false;
      save();
      toast('Lembretes desativados');
    }
    render();
    configMenu();
  }
});

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

async function exportData() {
  let anexos = [];
  try {
    anexos = await Promise.all((await IDB.all()).map(async ({ blob, ...a }) => ({ ...a, dataUrl: await blobToDataURL(blob) })));
  } catch { /* sem anexos */ }
  const { config, owner, ...dados } = db; // preferências do aparelho não entram
  downloadFile(`miaumigo-meus-dados-${today()}.json`,
    JSON.stringify({ app: 'miaumigo', versao: 3, conta: contaAtual()?.email || null, exportadoEm: new Date().toISOString(), ...dados, anexos }, null, 1),
    'application/json');
  toast('Seus dados foram baixados');
}

function loadDemo() {
  const t = today();
  const mingau = { id: uid(), nome: 'Mingau', especie: 'gato', sexo: 'M', raca: 'SRD', nascimento: addDays(t, -365 * 3 - 40), castrado: true, veterinario: 'Dra. Ana – Clínica Bicho Feliz', obs: 'Adora sachê de salmão. Tem medo de secador.', criadoEm: t };
  const pacoca = { id: uid(), nome: 'Paçoca', especie: 'cachorro', sexo: 'F', raca: 'Vira-lata caramelo', nascimento: addDays(t, -365 - 3 + 5), castrado: false, obs: 'Puxa muito na guia.', criadoEm: t };
  db.pets.push(mingau, pacoca);
  const care = (pet, tipo, titulo, d, extra = {}) => db.cuidados.push({ id: uid(), petId: pet.id, tipo, titulo, data: addDays(t, d), repetir: 0, lembrete: 0, obs: '', feito: false, ...extra });
  care(mingau, 'vacina', 'V5 (reforço anual)', 12, { repetir: 365, lembrete: 7 });
  care(mingau, 'vermifugo', 'Drontal', -2, { repetir: 90 });
  care(mingau, 'consulta', 'Check-up', -60, { feito: true });
  care(pacoca, 'antipulgas', 'Bravecto', 3, { repetir: 90, lembrete: 1 });
  care(pacoca, 'vacina', 'Antirrábica', 40, { repetir: 365, lembrete: 7 });
  care(pacoca, 'banho', 'Banho no pet shop', 0, { repetir: 15 });
  care(pacoca, 'vacina', 'V10', -20, { feito: true });
  [[-150, 4.2], [-100, 4.5], [-60, 4.7], [-20, 4.6], [-2, 4.8]].forEach(([d, v]) => db.pesos.push({ id: uid(), petId: mingau.id, data: addDays(t, d), kg: v }));
  [[-120, 9.5], [-60, 11.2], [-10, 12.4]].forEach(([d, v]) => db.pesos.push({ id: uid(), petId: pacoca.id, data: addDays(t, d), kg: v }));
  const exp = (pet, categoria, descricao, valor, d) => db.gastos.push({ id: uid(), petId: pet?.id ?? null, categoria, descricao, valor, data: addDays(t, d) });
  exp(mingau, 'racao', 'Ração 10 kg', 189.9, -3);
  exp(pacoca, 'racao', 'Ração 15 kg', 214.5, -1);
  exp(pacoca, 'servicos', 'Banho e tosa', 70, -14);
  exp(mingau, 'higiene', 'Areia sanitária', 45.8, -6);
  exp(pacoca, 'brinquedos', 'Bolinha que apita', 24.9, -8);
  exp(pacoca, 'saude', 'Vacina V10', 120, -20);
  exp(mingau, 'saude', 'Consulta check-up', 180, -60);
  exp(null, 'acessorios', 'Caminha nova', 129, -35);
  db.racoes.push(
    { id: uid(), petId: mingau.id, nome: 'Golden Gatos Castrados', pesoKg: 3, consumoG: 55, inicio: addDays(t, -42), aviso: 5, preco: 89.9 },
    { id: uid(), petId: pacoca.id, nome: 'Premier Filhotes', pesoKg: 15, consumoG: 320, inicio: addDays(t, -88), fim: addDays(t, -42), aviso: 5, preco: 229 },
    { id: uid(), petId: pacoca.id, nome: 'Premier Filhotes', pesoKg: 15, consumoG: 330, inicio: addDays(t, -42), aviso: 5, preco: 214.5 },
  );
  save(); closeSheet(); render();
  toast('Dados de exemplo carregados');
}

/* ---------------- Ações ---------------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, pet } = el.dataset;

  switch (action) {
    case 'add-pet': if (typeof podeNovoPet === 'function' && !podeNovoPet()) break; petForm(); break;
    case 'edit-pet': petForm(getPet(id)); break;
    case 'delete-pet': {
      const p = getPet(id);
      if (!p || !confirm(`Remover ${p.nome}? Os cuidados, pesagens e notas dele também serão apagados. Os gastos continuam no histórico.`)) return;
      deleteAttachmentsOf([...db.cuidados, ...db.notas].filter((x) => x.petId === id).map((x) => x.id));
      db.notas = db.notas.filter((x) => x.petId !== id);
      db.pets = db.pets.filter((x) => x.id !== id);
      db.cuidados = db.cuidados.filter((x) => x.petId !== id);
      db.pesos = db.pesos.filter((x) => x.petId !== id);
      db.racoes = db.racoes.filter((x) => x.petId !== id);
      db.gastos.forEach((g) => { if (g.petId === id) g.petId = null; });
      save();
      closeSheet();
      location.hash = '#/pets';
      toast(`${p.nome} foi removido`);
      break;
    }
    case 'remove-photo':
      pendingPhoto = null;
      $('#photo-preview').innerHTML = `<div class="avatar lg">${icon(SPECIES[$('select[name=especie]', sheet).value]?.icon ?? 'paw-print', { size: 44 })}</div>`;
      el.remove();
      break;
    case 'pet-tab': ui.petTab = el.dataset.tab; render(); break;
    case 'pet-about': { const p = getPet(id); if (p) petAboutSheet(p); break; }

    case 'add-care': careForm(null, pet); break;
    case 'edit-care': careForm(db.cuidados.find((c) => c.id === id)); break;
    case 'toggle-care': toggleCare(id); break;
    case 'delete-care':
      if (!confirm('Apagar este cuidado e os anexos dele?')) return;
      deleteAttachmentsOf([id]);
      db.cuidados = db.cuidados.filter((c) => c.id !== id);
      closeSheet(); save(); render(); toast('Cuidado apagado');
      break;
    case 'care-ics': {
      const c = db.cuidados.find((x) => x.id === id);
      if (c) exportICS([c], `miaumigo-${(c.titulo || c.tipo).toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.ics`);
      break;
    }
    case 'agenda-filter': ui.agendaPet = pet; render(); break;

    case 'view-attach': viewAttachment(id); break;
    case 'delete-attach':
      if (!confirm('Remover este anexo?')) return;
      IDB.del(id).then(async () => {
        await renderAttachments(attachCtx?.careId);
        if (attachCtx) syncAttachCount(attachCtx.careId);
      });
      break;
    case 'close-viewer': viewer.close(); break;

    case 'add-food': foodForm(null, pet); break;
    case 'edit-food': foodForm(db.racoes.find((r) => r.id === id)); break;
    case 'delete-food':
      if (!confirm('Apagar este pacote de ração?')) return;
      db.racoes = db.racoes.filter((r) => r.id !== id);
      closeSheet(); save(); render(); toast('Pacote apagado');
      break;

    case 'print': window.print(); break;
    case 'share-card': shareCard(getPet(id)); break;

    case 'add-weight': weightForm(pet); break;
    case 'delete-weight':
      if (!confirm('Apagar esta pesagem?')) return;
      db.pesos = db.pesos.filter((w) => w.id !== id);
      save(); render();
      break;

    case 'add-expense': expenseForm(null, pet); break;
    case 'edit-expense': expenseForm(db.gastos.find((g) => g.id === id)); break;
    case 'delete-expense':
      if (!confirm('Apagar este gasto?')) return;
      db.gastos = db.gastos.filter((g) => g.id !== id);
      closeSheet(); save(); render(); toast('Gasto apagado');
      break;
    case 'month': ui.month = shiftMonth(ui.month, Number(el.dataset.delta)); render(); break;

    case 'enable-reminders': enableReminders().then(render); break;
    case 'dismiss-banner': db.config.bannerFechado = true; save(); render(); break;
    case 'test-notification': showNotification('Miaumigo', 'Tudo certo! É assim que os lembretes vão aparecer.', 'teste'); break;
    case 'export-ics': {
      const pend = db.cuidados.filter((c) => !c.feito && getPet(c.petId) && !(c.serieId && db.cuidados.some((o) => o.id !== c.id && !o.feito && (o.serieId || o.id) === c.serieId && o.data < c.data)));
      exportICS(pend, 'miaumigo-agenda.ics');
      break;
    }

    // menu de perfil e submenus
    case 'settings':
    case 'profile': profileMenu(); break;
    case 'menu-config': configMenu(); break;
    case 'menu-ajuda': ajudaSheet(); break;
    case 'sheet-back': if (sheetBack) sheetBack(); break;
    case 'export': exportData(); break;
    case 'close-sheet': closeSheet(); break;
  }
});

/* ---------------- Toast ---------------- */

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------------- Start ---------------- */

document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, { size: 24 }); });

window.addEventListener('hashchange', () => {
  if (route().name !== 'pet') ui.petTab = 'saude';
  render();
  window.scrollTo(0, 0);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // updateViaCache 'none': o navegador sempre confere o sw.js no servidor
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const procurarAtualizacao = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) procurarAtualizacao(); });
    setInterval(procurarAtualizacao, 30 * 60 * 1000);
  }).catch(() => { /* sem SW: notificações simples */ });

  // Versão nova assumiu: recarrega sozinho (esperando fechar um formulário aberto, para não perder nada)
  let tinhaVersao = !!navigator.serviceWorker.controller;
  let recarregando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaVersao) { tinhaVersao = true; return; } // primeira instalação: nada a recarregar
    if (recarregando) return;
    const recarregar = () => { recarregando = true; location.reload(); };
    if (sheet.open) {
      sheet.addEventListener('close', recarregar, { once: true });
      toast('Nova versão do Miaumigo pronta: ela entra quando você fechar esta janela.');
    } else {
      recarregar();
    }
  });
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkReminders(); } });
setInterval(checkReminders, 60 * 1000);

render();
checkReminders();
splashReady('app');

// limpa anexos órfãos (ex.: app fechado com um cuidado novo ainda em rascunho)
IDB.all().then((all) => {
  const ids = new Set([...db.cuidados, ...db.notas].map((c) => c.id));
  all.filter((a) => !ids.has(a.careId)).forEach((a) => IDB.del(a.id));
}).catch(() => {});
