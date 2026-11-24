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

// Reponse au nouveau format : les deux pourcentages, puis ce que dit chaque camp.
const BLOCS = [
  { type: 'h', level: 2, text: 'Avis' }, { type: 'p', text: 'Positifs : 80 %' }, { type: 'p', text: 'Négatifs : 20 %' },
  { type: 'h', level: 2, text: 'Ce qui plaît' }, { type: 'li', text: 'Le concept, jugé très drôle' }, { type: 'li', text: 'La complicité du duo' },
  { type: 'h', level: 2, text: 'Ce qui déplaît' }, { type: 'li', text: 'Une scène jugée trop longue' },
  { type: 'h', level: 2, text: 'Ce que les gens demandent' }, { type: 'li', text: 'Revoir le passage de 0:45' }
];

// Reponse de Gemini a une question sur les commentaires.
// Une phrase, un point avec son sujet en gras, un commentaire cite (> @pseudo : « … »).
const REPONSE_QR = [
  { type: 'p', text: 'C’est @un_internaute : il trouve que « du coup » revient trop souvent.' },
  { type: 'li', text: 'Le titre : le verbe devrait être au pluriel.', gras: ['Le titre'] },
  { type: 'p', cite: true, text: '@auteur1_3 : « Commentaire charge 1-3 »' }
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
  const prompts = [];
  const stock = {};
  window.chrome = {
    storage: { local: {
      get: async (k) => (k in stock ? { [k]: stock[k] } : {}),
      set: async (o) => { Object.assign(stock, o); }
    }, onChanged: { addListener: () => {} } },
    runtime: { sendMessage: (m) => {
      prompt = m.prompt;
      prompts.push(m.prompt);
      const blocks = /\nNouvelle question : /.test(m.prompt) ? REPONSE_QR : BLOCS;
      return new Promise((r) => setTimeout(() => r({ ok: true, blocks }), 150));
    } }
  };
  global.window = window; global.document = doc; global.NodeFilter = window.NodeFilter;
  window.eval(lire('common.js'));
  window.eval(lire('summary.js'));
  window.eval(lire('comments.js'));
  return { window, doc, positions, lots: () => lots, prompt: () => prompt, prompts, stock, y: () => y };
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
    verifie('bouton a cote de « Trier par »', btn && btn.parentElement.id === 'yttools-comments-groupe'
      && btn.parentElement.parentElement.id === 'additional-section');
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

  console.log('\n4. Le prompt : avis positifs / negatifs, puis des points courts');
  {
    const ctx = page();
    await resumer(ctx);
    const p = ctx.prompt() || '';
    // Le commentaire le plus aime de la page relevee (246 likes, 21 reponses) ;
    // son auteur n'est pas nomme ici, le depot est public.
    const ligne = p.split('\n').find((l) => /^\[246 likes/.test(l)) || '';
    verifie('likes et reponses entre crochets', /^\[246 likes, 21 réponses\] @\S+ : Please do a part 2/.test(ligne), ligne.slice(0, 40));
    verifie('classement positif / negatif / neutre demande', /positif \(/.test(p) && /négatif \(/.test(p) && /neutre \(/.test(p));
    verifie('les deux pourcentages demandes', /## Avis\nPositifs : \(nombre\) %\nNégatifs : \(nombre\) %/.test(p));
    verifie('ce qui plait / deplait / demandes', /## Ce qui plaît/.test(p) && /## Ce qui déplaît/.test(p) && /## Ce que les gens demandent/.test(p));
    verifie('points courts, sans citation', /12 mots au plus, sans citation/.test(p));
    verifie('plus de majorite / minorite en paragraphes', !/## La majorité/.test(p) && !/## Une minorité/.test(p));

    const card = ctx.doc.getElementById('yttools-comments-card');
    verifie('resume affiche sous l’en-tete', card && card.dataset.state === 'ok'
      && card.previousElementSibling === ctx.doc.querySelector('ytd-comments ytd-comments-header-renderer'));

    console.log('\n5. L’affichage : jauge verte et rouge, puis chaque camp en points');
    const texte = (sel) => ((card && card.querySelector(sel)) || {}).textContent || '';
    verifie('legende de la jauge', texte('.yttools-cm-pos') === '80 % positifs' && texte('.yttools-cm-neg') === '20 % négatifs',
      [texte('.yttools-cm-pos'), texte('.yttools-cm-neg')]);
    const vert = card && card.querySelector('.yttools-cm-barre-pos');
    const rouge = card && card.querySelector('.yttools-cm-barre-neg');
    verifie('barre : 80 % de vert, 20 % de rouge', vert && rouge && vert.style.width === '80%' && rouge.style.width === '20%');
    verifie('jauge lisible par un lecteur d’ecran', card && /80 % d’avis positifs, 20 % d’avis négatifs/.test(card.querySelector('.yttools-cm-jauge').getAttribute('aria-label')));
    const blocs = card ? [...card.querySelectorAll('.yttools-cm-bloc')] : [];
    verifie('trois parties, dans l’ordre', blocs.map((b) => b.className.replace('yttools-cm-bloc ', '')).join(',') === 'is-pos,is-neg,is-ask',
      blocs.map((b) => b.className));
    verifie('ce qui plait : 2 points', blocs[0] && blocs[0].querySelectorAll('li').length === 2);
    verifie('ce qui deplait : 1 point', blocs[1] && blocs[1].querySelectorAll('li').length === 1);
    verifie('timecode cite par le public devenu un lien', card && !!card.querySelector('.is-ask a.yttools-ai-ts[data-t="45"]'));
  }

  const lignesDuPrompt = (p) => ((p || '').split('Commentaires :')[1] || '').split('\n').filter((l) => /^\[\d+ like/.test(l)).length;

  console.log('\n6. La fleche : choisir combien de commentaires analyser');
  const ctx = page();
  {
    await sleep(1200);
    const btn = ctx.doc.getElementById('yttools-comments-btn');
    const fleche = ctx.doc.querySelector('#yttools-comments-groupe .yttools-cm-fleche');
    verifie('une fleche juste a droite du bouton', !!fleche && fleche.previousElementSibling === btn);
    verifie('le bouton annonce la quantite', /Résumer 100 commentaires/.test(btn.textContent), btn.textContent);
    clic(ctx, fleche);
    let menu = ctx.doc.getElementById('yttools-cm-menu');
    verifie('menu ouvert sous la fleche', !!menu && fleche.getAttribute('aria-expanded') === 'true');
    const options = menu ? [...menu.querySelectorAll('.yttools-cm-option')] : [];
    verifie('choix : 50, 100, 200, 300, 500', options.map((o) => o.dataset.quantite).join(',') === '50,100,200,300,500');
    verifie('100 coche, et recommande', options[1] && options[1].getAttribute('aria-checked') === 'true' && /recommandé/.test(options[1].textContent));
    verifie('mise en garde sous les choix', menu && /YouTube peut limiter ton compte/.test(menu.querySelector('.yttools-cm-note').textContent));
    verifie('pas de « Refaire » avant un premier resume', menu && !menu.querySelector('.yttools-cm-refaire'));
    clic(ctx, options[0]);
    await sleep(50);
    verifie('choisir 50 ferme le menu', !ctx.doc.getElementById('yttools-cm-menu'));
    verifie('le choix est retenu', ctx.stock.yttoolsCommentsQuantite === 50, ctx.stock);
    verifie('le bouton suit', /Résumer 50 commentaires/.test(btn.textContent), btn.textContent);
    clic(ctx, fleche);
    ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    verifie('Echap ferme le menu', !ctx.doc.getElementById('yttools-cm-menu'));

    await resumer(ctx);
    verifie('50 commentaires envoyes a Gemini', lignesDuPrompt(ctx.prompt()) === 50, lignesDuPrompt(ctx.prompt()));
  }

  console.log('\n7. Une fois le resume fait : « Demander plus d’infos »');
  {
    const btn = ctx.doc.getElementById('yttools-comments-btn');
    const card = () => ctx.doc.getElementById('yttools-comments-card');
    verifie('le bouton devient « Demander plus d’infos »', /Demander plus d’infos/.test(btn.textContent), btn.textContent);
    const visibleDesLeResume = card() && card().querySelector('.yttools-cm-saisie');
    verifie('le champ de question est la des le resume, sans rien cliquer', visibleDesLeResume && !visibleDesLeResume.hidden);
    verifie('… sans prendre la main du clavier', ctx.doc.activeElement !== (visibleDesLeResume && visibleDesLeResume.querySelector('.yttools-cm-champ')));
    clic(ctx, btn);
    await sleep(50);
    const saisie = card() && card().querySelector('.yttools-cm-saisie');
    const champ = saisie && saisie.querySelector('.yttools-cm-champ');
    verifie('un champ de question apparait, pret a taper', saisie && !saisie.hidden && ctx.doc.activeElement === champ);

    let fuite = 0;
    ctx.doc.addEventListener('keydown', () => { fuite++; });
    champ.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    verifie('la frappe ne declenche pas les raccourcis de YouTube', fuite === 0, fuite);

    const avant = ctx.prompts.length;
    champ.value = 'C’est qui, et de quoi il parle ?';
    champ.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    verifie('Entree envoie, le bouton patiente', /Gemini répond/.test(btn.textContent) && champ.disabled, btn.textContent);
    await sleep(400);
    const q1 = ctx.prompts[avant] || '';
    verifie('une demande a Gemini', ctx.prompts.length === avant + 1);
    verifie('… avec TOUS les commentaires gardes', (q1.match(/^\[\d+ like/gm) || []).length === 50);
    verifie('… et le resume deja fait', /Ton résumé :/.test(q1) && /Ce qui déplaît :\n- Une scène jugée trop longue/.test(q1));
    verifie('… et la question, a la fin', /\nNouvelle question : C’est qui, et de quoi il parle \?\n/.test(q1) && !/Questions déjà posées/.test(q1));
    verifie('format de conversation demande : sujets en gras, citations « > @pseudo : … »',
      /\n> @pseudo : « ses mots exacts »\n/.test(q1) && /\*\*Le titre\*\*/.test(q1) && /Pas de tableau/.test(q1));
    const questions = () => [...card().querySelectorAll('.yttools-cm-q')].map((q) => q.textContent);
    verifie('question et reponse affichees sous le resume', questions().join('|') === 'C’est qui, et de quoi il parle ?'
      && /du coup » revient trop souvent/.test(card().querySelector('.yttools-cm-r').textContent));
    verifie('le champ se libere', !champ.disabled && champ.value === '');

    console.log('\n7 bis. La reponse, facon Gemini');
    const r = card().querySelector('.yttools-cm-r');
    verifie('l’etoile de Gemini a gauche de la reponse', r && r.firstElementChild.className === 'yttools-cm-etoile' && !!r.querySelector('svg'));
    verifie('le sujet du point en gras', r && r.querySelector('li strong') && r.querySelector('li strong').textContent === 'Le titre');
    const carte = r && r.querySelector('.yttools-cm-com');
    verifie('commentaire cite affiche comme un commentaire', !!carte
      && carte.querySelector('.yttools-cm-pseudo').textContent === '@auteur1_3'
      && carte.querySelector('.yttools-cm-likes').textContent === '13 likes'
      && carte.querySelector('.yttools-cm-com-texte').textContent === 'Commentaire charge 1-3'
      && carte.querySelector('.yttools-cm-av').textContent === 'A', carte && carte.textContent);
    verifie('@pseudo dans le texte : cliquable', r && [...r.querySelectorAll('p > .yttools-cm-pseudo')].some((b) => b.textContent === '@un_internaute'));
    clic(ctx, carte.querySelector('.yttools-cm-pseudo'));
    const vise = [...ctx.doc.querySelectorAll('ytd-comment-thread-renderer')].find((f) => f.classList.contains('yttools-cm-vise'));
    verifie('clic sur le pseudo : son commentaire est montre dans la page',
      vise && vise.querySelector('#author-text').textContent === '@auteur1_3');
    verifie('bouton pour copier la reponse', r && !!r.querySelector('.yttools-cm-copier[aria-label="Copier la réponse"]'));
    verifie('champ en pilule, envoi par une fleche', !!saisie.querySelector('.yttools-cm-ligne .yttools-cm-envoyer svg')
      && /Demande à Gemini/.test(champ.placeholder) && !saisie.querySelector('.yttools-cm-aide'));

    const C = ctx.window.__yttoolsComments;
    const essai = (blocks, coms) => { const el = ctx.doc.createElement('div'); C.rendreReponse(el, blocks, { coms }); return el; };
    const invente = essai([{ type: 'p', cite: true, text: '@margot : « une phrase que personne n’a écrite »' }],
      [{ auteur: '@margot', texte: 'Le vrai commentaire de Margot', likes: 2 }]);
    verifie('citation introuvable dans le vrai commentaire : le vrai texte s’affiche',
      invente.querySelector('.yttools-cm-com-texte').textContent === 'Le vrai commentaire de Margot');
    const inconnu = essai([{ type: 'p', text: '@personne : « un avis »' }], []);
    verifie('auteur inconnu : sa citation, sans likes inventes',
      inconnu.querySelector('.yttools-cm-com-texte') && inconnu.querySelector('.yttools-cm-com-texte').textContent === 'un avis'
      && !inconnu.querySelector('.yttools-cm-likes'));
    const piege = essai([{ type: 'p', text: '<img src=x onerror=alert(1)> **gras** @x', gras: ['<img src=x onerror=alert(1)>'] }], []);
    verifie('rien de Gemini n’est interprete comme du HTML', !piege.querySelector('img') && /<img src=x/.test(piege.textContent));
    verifie('adresse e-mail : pas prise pour un pseudo', !essai([{ type: 'p', text: 'ecris a moi@exemple.fr' }], []).querySelector('.yttools-cm-pseudo'));

    champ.value = 'Il y en a d’autres qui disent pareil ?';
    clic(ctx, saisie.querySelector('.yttools-cm-envoyer'));
    await sleep(400);
    const q2 = ctx.prompts[ctx.prompts.length - 1] || '';
    verifie('question suivante : la precedente et sa reponse sont rappelees',
      /Questions déjà posées :\nQuestion : C’est qui, et de quoi il parle \?\nTa réponse :\nC’est @un_internaute/.test(q2));

    clic(ctx, card().querySelector('.yttools-ai-close'));
    await sleep(50);
    verifie('croix : le panneau se ferme', !card());
    verifie('… mais le bouton propose toujours « Demander plus d’infos »', /Demander plus d’infos/.test(btn.textContent));
    const envois = ctx.prompts.length;
    clic(ctx, btn);
    await sleep(50);
    verifie('rouvert avec tout le fil, sans rien redemander', card() && questions().length === 2 && ctx.prompts.length === envois, questions());
  }

  console.log('\n8. Refaire le resume avec une autre quantite');
  {
    const fleche = ctx.doc.querySelector('#yttools-comments-groupe .yttools-cm-fleche');
    clic(ctx, fleche);
    const menu = ctx.doc.getElementById('yttools-cm-menu');
    verifie('« Refaire » propose une fois le resume fait', menu && /Refaire le résumé avec 50 commentaires/.test(menu.textContent));
    clic(ctx, menu.querySelector('.yttools-cm-option[data-quantite="100"]'));
    await sleep(50);
    const m2 = ctx.doc.getElementById('yttools-cm-menu');
    verifie('le menu reste ouvert, « Refaire » suit le choix', m2 && /Refaire le résumé avec 100 commentaires/.test(m2.textContent));
    const avant = ctx.prompts.length;
    clic(ctx, m2.querySelector('.yttools-cm-refaire'));
    await sleep(100);
    const pendant = ctx.doc.querySelector('#yttools-comments-card .yttools-cm-saisie');
    verifie('pendant le nouveau resume, pas de champ de question', !pendant || pendant.hidden);
    for (let i = 0; i < 200 && ctx.prompts.length === avant; i++) await sleep(150);
    await sleep(400);
    verifie('nouveau resume sur 100 commentaires', lignesDuPrompt(ctx.prompts[avant]) === 100, lignesDuPrompt(ctx.prompts[avant]));
    const c = ctx.doc.getElementById('yttools-comments-card');
    verifie('les questions de l’ancien resume sont effacees', c && c.querySelectorAll('.yttools-cm-q').length === 0);
    verifie('le champ revient avec le nouveau resume', c && !c.querySelector('.yttools-cm-saisie').hidden);
  }

  console.log('\n9. Pendant la recuperation : page floutee, message au centre');
  {
    const p = page({ lenteur: 700 });
    await sleep(1200);
    clic(p, p.doc.getElementById('yttools-comments-btn'));
    await sleep(100);
    const voile = () => p.doc.getElementById('yttools-cm-voile');
    const v = voile();
    verifie('voile pose sur toute la page', v && v.parentElement === p.doc.body && v.getAttribute('aria-modal') === 'true');
    verifie('message au centre', v && v.querySelector('.yttools-cm-voile-titre').textContent === 'Récupération des commentaires en cours');
    verifie('progression affichee', v && /^\d+ \/ 100 commentaires$/.test(v.querySelector('.yttools-cm-voile-compte').textContent),
      v && v.querySelector('.yttools-cm-voile-compte').textContent);
    verifie('pas de texte d’explication en plus', v && v.querySelectorAll('p').length === 2);
    verifie('« Annuler » a la main', v && p.doc.activeElement === v.querySelector('.yttools-cm-voile-annuler'));

    let fuite = 0;
    p.doc.addEventListener('keydown', () => { fuite++; });
    const touche = new p.window.KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true });
    p.doc.body.dispatchEvent(touche);
    verifie('les raccourcis de YouTube sont bloques', fuite === 0 && touche.defaultPrevented, fuite);
    const molette = new p.window.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    p.doc.body.dispatchEvent(molette);
    verifie('la molette ne fait pas defiler la page', molette.defaultPrevented);

    p.doc.body.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    verifie('Echap : le voile disparait tout de suite', !voile());
    await sleep(1500);
    verifie('… rien n’est envoye a Gemini', p.prompts.length === 0, p.prompts.length);
    verifie('… le panneau se ferme, le bouton revient', !p.doc.getElementById('yttools-comments-card')
      && /Résumer 100 commentaires/.test(p.doc.getElementById('yttools-comments-btn').textContent));
    verifie('… la page est remise a sa place', p.y() === 1800, p.y());
    const apres = new p.window.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    p.doc.body.dispatchEvent(apres);
    verifie('… et la molette remarche', !apres.defaultPrevented);

    await resumer(p);
    verifie('resume normal : le voile s’en va une fois les commentaires recuperes', !voile() && p.prompts.length === 1);
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
