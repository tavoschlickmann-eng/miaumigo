'use strict';

/* =========================================================
   Miaumigo — Relatório para o veterinário (Premium)
   Uma página para imprimir ou salvar em PDF: dados do pet, peso,
   vacinas e preventivos, remédios e consultas, ração e notas de um
   período. Usa o visual e a impressão da carteirinha (#/relatorio/<pet>).
   ========================================================= */

const relUI = { dias: 90, notas: true };
const PERIODOS = [[30, '30 dias'], [90, '3 meses'], [180, '6 meses'], [365, '1 ano'], [0, 'Tudo']];

/** Abre o relatório (ou o aviso de Premium). */
function abrirRelatorio(petId) {
  if (typeof ehPremium === 'function' && !ehPremium()) { premiumSheet('relatorio'); return; }
  location.hash = `#/relatorio/${petId}`;
}

function viewRelatorio(id) {
  const p = getPet(id);
  if (!p) return `<a class="back" href="#/pets">${icon('chevron-left', { size: 18 })}Pets</a><div class="card">${emptyState('search', 'Pet não encontrado', 'Ele pode ter sido removido.')}</div>`;
  if (typeof ehPremium === 'function' && !ehPremium()) {
    setTimeout(() => { location.hash = `#/pet/${p.id}`; premiumSheet('relatorio'); }, 0);
    return '';
  }

  const hoje = today();
  const desde = relUI.dias ? addDays(hoje, -relUI.dias) : '0000-00-00';
  const noPeriodo = (d) => d && d >= desde && d <= hoje;
  const periodoTxt = relUI.dias ? `${fullDate(desde)} a ${fullDate(hoje)}` : 'Todo o histórico';

  const cares = db.cuidados.filter((c) => c.petId === p.id);
  const preventivos = cares.filter((c) => PREVENTIVE.includes(c.tipo) && c.feito && noPeriodo(c.data)).sort(byDateDesc);
  const outros = cares.filter((c) => !PREVENTIVE.includes(c.tipo) && c.tipo !== 'banho' && noPeriodo(c.data)).sort(byDateDesc);
  const proximos = cares.filter((c) => !c.feito && c.data >= hoje).sort(byDate).slice(0, 8);
  const atrasados = cares.filter((c) => !c.feito && c.data < hoje).sort(byDate);
  const pesos = db.pesos.filter((w) => w.petId === p.id).sort(byDate);
  const pesosPeriodo = pesos.filter((w) => noPeriodo(w.data));
  const ultimo = pesos[pesos.length - 1];
  const racao = activeFood(p.id);
  const notas = relUI.notas ? db.notas.filter((n) => n.petId === p.id && noPeriodo(n.data))
    .sort((a, b) => `${b.data} ${b.hora || ''}`.localeCompare(`${a.data} ${a.hora || ''}`)) : [];

  const info = [
    ['Espécie', SPECIES[p.especie]?.label], ['Raça', p.raca], ['Sexo', p.sexo === 'F' ? 'Fêmea' : p.sexo === 'M' ? 'Macho' : ''],
    ['Nascimento', p.nascimento ? `${fullDate(p.nascimento)} (${ageText(p.nascimento)})` : ''], ['Castrado', p.castrado ? 'Sim' : 'Não'],
    ['Microchip', p.microchip], ['Peso atual', ultimo ? `${kg(ultimo.kg)} em ${fullDate(ultimo.data)}` : ''], ['Veterinário', p.veterinario],
  ].filter(([, v]) => v);

  const vazio = (t) => `<p class="hint">${t}</p>`;
  const linhaCuidado = (c) => `<tr>
      <td>${fullDate(c.data)}</td>
      <td><b>${esc(c.titulo || CARE_TYPES[c.tipo]?.label || 'Cuidado')}</b><small>${CARE_TYPES[c.tipo]?.label || ''}${c.feito ? '' : ' · pendente'}</small>${c.obs ? `<small>${esc(c.obs)}</small>` : ''}</td>
    </tr>`;
  const tabela = (lista, cab) => lista.length
    ? `<table class="ctable"><thead><tr><th>Data</th><th>${cab}</th></tr></thead><tbody>${lista.map(linhaCuidado).join('')}</tbody></table>` : null;

  const variacao = pesosPeriodo.length > 1 ? Number(pesosPeriodo[pesosPeriodo.length - 1].kg) - Number(pesosPeriodo[0].kg) : null;

  return `
    <div class="top no-print" style="margin-bottom:12px">
      <a class="back" href="#/pet/${p.id}">${icon('chevron-left', { size: 18 })}${esc(p.nome)}</a>
      <div class="top-actions">
        <button class="btn" data-action="print">${icon('printer', { size: 18 })}Imprimir / PDF</button>
      </div>
    </div>

    <div class="rel-opcoes no-print">
      <div class="filters" role="group" aria-label="Período do relatório">
        ${PERIODOS.map(([d, l]) => `<button type="button" data-action="rel-periodo" data-dias="${d}" aria-pressed="${relUI.dias === d}">${l}</button>`).join('')}
      </div>
      <label class="check-field"><input type="checkbox" data-rel-notas ${relUI.notas ? 'checked' : ''}> Incluir as notas</label>
      <p class="form-hint" style="text-align:left">Para salvar em PDF, toque em “Imprimir / PDF” e escolha “Salvar como PDF”.</p>
    </div>

    <article class="carteira card relatorio">
      <header class="c-head">
        <span>${icon('stethoscope', { size: 20 })}Relatório de saúde</span>
        <small>Miaumigo</small>
      </header>
      <div class="c-pet">
        ${avatar(p, 'lg')}
        <div>
          <h1>${esc(p.nome)}</h1>
          <p>Período: ${esc(periodoTxt)}</p>
        </div>
      </div>
      <dl class="c-info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>

      ${p.obs ? `<h2 class="c-title">${icon('info', { size: 18 })}Observações do tutor</h2><p class="rel-texto">${esc(p.obs)}</p>` : ''}

      <h2 class="c-title">${icon('scale', { size: 18 })}Peso</h2>
      ${pesosPeriodo.length ? `
        <div class="chart rel-grafico">${weightChart(pesosPeriodo)}</div>
        ${variacao !== null ? `<p class="rel-texto">Variação no período: <b>${variacao > 0 ? '+' : ''}${kg(variacao)}</b> (de ${kg(pesosPeriodo[0].kg)} para ${kg(pesosPeriodo[pesosPeriodo.length - 1].kg)}).</p>` : ''}
        <table class="ctable"><thead><tr><th>Data</th><th>Peso</th></tr></thead>
          <tbody>${[...pesosPeriodo].reverse().map((w) => `<tr><td>${fullDate(w.data)}</td><td><b>${kg(w.kg)}</b></td></tr>`).join('')}</tbody></table>`
        : vazio('Nenhuma pesagem no período.')}

      <h2 class="c-title">${icon('syringe', { size: 18 })}Vacinas, vermífugos e antipulgas aplicados</h2>
      ${tabela(preventivos, 'Aplicação') || vazio('Nenhum registro no período.')}

      <h2 class="c-title">${icon('pill', { size: 18 })}Remédios, consultas e outros cuidados</h2>
      ${tabela(outros, 'Cuidado') || vazio('Nenhum registro no período.')}

      ${atrasados.length ? `<h2 class="c-title">${icon('triangle-alert', { size: 18 })}Atrasados</h2>${tabela(atrasados, 'Cuidado')}` : ''}

      <h2 class="c-title">${icon('calendar-days', { size: 18 })}Próximos cuidados</h2>
      ${proximos.length ? `<ul class="c-next">${proximos.map((c) => `<li><span>${icon(CARE_TYPES[c.tipo]?.icon || 'clipboard-list', { size: 16 })}${esc(c.titulo || CARE_TYPES[c.tipo]?.label)}</span><b>${fullDate(c.data)}</b></li>`).join('')}</ul>` : vazio('Nada agendado.')}

      <h2 class="c-title">${icon('utensils', { size: 18 })}Alimentação</h2>
      ${racao ? `<p class="rel-texto"><b>${esc(racao.nome || 'Ração')}</b> · ${racao.consumoG} g por dia · pacote de ${kg(racao.pesoKg)} aberto em ${fullDate(racao.inicio)}.</p>` : vazio('Nenhuma ração cadastrada.')}

      ${relUI.notas ? `
        <h2 class="c-title">${icon('pencil', { size: 18 })}Notas do tutor</h2>
        ${notas.length ? `<ul class="rel-notas">${notas.map((n) => `
          <li>
            <div class="rel-nota-top"><b>${fullDate(n.data)}${n.hora ? ` às ${esc(n.hora)}` : ''}</b>${(n.tags || []).length ? `<span>${n.tags.map(esc).join(' · ')}</span>` : ''}</div>
            <p>${esc(n.texto)}</p>
          </li>`).join('')}</ul>` : vazio('Nenhuma nota no período.')}` : ''}

      <footer class="c-foot">Gerado em ${fullDate(hoje)} pelo app Miaumigo, com base nos registros do tutor. Não substitui a avaliação do veterinário.</footer>
    </article>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'rel-periodo') { relUI.dias = Number(el.dataset.dias); render(); }
  if (el.dataset.action === 'relatorio') abrirRelatorio(el.dataset.id);
});
document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-rel-notas]')) { relUI.notas = e.target.checked; render(); }
});
