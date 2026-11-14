'use strict';

/**
 * Chemins communs aux tests.
 *
 * Plusieurs tests tournent sur une VRAIE page de lecture YouTube enregistree
 * (Ctrl+S ou copie du HTML depuis les outils de developpement). Elle n'est pas
 * dans le depot : c'est une page de compte connecte. Par defaut on la cherche
 * dans Telechargements, sous le nom « HTML DE LA PAGE.txt » ; la variable
 * d'environnement YTTOOLS_DUMP permet d'en donner une autre. Sans elle, ces
 * tests sont ignores au lieu d'echouer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.join(__dirname, '..') + '/';
const EXT = path.join(RACINE, 'youtube-tools') + '/';
const DUMP = process.env.YTTOOLS_DUMP || path.join(os.homedir(), 'Downloads', 'HTML DE LA PAGE.txt');

function lireDump() {
  if (!fs.existsSync(DUMP)) {
    console.log(`  IGNORE : page de lecture enregistree introuvable (${DUMP}). Voir tests/_outils.js.`);
    console.log('\ntout passe (ignore)');
    process.exit(0);
  }
  return fs.readFileSync(DUMP, 'utf8');
}

module.exports = { RACINE, EXT, DUMP, lireDump };
