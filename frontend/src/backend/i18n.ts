/**
 * English for the backend's Spanish strings. The backend data stays untouched;
 * only what the UI displays is translated here. Unknown strings fall back to
 * the original so nothing silently disappears.
 */

const STATUS: Record<string, string> = { pasada: 'Landed', candidata: 'Candidate' };

const COUNTRY: Record<string, string> = {
  'Estados Unidos': 'United States',
  China: 'China',
  India: 'India',
  Japón: 'Japan',
  Japon: 'Japan',
  Rusia: 'Russia',
  Israel: 'Israel',
};

const DEM: Record<string, string> = {
  'Polo Sur': 'LOLA South Pole DEM, 30 m/px',
  'Polo Norte': 'LOLA North Pole DEM, 30 m/px',
  Global: 'LOLA global DEM, 128 ppd (~237 m/px)',
};

/** Mission notes by site id (translated from missions.json). */
const NOTES: Record<string, string> = {
  'apollo-11': 'First crewed landing, Mare Tranquillitatis.',
  'apollo-12': 'Oceanus Procellarum, next to the Surveyor 3 probe.',
  'apollo-14': 'Fra Mauro formation.',
  'apollo-15': 'Hadley-Apennine; first Lunar Roving Vehicle (LRV).',
  'apollo-16': 'Descartes highlands.',
  'apollo-17': 'Taurus-Littrow valley; last crewed landing.',
  'change-4': 'First landing on the far side (Von Kármán crater); uses the Queqiao relay satellite.',
  'change-5': 'Sample return, near Mons Rümker.',
  'change-6': 'First far-side samples, Apollo basin.',
  'chandrayaan-3': 'Closest landing to the south pole as of 2023.',
  slim: 'Precision landing next to Shioli crater.',
  'im-1': 'First commercial landing, near Malapert A, on a 12° slope.',
  'im-2': 'Mons Mouton, inside an Artemis III candidate region (planned site; landed ~250 m away).',
  'blue-ghost-1': 'Mare Crisium; landed ~120 m from its target.',
  'connecting-ridge': 'Ridge between Shackleton and de Gerlache; a high-priority site for future missions.',
  'shackleton-rim': 'Rim of Shackleton crater, next to the south pole.',
  'peak-near-shackleton': 'Peak with near-permanent illumination.',
  'de-gerlache-rim': 'Rim of de Gerlache crater.',
  'leibnitz-beta': 'Plateau in the Mons Mouton area.',
  'malapert-massif': 'Massif with a view of Earth and the south pole.',
  'polo-norte-peary': 'The north pole lies on the northern rim of Peary crater, proposed for its long illumination.',
  peary: 'Large crater closest to the north pole; its floor has permanently shadowed areas.',
};

/** Site names that are Spanish in the backend. */
const NAMES: Record<string, string> = {
  'polo-norte-peary': 'North Pole (Peary rim)',
  peary: 'Peary crater',
};

/** Coordinate sources (translated from missions.json; references kept verbatim). */
const SOURCES: Record<string, string> = {
  'NASA NSSDCA, coordenadas del LRO (Wagner et al. 2017)': 'NASA NSSDCA, LRO coordinates (Wagner et al. 2017)',
  'LROC (equipo de QuickMap), DTM NAC': 'LROC (QuickMap team), NAC DTM',
  'NASA SSERVI, estimación del científico del proyecto LRO': 'NASA SSERVI, estimate by the LRO project scientist',
  'LROC (equipo de QuickMap)': 'LROC (QuickMap team)',
  'ISRO; dentro del DTM LROC del sitio Vikram (verificar en QuickMap)': 'ISRO; inside the LROC DTM of the Vikram site (to verify in QuickMap)',
  'NASA / LROC': 'NASA / LROC',
  'LROC (equipo de QuickMap), sitio planeado': 'LROC (QuickMap team), planned site',
  'Región de estudio; verificar en QuickMap / Moon Trek': 'Study region; to verify in QuickMap / Moon Trek',
  'Coordenadas IAU del cráter; verificar en QuickMap / Moon Trek': 'IAU crater coordinates; to verify in QuickMap / Moon Trek',
};

/** Verdict reasons from /api/point (templates in point_engine.py), numbers kept as sent. */
const REASONS: [RegExp, string][] = [
  [/^Pendiente de ([\d.]+)°, mayor que el limite de ([\d.]+)°$/, 'Slope of $1°, above the $2° limit'],
  [/^Poco Sol en la mision: (\d+%) de las horas$/, 'Little sunlight during the mission: $1 of the hours'],
  [/^Casi sin contacto directo con la Tierra: necesitaria satelite de relevo$/, 'Almost no direct contact with Earth: it would need a relay satellite'],
  [/^Poco contacto con la Tierra: (\d+%) de las horas$/, 'Little contact with Earth: $1 of the hours'],
  [/^El periodo de Sol continuo mas largo es de solo (\d+) h$/, 'The longest stretch of continuous sunlight is only $1 h'],
  [
    /^Sol muy bajo: hacen falta paneles verticales \(un panel horizontal rinde (\d+%) contra (\d+%) de uno vertical\)$/,
    'Sun very low: vertical panels are needed (a horizontal panel yields $1 against $2 for a vertical one)',
  ],
];

export function tReason(s: string) {
  for (const [re, en] of REASONS) if (re.test(s)) return s.replace(re, en);
  return s;
}

export const tStatus = (s: string) => STATUS[s] ?? s;
export const tCountry = (s: string) => COUNTRY[s] ?? s;
export const tDem = (s: string) => DEM[s] ?? s;
export const tNote = (id: string, original: string) => NOTES[id] ?? original;
export const tName = (id: string, original: string) => NAMES[id] ?? original;

export function tSource(s: string) {
  if (SOURCES[s]) return SOURCES[s];
  // "Centro del DEM LOLA 5 m/px SiteNN, NASA GSFC PGDA (...)"
  return s.replace(/^Centro del DEM /, 'Centre of the ');
}
