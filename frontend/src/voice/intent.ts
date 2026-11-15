/**
 * Rule-based understanding of a landing request (en-US), spoken or typed.
 * No model and no network: it only extracts a date, a time and a zone of the
 * Moon, so everything Vesper answers still comes from computed values.
 */

export type Zone = 'nearside' | 'farside' | 'north' | 'south';

export type When = { month: number; day: number; hour: number; minute: number; hasTime: boolean; year: number | null };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3).toLowerCase()));

export function parseZone(text: string): Zone | null {
  const t = text.toLowerCase();
  if (/\bfar[\s-]?side\b|\b(hidden|dark|back) side\b/.test(t)) return 'farside';
  if (/\bnear[\s-]?side\b|\b(visible|front) side\b/.test(t)) return 'nearside';
  if (/\bsouth(ern)?\b/.test(t)) return 'south';
  if (/\bnorth(ern)?\b/.test(t)) return 'north';
  return null;
}

/** Finds a time of day in text that no longer contains the date. */
function parseTime(t: string): { hour: number; minute: number } | null {
  if (/\bnoon\b|\bmidday\b/.test(t)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(t)) return { hour: 0, minute: 0 };
  // 2 pm, 2:30 p.m., 11am
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/);
  if (m) {
    const h = Number(m[1]) % 12;
    return h <= 11 && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { hour: h + (m[3] === 'p' ? 12 : 0), minute: Number(m[2] ?? 0) } : null;
  }
  // 14:00, 1400 hours, 14 hundred
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) ?? t.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(?:hours|hrs|utc|zulu)\b/);
  if (m) return { hour: Number(m[1]), minute: Number(m[2]) };
  // at 14, at 6 o'clock, 14 hours, 14 UTC
  m = t.match(/\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|°|degrees))/) ?? t.match(/\b(\d{1,2})\s*(?:o'?clock|hours|hrs|h|utc)\b/);
  if (m && Number(m[1]) <= 23) return { hour: Number(m[1]), minute: 0 };
  return null;
}

/** Date (and time, if given) in a sentence: "March 12 at 14:00", "12th of March 2 pm", "2027-03-12". */
export function parseWhen(text: string): When | null {
  let t = text.toLowerCase().replace(/,/g, ' ');
  let month = -1;
  let day = 0;
  let year: number | null = null;

  let m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]) - 1;
    day = Number(m[3]);
  } else if ((m = t.match(new RegExp(`\\b${MONTH_RE}\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    month = monthIndex(m[1]);
    day = Number(m[2]);
  } else if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`)))) {
    day = Number(m[1]);
    month = monthIndex(m[2]);
  } else if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/))) {
    month = Number(m[1]) - 1; // en-US order
    day = Number(m[2]);
    if (m[3]) year = Number(m[3]);
  }
  if (!m || month < 0 || month > 11 || day < 1 || day > new Date(Date.UTC(2027, month + 1, 0)).getUTCDate()) return null;

  t = t.replace(m[0], ' ');
  const y = t.match(/\b(20\d{2})\b/);
  if (y && year === null) {
    year = Number(y[1]);
    t = t.replace(y[0], ' ');
  }
  const time = parseTime(t);
  return { month, day, hour: time?.hour ?? 0, minute: time?.minute ?? 0, hasTime: time !== null, year };
}

/** A time on its own, to complete a date given earlier ("at 2 pm"). */
export const parseTimeOnly = (text: string) => parseTime(text.toLowerCase());
