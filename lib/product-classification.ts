const healthFunctionalFoodTermSource = "(?:건강\\s*기능\\s*식품|건기식)";
const koreanHealthFunctionalFoodNegationSource = [
  "아님",
  "아닌",
  "아닙니다",
  "아니다",
  "아니며",
  "아니오",
  "해당\\s*(?:없음|없습니다|없다)",
  "해당하지(?:\\s*않(?:습니다|는다|음|다))?",
  "표시(?:가|는)?\\s*(?:없음|없습니다|없다|없는)",
  "마크(?:가|는)?\\s*(?:없음|없습니다|없다|없는)",
].join("|");

export const healthFunctionalFoodNegationPattern = new RegExp(
  `(?:${healthFunctionalFoodTermSource}).{0,24}(?:${koreanHealthFunctionalFoodNegationSource})|(?:${koreanHealthFunctionalFoodNegationSource}).{0,24}(?:${healthFunctionalFoodTermSource})`,
  "iu",
);

export const positiveHealthFunctionalFoodEvidencePattern = /건강\s*기능\s*식품\s*(?:마크|표시|문구|인증)|영양[·ㆍ ]?기능정보|기능정보|인정번호/iu;

export function hasNegatedHealthFunctionalFoodSignal(value: unknown) {
  return healthFunctionalFoodNegationPattern.test(String(value ?? ""));
}

export function hasPositiveHealthFunctionalFoodEvidence(value: unknown) {
  const text = String(value ?? "");
  return !hasNegatedHealthFunctionalFoodSignal(text) && positiveHealthFunctionalFoodEvidencePattern.test(text);
}

const generalFoodClassificationPattern = /(?:일반\s*식품|식품|가공품|음료|과자|시리얼|커피|차류|캔디|젤리|통조림|참치|\b(?:food|beverage|cereal|coffee|tea|snack|candy|jelly|tuna|supplement)\b)/iu;

type ClaimNegationLanguage =
  | "ko"
  | "en"
  | "vi"
  | "id-ms"
  | "th"
  | "ja"
  | "zh"
  | "es"
  | "pt"
  | "fr"
  | "de"
  | "it"
  | "none";

type GeneralFoodEfficacyRule = Readonly<{
  language: ClaimNegationLanguage;
  pattern: RegExp;
}>;

const generalFoodEfficacyPatterns: readonly GeneralFoodEfficacyRule[] = [
  {
    language: "ko",
    pattern: /(?:면역(?:력)?|혈행|혈압|혈당|콜레스테롤|체지방|체중|소화|피로|간\s*건강|장\s*건강|기억력|항산화|질병).{0,32}?(?:개선|증진|강화|감소|감량|저하|조절|예방|치료|완화|도움|돕)|(?:개선|증진|강화|감소|감량|저하|조절|예방|치료|완화|도움|돕).{0,32}?(?:면역(?:력)?|혈행|혈압|혈당|콜레스테롤|체지방|체중|소화|피로|간\s*건강|장\s*건강|기억력|항산화|질병)/giu,
  },
  {
    language: "en",
    pattern: /(?:boost|improv|support|strengthen|reduc|lower|prevent|reliev|treat)[a-z]*.{0,40}?(?:immunity|blood\s*sugar|blood\s*pressure|cholesterol|body\s*fat|weight\s*loss|fatigue|liver\s*health|gut\s*health|digest(?:ion|ive\s*health)|memory|antioxidant|disease)/giu,
  },
  {
    language: "vi",
    pattern: /(?:tăng\s*cường|cải\s*thiện|hỗ\s*trợ|giúp|giảm|kiểm\s*soát|ổn\s*định|ngăn\s*ngừa|phòng\s*ngừa|điều\s*trị).{0,32}?(?:miễn\s*dịch|đường\s*huyết|cân(?:\s*nặng)?|mỡ\s*cơ\s*thể|tiêu\s*hóa|bệnh)|(?:miễn\s*dịch|đường\s*huyết|cân(?:\s*nặng)?|mỡ\s*cơ\s*thể|tiêu\s*hóa|bệnh)[^,;.!?\n]{0,20}?(?:được|có\s*thể|sẽ)\s*(?:tăng\s*cường|cải\s*thiện|hỗ\s*trợ|giúp|giảm|kiểm\s*soát|ổn\s*định|ngăn\s*ngừa|phòng\s*ngừa|điều\s*trị)/giu,
  },
  {
    language: "id-ms",
    pattern: /(?:meningkatkan|menguatkan|mendukung|menyokong|membantu|menurunkan|mengurangi|mengurangkan|mengawal|mencegah|merawat|mengobati|melancarkan).{0,36}?(?:imunitas|imuniti|kekebalan|gula\s*darah|berat\s*badan|lemak\s*(?:tubuh|badan)|pencernaan|penghadaman|penyakit)|(?:imunitas|imuniti|kekebalan|gula\s*darah|berat\s*badan|lemak\s*(?:tubuh|badan)|pencernaan|penghadaman|penyakit)[^,;.!?\n]{0,20}?(?:dapat|boleh|akan)\s*(?:ditingkatkan|dikuatkan|didukung|disokong|dibantu|diturunkan|dikurangi|dikurangkan|dikawal|dicegah|dirawat|diobati|dilancarkan)/giu,
  },
  {
    language: "th",
    pattern: /(?:เสริม|เพิ่ม|กระตุ้น|ช่วย|ลด|ควบคุม|ป้องกัน|รักษา).{0,24}?(?:ภูมิคุ้มกัน|น้ำตาลในเลือด|น้ำหนัก|ไขมันในร่างกาย|การย่อยอาหาร|ย่อยอาหาร|โรค)|(?:ภูมิคุ้มกัน|น้ำตาลในเลือด|น้ำหนัก|ไขมันในร่างกาย|การย่อยอาหาร|ย่อยอาหาร|โรค).{0,16}?(?:เพิ่มขึ้น|ดีขึ้น|ลดลง|ได้รับการ(?:ควบคุม|ป้องกัน|รักษา|ช่วย))/gu,
  },
  {
    language: "ja",
    pattern: /(?:免疫(?:力)?|血糖(?:値)?|血圧|(?:体)?脂肪|疲労|肝臓|腸内|記憶|抗酸化|病気|疾病)[^.!?。！？;；,，、\n]{0,24}?(?:改善|増進|強化|低減|予防|サポート|高め|下げ|減ら|防ぐ|治療|促進)|(?:改善|増進|強化|低減|予防|サポート|高め|下げ|減ら|防ぐ|治療|促進)[^.!?。！？;；,，、\n]{0,24}?(?:免疫(?:力)?|血糖(?:値)?|血圧|(?:体)?脂肪|疲労|肝臓|腸内|記憶|抗酸化|病気|疾病)/gu,
  },
  {
    language: "zh",
    pattern: /(?:免疫(?:力)?|血糖(?:值)?|血壓|血压|(?:體|体)?脂肪|疲勞|疲劳|肝臟|肝脏|腸道|肠道|記憶|记忆|抗氧化|疾病)[^.!?。！？;；,，、\n]{0,24}?(?:改善|增強|增强|提高|提升|降低|減少|减少|預防|预防|幫助|帮助|支持|控制|治療|治疗)|(?:改善|增強|增强|提高|提升|降低|減少|减少|預防|预防|幫助|帮助|支持|控制|治療|治疗)[^.!?。！？;；,，、\n]{0,24}?(?:免疫(?:力)?|血糖(?:值)?|血壓|血压|(?:體|体)?脂肪|疲勞|疲劳|肝臟|肝脏|腸道|肠道|記憶|记忆|抗氧化|疾病)/gu,
  },
  { language: "es", pattern: /(?:mejor|apoy|reduc|prev)[a-záéíóúñü]*[^.!?。！？;；,，、\n]{0,40}?(?:inmunidad|glucosa|presión\s*arterial|colesterol|grasa\s*corporal|fatiga|hígado|intestin)/giu },
  { language: "pt", pattern: /(?:melhor|apoi|reduz|previn)[a-záàâãçéêíóôõú]*[^.!?。！？;；,，、\n]{0,40}?(?:imunidade|glicose|pressão\s*arterial|colesterol|gordura\s*corporal|fadiga|fígado|intestin)/giu },
  { language: "fr", pattern: /(?:amélior|soutien|rédui|préven)[a-zàâçéèêëîïôûùüÿœ]*[^.!?。！？;；,，、\n]{0,40}?(?:immunité|glycémie|tension\s*artérielle|cholestérol|graisse|fatigue|foie|intestin)/giu },
  { language: "de", pattern: /(?:verbesser|unterstütz|reduzier|vorbeug)[a-zäöüß]*[^.!?。！？;；,，、\n]{0,40}?(?:immunsystem|blutzucker|blutdruck|cholesterin|körperfett|müdigkeit|leber|darm)/giu },
  { language: "it", pattern: /(?:miglior|support|riduc|preven)[a-zàèéìíîòóùú]*[^.!?。！？;；,，、\n]{0,40}?(?:immunità|glicemia|pressione|colesterolo|grasso|stanchezza|fegato|intestin)/giu },
];

const measuredIntakeAmountSource = "(?:\\d+(?:[.,]\\d+)?|한|두|세|one|two|three|一|二|三)";
const measuredIntakeUnitSource = "(?:tablets?|capsules?|sachets?|packets?|spoons?|servings?|times?|viên|lần|gói|muỗng|thìa|khẩu\\s*phần|tablet|kapsul|kali|bungkus|sendok|porsi|เม็ด|แคปซูล|ครั้ง|ซอง|ช้อน|หน่วยบริโภค|cápsulas?|comprimidos?|tabletas?|sobres?|cucharadas?|porciones?|veces?|cápsulas?|comprimidos?|tabletes?|sachês?|saquetas?|colheres?|porções?|vezes?|capsules?|comprimés?|sachets?|cuillères?|portions?|fois|kapseln?|tabletten?|beutel|löffel|portionen?|mal|capsule?|compresse?|bustine?|cucchiai?|porzioni?|volte?|회|정|캡슐|포|봉|스푼|개|回|次|錠|粒|包|杯|mg|kg|ml|g|l)";
const measuredIntakeSource = `${measuredIntakeAmountSource}\\s*${measuredIntakeUnitSource}`;

const prescriptiveIntakePatterns: readonly GeneralFoodEfficacyRule[] = [
  { language: "ko", pattern: new RegExp(`(?:하루|1일|일일|매일|매회|1회|회당).{0,24}${measuredIntakeSource}`, "giu") },
  { language: "ko", pattern: new RegExp(`(?:섭취|복용|먹|마시).{0,20}${measuredIntakeSource}`, "giu") },
  { language: "en", pattern: new RegExp(`(?:daily|per\\s*day|each\\s*day|a\\s*day).{0,24}${measuredIntakeSource}`, "giu") },
  { language: "en", pattern: new RegExp(`(?:take|consume|eat|drink).{0,20}${measuredIntakeSource}.{0,24}(?:daily|per\\s*day|each\\s*day|a\\s*day)`, "giu") },
  { language: "ja", pattern: new RegExp(`(?:一日|1日|毎日)[^.!?。！？;；,，、\\n]{0,20}?${measuredIntakeSource}`, "giu") },
  { language: "ja", pattern: new RegExp(`(?:摂取|服用|飲用|飲む|食べる)[^.!?。！？;；,，、\\n]{0,20}?${measuredIntakeSource}[^.!?。！？;；,，、\\n]{0,20}?(?:一日|1日|毎日)`, "giu") },
  { language: "zh", pattern: new RegExp(`(?:每日|每天|一天)[^.!?。！？;；,，、\\n]{0,20}?${measuredIntakeSource}`, "giu") },
  { language: "zh", pattern: new RegExp(`(?:服用|食用|飲用|饮用|吃|喝|攝取|摄取)[^.!?。！？;；,，、\\n]{0,20}?${measuredIntakeSource}[^.!?。！？;；,，、\\n]{0,20}?(?:每日|每天|一天)`, "giu") },
  { language: "vi", pattern: new RegExp(`(?:mỗi\\s*ngày|hàng\\s*ngày|hằng\\s*ngày|một\\s*ngày).{0,24}${measuredIntakeSource}`, "giu") },
  { language: "vi", pattern: new RegExp(`(?:uống|dùng|ăn|tiêu\\s*thụ|sử\\s*dụng).{0,20}${measuredIntakeSource}.{0,24}(?:mỗi\\s*ngày|hàng\\s*ngày|hằng\\s*ngày|một\\s*ngày)`, "giu") },
  { language: "id-ms", pattern: new RegExp(`(?:setiap\\s*hari|sehari|per\\s*hari|harian).{0,24}${measuredIntakeSource}`, "giu") },
  { language: "id-ms", pattern: new RegExp(`(?:konsumsi|mengambil|ambil|minum|makan|gunakan).{0,20}${measuredIntakeSource}.{0,24}(?:setiap\\s*hari|sehari|per\\s*hari|harian)`, "giu") },
  { language: "th", pattern: new RegExp(`(?:วันละ|ต่อวัน|ทุกวัน).{0,20}${measuredIntakeSource}`, "giu") },
  { language: "th", pattern: new RegExp(`(?:รับประทาน|กิน|ดื่ม|ใช้).{0,20}${measuredIntakeSource}.{0,20}(?:วันละ|ต่อวัน|ทุกวัน)`, "giu") },
  { language: "es", pattern: new RegExp(`(?:al\\s*día|cada\\s*día|por\\s*día|diariamente)[^.!?;；,，\\n]{0,24}?${measuredIntakeSource}`, "giu") },
  { language: "es", pattern: new RegExp(`(?:tomar|tome|toma|consumir|consuma|consume|ingerir|ingiera)[^.!?;；,，\\n]{0,20}?${measuredIntakeSource}[^.!?;；,，\\n]{0,24}?(?:al\\s*día|cada\\s*día|por\\s*día|diariamente)`, "giu") },
  { language: "pt", pattern: new RegExp(`(?:por\\s*dia|ao\\s*dia|todos\\s*os\\s*dias|diariamente)[^.!?;；,，\\n]{0,24}?${measuredIntakeSource}`, "giu") },
  { language: "pt", pattern: new RegExp(`(?:tomar|tome|toma|consumir|consuma|ingerir|ingira)[^.!?;；,，\\n]{0,20}?${measuredIntakeSource}[^.!?;；,，\\n]{0,24}?(?:por\\s*dia|ao\\s*dia|todos\\s*os\\s*dias|diariamente)`, "giu") },
  { language: "fr", pattern: new RegExp(`(?:par\\s*jour|chaque\\s*jour|quotidiennement)[^.!?;；,，\\n]{0,24}?${measuredIntakeSource}`, "giu") },
  { language: "fr", pattern: new RegExp(`(?:prendre|prenez|consommer|consommez|ingérer|ingérez)[^.!?;；,，\\n]{0,20}?${measuredIntakeSource}[^.!?;；,，\\n]{0,24}?(?:par\\s*jour|chaque\\s*jour|quotidiennement)`, "giu") },
  { language: "de", pattern: new RegExp(`(?:täglich|pro\\s*tag|jeden\\s*tag)[^.!?;；,，\\n]{0,24}?${measuredIntakeSource}`, "giu") },
  { language: "de", pattern: new RegExp(`(?:einnehmen|nehmen|verzehren)[^.!?;；,，\\n]{0,20}?${measuredIntakeSource}[^.!?;；,，\\n]{0,24}?(?:täglich|pro\\s*tag|jeden\\s*tag)`, "giu") },
  { language: "it", pattern: new RegExp(`(?:al\\s*giorno|ogni\\s*giorno|quotidianamente)[^.!?;；,，\\n]{0,24}?${measuredIntakeSource}`, "giu") },
  { language: "it", pattern: new RegExp(`(?:assumere|assumi|prendere|prendi|consumare|consuma)[^.!?;；,，\\n]{0,20}?${measuredIntakeSource}[^.!?;；,，\\n]{0,24}?(?:al\\s*giorno|ogni\\s*giorno|quotidianamente)`, "giu") },
];

const directIntakeEvidencePattern = /(?:라벨|표시사항|포장|제조사|판매자\s*확정|섭취방법|복용방법|label|package|manufacturer|seller[- ]confirmed|directions|instructions|serving\s*size|ラベル|包装|用法|製造元|メーカー|標示|包裝|用量|製造商|制造商|nhãn|bao\s*bì|nhà\s*sản\s*xuất|hướng\s*dẫn|khẩu\s*phần|kemasan|produsen|petunjuk|takaran\s*saji|pembungkusan|pengeluar|arahan|saiz\s*hidangan|ฉลาก|บรรจุภัณฑ์|ผู้ผลิต|คำแนะนำ|วิธีรับประทาน|ขนาดรับประทาน|etikett|hersteller|etiqueta|fabricante|étiquette|fabricant|etichetta|produttore|rótulo)/iu;
const measuredIntakeTokenPattern = new RegExp(measuredIntakeSource, "giu");

const healthClaimClauseBoundaryPattern = /[.!?。！？;；,，、\n]|하지만|그러나|반면|지만|しかし|一方|ものの|但是|然而|不過|不过|แต่|อย่างไรก็ตาม|\b(?:but|however|nhưng|tuy\s*nhiên|tetapi|namun|walaupun|pero|sin\s+embargo|mas|porém|contudo|mais|cependant|aber|jedoch|sondern|ma|però|tuttavia)\b/giu;

function claimClauseContext(value: string, start: number, end: number) {
  let clauseStart = 0;
  let clauseEnd = value.length;
  for (const boundary of value.matchAll(healthClaimClauseBoundaryPattern)) {
    const boundaryStart = boundary.index;
    const boundaryEnd = boundaryStart + boundary[0].length;
    if (boundaryEnd <= start) clauseStart = boundaryEnd;
    else if (boundaryStart >= end) {
      clauseEnd = boundaryStart;
      break;
    }
  }
  return {
    prefix: value.slice(clauseStart, start),
    suffix: value.slice(end, clauseEnd),
  };
}

function isExplicitlyNegatedHealthClaim(
  value: string,
  start: number,
  end: number,
  language: ClaimNegationLanguage,
  matchedCopy: string,
) {
  if (language === "none") return false;
  const { prefix, suffix } = claimClauseContext(value, start, end);
  if (language === "ko") {
    return /^[^.!?\n]{0,100}(?:(?:주장|표현|광고)(?:하|되)?지\s*않|(?:효능|효과|도움|기능)(?:이|가|을|를|은|는)?\s*없|(?:하|되|시키|주)?지\s*않|아니(?:다|며|고|오|에요|입니다))/u.test(suffix);
  }
  if (language === "en") {
    const negated = /(?:\b(?:not|never)\b|\bno\s+(?:claim|claims|ability)\s+to|\b(?:does|do|did|is|are|was|were|will|can|must)\s+not)(?:\s+[a-z]+){0,5}\s*$/iu.test(prefix);
    return negated && !/\bnot\s+(?:only|just)\b/iu.test(prefix);
  }
  if (language === "vi") {
    return /\b(?:không|chẳng)(?:\s+(?:nhằm|hề|thể|giúp|được|dùng|có|mục\s*đích|để)){0,5}\s*$/iu.test(prefix);
  }
  if (language === "id-ms") {
    return /\b(?:tidak|bukan)(?:\s+(?:dimaksudkan|bertujuan|untuk|boleh|dapat|akan|membantu|menyokong)){0,5}\s*$/iu.test(prefix);
  }
  if (language === "th") {
    return /ไม่(?:ได้|ได้มี|มี|ใช่|ได้มีไว้เพื่อ|มีวัตถุประสงค์เพื่อ)?[\s\u200b]*$/u.test(prefix);
  }
  if (language === "ja") {
    return /^(?:[^.!?。！？\n]{0,48})(?:しない|しません|できない|できません|されない|されません|ない|ません|ものでは(?:ない|ありません)|効果は(?:ない|ありません))/u.test(suffix)
      || /(?:不|無法|无法|不能|不會|不会|並非|并非|沒有|没有)[^.!?。！？;；,，、\n]{0,16}(?:改善|增強|增强|提高|提升|降低|減少|减少|預防|预防|幫助|帮助|支持|控制|治療|治疗)/u.test(`${prefix}${matchedCopy}`);
  }
  if (language === "zh") {
    return /(?:不|無法|无法|不能|不會|不会|並非|并非|沒有|没有)[^.!?。！？;；,，、\n]{0,16}(?:改善|增強|增强|提高|提升|降低|減少|减少|預防|预防|幫助|帮助|支持|控制|治療|治疗)/u.test(`${prefix}${matchedCopy}`)
      || /^(?:[^.!?。！？\n]{0,48})(?:しない|しません|できない|できません|されない|されません|ない|ません|ものでは(?:ない|ありません)|効果は(?:ない|ありません))/u.test(suffix);
  }
  if (language === "es") {
    const negated = /\b(?:no|nunca|jamás)(?:\s+[a-záéíóúñü]+){0,4}\s*$/iu.test(prefix);
    return negated && !/\bno\s+(?:solo|solamente)\b/iu.test(prefix);
  }
  if (language === "pt") {
    const negated = /\b(?:não|nunca|jamais)(?:\s+[a-záàâãçéêíóôõú]+){0,4}\s*$/iu.test(prefix);
    return negated && !/\bnão\s+(?:só|somente|apenas)(?=\s|$)/iu.test(prefix);
  }
  if (language === "fr") {
    const negated = /(?:\b(?:ne|jamais)\b|n['’])(?:\s+[a-zàâçéèêëîïôûùüÿœ]+){0,4}\s*$/iu.test(prefix)
      || /\b(?:pas|jamais|aucun(?:e)?)\b/iu.test(matchedCopy);
    return negated && !/\bpas\s+seulement\b/iu.test(`${prefix} ${matchedCopy}`);
  }
  if (language === "de") {
    const negated = /\b(?:nicht|nie|kein(?:e[rmns]?)?)(?:\s+[a-zäöüß]+){0,4}\s*$/iu.test(prefix)
      || /\b(?:nicht|nie|kein(?:e[rmns]?)?)\b/iu.test(matchedCopy);
    return negated && !/\bnicht\s+nur\b/iu.test(`${prefix} ${matchedCopy}`);
  }
  const negated = /\b(?:non|mai)(?:\s+[a-zàèéìíîòóùú]+){0,4}\s*$/iu.test(prefix);
  return negated && !/\bnon\s+solo\b/iu.test(prefix);
}

function isExplicitlyNegatedIntakeInstruction(
  value: string,
  start: number,
  end: number,
  language: ClaimNegationLanguage,
  matchedCopy: string,
) {
  if (language === "none") return false;
  const { prefix, suffix } = claimClauseContext(value, start, end);
  if (language === "ko") {
    return /^[^.!?\n]{0,60}(?:(?:섭취|복용|먹|마시)(?:하|되)?지\s*않|(?:섭취|복용|먹|마시)(?:하)?지\s*마|권장하지\s*않|필요(?:가)?\s*없)/u.test(suffix);
  }
  if (language === "en") {
    return /(?:\b(?:not|never)\b|\b(?:does|do|did|must|should)\s+not)(?:\s+[a-z]+){0,4}\s*$/iu.test(prefix);
  }
  if (language === "vi") {
    return /\b(?:không|chẳng|đừng)(?:\s+(?:nên|cần|được|dùng|có|phải)){0,4}\s*$/iu.test(prefix);
  }
  if (language === "id-ms") {
    return /\b(?:jangan|tidak|bukan)(?:\s+(?:perlu|boleh|harus|usah|mengambil|untuk)){0,4}\s*$/iu.test(prefix);
  }
  if (language === "th") {
    return /(?:ไม่|ห้าม)(?:ได้|ควร|ต้อง)?[\s\u200b]*$/u.test(prefix);
  }
  if (language === "ja") {
    return /(?:摂取|服用|飲用|飲む|食べる)(?:しない|しません|しなくてよい|する必要(?:が)?ない)/u.test(`${matchedCopy}${suffix}`);
  }
  if (language === "zh") {
    return /(?:不要|不應|不应|無需|无需|不必)[^.!?。！？;；,，、\n]{0,24}(?:服用|食用|飲用|饮用|吃|喝|攝取|摄取)/u.test(`${prefix}${matchedCopy}`);
  }
  if (language === "es") {
    return /\b(?:no|nunca|jamás)(?:\s+[a-záéíóúñü]+){0,4}\s*$/iu.test(prefix)
      && !/\bno\s+(?:solo|solamente)\b/iu.test(prefix);
  }
  if (language === "pt") {
    return /\b(?:não|nunca|jamais)(?:\s+[a-záàâãçéêíóôõú]+){0,4}\s*$/iu.test(prefix)
      && !/\bnão\s+(?:só|somente|apenas)(?=\s|$)/iu.test(prefix);
  }
  if (language === "fr") {
    const negated = /(?:\bne\b|n['’])(?:\s+[a-zàâçéèêëîïôûùüÿœ]+){0,4}\s*$/iu.test(prefix)
      && /\b(?:pas|jamais)\b/iu.test(matchedCopy);
    return negated && !/\bpas\s+seulement\b/iu.test(matchedCopy);
  }
  if (language === "de") {
    return /\b(?:nicht|nie|kein(?:e[rmns]?)?)\b/iu.test(matchedCopy)
      && !/\bnicht\s+nur\b/iu.test(matchedCopy);
  }
  return /\b(?:non|mai)(?:\s+[a-zàèéìíîòóùú]+){0,4}\s*$/iu.test(prefix)
    && !/\bnon\s+solo\b/iu.test(prefix);
}

function normalizedMeasuredTokens(value: string) {
  return [...value.matchAll(measuredIntakeTokenPattern)]
    .map((match) => match[0]
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/(\d),(\d)/gu, "$1.$2")
      .replace(/\s/gu, "")
      .replace(/^(?:한|one|一)/u, "1")
      .replace(/^(?:두|two|二)/u, "2")
      .replace(/^(?:세|three|三)/u, "3"));
}

export function isGeneralFoodClassification(value: unknown) {
  return generalFoodClassificationPattern.test(String(value ?? ""));
}

export function hasUnsupportedGeneralFoodEfficacyClaim(value: unknown) {
  const text = String(value ?? "");
  return generalFoodEfficacyPatterns.some((rule) => {
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index;
      if (!isExplicitlyNegatedHealthClaim(text, start, start + match[0].length, rule.language, match[0])) return true;
    }
    return false;
  });
}

export function hasPrescriptiveIntakeInstruction(value: unknown) {
  const text = String(value ?? "");
  return prescriptiveIntakePatterns.some((rule) => {
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index;
      if (!isExplicitlyNegatedIntakeInstruction(text, start, start + match[0].length, rule.language, match[0])) return true;
    }
    return false;
  });
}

export function hasDirectIntakeEvidence(claim: unknown, evidence: unknown) {
  const claimText = String(claim ?? "");
  if (!hasPrescriptiveIntakeInstruction(claimText)) return true;
  const evidenceText = String(evidence ?? "");
  if (!directIntakeEvidencePattern.test(evidenceText)) return false;
  const claimTokens = normalizedMeasuredTokens(claimText);
  if (!claimTokens.length) return false;
  const evidenceTokens = new Set(normalizedMeasuredTokens(evidenceText));
  return claimTokens.every((token) => evidenceTokens.has(token));
}
