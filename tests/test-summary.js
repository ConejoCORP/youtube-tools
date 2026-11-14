/*
 * Resume Gemini, cote YouTube : bouton, prompt, panneau, timecodes cliquables,
 * suivi de la lecture et disparition au changement de video.
 * Le service worker est simule : on verifie ce que la page lui envoie et ce
 * qu'elle fait de sa reponse.
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

const SEGMENTS = [
  [0, 'Salut à tous'], [6, 'aujourd’hui on teste'], [14, 'un nouveau jeu'], [23, 'de construction'],
  [31, 'les règles sont simples'], [44, 'premier niveau'], [58, 'ça se complique'], [72, 'la conclusion']
];
const fmtTs = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

// Reponse au nouveau format : « En bref », puis des chapitres dont chaque
// titre et chaque point se termine par son timecode de reference.
const REPONSE = [
  { type: 'h', level: 2, text: 'En bref' },
  { type: 'p', text: 'Une vidéo de test sur un jeu de construction.' },
  { type: 'h', level: 2, text: 'Chapitres' },
  { type: 'h', level: 3, text: 'Présentation du jeu [0:00]' },
  { type: 'li', depth: 0, text: 'On découvre un nouveau jeu de construction [0:14]' },
  { type: 'h', level: 3, text: 'Les règles [0:31]' },
  { type: 'li', depth: 0, text: 'Les règles sont simples [0:31]' },
  { type: 'li', depth: 0, text: 'Une heure fausse qui dépasse la vidéo [23:59]' },
  { type: 'h', level: 3, text: 'La difficulté monte [0:58]' },
  { type: 'li', depth: 0, text: 'Ça se complique dès le premier niveau' },
  { type: 'h', level: 2, text: 'À retenir' },
  { type: 'p', text: 'Le jeu devient dur vers 1:12.' }
];

function page({ reponse = { ok: true, blocks: REPONSE }, delai = 200, chapitres = null } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const segs = SEGMENTS.map(([s, t]) => `<div><div><span>${fmtTs(s)}</span></div><div>${t}</div></div>`).join('');

  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    <ytd-watch-flexy>
      <div id="primary">
        <video class="html5-main-video"></video>
        <ytd-watch-metadata>
          <div id="title"><h1><yt-formatted-string title="Ma vidéo de test">Ma vidéo de test</yt-formatted-string></h1></div>
          <div id="top-level-buttons-computed">
            <segmented-like-dislike-button-view-model>aime</segmented-like-dislike-button-view-model>
            <ytd-menu-renderer id="plus">...</ytd-menu-renderer>
          </div>
          <div id="owner"><ytd-channel-name id="channel-name"><div id="text"><a href="/@C">Ma Chaîne</a></div></ytd-channel-name></div>
          <ytd-watch-info-text><div id="info"><span>1 234 vues</span><span>il y a 2 jours</span></div></ytd-watch-info-text>
        </ytd-watch-metadata>
      </div>
      <div id="secondary"><div id="secondary-inner">
        <div id="vidiq-panel">vidIQ</div>
        <ytd-watch-next-secondary-results-renderer>suggestions</ytd-watch-next-secondary-results-renderer>
      </div></div>
    </ytd-watch-flexy>
    <span class="ytp-time-duration">10:00</span>
    <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript"
        visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">${segs}</ytd-engagement-panel-section-list-renderer>
    <div id="bruit"></div>
  </body></html>`, { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  const doc = window.document;
  const envois = [];

  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: {
      sendMessage: (msg) => { envois.push(msg); return new Promise((r) => setTimeout(() => r(reponse), delai)); }
    }
  };
  window.navigator.clipboard = { writeText: async () => {} };

  const v = doc.querySelector('video');
  let cur = 0;
  Object.defineProperty(v, 'currentTime', { get: () => cur, set: (x) => { cur = x; }, configurable: true });
  Object.defineProperty(v, 'duration', { get: () => 600, configurable: true });
  v.play = () => Promise.resolve();

  // Les chapitres de la page, tels que rank-bridge.js les publie.
  if (chapitres) {
    doc.documentElement.setAttribute('data-yttools-rank-src',
      JSON.stringify({ id: 'abc123XYZ_1', channel: '', tags: [], chapitres }));
  }

  global.window = window; global.document = doc; global.NodeFilter = window.NodeFilter;
  window.eval(lire('common.js'));
  window.eval(lire('transcript.js'));
  window.eval(lire('summary.js'));
  return { window, doc, envois, video: v, temps: () => cur };
}

const clic = (ctx, el) => el.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));

(async () => {
  console.log('1. Le bouton n’apparait qu’apres la copie');
  const ctx = page();
  await wait(1100);
  verifie('absent avant la copie', !ctx.doc.getElementById('yttools-summary-btn'));
  clic(ctx, ctx.doc.getElementById('yttools-transcript-btn'));
  await wait(1800);
  const btn = ctx.doc.getElementById('yttools-summary-btn');
  verifie('present apres la copie', !!btn);
  verifie('juste a droite du ☰',
    btn && btn.previousElementSibling && btn.previousElementSibling.id === 'yttools-transcript-btn');

  console.log('\n2. Le prompt envoye');
  clic(ctx, btn);
  await wait(60);
  const p = ctx.envois[0] && ctx.envois[0].prompt;
  verifie('message YTTOOLS_SUMMARIZE envoye', ctx.envois[0] && ctx.envois[0].type === 'YTTOOLS_SUMMARIZE');
  verifie('titre de la video', /Titre : Ma vidéo de test/.test(p));
  verifie('chaine', /Chaîne : Ma Chaîne/.test(p));
  verifie('« En bref » puis des chapitres', /## En bref/.test(p) && /## Chapitres/.test(p) && /^### /m.test(p));
  verifie('plus de liste de moments (« Déroulé »)', !/## Déroulé/.test(p));
  verifie('nombre de chapitres adapte a la duree (10 min -> 4)', /en 4 chapitres environ/.test(p),
    (p.match(/Découpe[^.]*\./) || [])[0]);
  verifie('modele : titre puis points, le timecode EN FIN de ligne',
    /^### .*\[0:00\]$/m.test(p) && /^- .*\[0:12\]$/m.test(p) && !/^- \[/m.test(p));
  verifie('le timecode presente comme une simple reference', /n’est qu’une référence/.test(p));
  verifie('rappel apres la transcription : chapitres, reference en fin de ligne',
    p.lastIndexOf('RAPPEL') > p.indexOf('Transcription :') &&
    /par chapitres/.test(p.slice(p.lastIndexOf('RAPPEL'))) && /timecode de référence/.test(p.slice(p.lastIndexOf('RAPPEL'))));
  verifie('transcription regroupee par tranches (moins de lignes que de segments)',
    (p.split('Transcription :')[1] || '').trim().split('\n').length < SEGMENTS.length,
    (p.split('Transcription :')[1] || '').trim().split('\n'));
  verifie('pas l’en-tete CSV', !/titre,chaine,debut/.test(p));

  console.log('\n3. Le panneau');
  const col = ctx.doc.getElementById('secondary-inner');
  let card = ctx.doc.getElementById('yttools-summary-card');
  verifie('en tete de la colonne de droite', card && col.firstElementChild === card);
  verifie('etat « en cours » pendant que Gemini redige', card && card.dataset.state === 'loading');
  verifie('bouton « Gemini redige… » desactive', btn.disabled && /rédige/.test(btn.textContent));
  await wait(500);
  card = ctx.doc.getElementById('yttools-summary-card');
  verifie('etat « ok » une fois la reponse arrivee', card && card.dataset.state === 'ok');
  verifie('« En bref » en tete', (card.querySelector('.yttools-sm-bref') || {}).textContent === 'Une vidéo de test sur un jeu de construction.');
  const chaps = [...card.querySelectorAll('li.yttools-sm-chap')];
  const titres = chaps.map((c) => c.querySelector('.yttools-sm-titre').textContent);
  verifie('trois chapitres, titres sans timecode', JSON.stringify(titres) === JSON.stringify(['Présentation du jeu', 'Les règles', 'La difficulté monte']), titres);
  verifie('chapitres numerotes', chaps.map((c) => c.querySelector('.yttools-sm-num').textContent).join('') === '123');
  const point = chaps[1] && chaps[1].querySelector('.yttools-sm-points li');
  verifie('le point se lit sans son timecode, la reference vient apres',
    point && point.firstChild.textContent === 'Les règles sont simples' && point.lastChild.classList.contains('yttools-ai-ref'),
    point && point.textContent);
  const refs = [...card.querySelectorAll('a.yttools-ai-ref')].map((a) => a.textContent);
  verifie('references : chapitres et points', JSON.stringify(refs) === JSON.stringify(['0:00', '0:14', '0:31', '0:31', '0:58', '0:44']), refs);
  const fausse = chaps[1] && chaps[1].querySelectorAll('.yttools-sm-points li')[1];
  verifie('« 23:59 » au-dela de la fin : pas de reference', !refs.includes('23:59') && fausse && !fausse.querySelector('a'),
    fausse && fausse.textContent);
  const estimee = [...card.querySelectorAll('a.yttools-ai-ref.is-estimated')].map((a) => a.textContent);
  verifie('point sans timecode : reference retrouvee dans la transcription, marquee', JSON.stringify(estimee) === '["0:44"]', estimee);
  verifie('« À retenir » garde en plus, sous les chapitres', [...card.querySelectorAll('h3')].some((h) => h.textContent === 'À retenir')
    && !!card.querySelector('a.yttools-ai-ts[data-t="72"]'));
  verifie('aucun HTML de Gemini injecte', !card.querySelector('script, img'));

  console.log('\n4. Cliquer une reference ou un titre de chapitre deplace la lecture');
  clic(ctx, [...card.querySelectorAll('a.yttools-ai-ref')].find((a) => a.textContent === '0:14'));
  verifie('reference : video amenee a 14 s', ctx.temps() === 14, ctx.temps());
  clic(ctx, chaps[2].querySelector('.yttools-sm-titre'));
  verifie('titre du chapitre : video amenee a son debut (58 s)', ctx.temps() === 58, ctx.temps());

  console.log('\n5. Le chapitre en cours est surligne pendant la lecture');
  ctx.video.currentTime = 40;
  ctx.video.dispatchEvent(new ctx.window.Event('timeupdate'));
  let actif = card.querySelector('li.is-active');
  verifie('a 0:40, « Les règles » (0:31) est actif', actif && /Les règles/.test(actif.textContent), actif && actif.textContent);
  ctx.video.currentTime = 62;
  ctx.video.dispatchEvent(new ctx.window.Event('timeupdate'));
  actif = card.querySelector('li.is-active');
  verifie('a 1:02, « La difficulté monte » (0:58) est actif', actif && /La difficulté/.test(actif.textContent), actif && actif.textContent);
  verifie('un seul chapitre actif', card.querySelectorAll('li.is-active').length === 1);

  console.log('\n6. Rouvrir ne redemande rien a Gemini');
  clic(ctx, card.querySelector('.yttools-ai-close'));
  verifie('panneau ferme', !ctx.doc.getElementById('yttools-summary-card'));
  clic(ctx, ctx.doc.getElementById('yttools-summary-btn'));
  await wait(50);
  verifie('panneau rouvert depuis le cache', !!ctx.doc.getElementById('yttools-summary-card'));
  verifie('toujours un seul envoi a Gemini', ctx.envois.length === 1, ctx.envois.length);

  console.log('\n7. Changer de video retire bouton et panneau');
  ctx.window.history.pushState({}, '', '/watch?v=autreVideo01');
  ctx.doc.getElementById('bruit').appendChild(ctx.doc.createElement('span'));
  await wait(1200);
  verifie('bouton retire', !ctx.doc.getElementById('yttools-summary-btn'));
  verifie('panneau retire', !ctx.doc.getElementById('yttools-summary-card'));

  console.log('\n8. Connexion Gemini demandee');
  {
    const c2 = page({ reponse: { ok: false, error: 'login' } });
    await wait(1100);
    clic(c2, c2.doc.getElementById('yttools-transcript-btn'));
    await wait(1800);
    clic(c2, c2.doc.getElementById('yttools-summary-btn'));
    await wait(500);
    const c = c2.doc.getElementById('yttools-summary-card');
    verifie('message clair', c && /connexion/i.test(c.textContent), c && c.textContent);
    verifie('bouton Reessayer', c && !!c.querySelector('.yttools-ai-retry'));
  }

  console.log('\n9. Reponse a l’ancien format : affichee telle quelle, le surlignage suit la frise');
  {
    const c3 = page({ reponse: { ok: true, blocks: [
      { type: 'h', text: 'Déroulé' },
      { type: 'li', text: '[0:00] Début' },
      { type: 'li', text: '[0:30] Milieu' },
      { type: 'li', text: '[0:58] Fin' },
      { type: 'h', text: 'À retenir' },
      { type: 'li', text: '[0:10] Idée clé dite tôt' }
    ] } });
    await wait(1100);
    clic(c3, c3.doc.getElementById('yttools-transcript-btn'));
    await wait(1800);
    clic(c3, c3.doc.getElementById('yttools-summary-btn'));
    await wait(500);
    c3.video.currentTime = 40;
    c3.video.dispatchEvent(new c3.window.Event('timeupdate'));
    const actif = c3.doc.querySelector('#yttools-summary-card li.is-active');
    verifie('a 0:40, « Milieu » (0:30) est actif', actif && /Milieu/.test(actif.textContent), actif && actif.textContent);
    verifie('pas la ligne de « À retenir » placee plus bas', !(actif && /Idée clé/.test(actif.textContent)));
  }

  console.log('\n10. La video a deja des chapitres : Gemini suit ce decoupage');
  {
    const c4 = page({ chapitres: { source: 'createur', liste: [{ t: 0, titre: 'Intro' }, { t: 31, titre: 'Les règles du jeu' }, { t: 58, titre: 'Niveaux' }] } });
    await wait(1100);
    clic(c4, c4.doc.getElementById('yttools-transcript-btn'));
    await wait(1800);
    clic(c4, c4.doc.getElementById('yttools-summary-btn'));
    await wait(60);
    const p4 = (c4.envois[0] && c4.envois[0].prompt) || '';
    verifie('decoupage du createur annonce', /déjà découpée en chapitres \(par son créateur\)/.test(p4));
    verifie('ses chapitres recopies avec leur debut', /^\[0:31\] Les règles du jeu$/m.test(p4) && /^\[0:58\] Niveaux$/m.test(p4));
    verifie('pas de nombre de chapitres impose', !/Découpe la vidéo en/.test(p4));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
