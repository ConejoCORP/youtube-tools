/*
 * Placement du panneau « classement sur 10 » dans la colonne de droite.
 *
 * Le piege reproduit ici est celui de la vraie page : vidIQ pose ses badges
 * (VPH, multiplicateur) A L'INTERIEUR des cartes suggerees. Un ancrage du type
 * « le dernier enfant qui contient quelque chose de vidIQ » designe alors le
 * bloc des suggestions, et le panneau finit APRES toute la liste — invisible.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = EXT;
const COMMON = fs.readFileSync(DIR + 'common.js', 'utf8');
const CORE = fs.readFileSync(DIR + 'rank-core.js', 'utf8');
const RANK = fs.readFileSync(DIR + 'rank.js', 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, obtenu, attendu) => {
  const ok = obtenu === attendu;
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + ' = ' + JSON.stringify(obtenu) +
    (ok ? '' : '   (attendu ' + JSON.stringify(attendu) + ')'));
};

// Cartes suggerees contenant des badges vidIQ, comme sur la vraie page.
const SUGGESTIONS = Array.from({ length: 6 }, (_, i) => `
  <ytd-compact-video-renderer>
    <a href="/watch?v=vid${i}">Suggestion ${i}</a>
    <span class="vidiq-c-badge">1.1K VPH</span>
    <span class="vidiq-c-badge">2.5x</span>
  </ytd-compact-video-renderer>`).join('');

function page({ avecChips = true } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));

  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    <ytd-watch-flexy>
      <div id="primary"><div id="top-level-buttons-computed"></div></div>
      <div id="secondary"><div id="secondary-inner">

        <div id="vidiq-panel" class="vidiq-scope">Performances — vidIQ</div>
        <div class="vidiq-ask">Ask vidIQ about this video</div>

        ${avecChips ? '<ytd-feed-filter-chip-bar-renderer>Tout | Pour vous</ytd-feed-filter-chip-bar-renderer>' : ''}
        <ytd-watch-next-secondary-results-renderer>${SUGGESTIONS}</ytd-watch-next-secondary-results-renderer>

      </div></div>
    </ytd-watch-flexy>
  </body></html>`,
  { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } }
  };
  // Aucune requete ne doit partir : le pont n'a rien publie.
  let appels = 0;
  window.fetch = async () => { appels++; throw new Error('aucune requete attendue'); };

  global.window = window;
  global.document = window.document;
  global.NodeFilter = window.NodeFilter;

  window.eval(COMMON);
  window.eval(CORE);
  window.eval(RANK);
  return { window, doc: window.document, appels: () => appels };
}

(async () => {
  console.log('1. Colonne complete (vidIQ + filtres + suggestions)');
  {
    const ctx = page();
    await wait(1400);
    const col = ctx.doc.getElementById('secondary-inner');
    const card = ctx.doc.getElementById('yttools-rank-card');

    verifie('panneau pose', !!card, true);
    if (card) {
      verifie('dans la colonne de droite', card.parentElement.id, 'secondary-inner');
      verifie('juste avant la rangee de filtres',
        card.nextElementSibling && card.nextElementSibling.tagName, 'YTD-FEED-FILTER-CHIP-BAR-RENDERER');
      verifie('PAS en fin de colonne (l\'ancien bug)', col.lastElementChild === card, false);
      const apres = [...col.children].indexOf(card) <
                    [...col.children].findIndex((n) => n.tagName === 'YTD-WATCH-NEXT-SECONDARY-RESULTS-RENDERER');
      verifie('au-dessus des videos suggerees', apres, true);
      verifie('sous les panneaux vidIQ',
        [...col.children].indexOf(card) > [...col.children].findIndex((n) => /vidiq/i.test(n.className)), true);
    }
    verifie('aucune requete emise sans donnees du pont', ctx.appels(), 0);
  }

  console.log('\n2. Sans rangee de filtres : directement au-dessus des suggestions');
  {
    const ctx = page({ avecChips: false });
    await wait(1400);
    const card = ctx.doc.getElementById('yttools-rank-card');
    verifie('panneau pose', !!card, true);
    if (card) {
      verifie('juste avant les suggestions',
        card.nextElementSibling && card.nextElementSibling.tagName,
        'YTD-WATCH-NEXT-SECONDARY-RESULTS-RENDERER');
    }
  }

  console.log('\n3. Si YouTube reordonne la colonne, le panneau revient a sa place');
  {
    const ctx = page();
    await wait(1400);
    const col = ctx.doc.getElementById('secondary-inner');
    const card = ctx.doc.getElementById('yttools-rank-card');
    col.appendChild(card);                       // deplace en fin de colonne
    verifie('deplace en fin', col.lastElementChild === card, true);
    col.appendChild(ctx.doc.createElement('div'));   // reveille l'observateur
    await wait(1400);
    const apres = ctx.doc.getElementById('yttools-rank-card');
    verifie('repositionne au-dessus des suggestions',
      apres.nextElementSibling && apres.nextElementSibling.tagName, 'YTD-FEED-FILTER-CHIP-BAR-RENDERER');
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
