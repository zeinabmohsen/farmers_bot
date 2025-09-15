// src/nlp/faq.matcher.js
// Advanced, fast Arabic NLP for WhatsApp farmer coach (no LLMs)
// - Robust normalization/tokenization comes from ./normalize (with affix stripping).
// - Intents: planting_time, irrigation, disease_treat, pest_control,
//            fertilization, spacing, harvest_time, greeting, thanks, fallback
// - Entities: crop, disease, pest, qty/unit, month
// - Exact + fuzzy matching (uses fuse.js if installed; falls back to tiny fuzzy)
// - Region-aware planting calendars (med | gulf_hot | highland_cool)
// - Exports:
//     analyze(text, ctx)
//     respond(text, ctx) -> { text, intent, confidence, crop, disease, pest, buttons? }
//     matchFaq(text, ctx)  // simple: returns text or null (kept for backward-compat)

const { normalizeAr, tokenize } = require('./normalize');

// --- optional: fuse.js (nice-to-have). We'll fall back to a tiny fuzzy if missing.
let Fuse = null;
try {
  const FuseMod = require('fuse.js');
  Fuse = FuseMod?.default || FuseMod;
} catch (_) {
  Fuse = null;
}

/* ========================= Gazetteers ========================= */

// Crops (extend freely)
const CROP_SYNONYMS = {
  'طماطم':   ['طماطم','بندوره','بندورة'],
  'خيار':    ['خيار'],
  'بطاطا':   ['بطاطا','بطاطس'],
  'قمح':     ['قمح','حنطه','حنطة'],
  'فلفل':    ['فلفل','فليفله','فليفلة'],
  'باذنجان': ['باذنجان','بيتنجان'],
  'بصل':     ['بصل'],
  'ثوم':     ['ثوم'],
  'كوسا':    ['كوسا','كوسه'],
  'فاصوليا': ['فاصوليا','لوبيا'],
  'ذره':     ['ذره','ذرة','درة'],
  'ننعع':    ['نعناع','نعنع'] // typo-friendly example
};

// Diseases (add as needed)
const DISEASE_SYNONYMS = {
  'اللفحة':           ['لفحه','اللفحه','اللفحة','لفحة مبكرة','لفحة متاخرة','لفحه مبكره','لفحه متاخره'],
  'البياض الدقيقي':   ['البياض','بياض دقيقي','البياض الدقيقي'],
  'البياض الزغبي':    ['البياض الزغبي','زغبي'],
  'الذبول':           ['ذبول','الذبول','ذبول فطري']
};

// Pests (IPM focus)
const PEST_SYNONYMS = {
  'المن':            ['من','المن','قمل نباتي'],
  'الذبابة البيضاء': ['ذبابة بيضاء','الذبابة البيضاء','whitefly'],
  'التربس':          ['تربس','thrips'],
  'حافرة الاوراق':   ['حافرة الورق','حافرة الاوراق','leaf miner','leafminer'],
  'توتا ابسولوتا':   ['توتا','توتا ابسولوتا','Tuta','Tuta absoluta'],
  'دودة ورق القطن':  ['دودة ورق القطن','cotton leafworm']
};

// Arabic month names (loose)
const MONTHS = {
  'يناير':1,'كانون الثاني':1,'جانفي':1,'شهر1':1,
  'فبراير':2,'شباط':2,'شهر2':2,
  'مارس':3,'اذار':3,'آذار':3,'شهر3':3,
  'ابريل':4,'أبريل':4,'نيسان':4,'افريل':4,'شهر4':4,
  'مايو':5,'ايار':5,'شهر5':5,
  'يونيو':6,'حزيران':6,'شهر6':6,
  'يوليو':7,'تموز':7,'شهر7':7,
  'اغسطس':8,'أغسطس':8,'اب':8,'آب':8,'شهر8':8,
  'سبتمبر':9,'ايلول':9,'أيلول':9,'شهر9':9,
  'اكتوبر':10,'أكتوبر':10,'تشرين الاول':10,'شهر10':10,
  'نوفمبر':11,'تشرين الثاني':11,'شهر11':11,
  'ديسمبر':12,'كانون الاول':12,'شهر12':12
};

/* ========================= Helpers ========================= */

function buildReverseMap(dict){
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
const CROPS    = buildReverseMap(CROP_SYNONYMS);
const DISEASES = buildReverseMap(DISEASE_SYNONYMS);
const PESTS    = buildReverseMap(PEST_SYNONYMS);

// Optional Fuse indices
const cropFuse    = Fuse ? new Fuse(CROPS.flat,    { keys: ['syn'], includeScore: true, threshold: 0.35 }) : null;
const diseaseFuse = Fuse ? new Fuse(DISEASES.flat, { keys: ['syn'], includeScore: true, threshold: 0.35 }) : null;
const pestFuse    = Fuse ? new Fuse(PESTS.flat,    { keys: ['syn'], includeScore: true, threshold: 0.35 }) : null;

// Fallback Levenshtein similarity (if Fuse not installed)
function lev(a, b){
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m+1 }, () => new Array(n+1));
  for (let i=0;i<=m;i++) dp[i][0]=i;
  for (let j=0;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++){
    for (let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}
function sim(a,b){
  if (!a || !b) return 0;
  if (a===b) return 1;
  const d = lev(a,b);
  const M = Math.max(a.length,b.length);
  return 1 - d/M;
}

function detectFromDict(qNorm, tokens, MAP, FUSE){
  // exact token first
  for (const t of tokens) if (MAP.rev[t]) return { value: MAP.rev[t], score: 1 };
  // fuzzy over tokens
  let best = { value: null, score: 0 };
  for (const t of tokens) {
    if (FUSE) {
      const hit = FUSE.search(t)[0];
      if (hit) {
        const s = 1 - (hit.score ?? 1);
        if (s > best.score) best = { value: hit.item.canon, score: s };
      }
    } else {
      for (const item of MAP.flat) {
        const s = sim(t, item.syn);
        if (s > best.score) best = { value: item.canon, score: s };
      }
    }
  }
  return best.score >= 0.78 ? best : { value: null, score: 0 };
}

function extractMonth(qNorm){
  for (const [name,num] of Object.entries(MONTHS)) {
    if (qNorm.includes(normalizeAr(name))) return num;
  }
  // numeric month e.g., "شهر 3" handled in MONTHS above; also try bare numbers 1..12
  const m = qNorm.match(/\b(1[0-2]|[1-9])\b/);
  if (m) return Number(m[1]);
  return null;
}

/* ========================= Intent scoring ========================= */

const INTENT_KWS = {
  planting_time:  ['متى','امتى','وقت','موعد','ازرع','زراعه','زراعة','مواعيد','شتل','شتله','شتلة','غرس'],
  irrigation:     ['ري','اسقي','سقي','ارو','سقاية','مياه','ماء','رش','رشاش'],
  disease_treat:  ['علاج','اعالج','حل','مكافحه','مكافحة','مرض','امراض','اعراض','اللفحه','البياض','الذبول','فطري','وقايه','وقاية','اصابه','اصابة'],
  pest_control:   ['حشره','حشرة','افات','آفات','آفه','افه','مكافحة','رش','بدون كيميائي','بيولوجي','اصابة حشرية','تربس','من','ذبابة بيضاء','whitefly'],
  fertilization:  ['تسميد','سماد','npk','بوتاسيوم','فوسفور','نيتروجين','كومبوست'],
  spacing:        ['مسافه','مسافة','تباعد','بين','خط','سطر','شتلة','شتلات'],
  harvest_time:   ['حصاد','حصد','نضج','كم يوم','كم يوم للنضج'],
  greeting:       ['مرحبا','مرحباً','اهلا','أهلا','سلام','هاي','هلو'],
  thanks:         ['شكرا','شكرًا','مشكور','تسلم']
};

function scoreIntent(tokens){
  const scores = {};
  for (const [intent, kws] of Object.entries(INTENT_KWS)) {
    let s = 0;
    for (let i=0;i<tokens.length;i++){
      if (kws.includes(tokens[i])) s += (1 + (tokens.length - i)*0.02);
    }
    scores[intent] = s;
  }
  const ranked = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const [topIntent, rawTop] = ranked[0] || [null, 0];
  return {
    intent: rawTop >= 1 ? topIntent : null,
    intentScore: Math.min(rawTop/3, 1),
    ranked
  };
}

/* ========================= Region profiles ========================= */

// Define planting windows per region (very rough baselines)
const CALENDAR = {
  med: { // Mediterranean
    'طماطم':[3,4,8,9], 'خيار':[3,4], 'بطاطا':[9,10,1,2], 'قمح':[10,11,12], 'فلفل':[4], 'باذنجان':[4,5]
  },
  gulf_hot: { // Hot desert/Gulf
    'طماطم':[9,10,11], 'خيار':[9,10,11], 'بطاطا':[10,11,12], 'قمح':[11,12], 'فلفل':[10,11], 'باذنجان':[10,11]
  },
  highland_cool: { // Highlands/cooler
    'طماطم':[4,5], 'خيار':[4,5], 'بطاطا':[4,5], 'قمح':[9,10], 'فلفل':[5], 'باذنجان':[5]
  }
};

function plantingAdvice(crop, month, region='med'){
  const table = CALENDAR[region] || CALENDAR.med;
  const ok = table[crop];
  if (!ok || !ok.length) return 'عمومًا يتحدد الموعد حسب الحرارة المحلية. اذكر منطقتك لنصيحة أدق.';
  if (month) {
    const good = ok.includes(month);
    return good
      ? `نعم، ${nameOfMonth(month)} مناسب لـ${crop} في منطقتك (${region}).`
      : `الشهر ${nameOfMonth(month)} ليس الأنسب عادةً لـ${crop} في (${region}). الأشهر المناسبة: ${ok.map(nameOfMonth).join('، ')}.`;
  }
  return `الأشهر المناسبة لزراعة ${crop} (${region}): ${ok.map(nameOfMonth).join('، ')}.`;
}

function nameOfMonth(n){ return ['—','يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'][n] || String(n); }

/* ========================= Canned answers ========================= */

const RESPONSES = {
  help:
`أهلًا! اسأل مثل:
• متى ازرع الطماطم؟
• ري الخيار كيف؟
• علاج اللفحة على البندورة؟
• مسافة زراعة البطاطا؟
• تسميد الفلفل؟`,

  irrigation: {
    'طماطم':'ري منتظم بلا إغراق؛ اترك السطح يجف قليلًا بين الريات. صباحًا أفضل وتجنب البلل الليلي للأوراق.',
    'خيار':'يحتاج رطوبة ثابتة خاصة بالحر؛ تجنب الجفاف المتكرر وزد الري مع الإثمار.',
    'بطاطا':'ري معتدل وتربة جيدة الصرف لتفادي الأعفان.',
    'قمح':'يعتمد غالبًا على أمطار الشتاء؛ ري تكميلي عند الحاجة.',
    default:'قاعدة: ري عميق متباعد أفضل من ريات خفيفة متكررة. اذكر المحصول لنصائح أدق.'
  },

  disease_treat: {
    generic:'للمكافحة الحيوية: حسّن التهوية، تجنّب البلل الليلي، ازل الأجزاء المصابة، اتّبع الدورة الزراعية، واستخدم مركبات نحاسية/كبريتية بتركيزات آمنة عند الحاجة.',
    'اللفحة':'تهوية جيدة، إزالة أوراق سفلية المصابة، تجنّب البلل الليلي، ورشّات نحاسية عضوية عند الحاجة.',
    'البياض الدقيقي':'حسّن حركة الهواء، قلّل الرطوبة، رشّات كبريت/بيكربونات بوتاسيوم حسب الإرشادات.',
    'البياض الزغبي':'اختر أصناف متحملة، حسّن الصرف والتهوية، رشّات نحاسية وقائية.',
    'الذبول':'تجنّب التربة المغمورة، حسّن الصرف، اختر أصناف مقاومة، ودورة زراعية أطول.'
  },

  pest_control: {
    generic:'إدارة متكاملة للآفات: مصائد لاصقة صفراء، إزالة الأعشاب حول الحقل، تشجيع الأعداء الحيوية (الخنافس/الدبابير الطفيلية)، ورشّات صابونية/زيوت نباتية عند الحاجة.',
    'المن':'رشّات صابونية لطيفة، تشجيع الدعسوقات، تجنّب الآزوت الزائد.',
    'الذبابة البيضاء':'مصائد صفراء، تنظيف الحواف، رشّات صابونية/زيوت، وراقب ظهور السلالات المقاومة.',
    'التربس':'خفض الغبار، مصائد زرقاء، رشّات صابونية مبكرة، نباتات مصيدة إن أمكن.',
    'حافرة الاوراق':'إزالة الأوراق المصابة مبكرًا، تشجيع الأعداء الحيوية، مصائد فرمونية عند التوفر.',
    'توتا ابسولوتا':'مصائد فرمونية ومائية، تغطية ببيت بلاستيكي محكم، إزالة بقايا المحصول ودفنها جيدًا.',
    'دودة ورق القطن':'جمع يدوي مبكر، تشجيع الطيور/الأعداء الحيوية، مصائد ضوئية بعيدًا عن الحقل.'
  },

  fertilization: {
    generic:'ابدأ بتحليل تربة. مبدئيًا: كومبوست متحلل جيّد، ثم NPK متوازن بكميات صغيرة مقسّطة حسب مراحل النمو. لا تُفرط بالنيتروجين.',
    'طماطم':'كومبوست قبل الزراعة + تسميد متوازن؛ زد البوتاسيوم عند التزهير والإثمار.',
    'خيار':'تسميد متدرّج خفيف لكن مستمر؛ حسّاس للملوحة، راقب التوصيل الكهربائي EC.',
    'فلفل':'كومبوست + بوتاسيوم جيد بداية الإزهار؛ راقب الكالسيوم لتجنّب عفن الطرف الزهري.'
  },

  spacing: {
    generic:'قاعدة عامة: مسافة أكبر = تهوية أفضل وأمراض أقل. اذكر المحصول.',
    'طماطم':'بين الشتلات 40–60 سم، وبين الخطوط 80–100 سم (حسب الصنف والتربية).',
    'خيار':'على التعريشة: 30–40 سم بين الشتلات، 1.5–2 م بين الخطوط.',
    'بطاطا':'بين الدرنات 25–35 سم، بين الخطوط 70–90 سم.'
  },

  harvest_time: {
    generic:'يختلف حسب الصنف والحرارة. اذكر المحصول.',
    'طماطم':'غالبًا 70–90 يومًا من الشتل حتى أول حصاد.',
    'خيار':'45–60 يومًا من الزراعة.',
    'بطاطا':'90–120 يومًا حسب الموسم والصنف.'
  },

  greeting:'أهلًا وسهلًا 🌿 كيف أقدر أساعدك؟',
  thanks:'عفوًا، بالتوفيق بالموسم! 🌱'
};

/* ========================= Analysis ========================= */

const QTY_RE = /(\d+(?:\.\d+)?)\s*(لتر|جم|غ|كجم|مل|ملل|ملليلتر|هكتار|فدان|متر|سم)/;

function extractQty(qNorm){
  const m = qNorm.match(QTY_RE);
  return m ? { value: Number(m[1]), unit: m[2] } : null;
}

function analyze(userText, ctx = {}){
  const region = (ctx.region || 'med'); // 'med' | 'gulf_hot' | 'highland_cool'
  const qNorm  = normalizeAr(userText);
  const tokens = tokenize(userText, { removeStopwords: true });

  const { intent, intentScore, ranked } = scoreIntent(tokens);
  const { value: crop,    score: cropScore }    = detectFromDict(qNorm, tokens, CROPS,    cropFuse);
  const { value: disease, score: diseaseScore } = detectFromDict(qNorm, tokens, DISEASES, diseaseFuse);
  const { value: pest,    score: pestScore }    = detectFromDict(qNorm, tokens, PESTS,    pestFuse);
  const qty = extractQty(qNorm);
  const month = extractMonth(qNorm);

  const confidence = Math.max(intentScore, cropScore, diseaseScore, pestScore);

  return {
    normalized: qNorm,
    tokens,
    region,
    intent, intentScore, ranked,
    crop, cropScore,
    disease, diseaseScore,
    pest, pestScore,
    entities: { qty, month },
    confidence
  };
}

/* ========================= Response logic ========================= */

function chooseResponse(info){
  const { intent, crop, disease, pest, entities, region } = info;
  const month = entities.month;

  if (!intent && (crop || disease || pest)) {
    // If they mention only entity, pick a sensible default intent
    if (disease) return (RESPONSES.disease_treat[disease] || RESPONSES.disease_treat.generic);
    if (pest)    return (RESPONSES.pest_control[pest] || RESPONSES.pest_control.generic);
  }

  switch (intent) {
    case 'greeting':      return RESPONSES.greeting;
    case 'thanks':        return RESPONSES.thanks;

    case 'planting_time':
      if (crop) return plantingAdvice(crop, month, region);
      return 'لإعطاء موعد زراعة أدق، اذكر اسم المحصول (مثال: متى ازرع الطماطم؟).';

    case 'irrigation':
      return (RESPONSES.irrigation[crop] || RESPONSES.irrigation.default);

    case 'disease_treat':
      if (disease && RESPONSES.disease_treat[disease]) return RESPONSES.disease_treat[disease];
      return RESPONSES.disease_treat.generic;

    case 'pest_control':
      if (pest && RESPONSES.pest_control[pest]) return RESPONSES.pest_control[pest];
      return RESPONSES.pest_control.generic;

    case 'fertilization':
      return (RESPONSES.fertilization[crop] || RESPONSES.fertilization.generic);

    case 'spacing':
      return (RESPONSES.spacing[crop] || RESPONSES.spacing.generic);

    case 'harvest_time':
      return (RESPONSES.harvest_time[crop] || RESPONSES.harvest_time.generic);

    default:
      return null;
  }
}

/* ========================= UI helpers ========================= */

// Generate quick-reply buttons when confidence is low
function clarifyingButtons(info){
  const buttons = [];

  if (!info.crop) {
    const topCrops = Object.keys(CROP_SYNONYMS).slice(0, 6);
    for (const c of topCrops) buttons.push({ id: `crop_${c}`, title: c });
  }

  if (!info.intent) {
    const intents = [
      { id:'intent_planting_time', title:'موعد الزراعة' },
      { id:'intent_irrigation',    title:'الري' },
      { id:'intent_disease_treat', title:'علاج الأمراض' },
      { id:'intent_pest_control',  title:'مكافحة الآفات' },
      { id:'intent_fertilization', title:'التسميد' },
      { id:'intent_spacing',       title:'المسافات' }
    ];
    buttons.push(...intents);
  }

  return buttons.slice(0, 6); // WhatsApp reply buttons limit
}

/* ========================= Public API ========================= */

// Backward-compatible: simple text or null
function matchFaq(userText, ctx){
  const r = respond(userText, ctx);
  return r.text || null;
}

// Rich responder: returns message text + metadata + optional buttons
function respond(userText, ctx){
  const info = analyze(userText, ctx);
  const text = chooseResponse(info);

  // If unsure, offer helpful buttons instead of a dead end
  if (!text || info.confidence < 0.45) {
    const buttons = clarifyingButtons(info);
    return {
      text: text || RESPONSES.help,
      intent: info.intent || 'fallback',
      confidence: info.confidence,
      crop: info.crop || null,
      disease: info.disease || null,
      pest: info.pest || null,
      buttons
    };
  }

  return {
    text,
    intent: info.intent || 'inferred',
    confidence: info.confidence,
    crop: info.crop || null,
    disease: info.disease || null,
    pest: info.pest || null
  };
}

module.exports = { analyze, respond, matchFaq, RESPONSES };
