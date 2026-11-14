'use strict';

/**
 * YouTube Studio — heure exacte de publication au survol d'une date (Contenu).
 *
 * Studio n'affiche que le jour (« 3 janv. 2026 »). L'heure est pourtant deja
 * chargee avec la ligne : studio-page.js (monde de la page) la recopie dans
 * l'attribut data-yttools-heure de chaque ligne, sous la forme
 * « idVideo publieeSecondes importeeSecondes ». Ici, on l'affiche dans une
 * bulle au survol de la date. Aucune requete. Idee reprise de SQUIDUU.
 */

(() => {
  if (window.__yttoolsHeureStudio) return;
  const TV = window.__yttools;
  if (!TV) return;

  const racine = document.documentElement;
  const BULLE = 'yttools-heure-bulle';
  const actif = () => TV.settings.get().publishTime !== false;

  /** « 9yqN26XAGbI 1767434069 1767434035 » -> { id, publiee, importee } (secondes). */
  function lireAttribut(val) {
    const [id, p, c] = String(val || '').split(' ');
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    return { id, publiee: Number(p) || 0, importee: Number(c) || 0 };
  }

  /** « samedi 3 janvier 2026 à 10:54:29 », dans le fuseau du navigateur. */
  function formater(secondes, langue) {
    return new Intl.DateTimeFormat(langue || 'fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(secondes * 1000));
  }

  /**
   * Le texte de la bulle pour une ligne, ou null. Une video programmee n'a pas
   * encore d'heure de publication : on ne montre rien plutot qu'une heure fausse.
   */
  function texte(row) {
    const d = lireAttribut(row.getAttribute('data-yttools-heure'));
    if (!d) return null;
    const a = row.querySelector('a[href*="/video/"]');
    if (a && !(a.getAttribute('href') || '').includes(d.id)) return null;   // ligne recyclee, pas encore relue
    const libelle = ((row.querySelector('.tablecell-date .cell-description') || {}).textContent || '').trim();
    if (/program|sched/i.test(libelle)) return null;
    const langue = racine.lang || 'fr-FR';
    const fr = /^fr/i.test(langue);
    const maintenant = Date.now() / 1000;
    if (d.publiee > 0 && d.publiee <= maintenant) return (fr ? 'Publiée le ' : 'Published ') + formater(d.publiee, langue);
    if (d.importee > 0) return (fr ? 'Importée le ' : 'Uploaded ') + formater(d.importee, langue);
    return null;
  }

  function cacher() { document.getElementById(BULLE)?.remove(); }

  function montrer(cellule, txt) {
    let b = document.getElementById(BULLE);
    if (!b) {
      b = document.createElement('div');
      b.id = BULLE;
      b.setAttribute('role', 'tooltip');
      document.body.appendChild(b);
    }
    b.textContent = txt;
    const r = cellule.getBoundingClientRect();
    const l = b.offsetWidth;
    b.style.left = Math.max(8, Math.min(innerWidth - l - 8, r.left + r.width / 2 - l / 2)) + 'px';
    b.style.top = (r.bottom + 6 + b.offsetHeight > innerHeight ? r.top - b.offsetHeight - 6 : r.bottom + 6) + 'px';
  }

  let survolee = null;
  document.addEventListener('mouseover', (e) => {
    if (!actif()) return;
    const cellule = e.target.closest && e.target.closest('ytcp-video-row .tablecell-date');
    if (cellule === survolee) return;
    survolee = cellule;
    if (!cellule) { cacher(); return; }
    const txt = texte(cellule.closest('ytcp-video-row'));
    if (txt) montrer(cellule, txt); else cacher();
  }, true);
  addEventListener('scroll', () => { survolee = null; cacher(); }, true);

  function maj() {
    racine.classList.toggle('yttools-heure-studio', actif());
    if (!actif()) cacher();
  }
  TV.settings.onChange(maj);
  TV.settings.ready.then(maj);
  maj();

  window.__yttoolsHeureStudio = { lireAttribut, formater, texte };
})();
