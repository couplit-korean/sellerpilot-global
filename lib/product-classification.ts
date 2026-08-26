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

const generalFoodEfficacyPatterns = [
  /(?:면역|혈행|혈압|혈당|콜레스테롤|체지방|피로|간\s*건강|장\s*건강|기억력|항산화|질병).{0,32}(?:개선|증진|강화|감소|저하|조절|예방|완화|도움)/iu,
  /(?:개선|증진|강화|감소|저하|조절|예방|완화|도움).{0,32}(?:면역|혈행|혈압|혈당|콜레스테롤|체지방|피로|간\s*건강|장\s*건강|기억력|항산화|질병)/iu,
  /(?:boost|improv|support|strengthen|reduc|lower|prevent|reliev)[a-z]*.{0,40}(?:immunity|blood\s*sugar|blood\s*pressure|cholesterol|body\s*fat|weight\s*loss|fatigue|liver\s*health|gut\s*health|memory|antioxidant|disease)/iu,
  /(?:免疫|血糖|血圧|脂肪|疲労|肝臓|腸内|記憶|抗酸化).{0,24}(?:改善|増進|強化|低減|予防|サポート)/u,
  /(?:免疫|血糖|血壓|脂肪|疲勞|肝臟|腸道|記憶|抗氧化).{0,24}(?:改善|增強|降低|預防|幫助|支持)/u,
  /(?:mejor|apoy|reduc|prev)[a-záéíóúñü]*.{0,40}(?:inmunidad|glucosa|presión\s*arterial|colesterol|grasa\s*corporal|fatiga|hígado|intestin)/iu,
  /(?:melhor|apoi|reduz|previn)[a-záàâãçéêíóôõú]*.{0,40}(?:imunidade|glicose|pressão\s*arterial|colesterol|gordura\s*corporal|fadiga|fígado|intestin)/iu,
  /(?:amélior|soutien|rédui|préven)[a-zàâçéèêëîïôûùüÿœ]*.{0,40}(?:immunité|glycémie|tension\s*artérielle|cholestérol|graisse|fatigue|foie|intestin)/iu,
  /(?:verbesser|unterstütz|reduzier|vorbeug)[a-zäöüß]*.{0,40}(?:immunsystem|blutzucker|blutdruck|cholesterin|körperfett|müdigkeit|leber|darm)/iu,
  /(?:miglior|support|riduc|preven)[a-zàèéìíîòóùú]*.{0,40}(?:immunità|glicemia|pressione|colesterolo|grasso|stanchezza|fegato|intestin)/iu,
] as const;

const prescriptiveIntakePatterns = [
  /(?:하루|1일|일일|매일|매회|1회|회당).{0,24}(?:\d+(?:[.,]\d+)?|한|두|세)\s*(?:mg|g|kg|ml|l|회|정|캡슐|포|봉|스푼|개)/iu,
  /(?:섭취|복용|먹|마시).{0,20}(?:\d+(?:[.,]\d+)?|한|두|세)\s*(?:mg|g|kg|ml|l|회|정|캡슐|포|봉|스푼|개)/iu,
  /(?:daily|per\s*day|each\s*day|a\s*day).{0,24}(?:\d+(?:[.,]\d+)?|one|two|three)\s*(?:mg|g|kg|ml|l|times?|tablets?|capsules?|sachets?|packets?|spoons?|servings?)/iu,
  /(?:take|consume|eat|drink).{0,20}(?:\d+(?:[.,]\d+)?|one|two|three)\s*(?:mg|g|kg|ml|l|times?|tablets?|capsules?|sachets?|packets?|spoons?|servings?).{0,24}(?:daily|per\s*day|each\s*day|a\s*day)/iu,
  /(?:一日|毎日|每日|每天).{0,20}(?:\d+(?:[.,]\d+)?|一|二|三)\s*(?:mg|g|kg|ml|l|回|錠|粒|包|杯)/iu,
] as const;

const directIntakeEvidencePattern = /(?:라벨|표시사항|포장|제조사|판매자\s*확정|섭취방법|복용방법|label|package|manufacturer|seller[- ]confirmed|directions|instructions|serving\s*size|ラベル|包装|用法|標示|包裝|用量|nhãn|etikett|etiqueta|étiquette|etichetta|rótulo)/iu;
const measuredIntakeTokenPattern = /(?:\d+(?:[.,]\d+)?|한|두|세|one|two|three|一|二|三)\s*(?:mg|g|kg|ml|l|회|정|캡슐|포|봉|스푼|개|times?|tablets?|capsules?|sachets?|packets?|spoons?|servings?|回|錠|粒|包|杯)/giu;

function withoutExplicitlyNegatedHealthClaims(value: string) {
  return value
    .replace(/(?:not|never|no|without|does\s+not|must\s+not)\s+(?:boost|improv|support|strengthen|reduc|lower|prevent|reliev)[a-z]*/giu, "")
    .replace(
      /(?:면역|혈행|혈압|혈당|콜레스테롤|체지방|피로|간\s*건강|장\s*건강|기억력|항산화|질병)[^.!?\n]{0,80}(?:개선|증진|강화|감소|저하|조절|예방|완화|도움)[^.!?\n]{0,32}(?:(?:표현|주장|광고)(?:하|되)?지\s*않|(?:효능|효과)(?:이|가)?\s*없|아니)[^.!?\n]*/gu,
      "",
    )
    .replace(/(?:개선|증진|강화|감소|저하|조절|예방|완화)(?:하지\s*않|하지\s*못|없)/gu, "");
}

function normalizedMeasuredTokens(value: string) {
  return [...value.matchAll(measuredIntakeTokenPattern)]
    .map((match) => match[0].toLocaleLowerCase().replace(/[\s,]/gu, "").replace("한", "1").replace("두", "2").replace("세", "3").replace("one", "1").replace("two", "2").replace("three", "3").replace("一", "1").replace("二", "2").replace("三", "3"));
}

export function isGeneralFoodClassification(value: unknown) {
  return generalFoodClassificationPattern.test(String(value ?? ""));
}

export function hasUnsupportedGeneralFoodEfficacyClaim(value: unknown) {
  const text = withoutExplicitlyNegatedHealthClaims(String(value ?? ""));
  return generalFoodEfficacyPatterns.some((pattern) => pattern.test(text));
}

export function hasPrescriptiveIntakeInstruction(value: unknown) {
  const text = String(value ?? "");
  return prescriptiveIntakePatterns.some((pattern) => pattern.test(text));
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
