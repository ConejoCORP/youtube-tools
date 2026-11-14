/*
 * Resume des commentaires sur la VRAIE page de lecture (dump fourni).
 *
 * Le chargement de la suite est modelise comme YouTube le fait : il se
 * declenche quand LA FIN DE LA LISTE arrive a l'ecran — quel que soit le geste
 * qui l'y amene. Faire defiler jusqu'a une continuation de REPONSES (repliee,
 * sans place a l'ecran) ne declenche rien.
 *
 * La version precedente de ce test declenchait le chargement sur le geste
 * exact code dans l'extension : elle ne pouvait donc pas echouer, et n'a pas
 * vu le vrai bug (page qui ne defile pas, 20 commentaires).
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = EXT;
const lire = (f) => fs.readFileSync(DIR + f, 'utf8');
const HTML = lireDump();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

const BLOCS = [
  { type: 'h', text: 'En bref' }, { type: 'p', text: 'Le public a adoré.' },
  { type: 'h', text: 'La majorité' }, { type: 'li', text: 'Veut une suite' },
  { type: 'h', text: 'Ce que les gens demandent' }, { type: 'li', text: 'Revoir le passage de 0:45' }
];

/**
 * sansContinuation : la continuation de la liste est absente au clic, et
 *   YouTube ne la (re)met qu'une fois la fin de la liste a l'ecran.
 * lenteur : delai de chargement d'un lot.
 */
function page({ sansContinuation = false, lenteur = 300 } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const dom = new JSDOM(HTML, { url: 'https://www.youtube.com/watch?v=lZGoJT4abos', runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  const doc = window.document;

  // Comme sur la vraie page : continuations de reponses (repliees) et gabarit
  // du chargement initial ([is-initial-load]) sont MASQUES ; une seule est active.
  const masquee = (c) => c.classList.contains('replies-continuation') || c.hasAttribute('is-initial-load');
  const principale = () => Array.from(doc.querySelectorAll('ytd-comments ytd-continuation-item-renderer'))
    .find((c) => !masquee(c));
  const conteneur = principale().parentElement;
  const modele = doc.querySelector('ytd-comments ytd-comment-thread-renderer');
  let reserve = null;
  if (sansContinuation) { reserve = principale(); reserve.remove(); }

  let y = 1800;
  const positions = [];
  let lots = 0;
  let enCours = false;
  Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
  Object.defineProperty(window, 'innerHeight', { get: () => 800, configurable: true });

  // YouTube : la fin de la liste est a l'ecran -> un lot arrive.
  function finALEcran() {
    if (enCours || lots >= 5) return;
    enCours = true;
    setTimeout(() => {
      lots++;
      if (reserve && !reserve.isConnected) conteneur.append(reserve);
      const ancre = principale();
      for (let k = 0; k < 20; k++) {
        const c = modele.cloneNode(true);
        c.querySelector('#content-text').textContent = `Commentaire charge ${lots}-${k}`;
        c.querySelector('#author-text').textContent = `@auteur${lots}_${k}`;
        c.querySelector('#vote-count-middle').textContent = String(10 + k);
        if (ancre) ancre.before(c); else conteneur.append(c);
      }
      if (lots >= 5 && principale()) principale().remove();   // plus rien apres
      enCours = false;
    }, lenteur);
  }

  window.scrollTo = (o) => { y = typeof o === 'object' ? o.top : o; positions.push(y); };
  window.scrollBy = (dx, dy) => { y += dy; positions.push(y); if (dy > 0) finALEcran(); };
  window.Element.prototype.scrollIntoView = function () {
    const fils = doc.querySelectorAll('ytd-comments ytd-comment-thread-renderer');
    const dernier = fils[fils.length - 1];
    // Un element masque n'a pas de place a l'ecran : y defiler ne bouge rien.
    if (this.tagName === 'YTD-CONTINUATION-ITEM-RENDERER' && masquee(this)) return;
    y += 400; positions.push(y);
    if (this === dernier || this === principale()) finALEcran();
  };

  let prompt = null;
  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: { sendMessage: (m) => { prompt = m.prompt; return new Promise((r) => setTimeout(() => r({ ok: true, blocks: BLOCS }), 150)); } }
  };
  global.window = window; global.document = doc; global.NodeFilter = window.NodeFilter;
  window.eval(lire('common.js'));
  window.eval(lire('summary.js'));
  window.eval(lire('comments.js'));
  return { window, doc, positions, lots: () => lots, prompt: () => prompt, y: () => y };
}

/** L'ANCIENNE logique de chargement, recopiee telle quelle pour comparaison. */
async function ancienneLogique(ctx) {
  const doc = ctx.doc;
  const fils = () => doc.querySelectorAll('ytd-comments ytd-comment-thread-renderer');
  let n = fils().length; let surPlace = 0;
  const fin = Date.now() + 8000;
  while (n < 100 && Date.now() < fin) {
    const suites = doc.querySelectorAll('ytd-comments ytd-continuation-item-renderer');
    const suite = suites[suites.length - 1];
    if (!suite) break;
    suite.scrollIntoView({ block: 'end' });
    await sleep(900);
    const n2 = fils().length;
    if (n2 === n) { if (++surPlace >= 4) break; } else surPlace = 0;
    n = n2;
  }
  return n;
}

const clic = (ctx, el) => el.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
async function resumer(ctx) {
  await sleep(1500);
  clic(ctx, ctx.doc.getElementById('yttools-comments-btn'));
  for (let i = 0; i < 200 && !ctx.prompt(); i++) await sleep(150);
  await sleep(400);
}

(async () => {
  console.log('1. Lecture des vrais commentaires');
  {
    const ctx = page();
    await sleep(1200);
    const coms = ctx.window.__yttoolsComments.lireCommentaires();
    verifie('20 commentaires lus', coms.length === 20, coms.length);
    verifie('auteurs lus (@…)', coms.every((c) => c.auteur.startsWith('@')));
    verifie('premier : « Please do a part 2 », 246 likes', /Please do a part 2/.test(coms[0].texte) && coms[0].likes === 246);
    verifie('aucun faux « epingle » (badges vides partout)', coms.every((c) => !c.epingle));
    verifie('total annonce lu (1 191)', ctx.window.__yttoolsComments.totalAnnonce() === 1191);
    const btn = ctx.doc.getElementById('yttools-comments-btn');
    verifie('bouton a cote de « Trier par »', btn && btn.parentElement.id === 'additional-section');
    const suite = ctx.window.__yttoolsComments.suiteDeLaListe();
    verifie('continuation de la LISTE choisie : ni reponses, ni gabarit initial',
      suite && !suite.classList.contains('replies-continuation') && !suite.hasAttribute('is-initial-load'));
  }

  console.log('\n2. La vraie page TELLE QUELLE (le bug signale)');
  {
    const ancien = page();
    await sleep(1200);
    const nAncien = await ancienneLogique(ancien);
    verifie('l’ANCIENNE logique reste bloquee a 20', nAncien === 20, nAncien);
    verifie('… et la page n’a pas defile', ancien.positions.every((y) => y === 1800), ancien.positions);

    const ctx = page();
    await resumer(ctx);
    const nPrompt = ((ctx.prompt() || '').split('Commentaires :')[1] || '').split('\n').filter((l) => /^\[\d+ like/.test(l)).length;
    verifie('la nouvelle : la page defile', Math.max(...ctx.positions) > 1800, Math.max(...ctx.positions));
    verifie('la nouvelle : une centaine de commentaires', nPrompt === 100, nPrompt);
    verifie('page remise a sa place (1800)', ctx.y() === 1800, ctx.y());
  }

  console.log('\n2 bis. Continuation active absente au clic');
  {
    const ctx = page({ sansContinuation: true });
    await resumer(ctx);
    const nPrompt = ((ctx.prompt() || '').split('Commentaires :')[1] || '').split('\n').filter((l) => /^\[\d+ like/.test(l)).length;
    verifie('le defilement de la fenetre suffit a charger', nPrompt === 100, nPrompt);
  }

  console.log('\n3. YouTube lent (1,8 s par lot)');
  {
    const ctx = page({ lenteur: 1800 });
    await resumer(ctx);
    const nPrompt = ((ctx.prompt() || '').split('Commentaires :')[1] || '').split('\n').filter((l) => /^\[\d+ like/.test(l)).length;
    verifie('une centaine malgre la lenteur', nPrompt === 100, nPrompt);
  }

  console.log('\n4. Le prompt : bref et global');
  {
    const ctx = page();
    await resumer(ctx);
    const p = ctx.prompt() || '';
    // Le commentaire le plus aime de la page relevee (246 likes, 21 reponses) ;
    // son auteur n'est pas nomme ici, le depot est public.
    const ligne = p.split('\n').find((l) => /^\[246 likes/.test(l)) || '';
    verifie('likes et reponses entre crochets', /^\[246 likes, 21 réponses\] @\S+ : Please do a part 2/.test(ligne), ligne.slice(0, 40));
    verifie('majorite / minorite / demandes', /## La majorité/.test(p) && /## Une minorité/.test(p) && /## Ce que les gens demandent/.test(p));
    verifie('lignes courtes, sans citation', /15 mots au plus, sans citation/.test(p));
    verifie('plus de section « Critiques » detaillee', !/## Critiques et désaccords/.test(p));

    const card = ctx.doc.getElementById('yttools-comments-card');
    verifie('resume affiche sous l’en-tete', card && card.dataset.state === 'ok'
      && card.previousElementSibling === ctx.doc.querySelector('ytd-comments ytd-comments-header-renderer'));
    verifie('timecode cite par le public devenu un lien', card && !!card.querySelector('a.yttools-ai-ts[data-t="45"]'));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
