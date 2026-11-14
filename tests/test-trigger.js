/*
 * Choix du bouton qui ouvre la transcription, quand une autre extension
 * (Better YouTube Studio) ajoute son propre « Copier la transcription » juste a
 * cote. Les deux libelles contiennent « transcri » : seul le verbe les separe.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = ['youtube-tools/', 'thumbnail-view/']
  .map((d) => RACINE + d)
  .find((d) => fs.existsSync(d + 'common.js'));
const COMMON = fs.readFileSync(DIR + 'common.js', 'utf8');
const TRANSCRIPT = fs.readFileSync(DIR + 'transcript.js', 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
function verifie(nom, obtenu, attendu) {
  const ok = obtenu === attendu;
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + ' = ' + JSON.stringify(obtenu) +
    (ok ? '' : '   (attendu ' + JSON.stringify(attendu) + ')'));
}

const SEGMENTS = [
  ['0:00', 'Premiere phrase'],
  ['0:05', 'Deuxieme phrase'],
  ['0:11', 'Troisieme phrase']
].map(([t, x]) => `<div><div><span>${t}</span></div><div>${x}</div></div>`).join('');

/**
 * natifMarche : le bouton YouTube ouvre-t-il vraiment le panneau ?
 * secondChance : un second bouton « afficher » qui, lui, fonctionne.
 */
function page({ natifMarche = true, secondChance = false } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));

  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    <ytd-watch-metadata>
      <div id="title"><h1><yt-formatted-string title="Ma vidéo">Ma vidéo</yt-formatted-string></h1></div>
      <div id="top-level-buttons-computed"><segmented-like-dislike-button-view-model>aime</segmented-like-dislike-button-view-model></div>
      <div id="owner"><ytd-channel-name id="channel-name"><div id="text"><a href="/@C">C</a></div></ytd-channel-name></div>
      <ytd-watch-info-text><div id="info"><span>1 234 vues</span><span>il y a 2 jours</span></div></ytd-watch-info-text>
    </ytd-watch-metadata>
    <span class="ytp-time-duration">10:00</span>

    <div id="structured-description">
      <ytd-video-description-transcript-section-renderer>
        <ytd-button-renderer><yt-button-shape>
          <button id="natif" aria-label="Afficher la transcription">Afficher la transcription</button>
        </yt-button-shape></ytd-button-renderer>
        ${secondChance ? `<ytd-button-renderer><yt-button-shape>
          <button id="natif2" aria-label="Voir la transcription">Voir la transcription</button>
        </yt-button-shape></ytd-button-renderer>` : ''}
        <!-- injecte par Better YouTube Studio, APRES le bouton natif -->
        <button id="tiers" class="bys-copy">Copier la transcription</button>
      </ytd-video-description-transcript-section-renderer>
    </div>

    <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript"
        visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN">
      <yt-icon-button id="visibility-button"><button>x</button></yt-icon-button>
      <div id="tr-content"></div>
    </ytd-engagement-panel-section-list-renderer>
    <div id="menu-tiers" hidden></div>
  </body></html>`,
  { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  const doc = window.document;
  const journal = [];

  const ouvrePanneau = () => {
    const p = doc.querySelector('[target-id="engagement-panel-searchable-transcript"]');
    p.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    doc.getElementById('tr-content').innerHTML = SEGMENTS;
  };

  doc.getElementById('natif').addEventListener('click', () => {
    journal.push('natif');
    if (natifMarche) ouvrePanneau();
  });
  if (secondChance) {
    doc.getElementById('natif2').addEventListener('click', () => {
      journal.push('natif2');
      ouvrePanneau();
    });
  }
  // Le bouton de l'autre extension n'ouvre pas le panneau : il deroule un menu.
  doc.getElementById('tiers').addEventListener('click', () => {
    journal.push('TIERS');
    doc.getElementById('menu-tiers').hidden = false;
  });

  let copie = null;
  window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } };
  window.navigator.clipboard = { writeText: async (t) => { copie = t; } };
  global.window = window;
  global.document = doc;
  global.NodeFilter = window.NodeFilter;

  window.eval(COMMON);
  window.eval(TRANSCRIPT);
  return { window, doc, journal, lire: () => copie };
}

async function clique(ctx, patience = 3000) {
  await wait(900);
  ctx.doc.getElementById('yttools-transcript-btn')
     .dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  await wait(patience);
}

(async () => {
  console.log('1. Les deux boutons cote a cote (le cas signale)');
  {
    const ctx = page();
    await clique(ctx);
    verifie('bouton natif clique', ctx.journal.includes('natif'), true);
    verifie('bouton de l\'autre extension JAMAIS clique', ctx.journal.includes('TIERS'), false);
    verifie('menu de l\'autre extension reste ferme',
      ctx.doc.getElementById('menu-tiers').hidden, true);
    const lignes = (ctx.lire() || '').split('\r\n');
    verifie('3 lignes de transcription', lignes.length - 1, 3);
  }

  console.log('\n2. Si le premier candidat n\'ouvre rien, on essaie le suivant');
  {
    const ctx = page({ natifMarche: false, secondChance: true });
    await clique(ctx, 12000);   // 6 s pour le 1er candidat, puis 2,5 s pour le 2e
    verifie('premier essaye', ctx.journal.includes('natif'), true);
    verifie('second essaye', ctx.journal.includes('natif2'), true);
    verifie('toujours pas l\'autre extension', ctx.journal.includes('TIERS'), false);
    const lignes = (ctx.lire() || '').split('\r\n');
    verifie('transcription recuperee quand meme', lignes.length - 1, 3);
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
