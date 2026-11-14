'use strict';

/**
 * YouTube Tools — resume des commentaires par Gemini.
 *
 * Un bouton « Resumer les commentaires » se pose dans l'en-tete des
 * commentaires, a cote de « Trier par ». Au clic :
 *  1. on fait defiler la page pour que YouTube charge une centaine de
 *     commentaires (il n'en affiche qu'une vingtaine a la fois), puis on revient
 *     exactement ou l'on etait ;
 *  2. on les envoie a Gemini en UNE seule demande ;
 *  3. le resume s'affiche juste sous l'en-tete, au-dessus des commentaires :
 *     une jauge verte et rouge (part des avis positifs et negatifs), puis en
 *     points courts « Ce qui plait », « Ce qui deplait » et « Ce que les gens
 *     demandent ».
 *
 * Reperes lus sur une vraie page de lecture (septembre 2026) :
 *  - un fil : ytd-comment-thread-renderer, son commentaire : ytd-comment-view-model ;
 *  - #author-text, #content-text, #vote-count-middle (likes), #more-replies ;
 *  - #pinned-comment-badge et #creator-heart existent sur TOUS les commentaires,
 *    vides quand ils ne s'appliquent pas : on se fie a leur contenu, jamais a
 *    leur seule presence ;
 *  - la suite se charge quand ytd-continuation-item-renderer entre a l'ecran.
 *
 * L'interface (carte, rendu, envoi a Gemini) est celle du resume de la video :
 * voir TV.ai dans summary.js.
 */

(() => {
  if (window.__yttoolsCommentsLoaded) return;
  window.__yttoolsCommentsLoaded = true;

  const TV = window.__yttools;
  if (!TV || !TV.ai) { console.warn('[YouTube Tools] common.js ou summary.js absent'); return; }

  const BTN_ID = 'yttools-comments-btn';
  const CARD_ID = 'yttools-comments-card';
  const CIBLE = 100;                 // assez pour degager les tendances, sans noyer Gemini
  const DELAI_CHARGEMENT = 20000;    // au-dela, on resume ce qu'on a
  const TAILLE_MAX = 500;            // un pave de 3 000 caracteres ne pese pas plus qu'un autre avis

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const videoId = () => new URLSearchParams(location.search).get('v') || '';
  const isWatchPage = () => location.pathname === '/watch' && !!videoId();

  const cache = new Map();           // id -> { structure ou blocks, n }
  let etat = null;                   // { id, status: 'collect' | 'loading' | 'ok' | 'error', n, structure | blocks, error }

  /* ----------------------------------------------------------------- lecture */

  const enTete = () => document.querySelector('ytd-comments ytd-comments-header-renderer');
  const fils = () => document.querySelectorAll('ytd-comments ytd-comment-thread-renderer');

  /** Les commentaires charges, dans l'ordre de YouTube (« Les plus populaires »). */
  function lireCommentaires() {
    const out = [];
    const vus = new Set();
    for (const fil of fils()) {
      // Le premier commentaire du fil est le principal ; les reponses viennent apres.
      const c = fil.querySelector('ytd-comment-view-model, ytd-comment-renderer');
      if (!c) continue;
      const texte = clean(c.querySelector('#content-text') && c.querySelector('#content-text').textContent);
      if (!texte) continue;
      const auteur = clean(c.querySelector('#author-text') && c.querySelector('#author-text').textContent);
      const cle = auteur + '|' + texte.slice(0, 80);
      if (vus.has(cle)) continue;
      vus.add(cle);

      const likesTxt = clean(c.querySelector('#vote-count-middle') && c.querySelector('#vote-count-middle').textContent);
      const repTxt = clean(fil.querySelector('#more-replies') && fil.querySelector('#more-replies').textContent);
      const epingle = clean(c.querySelector('#pinned-comment-badge') && c.querySelector('#pinned-comment-badge').textContent);
      out.push({
        auteur,
        texte: texte.length > TAILLE_MAX ? texte.slice(0, TAILLE_MAX) + '…' : texte,
        likes: likesTxt ? (TV.parseCount(likesTxt) || 0) : 0,
        reponses: repTxt ? (TV.parseCount(repTxt) || 0) : 0,
        epingle: !!epingle
      });
    }
    return out;
  }

  function totalAnnonce() {
    const h = enTete();
    const t = h && clean(h.querySelector('#count') && h.querySelector('#count').textContent);
    return t ? TV.parseCount(t) : null;
  }

  /**
   * L'element qui fait charger la suite de la LISTE.
   *
   * La section en contient plusieurs, et une seule est la bonne :
   *  - chaque fil a sa continuation de REPONSES (.replies-continuation),
   *    repliee, sans place a l'ecran ;
   *  - la toute derniere de la page est le GABARIT du chargement initial
   *    ([is-initial-load]), masque une fois les premiers commentaires affiches.
   * L'ancienne version prenait « la derniere de la page » — donc ce gabarit.
   * Faire defiler jusqu'a un element masque ne bouge rien : la page ne
   * defilait pas, et on restait a 20 commentaires.
   */
  function suiteDeLaListe() {
    const candidates = Array.from(document.querySelectorAll('ytd-comments ytd-continuation-item-renderer'))
      .filter((c) => !c.classList.contains('replies-continuation') && !c.closest('ytd-comment-replies-renderer'));
    const active = candidates.filter((c) => !c.hasAttribute('is-initial-load'));
    return active[active.length - 1] || candidates[candidates.length - 1] || null;
  }

  /** Attend que de nouveaux fils arrivent, jusqu'a `max` ms. */
  async function attendreDeNouveaux(n, max) {
    const fin = Date.now() + max;
    while (Date.now() < fin) {
      await sleep(250);
      if (fils().length > n) { await sleep(400); return fils().length; }   // laisse finir le lot
    }
    return fils().length;
  }

  /**
   * Fait charger des commentaires jusqu'a CIBLE, puis remet la page ou elle
   * etait. YouTube charge la suite quand la fin de la liste arrive a l'ecran :
   * on y amene le dernier commentaire puis la continuation, et on descend
   * encore d'une demi-page — ce qui marche quel que soit le declencheur exact.
   */
  async function charger(onProgres) {
    const y0 = window.scrollY;
    const fin = Date.now() + DELAI_CHARGEMENT;
    let n = fils().length;
    let surPlace = 0;
    try {
      while (n < CIBLE && Date.now() < fin) {
        // On n'exige PAS la continuation pour defiler : YouTube peut ne
        // l'inserer qu'une fois la fin de la liste a l'ecran. Faire descendre
        // la fenetre au-dela du dernier commentaire suffit a declencher la suite.
        const liste = fils();
        const dernier = liste[liste.length - 1];
        if (dernier) dernier.scrollIntoView({ block: 'end' });
        const suite = suiteDeLaListe();
        if (suite) suite.scrollIntoView({ block: 'end' });
        window.scrollBy(0, Math.round((window.innerHeight || 800) / 2));

        const n2 = await attendreDeNouveaux(n, 3000);
        onProgres(n2);
        if (n2 === n) {
          surPlace++;
          // Rien de neuf et plus de continuation : la liste est complete.
          if (surPlace >= 3 || (!suiteDeLaListe() && surPlace >= 1)) break;
        } else {
          surPlace = 0;
        }
        n = n2;
      }
    } finally {
      window.scrollTo({ top: y0 });
    }
    return n;
  }

  /* ------------------------------------------------------------------ prompt */

  function prompt(coms, total) {
    const tr = TV.lastTranscript && TV.lastTranscript.id === videoId() ? TV.lastTranscript : null;
    const titre = clean(document.querySelector('ytd-watch-metadata h1') && document.querySelector('ytd-watch-metadata h1').textContent)
      || (tr && tr.meta && tr.meta.titre) || '';
    const chaine = clean(document.querySelector('#owner ytd-channel-name') && document.querySelector('#owner ytd-channel-name').textContent);

    const lignes = coms.map((c) => {
      const marques = [`${c.likes} like${c.likes > 1 ? 's' : ''}`];
      if (c.reponses) marques.push(`${c.reponses} réponse${c.reponses > 1 ? 's' : ''}`);
      if (c.epingle) marques.push('épinglé');
      return `[${marques.join(', ')}] ${c.auteur} : ${c.texte}`;
    });

    // Un resume de commentaires se lit en dix secondes : d'abord la part
    // d'avis positifs et negatifs (affichee en jauge verte et rouge), puis ce
    // que dit chaque camp, et ce que le public demande. Des points courts,
    // jamais des paragraphes.
    return [
      'Résume les commentaires de cette vidéo YouTube : ce que pense le public, en points courts.',
      '',
      titre && `Titre : ${titre}`,
      chaine && `Chaîne : ${chaine}`,
      `${coms.length} commentaires parmi les plus populaires${total ? ` (sur ${total} au total)` : ''}. `
        + 'Les likes et réponses sont entre crochets : un commentaire très aimé pèse plus qu’un autre.',
      '',
      'Classe d’abord chaque commentaire : positif (compliment, enthousiasme, remerciement), '
        + 'négatif (critique, reproche, déception) ou neutre (question, blague sans avis, hors sujet).',
      '',
      'Réponds EXACTEMENT dans ce format, sans rien avant ni après. Chaque point fait 12 mots au plus, sans citation :',
      '',
      '## Avis',
      'Positifs : (nombre) %',
      'Négatifs : (nombre) %',
      '(la part des commentaires positifs et négatifs parmi ceux qui donnent un avis : les deux font 100 %)',
      '',
      '## Ce qui plaît',
      '- (ce que disent les avis positifs)',
      '(2 à 4 points, du plus répandu au moins répandu)',
      '',
      '## Ce qui déplaît',
      '- (ce que disent les avis négatifs)',
      '(0 à 3 points ; s’il n’y en a pas, écris seulement « Aucune critique notable. »)',
      '',
      '## Ce que les gens demandent',
      '- (une suite, un sujet, une précision…)',
      '(0 à 3 points ; sinon, écris seulement « Rien de notable. »)',
      '',
      'Commentaires :',
      lignes.join('\n'),
      '',
      'RAPPEL : les deux pourcentages d’abord, puis des points courts et globaux, sans citation. '
        + 'Reste fidèle aux commentaires, n’invente rien. Réponds en français.'
    ].join('\n');
  }

  /* ----------------------------------------------- reponse -> avis */

  const minuscules = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  // « Positifs : 82 % », « positif 82% », « 82 % de positifs », « 82 % d’avis positifs ».
  const POS = [/positi\w*\s*[:=–-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/, /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:(?:des|de|d\W)\s*)?(?:avis\s+|commentaires\s+)?positi/];
  const NEG = [/negati\w*\s*[:=–-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/, /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:(?:des|de|d\W)\s*)?(?:avis\s+|commentaires\s+)?negati/];

  function pourcentage(motifs, texte) {
    const t = minuscules(texte);
    for (const re of motifs) {
      const m = t.match(re);
      if (m) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
      }
    }
    return null;
  }

  /** Le titre d'une partie -> son role. « Déplaît » avant « plaît » : l'un contient l'autre. */
  function rubrique(titre) {
    const n = TV.ai.norme(titre);
    if (/deplai|negati|critique|reproche|n aime pas|defaut/.test(n)) return 'neg';
    if (/plai|positi|aime|apprecie|points? forts?/.test(n)) return 'pos';
    if (/demand|suggest|souhait|attend|requete|idee/.test(n)) return 'ask';
    if (/avis|ressenti|ratio|sentiment|bilan|tendance/.test(n)) return 'avis';
    return 'autre';
  }

  // « Aucune critique notable. », « Rien de notable. » : une partie vide.
  const estVide = (t) => /^(aucun|aucune|rien|pas de|neant)\b/.test(TV.ai.norme(t));

  /**
   * Les blocs de Gemini -> { pos, neg, plait, deplait, demandes, autres }, ou
   * null si la reponse n'est pas au format attendu (elle est alors affichee
   * telle quelle).
   */
  function structurerAvis(blocks) {
    const r = { pos: null, neg: null, plait: [], deplait: [], demandes: [], autres: [] };
    let partie = '';
    for (const b of blocks || []) {
      const texte = clean(b.text);
      if (!texte) continue;
      // Les pourcentages, ou que Gemini les ait mis (titre, ligne ou puce).
      const p = pourcentage(POS, texte);
      const n = pourcentage(NEG, texte);
      if (p !== null) r.pos = p;
      if (n !== null) r.neg = n;
      if (b.type === 'h') {
        partie = rubrique(texte);
        if (partie === 'autre' && p === null && n === null) r.autres.push(b);
        continue;
      }
      if (p !== null || n !== null) continue;
      if (partie === 'pos') r.plait.push(texte);
      else if (partie === 'neg') r.deplait.push(texte);
      else if (partie === 'ask') r.demandes.push(texte);
      else if (partie !== 'avis') r.autres.push(b);
    }
    if (r.pos !== null && r.neg === null) r.neg = Math.max(0, 100 - r.pos);
    if (r.neg !== null && r.pos === null) r.pos = Math.max(0, 100 - r.neg);
    return r.pos !== null || r.plait.length || r.deplait.length ? r : null;
  }

  /* ------------------------------------------------------- affichage */

  // Pouces de Material Design (licence Apache 2.0).
  const POUCE_HAUT = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
  const POUCE_BAS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>';

  function icone(svg) {
    const s = document.createElement('span');
    s.className = 'yttools-cm-pouce';
    s.innerHTML = svg;                               // constante de ce fichier, jamais une donnee
    return s;
  }

  /** La jauge : part des avis positifs en vert, negatifs en rouge. */
  function jauge(r) {
    const box = document.createElement('div');
    box.className = 'yttools-cm-jauge';
    const somme = (r.pos || 0) + (r.neg || 0);
    if (!(somme > 0)) {
      const p = document.createElement('p');
      p.className = 'yttools-cm-vide';
      p.textContent = 'Pas d’avis tranché : surtout des questions et des blagues.';
      box.append(p);
      return box;
    }
    const pos = Math.round((r.pos || 0) * 100 / somme);
    const neg = 100 - pos;
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${pos} % d’avis positifs, ${neg} % d’avis négatifs`);

    const legende = document.createElement('div');
    legende.className = 'yttools-cm-legende';
    const lp = document.createElement('span');
    lp.className = 'yttools-cm-pos';
    lp.append(icone(POUCE_HAUT), `${pos} % positifs`);
    const ln = document.createElement('span');
    ln.className = 'yttools-cm-neg';
    ln.append(`${neg} % négatifs`, icone(POUCE_BAS));
    legende.append(lp, ln);

    const barre = document.createElement('div');
    barre.className = 'yttools-cm-barre';
    const bp = document.createElement('span');
    bp.className = 'yttools-cm-barre-pos';
    bp.style.width = `${pos}%`;
    const bn = document.createElement('span');
    bn.className = 'yttools-cm-barre-neg';
    bn.style.width = `${neg}%`;
    barre.append(bp, bn);

    box.append(legende, barre);
    return box;
  }

  /** Une partie : titre colore, puis ses points (ou une mention si elle est vide). */
  function partie(cls, titre, items, siVide) {
    const sec = document.createElement('div');
    sec.className = `yttools-cm-bloc ${cls}`;
    const h = document.createElement('h3');
    h.textContent = titre;
    sec.append(h);
    const pleins = items.filter((t) => !estVide(t));
    if (!pleins.length) {
      const p = document.createElement('p');
      p.className = 'yttools-cm-vide';
      p.textContent = items.length ? items[0] : siVide;
      sec.append(p);
      return sec;
    }
    const ul = document.createElement('ul');
    for (const t of pleins) {
      const li = document.createElement('li');
      li.append(TV.ai.avecLiens(t).frag);            // un timecode cite par le public reste un lien
      ul.append(li);
    }
    sec.append(ul);
    return sec;
  }

  function rendreAvis(body, r) {
    if (r.pos !== null || r.neg !== null) body.append(jauge(r));
    body.append(
      partie('is-pos', 'Ce qui plaît', r.plait, 'Rien de notable.'),
      partie('is-neg', 'Ce qui déplaît', r.deplait, 'Aucune critique notable.'),
      partie('is-ask', 'Ce que les gens demandent', r.demandes, 'Rien de notable.')
    );
    if (r.autres.length) TV.ai.renderBlocks(body, r.autres);
  }

  /* ------------------------------------------------------------------ bouton */

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'yttools-ai-btn';
    btn.title = 'Résumer les commentaires avec Gemini';
    btn.setAttribute('aria-label', 'Résumer les commentaires avec Gemini');
    const icon = document.createElement('span');
    icon.className = 'yttools-ai-icon';
    icon.innerHTML = TV.ai.etoile(20);                 // constante, jamais une donnee
    const label = document.createElement('span');
    label.className = 'yttools-ai-label';
    label.textContent = 'Résumer les commentaires';
    btn.append(icon, label);
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lancer(); });
    return btn;
  }

  function placeButton() {
    const h = enTete();
    if (!h) return;
    // A cote de « Trier par », sur la meme ligne que le nombre de commentaires.
    const zone = h.querySelector('#additional-section') || h.querySelector('#title') || h;
    zone.append(buildButton());
  }

  function refreshButton(el) {
    TV.applyTheme(el);
    const occupe = !!etat && etat.id === videoId() && (etat.status === 'collect' || etat.status === 'loading');
    const label = el.querySelector('.yttools-ai-label');
    const voulu = occupe ? 'Résumé en cours…' : 'Résumer les commentaires';
    if (label.textContent !== voulu) label.textContent = voulu;
    if (el.dataset.state !== (occupe ? 'loading' : 'idle')) el.dataset.state = occupe ? 'loading' : 'idle';
    el.disabled = occupe;
  }

  /* ----------------------------------------------------------------- panneau */

  function fermer() {
    etat = null;
    document.getElementById(CARD_ID)?.remove();
  }

  function renderBody(el) {
    const cle = etat ? `${etat.id}|${etat.status}|${etat.status === 'collect' ? etat.n : ''}` : '';
    if (el.dataset.rendered === cle) return;
    el.dataset.rendered = cle;
    el.dataset.state = etat ? (etat.status === 'collect' ? 'loading' : etat.status) : '';

    const body = el.querySelector('.yttools-ai-body');
    const sous = el.querySelector('.yttools-ai-sub');
    body.textContent = '';
    sous.textContent = '';
    if (!etat) return;

    const attente = (texte) => {
      const p = document.createElement('p');
      p.className = 'yttools-ai-wait';
      p.textContent = texte;
      body.append(p);
    };
    if (etat.status === 'collect') {
      attente(`Chargement des commentaires… ${etat.n || 0} / ${CIBLE}. La page défile un instant puis revient à sa place.`);
      return;
    }
    if (etat.status === 'loading') {
      attente(`Gemini lit ${etat.n} commentaires… une petite fenêtre s’est ouverte, elle se refermera toute seule.`);
      return;
    }
    if (etat.status === 'error') {
      TV.ai.message(body, TV.ai.erreurLisible(etat.error), () => { cache.delete(videoId()); lancer(true); });
      return;
    }
    sous.textContent = `par Gemini · ${etat.n} commentaires analysés`;
    if (etat.structure) rendreAvis(body, etat.structure);
    else TV.ai.renderBlocks(body, etat.blocks);       // reponse hors format : telle quelle
  }

  function placeCard() {
    const h = enTete();
    if (!h) return;
    // Juste sous l'en-tete, au-dessus de la liste : la ou l'on vient de cliquer.
    h.after(TV.ai.buildCard({ id: CARD_ID, titre: 'Résumé des commentaires', onClose: fermer }));
  }

  function refreshCard(el) {
    TV.applyTheme(el);
    renderBody(el);
  }

  function rafraichir() {
    const btn = document.getElementById(BTN_ID);
    if (btn) refreshButton(btn);
    let card = document.getElementById(CARD_ID);
    if (etat && etat.id === videoId() && !card) { placeCard(); card = document.getElementById(CARD_ID); }
    if (card) refreshCard(card);
  }

  /* --------------------------------------------------------------- lancement */

  async function lancer(forcer = false) {
    const id = videoId();
    if (!forcer && cache.has(id)) {
      etat = { id, status: 'ok', ...cache.get(id) };
      rafraichir();
      return;
    }
    if (etat && etat.id === id && (etat.status === 'collect' || etat.status === 'loading')) return;

    etat = { id, status: 'collect', n: fils().length };
    rafraichir();
    await charger((n) => { if (etat && etat.id === id) { etat.n = n; rafraichir(); } });
    if (!etat || etat.id !== id) return;

    const coms = lireCommentaires();
    if (!coms.length) {
      etat = { id, status: 'error', error: 'Aucun commentaire à résumer sur cette vidéo.' };
      rafraichir();
      return;
    }

    etat = { id, status: 'loading', n: coms.length };
    rafraichir();
    const rep = await TV.ai.ask(prompt(coms, totalAnnonce()));
    if (!etat || etat.id !== id) return;                 // video changee ou panneau ferme

    if (rep.ok) {
      const structure = structurerAvis(rep.blocks);
      const contenu = structure ? { structure, n: coms.length } : { blocks: rep.blocks, n: coms.length };
      cache.set(id, contenu);
      etat = { id, status: 'ok', ...contenu };
    } else {
      etat = { id, status: 'error', error: rep.error };
    }
    rafraichir();
  }

  TV.keepMounted({
    id: BTN_ID,
    wanted: () => isWatchPage() && !!enTete(),
    place: placeButton,
    refresh: refreshButton
  });

  TV.keepMounted({
    id: CARD_ID,
    wanted: () => isWatchPage() && !!etat && etat.id === videoId() && !!enTete(),
    place: placeCard,
    refresh: refreshCard
  });

  // Exposes pour les tests uniquement.
  window.__yttoolsComments = { lireCommentaires, prompt, charger, lancer, totalAnnonce, suiteDeLaListe, structurerAvis, rendreAvis };
})();
