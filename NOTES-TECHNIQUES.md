# Notes techniques

Les choix qui ne tiennent pas dans le README, et surtout **pourquoi** ils ont été faits. La plupart viennent d'un bug constaté sur une vraie page : c'est noté à chaque fois, parce que c'est ce qui empêche de les défaire par mégarde.

## Pourquoi l'ancienne version de PrevYou ne marchait plus

- **Manifest V2** : Chrome a désactivé les extensions MV2 courant 2024-2025.
- **Classes CSS renommées** : YouTube est passé des noms en kebab-case (`.yt-core-attributed-string`, `.yt-lockup-metadata-view-model__title`) à du camelCase (`ytAttributedStringHost`, `ytLockupMetadataViewModelTitle`). Tout code qui ciblait les anciens noms ne trouve plus rien.

C'est la leçon de départ : **ne jamais dépendre d'un nom de classe de YouTube.**

## L'aperçu de miniature ne pose pas de HTML figé

Il **clone une vraie carte** déjà présente sur la page, puis remplace son contenu : images, titre, chaîne, vues, durée. Le style, la taille et la grille restent donc ceux du layout courant, quoi que YouTube change.

Sécurités complémentaires :

- deux jeux de sélecteurs (anciens noms kebab-case et nouveaux camelCase) ;
- le texte est écrit dans le nœud feuille le plus « textuel », pas via un chemin DOM rigide ;
- repli `canvas` si une CSP venait à bloquer les images `data:` ;
- clics et survols neutralisés sur la fausse carte : aucune lecture ni navigation déclenchée ;
- la fausse carte est exclue de l'export CSV des vidéos de la page.

## Lire par le sens, pas par le nom

Aucun champ n'est repéré par sa classe. Un fragment « 379 k vues » est reconnu comme des vues, « il y a 1 mois » comme une date, « 1.4x » comme un multiplicateur. C'est ce qui permet de lire le multiplicateur de **vidIQ**, dont les classes sont hachées et changent à chaque version.

Points mis au jour en faisant tourner l'extracteur sur de vraies pages :

- au-delà du million, le français intercale un « de » : **« 1,2 M de vues »** ;
- les cartes compactes affichent le compte **sans le mot** : « 1 M », « 272 k » ;
- les cartes s'emboîtent — `ytd-rich-item-renderer` contient un `yt-lockup-view-model` — donc sans déduplication chaque vidéo compte double ;
- le sous-titre d'un Short agrège plusieurs informations (« 11 k vues · 6 hours ago ») et doit être découpé **avant** d'être classé, et les morceaux doivent *remplacer* le composite, pas le suivre ;
- le premier badge d'un Short est « Nouveau », pas une durée ;
- une playlist se reconnaît à sa pile de miniatures, sinon elle ressort comme une vidéo sans vues ni durée.

### Le piège des sélecteurs multiples

`document.querySelector('a, b, c')` renvoie le premier élément dans l'ordre **du document**, pas dans l'ordre des sélecteurs. La liste `'ytd-watch-info-text, #info-container, #info'` tombait sur un autre `#info` de la page, et les colonnes vues et date ressortaient vides. Les conteneurs sont donc essayés **un par un**.

## La transcription

### Le texte

À côté du timecode visible, YouTube place sa version parlée pour les lecteurs d'écran. Prendre le `textContent` de la ligne collait ce libellé au sous-titre : « 1 minute et 2 secondes**Every job is still random** ». Le texte est donc assemblé feuille par feuille, en écartant celles dont la durée parlée vaut **exactement** le début du segment — ce test d'égalité laisse intact un sous-titre qui commencerait par « 3 minutes plus tard ».

### La date

`date_iso` est toujours absolue. Trois sources, dans l'ordre, **toutes lues dans la page** :

1. les **microdonnées schema.org** (`meta[itemprop="datePublished"]`), exactes. Après une navigation interne ce bloc peut rester celui de la vidéo précédente : on ne s'en sert que si une de ses URL porte l'identifiant courant ;
2. la date affichée si elle est déjà absolue, convertie ;
3. sinon la date relative soustraite d'aujourd'hui. Approximatif, mais figé.

Les microdonnées donnent aussi les **comptes exacts** de vues et de likes. Le piège était l'ordre de priorité : le texte affiché passait devant, donc « 3,5 M de vues » donnait 3 500 000 arrondi alors que le compte exact était disponible juste à côté.

### Le multiplicateur

D'abord celui de **vidIQ**. Son panneau est `#video-companion-root`, et la valeur est sous l'étiquette « Outlier », dans `#long-scorecard-overlay`. Les classes de vidIQ sont hachées : on reconnaît la valeur à ce qu'elle dit (`1.6x`), comme pour les cartes de l'export. Après une navigation interne, ce panneau peut encore parler de la vidéo précédente. Sa miniature (`i.ytimg.com/vi/<id>/`) dit laquelle : si ce n'est pas la vidéo courante, on ne lit rien. vidIQ met plus de dix secondes à remplir son panneau. Un clic trop tôt tombe donc sur notre calcul.

Sinon, `computeMultiplier` (rank-core.js) divise les vues de la vidéo par la **médiane** des 9 précédentes, ramenées au même âge par la courbe du classement. On prend la médiane plutôt que la moyenne : un seul gros succès de la chaîne ne fait pas passer les autres vidéos pour des échecs.

- Pas de seuil de 24 h comme pour le classement : vidIQ affiche une valeur dès la première heure.
- La vidéo peut être trop ancienne pour la liste lue. Par exemple, une vidéo de 2023 sur une chaîne qui publie beaucoup, alors que les 20 pages lues (environ 600 vidéos) s'arrêtent à 2 ans et demi. vidIQ affiche alors « N/A ». Le calcul la compare aux 9 vidéos de la liste **les plus proches en âge**, donc les plus anciennes qu'on ait. C'est moins juste que ses vraies voisines, mais ça ne coûte aucune requête. Le CSV l'indique : `calculé (approx.)`.
- Le clic lance le calcul en même temps que la lecture de la transcription, et celui-ci est plafonné à 15 s. vidIQ passe toujours devant, même s'il s'affiche pendant ce temps.
- Le calcul passe par le même cache et le même verrou que le classement, sans relire les titres traduits. Quand le panneau du classement est déjà chargé, il ne fait donc aucune requête.
- Si le réglage « Classement sur 10 » est coupé, il n'est pas lancé : ce réglage reste le seul qui autorise des requêtes vers YouTube.

Mesuré sur trois vidéos d'une même chaîne :

| vidIQ | notre calcul |
|---|---|
| 1.2x | 0.9x |
| 1.6x | 1.2x |
| 1.8x | 2.2x |

Les deux sont du même ordre, sans être identiques. vidIQ compare à une courbe « typique » qu'il tire de son propre historique de vues, que nous n'avons pas.

### Aucune requête

Un repli interrogeait `/youtubei/v1/get_transcript`. Il a été retiré : mieux vaut perdre un filet de sécurité que de ressembler à du trafic automatisé. L'extension clique sur « Afficher la transcription » comme un humain, laisse YouTube faire sa propre requête, et lit le résultat.

### Panneaux à ne pas confondre

Les chapitres et les commentaires contiennent eux aussi des timecodes : ils sont explicitement écartés du repérage du panneau de transcription.

## Cohabiter avec d'autres extensions

Plusieurs boutons d'une page de lecture parlent de transcription et ne font pas la même chose. Better YouTube Studio ajoute son propre **« Copier la transcription »** à côté du **« Afficher la transcription »** de YouTube — et il ouvre un menu déroulant, pas le panneau.

Les deux libellés contiennent « transcri » : c'est le **verbe** qui les sépare. Un bouton qui dit « copier », « télécharger » ou « enregistrer » n'est jamais cliqué ; « afficher », « voir » ou « show » est préféré, de même qu'un vrai composant YouTube (`yt-button-shape`) face à un bouton injecté. Si le meilleur candidat n'ouvre rien, le suivant est essayé.

Même principe pour le **placement du panneau de classement** : il s'insère juste avant le bloc de suggestions de YouTube. Viser un élément de YouTube et non les panneaux des autres extensions compte, parce que vidIQ pose ses badges (VPH, multiplicateur) **à l'intérieur** des cartes suggérées — un ancrage cherchant « le dernier bloc contenant du vidIQ » désignait donc la liste entière, et le panneau finissait après toutes les suggestions, invisible en bas de colonne.

## Garder un bouton posé

YouTube reconstruit ses rangées en permanence, et un bouton injecté part avec elles. Les boutons partagent donc un même mécanisme (`keepMounted` dans `common.js`), avec deux garde-fous qui bouchent chacun le trou de l'autre :

- un **throttle à bord de fuite** : les mutations sont regroupées, mais la dernière n'est jamais perdue. Une version antérieure ignorait toute mutation survenue dans les 600 ms suivant une vérification aboutie — si YouTube reconstruisait la rangée pile dans cette fenêtre et que la page se taisait ensuite, aucune vérification ne se relançait et le bouton restait absent jusqu'à la navigation suivante ;
- une **relance espacée** tant que le bouton est attendu mais absent, pour ne dépendre d'aucune mutation future.

Le bouton de transcription s'insère par ailleurs en remontant du bloc J'aime jusqu'à l'enfant direct de la rangée : exiger que le bloc soit lui-même enfant direct le faisait partir en fin de rangée, hors du cadre du lecteur, dès que YouTube l'imbriquait d'un cran.

## Suivre le thème

Les jetons `--yt-spec-*` de YouTube ne sont **pas toujours définis**. Les boutons s'appuyaient dessus avec des couleurs de repli écrites pour le thème clair : en thème sombre, ils devenaient noirs sur fond noir.

Le thème est désormais **mesuré**, pas deviné : on remonte depuis le bouton jusqu'au premier ancêtre au fond opaque et on calcule sa luminance perceptuelle. Si tout est transparent, on retombe sur l'attribut `dark` de YouTube, puis sur celui du système. Mesurer plutôt que lire un indice, parce qu'un attribut peut être renommé alors qu'un fond reste un fond.

## Le classement sur 10

### Le modèle

Une vidéo est comparée aux 9 que sa chaîne a publiées juste avant. Les plus anciennes ayant eu plus de temps, on estime combien de vues chacune avait **au même âge**, avec une courbe de croissance (fonction de Hill) : `x = (h/24)^0,9`, `part = x / (x + 2^0,9)` — soit la moitié des vues en deux jours.

Les Shorts n'ont pas de date dans la liste d'une chaîne : ils sont comparés sur leurs vues actuelles. Avant 24 h, aucun classement, l'estimation serait trop instable.

Paramètres repris de **Better YouTube Studio** (SQUIDUU) pour obtenir les mêmes rangs.

### L'exception réseau

La liste des vidéos d'une chaîne n'est pas dans la page : il faut la demander à `/youtubei/v1/browse`. Garde-fous :

- `credentials: 'omit'` — **aucun cookie, aucune session**. Les requêtes ne sont pas attribuables à un compte ;
- uniquement sur `/watch`, et seulement si le réglage est actif ;
- cache de 6 h par chaîne, verrou pour ne pas charger deux fois les mêmes pages ;
- adresse relative, donc **aucune permission supplémentaire**.

Si une vidéo manque dans une liste en cache depuis plus de 10 min, la liste est relue une fois, au cas où la vidéo serait sortie entre-temps. Cette relecture n'a lieu que si la vidéo a pu être publiée **après** la lecture de la liste. Avant, une vidéo trop ancienne pour les 20 pages refaisait relire ces 20 pages à chaque visite, pour rien.

Mesuré : la suite de tests complète fait **11 requêtes en 2,3 s**, dont 0 porteuse de cookie. En usage, 1 à 3 requêtes par classement, puis 0 pendant 6 h sur la même chaîne.

Le mode « exact » de SQUIDUU pour sa propre chaîne (`yta_web/get_cards` signé avec le cookie SAPISID) **n'a pas été repris**, parce qu'il faut lire la session Google. Toutes les chaînes passent par l'estimation. **Merci de ne pas réintroduire d'accès à la session ou aux cookies sans en discuter.**

La réserve honnête : `/youtubei/v1/browse` est une API **interne**, non documentée, appelée avec une clé récupérée dans la page. C'est contraire aux conditions d'utilisation de YouTube, indépendamment du volume.

### Le pont

`rank-bridge.js` est la seule partie qui tourne dans le **monde de la page** (`world: "MAIN"`), parce que les données de la vidéo sont rangées dans des propriétés JavaScript de `ytd-watch-flexy`, invisibles depuis le monde isolé. Il ne fait que recopier quelques informations publiques dans un attribut du document. Il n'émet aucune requête et ne lit aucun cookie.

## Le résumé par Gemini

Repris de **Google More** (`tools/gemini-rewrite/`), qui pilote déjà la même page. Si Google modifie Gemini, il faut adapter `gemini-writer.js` **et** son équivalent dans Google More.

- **Pas d'URL avec paramètre** : Gemini n'accepte pas de prompt dans l'adresse. L'extension ouvre la page, écrit dans l'éditeur Quill avec `document.execCommand('insertText')` — un « coller » simulé est ignoré — puis clique sur Envoyer.
- **Une fenêtre au premier plan** : dans un onglet caché, Gemini ne rédige pas. D'où la petite fenêtre `popup`, refermée une fois la réponse lue. En cas de connexion demandée, elle reste ouverte.
- **Le service worker doit rester éveillé** : un service worker MV3 s'endort après 30 s d'inactivité, et un résumé peut prendre plus longtemps. Le pilote ouvre donc un port et y envoie un message toutes les 4 s.
- **La réponse est lue par blocs**, pas en texte à plat : un titre « ## Points clés » devient un `<h2>` qui ne garde aucun dièse. Relire le DOM rendu est le seul moyen de savoir ce qui était titre, paragraphe ou puce. Le raisonnement (`<model-thoughts>`), les icônes et les renvois sont écartés. Si Gemini répond dans un bloc de code, le Markdown brut est relu ligne à ligne.
- **La fin de rédaction** se détecte comme dans Google More : plus de bouton « Arrêter », et un texte stable — 0,8 s après l'apparition des actions du message, sinon 3 s. Ce délai empêche de couper la réponse pendant une pause de Gemini au milieu de la rédaction.
- **Transcription regroupée par tranches** d'au moins 20 s avant l'envoi : une vidéo d'une heure compte un millier de segments, qu'il serait long de taper dans l'éditeur pour aucun gain sur le résumé.
- **Rien n'est injecté comme HTML** dans YouTube : chaque bloc est reconstruit avec `textContent`, et seuls les timecodes deviennent des liens. Un timecode qui dépasse la durée de la vidéo (« 23:59 ») n'est pas lié.
- **Le chapitre en cours** est suivi par un écouteur `timeupdate` en phase de **capture** sur le document : l'événement ne remonte pas, mais la capture le reçoit quand même, ce qui évite de suivre un `<video>` que YouTube peut remplacer.

### Côte à côte avec la vidéo

Le panneau de vidIQ est `div#video-companion-root.vidiq-react`, **enfant direct** de la colonne. On le reconnaît à son propre identifiant ou à sa classe `vidiq-react`, jamais à la présence de vidIQ à l'intérieur : vidIQ pose ses badges dans les cartes suggérées, et sa classe `vidiq-scope` sur des conteneurs **de YouTube** (l'en-tête des commentaires, `#panels`). Un repérage trop large aurait masqué les suggestions, voire le panneau de transcription.

Il est **masqué**, pas supprimé (attribut `data-yttools-hidden`) : supprimé, vidIQ le réinsérerait aussitôt. Le masquage et la disparition du classement ne valent que pour la vidéo résumée.

### Par chapitres, les timecodes en référence

Deux formats ont précédé l'actuel. D'abord une poignée de points clés, trop maigre. Puis une **frise**, avec une ligne horodatée par moment toutes les 90 s environ. Elle se lisait mal : une liste de moments qui commencent tous par un timecode, sans structure.

Le résumé se lit maintenant **par chapitres**. On trouve d'abord « En bref », puis 3 à 8 chapitres, un toutes les deux minutes et demie environ, chacun avec un titre court et 1 à 3 points. Le timecode n'est plus qu'une **référence** :
- le prompt le place en fin de ligne et précise que chaque phrase doit se comprendre sans lui ;
- l'affichage le retire du texte pour le poser en petite pastille au bout de la ligne.

Seul un timecode **entre crochets ou parenthèses**, en fin ou en début de ligne, est pris pour une référence. Un timecode nu au milieu d'une phrase en fait partie, et il reste dans le texte comme simple lien.

**Chapitres de la vidéo** : s'ils existent, Gemini suit leur découpage. On prend d'abord ceux du créateur, sinon ceux que YouTube génère. `rank-bridge.js` les lit dans la réponse « watch next » que `ytd-watch-flexy` garde dans `__data.data`, ou dans `ytInitialData` au premier chargement, sous `multiMarkersPlayerBarRenderer.markersMap`. Il vérifie avant que cette réponse parle bien de la vidéo courante, car la navigation interne laisse l'ancienne en place un instant. Vérifié sur la vraie page, au premier chargement puis après une navigation interne.

**Lecture de la réponse** : Gemini ne suit pas toujours le modèle à la lettre. `gemini-writer.js` garde donc le niveau des titres et la profondeur des puces. Un chapitre peut alors être reconnu de plusieurs façons :
- un titre placé après « Chapitres », ou un titre qui porte un timecode ;
- une puce suivie de sous-puces ;
- un paragraphe suivi de puces.

Une partie de même rang que « Chapitres » (« ## À retenir ») n'est pas prise pour un chapitre : elle est affichée telle quelle après eux. Une réponse qui n'est pas en chapitres du tout est affichée telle quelle, avec l'ancien surlignage par frise.

### Les références manquantes

Gemini oublie parfois les timecodes malgré la consigne. Deux étages : le prompt donne un **modèle à recopier** et rappelle la consigne **après** la transcription, ce qui est bien mieux suivi qu'une phrase noyée avant un long texte. Et si un point en manque quand même, on le rapproche localement d'un passage de la transcription : mots rares en commun, pondérés par leur rareté, sur une **fenêtre glissante de 20 s sur les segments**. Pas sur les tranches du prompt : leurs frontières coupent les sujets en deux, et le timecode tombait quelques secondes trop tard. Un point qui ne ressemble à rien reste sans timecode — on n'invente pas. Un chapitre sans timecode prend celui de son premier point, ou à défaut celui du passage qui ressemble le plus à son titre et à ses points.

## Le résumé des commentaires

### Jauge et camps

Avant, le résumé avait quatre parties de même poids : « En bref », « La majorité », « Une minorité » et « Ce que les gens demandent ». Tout était en phrases, et le ton général ne sautait pas aux yeux.

On demande maintenant à Gemini de classer chaque commentaire : positif, négatif ou neutre. Il donne la part des positifs et des négatifs parmi les avis exprimés, puis ce que dit chaque camp et ce que le public demande, en points de 12 mots au plus.

L'extension affiche :
- une **jauge verte et rouge**, dont les deux parts sont ramenées à 100 si Gemini se trompe dans l'addition ;
- trois blocs colorés : « Ce qui plaît », « Ce qui déplaît » et « Ce que les gens demandent ». Une partie sans point (« Aucune critique notable ») devient une mention discrète, pas une puce.

Les pourcentages sont lus où que Gemini les mette : titre, ligne ou puce, sous la forme « Positifs : 82 % » ou « 82 % de positifs ». Si un seul est donné, l'autre en est déduit. Une réponse hors format est affichée telle quelle.

Ces pourcentages restent une **estimation de Gemini**, pas un comptage : un modèle de langage compte mal sur cent éléments, mais l'ordre de grandeur est juste.

### Questions sur les commentaires

Une fois le résumé fait, le bouton devient « Demander plus d'infos » et ouvre un champ de question sous le panneau. Chaque vidéo a son **dossier** en mémoire : les commentaires lus, le résumé, et les questions avec leurs réponses. Il vit dans le script de contenu, donc tant que l'onglet reste ouvert. Une navigation interne vers une autre vidéo le garde, et revenir à la vidéo le retrouve. F5 l'efface.

Ce dossier ne va pas dans le `sessionStorage` de YouTube, pour deux raisons. Les scripts de YouTube pourraient y lire les réponses de Gemini. Et quelques centaines de commentaires rempliraient un espace dont YouTube se sert lui-même.

Gemini ne garde rien d'une demande à l'autre, puisque chaque demande ouvre une conversation neuve. Chaque question lui redonne donc tout le dossier, puis la question elle-même, **en dernier**, là où elle est le mieux suivie après un long texte. Rouvrir l'ancienne conversation Gemini aurait été plus léger, mais fragile : sur une conversation qui se charge, le pilote pourrait prendre une ancienne réponse pour la nouvelle.

Pour cette question, le prompt demande de dire **qui** a écrit (@pseudo) et de citer ses mots exacts, ce que le résumé, lui, évite.

Le champ arrête la propagation des touches : sans ça, taper « k » ou « f » dedans mettrait la vidéo en pause ou en plein écran. Fermer le panneau pendant que Gemini répond ne perd pas la réponse, qui est rangée dans le dossier. Fermer pendant le **chargement** des commentaires annule, parce que les commentaires à l'écran pourraient ne plus être ceux de la vidéo.

### Quantité de commentaires

La flèche ouvre un menu posé dans `<body>`, en position absolue sous la flèche, parce qu'un conteneur de l'en-tête pourrait le rogner. On choisit 50, 100, 200, 300 ou 500 commentaires, et le choix est retenu (`yttoolsCommentsQuantite`). Le délai de chargement suit la quantité : 0,2 s par commentaire, 20 s au minimum. Au-delà de 300, chaque commentaire est coupé à 300 caractères au lieu de 500, pour ne pas noyer Gemini.

La mise en garde du menu existe parce que chaque lot de 20 commentaires est une requête de YouTube. Les déclencher par centaines, et souvent, ressemble à un robot.

### Chargement des commentaires

Repères lus sur une vraie page : `ytd-comment-thread-renderer` > `ytd-comment-view-model`, avec `#author-text`, `#content-text`, `#vote-count-middle`, `#more-replies`. Piège : `#pinned-comment-badge` et `#creator-heart` existent sur **tous** les commentaires, vides quand ils ne s'appliquent pas. Un repérage par présence aurait marqué chaque commentaire comme épinglé.

YouTube charge la suite quand la fin de la liste arrive à l'écran. La section contient **plusieurs** `ytd-continuation-item-renderer`, et une seule est la bonne :

- chaque fil a sa continuation de **réponses** (`.replies-continuation`), repliée, sans place à l'écran ;
- la toute dernière de la page est le **gabarit du chargement initial** (`[is-initial-load]`), masqué une fois les premiers commentaires affichés.

La première version prenait « la dernière de la page », donc ce gabarit : faire défiler jusqu'à un élément masqué ne bouge rien, la page ne défilait pas et on restait à 20. Désormais on écarte réponses et gabarit, et surtout on fait **défiler la fenêtre** au-delà du dernier commentaire — ce qui déclenche la suite quel que soit l'élément exact que YouTube surveille, et même si la continuation n'est pas encore insérée. On s'arrête à 100 commentaires, au bout de 20 s, ou quand plus rien n'arrive, puis on remet la page à sa position.

Le test modélise YouTube honnêtement : la suite se charge quand la fin de la liste est à l'écran, pas quand on appelle la fonction précise que l'extension utilise. Une première version déclenchait le chargement sur ce geste exact ; elle ne pouvait donc pas échouer, et n'a pas vu le bug. Sur la vraie page telle quelle, l'ancienne logique reste à 20 sans défiler ; la nouvelle en charge 100.

## Le scintillement de la colonne de droite

Sur la vraie page, les suggestions ne sont pas enfants directs de `#secondary-inner` : elles vivent dans `#related`. Le classement, qui ne les cherchait que parmi les enfants directs, retombait en tête de colonne — là où le résumé (et vidIQ) veulent aussi être. Chacun se remettait en tête à chaque passage : la colonne scintillait.

Deux corrections. Le repère est cherché à toute profondeur, puis ramené à l'enfant direct qui le contient — la rangée de filtres comprise, pour ne pas la séparer de la liste qu'elle filtre. Et tout déplacement passe par `moveGently` : au-delà de 4 en 4 s, on **cède la place** plutôt que d'entrer dans une bataille sans fin avec une autre extension.

## La mise à jour automatique

Reprise de [youtube-ad-tool](https://github.com/Slipers/youtube-ad-tool). Une extension ne peut pas réécrire ses fichiers ; mais chargée « non empaquetée », le dossier choisi **est** le code que Chrome exécute. On y écrit avec l'API File System Access (`showDirectoryPicker`), puis `chrome.runtime.reload()`. Le handle du dossier est gardé dans IndexedDB, le seul stockage capable de le conserver : la permission n'est demandée qu'une fois.

- `version.json`, écrit par `release.js`, pointe vers le **commit** publié (`ref`), pas vers `main` : les fichiers téléchargés sont exactement ceux de l'archive, même si `main` a avancé depuis ;
- liste des fichiers = `git ls-files youtube-tools` sans `tests/`. Les chemins avec `..` ou absolus sont ignorés ;
- tout est téléchargé avant la première écriture, et `manifest.json` est écrit **en dernier** ;
- avant d'écrire, on vérifie que le `manifest.json` du dossier s'appelle bien YouTube Tools ;
- `chrome.management.getSelf()` (sans permission) dit si l'installation est « development » : sinon, rien n'est vérifié ni proposé ;
- le sélecteur de dossier fermerait le popup : l'installation se fait dans un onglet, `update.html` ;
- `raw.githubusercontent.com` répond `Access-Control-Allow-Origin: *` : **aucune permission ajoutée**.

Un fichier supprimé d'une version à l'autre reste dans le dossier. Sans conséquence : le manifeste ne le référence plus.

**Windows Defender.** L'ancien `update.js` (le script de la page) était classé `Trojan:Win32/Fauppod.A!cl` — détection automatique du cloud Microsoft (« !cl »), fausse alerte classique pour un petit script qui « télécharge et installe ». Defender le supprimait au moment où la mise à jour le réécrivait : la page de mise à jour cassait, et l'installation s'arrêtait en route. Il a été remplacé par `update-page.js`, réécrit, que Defender accepte. Depuis, l'installation :

- compare chaque fichier à celui du dossier et **n'écrit que ce qui change** (fins de ligne ignorées pour le texte : un dépôt Git sous Windows est en CRLF, GitHub sert du LF) ;
- continue si un fichier est refusé à l'écriture, nomme les fichiers en échec, et **n'écrit pas `manifest.json`** dans ce cas : la nouvelle version n'est pas annoncée tant que tout n'est pas en place.

## YouTube Studio

Les idées viennent de **Better YouTube Studio** (SQUIDUU), relu pour l'occasion ; aucun code n'en est repris. La différence de fond : SQUIDUU signe ses appels aux API internes de Studio avec le cookie de session (`SAPISIDHASH`), ce qui lui donne les chiffres exacts. Ici, **aucune session** — même règle que le classement de la page de lecture — **sauf pour la vidéo similaire en lot**, seule fonction qui écrit (voir plus bas). Les scripts Studio tournent dans `document_start` (pour que les revenus soient floutés dès le premier affichage) et n'utilisent jamais `innerHTML` : Studio impose les Trusted Types.

`studio-page.js` est le seul script Studio du **monde de la page** (`world: "MAIN"`) : il lit les propriétés JavaScript des éléments de Studio, invisibles depuis le monde isolé. Les deux mondes se parlent par des `CustomEvent` dont le `detail` est une **chaîne JSON** (un objet ne traverse pas la frontière de façon fiable). Chaque fonction de ce script n'agit que si le monde isolé a posé sa classe sur `<html>` (`yttools-heure-studio`, `yttools-similaire`) : c'est ainsi qu'il suit les réglages, qu'il ne peut pas lire.

- **Classement Vidéos / Shorts** (`studio-top10.js`). `rank-core.computeLatest()` prend la tête de la liste publique du format choisi — aucune page de lecture ne donne la « vidéo courante » dans Studio — puis applique le calcul habituel. Requête vers `https://www.youtube.com/youtubei/v1/browse`, **sans clé** (Studio n'a que la sienne, et l'appel public n'en a pas besoin) et sans cookie ; YouTube l'autorise depuis l'origine `studio.youtube.com`. Seul l'onglet ouvert est calculé. Liste rechargée si elle a plus de 10 min, puisque c'est justement la tête qui compte.
- **Flèches de tendance** (`studio-tendance.js`). Pour chaque ligne publique de la page *Contenu* : date (cellule `.tablecell-date`, « 13 juin 2026 », mois FR ou EN), vues (`.tablecell-views`), visibilité (icône `.privacy-public-icon`, indépendante de la langue). Les 10 publiques précédentes sont ramenées à l'âge de la vidéo avec `growth()`, puis : au-dessus du 3ᵉ quartile ▲, sous le 1ᵉʳ ▼, sinon —. Règle des quartiles reprise de SQUIDUU. Les privées ne servent ni de cible ni de référence. Revers assumé : la comparaison se limite aux lignes de la page affichée.
- **Zoom de la rétention** (`studio-retention.js`). Le graphique (bibliothèque *aplos*) ne garde pas ses données à portée : on relit les points du `path.line-series`, on passe des pixels aux % avec deux graduations de l'axe de droite (une rétention peut dépasser 100 %) et des pixels au temps avec la graduation la plus à droite (« 20:42 »). Zoomé, le contenu de `g.aplos-draw-area` est masqué (`visibility: hidden`, rien n'est supprimé) et notre calque y est dessiné aux mêmes coordonnées. Les écouteurs sont posés **en capture sur le parent** du `<svg>` : le graphique de Studio ne voit plus la souris pendant le zoom, et la retrouve dès la sortie. Si Studio redessine sa courbe (période, taille), la signature du tracé change et on redessine. Les tracés de Studio sont en pixels entiers : à fort zoom, on voit leur pas (≈ 0,6 point de %).
- **Revenus masqués** (`studio-revenus.js`). Un élément est un montant si **tout** son texte en est un (≤ 32 caractères, devise devant ou derrière) ; on remonte de trois niveaux au plus pour attraper « 12,30 » et « € » posés dans deux balises. Le marquage se fait dans le rappel du `MutationObserver`, qui passe avant l'affichage : une infobulle ne montre jamais un montant en clair. Le flou CSS ne s'applique pas aux `<text>` SVG : ils sont effacés à la place.
- **Heure exacte au survol** (`studio-heure.js` + `studio-page.js`). Chaque `ytcp-video-row` porte dans sa propriété `video` l'objet que Studio a chargé, avec `timePublishedSeconds` et `timeCreatedSeconds`. Le monde de la page les recopie dans `data-yttools-heure="id publiée importée"` ; le monde isolé affiche la bulle. L'ID est vérifié contre le lien de la ligne : Studio recycle ses lignes en changeant de page, un attribut pas encore relu ne doit pas donner l'heure d'une autre vidéo. Rien pour une vidéo programmée. SQUIDUU, lui, redemande l'heure à l'API (`get_creator_videos`) : inutile, elle est déjà là.
- **Vidéo similaire de plusieurs Shorts** (`studio-similaire.js` + `studio-page.js`). L'entrée est ajoutée au menu *Modifier* de la barre de sélection (la `tp-yt-paper-listbox` qui contient `TITLE` **et** `DESCRIPTION`), après `MONETIZATION`. Elle arrête la propagation de `mousedown`/`pointerdown`/`keydown`… pour que la liste de Studio ne la traite pas comme une des siennes, puis ferme le menu par un `Escape`. L'éditeur se pose en tête de `#editors`, et la barre reçoit `yttools-sim-edition`, qui masque les menus et boutons de Studio le temps de l'édition. La vidéo se choisit dans **le sélecteur de Studio lui-même** (`ytcp-video-pick-dialog`, créé à la volée, mêmes filtres que pour un seul Short) : c'est Studio qui charge la liste ; à défaut, un champ accepte un lien collé.
  L'enregistrement est la demande de Studio pour un seul Short, `POST /youtubei/v1/video_manager/metadata_update` avec `videoLinkageShortsAttribution.targetExternalVideoId` (`[id]`, ou `[]` pour retirer). Studio exige deux choses que la page ne donne pas d'emblée : un **contexte** contenant `request.sessionInfo.token` (absent de `ytcfg`, Studio l'ajoute à chacune de ses requêtes) et l'en-tête `Authorization: SAPISIDHASH horodatage_sha1(horodatage SAPISID origine)`. Le contexte est relevé sur les requêtes de Studio (`XMLHttpRequest.send`, `fetch`), **seulement quand `html.yttools-similaire` est posée**, c'est-à-dire sur l'onglet *Contenu > Shorts* avec la case active ; seul le dernier est gardé, en mémoire. Cocher un Short ou ouvrir le sélecteur suffit à en produire un. Le cookie n'est lu qu'au moment de signer. Les Shorts partent un par un, 600 ms d'écart ; sans contexte ou sans session, on s'arrête au premier au lieu d'attendre pour chacun. Rien n'est envoyé avant la confirmation, qui liste les Shorts concernés.

## Les tags

Ils viennent de `videoDetails.keywords`, dans les données du lecteur, que `rank-bridge.js` recopie avec le reste (champ `tags`). La balise `<meta name="keywords">` n'est pas une source fiable, pour deux raisons :

- elle n'est écrite qu'au premier chargement, donc après une navigation interne elle décrit encore la vidéo d'avant ;
- pour une vidéo sans tags, YouTube y met des mots génériques (« vidéo, partage, téléphone-appareil photo… ») qui ne viennent pas du créateur.

**Placement** : le bloc est le dernier enfant de `#description-inner`, en dehors de `ytd-text-inline-expander`. Il est donc toujours visible en bas du cadre : sous « afficher plus » quand la description est repliée, sous « Moins » quand elle est dépliée. Si YouTube ajoute un bloc après lui, il se replace en dernier. Il passe par `moveGently`, comme les autres blocs de l'extension, pour ne pas entrer dans une bataille de position.

Description repliée, un clic n'importe où dans le cadre la déplie. Les clics dans le bloc (plier, copier, sélectionner un tag) sont arrêtés à lui (`stopPropagation`). Vérifié sur la vraie page : cliquer un tag laisse la description repliée.

**Longueur** : elle est comptée comme dans YouTube Studio pour sa limite de 500 caractères. On compte une virgule entre deux tags, et deux guillemets de plus pour un tag qui contient un espace.

## L'heure exacte sous la vidéo

`rank-bridge.js` recopiait déjà `microformat.playerMicroformatRenderer.publishDate` (ou `liveBroadcastDetails.startTimestamp` pour un direct) : « 2026-06-13T04:00:21-07:00 ». `heure-video.js` le relit, vérifie que l'ID est celui de l'URL (le pont peut avoir une navigation de retard) et ajoute « à 13:00 » après le morceau de `#info` qui contient une année — donc seulement description ouverte, quand YouTube affiche la date et non « il y a 5 mois ». Un nombre de vues comme « 2025 vues » est écarté avec `RE.views`. Une date sans heure (ancien format) ne donne rien.

## La recherche dans une playlist

Deux mises en page coexistent (relevé de novembre 2026) : l'ancienne `ytd-playlist-video-list-renderer > #contents > ytd-playlist-video-renderer`, et la nouvelle `yt-item-section-renderer > #contents > div > yt-lockup-view-model`, titre dans `.ytLockupMetadataViewModelTitle`, chaîne dans la première ligne de `yt-content-metadata-view-model`. On masque l'**enfant direct** de `#contents` qui porte la vidéo, pas la vidéo seule (sinon son emballage garde sa marge). Les vues et la date ne sont pas cherchées : « vues » trouverait tout.

Pour chercher dans les vidéos pas encore chargées, le repère de chargement (`ytd-continuation-item-renderer` ou `yt-continuation-item-view-model`) est posé dans l'écran, invisible (1 px, `position: fixed`) tant qu'une recherche est en cours : YouTube charge alors lot après lot, avec ses propres requêtes, comme si on défilait. Sur une chaîne de 1 718 vidéos : 17 lots, une seconde chacun. Idée de SQUIDUU.

## Le CSV

Champs entre guillemets et échappés (RFC 4180) : les virgules et guillemets du texte ne cassent rien. Le **BOM UTF-8** n'est ajouté que dans le fichier téléchargé, jamais dans le presse-papiers — collé dans un agent IA, il n'aurait servi qu'à polluer la première ligne.

Une page web ne peut déposer que du **texte** dans le presse-papiers, jamais un fichier. Pour joindre un `.csv` quelque part, il faut passer par le téléchargement : c'est la raison d'être du réglage « Enregistrer un fichier », qui vient **en plus** de la copie.
