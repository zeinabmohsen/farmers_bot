// Basic Arabic normalization + Arabizi + de-elongation + tatweel removal
// Exports: normalizeAr(text), tokenize(text, { removeStopwords })

const ARABIZI = {
  2: "ء",
  3: "ع",
  4: "غ",
  5: "خ",
  6: "ط",
  7: "ح",
  8: "ق",
  9: "ص",
};
const TATWEEL = /\u0640/g;

// Minimal common Arabic stopwords (extend as needed)
const STOPWORDS = new Set([
  "في",
  "على",
  "عن",
  "مع",
  "الى",
  "إلى",
  "من",
  "ال",
  "و",
  "يا",
  "هل",
  "ما",
  "ماذا",
  "كيف",
  "وين",
  "هو",
  "هي",
  "هم",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "هناك",
  "هنا",
  "انا",
  "انت",
  "انتي",
  "انتِ",
  "كان",
  "كانت",
  "يكون",
  "يكونوا",
  "ثم",
  "اي",
  "أو",
  "او",
  "لا",
  "نعم",
]);

function arabiziMap(s) {
  return s.replace(/[23456789]/g, (d) => ARABIZI[d] || d);
}
function deelongate(s) {
  return s.replace(/([^\W\d_])\1{2,}/g, "$1");
} // سلاااام → سلام
function stripDiacritics(s) {
  return s.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
}
function unifyLetters(s) {
  return s
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");
}
function normalizeAr(s = "") {
  let x = String(s).toLowerCase();
  x = arabiziMap(x); // Arabizi → Arabic letters
  x = stripDiacritics(x); // remove tashkeel
  x = x.replace(TATWEEL, ""); // remove tatweel
  x = unifyLetters(x); // unification
  x = x.replace(/[^\u0600-\u06FF0-9\s]/g, " "); // keep Arabic, digits, spaces
  x = deelongate(x);
  x = x.replace(/\s+/g, " ").trim();
  return x;
}

function tokenize(s, { removeStopwords = false } = {}) {
  const norm = normalizeAr(s);
  let tokens = norm.split(" ").filter(Boolean);
  if (removeStopwords) tokens = tokens.filter((t) => !STOPWORDS.has(t));
  return tokens;
}

module.exports = { normalizeAr, tokenize, STOPWORDS };
