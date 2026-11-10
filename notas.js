'use strict';

/* =========================================================
   Miaumigo — Notas por pet
   Linha do tempo por dia, com data e hora editáveis, etiquetas livres
   com cores, filtro por etiqueta, foto opcional e autor. Cada nota é um
   registro tipo 'nota' (db.notas); a foto é um anexo comum (IndexedDB +
   Storage) ligado à nota pelo campo careId.
   ========================================================= */

const ETIQUETAS_SUGERIDAS = ['Saúde', 'Vômito', 'Diarreia', 'Alimentação', 'Comportamento', 'Veterinário'];
const CORES_ETIQUETA = 8;
const notaUI = { tag: 'todas', petId: null };
let notaTags = [];      // etiquetas do formulário aberto
let gerenciando = false; // modo "Gerenciar etiquetas" (tocar apaga da lista)
let tagsNovas = [];     // criadas neste formulário: continuam na lista mesmo desmarcadas
let fotoUrls = [];      // fotos mostradas na linha do tempo

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Cor fixa por etiqueta: as sugeridas têm cor própria; as outras, pela "assinatura" do nome. */
function corEtiqueta(t) {
  const i = ETIQUETAS_SUGERIDAS.findIndex((s) => semAcento(s) === semAcento(t));
  if (i >= 0) return i;
  let h = 0;
  for (const ch of semAcento(t)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % CORES_ETIQUETA;
}
const etiqueta = (t, extra = '') => `<span class="etq c${corEtiqueta(t)}" ${extra}>${esc(t)}</span>`;

/** Etiquetas já usadas (em qualquer nota) + as sugeridas, sem repetir. */
/** Sugeridas que a pessoa tirou da lista (Gerenciar etiquetas). */
const ocultas = () => new Set(db.config.etiquetasOcultas || []);
function etiquetasConhecidas() {
  const vistas = new Map();
  const tiradas = ocultas();
  [...ETIQUETAS_SUGERIDAS.filter((t) => !tiradas.has(semAcento(t))), ...db.notas.flatMap((n) => n.tags || [])].forEach((t) => {
    const k = semAcento(t);
    if (k && !vistas.has(k)) vistas.set(k, t);
  });
  return [...vistas.values()];
}

const horaAgora = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const chaveNota = (n) => `${n.data} ${n.hora || '00:00'}`;

function diaNota(iso) {
  const t = today();
  if (iso === t) return 'Hoje';
  if (iso === addDays(t, -1)) return 'Ontem';
  const d = parseISO(iso);
  const txt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', ...(iso.slice(0, 4) !== t.slice(0, 4) ? { year: 'numeric' } : {}) });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** "por Fulana" — só em pet da família com 2+ pessoas. */
function autorNota(n) {
  if (!n.autor || typeof familia === 'undefined' || !familia || (familia.membros || []).length < 2 || !petDaFamilia(n.petId)) return '';
  const eu = typeof remote !== 'undefined' ? remote.userId() : null;
  const nome = n.autor === eu ? 'você' : (familia.membros.find((m) => m.user_id === n.autor)?.nome || 'alguém que saiu da família');
  return `<span class="nota-autor">por ${esc(nome)}</span>`;
}

/* ---------------- Aba "Notas" do pet ---------------- */

function petNotas(p) {
  if (notaUI.petId !== p.id) Object.assign(notaUI, { petId: p.id, tag: 'todas' });
  const todas = db.notas.filter((n) => n.petId === p.id).sort((a, b) => chaveNota(b).localeCompare(chaveNota(a)));
  const usadas = [...new Map(todas.flatMap((n) => n.tags || []).map((t) => [semAcento(t), t])).values()];
  if (notaUI.tag !== 'todas' && !usadas.some((t) => semAcento(t) === notaUI.tag)) notaUI.tag = 'todas';
  const lista = notaUI.tag === 'todas' ? todas : todas.filter((n) => (n.tags || []).some((t) => semAcento(t) === notaUI.tag));

  const dias = [];
  for (const n of lista) {
    const g = dias[dias.length - 1];
    if (g && g.data === n.data) g.notas.push(n); else dias.push({ data: n.data, notas: [n] });
  }

  const filtros = usadas.length ? `
    <div class="filters nota-filtros" role="group" aria-label="Filtrar por etiqueta">
      <button type="button" data-action="nota-filtro" data-tag="todas" aria-pressed="${notaUI.tag === 'todas'}">Todas</button>
      ${usadas.map((t) => `<button type="button" data-action="nota-filtro" data-tag="${esc(semAcento(t))}" aria-pressed="${notaUI.tag === semAcento(t)}"><i class="etq-dot c${corEtiqueta(t)}"></i>${esc(t)}</button>`).join('')}
    </div>` : '';

  setTimeout(mostrarFotosNotas, 0);
  return `
    <section class="section">
      <div class="section-head"><h2>Notas</h2><button class="btn sm ghost" data-action="add-nota" data-pet="${p.id}">${icon('plus', { size: 16 })}Nota</button></div>
      ${filtros}
      ${!todas.length
        ? `<div class="card">${emptyState('pencil', 'Nenhuma nota ainda', `Anote o que acontece com ${esc(p.nome)}: sintomas, comportamento, alimentação… Fica tudo numa linha do tempo.`,
            `<button class="btn" data-action="add-nota" data-pet="${p.id}">Escrever a primeira nota</button>`)}</div>`
        : dias.map((g) => `
          <div class="nota-dia">
            <h3 class="nota-dia-t">${diaNota(g.data)}</h3>
            <div class="card list">${g.notas.map(notaRow).join('')}</div>
          </div>`).join('') || '<p class="hint">Nenhuma nota com essa etiqueta.</p>'}
    </section>`;
}

function notaRow(n) {
  return `
    <button type="button" class="nota" data-action="edit-nota" data-id="${n.id}">
      <span class="nota-top">
        ${n.hora ? `<span class="nota-hora">${icon('clock', { size: 14 })}${esc(n.hora)}</span>` : ''}
        ${(n.tags || []).map((t) => etiqueta(t)).join('')}
      </span>
      <span class="nota-texto">${esc(n.texto)}</span>
      ${n.anexos ? `<span class="nota-fotos" data-nota-fotos="${n.id}"></span>` : ''}
      ${autorNota(n)}
    </button>`;
}

/** Miniaturas das fotos (vêm do IndexedDB, depois que a tela foi desenhada). */
async function mostrarFotosNotas() {
  const caixas = document.querySelectorAll('[data-nota-fotos]');
  if (!caixas.length) return;
  fotoUrls.forEach(URL.revokeObjectURL);
  fotoUrls = [];
  for (const el of caixas) {
    let fotos = [];
    try { fotos = (await IDB.byCare(el.dataset.notaFotos)).filter((a) => a.tipo.startsWith('image/')).sort((a, b) => a.criadoEm - b.criadoEm); } catch { /* sem IndexedDB */ }
    el.innerHTML = fotos.map((a) => {
      const url = URL.createObjectURL(a.blob);
      fotoUrls.push(url);
      return `<span class="nota-foto" role="button" tabindex="0" data-action="view-attach" data-id="${a.id}" aria-label="Ver foto"><img src="${url}" alt=""></span>`;
    }).join('');
  }
}

/* ---------------- Formulário ---------------- */

function desenharEtiquetas() {
  const box = document.getElementById('tag-pick');
  if (!box) return;
  const sel = new Set(notaTags.map(semAcento));
  const todas = [...new Map([...etiquetasConhecidas(), ...tagsNovas, ...notaTags].map((t) => [semAcento(t), t])).values()];
  const btn = document.getElementById('tag-gerenciar');
  if (btn) btn.textContent = gerenciando ? 'Concluir' : 'Gerenciar';
  box.classList.toggle('gerenciando', gerenciando);
  if (gerenciando) {
    box.innerHTML = todas.length ? todas.map((t) => `
      <button type="button" class="etq-op c${corEtiqueta(t)}" data-action="nota-tag-del" data-tag="${esc(t)}" aria-label="Apagar a etiqueta ${esc(t)}">
        ${esc(t)}${icon('x', { size: 14 })}
      </button>`).join('') : '<p class="hint">Nenhuma etiqueta.</p>';
    return;
  }
  box.innerHTML = todas.map((t) => `
    <button type="button" class="etq-op c${corEtiqueta(t)}" data-action="nota-tag" data-tag="${esc(t)}" aria-pressed="${sel.has(semAcento(t))}">
      ${sel.has(semAcento(t)) ? icon('check', { size: 14 }) : ''}${esc(t)}
    </button>`).join('');
}

/** Tira a etiqueta da lista: some de todas as notas (que continuam) e, se for sugerida, das sugestões. */
function excluirEtiqueta(t) {
  const k = semAcento(t);
  const usam = db.notas.filter((n) => (n.tags || []).some((x) => semAcento(x) === k));
  const daFamilia = usam.some((n) => typeof petDaFamilia === 'function' && petDaFamilia(n.petId));
  const msg = usam.length
    ? `Apagar a etiqueta “${t}”?

Ela sai da lista e de ${usam.length === 1 ? '1 nota' : `${usam.length} notas`}${daFamilia ? ' (inclusive de pets da família)' : ''}. As notas continuam.`
    : `Tirar a etiqueta “${t}” da lista?`;
  if (!confirm(msg)) return;
  usam.forEach((n) => { n.tags = n.tags.filter((x) => semAcento(x) !== k); });
  notaTags = notaTags.filter((x) => semAcento(x) !== k);
  tagsNovas = tagsNovas.filter((x) => semAcento(x) !== k);
  if (ETIQUETAS_SUGERIDAS.some((s) => semAcento(s) === k)) {
    db.config.etiquetasOcultas = [...new Set([...(db.config.etiquetasOcultas || []), k])];
  }
  save();
  render(); // a linha do tempo atrás do formulário também muda
  desenharEtiquetas();
  toast(`Etiqueta “${t}” apagada`);
}

function adicionarEtiqueta() {
  const inp = document.getElementById('tag-nova');
  const t = (inp?.value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!t) return;
  // recriar uma sugerida que tinha sido tirada da lista: ela volta
  if (ocultas().has(semAcento(t))) db.config.etiquetasOcultas = db.config.etiquetasOcultas.filter((k) => k !== semAcento(t));
  const ja = etiquetasConhecidas().find((x) => semAcento(x) === semAcento(t)) || t;
  if (!notaTags.some((x) => semAcento(x) === semAcento(ja))) notaTags.push(ja);
  if (!tagsNovas.some((x) => semAcento(x) === semAcento(ja))) tagsNovas.push(ja);
  inp.value = '';
  desenharEtiquetas();
  inp.focus();
}

function notaForm(nota, petId) {
  const n = nota || { petId, data: today(), hora: horaAgora(), texto: '', tags: [] };
  const notaId = nota?.id || uid();
  attachCtx = { careId: notaId, draft: !nota };
  notaTags = [...(n.tags || [])];
  gerenciando = false;
  tagsNovas = [];
  openSheet(nota ? 'Editar nota' : 'Nova nota', `
    <form class="form" autocomplete="off">
      <label class="field"><span>O que aconteceu? *</span>
        <textarea name="texto" required maxlength="2000" rows="4" placeholder="Ex.: Vomitou depois do almoço e ficou mais quieta à tarde.">${esc(n.texto)}</textarea>
      </label>
      <div class="two">
        <label class="field"><span>Data</span><input type="date" name="data" required max="${today()}" value="${esc(n.data)}"></label>
        <label class="field"><span>Hora</span><input type="time" name="hora" value="${esc(n.hora || '')}"></label>
      </div>
      <div class="field">
        <span class="tag-head">Etiquetas <button type="button" class="link-btn" id="tag-gerenciar" data-action="nota-tag-gerenciar">Gerenciar</button></span>
        <div class="tag-pick" id="tag-pick"></div>
        <div class="tag-add">
          <input type="text" id="tag-nova" maxlength="24" placeholder="Criar etiqueta" aria-label="Nova etiqueta" enterkeyhint="done">
          <button type="button" class="btn sm plain" data-action="nota-tag-add">${icon('plus', { size: 16 })}Adicionar</button>
        </div>
      </div>
      <div class="field">
        <span>Foto</span>
        <div class="attach-grid" id="attach-grid"></div>
        ${anexarBtn('Adicionar foto', 'image/*', 'camera')}
      </div>
      ${autorLinha(nota)}
      <div class="actions">
        ${nota ? `<button type="button" class="btn danger" data-action="delete-nota" data-id="${nota.id}">Apagar</button>` : '<button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>'}
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>`, (d) => {
    const texto = d.texto.trim();
    if (!texto) return false;
    const fields = { petId: n.petId, data: d.data || today(), hora: d.hora || '', texto, tags: [...notaTags] };
    if (nota) {
      Object.assign(nota, fields);
      toast('Nota atualizada');
    } else {
      const autor = typeof remote !== 'undefined' ? remote.userId() || null : null;
      db.notas.push({ id: notaId, autor, criadoEm: new Date().toISOString(), anexos: attachCount, ...fields });
      attachCtx = null; // salva: a foto fica
      toast('Nota salva');
    }
  });
  desenharEtiquetas();
  renderAttachments(notaId);
}

/* ---------------- Ações ---------------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, pet } = el.dataset;
  switch (action) {
    case 'add-nota': notaForm(null, pet); break;
    case 'edit-nota': { const n = db.notas.find((x) => x.id === id); if (n) notaForm(n); break; }
    case 'delete-nota': {
      if (!confirm('Apagar esta nota? A foto dela também será apagada.')) return;
      deleteAttachmentsOf([id]);
      db.notas = db.notas.filter((x) => x.id !== id);
      save(); closeSheet(); render();
      toast('Nota apagada');
      break;
    }
    case 'nota-filtro': notaUI.tag = el.dataset.tag; render(); break;
    case 'nota-tag': {
      const t = el.dataset.tag;
      const i = notaTags.findIndex((x) => semAcento(x) === semAcento(t));
      if (i >= 0) notaTags.splice(i, 1); else notaTags.push(t);
      desenharEtiquetas();
      break;
    }
    case 'nota-tag-add': adicionarEtiqueta(); break;
    case 'nota-tag-gerenciar': gerenciando = !gerenciando; desenharEtiquetas(); break;
    case 'nota-tag-del': excluirEtiqueta(el.dataset.tag); break;
  }
});

// Enter no campo de etiqueta adiciona a etiqueta (em vez de salvar a nota)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'tag-nova') { e.preventDefault(); adicionarEtiqueta(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.nota-foto')) { e.preventDefault(); e.target.click(); }
});
