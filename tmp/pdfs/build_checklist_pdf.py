from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    LongTable,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path("/Users/kimchangheemac/Documents/ChatGPT/ai 쇼핑 채널 등록 자동화")
TMP = ROOT / "tmp/pdfs"
OUTPUT = ROOT / "output/pdf/글로벌_이커머스_자동화_개발_체크리스트.pdf"
FONT_REGULAR = TMP / "fonts/NanumGothic-Regular.ttf"
FONT_BOLD = TMP / "fonts/NanumGothic-Bold.ttf"

pdfmetrics.registerFont(TTFont("Nanum", str(FONT_REGULAR)))
pdfmetrics.registerFont(TTFont("Nanum-Bold", str(FONT_BOLD)))
pdfmetrics.registerFontFamily("Nanum", normal="Nanum", bold="Nanum-Bold")

NAVY = colors.HexColor("#0B1220")
INDIGO = colors.HexColor("#465FFF")
INDIGO_SOFT = colors.HexColor("#EEF1FF")
CORAL = colors.HexColor("#F56F61")
MINT = colors.HexColor("#168C65")
AMBER = colors.HexColor("#D97706")
INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#68758A")
LINE = colors.HexColor("#DDE3EE")
SOFT = colors.HexColor("#F6F8FC")
SOFT_ALT = colors.HexColor("#FBFCFE")
WHITE = colors.white

PAGE_W, PAGE_H = A4
LEFT = 14 * mm
RIGHT = 14 * mm
TOP = 20 * mm
BOTTOM = 15 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


styles = getSampleStyleSheet()
cover_kicker = ParagraphStyle(
    "CoverKicker",
    fontName="Nanum-Bold",
    fontSize=10,
    leading=14,
    textColor=colors.HexColor("#93A0FF"),
    spaceAfter=10,
)
cover_title = ParagraphStyle(
    "CoverTitle",
    fontName="Nanum-Bold",
    fontSize=28,
    leading=39,
    textColor=WHITE,
    wordWrap="CJK",
    spaceAfter=16,
)
cover_sub = ParagraphStyle(
    "CoverSub",
    fontName="Nanum",
    fontSize=12,
    leading=20,
    textColor=colors.HexColor("#C5CDDA"),
    wordWrap="CJK",
)
page_title = ParagraphStyle(
    "PageTitle",
    fontName="Nanum-Bold",
    fontSize=20,
    leading=28,
    textColor=INK,
    wordWrap="CJK",
    spaceAfter=6,
)
section_meta = ParagraphStyle(
    "SectionMeta",
    fontName="Nanum",
    fontSize=8.5,
    leading=13,
    textColor=MUTED,
    wordWrap="CJK",
    spaceAfter=10,
)
body = ParagraphStyle(
    "Body",
    fontName="Nanum",
    fontSize=9.5,
    leading=16,
    textColor=INK,
    wordWrap="CJK",
)
body_small = ParagraphStyle(
    "BodySmall",
    fontName="Nanum",
    fontSize=8.2,
    leading=13,
    textColor=MUTED,
    wordWrap="CJK",
)
callout = ParagraphStyle(
    "Callout",
    fontName="Nanum-Bold",
    fontSize=10,
    leading=16,
    textColor=INK,
    wordWrap="CJK",
)
table_head = ParagraphStyle(
    "TableHead",
    fontName="Nanum-Bold",
    fontSize=8,
    leading=10,
    textColor=WHITE,
    alignment=TA_CENTER,
)
row_id = ParagraphStyle(
    "RowId",
    fontName="Nanum-Bold",
    fontSize=7.8,
    leading=10,
    textColor=INDIGO,
    alignment=TA_CENTER,
)
row_text = ParagraphStyle(
    "RowText",
    fontName="Nanum",
    fontSize=7.7,
    leading=11.2,
    textColor=INK,
    wordWrap="CJK",
)
check_style = ParagraphStyle(
    "Check",
    fontName="Nanum",
    fontSize=16,
    leading=18,
    textColor=colors.HexColor("#6E7A91"),
    alignment=TA_CENTER,
)
mini_title = ParagraphStyle(
    "MiniTitle",
    fontName="Nanum-Bold",
    fontSize=10,
    leading=15,
    textColor=INK,
    wordWrap="CJK",
)
mini_text = ParagraphStyle(
    "MiniText",
    fontName="Nanum",
    fontSize=8.3,
    leading=13,
    textColor=MUTED,
    wordWrap="CJK",
)


LEVEL_COLORS = {
    "필수": "#465FFF",
    "조건": "#D97706",
    "결정": "#F56F61",
    "후속": "#667085",
}


def item(title: str, desc: str, level: str = "필수") -> tuple[str, str, str]:
    return level, title, desc


sections = [
    {
        "code": "A",
        "title": "착수 전 범위와 준비",
        "slides": "PPT 1, 2, 5, 29, 31",
        "intro": "무엇을 먼저 만들고 무엇을 나중에 만들지, 계정·데이터·계약 조건을 개발 전에 확정합니다.",
        "items": [
            item("1차 판매채널을 3개로 고정", "Qoo10 Japan, Shopee, Lazada를 1차 필수 범위로 계약서에 적습니다.", "결정"),
            item("1차 판매국가를 확정", "Shopee와 Lazada에서 먼저 운영할 국가를 각각 정하고 국가 추가는 별도 범위로 둡니다.", "결정"),
            item("무인 운영의 뜻을 확정", "자동 등록뿐 아니라 자동 제외와 자동 재촬영 요청도 정상 완료로 인정합니다.", "결정"),
            item("자동 등록 허용 카테고리 확정", "초기에 자동으로 판매할 저위험 카테고리 목록을 만듭니다.", "결정"),
            item("규제상품 자동 제외 범위 확정", "인증·성분·허가 자료가 없는 상품은 게시하지 않도록 목록을 만듭니다.", "결정"),
            item("실계정과 테스트상품 준비", "채널별 판매자 계정과 실제 검수용 상품·이미지를 제공합니다.", "필수"),
            item("개발자 앱 권한 확보", "각 채널의 상품·주문·재고·배송 API 권한과 인증정보를 준비합니다.", "필수"),
            item("카카오 알림톡 준비", "사업자, 비즈니스 채널, 발신프로필과 템플릿 심사를 미리 신청합니다.", "조건"),
            item("공급사 상품자료 준비", "원가, 바코드, 모델번호, 제조사, 원산지, 성분·인증 자료를 받을 방법을 정합니다.", "필수"),
            item("소유권과 유지보수 범위 확정", "소스코드 귀속, API 변경 대응, 하자보수, 운영비 부담 주체를 계약서에 적습니다.", "결정"),
        ],
    },
    {
        "code": "B",
        "title": "공통 데이터와 시스템 기반",
        "slides": "PPT 6, 14, 18, 25",
        "intro": "채널이 달라도 하나의 상품·재고·주문으로 관리되도록 공통 기준을 만듭니다.",
        "items": [
            item("통합 SKU 만들기", "실물 상품 하나마다 내부 상품번호를 만들고 모든 채널이 이를 기준으로 사용합니다."),
            item("상품 사실정보 한곳에 저장", "브랜드, 모델, 용량, 원산지, 성분 등 변하면 안 되는 정보를 기준 데이터로 저장합니다."),
            item("옵션과 세트상품 구조 만들기", "색상·용량·사이즈와 1+1·2입 세트를 내부 상품과 연결합니다."),
            item("채널 상품번호 연결", "내부 SKU와 Qoo10·Shopee·Lazada 상품번호를 서로 매핑합니다."),
            item("판매계정 설정화면 만들기", "국가, 배송, 통화, 수수료, 안전재고와 연결상태를 한곳에서 설정합니다."),
            item("사용자 권한 나누기", "관리자, 운영자, 조회자 등 역할별로 볼 수 있는 정보와 실행 권한을 구분합니다."),
            item("모든 변경이력 저장", "누가 또는 어떤 자동작업이 상품·가격·재고를 바꿨는지 시간과 이유를 남깁니다."),
            item("원본과 결과 이미지 분리 보관", "촬영 원본, 썸네일, 상세페이지, 채널 업로드본을 버전별로 저장합니다."),
            item("채널 추가용 공통 연결규격 만들기", "추후 네이버·쿠팡·11번가를 붙일 때 전체 시스템을 다시 만들지 않게 합니다."),
        ],
    },
    {
        "code": "C",
        "title": "촬영과 이미지 업로드",
        "slides": "PPT 3, 4, 7, 15",
        "intro": "사용자는 현장에서 사진을 찍는 것만으로 상품 등록을 시작할 수 있어야 합니다.",
        "items": [
            item("휴대폰 촬영·앨범 업로드", "모바일 웹 또는 앱에서 카메라로 찍거나 기존 사진을 선택할 수 있어야 합니다."),
            item("정면사진 촬영 안내", "상품이 잘리지 않고 정면에 오도록 화면 가이드를 보여줍니다."),
            item("라벨사진 촬영 안내", "성분, 제조사, 원산지, 모델과 용량이 보이는 뒷면 사진을 안내합니다."),
            item("바코드 확대촬영 안내", "EAN·UPC·QR·모델번호가 선명하게 보이도록 별도 촬영을 안내합니다."),
            item("여러 장 업로드와 순서변경", "정면·뒷면·바코드 사진을 추가·삭제·재정렬할 수 있어야 합니다."),
            item("흐림 자동 감지", "글자와 바코드를 읽기 어려운 사진은 업로드 전에 재촬영을 요청합니다."),
            item("반사·노출·잘림 감지", "빛 반사, 너무 어둡거나 밝음, 제품 잘림을 검사합니다."),
            item("중복사진 감지", "같은 사진을 여러 번 올렸으면 알려주고 중복 처리를 막습니다."),
            item("오프라인 촬영대기열", "인터넷이 약한 현장에서도 촬영 후 연결되면 자동 업로드되게 합니다."),
            item("처리상태와 재시도 표시", "업로드·분석·등록 중 어디까지 진행됐는지와 실패 재시도를 보여줍니다."),
        ],
    },
    {
        "code": "D",
        "title": "상품 찾기와 시장정보",
        "slides": "PPT 11, 15",
        "intro": "사진 한 장의 추측에 의존하지 않고 바코드·글자·공급사 자료·이미지를 함께 비교합니다.",
        "items": [
            item("바코드 우선 검색", "바코드가 읽히면 내부·공급사·허용된 외부 상품자료에서 같은 번호를 먼저 찾습니다."),
            item("라벨 글자 자동 추출", "브랜드, 제품명, 모델, 용량, 색상과 성분을 OCR로 읽습니다."),
            item("공급사·기존상품 우선 검색", "가장 신뢰할 수 있는 공급사 자료와 이미 판매한 상품부터 비교합니다."),
            item("공식·허용 상품자료 연결", "GS1, Icecat 등 사용 가능한 데이터로 상품 신원을 보강합니다.", "조건"),
            item("이미지 유사검색", "촬영사진을 내부 상품 이미지와 비교해 비슷한 후보를 찾습니다."),
            item("키워드 보조검색", "OCR로 읽은 브랜드·모델·용량을 이용해 이미지 검색 결과를 보완합니다."),
            item("후보 순위 만들기", "같을 가능성이 높은 상품을 1위부터 순서대로 정리합니다."),
            item("판단 근거 저장", "바코드 일치, 글자 일치, 이미지 유사도 등 선택 근거를 함께 저장합니다."),
            item("신뢰도 기준 적용", "정답 데이터로 검증한 기준 이상일 때만 자동 등록 단계로 넘깁니다."),
            item("애매하면 자동 재촬영", "후보가 여러 개이거나 옵션이 충돌하면 뒷면·바코드 재촬영을 요청합니다."),
            item("찾지 못하면 자동 제외", "상품을 확실히 찾지 못했을 때 유사상품으로 억지 등록하지 않습니다."),
            item("시장가격 출처와 시각 저장", "허용된 범위의 가격·배송비·옵션·통화와 조회시각·원본 링크를 기록합니다.", "조건"),
        ],
    },
    {
        "code": "E",
        "title": "판매 가능 여부와 규제 확인",
        "slides": "PPT 12, 24",
        "intro": "국가와 카테고리별 필수정보가 없으면 자동 게시하지 않는 안전장치를 둡니다.",
        "items": [
            item("국가×카테고리 판매규칙표", "어떤 상품을 어느 나라와 채널에서 팔 수 있는지 규칙표로 관리합니다."),
            item("금지품목·금지표현 검사", "판매금지 상품과 의약적·과장 표현을 자동으로 찾습니다."),
            item("성분·주의문구 대조", "라벨에서 읽은 성분과 금지성분·주의문구 규칙을 비교합니다.", "조건"),
            item("인증서 필요 여부 확인", "PSE, 전파, 안전, 할랄 등 카테고리별 인증자료 필요 여부를 확인합니다.", "조건"),
            item("원산지·제조사 확인", "필수 원산지와 제조자·판매책임자 정보가 없으면 등록을 막습니다."),
            item("HS코드 후보 제안", "통관에 필요한 HS코드 후보와 선택 근거를 저장합니다.", "조건"),
            item("위험등급 자동 계산", "상품을 Low, Medium, High로 구분하고 이유를 보여줍니다."),
            item("저위험 화이트리스트 자동 통과", "미리 허용한 카테고리와 완비된 상품은 사람 승인 없이 진행합니다."),
            item("중·고위험 자동 차단", "정보가 부족하거나 규제 가능성이 있으면 자동 제외하고 게시하지 않습니다."),
            item("규정 시행일과 판정이력 저장", "정책 변경일, 적용국가, 판단결과와 사용한 규칙 버전을 남깁니다."),
        ],
    },
    {
        "code": "F",
        "title": "썸네일·상세페이지·번역",
        "slides": "PPT 16, 24",
        "intro": "상품 사실은 바꾸지 않고, 채널 규격과 국가 언어에 맞는 판매 콘텐츠를 자동으로 만듭니다.",
        "items": [
            item("배경 자동 제거", "촬영사진에서 상품을 분리해 깨끗한 배경으로 만듭니다."),
            item("배경제거 실패 폴백", "경계가 깨지면 원본 상품을 유지하고 흰 여백 썸네일을 만듭니다."),
            item("채널별 이미지 규격 변환", "크기, 비율, 여백, 파일형식과 용량을 채널 규칙에 맞춥니다."),
            item("썸네일 템플릿 적용", "기본 흰 배경과 허용된 프로모션 템플릿을 상품별로 생성합니다."),
            item("제품 라벨 변조 검사", "원본과 결과의 글자·로고·색상을 비교해 달라졌으면 결과를 폐기합니다."),
            item("워터마크·저작권 검사", "타 판매자 워터마크와 권리 불명 이미지를 찾아 사용하지 않습니다."),
            item("사실정보 잠금", "브랜드, 모델, 용량, 원산지, 성분과 인증번호를 AI가 임의 변경하지 못하게 합니다."),
            item("상품명 자동 생성", "채널 글자수와 현지 검색어를 반영해 상품명을 만듭니다."),
            item("상품설명·불릿 자동 생성", "허용된 사실정보만 이용해 장점, 규격, 사용정보를 정리합니다."),
            item("해외형 상세페이지 생성", "Shopee·Lazada·Qoo10용 모바일 우선 이미지와 짧은 설명을 만듭니다."),
            item("국가별 번역과 용어집", "브랜드는 번역하지 않고 언어별 금지어·단위·고정용어를 적용합니다."),
            item("SEO·금칙어·글자수 최종검사", "게시 전에 검색키워드, 금지표현, 필수문구와 글자수 제한을 확인합니다."),
        ],
    },
    {
        "code": "G",
        "title": "3개 채널 상품등록 연결",
        "slides": "PPT 5, 9, 10, 24",
        "intro": "공식 API를 통해 등록·수정·가격·재고를 처리하고, 일부 실패는 해당 채널만 재시도합니다.",
        "items": [
            item("채널 계정 안전 연결", "API 키와 판매자 토큰을 서버에서 암호화해 보관합니다."),
            item("토큰 자동 갱신", "만료 전에 갱신하고 실패하면 판매중단 위험 알림을 보냅니다."),
            item("카테고리 자동 동기화", "채널별 최신 카테고리와 선택 가능한 브랜드를 주기적으로 가져옵니다."),
            item("필수속성 사전검사", "카테고리별 필수값이 빠졌으면 API 호출 전에 등록을 멈춥니다."),
            item("채널 이미지 업로드", "외부 URL 제한을 포함한 각 채널 방식으로 이미지를 먼저 올립니다."),
            item("신규 상품 자동 등록", "검증된 상품명, 설명, 이미지, 옵션, 배송과 가격으로 상품을 생성합니다."),
            item("기존 상품 자동 수정", "콘텐츠·옵션·배송정보 변경을 기존 외부 상품에 반영합니다."),
            item("판매중지·품절 처리", "판매불가 또는 재고 0이면 해당 채널 상품을 자동으로 내립니다."),
            item("가격 자동 변경", "마진 엔진이 확정한 가격을 채널·국가별 상품에 반영합니다."),
            item("재고 자동 변경", "중앙 판매가능재고를 옵션 단위로 각 채널에 반영합니다."),
            item("옵션·세트상품 등록", "색상·용량·사이즈와 번들 SKU가 채널 옵션 구조와 일치하게 합니다."),
            item("호출제한·재시도·중복방지", "429, timeout, 5xx가 발생해도 중복상품 없이 안전하게 재시도합니다."),
            item("부분 성공 처리", "3개 중 성공한 채널은 유지하고 실패한 채널만 재시도 대기열에 넣습니다."),
            item("Qoo10 단계형 QAPI 처리", "기본상품 등록 후 이미지·상세·옵션·가격·재고를 순서대로 완성합니다."),
            item("Shopee 글로벌상품·국가게시", "Global Product와 국가 shop 게시를 분리하고 주문 push를 연결합니다."),
            item("Lazada 이미지·창고·웹훅 처리", "Lazada 이미지 주소, 국가별 인증, 창고수량과 주문 웹훅을 맞게 처리합니다."),
        ],
    },
    {
        "code": "H",
        "title": "가격·마진·정산",
        "slides": "PPT 17, 23, 27",
        "intro": "판매가를 감으로 정하지 않고 실제로 빠져나가는 비용을 모두 반영해 역마진을 막습니다.",
        "items": [
            item("매입원가와 원가방식", "실구매가를 기록하고 이동평균·선입선출·최근매입가 중 기준을 정합니다.", "결정"),
            item("국내·해외 물류비", "매입처 배송과 중량·부피 기반 국제·현지 배송비를 반영합니다."),
            item("포장·부자재·3PL 비용", "박스, 테이프, 완충재, 작업비와 3PL 비용을 원가에 포함합니다."),
            item("플랫폼·결제 수수료", "채널·국가·카테고리·판매자등급별 수수료를 기간별로 관리합니다."),
            item("세금·관세·원천징수", "고정비용과 판매가 비율로 붙는 세금을 구분해 계산합니다."),
            item("환율 자동 반영", "매일 환율을 가져오고 오래된 환율이면 자동 가격변경을 중지합니다."),
            item("목표 마진율 조절", "설정한 마진율에 맞춰 국가별 최소 판매가를 즉시 계산합니다."),
            item("채널별 반올림·최소가격", "통화 단위와 채널 가격 제한에 맞게 최종 가격을 조정합니다."),
            item("경쟁가와 마진하한 동시 적용", "최저가보다 싸게 팔더라도 마진하한 아래로는 절대 내리지 않습니다."),
            item("쿠폰·할인 사전 시뮬레이션", "프로모션 적용 후 예상 실마진을 게시 전에 보여줍니다."),
            item("번들·자동 리프라이싱", "세트 원가와 구성품 재고를 반영하고 자동 가격변경에 하한선을 둡니다."),
            item("정산 예정액과 실제 입금 대조", "수수료·세금·환불을 반영해 예정 정산과 실입금 차이를 찾습니다."),
        ],
    },
    {
        "code": "I",
        "title": "주문과 공통 재고",
        "slides": "PPT 18, 22",
        "intro": "실물 재고 하나를 중앙에서 관리하고, 어느 채널에서 팔려도 나머지 채널이 같은 재고로 수렴하게 합니다.",
        "items": [
            item("통합 주문함", "3개 채널 주문을 한 화면에서 시간순으로 확인합니다."),
            item("Shopee·Lazada 주문 웹훅", "주문 push를 받아 서명을 확인하고 빠르게 처리합니다."),
            item("Qoo10 주문 주기조회", "웹훅이 없는 주문은 정해진 간격으로 조회해 가져옵니다."),
            item("웹훅 누락 보정조회", "Shopee·Lazada도 주기 조회해 유실된 주문을 보완합니다."),
            item("주문형식 통일", "채널마다 다른 주문상태·주소·금액을 공통 형식으로 바꿉니다."),
            item("중복 주문 제거", "웹훅과 조회에서 같은 주문이 들어와도 한 번만 저장합니다."),
            item("주문상태 이력", "결제, 준비, 발송, 취소, 반품 상태와 변경시각을 모두 남깁니다."),
            item("주문상품과 내부 SKU 연결", "외부 주문라인을 정확한 내부 상품·옵션·세트에 연결합니다."),
            item("중앙 재고원장", "입고, 예약, 판매, 취소, 반품, 조정을 증감내역으로 관리합니다."),
            item("주문 즉시 재고 예약", "결제단계에 맞춰 재고를 예약하고 확정·취소 시 올바르게 반영합니다."),
            item("한 번에 차감하고 전파예약", "주문저장·중앙차감·채널전파 작업을 하나의 안전한 처리로 만듭니다."),
            item("전 채널 재고 갱신", "한 채널에서 판매되면 나머지 채널의 같은 SKU 재고를 자동으로 낮춥니다."),
            item("안전재고·임계치·자동품절", "과판매 방지수량을 빼고 노출하며 부족경고와 0재고 판매중지를 실행합니다."),
            item("세트 구성품 연동차감", "1+1·2입 상품이 팔리면 실제 구성품 수량만큼 중앙재고를 차감합니다."),
            item("재고 대조와 동시주문 검증", "주기적으로 채널값을 대조하고 동시 주문에도 음수·중복차감이 없게 합니다."),
        ],
    },
    {
        "code": "J",
        "title": "카카오톡과 운영 알림",
        "slides": "PPT 9, 18",
        "intro": "개인 카카오톡은 읽지 않고 주문·재고·장애 등 시스템 이벤트만 알림톡으로 보냅니다.",
        "items": [
            item("신규 주문 알림", "주문번호, 채널, 상품, 수량과 처리기한을 알림톡으로 보냅니다."),
            item("시간별 주문 요약", "최근 주문 건수·금액·주요 상품을 한 번에 요약합니다."),
            item("재고부족·품절 알림", "안전재고 이하와 자동품절 결과를 즉시 알립니다."),
            item("등록·가격·재고 실패 알림", "어느 채널에서 무엇이 실패했고 재시도 중인지 알려줍니다."),
            item("출고지연 알림", "채널 발송기한 전에 경고하고 기한초과 위험을 표시합니다."),
            item("토큰·API·마진 위험 알림", "인증 만료, API 장애, 환율·마진 하락을 운영자에게 알립니다."),
            item("알림톡 템플릿과 대체수단", "승인된 템플릿만 사용하고 실패 시 이메일·SMS·앱푸시로 대체합니다.", "조건"),
        ],
    },
    {
        "code": "K",
        "title": "매입·포장·배송",
        "slides": "PPT 4, 20",
        "intro": "1차에는 물리 작업은 사람이 하지만 시스템이 매입·포장·송장·지연을 빠뜨리지 않게 돕습니다.",
        "items": [
            item("주문별 매입목록", "판매된 상품과 필요한 수량을 구매목록으로 모아 보여줍니다."),
            item("모바일 포장 체크리스트", "상품확인, 수량, 포장, 라벨부착을 순서대로 체크합니다."),
            item("송장 일괄조회·PDF 출력", "출력 가능한 송장을 주문별 또는 묶음으로 내려받습니다."),
            item("채널별 발송방법 관리", "Shopee SLS, Lazada 드롭오프, Qoo10 배송방법을 주문에 연결합니다."),
            item("발송처리 채널 반영", "송장번호와 발송시각을 각 채널 주문에 자동 등록합니다."),
            item("배송상태 통합조회", "집하, 이동, 통관, 배송완료 상태를 한 화면에서 추적합니다."),
            item("발송기한·배송지연 경고", "계정 페널티 전에 마감임박과 지연 주문을 알려줍니다."),
            item("3PL 연결규격 선설계", "출고지시, 재고조회, 송장발행, 배송상태 수신 규격을 미리 정의합니다.", "후속"),
        ],
    },
    {
        "code": "L",
        "title": "고객문의와 CS",
        "slides": "PPT 19",
        "intro": "채널이 허용하는 범위에서 문의를 모으고 안전한 질문부터 다국어로 자동 응답합니다.",
        "items": [
            item("채널별 문의 수집범위 표시", "Lazada, Shopee, Qoo10에서 실제 API로 받을 수 있는 문의 범위를 구분합니다.", "조건"),
            item("통합 문의함", "수집 가능한 문의를 채널·상품·언어별로 한 화면에 모읍니다.", "조건"),
            item("FAQ·과거답변 검색", "비슷한 질문의 승인된 답변을 먼저 찾습니다."),
            item("다국어 답변 생성", "상품 사실과 주문상태에 맞는 현지어 답변 초안을 만듭니다."),
            item("답변 신뢰도 판정", "확신이 낮거나 정보가 충돌하면 자동발송하지 않고 보류합니다."),
            item("안전한 FAQ 자동발송", "배송조회·규격·사용법 등 허용된 질문만 자동 답변합니다."),
            item("환불·분쟁·보상 보호", "금전·법적 결정은 정해진 규칙 밖에서 AI가 임의 확정하지 못하게 합니다."),
            item("답변 학습과 음성상담 분리", "승인된 답변은 재사용하고 AI 전화상담은 Phase 3 파일럿으로 둡니다.", "후속"),
        ],
    },
    {
        "code": "M",
        "title": "앱을 꺼도 돌아가는 자동작업",
        "slides": "PPT 21",
        "intro": "운영자가 화면을 열지 않아도 서버가 주문·재고·환율·정책을 계속 확인해야 합니다.",
        "items": [
            item("주문 웹훅 상시수신", "서버가 24시간 Shopee·Lazada 주문 이벤트를 받을 수 있어야 합니다."),
            item("주문 폴링 스케줄러", "Qoo10과 누락보정 주문을 정해진 주기로 조회합니다."),
            item("재고 불일치 자동점검", "중앙재고와 각 채널 값을 비교하고 차이를 복구합니다."),
            item("배송·CS 마감점검", "지연배송과 장시간 미응답 문의를 주기적으로 찾습니다."),
            item("환율·마진 일일 재계산", "매일 환율을 갱신하고 상품별 실마진 위험을 다시 계산합니다."),
            item("경쟁가격 주기 갱신", "승인된 데이터 소스가 있을 때만 가격을 다시 조회합니다.", "조건"),
            item("개발자 공지 전용메일 수집", "개인메일이 아닌 전용계정에서 채널 공지와 정책메일을 가져옵니다."),
            item("수수료·API·규제 변경 감지", "내 판매국가와 기능에 영향 있는 변경만 분류해 알립니다."),
            item("워치독과 중복실행 방지", "작업이 조용히 멈추거나 같은 작업이 두 번 실행되는 것을 감지합니다."),
            item("실패대기열·작업현황·일일보고", "재시도 불가 작업을 분리하고 성공률·오류·매출 요약을 보여줍니다."),
        ],
    },
    {
        "code": "N",
        "title": "웹·모바일 운영화면",
        "slides": "PPT 3, 7, 14",
        "intro": "비개발자가 상품 한 건의 진행상태와 채널 운영상태를 쉽게 확인할 수 있어야 합니다.",
        "items": [
            item("새 상품 촬영·업로드 화면", "사진을 올리고 자동 처리상태를 보는 시작 화면을 만듭니다."),
            item("상품 후보 확인화면", "찾은 후보, 일치근거, 가격과 자동판정 결과를 보여줍니다."),
            item("썸네일·상세·번역 미리보기", "채널·언어별 생성 결과와 사용된 사실정보를 확인합니다."),
            item("가격·마진 화면", "원가, 수수료, 환율, 경쟁가, 권장가와 예상 실마진을 보여줍니다."),
            item("채널연결·등록현황 화면", "계정상태, 토큰, 외부상품번호, 성공·실패·재시도를 확인합니다."),
            item("주문·재고 화면", "통합 주문, 중앙재고, 안전재고, 불일치와 품절상태를 관리합니다."),
            item("알림·CS·매출·정산 화면", "운영 위험, 문의, 매출, 마진과 정산차이를 한곳에서 확인합니다."),
            item("모바일 PWA 우선·윈도우앱 후순위", "카메라와 현장업무는 모바일 웹으로 시작하고 데스크톱앱은 필요성 검토 후 결정합니다.", "결정"),
        ],
    },
    {
        "code": "O",
        "title": "보안·서버·운영 안정성",
        "slides": "PPT 6, 21, 25, 30",
        "intro": "판매자 인증정보와 주문 개인정보를 지키고 장애가 나도 복구할 수 있게 합니다.",
        "items": [
            item("고정 공인 IP 작업서버", "채널 화이트리스트와 안정적 호출을 위해 고정 출구 IP 서버를 사용합니다."),
            item("PostgreSQL 중앙DB와 접근차단", "외부에 필요한 데이터만 공개하고 토큰·원장·PII는 비공개 영역에 둡니다."),
            item("API 키·토큰 암호화", "비밀값을 브라우저, 소스코드와 일반 로그에 남기지 않습니다."),
            item("웹훅 서명·재전송 방지", "위조 주문과 오래된 이벤트 재사용을 차단합니다."),
            item("개인정보 분리·마스킹·보존기간", "주문자 주소·전화번호 접근과 삭제 기준을 별도로 관리합니다."),
            item("로그인·역할권한·MFA", "관리자 중요작업은 강한 인증과 최소권한으로 보호합니다."),
            item("백업과 실제 복구시험", "DB와 이미지 백업뿐 아니라 정해진 시간 안에 복구되는지 시험합니다."),
            item("로그·메트릭·추적·장애알림", "상품 한 건의 전 처리경로와 채널 성공률·지연·오류를 관찰합니다."),
            item("오픈소스·모델 라이선스 관리", "버전을 고정하고 취약점, SBOM, 코드와 모델 가중치 라이선스를 기록합니다."),
            item("개발·검수·운영환경 분리", "실상품 오등록을 막고 호출제한·회로차단·배포승인 절차를 둡니다."),
        ],
    },
    {
        "code": "P",
        "title": "테스트·검수·인수인계",
        "slides": "PPT 2, 25, 28, 30, 31",
        "intro": "화면이 보이는 것만으로 완료 처리하지 않고 실제 계정·실상품·장애상황까지 검수합니다.",
        "items": [
            item("정식 Excel과 항목 연결", "이 PDF 항목을 정식 REQ-ID·인수조건과 연결해 계약 검수표를 완성합니다.", "필수"),
            item("기존 코드·인증정보 선점검", "재사용·수정·폐기 모듈을 판정하고 노출된 키는 즉시 재발급합니다."),
            item("3채널 API PoC 선검증", "인증, 카테고리, 이미지, 상품, 가격, 재고, 주문, 배송 기본 호출을 확인합니다."),
            item("실제 E2E 상품흐름 검수", "촬영부터 등록·주문·재고차감·알림까지 한 상품으로 끝까지 시험합니다."),
            item("오류·중복·호출제한 검수", "timeout, 429, 5xx, 중복 웹훅과 재시도에도 중복 등록·차감이 없어야 합니다."),
            item("10,000건 동시주문 시뮬레이션", "중앙재고 음수, 중복차감과 순서뒤바뀜이 없는지 검증합니다."),
            item("24시간 채널장애 복구시험", "장애 후 밀린 작업을 처리해도 주문·재고·상품이 중복되지 않아야 합니다."),
            item("이미지·OCR 품질검수", "라벨·로고·색상 변조와 주요 사실정보 오인식을 기준 데이터로 측정합니다."),
            item("상품매칭 정답 500건 검수", "카테고리별 Top-1·Top-5와 오탐률을 측정해 자동등록 기준을 확정합니다."),
            item("가격·마진 자동시험", "모든 비용·세금·환율·반올림·마진불가 상황을 계산 테스트로 검증합니다."),
            item("30~100개 SKU 제한운영", "4주간 중대 과판매, 중복상품, 보호정보 조작 없이 운영되는지 확인합니다."),
            item("문서·소스·계정·교육 인수", "명세, 화면, ERD, API, 배포·운영·테스트 문서와 전체 코드·계정·교육·API변경 유지보수를 인계합니다."),
        ],
    },
    {
        "code": "Q",
        "title": "추후 확장 항목",
        "slides": "PPT 5, 20, 27, 28",
        "intro": "1차 코어가 안정된 뒤 같은 연결규격을 사용해 확장합니다. 1차 완료조건에는 넣지 않습니다.",
        "items": [
            item("네이버 스마트스토어 연결", "국내형 상세페이지, 상품·주문·재고·배송 어댑터를 추가합니다.", "후속"),
            item("쿠팡 연결", "상품·주문·재고·배송과 주문조회 지연 대응 어댑터를 추가합니다.", "후속"),
            item("11번가 연결", "허용 IP와 지원 API 범위에 맞춘 어댑터를 추가합니다.", "후속"),
            item("국내형 콘텐츠·별도 앱", "국내 세로 상세페이지, 네이티브 모바일 또는 Windows 앱은 필요성이 확인되면 개발합니다.", "후속"),
            item("3PL·AI 음성상담", "물류 자동화와 현지어 전화상담은 비용·오상담 위험 검증 후 파일럿으로 진행합니다.", "후속"),
            item("eBay 등 확장·광고 고도화", "eBay·AliExpress·Temu·1688와 광고·키워드·고객등급 기능은 개별 승인 후 추가합니다.", "후속"),
        ],
    },
]


TOTAL_ITEMS = sum(len(section["items"]) for section in sections)
assert TOTAL_ITEMS == 175, f"Expected 175 checklist items, got {TOTAL_ITEMS}"


def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#15223B"))
    canvas.circle(PAGE_W - 32 * mm, PAGE_H - 25 * mm, 58 * mm, stroke=0, fill=1)
    canvas.setStrokeColor(INDIGO)
    canvas.setLineWidth(4)
    canvas.line(LEFT, 22 * mm, PAGE_W - RIGHT, 22 * mm)
    canvas.restoreState()


def normal_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INDIGO)
    canvas.rect(0, PAGE_H - 5 * mm, PAGE_W, 5 * mm, stroke=0, fill=1)
    canvas.setFont("Nanum-Bold", 7.5)
    canvas.setFillColor(colors.HexColor("#768197"))
    canvas.drawString(LEFT, PAGE_H - 12 * mm, "글로벌 이커머스 통합 셀러 자동화")
    canvas.setFont("Nanum", 7.2)
    canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 12 * mm, "비개발자용 개발 체크리스트")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(LEFT, 11 * mm, PAGE_W - RIGHT, 11 * mm)
    canvas.setFillColor(colors.HexColor("#8B95A7"))
    canvas.drawString(LEFT, 7 * mm, "2026-08-11 · 1차 Qoo10 JP / Shopee / Lazada")
    canvas.drawRightString(PAGE_W - RIGHT, 7 * mm, f"{doc.page}")
    canvas.restoreState()


def page_background(canvas, doc):
    if doc.page == 1:
        cover_page(canvas, doc)


def page_foreground(canvas, doc):
    if doc.page > 1:
        normal_page(canvas, doc)


frame = Frame(LEFT, BOTTOM, CONTENT_W, PAGE_H - TOP - BOTTOM, id="normal-frame", showBoundary=0)
cover_frame = Frame(LEFT, 22 * mm, CONTENT_W, PAGE_H - 44 * mm, id="cover-frame", showBoundary=0)

doc = BaseDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=LEFT,
    rightMargin=RIGHT,
    topMargin=TOP,
    bottomMargin=BOTTOM,
    title="글로벌 이커머스 자동화 개발 체크리스트",
    author="Codex",
    subject="PPT 의도 기반 비개발자용 175개 개발·검수 체크리스트",
)
doc.addPageTemplates(
    [
        PageTemplate(
            id="all",
            frames=[frame],
            onPage=page_background,
            onPageEnd=page_foreground,
        ),
    ]
)


def label_markup(level: str) -> str:
    color = LEVEL_COLORS[level]
    return f'<font color="{color}"><b>[{esc(level)}]</b></font>'


def checklist_table(section):
    rows = [
        [
            Paragraph("번호", table_head),
            Paragraph("개발해야 하는 내용", table_head),
            Paragraph("개발", table_head),
            Paragraph("실검수", table_head),
        ]
    ]
    for idx, (level, title, desc) in enumerate(section["items"], 1):
        item_id = f'{section["code"]}-{idx:02d}'
        content = (
            f'{label_markup(level)} <font name="Nanum-Bold" size="8.9">{esc(title)}</font>'
            f'<br/><font color="#667085" size="7.5">{esc(desc)}</font>'
        )
        rows.append(
            [
                Paragraph(item_id, row_id),
                Paragraph(content, row_text),
                Paragraph("□", check_style),
                Paragraph("□", check_style),
            ]
        )
    table = LongTable(rows, colWidths=[35, CONTENT_W - 35 - 44 - 49, 44, 49], repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (-2, 0), (-1, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ]
    for row_idx in range(1, len(rows)):
        commands.append(("BACKGROUND", (0, row_idx), (-1, row_idx), SOFT_ALT if row_idx % 2 else WHITE))
    table.setStyle(TableStyle(commands))
    return table


def info_card(title: str, text: str, color=INDIGO_SOFT):
    t = Table(
        [[Paragraph(title, mini_title), Paragraph(text, mini_text)]],
        colWidths=[42 * mm, CONTENT_W - 42 * mm],
    )
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), color),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return t


story = []

# Cover
story.extend(
    [
        Spacer(1, 34 * mm),
        Paragraph("PPT 의도 기반 · 비개발자용 · 175개 확인항목", cover_kicker),
        Paragraph("글로벌 이커머스<br/>자동화 개발 체크리스트", cover_title),
        Paragraph(
            "사진을 올린 뒤 상품 인식, 썸네일·상세·번역, 마진 가격, 3개 채널 등록, 주문·공통재고, 카카오 알림까지 무엇을 개발하고 무엇을 실제로 검수해야 하는지 한 항목씩 정리했습니다.",
            cover_sub,
        ),
        Spacer(1, 19 * mm),
        Table(
            [
                [Paragraph("1차 필수", table_head), Paragraph("Qoo10 Japan · Shopee · Lazada", body)],
                [Paragraph("추후 확장", table_head), Paragraph("스마트스토어 · 쿠팡 · 11번가 · 3PL · 음성 CS", body)],
                [Paragraph("체크 방법", table_head), Paragraph("개발 완료와 실사용 검수를 각각 표시", body)],
            ],
            colWidths=[30 * mm, 118 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), INDIGO),
                    ("BACKGROUND", (1, 0), (1, -1), colors.HexColor("#F3F5FA")),
                    ("TEXTCOLOR", (0, 0), (0, -1), WHITE),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#344158")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#344158")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ]
            ),
        ),
        PageBreak(),
    ]
)

# How to use
story.append(Paragraph("이 체크리스트 사용방법", page_title))
story.append(Paragraph("개발사와 발주자가 같은 항목을 보고 완료 여부를 확인하기 위한 문서입니다.", section_meta))
story.append(
    info_card(
        "□ 개발",
        "코드와 화면이 만들어졌다는 뜻입니다. 개발자가 완료라고 표시합니다.",
        INDIGO_SOFT,
    )
)
story.append(Spacer(1, 5 * mm))
story.append(
    info_card(
        "□ 실검수",
        "실제 계정·실제 상품 또는 합의한 테스트 환경에서 의도대로 작동한 것을 확인한 뒤 표시합니다.",
        colors.HexColor("#EAF8F2"),
    )
)
story.append(Spacer(1, 5 * mm))
story.append(
    info_card(
        "중요한 원칙",
        "화면만 보이거나 샘플 숫자가 움직이는 것은 완료가 아닙니다. 상품등록, 주문수집, 재고차감, 오류복구 증거가 있어야 실검수 완료입니다.",
        colors.HexColor("#FFF3E8"),
    )
)
story.append(Spacer(1, 10 * mm))
legend = [
    [Paragraph('<font color="#465FFF"><b>[필수]</b></font>', body), Paragraph("1차 시스템에 반드시 포함", body)],
    [Paragraph('<font color="#D97706"><b>[조건]</b></font>', body), Paragraph("계정 승인·상품 데이터·외부 서비스가 준비돼야 작동", body)],
    [Paragraph('<font color="#F56F61"><b>[결정]</b></font>', body), Paragraph("개발 전에 발주자가 범위와 정책을 선택", body)],
    [Paragraph('<font color="#667085"><b>[후속]</b></font>', body), Paragraph("1차 코어 안정화 후 Phase 2·3에서 추가", body)],
]
legend_table = Table(legend, colWidths=[32 * mm, CONTENT_W - 32 * mm])
legend_table.setStyle(
    TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 0.45, LINE),
            ("BACKGROUND", (0, 0), (-1, -1), SOFT_ALT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]
    )
)
story.append(legend_table)
story.append(Spacer(1, 8 * mm))
story.append(
    Paragraph(
        "주의: 이 문서는 PPT 31장의 의도를 비개발자용 175개 항목으로 다시 나눈 것입니다. 정식 Excel 기능명세서의 175개 REQ-ID와 1:1로 대응하는 계약 문서는 아니며, 최종 계약 전에는 Excel 인수조건과 연결해야 합니다.",
        body_small,
    )
)
story.append(PageBreak())

# Intended user flow
story.append(Paragraph("완성되면 사용자는 이렇게 이용합니다", page_title))
story.append(Paragraph("사람이 매번 승인하는 시스템이 아니라, 조건을 통과하면 자동으로 진행하고 부족하면 자동으로 멈추는 구조입니다.", section_meta))
flow_rows = []
flow_steps = [
    ("01", "촬영", "정면·라벨·바코드 사진을 올립니다."),
    ("02", "상품 찾기", "바코드·글자·이미지·공급사 자료로 같은 상품을 찾습니다."),
    ("03", "판매 가능 확인", "국가·카테고리·성분·인증·필수정보를 검사합니다."),
    ("04", "콘텐츠 생성", "썸네일, 상세페이지, 상품명, 설명과 번역을 만듭니다."),
    ("05", "가격 계산", "원가·배송·수수료·세금·환율·목표마진을 반영합니다."),
    ("06", "자동 등록", "Qoo10·Shopee·Lazada에 상품을 등록합니다."),
    ("07", "주문·재고", "주문을 모으고 중앙재고를 차감해 모든 채널에 반영합니다."),
    ("08", "카카오 알림", "신규 주문, 재고부족, 실패, 지연과 토큰 위험을 알립니다."),
    ("09", "포장·발송", "1차에는 사람이 포장·출고하고 시스템이 송장과 기한을 관리합니다."),
]
for no, title, desc in flow_steps:
    flow_rows.append(
        [
            Paragraph(f'<font color="#465FFF"><b>{no}</b></font>', mini_title),
            Paragraph(title, mini_title),
            Paragraph(desc, mini_text),
        ]
    )
flow_table = Table(flow_rows, colWidths=[15 * mm, 31 * mm, CONTENT_W - 46 * mm])
flow_table.setStyle(
    TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]
    )
)
story.append(flow_table)
story.append(Spacer(1, 8 * mm))
story.append(
    info_card(
        "무인 운영 성공 기준",
        "등록 가능한 상품은 자동 게시되고, 불확실한 상품은 자동 재촬영 또는 자동 제외됩니다. 모든 사진을 억지로 등록하는 것은 성공이 아닙니다.",
        colors.HexColor("#EAF8F2"),
    )
)
story.append(PageBreak())

# Roadmap
story.append(Paragraph("개발 순서와 진행 문턱", page_title))
story.append(Paragraph("앞 단계가 검수되지 않으면 다음 큰 계약으로 넘어가지 않는 방식이 안전합니다.", section_meta))
roadmap = [
    ["Gate 0", "2주", "범위·국가·카테고리·테스트상품·공급사자료·알림톡 준비"],
    ["Gate 1", "3~6주", "3개 채널 인증·이미지·상품·가격·재고·주문·배송 API PoC"],
    ["Phase 1", "6~8주", "중앙 상품·주문·재고, 채널 어댑터, 알림, 장애복구"],
    ["Phase 2", "5~7주", "촬영·OCR·썸네일·상세·번역·마진 가격"],
    ["Phase 3", "5~7주", "상품매칭·공급사/허용 데이터·시장가격"],
    ["Phase 4", "4주", "30~100개 SKU 제한적 무인 운영과 안정화"],
]
roadmap_rows = [[Paragraph("단계", table_head), Paragraph("예상", table_head), Paragraph("완료해야 할 결과", table_head)]]
for phase, duration, result in roadmap:
    roadmap_rows.append([Paragraph(phase, row_id), Paragraph(duration, body_small), Paragraph(result, body_small)])
roadmap_table = Table(roadmap_rows, colWidths=[27 * mm, 24 * mm, CONTENT_W - 51 * mm], repeatRows=1)
roadmap_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.45, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]
    )
)
story.append(roadmap_table)
story.append(Spacer(1, 9 * mm))
story.append(info_card("예상 전체기간", "4~5명 팀이 일부 작업을 병행하면 약 20~28주, 모든 단계를 순차 수행하면 25~34주입니다.", INDIGO_SOFT))
story.append(Spacer(1, 5 * mm))
story.append(info_card("라이브 등록 원칙", "실상품 게시 테스트는 사용자 승인 전까지 실행하지 않습니다. sandbox 또는 테스트계정이 없으면 테스트 절차를 먼저 합의합니다.", colors.HexColor("#FFF3E8")))
story.append(PageBreak())

# Checklist sections
for section_index, section in enumerate(sections):
    story.append(Paragraph(f'{section["code"]}. {section["title"]}', page_title))
    story.append(
        Paragraph(
            f'{esc(section["intro"])}<br/><font color="#8A95A8">근거 슬라이드: {esc(section["slides"])} · 이 페이지 {len(section["items"])}개 항목</font>',
            section_meta,
        )
    )
    story.append(checklist_table(section))
    story.append(PageBreak())

# Final sign-off
story.append(Paragraph("최종 단계별 승인표", page_title))
story.append(Paragraph("각 단계는 아래 결과물이 실제로 확인된 뒤 다음 단계로 넘어갑니다.", section_meta))
signoff_rows = [
    [Paragraph("단계", table_head), Paragraph("승인 조건", table_head), Paragraph("승인", table_head), Paragraph("날짜/서명", table_head)],
    [Paragraph("Gate 0", row_id), Paragraph("범위·카테고리·계정·데이터·알림톡 준비 완료", body_small), Paragraph("□", check_style), ""],
    [Paragraph("Gate 1", row_id), Paragraph("3개 채널 API PoC 증거와 한계목록 확인", body_small), Paragraph("□", check_style), ""],
    [Paragraph("Phase 1", row_id), Paragraph("주문·재고·알림·장애복구 운영코어 검수", body_small), Paragraph("□", check_style), ""],
    [Paragraph("Phase 2", row_id), Paragraph("촬영·콘텐츠·번역·마진 계산 품질검수", body_small), Paragraph("□", check_style), ""],
    [Paragraph("Phase 3", row_id), Paragraph("정답 500건 기반 상품매칭 기준과 데이터 권한 확인", body_small), Paragraph("□", check_style), ""],
    [Paragraph("Phase 4", row_id), Paragraph("30~100 SKU 4주 제한운영 완료", body_small), Paragraph("□", check_style), ""],
    [Paragraph("최종 인수", row_id), Paragraph("175개 체크항목과 정식 Excel 인수조건 대조 완료", body_small), Paragraph("□", check_style), ""],
]
signoff_table = Table(signoff_rows, colWidths=[27 * mm, 92 * mm, 20 * mm, CONTENT_W - 139 * mm], rowHeights=[None] + [17 * mm] * 7)
signoff_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.55, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (2, 1), (2, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]
    )
)
story.append(signoff_table)
story.append(Spacer(1, 8 * mm))
story.append(
    info_card(
        "최종 확인 문장",
        "사진 업로드 후 시스템이 자동 등록·자동 제외·재촬영 요청 중 하나를 결정하고, 등록된 상품의 주문·재고·가격·알림이 3개 채널에서 안정적으로 운영되는 것을 확인했습니다.",
        colors.HexColor("#EAF8F2"),
    )
)
story.append(PageBreak())

# Sources and limitations
story.append(Paragraph("작성 기준과 문서 한계", page_title))
story.append(Paragraph("이 PDF는 비개발자가 개발범위와 검수상태를 빠르게 확인할 수 있도록 재구성한 문서입니다.", section_meta))
source_rows = [
    [Paragraph("주요 원본", mini_title), Paragraph("프로젝트_기능명세_제안자료 (1).pptx · v0.2 · 2026-08-09 · 31장", mini_text)],
    [Paragraph("현재 합의 반영", mini_title), Paragraph("1차 Qoo10 Japan·Shopee·Lazada, 개인 카카오톡 수집 제외, 촬영 업로드 이후 자동 처리", mini_text)],
    [Paragraph("기술검토 반영", mini_title), Paragraph("오픈소스 처리엔진, 공식 API 어댑터, 공급사·허용 상품데이터, 실패 시 자동 제외·재촬영 폴백", mini_text)],
    [Paragraph("정식 명세", mini_title), Paragraph("PPT가 언급한 기능명세서.xlsx는 현재 전달파일에서 확인되지 않았습니다. 계약 전 확보해 REQ-ID와 연결해야 합니다.", mini_text)],
    [Paragraph("중요한 한계", mini_title), Paragraph("모든 사진의 100% 식별, 인터넷 전체 절대 최저가, 외부 3채널의 같은 순간 재고반영, 3PL 없는 물리출고는 보장대상이 아닙니다.", mini_text)],
]
source_table = Table(source_rows, colWidths=[35 * mm, CONTENT_W - 35 * mm])
source_table.setStyle(
    TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 0.45, LINE),
            ("BACKGROUND", (0, 0), (0, -1), INDIGO_SOFT),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]
    )
)
story.append(source_table)
story.append(Spacer(1, 10 * mm))
story.append(
    Paragraph(
        "본 체크리스트의 목적은 ‘무엇을 만들었는가’와 ‘실제로 작동하는가’를 분리해 확인하는 것입니다. 개발사 견적 요청, 주간 진척회의, 단계별 검수와 최종 인수인계 때 같은 문서를 계속 사용하십시오.",
        callout,
    )
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.build(story)
print(f"created={OUTPUT}")
print(f"items={TOTAL_ITEMS}")
