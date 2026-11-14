'use strict';

/**
 * YouTube Tools — resume d'une video par Gemini, affiche DANS YouTube.
 *
 * Une fois la transcription copiee (bouton ☰), un bouton « Resumer » apparait
 * a cote. Il envoie la transcription a Gemini (voir background.js) et affiche
 * la reponse en tete de la colonne de droite, a lire en regardant la video :
 * « En bref », puis la video chapitre par chapitre, chaque chapitre avec ses
 * points. Les timecodes ne sont que des references, en petit au bout des
 * lignes (un clic mene au passage), et le chapitre en cours est surligne.
 *
 * Le temps du resume, le classement sur 10 et le panneau de vidIQ s'effacent
 * pour que le resume soit cote a cote avec la video — sur CETTE video
 * seulement : les suivantes les retrouvent.
 *
 * Ce fichier expose aussi, via TV.ai, l'interface commune aux resumes (carte,
 * rendu des blocs, references, envoi a Gemini) : comments.js s'en sert pour le
 * resume des commentaires.
 *
 * Le texte de Gemini n'est jamais insere comme HTML : chaque bloc est
 * reconstruit avec textContent, seuls les timecodes devenant des liens.
 */

(() => {
  if (window.__yttoolsSummaryLoaded) return;
  window.__yttoolsSummaryLoaded = true;

  const TV = window.__yttools;
  if (!TV) { console.warn('[YouTube Tools] common.js absent'); return; }

  const BTN_ID = 'yttools-summary-btn';
  const CARD_ID = 'yttools-summary-card';
  const TR_BTN_ID = 'yttools-transcript-btn';
  const RANK_ID = 'yttools-rank-card';
  const HIDDEN = 'data-yttools-hidden';

  const videoId = () => new URLSearchParams(location.search).get('v') || '';
  const isWatchPage = () => location.pathname === '/watch' && !!videoId();

  const cache = new Map();          // id -> { structure } ou { blocks } : rouvrir ne redemande rien a Gemini
  let panneau = null;               // { id, status: 'loading' | 'ok' | 'error', structure | blocks, error }

  /* -------------------------------------------------------------- timecodes */

  const TS_RE = /\[?\b((?:\d{1,2}:)?\d{1,2}:[0-5]\d)\b\]?/g;
  const A_UN_TS = /\b(?:\d{1,2}:)?\d{1,2}:[0-5]\d\b/;
  const secondes = (ts) => ts.split(':').reduce((a, p) => a * 60 + Number(p), 0);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function fmt(sec, withHours) {
    const s = Math.max(0, Math.round(sec));
    const p2 = (n) => String(n).padStart(2, '0');
    return withHours
      ? Math.floor(s / 3600) + ':' + p2(Math.floor((s % 3600) / 60)) + ':' + p2(s % 60)
      : Math.floor(s / 60) + ':' + p2(s % 60);
  }

  const video = () =>
    document.querySelector('video.html5-main-video') ||
    document.querySelector('#movie_player video') ||
    document.querySelector('video');

  function duree() {
    const v = video();
    if (v && Number.isFinite(v.duration) && v.duration > 0) return v.duration;
    const tr = TV.lastTranscript;
    return tr && tr.meta && Number(tr.meta.duree_s) > 0 ? Number(tr.meta.duree_s) : null;
  }

  function aller(sec) {
    const v = video();
    if (!v) return;
    v.currentTime = sec;
    try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* lecture refusee */ }
  }

  /* ---------------------------------------------- transcription -> tranches */

  /**
   * Segments regroupes par tranches d'au moins 20 s, un timecode par tranche.
   * Une video d'une heure compte un millier de segments : les taper un par un
   * dans Gemini prendrait du temps pour aucun gain sur le resume.
   */
  function tranches(rows, pas = 20) {
    const out = [];
    let cur = null;
    for (const r of rows) {
      if (!cur) cur = { start: r.start, morceaux: [] };
      cur.morceaux.push(r.text);
      if (r.start - cur.start >= pas) { out.push({ start: cur.start, text: cur.morceaux.join(' ') }); cur = null; }
    }
    if (cur) out.push({ start: cur.start, text: cur.morceaux.join(' ') });
    return out;
  }

  const SRC = 'data-yttools-rank-src';

  /**
   * Les chapitres de la video (ceux du createur, sinon ceux de YouTube), que
   * rank-bridge.js recopie depuis la page. null s'il n'y en a pas.
   */
  function chapitresDuPont(id) {
    let d = null;
    try { d = JSON.parse(document.documentElement.getAttribute(SRC) || 'null'); } catch { d = null; }
    const c = d && d.id === id && d.chapitres;
    return c && Array.isArray(c.liste) && c.liste.length >= 2 ? c : null;
  }

  /**
   * Le resume se lit par CHAPITRES : un titre, puis les points qui disent
   * l'essentiel de chacun. Les timecodes ne sont que des references, poses en
   * fin de ligne : ils ne structurent plus le resume (l'ancienne version etait
   * une liste de moments, chaque ligne commencant par son timecode, et se
   * lisait mal).
   *
   * Si la video a deja des chapitres, Gemini suit ce decoupage.
   */
  function prompt(tr) {
    const m = tr.meta || {};
    const parts = tranches(tr.rows);
    const withHours = parts.length && parts[parts.length - 1].start >= 3600;
    const entete = [
      m.titre && `Titre : ${m.titre}`,
      m.chaine && `Chaîne : ${m.chaine}`,
      m.duree && `Durée : ${m.duree}`
    ].filter(Boolean).join('\n');

    // Un chapitre toutes les deux minutes et demie environ, entre 3 et 8 : assez
    // pour suivre les etapes, sans redevenir une liste de moments.
    const dureeS = Number(m.duree_s) || (tr.rows.length ? tr.rows[tr.rows.length - 1].start : 0);
    const nombre = Math.max(3, Math.min(8, Math.round(dureeS / 150)));
    const page = chapitresDuPont(tr.id || videoId());
    const decoupage = page
      ? [
          `La vidéo est déjà découpée en chapitres (${page.source === 'createur' ? 'par son créateur' : 'automatiquement par YouTube'}). `
            + 'Suis ce découpage : un chapitre du résumé par chapitre de la vidéo, dans le même ordre, '
            + 'avec un titre court qui en dit l’idée.'
            + (page.liste.length > 10 ? ' Tu peux regrouper des chapitres voisins très courts.' : ''),
          page.liste.map((c) => `[${fmt(c.t, withHours)}] ${c.titre}`).join('\n')
        ]
      : [`Découpe la vidéo en ${nombre} chapitres environ : un par grande étape ou changement de sujet, dans l’ordre de la vidéo.`];

    // Le format est donne comme un MODELE a recopier, et rappele apres la
    // transcription : un modele suivi d'un rappel est bien mieux respecte
    // qu'une consigne en prose noyee avant un long texte.
    return [
      'Résume cette vidéo YouTube, chapitre par chapitre, à partir de sa transcription horodatée.',
      '',
      entete,
      '',
      ...decoupage,
      '',
      'Réponds EXACTEMENT dans ce format, sans rien avant ni après :',
      '',
      '## En bref',
      '(1 ou 2 phrases : de quoi parle la vidéo et ce qu’il faut en retenir)',
      '',
      '## Chapitres',
      '### (titre court du chapitre, 2 à 6 mots) [0:00]',
      '- (un point important de ce chapitre, 15 mots au plus) [0:12]',
      '- (un autre point) [0:41]',
      '### (titre du chapitre suivant) [2:30]',
      '- (…) [2:45]',
      '(1 à 3 points par chapitre : ce qui est dit, montré ou décidé, pas « ils parlent de… »)',
      '',
      'Le timecode entre crochets en fin de ligne n’est qu’une référence : le moment de la transcription '
        + 'où c’est dit. Chaque titre et chaque point doit se comprendre sans lui.',
      '',
      'Transcription :',
      parts.map((p) => `[${fmt(p.start, withHours)}] ${p.text}`).join('\n'),
      '',
      'RAPPEL : un résumé par chapitres, avec des points courts qui disent l’essentiel, et non une liste de moments. '
        + 'Termine chaque titre et chaque point par son timecode de référence entre crochets, repris de la '
        + 'transcription. Reste fidèle à la transcription, n’invente rien. Réponds en français.'
    ].join('\n');
  }

  /* ------------------------------------------- reponse -> chapitres */

  const sansAccents = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const norme = (s) => sansAccents(s).replace(/[^a-z0-9]+/g, ' ').trim();

  // Un timecode de reference, entre crochets ou parentheses, en fin ou en debut
  // de ligne : « [1:23] », « (1:23) », une plage « [1:23 – 2:10] » (on garde
  // son debut). Un timecode NU au milieu d'une phrase en fait partie : il reste
  // dans le texte, ou il devient un simple lien.
  const REF_FIN = /\s*[-–—·,]?\s*[[(]((?:\d{1,2}:)?\d{1,2}:[0-5]\d)(?:\s*[-–—à]\s*(?:\d{1,2}:)?\d{1,2}:[0-5]\d)?\s*[\])]\s*[.;]?\s*$/;
  const REF_DEBUT = /^\s*[[(]((?:\d{1,2}:)?\d{1,2}:[0-5]\d)(?:\s*[-–—à]\s*(?:\d{1,2}:)?\d{1,2}:[0-5]\d)?\s*[\])]\s*[-–—:·]?\s*/;

  /** « Un point important [1:23] » -> { texte: 'Un point important', t: 83 }. */
  function separerRef(texte) {
    let s = String(texte || '');
    let t = null;
    let m = s.match(REF_FIN);
    if (m && m.index > 0) { t = secondes(m[1]); s = s.slice(0, m.index); }
    m = s.match(REF_DEBUT);
    if (m && m[0].length < s.length) { if (t === null) t = secondes(m[1]); s = s.slice(m[0].length); }
    return { texte: clean(s), t };
  }

  const EST_BREF = /^(en bref|resume|en resume|l essentiel|synthese)$/;
  const EST_CHAPITRES = /^(chapitres?|les chapitres|etapes|les etapes)$/;
  const EST_AUTRE = /^(a retenir|points cles|conclusion|en conclusion|a noter)$/;

  /**
   * Les blocs de Gemini -> { bref: [textes], chapitres: [{ titre, t, points:
   * [{ texte, t }] }], autres: [blocs] }, ou null si la reponse n'est pas un
   * resume par chapitres (elle est alors affichee telle quelle).
   *
   * Un chapitre est un titre qui suit « Chapitres » ou qui porte un timecode ;
   * par repli, un paragraphe suivi de puces, ou une puce suivie de sous-puces
   * (selon la facon dont Gemini a mis en forme sa reponse).
   */
  function structurer(blocks) {
    const res = { bref: [], chapitres: [], autres: [] };
    let section = '';
    let niveau = 0;                       // niveau du titre « Chapitres » (## = 2)
    let chap = null;
    const nouveau = (titre, t) => { chap = { titre, t, points: [] }; res.chapitres.push(chap); };

    for (let i = 0; i < (blocks || []).length; i++) {
      const b = blocks[i];
      const { texte, t } = separerRef(b.text);
      if (!texte) continue;

      if (b.type === 'h') {
        const n = norme(texte);
        if (t === null && EST_BREF.test(n)) { section = 'bref'; continue; }
        if (t === null && EST_CHAPITRES.test(n)) { section = 'chap'; niveau = b.level || 0; chap = null; continue; }
        // Une autre partie de meme rang que « Chapitres » (« ## À retenir ») n'est pas un chapitre.
        const memeRang = niveau > 0 && b.level > 0 && b.level <= niveau;
        if (t === null && (memeRang || EST_AUTRE.test(n))) { section = 'autre'; chap = null; res.autres.push(b); continue; }
        if (section === 'chap' || t !== null) { section = 'chap'; nouveau(texte, t); continue; }
        section = 'autre';
        res.autres.push(b);
        continue;
      }

      if (section === 'bref') { res.bref.push(b.text); continue; }
      if (section === 'chap') {
        const suivant = blocks[i + 1];
        const titre =
          (b.type === 'p' && suivant && suivant.type === 'li') ||
          (b.type === 'li' && !(b.depth > 0) && suivant && suivant.type === 'li' && (suivant.depth || 0) > (b.depth || 0));
        if (titre) { nouveau(texte, t); continue; }
        if (!chap) nouveau('', null);
        chap.points.push({ texte, t });
        continue;
      }
      res.autres.push(b);
    }
    return res.chapitres.some((c) => c.titre || c.points.length) ? res : null;
  }

  /* ------------------------------------- timecodes retrouves localement */

  const MOTS_VIDES = new Set(('dans pour avec mais plus tout tous toute toutes cette cela celui celle ceux sont '
    + 'fait faire comme elle elles nous vous leur leurs quand alors donc tres bien aussi encore entre sans sous '
    + 'apres avant depuis etre avoir etait sera peut chose choses video videos avoir quoi juste vraiment ensuite '
    + 'that this with from have they there their about what when which would will just your').split(' '));

  const motsCles = (t) => new Set(
    (String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])
      .filter((w) => !MOTS_VIDES.has(w)));

  /*
   * Gemini oublie parfois les timecodes malgre la consigne. Pour chaque point
   * qui n'en a pas, on retrouve le passage de la transcription qui lui
   * ressemble le plus — mots rares en commun, ponderes par leur rarete — et on
   * lui attribue son timecode. Aucune requete : tout se fait ici.
   *
   * Un timecode retrouve ainsi est marque comme estime et s'affiche
   * differemment : c'est une deduction, pas une affirmation de Gemini.
   */

  /** La transcription, preparee pour retrouver() : mots-cles par segment et rarete de chaque mot. */
  function indexer(rows) {
    const segs = rows.map((r) => motsCles(r.text));
    const df = new Map();
    segs.forEach((d) => d.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
    const idf = (w) => Math.log((segs.length + 1) / ((df.get(w) || 0) + 0.5));
    return { rows, segs, idf };
  }

  const FENETRE = 20;                // secondes : un sujet tient rarement en un seul segment

  /**
   * Le moment de la transcription qui ressemble le plus a `texte` (mots rares
   * en commun), ou null si rien ne ressemble assez : on n'invente pas.
   * `apres` : a score voisin, on prefere ce qui vient apres ce moment.
   */
  function retrouver(ix, texte, apres) {
    const { rows, segs, idf } = ix;
    const mots = motsCles(texte);
    if (mots.size < 2) return null;

    // Fenetre glissante sur les SEGMENTS, et non sur les tranches de 20 s du
    // prompt : leurs frontieres coupent les sujets en deux, et le timecode
    // tombait alors sur la mauvaise moitie, quelques secondes trop tard.
    let meilleur = -1;
    let score = 0;
    for (let i = 0; i < rows.length; i++) {
      const communs = new Set();
      for (let j = i; j < rows.length && rows[j].start - rows[i].start <= FENETRE; j++) {
        segs[j].forEach((w) => { if (mots.has(w)) communs.add(w); });
      }
      if (communs.size < 2) continue;
      let s = 0;
      communs.forEach((w) => { s += idf(w); });
      if (rows[i].start >= apres) s += 0.25;
      if (s > score + 1e-9) { score = s; meilleur = i; }
    }
    if (meilleur < 0 || score < 2.5) return null;

    // On se cale sur le premier segment de la fenetre qui parle du sujet.
    let debut = meilleur;
    while (debut < rows.length - 1 && ![...segs[debut]].some((w) => mots.has(w))) debut++;
    return rows[debut].start;
  }

  /** Repli pour une reponse qui n'est pas en chapitres : un timecode devant chaque puce qui n'en a pas. */
  function horodater(blocks, rows) {
    if (!rows || !rows.length) return blocks;
    const withHours = rows[rows.length - 1].start >= 3600;
    const ix = indexer(rows);

    let precedent = 0;
    return blocks.map((b) => {
      if (b.type !== 'li') return b;
      const deja = b.text.match(A_UN_TS);
      if (deja) { precedent = secondes(deja[0]); return b; }
      const t = retrouver(ix, b.text, precedent);
      if (t === null) return b;
      precedent = t;
      return { ...b, text: `[${fmt(t, withHours)}] ${b.text}`, estimated: true };
    });
  }

  /**
   * Les references que Gemini a oubliees, retrouvees dans la transcription et
   * marquees `estime`. Un chapitre sans timecode prend celui de son premier
   * point, a defaut celui du passage qui ressemble le plus a son titre et a ses
   * points.
   */
  function completerRefs(s, rows) {
    if (!s || !rows || !rows.length) return s;
    const ix = indexer(rows);
    let precedent = 0;
    for (const c of s.chapitres) {
      if (c.t === null) {
        const donnes = c.points.map((p) => p.t).filter((t) => t !== null);
        const t = donnes.length ? Math.min(...donnes)
          : retrouver(ix, [c.titre, ...c.points.map((p) => p.texte)].join(' '), precedent);
        if (t !== null) { c.t = t; c.estime = true; }
      }
      if (c.t !== null) precedent = c.t;
      for (const p of c.points) {
        if (p.t !== null) continue;
        const t = retrouver(ix, p.texte, precedent);
        if (t !== null) { p.t = t; p.estime = true; }
      }
    }
    return s;
  }

  /* ------------------------------------------- interface commune (TV.ai) */

  // Etoile de Gemini, en degrade. L'identifiant du degrade doit etre unique.
  let nGradient = 0;
  const etoile = (taille) => {
    const id = `yttools-gm-${++nGradient}`;
    return `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true">`
      + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
      + '<stop offset="0" stop-color="#4285f4"/><stop offset=".55" stop-color="#9b72cb"/>'
      + '<stop offset="1" stop-color="#d96570"/></linearGradient></defs>'
      + `<path fill="url(#${id})" d="M12 2c.6 4.9 2.6 7.9 7.6 9.4.4.1.4.7 0 .8-5 1.6-7 4.6-7.6 9.5-.1.4-.7.4-.8 0-.6-4.9-2.6-7.9-7.6-9.5-.4-.1-.4-.7 0-.8 5-1.5 7-4.5 7.6-9.4.1-.4.7-.4.8 0z"/></svg>`;
  };

  const CROIX = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" '
    + 'd="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>';

  /** Un texte de Gemini -> des noeuds, ou chaque timecode devient un lien. */
  function avecLiens(texte, estime) {
    const frag = document.createDocumentFragment();
    const fin = duree();
    let pos = 0;
    let premier = null;
    texte.replace(TS_RE, (tout, ts, idx) => {
      const s = secondes(ts);
      if (fin != null && s > fin + 5) return tout;      // une heure, pas un timecode
      if (idx > pos) frag.append(document.createTextNode(texte.slice(pos, idx)));
      const a = document.createElement('a');
      a.className = 'yttools-ai-ts' + (estime && premier === null ? ' is-estimated' : '');
      if (estime && premier === null) a.title = 'Timecode retrouvé dans la transcription';
      a.href = `/watch?v=${encodeURIComponent(videoId())}&t=${s}s`;
      a.dataset.t = String(s);
      a.textContent = ts;
      a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); aller(s); });
      frag.append(a);
      if (premier === null) premier = s;
      pos = idx + tout.length;
      return tout;
    });
    if (pos < texte.length) frag.append(document.createTextNode(texte.slice(pos)));
    return { frag, premier };
  }

  /** Les blocs de Gemini -> titres, paragraphes et listes, dans `body`. */
  function renderBlocks(body, blocks) {
    let liste = null;
    for (const b of blocks) {
      if (b.type === 'li') {
        if (!liste) { liste = document.createElement('ul'); body.append(liste); }
        const li = document.createElement('li');
        const { frag, premier } = avecLiens(b.text, b.estimated);
        li.append(frag);
        if (premier !== null) li.dataset.t = String(premier);
        liste.append(li);
        continue;
      }
      liste = null;
      if (b.type === 'h') {
        const h = document.createElement('h3');
        h.textContent = b.text.replace(/^#+\s*/, '');
        body.append(h);
      } else {
        const p = document.createElement('p');
        p.append(avecLiens(b.text).frag);
        body.append(p);
      }
    }
  }

  /**
   * Un timecode de reference : une petite pastille discrete, en fin de ligne,
   * qui mene au passage. Elle accompagne le texte, elle ne le structure pas.
   */
  function refTs(s, estime) {
    const a = document.createElement('a');
    a.className = 'yttools-ai-ref' + (estime ? ' is-estimated' : '');
    a.href = `/watch?v=${encodeURIComponent(videoId())}&t=${s}s`;
    a.dataset.t = String(s);
    a.textContent = fmt(s, (duree() || 0) >= 3600);
    a.title = estime ? 'Passage retrouvé dans la transcription' : 'Revoir ce passage';
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); aller(s); });
    return a;
  }

  /** Un texte suivi de sa reference (si elle tombe dans la video). */
  function ligneAvecRef(el, texte, t, estime) {
    const fin = duree();
    el.append(avecLiens(texte).frag);
    if (t !== null && t !== undefined && (fin == null || t <= fin + 5)) el.append(refTs(t, estime));
  }

  /**
   * Le resume par chapitres : « En bref », puis chaque chapitre numerote, son
   * titre (un clic y mene) et ses points, chacun suivi de sa reference.
   */
  function rendreChapitres(body, s) {
    const fin = duree();
    const valide = (t) => t !== null && t !== undefined && (fin == null || t <= fin + 5);

    if (s.bref.length) {
      const p = document.createElement('p');
      p.className = 'yttools-sm-bref';
      p.append(avecLiens(s.bref.join(' ')).frag);
      body.append(p);
    }

    const ol = document.createElement('ol');
    ol.className = 'yttools-sm-chapitres';
    s.chapitres.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'yttools-sm-chap';
      if (valide(c.t)) li.dataset.t = String(c.t);

      const tete = document.createElement('div');
      tete.className = 'yttools-sm-tete';
      const num = document.createElement('span');
      num.className = 'yttools-sm-num';
      num.textContent = String(i + 1);
      const titre = document.createElement('span');
      titre.className = 'yttools-sm-titre';
      titre.textContent = c.titre || `Partie ${i + 1}`;
      tete.append(num, titre);
      if (valide(c.t)) {
        tete.append(refTs(c.t, c.estime));
        tete.classList.add('is-cliquable');
        tete.title = 'Aller au début de ce chapitre';
        tete.addEventListener('click', (e) => { e.preventDefault(); aller(c.t); });
      }
      li.append(tete);

      if (c.points.length) {
        const ul = document.createElement('ul');
        ul.className = 'yttools-sm-points';
        for (const p of c.points) {
          const pl = document.createElement('li');
          ligneAvecRef(pl, p.texte, p.t, p.estime);
          ul.append(pl);
        }
        li.append(ul);
      }
      ol.append(li);
    });
    body.append(ol);

    // Une partie en plus (« À retenir »…) : affichee telle quelle, rien ne se perd.
    if (s.autres.length) renderBlocks(body, s.autres);
  }

  /** Une carte de resume : en-tete (etoile, titre, sous-titre, croix) et corps. */
  function buildCard({ id, titre, label, onClose }) {
    const card = document.createElement('section');
    card.id = id;
    card.className = 'yttools-ai-card';
    card.setAttribute('aria-label', label || titre);

    const head = document.createElement('div');
    head.className = 'yttools-ai-head';
    const icon = document.createElement('span');
    icon.className = 'yttools-ai-icon';
    icon.innerHTML = etoile(20);                       // constante, jamais une donnee
    const textes = document.createElement('div');
    textes.className = 'yttools-ai-titles';
    const t = document.createElement('span');
    t.className = 'yttools-ai-title';
    t.textContent = titre;
    const sous = document.createElement('span');
    sous.className = 'yttools-ai-sub';
    textes.append(t, sous);
    const fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'yttools-ai-close';
    fermer.title = 'Fermer';
    fermer.setAttribute('aria-label', 'Fermer');
    fermer.innerHTML = CROIX;                          // constante, jamais une donnee
    fermer.addEventListener('click', (e) => { e.preventDefault(); onClose(); });
    head.append(icon, textes, fermer);

    const body = document.createElement('div');
    body.className = 'yttools-ai-body';
    card.append(head, body);
    return card;
  }

  function message(body, texte, onRetry) {
    const box = document.createElement('div');
    box.className = 'yttools-ai-msg';
    const p = document.createElement('p');
    p.textContent = texte;
    box.append(p);
    if (onRetry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'yttools-ai-retry';
      b.textContent = 'Réessayer';
      b.addEventListener('click', (e) => { e.preventDefault(); onRetry(); });
      box.append(b);
    }
    body.append(box);
  }

  function erreurLisible(err) {
    if (err === 'login') return 'Gemini demande une connexion. Connecte-toi dans la fenêtre qui vient de s’ouvrir, puis réessaie.';
    return err || 'Gemini n’a rien renvoyé.';
  }

  async function ask(texte) {
    try {
      const rep = await chrome.runtime.sendMessage({ type: 'YTTOOLS_SUMMARIZE', prompt: texte });
      if (rep && rep.ok && Array.isArray(rep.blocks) && rep.blocks.length) return rep;
      return { ok: false, error: rep && rep.error };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  TV.ai = { etoile, renderBlocks, buildCard, message, erreurLisible, ask, avecLiens, refTs, ligneAvecRef, separerRef, norme };

  /* ------------------------------------- cote a cote avec la video */

  let focusFor = '';                 // video dont le resume a fait place nette

  const colonne = () =>
    document.querySelector('ytd-watch-flexy #secondary-inner') ||
    document.querySelector('#secondary-inner') ||
    document.querySelector('ytd-watch-flexy #secondary');

  /**
   * Le panneau de vidIQ, tel qu'il est enfant direct de la colonne.
   *
   * On le reconnait a SON propre identifiant ou a sa classe `vidiq-react`
   * (div#video-companion-root sur la vraie page). Surtout pas a la presence de
   * vidIQ a l'interieur : vidIQ pose ses badges dans les cartes suggerees et sa
   * classe `vidiq-scope` sur des conteneurs de YouTube — on cacherait alors les
   * suggestions, voire le panneau de transcription.
   */
  function blocsVidiq(col) {
    const garde = TV.suggestionsBlock(col);
    return Array.from(col.children).filter((n) => {
      if (n === garde || n.id === CARD_ID || n.id === RANK_ID) return false;
      if (n.querySelector('ytd-engagement-panel-section-list-renderer')) return false;
      const cls = typeof n.className === 'string' ? n.className : '';
      return /vidiq|companion/i.test(n.id) || /\bvidiq-react\b/i.test(cls) || /vidiq/i.test(n.tagName);
    });
  }

  function faireDeLaPlace(id) {
    focusFor = id;
    TV.rankHidden.add(id);
    document.getElementById(RANK_ID)?.remove();
    const col = colonne();
    if (col) blocsVidiq(col).forEach((n) => n.setAttribute(HIDDEN, ''));
  }

  function rendreLaPlace() {
    if (focusFor) TV.rankHidden.delete(focusFor);
    focusFor = '';
    document.querySelectorAll('[' + HIDDEN + ']').forEach((n) => n.removeAttribute(HIDDEN));
  }

  // Le masquage ne survit pas a la video : en ouvrir une autre rend tout.
  window.addEventListener('yt-navigate-finish', () => { if (focusFor && focusFor !== videoId()) rendreLaPlace(); });

  /* ------------------------------------------------------------------ bouton */

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'yttools-ai-btn';
    btn.title = 'Résumer la vidéo avec Gemini';
    btn.setAttribute('aria-label', 'Résumer la vidéo avec Gemini');
    const icon = document.createElement('span');
    icon.className = 'yttools-ai-icon';
    icon.innerHTML = etoile(20);                       // constante, jamais une donnee
    const label = document.createElement('span');
    label.className = 'yttools-ai-label';
    label.textContent = 'Résumer';
    btn.append(icon, label);
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lancer(); });
    return btn;
  }

  function placeButton() {
    const tr = document.getElementById(TR_BTN_ID);
    if (tr && tr.isConnected) tr.after(buildButton());
  }

  function refreshButton(el) {
    TV.applyTheme(el);
    const charge = !!panneau && panneau.id === videoId() && panneau.status === 'loading';
    const label = el.querySelector('.yttools-ai-label');
    const voulu = charge ? 'Gemini rédige…' : 'Résumer';
    if (label.textContent !== voulu) label.textContent = voulu;
    if (el.dataset.state !== (charge ? 'loading' : 'idle')) el.dataset.state = charge ? 'loading' : 'idle';
    el.disabled = charge;
  }

  /* ----------------------------------------------------------------- panneau */

  function fermer() {
    panneau = null;
    document.getElementById(CARD_ID)?.remove();
    rendreLaPlace();
  }

  function renderBody(el) {
    const cle = panneau ? `${panneau.id}|${panneau.status}` : '';
    if (el.dataset.rendered === cle) return;
    el.dataset.rendered = cle;
    el.dataset.state = panneau ? panneau.status : '';

    const body = el.querySelector('.yttools-ai-body');
    const sous = el.querySelector('.yttools-ai-sub');
    body.textContent = '';
    sous.textContent = '';
    if (!panneau) return;

    if (panneau.status === 'loading') {
      const p = document.createElement('p');
      p.className = 'yttools-ai-wait';
      p.textContent = 'Gemini rédige le résumé… une petite fenêtre s’est ouverte, elle se refermera toute seule.';
      body.append(p);
      return;
    }
    if (panneau.status === 'error') {
      message(body, erreurLisible(panneau.error), () => { cache.delete(videoId()); lancer(true); });
      return;
    }
    if (panneau.structure) {
      sous.textContent = 'par Gemini · les petits timecodes mènent au passage';
      rendreChapitres(body, panneau.structure);
    } else {
      sous.textContent = 'par Gemini · clique un timecode pour y aller';
      renderBlocks(body, panneau.blocks);
    }
    surligner();
  }

  /**
   * Le chapitre en cours de lecture : celui dont le debut est le plus avance
   * sans depasser la lecture.
   *
   * Repli (reponse qui n'est pas en chapitres) : la frise, c'est-a-dire le
   * premier bloc de lignes horodatees. Pas « la derniere ligne deja passee dans
   * l'ordre de la page » : « A retenir » vient apres la frise et n'est pas
   * chronologique, le surlignage y aurait saute au lieu de suivre la video.
   */
  function surligner() {
    const card = document.getElementById(CARD_ID);
    const v = video();
    if (!card || !v || card.dataset.state !== 'ok') return;
    const t = v.currentTime;
    let candidats = card.querySelectorAll('li.yttools-sm-chap[data-t]');
    if (!candidats.length) {
      const frise = Array.from(card.querySelectorAll('ul')).find((u) => u.querySelector('li[data-t]'));
      candidats = frise ? frise.querySelectorAll('li[data-t]') : [];
    }
    let actif = null;
    let plusAvance = -1;
    for (const li of candidats) {
      const lt = Number(li.dataset.t);
      if (lt <= t + 0.5 && lt > plusAvance) { plusAvance = lt; actif = li; }
    }
    for (const li of card.querySelectorAll('li.is-active')) if (li !== actif) li.classList.remove('is-active');
    if (actif && !actif.classList.contains('is-active')) actif.classList.add('is-active');
  }

  // timeupdate ne remonte pas, mais un ecouteur en phase de CAPTURE sur le
  // document le recoit quand meme : pas besoin de suivre le <video>.
  document.addEventListener('timeupdate', surligner, true);

  function placeCard() {
    const col = colonne();
    if (!col) return;
    // En tete de colonne : il se lit en meme temps que la video.
    col.prepend(buildCard({ id: CARD_ID, titre: 'Résumé de la vidéo', onClose: fermer }));
  }

  function refreshCard(el) {
    TV.applyTheme(el);
    const col = el.parentElement;
    if (col && col.firstElementChild !== el) TV.moveGently(el, () => col.prepend(el));
    // vidIQ peut remonter son panneau en cours de route : on le recache.
    if (focusFor === videoId() && col) {
      blocsVidiq(col).forEach((n) => { if (!n.hasAttribute(HIDDEN)) n.setAttribute(HIDDEN, ''); });
    }
    renderBody(el);
  }

  /* --------------------------------------------------------------- lancement */

  function rafraichir() {
    const btn = document.getElementById(BTN_ID);
    if (btn) refreshButton(btn);
    let card = document.getElementById(CARD_ID);
    if (panneau && panneau.id === videoId() && !card) {
      placeCard();
      card = document.getElementById(CARD_ID);
    }
    if (card) refreshCard(card);
  }

  async function lancer(forcer = false) {
    const tr = TV.lastTranscript;
    const id = videoId();
    if (!tr || tr.id !== id || !tr.rows || !tr.rows.length) return;

    faireDeLaPlace(id);

    if (!forcer && cache.has(id)) {
      panneau = { id, status: 'ok', ...cache.get(id) };
      rafraichir();
      return;
    }
    if (panneau && panneau.id === id && panneau.status === 'loading') return;

    panneau = { id, status: 'loading' };
    rafraichir();

    const rep = await ask(prompt(tr));
    if (!panneau || panneau.id !== id) return;          // video changee ou panneau ferme entre-temps

    if (rep.ok) {
      // En chapitres (le cas normal) ; sinon la reponse telle quelle, horodatee.
      const structure = completerRefs(structurer(rep.blocks), tr.rows);
      const contenu = structure ? { structure } : { blocks: horodater(rep.blocks, tr.rows) };
      cache.set(id, contenu);
      panneau = { id, status: 'ok', ...contenu };
    } else {
      panneau = { id, status: 'error', error: rep.error };
    }
    rafraichir();
  }

  TV.keepMounted({
    id: BTN_ID,
    wanted: () => {
      const tr = TV.lastTranscript;
      return isWatchPage() && TV.settings.get().transcriptButton && !!tr && tr.id === videoId();
    },
    place: placeButton,
    refresh: refreshButton
  });

  TV.keepMounted({
    id: CARD_ID,
    wanted: () => isWatchPage() && !!panneau && panneau.id === videoId(),
    place: placeCard,
    refresh: refreshCard
  });

  // Exposes pour les tests uniquement.
  window.__yttoolsSummary = { prompt, tranches, horodater, lancer, blocsVidiq, structurer, separerRef, completerRefs, chapitresDuPont, rendreChapitres };
})();
