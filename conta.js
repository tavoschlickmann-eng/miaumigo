'use strict';

/* =========================================================
   Miaumigo — Conta: trocar (ou criar) a senha e excluir a conta.
   Fica em Configurações → Conta. A exclusão acontece NO BANCO
   (excluir_minha_conta, supabase/conta.sql); os arquivos do Storage
   são apagados antes, por aqui.
   ========================================================= */

const temSenha = () => (contaAtual()?.app_metadata?.providers || []).includes('email');

function contaBotoes() {
  if (!isLoggedIn()) return '';
  return `
    <div class="two">
      <button class="btn plain" data-action="conta-senha">${icon('lock', { size: 18 })}${temSenha() ? 'Trocar senha' : 'Criar senha'}</button>
      <button class="btn danger" data-action="conta-excluir">${icon('trash-2', { size: 18 })}Excluir conta</button>
    </div>`;
}

const campoSenha = (name, label, auto, extra = '') => `
  <label class="field"><span>${label}</span>
    <span class="input-ico">${icon('lock', { size: 18 })}<input type="password" name="${name}" required minlength="6" autocomplete="${auto}" ${extra}>
      <button type="button" class="pass-toggle" data-action="toggle-pass" aria-label="Mostrar senha">${icon('eye', { size: 18 })}</button>
    </span>
  </label>`;

function senhaSheet() {
  const criar = !temSenha();
  openSheet(criar ? 'Criar senha' : 'Trocar senha', `
    <form class="form" data-conta="senha" autocomplete="on">
      ${criar ? '<p class="form-note">Você entra com o Google. Criando uma senha, também poderá entrar com e-mail e senha.</p>' : ''}
      <input type="email" name="email" value="${esc(contaAtual()?.email || '')}" autocomplete="username" hidden>
      ${criar ? '' : campoSenha('atual', 'Senha atual', 'current-password')}
      ${campoSenha('nova', 'Senha nova', 'new-password', 'placeholder="Mínimo de 6 caracteres"')}
      ${campoSenha('repete', 'Repita a senha nova', 'new-password')}
      <p class="form-error" id="conta-error" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn plain" data-action="menu-config">Cancelar</button>
        <button class="btn" type="submit">${criar ? 'Criar senha' : 'Trocar senha'}</button>
      </div>
    </form>`, null, { back: configMenu });
}

/** O que acontece com os dados de quem exclui a conta (para mostrar antes). */
function resumoExclusao() {
  const meus = db.pets.filter((p) => !petDaFamilia(p.id));
  const ms = familia?.membros || [];
  const sozinho = familia && ms.length <= 1;
  const eu = remote.userId();
  const souUnicoResp = familia && familia.papel === 'responsavel' && !ms.some((m) => m.user_id !== eu && m.papel === 'responsavel');
  const herdeiro = ms.filter((m) => m.user_id !== eu).sort((a, b) => a.entrou_em.localeCompare(b.entrou_em))[0];
  const itens = [];
  itens.push(meus.length
    ? `Seus pets “Só meus” (${esc(meus.map((p) => p.nome).join(', '))}) e tudo deles (cuidados, notas, pesos, ração, gastos, fotos e anexos) serão <b>apagados para sempre</b>.`
    : 'Sua conta e seus dados pessoais serão <b>apagados para sempre</b>.');
  if (familia && sozinho) itens.push(`A família “${esc(familia.nome)}” e os pets dela também serão apagados, porque você é a única pessoa nela.`);
  if (familia && !sozinho) itens.push(`Os pets da família “${esc(familia.nome)}” continuam com as outras pessoas.${souUnicoResp && herdeiro ? ` <b>${esc(herdeiro.nome)}</b> passa a ser responsável.` : ''}`);
  const p = typeof plano === 'function' ? plano() : null;
  if (p?.premium && !p.pela_familia) itens.push(`Seu Premium${p.origem === 'fundador' ? ' de fundador' : ''} acaba${familia && !sozinho ? ', também para a família' : ''}.`);
  return itens;
}

function excluirSheet() {
  openSheet('Excluir conta', `
    <form class="form" data-conta="excluir" autocomplete="off">
      <div class="excluir-aviso">${icon('triangle-alert', { size: 22 })}<b>Não dá para desfazer.</b></div>
      <ul class="excluir-lista">${resumoExclusao().map((t) => `<li>${t}</li>`).join('')}</ul>
      <button type="button" class="btn plain" data-action="export">${icon('download', { size: 18 })}Baixar meus dados antes</button>
      <label class="field"><span>Para confirmar, digite <b>EXCLUIR</b></span><input name="confirma" required autocomplete="off" autocapitalize="characters" placeholder="EXCLUIR"></label>
      <p class="form-error" id="conta-error" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn plain" data-action="menu-config">Cancelar</button>
        <button class="btn danger-solid" type="submit">Excluir para sempre</button>
      </div>
    </form>`, null, { back: configMenu });
}

async function excluirConta() {
  // 1. arquivos do Storage que vão junto (os da família ficam com ela)
  const ms = familia?.membros || [];
  const familiaAcaba = familia && ms.length <= 1;
  const paths = Object.values(meta?.anexos || {})
    .filter((a) => a.fam === espacos?.pessoal || (familiaAcaba && a.fam === familia.id))
    .map((a) => a.path);
  if (paths.length) await remote.remove(paths);
  // 2. a conta e os dados (no banco)
  await remote.rpc('excluir_minha_conta');
  // 3. este aparelho (a inscrição de push no banco já foi junto com a conta)
  try { (await inscricaoAtual?.())?.unsubscribe(); } catch { /* sem push */ }
  contaExcluida = true;
  await remote.encerrar?.();
  closeSheet();
  await wipeLocal();
  setEspacos(null);
  location.hash = '#/entrar';
  toast('Sua conta foi excluída. Sentiremos sua falta!');
}

function erroConta(e) {
  const m = String(e?.message || e || '');
  if (/senha atual incorreta/i.test(m)) return 'A senha atual está incorreta.';
  if (/different from the old/i.test(m)) return 'A senha nova precisa ser diferente da atual.';
  if (/reauthentication|recent/i.test(m)) return 'Por segurança, saia e entre de novo antes de trocar a senha.';
  return authError(e);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'conta-senha') senhaSheet();
  if (el.dataset.action === 'conta-excluir') excluirSheet();
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-conta]');
  if (!form) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const err = form.querySelector('#conta-error');
  const btn = form.querySelector('[type=submit]');
  const falha = (msg) => { err.textContent = msg; err.hidden = false; btn.disabled = false; };
  err.hidden = true;
  btn.disabled = true;
  try {
    if (form.dataset.conta === 'senha') {
      if (form.nova.value !== form.repete.value) return falha('As duas senhas novas não são iguais.');
      await remote.trocarSenha(form.atual ? form.atual.value : null, form.nova.value);
      configMenu();
      toast(form.atual ? 'Senha trocada' : 'Senha criada. Agora você também pode entrar com e-mail e senha.');
    } else {
      if (form.confirma.value.trim().toUpperCase() !== 'EXCLUIR') return falha('Digite EXCLUIR para confirmar.');
      if (!navigator.onLine) return falha('Sem internet. Conecte-se para excluir a conta.');
      await excluirConta();
    }
  } catch (ex) {
    falha(erroConta(ex));
  }
}, true);
