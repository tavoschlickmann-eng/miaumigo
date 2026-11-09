'use strict';

/* =========================================================
   Miaumigo — instalar o app na tela inicial
   - Android/Chrome/Samsung/Edge e computador: abre a janela nativa de
     instalação (evento beforeinstallprompt). A pessoa só confirma.
   - iPhone/iPad: a Apple não permite abrir a instalação por um site;
     mostramos o passo a passo do "Adicionar à Tela de Início".
   - Navegador interno (WhatsApp, Instagram...): não instala nada;
     orientamos a abrir no Chrome/Safari.
   ========================================================= */

const INSTALL_DISMISS_KEY = 'miaumigo:instalarFechado';
const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isInAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|; wv\)/i.test(ua);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

let deferredInstall = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // guardamos para abrir quando a pessoa tocar no nosso botão
  deferredInstall = e;
  refreshInstallUI();
});

window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  closeSheet();
  toast('Miaumigo instalado! Procure o ícone na tela inicial.');
  refreshInstallUI();
});

/** Faz sentido oferecer a instalação neste aparelho/navegador? */
function canInstall() {
  if (isStandalone()) return false;
  return !!deferredInstall || isIOS || isAndroid || isInAppBrowser;
}

function refreshInstallUI() {
  const r = route().name;
  if (['entrar', 'inicio', ''].includes(r)) render();
}

async function installApp() {
  if (isStandalone()) { toast('O Miaumigo já está instalado neste aparelho.'); return; }
  if (isInAppBrowser) { inAppHelp(); return; }
  if (deferredInstall) {
    const prompt = deferredInstall;
    deferredInstall = null;
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome !== 'accepted') toast('Tudo bem! Dá para instalar depois pelo menu Minha conta.');
    refreshInstallUI();
    return;
  }
  if (isIOS) { iosHelp(); return; }
  genericHelp();
}

const passo = (n, ic, texto) => `
  <li class="install-step"><span class="install-num">${n}</span><span class="menu-ico">${icon(ic, { size: 20 })}</span><span>${texto}</span></li>`;

function iosHelp() {
  openSheet('Instalar no iPhone', `
    <div class="menu">
      <p>No iPhone, a instalação é feita pelo Safari, em três toques:</p>
      <ol class="install-steps">
        ${passo(1, 'share', 'Toque no botão <b>Compartilhar</b> (o quadrado com a seta para cima), na barra do Safari.')}
        ${passo(2, 'square-plus', 'Role a lista e toque em <b>Adicionar à Tela de Início</b>.')}
        ${passo(3, 'check', 'Toque em <b>Adicionar</b>. Pronto: o Miaumigo aparece junto com seus apps.')}
      </ol>
      <p class="form-hint">Se estiver usando outro navegador no iPhone, abra este endereço no Safari.</p>
      <button class="btn plain" data-action="copy-link">${icon('copy', { size: 18 })}Copiar endereço do app</button>
    </div>`, null);
}

function inAppHelp() {
  openSheet('Abra no navegador', `
    <div class="menu">
      <p>Você abriu o Miaumigo dentro de outro app (como WhatsApp ou Instagram). Por ali não dá para instalar.</p>
      <ol class="install-steps">
        ${passo(1, 'ellipsis-vertical', `Toque no menu <b>⋮</b> ou <b>…</b> no canto da tela.`)}
        ${passo(2, 'external-link', `Escolha <b>Abrir no ${isIOS ? 'Safari' : 'Chrome'}</b> (ou "Abrir no navegador").`)}
        ${passo(3, 'smartphone', 'Lá, toque em <b>Instalar o app</b> de novo.')}
      </ol>
      <button class="btn plain" data-action="copy-link">${icon('copy', { size: 18 })}Copiar endereço do app</button>
    </div>`, null);
}

function genericHelp() {
  openSheet('Instalar o app', `
    <div class="menu">
      <p>O seu navegador ainda não liberou a instalação automática. Faça pelo menu dele:</p>
      <ol class="install-steps">
        ${passo(1, 'ellipsis-vertical', 'Toque no menu <b>⋮</b> do navegador.')}
        ${passo(2, 'square-plus', 'Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.')}
        ${passo(3, 'check', 'Confirme. O ícone do Miaumigo aparece na tela inicial.')}
      </ol>
      <p class="form-hint">Funciona melhor no Chrome (Android) ou no Safari (iPhone).</p>
    </div>`, null);
}

/** Aviso discreto no início para quem ainda não instalou (pode ser fechado). */
function installBanner() {
  if (!canInstall()) return '';
  try { if (localStorage.getItem(INSTALL_DISMISS_KEY)) return ''; } catch { /* ignore */ }
  return `
    <div class="banner">
      <span class="banner-ico">${icon('smartphone', { size: 22 })}</span>
      <span style="flex:1">Tenha o Miaumigo na tela inicial do celular.</span>
      <button class="btn sm" data-action="install">Instalar</button>
      <button class="icon-btn ghost" data-action="install-dismiss" aria-label="Agora não">${icon('x', { size: 18 })}</button>
    </div>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'install': installApp(); break;
    case 'install-dismiss':
      try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* ignore */ }
      render();
      break;
    case 'copy-link': {
      const url = location.origin + location.pathname;
      navigator.clipboard?.writeText(url).then(() => toast('Endereço copiado'), () => toast(url));
      break;
    }
  }
});

// quando vira app instalado (ou o modo muda), some com os botões
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', refreshInstallUI);
