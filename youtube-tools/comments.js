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

  const GROUPE_ID = 'yttools-comments-groupe';   // le bouton et sa fleche
  const BTN_ID = 'yttools-comments-btn';
  const MENU_ID = 'yttools-cm-menu';
  const CARD_ID = 'yttools-comments-card';

  // Combien de commentaires charger, au choix (fleche a cote du bouton). 100
  // suffit a degager les tendances ; davantage fait charger a YouTube autant de
  // lots de 20, ce qui, fait trop souvent, peut lui faire limiter le compte.
  const QUANTITES = [50, 100, 200, 300, 500];
  const PAR_DEFAUT = 100;
  const CLE_QUANTITE = 'yttoolsCommentsQuantite';
  // Au-dela, on resume ce qu'on a : environ 1 s par lot de 20, avec de la marge.
  const delaiChargement = (cible) => Math.max(20000, cible * 200);
  // Un pave de 3 000 caracteres ne pese pas plus qu'un autre avis ; sur un gros
  // lot, on coupe plus court pour ne pas noyer Gemini.
  const tailleMax = (cible) => (cible >= 300 ? 300 : 500);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const videoId = () => new URLSearchParams(location.search).get('v') || '';
  const isWatchPage = () => location.pathname === '/watch' && !!videoId();

  /*
   * Un « dossier » par video, garde en memoire tant que l'onglet reste ouvert :
   * les commentaires lus, le resume de Gemini et chaque question posee ensuite
   * avec sa reponse. C'est ce qui permet de demander a Gemini « c'est qui, et
   * de quoi il parle ? » sans recharger quoi que ce soit.
   *   { id, status: 'collect' | 'loading' | 'ok' | 'error', n, cible, coms,
   *     total, titre, chaine, structure | blocks, error, qr: [], ouvert }
   *   qr : [{ q, status: 'loading' | 'ok' | 'error', blocks, error }]
   */
  const cache = new Map();
  let etat = null;                   // le dossier affiche dans le panneau ; null = panneau ferme
  let quantite = PAR_DEFAUT;

  const dossier = () => cache.get(videoId()) || null;
  const occupe = (d) => !!d && (d.status === 'collect' || d.status === 'loading');
  const repond = (d) => !!d && d.status === 'ok' && d.qr.some((x) => x.status === 'loading');

  try {
    chrome.storage.local.get(CLE_QUANTITE).then((s) => {
      const v = Number(s && s[CLE_QUANTITE]);
      if (QUANTITES.includes(v)) { quantite = v; rafraichir(); }
    }).catch(() => {});
  } catch { /* contexte d'extension indisponible : 100 par defaut */ }

  /* ----------------------------------------------------------------- lecture */

  const enTete = () => document.querySelector('ytd-comments ytd-comments-header-renderer');
  const fils = () => document.querySelectorAll('ytd-comments ytd-comment-thread-renderer');

  /** Les commentaires charges, dans l'ordre de YouTube (« Les plus populaires »). */
  function lireCommentaires(taille = 500) {
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
        texte: texte.length > taille ? texte.slice(0, taille) + '…' : texte,
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
   * Fait charger des commentaires jusqu'a `cible`, puis remet la page ou elle
   * etait. YouTube charge la suite quand la fin de la liste arrive a l'ecran :
   * on y amene le dernier commentaire puis la continuation, et on descend
   * encore d'une demi-page — ce qui marche quel que soit le declencheur exact.
   */
  async function charger(cible, onProgres) {
    const y0 = window.scrollY;
    const fin = Date.now() + delaiChargement(cible);
    let n = fils().length;
    let surPlace = 0;
    try {
      while (n < cible && Date.now() < fin) {
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

  /** Titre et chaine de la video, lus dans la page au moment du resume. */
  function infosVideo() {
    const tr = TV.lastTranscript && TV.lastTranscript.id === videoId() ? TV.lastTranscript : null;
    const titre = clean(document.querySelector('ytd-watch-metadata h1') && document.querySelector('ytd-watch-metadata h1').textContent)
      || (tr && tr.meta && tr.meta.titre) || '';
    const chaine = clean(document.querySelector('#owner ytd-channel-name') && document.querySelector('#owner ytd-channel-name').textContent);
    return { titre, chaine };
  }

  /** « [246 likes, 21 réponses] @auteur : texte » : le meme format pour le resume et les questions. */
  function ligneCommentaire(c) {
    const marques = [`${c.likes} like${c.likes > 1 ? 's' : ''}`];
    if (c.reponses) marques.push(`${c.reponses} réponse${c.reponses > 1 ? 's' : ''}`);
    if (c.epingle) marques.push('épinglé');
    return `[${marques.join(', ')}] ${c.auteur} : ${c.texte}`;
  }

  function prompt(coms, total, infos = infosVideo()) {
    const { titre, chaine } = infos;
    const lignes = coms.map(ligneCommentaire);

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

  /** Des blocs de Gemini -> du texte, pour les lui redonner dans une question suivante. */
  function texteDesBlocs(blocks) {
    return (blocks || []).map((b) => (b.type === 'h' ? `## ${b.text}` : b.type === 'li' ? `- ${b.text}` : b.text)).join('\n');
  }

  /** Le resume deja fait, en texte. */
  function resumeEnTexte(d) {
    const r = d.structure;
    if (!r) return texteDesBlocs(d.blocks);
    const liste = (titre, items) => [titre, ...(items.length ? items.map((t) => `- ${t}`) : ['- Rien de notable.'])].join('\n');
    return [
      r.pos !== null || r.neg !== null ? `Avis : ${r.pos || 0} % positifs, ${r.neg || 0} % négatifs` : '',
      liste('Ce qui plaît :', r.plait),
      liste('Ce qui déplaît :', r.deplait),
      liste('Ce que les gens demandent :', r.demandes)
    ].filter(Boolean).join('\n');
  }

  /**
   * Une question sur les commentaires deja resumes. Gemini ne garde rien d'une
   * demande a l'autre (chaque demande ouvre une conversation neuve) : on lui
   * redonne donc TOUT — les commentaires, son resume et les questions deja
   * posees avec leurs reponses —, puis la nouvelle question, en dernier, la ou
   * elle est le mieux suivie apres un long texte.
   */
  function promptQuestion(d, question) {
    const precedentes = d.qr.filter((x) => x.status === 'ok')
      .map((x) => `Question : ${x.q}\nTa réponse :\n${texteDesBlocs(x.blocks)}`);
    return [
      'Voici les commentaires d’une vidéo YouTube, le résumé que tu en as fait, puis une question à leur sujet.',
      '',
      d.titre && `Titre : ${d.titre}`,
      d.chaine && `Chaîne : ${d.chaine}`,
      '',
      `Commentaires (${d.coms.length} parmi les plus populaires ; likes et réponses entre crochets) :`,
      d.coms.map(ligneCommentaire).join('\n'),
      '',
      'Ton résumé :',
      resumeEnTexte(d),
      '',
      ...(precedentes.length ? ['Questions déjà posées :', precedentes.join('\n\n'), ''] : []),
      `Nouvelle question : ${question}`,
      '',
      'Réponds en français, brièvement : quelques phrases ou une courte liste. Appuie-toi uniquement sur les '
        + 'commentaires ci-dessus. Quand ça aide, dis qui l’a écrit (@pseudo) et cite ses mots exacts entre guillemets. '
        + 'Si les commentaires ne permettent pas de répondre, dis-le simplement.'
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

  // Chevron et coche de Material Design (licence Apache 2.0).
  const CHEVRON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>';
  const COCHE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

  /**
   * Le bouton principal, puis une fleche qui ouvre le choix de la quantite.
   * Avant le resume il dit « Resumer 100 commentaires » ; une fois le resume
   * fait, « Demander plus d'infos » : il ouvre le champ de question.
   */
  function buildGroupe() {
    const groupe = document.createElement('span');
    groupe.id = GROUPE_ID;
    groupe.className = 'yttools-cm-groupe';

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'yttools-ai-btn';
    const icon = document.createElement('span');
    icon.className = 'yttools-ai-icon';
    icon.innerHTML = TV.ai.etoile(20);                 // constante, jamais une donnee
    const label = document.createElement('span');
    label.className = 'yttools-ai-label';
    btn.append(icon, label);
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clicPrincipal(); });

    const fleche = document.createElement('button');
    fleche.type = 'button';
    fleche.className = 'yttools-ai-btn yttools-cm-fleche';
    fleche.title = 'Nombre de commentaires à analyser';
    fleche.setAttribute('aria-label', 'Nombre de commentaires à analyser');
    fleche.setAttribute('aria-haspopup', 'menu');
    fleche.setAttribute('aria-expanded', 'false');
    fleche.innerHTML = CHEVRON;                        // constante, jamais une donnee
    fleche.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); basculerMenu(fleche); });

    groupe.append(btn, fleche);
    return groupe;
  }

  function placeButton() {
    const h = enTete();
    if (!h) return;
    // A cote de « Trier par », sur la meme ligne que le nombre de commentaires.
    const zone = h.querySelector('#additional-section') || h.querySelector('#title') || h;
    zone.append(buildGroupe());
  }

  function refreshButton(groupe) {
    const btn = groupe.querySelector('#' + BTN_ID);
    const fleche = groupe.querySelector('.yttools-cm-fleche');
    if (!btn || !fleche) return;
    TV.applyTheme(btn);
    TV.applyTheme(fleche);
    const d = dossier();
    const resume = !!d && d.status === 'ok';
    const enCours = occupe(d) || repond(d);
    const voulu = occupe(d) ? 'Résumé en cours…'
      : repond(d) ? 'Gemini répond…'
      : resume ? 'Demander plus d’infos'
      : `Résumer ${quantite} commentaires`;
    const label = btn.querySelector('.yttools-ai-label');
    if (label.textContent !== voulu) label.textContent = voulu;
    const titre = resume ? 'Poser une question à Gemini sur ces commentaires' : 'Résumer les commentaires avec Gemini';
    if (btn.title !== titre) { btn.title = titre; btn.setAttribute('aria-label', titre); }
    if (btn.dataset.state !== (enCours ? 'loading' : 'idle')) btn.dataset.state = enCours ? 'loading' : 'idle';
    btn.disabled = enCours;
    fleche.disabled = occupe(d);
  }

  /* --------------------------------------------- choix de la quantite */

  const menuOuvert = () => document.getElementById(MENU_ID);

  function fermerMenu() {
    const m = menuOuvert();
    if (m) m.remove();
    document.querySelectorAll(`#${GROUPE_ID} .yttools-cm-fleche[aria-expanded="true"]`)
      .forEach((f) => f.setAttribute('aria-expanded', 'false'));
  }

  function choisirQuantite(v) {
    if (!QUANTITES.includes(v)) return;
    quantite = v;
    try { chrome.storage.local.set({ [CLE_QUANTITE]: v }); } catch { /* garde en memoire pour l'onglet */ }
    rafraichir();
  }

  /** Le contenu du menu, refait a chaque choix (coche, libelle de « Refaire »). */
  function remplirMenu(menu) {
    menu.textContent = '';
    const titre = document.createElement('p');
    titre.className = 'yttools-cm-menu-titre';
    titre.textContent = 'Commentaires à analyser';
    menu.append(titre);

    for (const v of QUANTITES) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'yttools-cm-option';
      opt.setAttribute('role', 'menuitemradio');
      opt.setAttribute('aria-checked', String(v === quantite));
      opt.dataset.quantite = String(v);
      const coche = document.createElement('span');
      coche.className = 'yttools-cm-coche';
      if (v === quantite) coche.innerHTML = COCHE;     // constante, jamais une donnee
      const nom = document.createElement('span');
      nom.textContent = `${v} commentaires`;
      opt.append(coche, nom);
      if (v === PAR_DEFAUT) {
        const reco = document.createElement('span');
        reco.className = 'yttools-cm-reco';
        reco.textContent = 'recommandé';
        opt.append(reco);
      }
      opt.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        choisirQuantite(v);
        // Resume deja fait : on reste, pour pouvoir le refaire avec ce nombre.
        if (dossier() && dossier().status === 'ok') remplirMenu(menu); else fermerMenu();
      });
      menu.append(opt);
    }

    const note = document.createElement('p');
    note.className = 'yttools-cm-note';
    note.textContent = 'Plus il y en a, plus YouTube doit en charger d’un coup. Fait trop souvent, ça ressemble '
      + 'à un robot et YouTube peut limiter ton compte quelque temps : garde les grandes quantités pour les vidéos qui comptent.';
    menu.append(note);

    const d = dossier();
    if (d && d.status === 'ok') {
      const refaire = document.createElement('button');
      refaire.type = 'button';
      refaire.className = 'yttools-cm-refaire';
      refaire.textContent = `Refaire le résumé avec ${quantite} commentaires`;
      refaire.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fermerMenu(); lancer(true); });
      menu.append(refaire);
    }
  }

  /**
   * Le menu est pose dans <body>, sous la fleche : dans l'en-tete des
   * commentaires, un conteneur de YouTube pourrait le rogner. En position
   * absolue dans la page, il suit le defilement tout seul.
   */
  function basculerMenu(fleche) {
    if (menuOuvert()) { fermerMenu(); return; }
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'yttools-cm-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Nombre de commentaires à analyser');
    menu.dataset.theme = TV.isDark(fleche.parentElement) ? 'dark' : 'light';
    remplirMenu(menu);
    document.body.append(menu);

    const r = fleche.getBoundingClientRect();
    const largeur = menu.offsetWidth || 300;
    menu.style.top = `${Math.round(r.bottom + window.scrollY + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, r.right + window.scrollX - largeur))}px`;
    fleche.setAttribute('aria-expanded', 'true');
  }

  // Un clic ailleurs, Echap, un changement de taille ou de page : le menu se ferme.
  document.addEventListener('mousedown', (e) => {
    const m = menuOuvert();
    if (m && !m.contains(e.target) && !(e.target.closest && e.target.closest('.yttools-cm-fleche'))) fermerMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOuvert()) fermerMenu(); }, true);
  window.addEventListener('resize', fermerMenu);
  window.addEventListener('yt-navigate-start', fermerMenu);

  /* ----------------------------------------------------------------- panneau */

  /** La croix : le panneau se ferme, mais le dossier reste en memoire. */
  function fermer() {
    etat = null;
    document.getElementById(CARD_ID)?.remove();
    rafraichir();
  }

  function attente(el, texte) {
    const p = document.createElement('p');
    p.className = 'yttools-ai-wait';
    p.textContent = texte;
    el.append(p);
  }

  /** Le resume (ou l'attente, ou l'erreur) : refait seulement quand l'etat change. */
  function renderBody(el) {
    const d = etat;
    const etatCarte = d ? (d.status === 'collect' ? 'loading' : d.status) : '';
    if (el.dataset.state !== etatCarte) el.dataset.state = etatCarte;
    const cle = d ? `${d.id}|${d.status}|${d.status === 'collect' ? d.n : ''}|${d.cible || ''}` : '';
    if (el.dataset.rendered !== cle) {
      el.dataset.rendered = cle;
      el.dataset.echange = '';
      const body = el.querySelector('.yttools-ai-body');
      const sous = el.querySelector('.yttools-ai-sub');
      body.textContent = '';
      sous.textContent = '';
      if (!d) return;
      if (d.status === 'collect') {
        attente(body, `Chargement des commentaires… ${d.n || 0} / ${d.cible}. La page défile un instant puis revient à sa place.`);
      } else if (d.status === 'loading') {
        attente(body, `Gemini lit ${d.n} commentaires… une petite fenêtre s’est ouverte, elle se refermera toute seule.`);
      } else if (d.status === 'error') {
        TV.ai.message(body, TV.ai.erreurLisible(d.error), () => lancer(true));
      } else {
        sous.textContent = `par Gemini · ${d.n} commentaires analysés`;
        if (d.structure) rendreAvis(body, d.structure);
        else TV.ai.renderBlocks(body, d.blocks);       // reponse hors format : telle quelle
        const echange = document.createElement('div');
        echange.className = 'yttools-cm-echange';
        body.append(echange);
      }
    }
    if (d && d.status === 'ok') majEchange(el, d);
  }

  /* ------------------------------------------ questions sur les commentaires */

  /** Une question posee, puis sa reponse (ou l'attente, ou l'erreur). */
  function elementsQR(d, x) {
    const q = document.createElement('p');
    q.className = 'yttools-cm-q';
    q.textContent = x.q;                               // textContent : rien n'est interprete
    const r = document.createElement('div');
    r.className = 'yttools-cm-r';
    if (x.status === 'loading') {
      attente(r, `Gemini relit les ${d.coms.length} commentaires pour te répondre… une petite fenêtre s’est ouverte, elle se refermera toute seule.`);
    } else if (x.status === 'error') {
      TV.ai.message(r, TV.ai.erreurLisible(x.error), () => { d.qr.splice(d.qr.indexOf(x), 1); demander(x.q, d); });
    } else {
      TV.ai.renderBlocks(r, x.blocks);
    }
    return [q, r];
  }

  /** Le champ de question, sous le panneau : construit une fois, ce qui y est tape ne se perd pas. */
  function construireSaisie() {
    const saisie = document.createElement('div');
    saisie.className = 'yttools-cm-saisie';
    saisie.hidden = true;

    const ligne = document.createElement('div');
    ligne.className = 'yttools-cm-ligne';
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'yttools-cm-champ';
    champ.maxLength = 500;
    champ.placeholder = 'Une question sur ces commentaires ? Ex. : c’est qui, et de quoi il parle ?';
    champ.setAttribute('aria-label', 'Question à Gemini sur ces commentaires');
    const envoyer = document.createElement('button');
    envoyer.type = 'button';
    envoyer.className = 'yttools-cm-envoyer';
    envoyer.textContent = 'Demander';

    const partir = () => {
      const q = clean(champ.value);
      if (!q || !etat || repond(etat)) return;
      champ.value = '';
      demander(q);
    };
    // Les raccourcis de YouTube (k, j, f, espace…) ne doivent pas reagir a la frappe.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      champ.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); partir(); }
      });
    }
    envoyer.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); partir(); });
    ligne.append(champ, envoyer);

    const aide = document.createElement('p');
    aide.className = 'yttools-cm-aide';
    aide.textContent = 'Gemini relit les commentaires et son résumé pour te répondre. '
      + 'Tout reste en mémoire tant que l’onglet est ouvert.';
    saisie.append(ligne, aide);
    return saisie;
  }

  /**
   * Les questions et leurs reponses, sous le resume, puis le champ. Le fil
   * n'est refait que quand une question part ou recoit sa reponse.
   */
  function majEchange(el, d) {
    const body = el.querySelector('.yttools-ai-body');
    const echange = body.querySelector('.yttools-cm-echange');
    const cle = d.qr.map((x) => x.status).join(',');
    if (echange && el.dataset.echange !== cle) {
      el.dataset.echange = cle;
      echange.textContent = '';
      d.qr.forEach((x) => echange.append(...elementsQR(d, x)));
      if (d.qr.length) body.scrollTop = body.scrollHeight;      // la derniere reponse a l'ecran
    }

    let saisie = el.querySelector('.yttools-cm-saisie');
    if (!saisie) { saisie = construireSaisie(); el.append(saisie); }
    const visible = !!d.ouvert || d.qr.length > 0;
    if (saisie.hidden === visible) saisie.hidden = !visible;
    const attend = repond(d);
    const champ = saisie.querySelector('.yttools-cm-champ');
    const envoyer = saisie.querySelector('.yttools-cm-envoyer');
    if (champ.disabled !== attend) champ.disabled = attend;
    if (envoyer.disabled !== attend) envoyer.disabled = attend;
  }

  async function demander(question, d = etat) {
    const q = clean(question);
    if (!d || d.status !== 'ok' || !q || repond(d)) return;
    const texte = promptQuestion(d, q);                // avant d'ajouter la question au fil
    const item = { q, status: 'loading' };
    d.qr.push(item);
    d.ouvert = true;
    rafraichir();
    const rep = await TV.ai.ask(texte);
    if (rep.ok) Object.assign(item, { status: 'ok', blocks: rep.blocks });
    else Object.assign(item, { status: 'error', error: rep.error });
    rafraichir();
  }

  /* ----------------------------------------------------------------- panneau */

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
    const groupe = document.getElementById(GROUPE_ID);
    if (groupe) refreshButton(groupe);
    let card = document.getElementById(CARD_ID);
    if (etat && etat.id === videoId() && !card && enTete()) { placeCard(); card = document.getElementById(CARD_ID); }
    if (card) refreshCard(card);
  }

  /* --------------------------------------------------------------- lancement */

  /** Le bouton principal : resumer, ou, une fois le resume fait, ouvrir le champ de question. */
  function clicPrincipal() {
    const d = dossier();
    if (d && d.status === 'ok') {
      etat = d;
      d.ouvert = true;
      rafraichir();
      const champ = document.querySelector(`#${CARD_ID} .yttools-cm-champ`);
      if (champ) {
        const saisie = champ.closest('.yttools-cm-saisie');
        if (saisie && saisie.scrollIntoView) saisie.scrollIntoView({ block: 'nearest' });
        champ.focus();
      }
      return;
    }
    if (occupe(d)) { etat = d; rafraichir(); return; }
    lancer();
  }

  async function lancer(forcer = false) {
    const id = videoId();
    const connu = cache.get(id);
    if (!forcer && connu && connu.status === 'ok') { etat = connu; rafraichir(); return; }
    if (occupe(connu)) { etat = connu; rafraichir(); return; }

    const cible = quantite;
    const d = { id, status: 'collect', n: fils().length, cible, qr: [], ouvert: false };
    cache.set(id, d);
    etat = d;
    rafraichir();
    await charger(cible, (n) => { d.n = n; rafraichir(); });

    // Panneau ferme ou autre video pendant le chargement : on abandonne (les
    // commentaires a l'ecran ne seraient plus ceux de cette video).
    if (etat !== d || videoId() !== id) {
      if (cache.get(id) === d) cache.delete(id);
      rafraichir();
      return;
    }

    const coms = lireCommentaires(tailleMax(cible)).slice(0, cible);
    if (!coms.length) {
      Object.assign(d, { status: 'error', error: 'Aucun commentaire à résumer sur cette vidéo.' });
      cache.delete(id);
      rafraichir();
      return;
    }

    Object.assign(d, { status: 'loading', n: coms.length, coms, total: totalAnnonce(), ...infosVideo() });
    rafraichir();
    const rep = await TV.ai.ask(prompt(coms, d.total, d));
    // Panneau ferme entre-temps : le resume est garde quand meme, et le bouton
    // proposera « Demander plus d'infos ». Seul un nouveau resume le remplace.
    if (cache.get(id) !== d) return;
    if (rep.ok) {
      const structure = structurerAvis(rep.blocks);
      if (structure) d.structure = structure; else d.blocks = rep.blocks;
      d.status = 'ok';
    } else {
      Object.assign(d, { status: 'error', error: rep.error });
      cache.delete(id);
    }
    rafraichir();
  }

  TV.keepMounted({
    id: GROUPE_ID,
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
  window.__yttoolsComments = {
    lireCommentaires, prompt, promptQuestion, charger, lancer, demander, totalAnnonce, suiteDeLaListe,
    structurerAvis, rendreAvis, choisirQuantite, dossier, QUANTITES
  };
})();
