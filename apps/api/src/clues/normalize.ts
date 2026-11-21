/**
 * Turns Hinglish / English / Devanagari speech transcripts and landmark names
 * into comparable token lists: Devanagari is romanized, common Hindi place words
 * are mapped to one canonical token, and filler words are dropped.
 */

const DEVANAGARI_VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ए": "e", "ऐ": "ai",
  "ओ": "o", "औ": "au", "ऋ": "ri",
};
const DEVANAGARI_MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ृ": "ri", "ं": "n", "ँ": "n", "ः": "h",
};
const DEVANAGARI_CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh",
  "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d",
  "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r",
  "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ड़": "d", "ढ़": "dh", "क़": "k",
  "ख़": "kh", "ग़": "g", "ज़": "z", "फ़": "f",
};
const VIRAMA = "्";
const NUKTA = "़";

/** Simple Devanagari → Latin romanization (schwa dropped at word end). */
export function romanize(input: string): string {
  const chars = [...input.normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i]!;
    if (chars[i + 1] === NUKTA) {
      ch = ch + NUKTA;
      i++;
    }
    const consonant = DEVANAGARI_CONSONANTS[ch];
    if (consonant !== undefined) {
      out += consonant;
      const next = chars[i + 1];
      if (next === VIRAMA) {
        i++;
      } else if (next === "ं" || next === "ँ" || next === "ः") {
        out += "a"; // nasal/visarga follows the inherent vowel
      } else if (next !== undefined && DEVANAGARI_MATRAS[next] !== undefined) {
        // matra supplies the vowel
      } else if (next !== undefined && DEVANAGARI_CONSONANTS[next] !== undefined) {
        out += "a";
      }
      continue;
    }
    const vowel = DEVANAGARI_VOWELS[ch] ?? DEVANAGARI_MATRAS[ch];
    out += vowel ?? ch;
  }
  return out;
}

/** Multi-word phrases collapsed to one canonical token before tokenizing. */
const PHRASES: [RegExp, string][] = [
  [/\bpetrol (pump|bunk|bank)\b/g, "petrolpump"],
  [/\b(fuel|gas) station\b/g, "petrolpump"],
  [/\bbus (stop|stand)\b/g, "busstop"],
  [/\bmetro station\b/g, "metro"],
  [/\bmedical (store|shop)\b/g, "pharmacy"],
];

/** Single-word synonyms → canonical token. */
const SYNONYMS: Record<string, string> = {
  mandir: "temple", mandira: "temple", gudi: "temple", devasthana: "temple", devasthanam: "temple",
  masjid: "mosque", girja: "church",
  dukaan: "shop", dukan: "shop", store: "shop",
  darwaza: "gate", darwaja: "gate", gaet: "gate",
  gali: "lane", galli: "lane", cross: "lane",
  rasta: "road", raasta: "road", marg: "road", sadak: "road", rd: "road",
  chowk: "circle", chauraha: "circle", junction: "circle",
  aspatal: "hospital", hospitel: "hospital",
  vidyalaya: "school", shala: "school",
  bunk: "petrolpump", petrol: "petrolpump",
  chemist: "pharmacy",
  neela: "blue", nila: "blue", neele: "blue", neeli: "blue", nile: "blue", laal: "red", lal: "red", hara: "green", peela: "yellow", safed: "white",
  nariyal: "coconut",
};

/** Filler and relational words that never identify a place. */
const STOPWORDS = new Set([
  "main", "mai", "mein", "me", "hoon", "hun", "hu", "hai", "hain", "ke", "ki", "ka", "ko", "se",
  "saamne", "samne", "paas", "pass", "peeche", "piche", "pichhe", "bagal", "near", "opposite",
  "behind", "beside", "next", "to", "in", "at", "on", "the", "a", "an", "i", "am", "im", "is",
  "of", "front", "side", "par", "pe", "abhi", "yahan", "yaha", "idhar", "udhar", "bhaiya", "bhai",
  "sir", "madam", "ji", "wala", "wali", "wale", "ek", "ho", "gaya", "gayi", "aa", "raha", "rahi",
  "now", "here", "there", "just", "and", "or", "okay", "ok", "haan", "han", "nahi", "vo", "woh",
  "yeh", "ye", "this", "that", "my", "standing", "khada", "khadi", "right", "left",
]);

export function normalize(text: string): string {
  let s = romanize(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, token] of PHRASES) s = s.replace(re, token);
  return s;
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 0)
    .map((t) => SYNONYMS[t] ?? t)
    .filter((t) => !STOPWORDS.has(t));
}

/** Normalized Levenshtein similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return 1 - prev[n]! / Math.max(m, n);
}
