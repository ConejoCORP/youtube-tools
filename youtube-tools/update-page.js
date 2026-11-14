'use strict';

/**
 * YouTube Tools — page « Mise a jour » (update.html), ouverte dans un onglet
 * depuis le bandeau du popup.
 *
 * Elle affiche la version disponible et ses nouveautes, puis, sur demande,
 * confie l'installation a update-core.js. Pourquoi un onglet : le choix d'un
 * dossier fermerait le popup en plein milieu.
 *
 * Ce fichier remplace l'ancien update.js, que l'antivirus de Windows (Defender,
 * detection automatique « !cl ») prenait a tort pour un logiciel malveillant et
 * supprimait, cassant la page. Meme role, code reecrit.
 */

(() => {
  const U = window.__yttoolsUpdate;
  const $ = (id) => document.getElementById(id);
  const ui = {
    etat: $('etat'),
    notes: $('notes'),
    bouton: $('installer'),
    suivi: $('progres'),
    manuel: $('manuel'),
    bienvenue: $('bienvenue'),
    dossierEtat: $('dossierEtat'),
    choisir: $('choisirDossier'),
    ouEstIl: $('ouEstIl')
  };
  let annonce = null;                       // derniere version annoncee par GitHub
  // Ouverte par le service worker juste apres l'installation (update.html?bienvenue=1).
  const accueil = new URLSearchParams(location.search).has('bienvenue');
  ui.bienvenue.hidden = !accueil;

  // Meme theme que le popup.
  chrome.storage.local.get('yttools')
    .then((s) => { if (s && s.yttools && s.yttools.theme) document.documentElement.dataset.theme = s.yttools.theme; })
    .catch(() => {});

  function suivi(texte, erreur) {
    ui.suivi.hidden = false;
    ui.suivi.textContent = texte;
    ui.suivi.classList.toggle('is-err', !!erreur);
  }

  function afficher(info) {
    const actuelle = chrome.runtime.getManifest().version;
    if (!info) {
      ui.etat.textContent = 'Impossible de vérifier les mises à jour pour le moment (GitHub injoignable, ou extension installée depuis une boutique).';
      ui.bouton.hidden = true;
      return;
    }
    annonce = info;
    if (!info.disponible) {
      ui.etat.textContent = `YouTube Tools est à jour (version ${actuelle}).`;
      ui.bouton.hidden = true;
      ui.notes.hidden = true;
      return;
    }
    ui.etat.textContent = `Version ${info.latest} disponible — tu as la ${actuelle}.`;
    ui.notes.hidden = !info.notes;
    ui.notes.textContent = info.notes || '';
    ui.bouton.hidden = false;
  }

  ui.bouton.addEventListener('click', async () => {
    if (!annonce) return;
    ui.bouton.disabled = true;
    try {
      await U.installer(annonce, (t) => suivi(t));
      suivi(`Version ${annonce.latest} installée. Rechargement de l'extension… Pense à rafraîchir (F5) tes onglets YouTube.`);
      setTimeout(() => chrome.runtime.reload(), 1500);
    } catch (e) {
      const nom = e && e.name;
      if (nom === 'AbortError' || nom === 'NotAllowedError') suivi('Mise à jour annulée.');
      else suivi(`La mise à jour n'a pas abouti : ${(e && e.message) || e}`, true);
      ui.bouton.disabled = false;
    }
  });

  ui.manuel.addEventListener('click', () => chrome.tabs.create({ url: U.RELEASES_URL }));

  /* ------------------------------------------------- dossier de l'extension */

  /**
   * Brave (par defaut) et certains navigateurs ne laissent pas une page
   * modifier un dossier : au lieu d'un bouton qui echouerait, on explique.
   */
  function sansAcces() {
    const brave = U.estBrave();
    $('sansAcces').hidden = false;
    $('sansAccesBrave').hidden = !brave;
    $('drapeau').textContent = U.DRAPEAU_BRAVE;
    $('sansAccesTexte').textContent = brave
      ? "Brave bloque par défaut l'accès aux dossiers dont la mise à jour automatique a besoin. Pour l'activer, une fois pour toutes :"
      : "Ce navigateur ne laisse pas une extension modifier son dossier : les mises à jour se font à la main, avec le bouton ci-dessous.";
    ui.dossierEtat.hidden = true;
    ui.choisir.hidden = true;
    // Sans acces, « Mettre a jour maintenant » echouerait : on garde le telechargement a la main.
    ui.bouton.classList.add('maj-cache');
    ui.manuel.className = brave ? 'ghost' : 'cta';
  }

  $('copierDrapeau').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(U.DRAPEAU_BRAVE);
      $('copierDrapeau').textContent = 'Copié !';
    } catch {
      $('copierDrapeau').textContent = 'Sélectionne-la et copie-la';
    }
  });

  /** Ferme l'onglet de cette page (ouvert par l'extension, elle peut le fermer). */
  function fermer() {
    try {
      chrome.tabs.getCurrent((t) => {
        if (t && t.id !== undefined) chrome.tabs.remove(t.id);
        else window.close();
      });
    } catch {
      window.close();
    }
  }

  async function majDossier() {
    if (!U.peutEcrire()) { sansAcces(); return; }
    const nom = await U.dossierMemorise().catch(() => null);
    ui.dossierEtat.textContent = nom
      ? `Enregistré : « ${nom} ». Les mises à jour s'y installent sans que tu aies à le chercher.`
      : 'Pas encore choisi : il te sera demandé à la première mise à jour.';
    ui.choisir.textContent = nom ? 'Choisir un autre dossier' : 'Choisir le dossier';
    // A l'accueil, c'est l'action principale de la page.
    ui.choisir.className = accueil && !nom ? 'cta' : 'ghost';
  }

  ui.choisir.addEventListener('click', async () => {
    ui.choisir.disabled = true;
    try {
      const d = await U.choisirDossier();
      // Une mise a jour attend ? On reste, pour qu'elle puisse etre lancee.
      const attendue = !!(annonce && annonce.disponible);
      suivi(`C'est le bon dossier ✓ Les mises à jour iront dans « ${d.name} ».${attendue ? '' : ' Cette page va se fermer.'}`);
      if (!attendue) setTimeout(fermer, 2500);
    } catch (e) {
      const nom = e && e.name;
      if (nom === 'AbortError' || nom === 'NotAllowedError') suivi('Aucun dossier choisi.');
      else suivi(`${(e && e.message) || e}`, true);
    } finally {
      ui.choisir.disabled = false;
      majDossier();
    }
  });

  // La page des extensions de Chrome affiche le chemin complet (« Chargée
  // depuis »), que l'extension elle-meme ne peut pas lire.
  ui.ouEstIl.addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));

  majDossier();

  // Le dernier resultat connu tout de suite, puis celui de GitHub.
  U.dernierConnu().then((info) => { if (info) afficher(info); }).catch(() => {});
  U.verifier().then(afficher).catch(() => afficher(null));
})();
