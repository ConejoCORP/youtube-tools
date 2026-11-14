'use strict';

/**
 * YouTube Tools — tags de la video, tout en bas de la description.
 *
 * YouTube n'affiche plus les tags qu'un createur a saisis, mais il les envoie
 * toujours avec la page (videoDetails.keywords). rank-bridge.js les recopie
 * dans l'attribut `data-yttools-rank-src` du document ; ce bloc les liste,
 * avec un bouton pour les copier, separes par des virgules (le format que le
 * champ « Tags » de YouTube Studio accepte en collage).
 *
 * Aucune requete : tout est deja dans la page.
 *
 * Placement : dernier enfant de #description-inner, donc en bas du cadre de
 * la description, qu'elle soit repliee (sous « ...plus ») ou depliee (sous
 * « Moins »). Repliee, un clic n'importe ou dans ce cadre la deplie : les clics
 * dans le bloc s'arretent donc a lui.
 */

(() => {
  if (window.__yttoolsTagsLoaded) return;
  window.__yttoolsTagsLoaded = true;

  const TV = window.__yttools;
  if (!TV) { console.warn('[YouTube Tools] common.js absent'); return; }

  const CARD_ID = 'yttools-tags-card';
  const SRC = 'data-yttools-rank-src';
  const COLLAPSE_KEY = 'yttoolsTagsCollapsed';

  // Icones « etiquette » et chevron de Material Design (licence Apache 2.0).
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>';

  let collapsed = false;
  let copieTimer = null;

  try {
    chrome.storage.local.get(COLLAPSE_KEY).then((s) => {
      collapsed = !!(s && s[COLLAPSE_KEY]);
      const el = document.getElementById(CARD_ID);
      if (el) applyCollapsed(el);
    }).catch(() => {});
  } catch { /* contexte d'extension indisponible : deroule par defaut */ }

  const videoId = () => new URLSearchParams(location.search).get('v') || '';
  const isWatchPage = () => location.pathname === '/watch' && !!videoId();

  /* ---------------------------------------------------------------- donnees */

  /**
   * Les tags de la video courante, ou null tant que le pont n'a pas publie
   * celle-ci (juste apres une navigation, il porte encore la precedente).
   */
  function tagsNow() {
    let d = null;
    try { d = JSON.parse(document.documentElement.getAttribute(SRC) || 'null'); } catch { d = null; }
    if (!d || d.id !== videoId()) return null;
    return Array.isArray(d.tags) ? d.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  }

  /** Le texte copie : « tag 1, tag 2 », pret a coller dans YouTube Studio. */
  const enTexte = (tags) => tags.join(', ');

  /**
   * La longueur telle que YouTube Studio la compte pour sa limite de 500 :
   * une virgule entre deux tags, et deux guillemets de plus pour un tag qui
   * contient un espace.
   */
  const longueur = (tags) =>
    tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

  /* -------------------------------------------------------------- emplacement */

  /** L'interieur du cadre de la description. */
  function containerNow() {
    return document.querySelector('ytd-watch-metadata #description-inner') ||
           document.querySelector('ytd-watch-metadata #description');
  }

  /** Toujours le dernier : YouTube peut ajouter des blocs a la description apres nous. */
  function position(el) {
    const c = containerNow();
    if (!c) return;
    if (el.parentElement !== c || c.lastElementChild !== el) TV.moveGently(el, () => c.append(el));
  }

  /* -------------------------------------------------------------------- bloc */

  function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;                        // textContent : un tag ne devient jamais du HTML
    return s;
  }

  function applyCollapsed(el) {
    const v = collapsed ? 'true' : 'false';
    if (el.dataset.collapsed !== v) el.dataset.collapsed = v;
    const head = el.querySelector('.yttools-tg-toggle');
    if (head && head.getAttribute('aria-expanded') !== String(!collapsed)) head.setAttribute('aria-expanded', String(!collapsed));
  }

  function toggle() {
    collapsed = !collapsed;
    const el = document.getElementById(CARD_ID);
    if (el) applyCollapsed(el);
    try { chrome.storage.local.set({ [COLLAPSE_KEY]: collapsed }); } catch { /* reste en memoire pour la session */ }
  }

  async function copier(bouton) {
    const tags = tagsNow();
    if (!tags || !tags.length) return;
    const ok = await TV.copyText(enTexte(tags));
    clearTimeout(copieTimer);
    bouton.textContent = ok ? 'Copié ✓' : 'Copie refusée';
    copieTimer = setTimeout(() => { bouton.textContent = 'Copier'; }, 2000);
  }

  function build() {
    const card = document.createElement('section');
    card.id = CARD_ID;
    card.setAttribute('aria-label', 'Tags de la vidéo');
    // Description repliee : tout clic dans son cadre la deplie. Les clics du
    // bloc (plier, copier, selectionner un tag) restent au bloc.
    card.addEventListener('click', (e) => e.stopPropagation());

    const tete = document.createElement('div');
    tete.className = 'yttools-tg-head';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'yttools-tg-toggle';
    const icon = document.createElement('span');
    icon.className = 'yttools-tg-icon';
    icon.innerHTML = ICON;                       // constante de ce fichier, jamais une donnee
    const chev = document.createElement('span');
    chev.className = 'yttools-tg-chevron';
    chev.innerHTML = CHEVRON;                    // idem
    toggleBtn.append(icon, span('yttools-tg-label', 'Tags'), span('yttools-tg-value', ''), chev);
    toggleBtn.addEventListener('click', (e) => { e.preventDefault(); toggle(); });

    const compte = span('yttools-tg-count', '');
    compte.title = 'Compté comme YouTube Studio : virgules comprises, 2 de plus pour un tag avec un espace';

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'yttools-tg-copy';
    bouton.textContent = 'Copier';
    bouton.title = 'Copier les tags, séparés par des virgules';
    bouton.addEventListener('click', (e) => { e.preventDefault(); copier(bouton); });

    tete.append(toggleBtn, compte, bouton);

    const body = document.createElement('div');
    body.className = 'yttools-tg-body';

    card.append(tete, body);
    applyCollapsed(card);
    return card;
  }

  /** Reconstruit la liste — uniquement quand les tags changent, pas a chaque mutation. */
  function render(el) {
    const tags = tagsNow();
    const valeur = tags === null ? '…' : String(tags.length);
    const val = el.querySelector('.yttools-tg-value');
    if (val.textContent !== valeur) val.textContent = valeur;
    const etat = tags && tags.length ? 'ok' : 'muted';
    if (el.dataset.state !== etat) el.dataset.state = etat;

    const stamp = videoId() + '|' + (tags === null ? '' : enTexte(tags));
    if (el.dataset.rendered === stamp) return;
    el.dataset.rendered = stamp;

    const avec = !!(tags && tags.length);
    el.querySelector('.yttools-tg-count').textContent = avec ? `${longueur(tags)} / 500 caractères` : '';
    el.querySelector('.yttools-tg-copy').hidden = !avec;

    const body = el.querySelector('.yttools-tg-body');
    body.textContent = '';
    if (tags === null) { body.append(span('yttools-tg-msg', 'Lecture des tags…')); return; }
    if (!tags.length) { body.append(span('yttools-tg-msg', 'Aucun tag sur cette vidéo.')); return; }

    const liste = document.createElement('div');
    liste.className = 'yttools-tg-list';
    tags.forEach((t) => liste.append(span('yttools-tg-chip', t)));
    body.append(liste);
  }

  /** Appele a chaque verification de keepMounted : doit rester tres leger. */
  function refresh(el) {
    position(el);
    TV.applyTheme(el);
    render(el);
  }

  function place() {
    const c = containerNow();
    if (c) c.append(build());
  }

  // La publication du pont est un changement d'ATTRIBUT, que keepMounted
  // (qui ne surveille que l'arborescence) ne voit pas.
  new MutationObserver(() => {
    const el = document.getElementById(CARD_ID);
    if (el && isWatchPage()) refresh(el);
  }).observe(document.documentElement, { attributes: true, attributeFilter: [SRC] });

  TV.keepMounted({
    id: CARD_ID,
    wanted: () => isWatchPage() && TV.settings.get().videoTags,
    place,
    refresh
  });

  window.__yttoolsTags = { tagsNow, enTexte, longueur };
})();
