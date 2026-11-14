'use strict';

/**
 * YouTube Studio — video similaire de plusieurs Shorts d'un coup.
 *
 * Dans Contenu > Shorts, on coche plusieurs Shorts, puis Modifier > Video
 * similaire : on choisit la video (selecteur de Studio) ou on choisit de la
 * retirer, on confirme, et chaque Short est mis a jour, un par un.
 *
 * Ce script ne fait que l'interface. L'envoi a Studio est fait par
 * studio-page.js, dans la page : c'est la seule fonction de l'extension qui
 * utilise la session de l'utilisateur (voir l'en-tete de studio-page.js).
 * Idee et methode reprises de Better YouTube Studio (SQUIDUU).
 *
 * Tout est construit element par element : Studio impose les Trusted Types.
 */

(() => {
  if (window.__yttoolsSimilaire) return;
  const TV = window.__yttools;
  if (!TV) return;

  const racine = document.documentElement;
  const ID = /^[\w-]{11}$/;
  const ICONES = {
    poubelle: 'M11 17H9V8h2v9zm4-9h-2v9h2V8zm4-4v1h-1v16H6V5H5V4h4V3h6v1h4zm-2 1H7v15h10V5z',
    ok: 'M9.5 16.6 5.4 12.5l-1.4 1.4 5.5 5.5L20 8.9l-1.4-1.4z',
    erreur: 'M12.7 12l4.65-4.65-.7-.7L12 11.29 7.35 6.65l-.7.7L11.29 12l-4.64 4.65.7.7L12 12.71l4.65 4.64.7-.7z'
  };

  const etat = { mode: 'definir', video: null, enCours: false };
  let ticket = 0;

  const surShorts = () => /^\/channel\/UC[\w-]{22}\/videos\/short(?:\/|$)/.test(location.pathname);
  const actif = () => TV.settings.get().shortsRelated !== false && surShorts();

  /* ------------------------------------------------------------- outils DOM */

  function el(tag, classe, texte) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texte !== undefined) n.textContent = texte;
    return n;
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

  function bouton(texte, classe, action) {
    const b = el('button', 'yttools-sim-btn ' + classe, texte);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }

  /* ------------------------------------------------------------- selection */

  const barre = () => document.querySelector('ytcp-video-bulk-actions ytcp-bulk-actions');

  /** Les Shorts coches et affiches : { id, titre }. */
  function coches() {
    const vus = new Set();
    const res = [];
    for (const row of document.querySelectorAll('ytcp-video-row')) {
      if (!row.querySelector('.tablecell-selection ytcp-checkbox-lit[checked]')) continue;
      const a = row.querySelector('a[href*="/video/"]');
      const m = ((a && a.getAttribute('href')) || '').match(/\/video\/([\w-]{11})/);
      if (!m || vus.has(m[1])) continue;
      vus.add(m[1]);
      const t = row.querySelector('#video-title');
      res.push({ id: m[1], titre: ((t && t.textContent) || m[1]).trim() });
    }
    return res;
  }

  /** « 120 vidéos sélectionnées » -> 120 (0 si illisible). */
  function annonces() {
    const b = barre();
    const txt = (b && b.querySelector('.selection-label') && b.querySelector('.selection-label').textContent) || '';
    const m = txt.match(/\d[\d\s.,]*/);   // \s couvre aussi les espaces insecables
    return m ? Number(m[0].replace(/\D/g, '')) || 0 : 0;
  }

  /* ------------------------------------------------------- entree du menu */

  function fermerMenu(liste) {
    const esc = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true };
    liste.dispatchEvent(new KeyboardEvent('keydown', esc));
    if (document.activeElement) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', esc));
  }

  function poserEntree() {
    for (const titre of document.querySelectorAll('tp-yt-paper-item[test-id="TITLE"]')) {
      const liste = titre.parentElement;
      if (!liste || !liste.querySelector(':scope > tp-yt-paper-item[test-id="DESCRIPTION"]')) continue;
      if (liste.querySelector(':scope > .yttools-sim-entree')) continue;

      const entree = el('div', 'yttools-sim-entree', 'Vidéo similaire');
      entree.setAttribute('role', 'option');
      entree.tabIndex = 0;
      // Meme allure que les entrees de Studio, quel que soit son theme.
      const cs = getComputedStyle(titre);
      for (const p of ['minHeight', 'paddingLeft', 'paddingRight', 'font', 'color']) entree.style[p] = cs[p];
      // La liste de Studio ne doit pas traiter cette entree comme une des siennes.
      for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown']) {
        entree.addEventListener(t, (e) => {
          e.stopPropagation();
          if (t === 'keydown' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); entree.click(); }
        });
      }
      entree.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fermerMenu(liste);
        ouvrirEditeur();
      });
      const apres = liste.querySelector(':scope > tp-yt-paper-item[test-id="MONETIZATION"]');
      const separateur = liste.querySelector(':scope > tp-yt-paper-item[test-id="SEPARATOR"]');
      if (apres) apres.after(entree);
      else if (separateur) separateur.before(entree);
      else liste.append(entree);
    }
  }

  /* ------------------------------------------------------------- l'editeur */

  function ouvrirEditeur() {
    const b = barre();
    if (!b || etat.enCours) return;
    fermerEditeur();
    etat.mode = 'definir';
    etat.video = null;
    b.classList.add('yttools-sim-edition');

    const entete = b.querySelector('#header');
    const actions = el('div', 'yttools-sim-actions');
    actions.id = 'yttools-sim-actions';
    const annuler = bouton('Annuler', 'yttools-sim-tonal', fermerEditeur);
    const appliquer = bouton('Appliquer', 'yttools-sim-plein', confirmer);
    appliquer.dataset.role = 'appliquer';
    // Les couleurs de l'en-tete de Studio (sombre en theme clair, et inversement).
    if (entete) {
      const cs = getComputedStyle(entete);
      annuler.style.color = cs.color;
      appliquer.style.background = cs.color;
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) appliquer.style.color = cs.backgroundColor;
      actions.append(annuler, appliquer);
      entete.appendChild(actions);
    }

    const editeur = el('div', 'yttools-sim-editeur');
    editeur.id = 'yttools-sim-editeur';
    (b.querySelector('#editors') || b).prepend(editeur);
    dessinerEditeur();
  }

  function fermerEditeur() {
    document.getElementById('yttools-sim-actions')?.remove();
    document.getElementById('yttools-sim-editeur')?.remove();
    document.querySelectorAll('.yttools-sim-edition').forEach((n) => n.classList.remove('yttools-sim-edition'));
  }

  function dessinerEditeur() {
    const ed = document.getElementById('yttools-sim-editeur');
    if (!ed) return;
    ed.textContent = '';

    const tete = el('div', 'yttools-sim-tete');
    tete.appendChild(el('span', 'yttools-sim-titre', 'Vidéo similaire'));
    const jeter = el('button', 'yttools-sim-icone');
    jeter.type = 'button';
    jeter.title = 'Annuler';
    jeter.setAttribute('aria-label', 'Annuler');
    jeter.appendChild(icone('poubelle'));
    jeter.addEventListener('click', fermerEditeur);
    tete.appendChild(jeter);

    const ligne = el('div', 'yttools-sim-ligne');

    const type = el('label', 'yttools-sim-champ');
    type.appendChild(el('span', 'yttools-sim-etiquette', 'Type de modification'));
    const choix = el('select', 'yttools-sim-select');
    for (const [val, txt] of [['definir', 'Définir la vidéo similaire'], ['retirer', 'Retirer la vidéo similaire']]) {
      const o = el('option', '', txt);
      o.value = val;
      choix.appendChild(o);
    }
    choix.value = etat.mode;
    choix.addEventListener('change', () => { etat.mode = choix.value; dessinerEditeur(); });
    type.appendChild(choix);
    ligne.appendChild(type);

    if (etat.mode === 'definir') {
      const champ = el('button', 'yttools-sim-champ yttools-sim-video');
      champ.type = 'button';
      champ.appendChild(el('span', 'yttools-sim-etiquette', 'Vidéo'));
      const val = el('span', 'yttools-sim-valeur');
      if (etat.video) {
        const img = el('img', 'yttools-sim-miniature');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.src = `https://i.ytimg.com/vi/${etat.video.id}/mqdefault.jpg`;
        val.append(img, el('span', 'yttools-sim-texte', etat.video.titre || etat.video.id));
      } else {
        val.appendChild(el('span', 'yttools-sim-vide', 'Choisir une vidéo'));
      }
      champ.appendChild(val);
      champ.addEventListener('click', choisirVideo);
      ligne.appendChild(champ);
    }
    ed.append(tete, ligne);

    const n = coches().length;
    const total = annonces();
    if (total > n && n) {
      ed.appendChild(el('p', 'yttools-sim-note',
        `Seuls les ${n} Shorts cochés sur cette page seront modifiés (Studio en annonce ${total}).`));
    }
    majBouton();
  }

  function majBouton() {
    const b = document.querySelector('#yttools-sim-actions [data-role="appliquer"]');
    if (b) b.disabled = !coches().length || (etat.mode === 'definir' && !etat.video);
  }

  /** Selecteur de Studio ; a defaut, un champ ou coller le lien de la video. */
  function choisirVideo() {
    const t = 'c' + (++ticket);
    let repondu = false;
    const fin = () => { document.removeEventListener('yttools-similaire-choisi', ecoute); clearTimeout(minuteur); };
    const ecoute = (e) => {
      let d = null;
      try { d = JSON.parse(e.detail); } catch { return; }
      if (!d || d.ticket !== t) return;
      repondu = true;
      if (d.ouvert) return;
      fin();
      if (d.indisponible) { saisirLien(); return; }
      if (d.videoId && ID.test(d.videoId)) {
        etat.video = { id: d.videoId, titre: d.titre || d.videoId };
        dessinerEditeur();
      }
    };
    document.addEventListener('yttools-similaire-choisi', ecoute);
    const minuteur = setTimeout(() => { if (!repondu) { fin(); saisirLien(); } }, 1500);
    document.dispatchEvent(new CustomEvent('yttools-similaire-choisir', {
      detail: JSON.stringify({ ticket: t, exclure: coches().map((c) => c.id),
        titre: 'Choisir la vidéo similaire', recherche: 'Rechercher dans tes vidéos' })
    }));
  }

  /** « https://youtu.be/ID », « …watch?v=ID », « …/shorts/ID », « …/video/ID » ou l'ID seul. */
  function idDepuis(texte) {
    const t = String(texte || '').trim();
    if (ID.test(t)) return t;
    const m = t.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/video\/|\/live\/)([\w-]{11})(?![\w-])/);
    return m ? m[1] : null;
  }

  function saisirLien() {
    const val = document.querySelector('#yttools-sim-editeur .yttools-sim-video');
    if (!val) return;
    const champ = el('label', 'yttools-sim-champ yttools-sim-video');
    champ.appendChild(el('span', 'yttools-sim-etiquette', 'Lien de la vidéo'));
    const input = el('input', 'yttools-sim-saisie');
    input.type = 'text';
    input.placeholder = 'Colle le lien de la vidéo';
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      const id = idDepuis(input.value);
      etat.video = id ? { id, titre: id } : null;
      champ.classList.toggle('yttools-sim-invalide', !!input.value && !id);
      majBouton();
    });
    champ.appendChild(input);
    val.replaceWith(champ);
    input.focus();
  }

  /* ------------------------------------------------- confirmation et envoi */

  function fermerDialogue() {
    if (etat.enCours) return;
    document.getElementById('yttools-sim-voile')?.remove();
  }

  const RAISONS = {
    contexte: "Studio n'a pas encore fourni sa session : coche ou décoche un Short, puis réessaie.",
    session: 'Session Studio introuvable : recharge la page, puis réessaie.'
  };
  const raison = (code) => RAISONS[code] || (/^http\d+$/.test(code)
    ? `Studio a refusé la demande (erreur ${code.slice(4)}).`
    : `Studio a répondu : ${code}.`);

  function confirmer() {
    const shorts = coches().filter((c) => !etat.video || c.id !== etat.video.id);
    const cible = etat.mode === 'definir' ? (etat.video && etat.video.id) : '';
    if (!shorts.length || (etat.mode === 'definir' && !cible)) return;
    fermerDialogue();

    const voile = el('div', 'yttools-sim-voile');
    voile.id = 'yttools-sim-voile';
    const boite = el('div', 'yttools-sim-dialogue');
    boite.setAttribute('role', 'dialog');
    boite.setAttribute('aria-modal', 'true');
    const n = shorts.length;
    const titre = el('h2', '', cible
      ? `Changer la vidéo similaire de ${n} Short${n > 1 ? 's' : ''} ?`
      : `Retirer la vidéo similaire de ${n} Short${n > 1 ? 's' : ''} ?`);
    titre.id = 'yttools-sim-dialogue-titre';
    boite.setAttribute('aria-labelledby', titre.id);
    const texte = el('p', 'yttools-sim-texte-dialogue', cible
      ? `« ${etat.video.titre} » deviendra la vidéo similaire de :`
      : 'Ces Shorts n’auront plus de vidéo similaire :');
    const liste = el('ul', 'yttools-sim-liste');
    const lignes = new Map();
    for (const s of shorts) {
      const li = el('li');
      const statut = el('span', 'yttools-sim-statut');
      li.append(statut, el('span', 'yttools-sim-nom', s.titre));
      liste.appendChild(li);
      lignes.set(s.id, li);
    }
    const info = el('p', 'yttools-sim-info',
      'Les Shorts sont modifiés un par un, exactement comme si tu le faisais dans Studio. La vidéo similaire actuelle de chacun est remplacée.');
    const pied = el('div', 'yttools-sim-pied');
    const annuler = bouton('Annuler', 'yttools-sim-texte-btn', fermerDialogue);
    const ok = bouton('Appliquer', 'yttools-sim-plein yttools-sim-bleu', () => lancer(shorts, cible, { titre, info, pied, annuler, ok, lignes }));
    pied.append(annuler, ok);
    boite.append(titre, texte, liste, info, pied);
    voile.appendChild(boite);
    voile.addEventListener('mousedown', (e) => { if (e.target === voile) fermerDialogue(); });
    voile.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') fermerDialogue(); });
    document.body.appendChild(voile);
    ok.focus();
  }

  function lancer(shorts, cible, ui) {
    if (etat.enCours) return;
    etat.enCours = true;
    ui.ok.disabled = true;
    ui.annuler.disabled = true;
    ui.info.textContent = `Mise à jour… 0 / ${shorts.length}`;
    for (const li of ui.lignes.values()) li.dataset.etat = 'attente';

    const t = 's' + (++ticket);
    let reussis = 0;
    const echecs = [];
    const progres = (e) => {
      let d = null;
      try { d = JSON.parse(e.detail); } catch { return; }
      if (!d || d.ticket !== t) return;
      const li = ui.lignes.get(d.id);
      if (li) {
        li.dataset.etat = d.res === 'ok' ? 'ok' : 'erreur';
        const s = li.querySelector('.yttools-sim-statut');
        s.textContent = '';
        s.appendChild(icone(d.res === 'ok' ? 'ok' : 'erreur'));
        if (d.res !== 'ok') li.title = raison(d.res);
      }
      if (d.res === 'ok') reussis++; else echecs.push(d.res);
      ui.info.textContent = `Mise à jour… ${d.fait} / ${d.total}`;
    };
    const fini = (e) => {
      let d = null;
      try { d = JSON.parse(e.detail); } catch { return; }
      if (!d || d.ticket !== t) return;
      terminer();
    };
    let garde = null;
    function terminer() {
      document.removeEventListener('yttools-similaire-progres', progres);
      document.removeEventListener('yttools-similaire-fini', fini);
      clearTimeout(garde);
      etat.enCours = false;
      const n = shorts.length;
      if (!echecs.length && reussis === n) {
        ui.titre.textContent = `${n} Short${n > 1 ? 's' : ''} mis à jour`;
        ui.info.textContent = cible ? 'La nouvelle vidéo similaire est en place.' : 'La vidéo similaire a été retirée.';
        fermerEditeur();
      } else {
        ui.titre.textContent = reussis
          ? `${reussis} Short${reussis > 1 ? 's' : ''} mis à jour, ${n - reussis} non`
          : 'Aucun Short n’a été modifié';
        ui.info.textContent = raison(echecs[0] || 'erreur');
      }
      ui.annuler.remove();
      const fermer = bouton('Fermer', 'yttools-sim-plein yttools-sim-bleu', fermerDialogue);
      ui.ok.replaceWith(fermer);
      fermer.focus();
    }
    document.addEventListener('yttools-similaire-progres', progres);
    document.addEventListener('yttools-similaire-fini', fini);
    // Filet : si la page ne repond plus (script de page absent), on ne reste pas bloque.
    garde = setTimeout(() => { if (etat.enCours) { echecs.push('erreur'); terminer(); } }, 15000 + shorts.length * 8000);
    document.dispatchEvent(new CustomEvent('yttools-similaire-appliquer', {
      detail: JSON.stringify({ ticket: t, ids: shorts.map((s) => s.id), cible })
    }));
  }

  /* ---------------------------------------------------------------- suivi */

  function maj() {
    const on = actif();
    racine.classList.toggle('yttools-similaire', on);
    if (!on) {
      document.querySelectorAll('.yttools-sim-entree').forEach((n) => n.remove());
      fermerEditeur();
      return;
    }
    poserEntree();
    if (document.getElementById('yttools-sim-editeur')) {
      if (!coches().length && !etat.enCours) fermerEditeur();
      else majBouton();
    }
  }

  let prevu = false;
  new MutationObserver(() => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; maj(); });
  }).observe(racine, { childList: true, subtree: true });
  setInterval(maj, 1000);
  TV.settings.onChange(maj);
  TV.settings.ready.then(maj);

  window.__yttoolsSimilaire = { idDepuis, coches, annonces, maj, ouvrirEditeur, confirmer, etat };
})();
