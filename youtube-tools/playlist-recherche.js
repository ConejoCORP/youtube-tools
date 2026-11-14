'use strict';

/**
 * YouTube Tools — champ de recherche en haut d'une playlist.
 *
 * Filtre les videos de la playlist par titre et par chaine, sans tenir compte
 * des accents ni des majuscules ; plusieurs mots doivent tous etre presents.
 *
 * YouTube ne charge une longue playlist que par lots de 100, au fil du
 * defilement. Pendant une recherche, on place son repere de chargement (la
 * « continuation ») dans l'ecran, invisible : c'est YouTube lui-meme qui
 * charge les lots suivants, comme si on defilait jusqu'en bas. Aucune requete
 * de notre part. Idee reprise de SQUIDUU.
 *
 * Deux mises en page coexistent chez YouTube (releves de novembre 2026) :
 *   - l'ancienne : ytd-playlist-video-list-renderer > ytd-playlist-video-renderer ;
 *   - la nouvelle : yt-item-section-renderer > #contents > div > yt-lockup-view-model.
 */

(() => {
  if (window.__yttoolsPlaylist) return;
  const TV = window.__yttools;
  if (!TV) return;

  const racine = document.documentElement;
  const ID = 'yttools-pl-recherche';
  const CHARGE = 'yttools-pl-tout-charger';
  const CACHE = 'yttools-pl-cache';
  const ITEMS = 'ytd-playlist-video-renderer, yt-lockup-view-model';
  const SUITE = 'ytd-continuation-item-renderer, yt-continuation-item-view-model';
  const ICONES = {
    loupe: 'M20.87 20.17l-5.59-5.59A6.96 6.96 0 0017 10a7 7 0 10-7 7c1.75 0 3.35-.65 4.58-1.71l5.59 5.59.7-.71ZM10 16a6 6 0 110-12 6 6 0 010 12Z',
    effacer: 'm12.71 12 8.15 8.15-.71.71L12 12.71l-8.15 8.15-.71-.71L11.29 12 3.15 3.85l.71-.71L12 11.29l8.15-8.15.71.71L12.71 12z'
  };
  let mots = [];

  const actif = () => TV.settings.get().playlistSearch !== false;

  /** « Évènement  Été » -> « evenement ete » */
  const normaliser = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  /** Tous les mots cherches sont-ils dans le texte ? */
  const correspond = (texte, cherche) => cherche.every((m) => texte.includes(m));

  /**
   * La liste des videos de la playlist affichee :
   *   liste   : ou poser le champ, en tete, s'il n'y a pas d'ancre ;
   *   ancre   : ou poser le champ (juste avant elle) ;
   *   contenu : l'element dont chaque enfant porte une video.
   */
  function zone() {
    if (location.pathname !== '/playlist') return null;
    const page = document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden])') || document;
    const ancienne = page.querySelector('ytd-playlist-video-list-renderer');
    if (ancienne) {
      const entete = ancienne.closest('ytd-item-section-renderer')?.querySelector(':scope > #header');
      return { liste: ancienne, ancre: entete && entete.childElementCount ? entete : null,
        contenu: ancienne.querySelector('#contents') || ancienne };
    }
    for (const section of page.querySelectorAll('yt-item-section-renderer')) {
      const contenu = section.querySelector(':scope > #contents');
      if (!contenu || !contenu.querySelector('yt-lockup-view-model')) continue;
      const entete = section.querySelector(':scope > #header');
      return { liste: contenu, ancre: entete && entete.childElementCount ? entete : contenu, contenu };
    }
    return null;
  }

  /** Titre et chaine d'une video, dans les deux mises en page. */
  function texteVideo(v) {
    const titre = v.querySelector('#video-title, .ytLockupMetadataViewModelTitle, h3');
    const chaine = v.querySelector('ytd-channel-name, yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow');
    return normaliser(`${(titre && titre.textContent) || ''} ${(chaine && chaine.textContent) || ''}`);
  }

  /** Ce qu'il faut masquer : l'enfant direct du contenu qui porte la video. */
  function bloc(v, contenu) {
    let n = v;
    while (n.parentElement && n.parentElement !== contenu) n = n.parentElement;
    return n.parentElement === contenu ? n : v;
  }

  function icone(nom) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONES[nom]);
    svg.appendChild(p);
    return svg;
  }

  function creer() {
    const boite = document.createElement('div');
    boite.id = ID;
    const loupe = document.createElement('span');
    loupe.className = 'yttools-pl-loupe';
    loupe.appendChild(icone('loupe'));
    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Rechercher dans la playlist';
    input.setAttribute('aria-label', 'Rechercher dans la playlist');
    const compte = document.createElement('span');
    compte.className = 'yttools-pl-compte';
    compte.setAttribute('aria-live', 'polite');
    const effacer = document.createElement('button');
    effacer.type = 'button';
    effacer.className = 'yttools-pl-effacer';
    effacer.title = 'Effacer la recherche';
    effacer.setAttribute('aria-label', 'Effacer la recherche');
    effacer.hidden = true;
    effacer.appendChild(icone('effacer'));

    input.addEventListener('input', () => {
      mots = normaliser(input.value).split(' ').filter(Boolean);
      effacer.hidden = !input.value;
      filtrer();
    });
    // Les raccourcis de YouTube (k, j, l, /…) ne doivent pas partir pendant la saisie.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && input.value) { input.value = ''; input.dispatchEvent(new Event('input')); }
    });
    effacer.addEventListener('click', () => { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); });
    boite.append(loupe, input, compte, effacer);
    return boite;
  }

  function toutMontrer() {
    document.querySelectorAll('.' + CACHE).forEach((n) => n.classList.remove(CACHE));
  }

  function filtrer() {
    const z = zone();
    const boite = document.getElementById(ID);
    if (!z || !boite) { racine.classList.remove(CHARGE); return; }
    let visibles = 0;
    for (const v of z.contenu.querySelectorAll(ITEMS)) {
      const ok = !mots.length || correspond(texteVideo(v), mots);
      bloc(v, z.contenu).classList.toggle(CACHE, !ok);
      if (ok) visibles++;
    }
    const encore = !!z.contenu.querySelector(SUITE);
    racine.classList.toggle(CHARGE, mots.length > 0 && encore);
    boite.querySelector('.yttools-pl-compte').textContent = !mots.length ? ''
      : encore ? 'Chargement de toute la playlist…'
        : visibles ? `${visibles} vidéo${visibles > 1 ? 's' : ''}` : 'Aucune vidéo ne correspond';
  }

  function maj() {
    const z = actif() ? zone() : null;
    let boite = document.getElementById(ID);
    if (!z) {
      boite?.remove();
      mots = [];
      racine.classList.remove(CHARGE);
      toutMontrer();
      return;
    }
    const idListe = new URLSearchParams(location.search).get('list') || '';
    if (boite && boite.dataset.liste !== idListe) {
      // Autre playlist : on repart d'un champ vide.
      boite.remove();
      boite = null;
      mots = [];
      toutMontrer();
    }
    if (!boite) { boite = creer(); boite.dataset.liste = idListe; }
    // Deplace (et non recree) : la recherche en cours survit a l'arrivee des boutons de tri.
    const enPlace = z.ancre ? boite.nextElementSibling === z.ancre : boite.parentElement === z.liste && boite === z.liste.firstElementChild;
    if (!enPlace) { if (z.ancre) z.ancre.before(boite); else z.liste.prepend(boite); }
    if (mots.length) filtrer();
  }

  let prevu = false;
  new MutationObserver(() => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; maj(); });
  }).observe(racine, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', maj);
  TV.settings.onChange(maj);
  TV.settings.ready.then(maj);

  window.__yttoolsPlaylist = { normaliser, correspond, zone, maj, filtrer };
})();
