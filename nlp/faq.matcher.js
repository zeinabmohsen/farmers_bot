const Fuse = require("fuse.js");
const { normalizeAr, tokenize } = require("./normalize");

// ===== Gazetteers (expand anytime) =====
const CROP_SYNONYMS = {
  طماطم: ["طماطم", "بندوره", "بندورة"],
  خيار: ["خيار"],
  بطاطا: ["بطاطا", "بطاطس"],
  قمح: ["قمح", "حنطه", "حنطة"],
  فلفل: ["فلفل", "فليفله", "فليفلة"],
  باذنجان: ["باذنجان", "بيتنجان"],
};

const DISEASE_SYNONYMS = {
  اللفحة: [
    "لفحه",
    "اللفحه",
    "اللفحة",
    "لفحة مبكرة",
    "لفحة متاخرة",
    "لفحه مبكره",
    "لفحه متاخره",
  ],
  "البياض الدقيقي": ["البياض", "بياض دقيقي", "البياض الدقيقي"],
  الذبول: ["ذبول", "الذبول", "ذبول فطري"],
};

// Build normalized reverse maps + flat arrays for fuzzy
function buildReverseMap(dict) {
  const rev = {};
  const flat = [];
  for (const [canon, syns] of Object.entries(dict)) {
    for (const s of syns) {
      const n = normalizeAr(s);
      rev[n] = canon;
      flat.push({ canon, syn: n });
    }
  }
  return { rev, flat };
}
const CROPS = buildReverseMap(CROP_SYNONYMS);
const DISEASES = buildReverseMap(DISEASE_SYNONYMS);

// Fuse indexes (for fuzzy matching whole query when exact token fails)
const cropFuse = new Fuse(CROPS.flat, {
  keys: ["syn"],
  includeScore: true,
  threshold: 0.35,
});
const diseaseFuse = new Fuse(DISEASES.flat, {
  keys: ["syn"],
  includeScore: true,
  threshold: 0.35,
});

// ===== Intent keyword banks (normalized) =====
const INTENT_KWS = {
  planting_time: [
    "متى",
    "امتى",
    "وقت",
    "موعد",
    "ازرع",
    "زراعه",
    "زراعة",
    "مواعيد",
    "شتل",
    "شتله",
    "شتلة",
  ],
  irrigation: [
    "ري",
    "اسقي",
    "سقي",
    "ارو",
    "سقاية",
    "مياه",
    "ماء",
    "رش",
    "رشاش",
  ],
  disease_treat: [
    "علاج",
    "اعالج",
    "حل",
    "مكافحه",
    "مكافحة",
    "مرض",
    "امراض",
    "اعراض",
    "اللفحه",
    "البياض",
    "الذبول",
    "فطري",
    "وقايه",
    "وقاية",
    "اصابه",
    "اصابة",
  ],
};

// Simple weighted scoring (counts + position bonus)
function scoreIntent(tokens) {
  const scores = {};
  for (const [intent, kws] of Object.entries(INTENT_KWS)) {
    let s = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (kws.includes(t)) s += 1 + (tokens.length - i) * 0.02; // earlier tokens slightly stronger
    }
    scores[intent] = s;
  }
  // choose best if above a tiny floor
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const bestScore = best?.[1] || 0;
  const intent = bestScore >= 1 ? best[0] : null;
  // normalize score to 0..1-ish per heuristic
  const conf = Math.min(bestScore / 3, 1); // tune later
  return { intent, intentScore: conf, raw: scores };
}

function detectCrop(qNorm, tokens) {
  // 1) exact token match on normalized synonyms
  for (const t of tokens)
    if (CROPS.rev[t]) return { crop: CROPS.rev[t], cropScore: 1 };

  // 2) fuzzy over full normalized string
  const hit = cropFuse.search(qNorm)[0];
  if (hit && hit.score <= 0.35)
    return { crop: hit.item.canon, cropScore: 1 - hit.score }; // closer → higher
  return { crop: null, cropScore: 0 };
}

function detectDisease(qNorm, tokens) {
  for (const t of tokens)
    if (DISEASES.rev[t]) return { disease: DISEASES.rev[t], diseaseScore: 1 };
  const hit = diseaseFuse.search(qNorm)[0];
  if (hit && hit.score <= 0.35)
    return { disease: hit.item.canon, diseaseScore: 1 - hit.score };
  return { disease: null, diseaseScore: 0 };
}

// Numbers/units (very light)
const QTY_RE =
  /(\d+(?:\.\d+)?)\s*(لتر|جم|غ|كجم|مل|ملل|ملليلتر|هكتار|فدان|متر|سم)/;
function extractQty(qNorm) {
  const m = qNorm.match(QTY_RE);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] };
}

// ===== Answer bank (extend later or move to /data) =====
const RESPONSES = {
  help: "أهلًا! اسأل مثل:\n• متى ازرع الطماطم؟\n• ري الخيار كيف؟\n• علاج اللفحة على البندورة؟",
  planting_time: {
    طماطم:
      "مواعيد زراعة الطماطم: الربيع المبكر (مارس–ابريل). في المناطق الدافئة ممكن دفعة أواخر الصيف–بداية الخريف (اغسطس–سبتمبر). تربة جيدة الصرف وشمس 6–8 ساعات.",
    خيار: "مواعيد زراعة الخيار: الربيع (مارس–ابريل). استخدم تعريشة وري منتظم والتربة دافئة.",
    بطاطا:
      "البطاطا: الخريف أو أواخر الشتاء (سبتمبر–نوفمبر / يناير–فبراير). تربة مفككة جيدة الصرف.",
    قمح: "القمح: عادة الخريف (اكتوبر–ديسمبر). يحتاج برودة معتدلة وتربة مصرفة.",
    فلفل: "الفلفل: بعد زوال برد الشتاء (ابريل تقريبًا). حرارة دافئة وشمس كافية.",
    باذنجان:
      "الباذنجان: الربيع بعد اعتدال الجو (ابريل–مايو). تربة خصبة وري منتظم.",
    default:
      "عمومًا يتحدد الموعد حسب الحرارة المحلية. اذكر المحصول/المنطقة لو نصيحة أدق.",
  },
  irrigation: {
    طماطم:
      "ري الطماطم: بانتظام بلا إغراق؛ اترك السطح يجف قليلًا بين الريات. صباحًا أفضل وتجنب البلل الليلي للأوراق.",
    خيار: "ري الخيار: يحتاج رطوبة ثابتة خاصة بالحر؛ تجنب الجفاف المتكرر.",
    بطاطا: "ري البطاطا: معتدل وتربة جيدة الصرف لتفادي الأعفان.",
    قمح: "ري القمح: غالبًا يعتمد على أمطار الخريف/الشتاء؛ ري تكميلي عند الحاجة.",
    default:
      "قاعدة: ري عميق متباعد أفضل من ريات خفيفة متكررة. اذكر المحصول لنصائح أدق.",
  },
  disease_treat: {
    generic:
      "للمكافحة الحيوية: حسّن التهوية، تجنّب البلل الليلي، ازل الأجزاء المصابة، اتّبع الدورة الزراعية، واستخدم مركبات نحاسية/كبريتية بتركيزات آمنة عند الحاجة.",
    اللفحة:
      "اللفحة: تهوية جيدة، إزالة أوراق سفلية المصابة، تجنّب البلل الليلي، ورشّات نحاسية عضوية عند الحاجة.",
    "البياض الدقيقي":
      "البياض الدقيقي: تحسين حركة الهواء، تقليل الرطوبة، رشّات كبريت/بيكربونات بوتاسيوم حسب الإرشادات.",
    الذبول:
      "الذبول: تجنّب التربة الثقيلة المغمورة، تحسين الصرف، اختيار أصناف مقاومة، ودورة زراعية أطول.",
  },
};

// ===== Public API =====
function analyze(userText) {
  const qNorm = normalizeAr(userText);
  const tokens = tokenize(userText, { removeStopwords: true });

  const { intent, intentScore } = scoreIntent(tokens);
  const { crop, cropScore } = detectCrop(qNorm, tokens);
  const { disease, diseaseScore } = detectDisease(qNorm, tokens);
  const qty = extractQty(qNorm);

  return {
    normalized: qNorm,
    tokens,
    intent,
    intentScore,
    crop,
    cropScore,
    disease,
    diseaseScore,
    entities: { qty },
    // simple overall confidence heuristic (tune later)
    confidence: Math.max(intentScore, cropScore, diseaseScore),
  };
}

// For your controller: return best canned answer or null
function matchFaq(userText) {
  const info = analyze(userText);
  const { intent, crop, disease } = info;

  if (!intent && !crop && !disease) return null;

  if (intent === "planting_time") {
    return RESPONSES.planting_time[crop] || RESPONSES.planting_time.default;
  }

  if (intent === "irrigation") {
    return RESPONSES.irrigation[crop] || RESPONSES.irrigation.default;
  }

  if (intent === "disease_treat" || disease) {
    // prefer disease-specific if detected
    if (disease && RESPONSES.disease_treat[disease]) {
      return RESPONSES.disease_treat[disease];
    }
    return RESPONSES.disease_treat.generic;
  }

  return null;
}

module.exports = { analyze, matchFaq, RESPONSES };
