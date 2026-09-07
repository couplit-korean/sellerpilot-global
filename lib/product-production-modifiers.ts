export const PRODUCT_PRODUCTION_MODIFIER_VERSION = "2026-09-07-v1-composable-physical-signals";

export type ProductProductionModifierInput = {
  name?: string | null;
  category?: string | null;
  features?: readonly string[] | null;
  cautions?: readonly string[] | null;
  material?: string | null;
  packageContents?: string | null;
};

export type ProductProductionModifier = {
  id: string;
  label: string;
  axis: "package" | "geometry" | "material" | "mechanism" | "state";
  direction: string;
  evidence: string;
  forbidden: string;
};

export type ProductProductionModifierResolution = {
  version: string;
  modifiers: readonly ProductProductionModifier[];
  sourceEvidence: string;
  slotDirective: string;
};

type ModifierDefinition = ProductProductionModifier & { pattern: RegExp };

const modifierDefinitions: readonly ModifierDefinition[] = [
  // Package and container forms determine silhouette, contact shadow and opening evidence.
  { id: "carton-box", label: "단상자·카톤", axis: "package", pattern: /단상자|종이상자|카톤|박스형|carton|paper box/i, direction: "앞·옆 모서리와 상하 플랩이 보이는 직육면체 비율을 보존한다", evidence: "정면 라벨과 실제 제공된 측면·후면 패널을 분리해 사용한다", forbidden: "상자를 병·파우치로 바꾸거나 숨은 면을 생성하지 않는다" },
  { id: "flexible-pouch", label: "파우치·봉지", axis: "package", pattern: /파우치|봉지|리필팩|스탠딩팩|sachet pouch|refill pack|bag package/i, direction: "유연한 가장자리, 실링선, 바닥 거싯과 실제 충전 부피를 보존한다", evidence: "절취선·지퍼·실링은 보이는 원본 면에서만 확대한다", forbidden: "단단한 상자처럼 세우거나 과도하게 팽팽한 표면을 만들지 않는다" },
  { id: "bottle", label: "병", axis: "package", pattern: /병입|보틀|페트병|유리병|bottle|flacon/i, direction: "몸통 곡률, 목, 어깨, 바닥 접지와 실제 캡 비율을 보존한다", evidence: "정면 라벨, 캡, 측면 곡률과 용량 표기를 서로 다른 컷에서 확인한다", forbidden: "병 모양·마개 종류·액체 높이를 바꾸지 않는다" },
  { id: "jar-pot", label: "단지·자", axis: "package", pattern: /단지형|크림통|jar|pot container/i, direction: "넓은 입구와 낮은 몸통, 뚜껑 결합 높이를 보존한다", evidence: "내부·씰·스패출러는 해당 원본 사진이 있을 때만 보여준다", forbidden: "제형 소용돌이·내용물·내부 씰을 창작하지 않는다" },
  { id: "tube", label: "튜브", axis: "package", pattern: /튜브형|튜브용기|치약|연고형|tube package|squeeze tube/i, direction: "유연한 몸통, 크림프 끝, 노즐과 캡의 축을 정확히 유지한다", evidence: "캡·노즐·밀봉부와 용량 표기를 별도로 확인한다", forbidden: "내용물을 짜내거나 노즐 형태를 바꾸지 않는다" },
  { id: "pump-dispenser", label: "펌프 용기", axis: "package", pattern: /펌프형|펌프용기|디스펜서|pump bottle|pump dispenser/i, direction: "펌프 헤드 방향, 목 잠금부와 몸통 중심축을 보존한다", evidence: "잠금·회전·노즐 구조는 실제 근접 사진을 우선한다", forbidden: "가압·분사·방울과 펌프 이동 상태를 창작하지 않는다" },
  { id: "dropper-vial", label: "스포이드·앰플·바이알", axis: "package", pattern: /스포이드|앰플|바이알|드로퍼|dropper|ampoule|vial/i, direction: "작은 병과 캡·피펫의 가는 비율 및 유리 반사를 보존한다", evidence: "피펫과 액체는 열린 원본 사진이 있을 때만 근거로 사용한다", forbidden: "임의 방울·주사 연출·액체 색을 만들지 않는다" },
  { id: "stick-sachet", label: "스틱·낱개 포", axis: "package", pattern: /스틱형|스틱포|개별포|낱개포|stick pack|single sachet/i, direction: "길고 얇은 낱개 포와 외상자의 실제 수량 관계를 보존한다", evidence: "절취부, 1포 중량, 총 포 수를 원본별로 확인한다", forbidden: "보이지 않는 낱개를 추가하거나 내용물을 쏟지 않는다" },
  { id: "blister-pack", label: "PTP·블리스터", axis: "package", pattern: /PTP|블리스터|blister pack/i, direction: "포켓 배열, 포일 면과 실제 정제·캡슐 수를 보존한다", evidence: "앞뒤 포일 표기와 빈 포켓 여부는 제공 사진에서만 확인한다", forbidden: "정제 색·각인·개수나 뜯긴 포켓을 만들지 않는다" },
  { id: "can-tin", label: "캔·틴", axis: "package", pattern: /캔입|통조림|틴케이스|can(?:ned)?|tin container/i, direction: "원통 몸체, 상하 림, 탭 또는 뚜껑 구조를 보존한다", evidence: "탭·이음선·고형량 표시는 실제 면을 확대한다", forbidden: "날카로운 열린 뚜껑이나 보이지 않는 내용물을 만들지 않는다" },
  { id: "lidded-cup", label: "뚜껑형 컵", axis: "package", pattern: /컵라면|컵누들|컵용기|요거트컵|lidded cup|cup noodle/i, direction: "컵의 테이퍼, 림, 뚜껑 개봉선과 바닥 접지를 보존한다", evidence: "밀봉·부분 개봉·완전 개봉 상태를 원본 또는 허용된 조리 계약과 맞춘다", forbidden: "밀봉 뚜껑에서 김이 나거나 다른 그릇으로 바꾸지 않는다" },
  { id: "tray-film", label: "트레이·필름", axis: "package", pattern: /트레이포장|필름포장|용기필름|tray pack|film seal/i, direction: "트레이 깊이, 투명 필름의 실링 가장자리와 실제 내용물 배열을 보존한다", evidence: "필름 상태·칸 구획·중량은 원본 사진으로 확인한다", forbidden: "필름을 임의로 벗기거나 내용물 배열을 바꾸지 않는다" },
  { id: "aerosol-spray", label: "스프레이·에어로졸", axis: "package", pattern: /스프레이|분무기|에어로졸|spray bottle|aerosol/i, direction: "노즐 방향, 캡, 트리거 또는 밸브의 실제 구조를 보존한다", evidence: "분사구와 잠금 구조를 마른 상태의 근접컷으로 확인한다", forbidden: "분사 안개·흡입·인체 적용을 창작하지 않는다" },
  { id: "refill-cartridge", label: "리필·카트리지", axis: "package", pattern: /리필|카트리지|교체용|refill|cartridge/i, direction: "본품과 혼동되지 않도록 리필 외형과 결합 방향을 명확히 보여준다", evidence: "호환 모델·결합부·용량은 읽힌 표기만 사용한다", forbidden: "미확인 본체를 추가하거나 장착 완료를 창작하지 않는다" },

  // Geometry can refine long-tail goods even when no fixed category profile matches.
  { id: "tall-slender", label: "세로로 긴 형태", axis: "geometry", pattern: /슬림|세로형|롱보틀|막대형|tall|slender|wand/i, direction: "세로 비율과 무게중심을 보존하고 상하단이 잘리지 않게 배치한다", evidence: "전체 길이와 상·하단 구조를 서로 다른 컷에서 확인한다", forbidden: "가로로 눕혀 형태를 오해시키거나 길이를 축약하지 않는다" },
  { id: "flat-sheet", label: "평면·시트형", axis: "geometry", pattern: /시트형|필름형|패드형|매트형|flat sheet|film type|pad|mat/i, direction: "두께보다 윤곽·모서리·앞뒤 면이 읽히는 평면 구도를 우선한다", evidence: "적층 수, 절취선, 표면 무늬와 실제 두께는 측면 원본으로 확인한다", forbidden: "과장된 두께·쿠션감·층 수를 만들지 않는다" },
  { id: "foldable", label: "접이식", axis: "geometry", pattern: /접이식|폴딩|접이 구조|foldable|folding|collapsible/i, direction: "접힘 전후는 각각 확인된 상태로 분리하고 힌지 축을 보존한다", evidence: "잠금부·힌지·접힘 순서는 제공된 구조 사진을 사용한다", forbidden: "미확인 중간 단계나 완전 전개 크기를 창작하지 않는다" },
  { id: "stackable-nesting", label: "적층·중첩형", axis: "geometry", pattern: /적층|중첩|포개|스태커블|stackable|nesting/i, direction: "단품 외형과 실제 수량의 적층 관계를 별도 컷으로 보여준다", evidence: "바닥·림·맞물림 구조와 실제 구성 수를 확인한다", forbidden: "수량을 복제하거나 수납 효율을 수치화하지 않는다" },
  { id: "paired-set", label: "좌우·한 쌍", axis: "geometry", pattern: /한쌍|한 켤레|좌우세트|pair|paired|set of two/i, direction: "좌우 방향과 실제 한 쌍 구성을 동시에 식별 가능하게 둔다", evidence: "좌우 차이, 연결부, 사이즈와 구성 수를 확인한다", forbidden: "단품을 복제해 쌍으로 만들거나 좌우를 뒤바꾸지 않는다" },
  { id: "multi-piece-set", label: "다구성 세트", axis: "geometry", pattern: /세트구성|구성품|부속품|다구성|kit|multi piece|accessories included/i, direction: "대표 본체와 제공된 구성품을 중요도·실제 수량대로 분리 배치한다", evidence: "각 구성품은 제공된 전체 구성 사진과 판매자 확정값을 교차 확인한다", forbidden: "배경 소품을 구성품으로 보이게 하거나 부속을 추가·복제하지 않는다" },
  { id: "long-flexible", label: "길고 유연한 형태", axis: "geometry", pattern: /케이블|호스|로프|끈형|cord|cable|hose|rope/i, direction: "전체 길이는 자연스러운 큰 곡선으로, 양 끝 커넥터는 별도 근접컷으로 보여준다", evidence: "끝단·피복·연결부·길이 표기를 우선 확인한다", forbidden: "엉킴으로 끝단을 숨기거나 길이와 커넥터를 바꾸지 않는다" },
  { id: "wheeled-telescopic", label: "바퀴·신축 손잡이", axis: "geometry", pattern: /바퀴|캐스터|신축손잡이|텔레스코픽|wheels?|casters?|telescopic handle/i, direction: "바닥 접지, 휠 수와 신축 축을 전체 형태 안에서 보존한다", evidence: "휠·락·핸들 단계는 해당 원본 면에서만 확인한다", forbidden: "굴러가는 장면·하중 시험·미확인 전개 높이를 만들지 않는다" },
  { id: "soft-textile-form", label: "유연한 섬유 형태", axis: "geometry", pattern: /패브릭|원단|직물|의류|침구|수건|textile|fabric|garment|bedding/i, direction: "실제 실루엣·드레이프·봉제를 유지하며 제품이 납작해지거나 부풀지 않게 지지한다", evidence: "전체 형태, 봉제, 조직, 라벨을 각각 분리해 보여준다", forbidden: "주름을 모두 지우거나 충전감·핏·두께를 보정하지 않는다" },
  { id: "rigid-body", label: "단단한 본체", axis: "geometry", pattern: /본체|하우징|프레임|기기|가전|장비|rigid body|housing|device|appliance/i, direction: "모서리, 받침, 포트와 패널의 직선·곡면 비율을 보존한다", evidence: "정면 조작부와 측후면 연결부를 원본별로 분리한다", forbidden: "버튼·화면·포트·상태등을 새로 만들지 않는다" },

  // Materials drive light, reflections and macro choices.
  { id: "clear-glass", label: "투명 유리", axis: "material", pattern: /유리|글라스|glass/i, direction: "이중 하이라이트와 굴절을 억제해 윤곽·두께·투명도를 사실적으로 보여준다", evidence: "림·바닥·접합부와 실제 내용물 경계를 근접 확인한다", forbidden: "깨짐·수정 같은 과도한 광택·임의 액체를 만들지 않는다" },
  { id: "stainless-metal", label: "스테인리스·금속", axis: "material", pattern: /스테인리스|스텐|알루미늄|금속|메탈|stainless|aluminum|metal/i, direction: "긴 소프트박스 반사로 표면 결, 모서리와 이음부가 사라지지 않게 한다", evidence: "헤어라인·용접·리벳·코팅 경계를 실제 근접 사진으로 확인한다", forbidden: "거울처럼 과장하거나 스크래치·재질 등급을 창작하지 않는다" },
  { id: "wood-bamboo", label: "나무·대나무", axis: "material", pattern: /원목|목재|나무|대나무|우드|wood|bamboo/i, direction: "실제 결 방향과 조각 연결부가 읽히는 부드러운 측광을 사용한다", evidence: "결·모서리·접착·도장 표면을 원본 범위에서 확대한다", forbidden: "수종·천연 여부·항균 성능과 결 무늬를 창작하지 않는다" },
  { id: "ceramic-stoneware", label: "도자기·세라믹", axis: "material", pattern: /도자기|세라믹|석기|포슬린|ceramic|porcelain|stoneware/i, direction: "유약 반사, 림, 굽과 곡률을 중립 조명에서 보존한다", evidence: "입구·바닥·유약 마감과 실제 수량을 확인한다", forbidden: "균열·수공예 흔적·내열 성능을 창작하지 않는다" },
  { id: "silicone-rubber", label: "실리콘·고무", axis: "material", pattern: /실리콘|고무|러버|silicone|rubber/i, direction: "무광 탄성 표면과 가장자리 두께를 과장 없이 보여준다", evidence: "패킹·미끄럼면·접합부·경도 표기는 실제 근거를 쓴다", forbidden: "늘이기·비틀기·미끄럼 방지 성능을 창작하지 않는다" },
  { id: "leather", label: "가죽", axis: "material", pattern: /가죽|레더|leather/i, direction: "결·엣지 코팅·봉제가 구분되는 낮은 대비의 측광을 사용한다", evidence: "표면 결, 모서리, 봉제와 소재 라벨을 분리한다", forbidden: "천연·등급·동물종·에이징 효과를 추측하지 않는다" },
  { id: "woven-knit", label: "직조·니트", axis: "material", pattern: /니트|편직|직조|메시|knit|woven|mesh/i, direction: "조직 스케일과 봉제선이 모아레 없이 보이는 근접 구도를 사용한다", evidence: "짜임·시보리·메시·혼용률 라벨을 연결한다", forbidden: "조직·신축성·통기 성능을 바꾸거나 과장하지 않는다" },
  { id: "paper-cardboard", label: "종이·판지", axis: "material", pattern: /종이|판지|페이퍼|paper|cardboard/i, direction: "접힘선·코팅·인쇄면과 모서리 두께를 보존한다", evidence: "플랩·접착·인쇄·매수 표기는 제공 사진을 우선한다", forbidden: "금박·엠보싱·친환경 인증을 새로 만들지 않는다" },
  { id: "clear-plastic", label: "투명 플라스틱", axis: "material", pattern: /투명(?:한)?\s*(?:플라스틱|PET|아크릴)|clear plastic|transparent acrylic/i, direction: "투명 경계와 겹침을 배경에서 분리하고 실제 벽 두께를 보존한다", evidence: "패킹·사출선·스크래치·재질 표기를 실제 원본에서 확인한다", forbidden: "유리처럼 보이게 하거나 내용물을 추가하지 않는다" },
  { id: "matte-plastic", label: "불투명 플라스틱", axis: "material", pattern: /플라스틱|폴리프로필렌|폴리에틸렌|ABS|plastic|polypropylene|polyethylene/i, direction: "사출 모서리와 무광·유광 차이가 읽히도록 반사를 제어한다", evidence: "결합부·두께·재질 표기와 실제 색상을 확인한다", forbidden: "금속·유리 재질로 바꾸거나 강도·무독성을 암시하지 않는다" },
  { id: "liquid-gel", label: "액상·젤 제형", axis: "material", pattern: /액상|리퀴드|오일|젤형|세럼|에센스|liquid|oil|gel|serum|essence/i, direction: "제형은 실제 개봉·내용물 원본이 있을 때만 점도와 투명도를 표현한다", evidence: "용기 안 수위 또는 제공된 제형 사진을 정면 라벨과 분리한다", forbidden: "방울·스와치·흐름·색·거품을 추측하지 않는다" },
  { id: "powder-granule", label: "분말·과립", axis: "material", pattern: /분말|가루|파우더|과립|powder|granule/i, direction: "분말은 제공된 개봉 사진이 있을 때만 작은 범위의 입자 크기를 보여준다", evidence: "낱개 포·스쿱·중량과 실제 입자 원본을 연결한다", forbidden: "가루 날림·쏟기·임의 스쿱과 색상을 만들지 않는다" },
  { id: "foam-sponge", label: "폼·스펀지", axis: "material", pattern: /폼재질|스펀지|쿠션폼|foam material|sponge/i, direction: "기공과 가장자리 두께를 누르지 않은 상태에서 보여준다", evidence: "단면·밀도·복원력은 실제 원본과 표기 범위에서만 다룬다", forbidden: "압축 전후·탄성·복원 성능을 창작하지 않는다" },
  { id: "coated-surface", label: "코팅 표면", axis: "material", pattern: /코팅|논스틱|도금|coated|nonstick|plated/i, direction: "표면과 모서리의 코팅 경계를 균일한 반사로 보여준다", evidence: "코팅 종류·적용면·관리 표기는 확인된 자료만 쓴다", forbidden: "긁힘 시험·발수·내구 성능을 시각화하지 않는다" },

  // Mechanisms decide which action or construction detail deserves a slot.
  { id: "hinge-lid", label: "힌지·뚜껑", axis: "mechanism", pattern: /힌지|경첩|뚜껑|리드|hinge|lid/i, direction: "닫힘 외관과 실제 제공된 열림 각도를 서로 다른 컷으로 분리한다", evidence: "축·스토퍼·패킹·잠금부를 근접 확인한다", forbidden: "열림 각도·탈착·내부 구조를 창작하지 않는다" },
  { id: "zipper-closure", label: "지퍼", axis: "mechanism", pattern: /지퍼|풀집|풀 집|zipper|zip closure|full[- ]?zip/i, direction: "지퍼 경로, 슬라이더와 끝단이 전체 형태 안에서 보이게 한다", evidence: "열린 내부는 제공 사진이 있을 때만 사용한다", forbidden: "수납물·내부 포켓·완전 개방 상태를 만들지 않는다" },
  { id: "buckle-snap-lock", label: "버클·스냅·락", axis: "mechanism", pattern: /버클|스냅|잠금장치|락버튼|클립잠금|buckle|snap|latch|lock/i, direction: "체결 방향과 맞물리는 양쪽 부품을 근접컷으로 보여준다", evidence: "잠김·해제 상태는 실제 사진 또는 설명 범위에서만 구분한다", forbidden: "도난 방지·하중·내구 성능을 암시하지 않는다" },
  { id: "threaded-cap", label: "나사식 마개", axis: "mechanism", pattern: /나사식|스크류캡|돌려서|threaded cap|screw cap/i, direction: "나사산 축과 캡 결합 높이를 보존하고 마개를 안전하게 둔다", evidence: "나사산·씰·패킹은 열린 원본이 있을 때만 보여준다", forbidden: "액체를 붓거나 미확인 밀봉 구조를 만들지 않는다" },
  { id: "nozzle-spout", label: "노즐·주둥이", axis: "mechanism", pattern: /노즐|주둥이|토출구|spout|nozzle/i, direction: "토출 방향, 개구부와 몸통의 연결을 측면 근접컷으로 보여준다", evidence: "마개·밸브·절취부와 사용 방향 표기를 확인한다", forbidden: "액체·분말·분사 결과를 생성하지 않는다" },
  { id: "valve-straw", label: "밸브·빨대", axis: "mechanism", pattern: /밸브|빨대|스트로|valve|straw/i, direction: "밸브와 빨대의 실제 결합 경로를 단면 창작 없이 외관으로 보여준다", evidence: "마우스피스·패킹·세척 분리 상태는 제공 사진만 사용한다", forbidden: "입 사용·누수 방지·내부 유로를 추측하지 않는다" },
  { id: "handle-grip", label: "손잡이·그립", axis: "mechanism", pattern: /손잡이|핸들|그립|handle|grip/i, direction: "손 없이도 잡는 방향, 여유 공간과 본체 결합부가 읽히게 한다", evidence: "리벳·나사·접힘·재질과 실제 길이를 확인한다", forbidden: "손 사용·하중·미끄럼 방지 성능을 창작하지 않는다" },
  { id: "blade-edge", label: "날·절삭부", axis: "mechanism", pattern: /칼날|블레이드|절삭|가위날|blade|cutting edge/i, direction: "날을 안전하게 눕혀 팁·날선·보호부와 손잡이 축을 보여준다", evidence: "날 재질·커버·결합부·길이를 확인한다", forbidden: "손·절단·상처·불꽃·절삭 결과를 만들지 않는다" },
  { id: "magnetic-attachment", label: "자석 결합", axis: "mechanism", pattern: /자석|마그네틱|magnet|magnetic/i, direction: "자석 위치와 맞닿는 면을 실제 외관 기준으로 분리해 보여준다", evidence: "결합 방향·호환 표기·부착면은 원본과 설명을 교차 확인한다", forbidden: "부착력·하중 시험·미확인 기기 장착을 창작하지 않는다" },
  { id: "adhesive-mount", label: "접착·부착형", axis: "mechanism", pattern: /접착식|부착형|양면테이프|흡착판|adhesive|suction mount/i, direction: "부착 전 뒷면과 실제 설치 방향을 상품 중심으로 보여준다", evidence: "접착면·보호필름·호환 표면 안내를 확인한다", forbidden: "벽면 장착 결과·접착 강도·재사용 성능을 만들지 않는다" },
  { id: "connector-port", label: "커넥터·포트", axis: "mechanism", pattern: /커넥터|포트|단자|USB|HDMI|C타입|connector|port|type c/i, direction: "양 끝 또는 측후면 포트를 정면으로 읽히는 근접컷에 배치한다", evidence: "단자 형태·수·방향·호환 모델 표기를 확인한다", forbidden: "연결 기기·충전 상태·화면·LED를 창작하지 않는다" },
  { id: "button-dial-control", label: "버튼·다이얼", axis: "mechanism", pattern: /버튼|다이얼|스위치|조작부|button|dial|switch|control panel/i, direction: "전원이 꺼진 상태에서 조작부 배치와 인쇄를 원본대로 보여준다", evidence: "버튼 수·아이콘·단계·정격 라벨을 실제 면에서 확인한다", forbidden: "가짜 UI·상태등·작동 결과를 만들지 않는다" },
  { id: "filter-mesh", label: "필터·망", axis: "mechanism", pattern: /필터|거름망|메쉬망|filter|strainer|mesh basket/i, direction: "필터의 전체 위치와 망 조직을 서로 다른 배율로 보여준다", evidence: "탈착·규격·재질·세척 표기는 확인된 자료만 사용한다", forbidden: "오염 전후·여과 성능·미확인 탈착 상태를 만들지 않는다" },
  { id: "divider-compartment", label: "칸막이·구획", axis: "mechanism", pattern: /칸막이|구획|수납칸|포켓|divider|compartment/i, direction: "빈 상태의 실제 칸 수와 경계를 위·사선 구도로 보여준다", evidence: "탈착 여부·깊이·내부 치수는 실제 내부 사진을 사용한다", forbidden: "내용물·수납량·추가 칸을 창작하지 않는다" },
  { id: "assembly-fastener", label: "조립·체결부", axis: "mechanism", pattern: /조립식|나사결합|체결부|볼트|클램프|assembly|fastener|bolt|clamp/i, direction: "완성 외관과 체결부의 위치 관계를 부품 추가 없이 보여준다", evidence: "나사·볼트·클램프·설명서 구성은 제공 사진으로 확인한다", forbidden: "조립 단계·공구·누락 부품을 임의로 만들지 않는다" },

  // State signals prevent implausible use scenes.
  { id: "sealed-state", label: "밀봉 상태", axis: "state", pattern: /밀봉|미개봉|실링|봉인|sealed|unopened/i, direction: "대표컷은 손상 없는 밀봉 상태를 우선하고 개봉 연출과 명확히 분리한다", evidence: "씰·필름·탬퍼 밴드의 실제 형태를 확인한다", forbidden: "찢김·누수·내용물·개봉 흔적을 추가하지 않는다" },
  { id: "open-close-state", label: "개폐 상태", axis: "state", pattern: /개폐|열고 닫|오픈형|open close|opening/i, direction: "닫힘 전체컷과 제공된 열림 상태를 다른 역할로 분리한다", evidence: "내부·뚜껑·잠금 구조는 해당 상태의 원본을 사용한다", forbidden: "한 이미지에 불가능한 중간 상태를 섞지 않는다" },
  { id: "pour-dispense-state", label: "따르기·토출", axis: "state", pattern: /따르기|토출|디스펜싱|pour|dispense/i, direction: "사용 동작보다 용기와 토출구가 화면 중심에 남도록 구성한다", evidence: "실제 내용물 사진과 사용법이 모두 있을 때만 흐름을 표현한다", forbidden: "액체 색·점도·양·손을 근거 없이 만들지 않는다" },
  { id: "heated-cooked-state", label: "가열·조리 상태", axis: "state", pattern: /가열|조리|끓는 물|전자레인지|cook|heat|microwave/i, direction: "밀봉 제품, 준비 단계, 확인된 완성 상태를 시간 순서로 분리한다", evidence: "조리법·시간·용기와 실제 완성 음식 사진을 연결한다", forbidden: "제품 없는 음식·임의 토핑·밀봉 포장의 김을 만들지 않는다" },
  { id: "wear-fit-state", label: "착용·핏", axis: "state", pattern: /착용|핏감|코디|wear|fit|worn/i, direction: "제공된 착용 원본이 없으면 평면·행거·형태 지지 방식으로 구조를 설명한다", evidence: "사이즈·실측·봉제·착용 원본을 서로 구분한다", forbidden: "사람·체형·핏·기장·피부를 합성하거나 보정하지 않는다" },
  { id: "install-mount-state", label: "설치·장착", axis: "state", pattern: /설치|장착|거치|마운트|install|mount|attach/i, direction: "상품 자체와 설치 접점이 먼저 보이며 환경은 방향 설명에 필요한 만큼만 사용한다", evidence: "부착면·호환 대상·설치 부품과 설명서를 확인한다", forbidden: "미확인 차종·기기·벽에 장착 완료된 결과를 만들지 않는다" },
  { id: "wash-care-state", label: "세척·관리", axis: "state", pattern: /세척|세탁|관리법|wash|clean|care/i, direction: "젖은 사용 장면 대신 관리가 필요한 부위와 분리 구조를 마른 상태로 보여준다", evidence: "세척·세탁·건조·금지 표기는 라벨 또는 설명서 원문을 사용한다", forbidden: "물줄기·세척 전후·살균·오염 제거 결과를 창작하지 않는다" },
  { id: "storage-portable-state", label: "보관·휴대", axis: "state", pattern: /보관|휴대|수납|파우치포함|storage|portable|carry/i, direction: "사용 상태와 구분해 닫힘·접힘·정리된 실제 부피를 보여준다", evidence: "보관 케이스·손잡이·접힘·실제 구성은 제공 사진을 확인한다", forbidden: "가방 속 내용물·수납량·여행 장면을 만들지 않는다" },
  { id: "refill-replace-state", label: "교체·리필", axis: "state", pattern: /교체|리필|갈아끼|replace|replacement|refill/i, direction: "본품·교체품·결합부를 혼동하지 않도록 각각 한 번씩 식별한다", evidence: "호환 모델, 교체 방향과 구성 수량을 확인한다", forbidden: "미확인 본체·소모품·교체 완료 상태를 추가하지 않는다" },
  { id: "assemble-configure-state", label: "조립·구성", axis: "state", pattern: /조립|구성 변경|모듈|assemble|configure|modular/i, direction: "실제 제공된 완성 형태와 구성품 확인을 우선하고 단계는 근거가 있을 때만 만든다", evidence: "부품 수·결합부·설명서·완성 원본을 교차 확인한다", forbidden: "중간 단계·완성 모델·공구·부품을 창작하지 않는다" },
];

export const PRODUCT_PRODUCTION_MODIFIER_SIGNAL_COUNT = modifierDefinitions.length;

const axisLimits: Readonly<Record<ProductProductionModifier["axis"], number>> = {
  package: 2,
  geometry: 2,
  material: 2,
  mechanism: 3,
  state: 2,
};

function normalizedText(input: ProductProductionModifierInput) {
  return [
    input.name,
    input.category,
    ...(input.features ?? []),
    ...(input.cautions ?? []),
    input.material,
    input.packageContents,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" · ")
    .normalize("NFKC");
}

function normalizedRoles(sourceRoles: readonly string[]) {
  return [...new Set(sourceRoles.map((role) => role.trim().toLocaleLowerCase().replace(/^extra-\d+$/u, "extra"))
    .filter(Boolean))];
}

function sourceEvidenceDirective(sourceRoles: readonly string[]) {
  const roles = normalizedRoles(sourceRoles);
  const has = (...candidates: string[]) => candidates.some((candidate) => roles.includes(candidate));
  const directions = [
    "첫 번째 main/front 원본은 대표 외관과 정확한 상품 정체성에만 사용한다",
  ];
  if (has("left", "right", "side")) directions.push("측면 원본은 두께·깊이·마개·결합 구조의 상세 슬롯에 배치한다");
  if (has("back", "label")) directions.push("후면·라벨 원본은 원재료·성분·사용법·주의·제조정보를 읽는 증거 슬롯에 원본 픽셀로 배치한다");
  if (has("top", "bottom")) directions.push("상·하면 원본은 개폐·바닥 접지·인증 표기의 구조 확인에만 사용한다");
  if (has("barcode")) directions.push("바코드 원본은 구매 식별 보조 증거로만 사용하고 대표 연출 배경으로 쓰지 않는다");
  if (has("contents", "open", "inside")) directions.push("실제 내용물·개봉 원본은 사용 상태와 구성 확인에만 사용하며 수량과 형태를 바꾸지 않는다");
  if (directions.length === 1) directions.push("측후면·내부·내용물·착용·설치 상태는 별도 원본이 없으므로 생성 근거로 간주하지 않는다");
  return directions.join("; ");
}

function slotDirective(modifiers: readonly ProductProductionModifier[], assetId: string) {
  const axes: readonly ProductProductionModifier["axis"][] = assetId === "detail-use" || assetId === "detail-routine" || assetId === "detail-context"
    ? ["state", "mechanism", "package"]
    : assetId === "detail-feature" || assetId === "detail-material" || assetId === "detail-care"
      ? ["material", "mechanism", "geometry"]
      : assetId === "detail-package" || assetId === "detail-contents"
        ? ["package", "geometry", "mechanism"]
        : assetId === "detail-dimensions" || assetId === "detail-scale"
          ? ["geometry", "package", "mechanism"]
          : ["package", "geometry", "material"];
  const selected = axes.flatMap((axis) => modifiers.filter((modifier) => modifier.axis === axis)).slice(0, 3);
  if (!selected.length) return "형태 단서가 부족하므로 정면 원본의 실제 외곽·비율·접지와 확인된 기능부만 보존한다";
  return selected.map((modifier) => `${modifier.label}: ${modifier.direction}`).join(" / ");
}

export function resolveProductProductionModifiers(
  input: ProductProductionModifierInput,
  sourceRoles: readonly string[] = [],
  assetId = "hero",
): ProductProductionModifierResolution {
  const text = normalizedText(input);
  const axisCounts = new Map<ProductProductionModifier["axis"], number>();
  const modifiers = modifierDefinitions.filter((definition) => {
    if (!definition.pattern.test(text)) return false;
    const count = axisCounts.get(definition.axis) ?? 0;
    if (count >= axisLimits[definition.axis]) return false;
    axisCounts.set(definition.axis, count + 1);
    return true;
  }).map(({ id, label, axis, direction, evidence, forbidden }) => ({
    id,
    label,
    axis,
    direction,
    evidence,
    forbidden,
  }));
  return {
    version: PRODUCT_PRODUCTION_MODIFIER_VERSION,
    modifiers,
    sourceEvidence: sourceEvidenceDirective(sourceRoles),
    slotDirective: slotDirective(modifiers, assetId),
  };
}

export function formatProductProductionModifiers(
  input: ProductProductionModifierInput,
  sourceRoles: readonly string[] = [],
  assetId = "hero",
) {
  const resolution = resolveProductProductionModifiers(input, sourceRoles, assetId);
  const modifierBrief = resolution.modifiers.length
    ? resolution.modifiers.map((modifier) => (
      `${modifier.axis}/${modifier.id}(${modifier.label}): 촬영=${modifier.direction}; 근거=${modifier.evidence}; 금지=${modifier.forbidden}`
    )).join(" || ")
    : "명시적으로 확인된 포장·재질·작동 신호 없음: 대표 원본의 형태와 비율 외에는 추측하지 않는다";
  return [
    `상품 물리 제작 지침 ${resolution.version}.`,
    `조합 신호: ${modifierBrief}.`,
    `현재 슬롯 지시: ${resolution.slotDirective}.`,
    `다중 원본 배치: ${resolution.sourceEvidence}.`,
  ].join(" ");
}
