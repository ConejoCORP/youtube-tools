'use strict';

/**
 * YouTube Tools — heure exacte de mise en ligne, sur la page d'une video.
 *
 * Sous la video, une fois la description ouverte, YouTube ecrit la date
 * (« 17 août 2026 ») mais jamais l'heure. Elle figure pourtant dans les donnees
 * deja chargees par la page : rank-bridge.js la recopie (champ `published`
 * de l'attribut data-yttools-rank-src). On l'ajoute juste apres la date :
 * « 17 août 2026 à 18:00 ». Aucune requete. Idee reprise de SQUIDUU.
 */

(() => {
  if (window.__yttoolsHeureVideo) return;
  const TV = window.__yttools;
  if (!TV) return;

  const CLS = 'yttools-heure';
  const actif = () => TV.settings.get().watchTime !== false;

  /** La date de mise en ligne de la video affichee, si elle porte une heure. */
  function datePubliee() {
    const v = new URLSearchParams(location.search).get('v');
    let src = null;
    try { src = JSON.parse(document.documentElement.getAttribute('data-yttools-rank-src') || 'null'); } catch { src = null; }
    // « 2026-08-17 » seul (anciennes donnees) ne dit rien de l'heure.
    if (!v || !src || src.id !== v || !/T\d{2}:\d{2}/.test(src.published || '')) return null;
    const d = new Date(src.published);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function suffixe(d, langue) {
    const l = langue || 'fr-FR';
    const h = d.toLocaleTimeString(l, { hour: '2-digit', minute: '2-digit' });
    return /^fr/i.test(l) ? ` à ${h}` : ` at ${h}`;
  }

  /**
   * Le morceau de texte qui porte la date absolue : celui qui contient une
   * annee. « il y a 3 jours » (description fermee) n'en a pas : rien a faire.
   *
   * Deux formes selon la video : des <span> (« 1 659 225 vues », « 17 août
   * 2026 »), ou — video recente, vues dans le compteur anime a part — la date
   * seule, en texte nu dans #info. On regarde donc tous les noeuds, pas
   * seulement les balises.
   */
  function morceauDate(info) {
    return Array.from(info.childNodes).find((n) =>
      (n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains(CLS))) &&
      /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/.test(n.textContent) && !TV.RE.views.test(n.textContent)) || null;
  }

  function maj() {
    const info = document.querySelector('ytd-watch-metadata ytd-watch-info-text #info');
    const actuel = info ? info.querySelector('.' + CLS) : document.querySelector('.' + CLS);
    if (location.pathname !== '/watch' || !info || !actif()) { actuel?.remove(); return; }

    const d = datePubliee();
    const cible = d && morceauDate(info);
    if (!cible) { actuel?.remove(); return; }
    const txt = suffixe(d, document.documentElement.lang);
    if (actuel && actuel.textContent === txt && actuel.previousSibling === cible) return;
    actuel?.remove();
    const s = document.createElement('span');
    s.className = CLS;
    s.textContent = txt;
    cible.after(s);
  }

  let prevu = false;
  new MutationObserver(() => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; maj(); });
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['data-yttools-rank-src']
  });
  setInterval(maj, 1000);
  TV.settings.onChange(maj);
  TV.settings.ready.then(maj);

  window.__yttoolsHeureVideo = { datePubliee, suffixe, morceauDate, maj };
})();
