'use strict';

/**
 * YouTube Tools — classement sur 10 : pont avec la page.
 *
 * Tourne dans le monde de la PAGE (world: "MAIN" dans le manifest), seul
 * endroit ou les donnees de la video sont lisibles : YouTube les range dans des
 * proprietes JavaScript de ytd-watch-flexy, invisibles depuis le monde isole
 * ou vivent les autres scripts de l'extension.
 *
 * Ce script ne fait QUE recopier quelques informations publiques dans un
 * attribut du document, ou rank.js (classement), heure-video.js (heure de
 * mise en ligne), tags.js (tags), transcript.js et summary.js (chapitres) viennent les lire :
 *   id, chaine, titre, vues, date de publication, direct ou non, Short ou non,
 *   tags, chapitres, ainsi que la cle et la version d'API que la page utilise deja.
 * Il n'emet aucune requete, ne lit aucun cookie et ne touche a rien d'autre.
 */

(() => {
  if (window.__yttoolsRankBridge) return;
  window.__yttoolsRankBridge = true;

  const ATTR = 'data-yttools-rank-src';

  /**
   * Les chapitres de la video : ceux du createur (dans sa description), sinon
   * ceux que YouTube genere. Ils sont dans la reponse « watch next » que
   * ytd-watch-flexy garde (ou dans ytInitialData au premier chargement) ; on
   * verifie qu'elle parle bien de CETTE video, la navigation interne laissant
   * l'ancienne en place un instant. Liste vide s'il n'y en a pas.
   */
  function chapitres(flexy, id) {
    const sources = [flexy && flexy.__data && flexy.__data.data, window.ytInitialData];
    for (const d of sources) {
      try {
        const vid = d && d.currentVideoEndpoint && d.currentVideoEndpoint.watchEndpoint &&
                    d.currentVideoEndpoint.watchEndpoint.videoId;
        if (!d || vid !== id) continue;
        const barre = d.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer
          .decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer;
        const cartes = (barre && barre.markersMap) || [];
        const avec = (m) => m && m.value && Array.isArray(m.value.chapters) && m.value.chapters.length;
        const m = cartes.find((x) => x.key === 'DESCRIPTION_CHAPTERS' && avec(x)) ||
                  cartes.find((x) => /CHAPTERS/.test(x.key) && avec(x));
        if (!m) return { source: '', liste: [] };
        const liste = m.value.chapters.slice(0, 60).map((c) => {
          const r = c.chapterRenderer || {};
          const titre = (r.title && (r.title.simpleText ||
                         (r.title.runs || []).map((x) => x.text || '').join(''))) || '';
          return { t: Math.round((Number(r.timeRangeStartMillis) || 0) / 1000), titre: String(titre).slice(0, 100) };
        }).filter((c) => c.titre);
        return { source: m.key === 'DESCRIPTION_CHAPTERS' ? 'createur' : 'youtube', liste };
      } catch {
        return { source: '', liste: [] };        // pas de barre de chapitres : pas de chapitres
      }
    }
    return { source: '', liste: [] };
  }

  function publish() {
    if (location.pathname !== '/watch') return;
    const flexy = document.querySelector('ytd-watch-flexy');
    const player = document.querySelector('#movie_player');
    const pr = (flexy && flexy.playerData) ||
               (player && typeof player.getPlayerResponse === 'function' && player.getPlayerResponse());
    const d = pr && pr.videoDetails;
    if (!d || !d.videoId) return;

    const mf = (pr.microformat && pr.microformat.playerMicroformatRenderer) || {};
    const cfg = window.ytcfg;
    const get = (k) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : '') || '';

    const data = JSON.stringify({
      id: d.videoId,
      channel: d.channelId || '',
      title: d.title || '',
      views: Number(d.viewCount) || 0,
      published: (mf.liveBroadcastDetails && mf.liveBroadcastDetails.startTimestamp) || mf.publishDate || '',
      live: d.isLive === true || d.isUpcoming === true,
      short: mf.isShortsEligible === true,
      // Les tags que le createur a saisis (absents s'il n'en a mis aucun).
      tags: Array.isArray(d.keywords) ? d.keywords.filter((t) => typeof t === 'string') : [],
      // Pour le resume de la video, qui suit ce decoupage quand il existe.
      chapitres: chapitres(flexy, d.videoId),
      key: get('INNERTUBE_API_KEY'),
      version: get('INNERTUBE_CLIENT_VERSION')
    });

    const root = document.documentElement;
    if (root.getAttribute(ATTR) !== data) root.setAttribute(ATTR, data);
  }

  // YouTube est une application a page unique : la navigation ne recharge pas
  // le script. Les evenements couvrent le cas courant, l'intervalle rattrape
  // les donnees qui arrivent apres l'evenement.
  window.addEventListener('yt-navigate-finish', publish);
  window.addEventListener('yt-page-data-updated', publish);
  setInterval(publish, 1000);
  publish();
})();
