// src/nlp/normalize.js

// Basic Arabic normalization + Arabizi + de-elongation + tatweel removal
const ARABIZI = { '2':'ء', '3':'ع', '4':'غ', '5':'خ', '6':'ط', '7':'ح', '8':'ق', '9':'ص' };
const TATWEEL = /\u0640/g;

// Common prefixes/suffixes to strip (very light stemmer)
const PREFIXES = ['بال','وال','فال','كال','لل','ال','ب','ف','و','ل','ك','س'];
const SUFFIXES = ['كما','كما','كم','كن','نا','هما','هم','هن','ها','ه','ي']; // keep it conservative

// Minimal stopwords (optional)
const STOPWORDS = new Set([
  'في','على','عن','مع','الى','إلى','من','ال','و','يا','هل','ما','ماذا','كيف','وين',
  'هو','هي','هم','هذا','هذه','ذلك','تلك','هناك','هنا','انا','انت','انتي','انتِ',
  'كان','كانت','يكون','ثم','أي','أو','او','لا','نعم'
]);

function arabiziMap(s){ return s.replace(/[23456789]/g, d => ARABIZI[d] || d); }
function deelongate(s){ return s.replace(/([^\W\d_])\1{2,}/g, '$1'); } // سلاااام → سلام
function stripDiacritics(s){ return s.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, ''); }
function unifyLetters(s){
  return s.replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه');
}

function normalizeAr(s=''){
  let x = String(s).toLowerCase();
  x = arabiziMap(x);
  x = stripDiacritics(x);
  x = x.replace(TATWEEL,'');
  x = unifyLetters(x);
  x = x.replace(/[^\u0600-\u06FF0-9\s]/g,' ');
  x = deelongate(x);
  x = x.replace(/\s+/g,' ').trim();
  return x;
}

function stripAffixes(token){
  let t = token;
  // prefixes
  for (const p of PREFIXES){
    if (t.startsWith(p) && t.length - p.length >= 3){ t = t.slice(p.length); break; }
  }
  // suffixes
  for (const s of SUFFIXES){
    if (t.endsWith(s) && t.length - s.length >= 3){ t = t.slice(0, -s.length); break; }
  }
  return t;
}

function tokenize(s, { removeStopwords=false } = {}){
  const norm = normalizeAr(s);
  let tokens = norm.split(' ').filter(Boolean).map(stripAffixes).filter(Boolean);
  if (removeStopwords) tokens = tokens.filter(t => !STOPWORDS.has(t));
  return tokens;
}

module.exports = { normalizeAr, tokenize };
