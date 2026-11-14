/*
 * Colonne de droite avec la VRAIE structure relevee sur la page :
 *   #secondary-inner > div#video-companion-root.vidiq-react   (panneau vidIQ)
 *                    > div#panels  (panneaux de YouTube : transcription…)
 *                    > div#related > ytd-watch-next-secondary-results-renderer
 *                                    (dont les cartes contiennent des badges vidIQ)
 *
 * Verifie : plus de scintillement, le classement au-dessus des suggestions,
 * et le « cote a cote » du resume (classement et vidIQ masques sur CETTE video
 * seulement, rendus en fermant le resume ou en changeant de video).
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = EXT;
const lire = (f) => fs.readFileSync(DIR + f, 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

function page({ vidiqAgressif = false } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const cartes = Array.from({ length: 4 }, (_, i) =>
    `<ytd-compact-video-renderer><a href="/watch?v=s${i}">Suggestion ${i}</a><span class="vidiq-c-badge">2.5x</span></ytd-compact-video-renderer>`).join('');
  const segs = [[0, 'Bonjour'], [30, 'le moteur électrique'], [60, 'la batterie lithium'], [90, 'conclusion finale']]
    .map(([s, t]) => `<div><div><span>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span></div><div>${t}</div></div>`).join('');

  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    <ytd-watch-flexy>
      <div id="primary"><video class="html5-main-video"></video>
        <ytd-watch-metadata>
          <div id="title"><h1><yt-formatted-string title="Ma vidéo">Ma vidéo</yt-formatted-string></h1></div>
          <div id="top-level-buttons-computed"><segmented-like-dislike-button-view-model>aime</segmented-like-dislike-button-view-model></div>
        </ytd-watch-metadata>
      </div>
      <div id="secondary"><div id="secondary-inner">
        <div id="video-companion-root" class="vidiq-react"><div class="vidiq-scope">Performances vidIQ</div></div>
        <div id="panels" class="vidiq-scope">
          <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript"
              visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">${segs}</ytd-engagement-panel-section-list-renderer>
        </div>
        <div id="related"><ytd-watch-next-secondary-results-renderer>${cartes}</ytd-watch-next-secondary-results-renderer></div>
      </div></div>
    </ytd-watch-flexy>
    <div id="bruit"></div>
  </body></html>`, { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  const doc = window.document;
  const v = doc.querySelector('video');
  Object.defineProperty(v, 'duration', { get: () => 600, configurable: true });
  Object.defineProperty(v, 'currentTime', { get: () => 0, set: () => {}, configurable: true });
  v.play = () => Promise.resolve();

  const reponse = { ok: true, blocks: [{ type: 'h', text: 'En bref' }, { type: 'li', text: '[0:30] Le moteur' }] };
  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: { sendMessage: () => new Promise((r) => setTimeout(() => r(reponse), 150)) }
  };
  window.navigator.clipboard = { writeText: async () => {} };
  global.window = window; global.document = doc; global.NodeFilter = window.NodeFilter;

  // Le classement a besoin de rank-core ; on lui sert un calcul deja fait.
  window.eval(lire('common.js'));
  window.__yttoolsRank = { computeRanking: async () => ({ status: 'too-early', ageHours: 3 }) };
  window.eval(lire('transcript.js'));
  window.eval(lire('summary.js'));
  window.eval(lire('rank.js'));

  // Compteur de deplacements des cartes : un scintillement, ce sont des
  // deplacements qui ne s'arretent jamais.
  const col = doc.getElementById('secondary-inner');
  let mouvements = 0;
  new window.MutationObserver((ms) => {
    for (const m of ms) for (const n of [...m.addedNodes]) if (/yttools-(rank|summary)-card/.test(n.id || '')) mouvements++;
  }).observe(col, { childList: true });

  // Un vidIQ « agressif » qui remet son panneau en tete des qu'on le deloge.
  if (vidiqAgressif) {
    new window.MutationObserver(() => {
      const vq = doc.getElementById('video-companion-root');
      if (vq && col.firstElementChild !== vq) col.prepend(vq);
    }).observe(col, { childList: true });
  }
  return { window, doc, col, mouvements: () => mouvements };
}

const clic = (ctx, el) => el.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
const ordre = (col) => [...col.children].map((n) => n.id || n.tagName.toLowerCase());

(async () => {
  console.log('1. Le classement se pose au-dessus des suggestions, pas en tete');
  {
    const ctx = page();
    await wait(1500);
    const o = ordre(ctx.col);
    verifie('juste avant #related', o.indexOf('yttools-rank-card') === o.indexOf('related') - 1, o);
    verifie('pas en tete de colonne', o[0] !== 'yttools-rank-card', o);
  }

  console.log('\n2. Plus de scintillement, meme face a un vidIQ qui reclame la tete');
  {
    const ctx = page({ vidiqAgressif: true });
    await wait(1500);
    clic(ctx, ctx.doc.getElementById('yttools-transcript-btn'));
    await wait(1600);
    // Le resume veut la tete, vidIQ aussi : avant, ils se repoussaient sans fin.
    clic(ctx, ctx.doc.getElementById('yttools-summary-btn'));
    await wait(600);
    const avant = ctx.mouvements();
    for (let i = 0; i < 25; i++) {                       // ~5 s d'activite de page
      ctx.doc.getElementById('bruit').appendChild(ctx.doc.createElement('span'));
      await wait(200);
    }
    const pendant = ctx.mouvements() - avant;
    verifie('les deplacements finissent par s’arreter', pendant <= 6, pendant);
  }

  console.log('\n3. Resumer fait place nette… sur CETTE video');
  {
    const ctx = page();
    await wait(1500);
    clic(ctx, ctx.doc.getElementById('yttools-transcript-btn'));
    await wait(1600);
    verifie('classement present avant', !!ctx.doc.getElementById('yttools-rank-card'));
    clic(ctx, ctx.doc.getElementById('yttools-summary-btn'));
    await wait(700);

    const vq = ctx.doc.getElementById('video-companion-root');
    verifie('classement retire', !ctx.doc.getElementById('yttools-rank-card'));
    verifie('panneau vidIQ masque', vq.hasAttribute('data-yttools-hidden'));
    verifie('suggestions NON masquees (malgre leurs badges vidIQ)', !ctx.doc.getElementById('related').hasAttribute('data-yttools-hidden'));
    verifie('panneaux YouTube NON masques (malgre « vidiq-scope »)', !ctx.doc.getElementById('panels').hasAttribute('data-yttools-hidden'));
    verifie('le resume est en tete, a cote de la video', ctx.col.firstElementChild.id === 'yttools-summary-card'
      || (ctx.col.firstElementChild.id === 'video-companion-root' && ctx.col.children[1].id === 'yttools-summary-card'), ordre(ctx.col));

    // Le classement ne doit pas revenir tant que le resume est ouvert.
    for (let i = 0; i < 8; i++) { ctx.doc.getElementById('bruit').appendChild(ctx.doc.createElement('i')); await wait(150); }
    verifie('le classement ne revient pas tout seul', !ctx.doc.getElementById('yttools-rank-card'));

    console.log('   … fermer le resume rend tout');
    clic(ctx, ctx.doc.querySelector('#yttools-summary-card .yttools-ai-close'));
    ctx.doc.getElementById('bruit').appendChild(ctx.doc.createElement('b'));
    await wait(1300);
    verifie('vidIQ reaffiche', !vq.hasAttribute('data-yttools-hidden'));
    verifie('classement revenu', !!ctx.doc.getElementById('yttools-rank-card'));
  }

  console.log('\n4. Une autre video retrouve son classement et vidIQ');
  {
    const ctx = page();
    await wait(1500);
    clic(ctx, ctx.doc.getElementById('yttools-transcript-btn'));
    await wait(1600);
    clic(ctx, ctx.doc.getElementById('yttools-summary-btn'));
    await wait(700);
    ctx.window.history.pushState({}, '', '/watch?v=autreVideo01');
    ctx.window.dispatchEvent(new ctx.window.Event('yt-navigate-finish'));
    await wait(1400);
    verifie('vidIQ reaffiche', !ctx.doc.getElementById('video-companion-root').hasAttribute('data-yttools-hidden'));
    verifie('classement de retour sur la nouvelle video', !!ctx.doc.getElementById('yttools-rank-card'));
    verifie('resume de l’ancienne video retire', !ctx.doc.getElementById('yttools-summary-card'));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
