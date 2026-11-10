'use strict';

/* =========================================================
   Miaumigo — Planos (Fase 4A: ainda sem cobrança)
   Premium é da família: vale para todos dela, inclusive nos pets
   "Só meus". Grátis: cada pessoa cria 1 pet; fotos e anexos são do
   Premium. As regras valem NO BANCO (supabase/premium.sql); aqui ficam
   os avisos, a tela "Seu plano" e a liberação pelo painel (admin).
   O plano vem junto com meus_espacos() (espacos.plano, no sync.js).
   ========================================================= */

const PRECO_MES = 'R$ 14,90';
const PRECO_ANO = 'R$ 119,90';

const plano = () => (typeof espacos !== 'undefined' && espacos?.plano) || null;
/** Sem informação ainda (primeiro acesso offline): não bloqueia; o banco confere de qualquer jeito. */
const ehPremium = () => { const p = plano(); return p ? !!p.premium : true; };

/** Pode cadastrar mais um pet? Se não, mostra o Premium. */
function podeNovoPet() {
  const p = plano();
  if (!p || p.premium || (p.pets_criados || 0) < (p.limite_pets || 1)) return true;
  premiumSheet('pets');
  return false;
}
/** Conta o pet criado agora (vale até a próxima sincronização trazer o número do banco). */
function contarPetCriado() {
  const p = plano();
  if (p && !p.premium) { p.pets_criados = (p.pets_criados || 0) + 1; setEspacos(espacos); }
}

const ORIGENS = { fundador: 'Fundador', cortesia: 'Cortesia', teste: 'Período de teste', beta: 'Liberado nos testes', mercadopago: 'Assinatura', stripe: 'Assinatura' };

function planoMenuRow() {
  if (!isLoggedIn()) return '';
  const p = plano();
  const sub = !p ? 'Grátis ou Premium' : p.premium
    ? `Premium${p.pela_familia ? ' pela família' : p.origem ? ` · ${ORIGENS[p.origem] || ''}` : ''}`
    : 'Grátis · conheça o Premium';
  return menuRow('menu-plano', 'sparkles', 'Seu plano', sub);
}

const BENEFICIOS = [
  ['paw-print', 'Pets ilimitados', 'No grátis, cada pessoa cadastra 1 pet.'],
  ['paperclip', 'Fotos e anexos', 'Receitas, exames, comprovantes e fotos nas notas.'],
  ['users', 'Para a família toda', 'Uma assinatura vale para todos da família.'],
  ['stethoscope', 'Relatório para o veterinário', 'Saúde, peso, remédios e notas num PDF para a consulta.'],
  ['bell-ring', 'Lembretes com o app fechado', 'O aviso chega no horário, mesmo sem abrir o app.'],
];
const beneficiosHtml = () => `
  <div class="menu-list premium-lista">
    ${BENEFICIOS.map(([ic, t, s]) => `<div class="menu-row static"><span class="menu-ico">${icon(ic, { size: 20 })}</span><span class="row-body"><span class="row-title">${t}</span><span class="row-sub">${s}</span></span></div>`).join('')}
  </div>`;

/** Tela do Premium (também é o aviso quando algo é do Premium). */
function premiumSheet(motivo = '') {
  const avisos = {
    pets: 'No plano grátis, cada pessoa cadastra 1 pet. Com o Premium, são ilimitados.',
    anexos: 'Fotos e anexos são do Premium. A foto de perfil do pet continua grátis.',
    relatorio: 'O relatório para o veterinário é do Premium: saúde, peso, remédios e notas de um período, pronto para imprimir ou salvar em PDF.',
    push: 'Os lembretes com o app fechado são do Premium. Com o app aberto, os avisos continuam funcionando no grátis.',
  };
  openSheet('Premium', `
    <div class="menu premium">
      <div class="premium-hero">
        <span class="premium-ico">${icon('sparkles', { size: 30 })}</span>
        <b>Miaumigo Premium</b>
        ${avisos[motivo] ? `<p>${avisos[motivo]}</p>` : '<p>Mais espaço para cuidar de todos os pets da família.</p>'}
      </div>
      ${beneficiosHtml()}
      <div class="premium-preco"><b>${PRECO_MES}</b><span>por mês, para a família toda</span><small>ou ${PRECO_ANO} por ano</small></div>
      <button type="button" class="btn block" disabled>${icon('clock', { size: 18 })}Assinatura em breve</button>
      ${menuRow('', 'mail', 'Quero ser avisado', 'Mande um e-mail e avisamos quando abrir', { href: `mailto:${SUPORTE_EMAIL}?subject=${encodeURIComponent('Quero o Miaumigo Premium')}` })}
      <p class="form-hint"><a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a>: renovação, cancelamento e reembolso.</p>
    </div>`, null, { back: motivo ? null : profileMenu });
}

/** "Seu plano" no menu da conta. */
function planoSheet() {
  const p = plano();
  if (!p?.premium) { premiumSheet(); return; }
  const fim = p.fim ? new Date(p.fim).toLocaleDateString('pt-BR') : '';
  const origem = p.pela_familia ? `Pelo Premium de <b>${esc(p.titular || 'alguém da família')}</b>, que vale para a família toda.`
    : p.origem === 'fundador' ? 'Você é fundador: Premium sem prazo. Obrigado por estar aqui desde o começo!'
    : p.origem === 'beta' ? 'Durante o período de testes, o Premium está liberado para todo mundo. Aproveite!'
    : p.origem === 'cortesia' ? 'Premium de cortesia.'
    : 'Sua assinatura Premium.';
  openSheet('Seu plano', `
    <div class="menu premium">
      <div class="premium-hero">
        <span class="premium-ico">${icon('sparkles', { size: 30 })}</span>
        <b>Você é Premium</b>
        <p>${origem}${fim ? ` Vale até ${fim}.` : ''}</p>
      </div>
      ${beneficiosHtml()}
    </div>`, null, { back: profileMenu });
}

/* ---------------- Painel (administradores) ---------------- */

const admPremium = { lista: null, carregando: false, erro: '' };

async function carregarPremiumAdmin() {
  admPremium.carregando = true;
  try { admPremium.lista = await remote.rpc('admin_premium_listar'); admPremium.erro = ''; } catch (e) { admPremium.erro = authError(e); }
  admPremium.carregando = false;
  if (route().name === 'painel') render();
}

/** Seção "Premium" do painel de uso. */
function painelPremium(d) {
  if (!d?.premium) return '';
  if (!admPremium.lista && !admPremium.carregando && !admPremium.erro) setTimeout(carregarPremiumAdmin, 0);
  const pr = d.premium;
  const origens = Object.entries(pr.por_origem || {}).map(([k, v]) => `${ORIGENS[k] || k}: ${fmtN(v)}`).join(' · ');
  return `
    <section class="section">
      <div class="section-head"><h2>Premium</h2><button class="btn sm ghost" data-action="adm-premium-dar">${icon('plus', { size: 16 })}Dar Premium</button></div>
      <div class="card beta-card ${pr.beta_aberto ? 'on' : ''}">
        <span class="menu-ico">${icon(pr.beta_aberto ? 'party-popper' : 'lock', { size: 20 })}</span>
        <div class="row-body"><div class="row-title">Período de testes ${pr.beta_aberto ? 'ligado' : 'desligado'}</div>
          <div class="row-sub">${pr.beta_aberto ? 'Todo mundo é Premium: ninguém vê limites nem paywall.' : 'Valem os limites do plano grátis para quem não tem Premium.'}</div></div>
        <button class="btn sm ${pr.beta_aberto ? 'plain' : ''}" data-action="adm-beta" data-ligar="${pr.beta_aberto ? '0' : '1'}">${pr.beta_aberto ? 'Desligar' : 'Ligar'}</button>
      </div>
      ${pr.contas_sem_premium ? `<button class="btn plain block" data-action="adm-fundadores" style="margin:10px 0">${icon('sparkles', { size: 18 })}Tornar ${fmtN(pr.contas_sem_premium)} ${pr.contas_sem_premium === 1 ? 'conta' : 'contas'} sem Premium em fundadoras</button>` : ''}
      <div class="stats">
        <div class="card stat"><div class="num">${fmtN(pr.pessoas)}</div><div class="lbl">pessoas com Premium</div></div>
        <div class="card stat"><div class="num">${fmtN(pr.familias)}</div><div class="lbl">famílias cobertas</div></div>
        <div class="card stat"><div class="num">${fmtN(pr.vencendo_30d)}</div><div class="lbl">vencem em 30 dias</div></div>
      </div>
      ${origens ? `<p class="hint" style="text-align:left;padding:8px 4px 0">${esc(origens)}</p>` : ''}
      <div class="card list" style="margin-top:10px">
        ${admPremium.erro ? `<p class="hint">${esc(admPremium.erro)}</p>`
          : !admPremium.lista ? '<p class="hint">Carregando…</p>'
          : !admPremium.lista.length ? '<p class="hint">Ninguém com Premium.</p>'
          : admPremium.lista.map((a) => `
            <div class="row">
              <span class="ibox">${icon('sparkles', { size: 18 })}</span>
              <div class="row-body"><div class="row-title">${esc(a.email)}</div>
                <div class="row-sub">${esc(ORIGENS[a.origem] || a.origem)} · ${a.fim ? `${a.ativo ? 'até' : 'venceu em'} ${new Date(a.fim).toLocaleDateString('pt-BR')}` : 'sem prazo'}</div></div>
              <button class="icon-btn ghost danger-ico" data-action="adm-premium-remover" data-email="${esc(a.email)}" aria-label="Tirar Premium de ${esc(a.email)}">${icon('x', { size: 18 })}</button>
            </div>`).join('')}
      </div>
    </section>`;
}

function darPremiumSheet() {
  openSheet('Dar Premium', `
    <form class="form" data-adm-premium autocomplete="off">
      <label class="field"><span>E-mail da conta</span><input type="email" name="email" required placeholder="pessoa@exemplo.com"></label>
      <div class="two">
        <label class="field"><span>Tipo</span>
          <select name="origem"><option value="cortesia">Cortesia</option><option value="fundador">Fundador</option><option value="teste">Período de teste</option></select>
        </label>
        <label class="field"><span>Por quanto tempo</span>
          <select name="dias"><option value="">Sem prazo</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="90">3 meses</option><option value="365">1 ano</option></select>
        </label>
      </div>
      <p class="form-hint" style="text-align:left">Vale para a família toda dessa pessoa.</p>
      <p class="form-error" id="adm-error" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn plain" data-action="close-sheet">Cancelar</button>
        <button class="btn" type="submit">Dar Premium</button>
      </div>
    </form>`, null);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'menu-plano': planoSheet(); break;
    case 'premium': premiumSheet(el.dataset.motivo || ''); break;
    case 'adm-premium-dar': darPremiumSheet(); break;
    case 'adm-beta': {
      const ligar = el.dataset.ligar === '1';
      if (!confirm(ligar ? 'Ligar o período de testes? Todo mundo passa a ser Premium enquanto estiver ligado.' : 'Desligar o período de testes? Quem não tem Premium volta a ter os limites do plano grátis (nada é apagado).')) return;
      try { await remote.rpc('admin_definir_beta', { p_ligado: ligar }); toast(ligar ? 'Período de testes ligado' : 'Período de testes desligado'); carregarPainel(); syncNow(); }
      catch (ex) { toast(authError(ex)); }
      break;
    }
    case 'adm-fundadores': {
      if (!confirm('Dar Premium de fundador, sem prazo, para todas as contas que ainda não têm Premium? Use isso no lançamento, como agradecimento a quem testou.')) return;
      try { const n = await remote.rpc('admin_testadores_viram_fundadores'); toast(`${n} ${n === 1 ? 'conta virou fundadora' : 'contas viraram fundadoras'}`); carregarPainel(); carregarPremiumAdmin(); }
      catch (ex) { toast(authError(ex)); }
      break;
    }
    case 'adm-premium-remover':
      if (!confirm(`Tirar o Premium de ${el.dataset.email}? Nada é apagado; só os recursos Premium param.`)) return;
      try { await remote.rpc('admin_premium_remover', { p_email: el.dataset.email }); toast('Premium removido'); carregarPainel(); carregarPremiumAdmin(); }
      catch (ex) { toast(authError(ex)); }
      break;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-adm-premium]');
  if (!form) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const err = form.querySelector('#adm-error');
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await remote.rpc('admin_premium_dar', { p_email: form.email.value.trim(), p_origem: form.origem.value, p_dias: form.dias.value ? Number(form.dias.value) : null });
    closeSheet();
    toast('Premium liberado');
    carregarPainel();
    carregarPremiumAdmin();
  } catch (ex) {
    err.textContent = /não encontrada/i.test(ex.message) ? 'Não existe conta com esse e-mail.' : authError(ex);
    err.hidden = false;
    btn.disabled = false;
  }
}, true);

// "Adicionar foto" no plano grátis: mostra a dica embaixo, sem sair do formulário
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="premium-anexo"]');
  if (el) { const dica = el.nextElementSibling; if (dica) dica.hidden = false; }
});
