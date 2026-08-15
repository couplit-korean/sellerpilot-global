from __future__ import annotations

from copy import copy
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path("/Users/kimchangheemac/Documents/ChatGPT/ai 쇼핑 채널 등록 자동화")
OUTPUT = ROOT / "output/pdf/AI_쇼핑채널_상품등록자동화_소프트웨어_개발용역계약서.pdf"
FONT_DIR = ROOT / "tmp/pdfs/fonts"
FONT_REGULAR = FONT_DIR / "NanumGothic-Regular.ttf"
FONT_BOLD = FONT_DIR / "NanumGothic-Bold.ttf"

pdfmetrics.registerFont(TTFont("Nanum", str(FONT_REGULAR)))
pdfmetrics.registerFont(TTFont("Nanum-Bold", str(FONT_BOLD)))
pdfmetrics.registerFontFamily("Nanum", normal="Nanum", bold="Nanum-Bold")

PAGE_W, PAGE_H = A4
LEFT = 18 * mm
RIGHT = 18 * mm
TOP = 19 * mm
BOTTOM = 17 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT

INK = colors.HexColor("#141820")
MUTED = colors.HexColor("#606A78")
NAVY = colors.HexColor("#15263C")
BLUE = colors.HexColor("#315B7D")
PALE_BLUE = colors.HexColor("#EDF3F7")
PALE_GRAY = colors.HexColor("#F6F7F9")
LINE = colors.HexColor("#CDD3DB")
WHITE = colors.white
ACCENT = colors.HexColor("#9A5B2B")


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


styles = getSampleStyleSheet()
title_kicker = ParagraphStyle(
    "TitleKicker",
    fontName="Nanum-Bold",
    fontSize=9,
    leading=13,
    textColor=BLUE,
    alignment=TA_CENTER,
    spaceAfter=7,
)
title = ParagraphStyle(
    "Title",
    fontName="Nanum-Bold",
    fontSize=22,
    leading=31,
    textColor=NAVY,
    alignment=TA_CENTER,
    wordWrap="CJK",
    spaceAfter=10,
)
subtitle = ParagraphStyle(
    "Subtitle",
    fontName="Nanum",
    fontSize=10.5,
    leading=16,
    textColor=MUTED,
    alignment=TA_CENTER,
    wordWrap="CJK",
    spaceAfter=15,
)
body = ParagraphStyle(
    "Body",
    fontName="Nanum",
    fontSize=9.15,
    leading=15.2,
    textColor=INK,
    alignment=TA_JUSTIFY,
    wordWrap="CJK",
    spaceAfter=5,
)
body_left = ParagraphStyle(
    "BodyLeft",
    parent=body,
    alignment=TA_LEFT,
)
body_indent = ParagraphStyle(
    "BodyIndent",
    parent=body,
    leftIndent=5 * mm,
    firstLineIndent=-5 * mm,
    alignment=TA_LEFT,
    spaceAfter=4,
)
body_subindent = ParagraphStyle(
    "BodySubIndent",
    parent=body,
    leftIndent=11 * mm,
    firstLineIndent=-5 * mm,
    alignment=TA_LEFT,
    spaceAfter=3,
)
lead = ParagraphStyle(
    "Lead",
    fontName="Nanum",
    fontSize=9.4,
    leading=16.4,
    textColor=INK,
    alignment=TA_JUSTIFY,
    wordWrap="CJK",
    spaceBefore=4,
    spaceAfter=10,
)
article_title = ParagraphStyle(
    "ArticleTitle",
    fontName="Nanum-Bold",
    fontSize=11.2,
    leading=17,
    textColor=NAVY,
    wordWrap="CJK",
    spaceBefore=10,
    spaceAfter=5,
    keepWithNext=True,
)
annex_title = ParagraphStyle(
    "AnnexTitle",
    fontName="Nanum-Bold",
    fontSize=17,
    leading=25,
    textColor=NAVY,
    alignment=TA_CENTER,
    wordWrap="CJK",
    spaceAfter=8,
)
annex_subtitle = ParagraphStyle(
    "AnnexSubtitle",
    fontName="Nanum",
    fontSize=9.3,
    leading=15,
    textColor=MUTED,
    alignment=TA_CENTER,
    wordWrap="CJK",
    spaceAfter=14,
)
table_label = ParagraphStyle(
    "TableLabel",
    fontName="Nanum-Bold",
    fontSize=8.4,
    leading=13,
    textColor=NAVY,
    alignment=TA_LEFT,
    wordWrap="CJK",
)
table_text = ParagraphStyle(
    "TableText",
    fontName="Nanum",
    fontSize=8.4,
    leading=13.2,
    textColor=INK,
    alignment=TA_LEFT,
    wordWrap="CJK",
)
table_head = ParagraphStyle(
    "TableHead",
    fontName="Nanum-Bold",
    fontSize=8.2,
    leading=12,
    textColor=WHITE,
    alignment=TA_CENTER,
    wordWrap="CJK",
)
table_small = ParagraphStyle(
    "TableSmall",
    fontName="Nanum",
    fontSize=7.7,
    leading=11.6,
    textColor=INK,
    alignment=TA_LEFT,
    wordWrap="CJK",
)
note = ParagraphStyle(
    "Note",
    fontName="Nanum",
    fontSize=8.1,
    leading=13,
    textColor=MUTED,
    alignment=TA_LEFT,
    wordWrap="CJK",
)
note_bold = ParagraphStyle(
    "NoteBold",
    fontName="Nanum-Bold",
    fontSize=8.4,
    leading=13,
    textColor=ACCENT,
    alignment=TA_LEFT,
    wordWrap="CJK",
)
signature_label = ParagraphStyle(
    "SignatureLabel",
    fontName="Nanum-Bold",
    fontSize=10.2,
    leading=15,
    textColor=NAVY,
    alignment=TA_LEFT,
    wordWrap="CJK",
)
signature_text = ParagraphStyle(
    "SignatureText",
    fontName="Nanum",
    fontSize=8.7,
    leading=15,
    textColor=INK,
    alignment=TA_LEFT,
    wordWrap="CJK",
)


def P(text: str, style: ParagraphStyle = body) -> Paragraph:
    return Paragraph(text, style)


def item(n: int, text: str) -> Paragraph:
    return P(f"<b>{n}.</b> {text}", body_indent)


def subitem(mark: str, text: str) -> Paragraph:
    return P(f"<b>{esc(mark)}</b> {text}", body_subindent)


def article(number: int, heading: str, paras: list) -> list:
    flow = [P(f"제{number}조 ({esc(heading)})", article_title)]
    flow.extend(paras)
    return flow


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page_number(page_count)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_page_number(self, page_count: int):
        page_num = self._pageNumber
        self.saveState()
        self.setStrokeColor(LINE)
        self.setLineWidth(0.5)
        self.line(LEFT, 12.5 * mm, PAGE_W - RIGHT, 12.5 * mm)
        self.setFont("Nanum", 7.5)
        self.setFillColor(MUTED)
        self.drawString(LEFT, 8.2 * mm, "AI 쇼핑 채널 상품등록 자동화 소프트웨어 개발용역계약서")
        self.drawRightString(PAGE_W - RIGHT, 8.2 * mm, f"{page_num} / {page_count}")
        self.restoreState()


class ContractDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=LEFT,
            rightMargin=RIGHT,
            topMargin=TOP,
            bottomMargin=BOTTOM,
            title="AI 쇼핑 채널 상품등록 자동화 소프트웨어 개발용역계약서",
            author="십일월삼일",
            subject="소프트웨어 개발용역, QA 및 유지보수 조건",
        )
        frame = Frame(
            LEFT,
            BOTTOM,
            CONTENT_W,
            PAGE_H - TOP - BOTTOM,
            id="contract-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(PageTemplate(id="contract", frames=[frame]))


def key_terms_table() -> Table:
    rows = [
        [P("사업명", table_label), P("AI 쇼핑 채널 상품등록 자동화(셀러파일럿) 웹·안드로이드 개발", table_text)],
        [P("당사자", table_label), P("갑: ____________________  /  을: 십일월삼일(대표 김창희)", table_text)],
        [P("계약기간", table_label), P("2026년 8월 15일 - 2026년 9월 4일 (예정 3주, 개발 조기 완료 시 종료일도 앞당김)", table_text)],
        [P("개발기간", table_label), P("2026년 8월 15일 - 2026년 8월 21일 (QA 제외, 최대 1주·조기 완료 가능)", table_text)],
        [P("QA 및 검수", table_label), P("개발 완료 다음 날부터 최대 2주 (예정: 2026년 8월 22일 - 9월 4일)", table_text)],
        [P("무료 유지보수", table_label), P("최종 QA 완료 다음 날부터 2개월 (예정: 2026년 9월 5일 - 11월 4일)", table_text)],
        [P("유상 유지보수", table_label), P("무료 유지보수 종료 다음 날부터(예정: 2026년 11월 5일) 건별 50,000원(VAT 별도)", table_text)],
        [P("계약금액", table_label), P("금 사백만원정 (₩4,000,000, VAT 별도)", table_text)],
        [P("지급일정", table_label), P("선금 40% 계약일 / 중도금 10% 개발 완료일 / 잔금 50% 전체 QA 완료 후", table_text)],
        [P("입금계좌", table_label), P("우리은행 75115540402101 / 예금주 김창희", table_text)],
        [P("전달·운영", table_label), P("GitHub 소스코드 공유 / Vercel 배포 / Supabase DB 관리 / Android APK 제공", table_text)],
        [P("추가 기능", table_label), P("로그인·사용자별 작업 / 여러 상품 작업 / 상품 설명·링크 반영 / 스토리보드", table_text)],
    ]
    table = Table(rows, colWidths=[38 * mm, CONTENT_W - 38 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
                ("BACKGROUND", (1, 0), (1, -1), WHITE),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
            ]
        )
    )
    return table


def info_note(text: str) -> Table:
    table = Table([[P(text, note_bold)]], colWidths=[CONTENT_W], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FBF4EC")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#D8B99A")),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def signature_table() -> Table:
    left = [
        P("갑 (발주자)", signature_label),
        Spacer(1, 3 * mm),
        P("상호/성명: __________________________", signature_text),
        P("대표자: ______________________________", signature_text),
        P("사업자등록번호: _____________________", signature_text),
        P("주소: _________________________________", signature_text),
        P("______________________________________", signature_text),
        P("연락처/이메일: _______________________", signature_text),
        Spacer(1, 9 * mm),
        P("대표자/본인: ____________________ (인)", signature_text),
    ]
    right = [
        P("을 (수급자)", signature_label),
        Spacer(1, 3 * mm),
        P("상호: 십일월삼일", signature_text),
        P("대표자: 김창희", signature_text),
        P("사업자등록번호: 643-20-01293", signature_text),
        P("주소: 서울특별시 중구 청파로 464,", signature_text),
        P("101동 3906호(중림동, 브라운스톤서울)", signature_text),
        P("연락처/이메일: _______________________", signature_text),
        Spacer(1, 9 * mm),
        P("대표자: 김창희 __________________ (인)", signature_text),
    ]
    table = Table([[left, right]], colWidths=[CONTENT_W / 2, CONTENT_W / 2], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.7, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, -1), PALE_GRAY),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    return table


def scope_table() -> LongTable:
    rows = [
        [
            P("번호", table_head),
            P("구성", table_head),
            P("포함 범위", table_head),
            P("인수 기준", table_head),
        ],
        [
            P("1", table_small),
            P("상품 입력", table_small),
            P("상품 사진 아래에 간단한 상품 설명 또는 공개 링크를 함께 입력하고 분석을 시작하는 화면", table_small),
            P("사진·설명·링크를 입력할 수 있고, 공개 링크에서 확인한 상품정보가 분석 내용에 함께 표시됨", table_small),
        ],
        [
            P("2", table_small),
            P("이미지 분석", table_small),
            P("사진 속 글자와 상품 정보를 읽어 정리하는 기능", table_small),
            P("읽은 정보와 확인이 필요한 정보가 구분되어 보임", table_small),
        ],
        [
            P("3", table_small),
            P("이미지 산출물", table_small),
            P("1000 x 1000 썸네일 1장과 상품 맞춤 설정 이미지 4장 생성. 입력한 설명·링크와 확정된 스토리보드를 제작에 반영", table_small),
            P("파일이 생성되고 입력 정보와 스토리보드의 주요 내용이 결과에 반영되며 심각한 잘림이 없음", table_small),
        ],
        [
            P("4", table_small),
            P("상세페이지", table_small),
            P("한국어, 일본어, 영어, 말레이어 상세페이지 초안과 상품정보 표 생성. 입력한 설명·링크와 확정된 스토리보드를 내용 구성에 반영", table_small),
            P("4개 언어 전환이 가능하고 입력 정보와 스토리보드의 주요 내용이 표시됨", table_small),
        ],
        [
            P("5", table_small),
            P("가격 계산", table_small),
            P("입력 원가와 목표 마진을 바탕으로 목표 판매가를 계산하는 기능", table_small),
            P("합의된 예시 입력에 대해 계산 결과가 재현됨", table_small),
        ],
        [
            P("6", table_small),
            P("판매채널 연결", table_small),
            P("Qoo10, Shopee, Lazada, eBay 상품 등록 연결과 처리 결과 표시", table_small),
            P("갑이 제공한 판매자 계정과 권한으로 등록을 시험하고 결과를 확인할 수 있음", table_small),
        ],
        [
            P("7", table_small),
            P("GitHub", table_small),
            P("소스코드와 간단한 실행 안내를 GitHub 저장소로 공유", table_small),
            P("갑이 저장소에 접속하여 소스코드와 안내를 확인할 수 있음", table_small),
        ],
        [
            P("8", table_small),
            P("Vercel", table_small),
            P("검수 가능한 웹 서비스를 Vercel을 통해 배포", table_small),
            P("제공된 웹 주소가 열리고 주요 기능을 확인할 수 있음", table_small),
        ],
        [
            P("9", table_small),
            P("Supabase", table_small),
            P("서비스에서 사용하는 데이터베이스를 Supabase로 구성하고 관리", table_small),
            P("검수용 정보가 정상적으로 저장되고 다시 조회됨", table_small),
        ],
        [
            P("10", table_small),
            P("Android APK", table_small),
            P("안드로이드 기기에 설치할 수 있는 APK 파일 제공", table_small),
            P("APK가 설치되고 앱이 실행되어 주요 화면을 확인할 수 있음", table_small),
        ],
        [
            P("11", table_small),
            P("로그인", table_small),
            P("사용자 회원가입·로그인·로그아웃과 로그인 사용자별 작업 목록 제공", table_small),
            P("서로 다른 두 사용자로 로그인했을 때 각자 자신의 상품 작업과 결과만 확인할 수 있음", table_small),
        ],
        [
            P("12", table_small),
            P("여러 상품 작업", table_small),
            P("한 상품이 분석·생성 중이어도 다른 상품을 새로 입력·접수하고 작업 목록에서 서로 오갈 수 있는 기능", table_small),
            P("최소 2개 상품을 연속 접수하고 각 상품의 진행 상태와 결과가 서로 구분되어 표시됨", table_small),
        ],
        [
            P("13", table_small),
            P("스토리보드", table_small),
            P("상세페이지와 설정 이미지 제작 전에 장면 순서, 핵심 문구와 이미지 구성을 간단한 스토리보드로 제시", table_small),
            P("상품별 스토리보드를 확인할 수 있고, 확정된 구성이 상세페이지와 설정 이미지 제작에 반영됨", table_small),
        ],
    ]
    table = LongTable(
        rows,
        colWidths=[10 * mm, 31 * mm, 84 * mm, CONTENT_W - 125 * mm],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 1), (0, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("BACKGROUND", (0, 1), (-1, -1), WHITE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GRAY]),
            ]
        )
    )
    return table


def build_story() -> list:
    story: list = []
    story.extend(
        [
            Spacer(1, 5 * mm),
            P("SOFTWARE DEVELOPMENT SERVICES", title_kicker),
            P("소프트웨어 개발용역계약서", title),
            P("AI 쇼핑 채널 상품등록 자동화(셀러파일럿) 로컬 MVP", subtitle),
            HRFlowable(width="100%", thickness=1.1, color=NAVY, spaceBefore=0, spaceAfter=8 * mm),
            key_terms_table(),
            Spacer(1, 5 * mm),
            info_note("서명 전 필수 기입: 갑의 상호/성명, 대표자, 사업자등록번호(해당 시), 주소, 연락처/이메일 및 총 계약금액을 반드시 기입한다."),
            Spacer(1, 7 * mm),
            P(
                "____________________(이하 '갑'이라 한다)과 십일월삼일(대표 김창희, 이하 '을'이라 한다)은 "
                "AI 쇼핑 채널 상품등록 자동화 소프트웨어의 개발, 검수 및 유지보수에 관하여 다음과 같이 계약을 체결한다.",
                lead,
            ),
        ]
    )

    story.extend(
        article(
            1,
            "목적",
            [
                P(
                    "본 계약은 갑이 의뢰한 소프트웨어를 을이 정해진 범위와 일정에 따라 개발하여 인도하고, "
                    "갑이 그 결과에 대한 대금을 지급하는 데 필요한 권리와 의무를 정함을 목적으로 한다."
                )
            ],
        )
    )
    story.extend(
        article(
            2,
            "정의",
            [
                item(1, "'산출물'이란 별지 1의 범위에 따라 을이 작성하여 갑에게 제공하는 소스코드, 실행 결과, 설정 예시 및 문서를 말한다."),
                item(2, "'오류'란 합의된 기준 환경에서 산출물이 별지 1의 확정된 기능 또는 인수 기준과 재현 가능하게 다르게 동작하고, 그 원인이 을이 제공한 코드에 직접 귀속되는 경우를 말한다."),
                item(3, "'기능 추가'란 새로운 화면, 자동화 흐름, 외부 서비스 연결, 데이터 항목, 디자인 변경, 성능 개선 또는 기존 합의 범위를 넘어서는 요구를 말한다."),
                item(4, "'서면'에는 서명 문서, 전자우편, 전자서명 문서 및 양 당사자가 확인 가능한 업무 메신저 기록을 포함한다."),
            ],
        )
    )
    story.extend(
        article(
            3,
            "개발 범위와 산출물",
            [
                item(1, "을의 개발 범위와 인수 기준은 별지 1에 따른다. 별지 1과 본문이 충돌하면 본문, 별지 1, 이후 서면 변경합의의 순서로 적용한다."),
                item(2, "실계정 판매채널 API 연동, 실제 상품 게시, 클라우드 배포, 24시간 운영, 주문·재고·배송 연동 및 별지 1에 명시되지 않은 기능은 본 계약 범위에 포함되지 않는다."),
                item(3, "갑이 제공하는 상품정보, 이미지, 계정, 인증정보 및 지시 내용의 정확성과 적법성은 갑이 확인한다. 을은 미확인 정보를 임의의 사실로 확정하지 않고 '확인 필요' 또는 '미연동'으로 표시할 수 있다."),
                item(4, "별지 1에 포함되지 않은 구두 요청은 을의 의무가 되지 않으며, 양 당사자가 범위·대금·일정 변경을 서면으로 확정한 때에만 추가 업무로 성립한다."),
            ],
        )
    )
    story.extend(
        article(
            4,
            "계약기간과 일정",
            [
                item(1, "계약기간은 2026년 8월 14일부터 2026년 9월 3일까지 총 3주로 한다."),
                item(2, "개발기간은 2026년 8월 14일부터 2026년 8월 20일까지 1주, QA 및 검수기간은 2026년 8월 21일부터 2026년 9월 3일까지 2주로 한다."),
                item(3, "갑의 자료·계정·테스트 이미지 제공 지연, 피드백 지연, 요구사항 변경 또는 제3자 서비스의 장애로 일정이 지연되는 경우 해당 지연일과 합리적인 재개 준비기간만큼 일정이 자동 연장된다."),
                item(4, "양 당사자는 필요 시 전자우편 또는 업무 메신저로 변경된 일정을 합의할 수 있다."),
            ],
        )
    )
    story.extend(
        article(
            5,
            "당사자의 협력의무",
            [
                item(1, "을은 선량한 관리자의 주의로 개발을 수행하고, 일정 또는 품질에 중대한 영향을 줄 사정이 발생하면 지체 없이 갑에게 알린다."),
                item(2, "갑은 요청받은 계정, 권한, 테스트 자료, 상품정보 및 피드백을 합리적인 기간 내 제공하고, 하나의 담당자를 정하여 의견을 취합한다."),
                item(3, "갑이 제공한 지시 또는 자료의 문제를 을이 알게 된 경우 을은 그 사실을 알린다. 갑이 통지 후에도 해당 지시를 유지하여 발생한 결과는 오류로 보지 않는다."),
                item(4, "양 당사자는 상대방의 업무를 부당하게 방해하지 않으며, 보안상 필요한 최소 범위에서만 계정과 자료에 접근한다."),
            ],
        )
    )
    story.extend(
        article(
            6,
            "계약금액과 지급",
            [
                item(1, "총 계약금액은 금 ____________________원(₩____________________, VAT 별도)으로 한다."),
                item(2, "갑은 계약 체결 후 2영업일 이내 총 계약금액의 50%를 선금으로, 최종 검수완료일 후 2영업일 이내 나머지 50%를 잔금으로 을이 지정한 계좌에 지급한다."),
                item(3, "외부 유료 API, 라이선스, 서버, 도메인, 판매자계정, 문자·알림 및 기타 제3자 비용은 계약금액에 포함되지 않으며, 갑의 사전 승인을 받아 갑이 부담한다."),
                item(4, "지급기한이 지난 뒤 을이 3영업일의 상당한 기간을 정하여 이행을 최고하였음에도 지급되지 않으면, 을은 업무와 산출물 인도를 중지할 수 있고 중지 기간만큼 일정은 연장된다."),
            ],
        )
    )
    story.extend(
        article(
            7,
            "인도와 검수",
            [
                item(1, "을은 개발기간 종료일까지 검수 가능한 버전을 제공하고, 갑은 QA 및 검수기간 동안 별지 1의 인수 기준에 따라 확인한다."),
                item(2, "갑의 오류 통지는 재현 단계, 사용 환경, 입력자료, 화면 또는 로그와 기대 결과를 포함하여 서면으로 제출한다. 서로 다른 원인의 요구는 구분하여 제출한다."),
                item(3, "을은 합의된 범위 안의 재현 가능한 오류를 QA 기간 중 보정한다. 기능 추가, 디자인·업무 흐름 변경, 데이터 추가, 외부 API 연동 및 기존 지시의 변경은 검수 보정에 포함되지 않는다."),
                item(4, "2026년 9월 3일까지 중대 오류에 대한 서면 이의가 없거나 갑이 산출물을 실제 영업에 사용한 경우 최종 검수가 완료된 것으로 본다. 경미한 오류는 제9조의 무료 유지보수 기간에 보정할 수 있다."),
            ],
        )
    )
    story.extend(
        article(
            8,
            "QA 기간의 운영",
            [
                item(1, "QA 기간은 2026년 8월 21일부터 2026년 9월 3일까지 2주로 하며, 확정된 기능이 기준 환경에서 정상적으로 동작하는지 검증하는 기간이다."),
                item(2, "오류 수정으로 다른 합의 기능에 회귀 오류가 발생하면 을은 QA 기간 안에 우선 보정한다. 갑은 수정본을 합리적인 기간 내 재확인한다."),
                item(3, "갑의 자료 미제공, 테스트 미수행 또는 피드백 지연으로 확인하지 못한 사항은 을의 납기 지연으로 보지 않는다."),
                item(4, "QA 기간의 목적은 오류 확인과 보정이며 신규 기능 개발, 전면 재설계, 다른 운영환경 지원 또는 제3자 정책 변경 대응을 포함하지 않는다."),
            ],
        )
    )
    story.extend(
        article(
            9,
            "무료 유지보수와 유상 유지보수",
            [
                item(1, "무료 유지보수 기간은 최종 검수 다음 날인 2026년 9월 4일부터 2026년 11월 3일까지 2개월로 한다."),
                item(2, "무료 유지보수는 최종 검수 당시 존재하던 합의 기능에서 추가로 발견된 재현 가능한 오류를 보정하는 것에 한한다. 기능 추가는 무료 유지보수에 포함되지 않는다."),
                item(3, "다음 사유는 무료 유지보수 대상이 아니다: 갑 또는 제3자의 코드·설정 변경, 잘못된 입력·자료, 계정·권한 문제, 서버·네트워크 장애, OS·브라우저·라이브러리 업데이트, 판매채널·외부 API의 정책 또는 사양 변경, 데이터 이전, 성능 개선, 디자인 또는 업무 흐름 변경."),
                item(4, "을은 유지보수 요청 접수 후 원칙적으로 3영업일 이내에 접수 여부와 예상 일정을 회신한다. 완료 시점은 오류의 재현 가능성, 영향도 및 기술적 난이도에 따라 합리적으로 정한다."),
                item(5, "2026년 11월 4일부터 오류 보정, 경미한 업데이트 및 운영 지원은 서로 구분되는 원인 또는 요청 1건당 기본 50,000원(VAT 별도)으로 한다. 갑이 비용을 승인하고 착수금을 지급한 뒤 을이 작업을 시작한다."),
                item(6, "같은 원인으로 여러 화면에 나타난 현상은 1건으로, 하나의 요청에 서로 다른 원인이 있으면 각각 별도 건으로 계산한다. 1건의 작업이 1시간을 초과할 것으로 예상되거나 기능 추가·대규모 업데이트에 해당하면 을은 별도 견적과 일정을 제시한다."),
                item(7, "양 당사자는 민법상 허용되는 범위에서 무상 하자보수 책임의 기간과 범위를 제1항부터 제4항까지로 한정하기로 합의한다. 다만 을이 알고도 고지하지 않은 하자, 고의 또는 중대한 과실에 대한 책임까지 면제하는 것은 아니다."),
            ],
        )
    )
    story.extend(
        article(
            10,
            "변경관리",
            [
                item(1, "갑이 기능, 화면, 데이터, 운영환경 또는 외부 연동의 변경을 요청하면 을은 영향 범위, 추가 대금 및 변경 일정을 제시할 수 있다."),
                item(2, "추가 업무는 양 당사자가 서면으로 범위·대금·일정을 확인한 후 착수한다. 변경합의 전까지 을은 기존 범위대로 수행할 수 있다."),
                item(3, "변경 요청으로 이미 완료된 작업의 재수행이 필요하면 그 비용과 일정은 추가 업무로 본다."),
            ],
        )
    )
    story.extend(
        article(
            11,
            "저작권과 소스코드",
            [
                item(1, "갑이 총 계약금액을 모두 지급하면, 갑의 요구에 맞추어 새로 제작된 최종 산출물의 저작재산권은 갑에게 이전된다. 프로그램의 복제, 배포, 전송, 수정 및 2차적저작물 작성 권한을 포함한다."),
                item(2, "을이 계약 전부터 보유하였거나 본 계약과 무관하게 개발한 기술, 일반화 가능한 모듈, 템플릿, 개발도구, 알고리즘, 노하우 및 라이브러리의 권리는 을에게 남는다. 갑은 최종 산출물의 이용에 필요한 범위에서 이를 계속 사용할 수 있는 비독점적·영구적 이용권을 가진다."),
                item(3, "오픈소스 및 제3자 소프트웨어는 각 라이선스 조건에 따른다. 해당 권리는 갑에게 양도되지 않으며 갑은 고지된 라이선스 의무를 준수한다."),
                item(4, "갑이 제공한 이미지, 상표, 상품정보 및 기타 자료의 권리와 제3자 이용허락 책임은 갑에게 있다."),
                item(5, "소스코드와 인계 문서는 잔금 지급 완료 후 최종본을 인도한다. 을은 갑의 비밀정보를 포함하지 않는 일반적 지식과 경험을 다른 업무에 활용할 수 있다."),
            ],
        )
    )
    story.extend(
        article(
            12,
            "비밀유지와 보안",
            [
                item(1, "각 당사자는 계약 수행 중 알게 된 상대방의 영업·기술·고객·계정 정보를 계약 목적 외에 사용하거나 제3자에게 공개하지 않는다."),
                item(2, "법령 또는 공공기관의 적법한 요구로 공개가 필요한 경우 가능한 범위에서 상대방에게 미리 알리고 공개 범위를 최소화한다."),
                item(3, "일반 비밀유지의무는 계약 종료 후 2년간, 영업비밀에 해당하는 정보에 대한 의무는 그 정보가 영업비밀성을 유지하는 동안 존속한다."),
                item(4, "갑은 실제 운영계정에 대해 최소권한과 별도 테스트 계정을 제공하도록 노력한다. 양 당사자는 전달받은 인증정보를 안전하게 보관하고 목적 달성 후 삭제 또는 반환한다."),
            ],
        )
    )
    story.extend(
        article(
            13,
            "외부 서비스와 운영 책임",
            [
                item(1, "판매채널, OS, 브라우저, Apple Vision, 번역·AI·호스팅·API 등 제3자 서비스의 승인, 가용성, 정책, 가격 또는 사양은 을의 지배 범위 밖에 있다."),
                item(2, "제3자 서비스의 변경으로 수정이 필요한 경우 제9조 및 제10조에 따른 유상 업무로 처리한다. 단, 을이 해당 변경을 알면서 고의로 숨긴 경우는 제외한다."),
                item(3, "갑은 배포 또는 게시 전에 상품명, 가격, 성분, 인증, 표시광고 문구, 번역 및 판매국가별 준수사항을 최종 검토한다. 자동 생성 결과는 검토를 보조하는 초안으로 사용한다."),
                item(4, "갑은 운영자료와 계정에 대해 적절한 백업을 유지한다. 을은 별도 합의가 없는 한 24시간 모니터링이나 운영대행 의무를 부담하지 않는다."),
            ],
        )
    )
    story.extend(
        article(
            14,
            "책임의 제한",
            [
                item(1, "각 당사자는 자신의 귀책사유로 상대방에게 발생한 통상적이고 직접적인 손해를 배상한다."),
                item(2, "을은 특별손해, 간접손해, 영업손실, 기대이익 상실, 데이터 손실 또는 제3자 서비스 중단으로 인한 손해를 배상하지 않는다. 다만 을의 고의 또는 중대한 과실로 인한 경우는 제외한다."),
                item(3, "을의 총 손해배상 책임은 갑이 본 계약에 따라 실제 지급한 총 계약금액을 한도로 한다. 단, 고의 또는 중대한 과실, 비밀유지의무 위반 및 제3자 권리 침해에 대해서는 관계 법령에 따른다."),
                item(4, "갑의 자료 또는 지시, 갑이나 제3자의 변경, 합의되지 않은 환경, 외부 서비스의 장애·정책 변경으로 발생한 문제는 을의 오류 또는 책임으로 보지 않는다."),
            ],
        )
    )
    story.extend(
        article(
            15,
            "업무 중지와 계약 해지",
            [
                item(1, "상대방이 계약상 중대한 의무를 위반한 경우 당사자는 5영업일 이상의 기간을 정하여 서면으로 시정을 요구하고, 그 기간에 시정되지 않으면 계약을 해지할 수 있다."),
                item(2, "갑이 편의상 완료 전에 계약을 종료하려면 을에게 서면 통지하고, 종료일까지 완료된 업무의 비율에 따른 대금과 이미 발생한 취소 불가능한 비용을 지급한다. 이를 정산한 뒤 남은 선금이 있으면 을은 7영업일 이내 반환한다."),
                item(3, "갑의 지급 지연, 자료 미제공 또는 연락 두절이 7일 이상 지속되면 을은 업무를 중지할 수 있다. 14일 이상 지속되고 시정 요구에도 해소되지 않으면 을은 계약을 해지하고 완료분을 정산할 수 있다."),
                item(4, "계약 해지와 관계없이 지급, 비밀유지, 저작권, 책임 제한 및 분쟁해결 조항은 그 성질상 필요한 범위에서 계속 유효하다."),
            ],
        )
    )
    story.extend(
        article(
            16,
            "불가항력",
            [
                P(
                    "천재지변, 전쟁, 정부조치, 대규모 통신장애, 제3자 플랫폼의 전면 중단, 감염병 또는 당사자가 합리적으로 통제할 수 없는 사유로 의무 이행이 지연되면 "
                    "해당 당사자는 그 사실을 알리고 영향을 최소화한다. 그 기간 동안 일정은 합리적으로 연장되며, 당사자의 고의 또는 과실이 없는 한 지연 책임을 부담하지 않는다."
                )
            ],
        )
    )
    story.extend(
        article(
            17,
            "통지, 완전합의 및 분쟁해결",
            [
                item(1, "계약 관련 통지는 계약서의 연락처 또는 당사자가 서면으로 지정한 전자우편·업무 메신저로 한다."),
                item(2, "본 계약과 별지 및 이후의 서면 변경합의는 이 거래에 관한 당사자의 합의를 구성한다. 어느 조항이 무효가 되더라도 나머지 조항은 계속 유효하다."),
                item(3, "본 계약은 대한민국 법령에 따라 해석하고, 분쟁이 발생하면 우선 협의한다. 협의로 해결되지 않는 분쟁의 제1심 전속관할은 서울중앙지방법원으로 한다."),
                item(4, "전자서명 또는 스캔본으로 체결한 계약은 원본과 동일한 효력을 가지며, 각 당사자는 서명된 사본을 보관할 수 있다."),
            ],
        )
    )

    story.extend(
        [
            PageBreak(),
            P("계약 체결 및 서명", annex_title),
            P("본 계약서와 별지 1을 충분히 확인하고 동일한 내용으로 2부를 작성하여 갑과 을이 각 1부씩 보관한다.", annex_subtitle),
            Spacer(1, 5 * mm),
            P("2026년 8월 14일", ParagraphStyle("Date", parent=subtitle, fontName="Nanum-Bold", textColor=NAVY, fontSize=11.5, spaceAfter=12 * mm)),
            info_note("미기재 상태로 서명하지 말 것: 갑의 인적/사업자 정보, 총 계약금액, 양 당사자의 연락처/이메일을 기입하고 각 페이지 또는 전자서명 서비스로 당사자 확인을 남긴다."),
            Spacer(1, 9 * mm),
            signature_table(),
            Spacer(1, 10 * mm),
            P("첨부: 별지 1 과업범위 및 인수기준 1부", note),
            PageBreak(),
            P("별지 1", title_kicker),
            P("과업범위 및 인수기준", annex_title),
            P("본 별지는 계약서 제3조, 제7조 및 제8조의 구체 범위와 검수 기준을 정한다.", annex_subtitle),
            scope_table(),
            Spacer(1, 6 * mm),
            P("1. 기준 환경", article_title),
            item(1, "macOS 14 이상 권장, Node.js 22.13 이상 및 프로젝트가 지정한 로컬 실행환경을 기준으로 한다."),
            item(2, "갑이 다른 OS, 브라우저, 호스팅 또는 모바일 네이티브 앱 지원을 요구하면 별도 변경합의가 필요하다."),
            P("2. 검수용 자료와 절차", article_title),
            item(1, "갑은 개발 착수 후 1영업일 이내 대표 상품 이미지와 기대 출력 예시를 제공한다."),
            item(2, "검수는 합의된 대표 이미지와 별지의 인수 기준으로 수행하며, 새 상품군·새 판매국가·새 언어·새 채널 요구는 기능 추가로 본다."),
            item(3, "오류 보고는 재현 단계와 화면·로그를 포함하고, 을이 동일 환경에서 확인할 수 있어야 한다."),
            P("3. 명시적 제외 범위", article_title),
            item(1, "Qoo10, Shopee, Lazada 또는 기타 판매채널의 실계정 API 승인·연결과 실제 자동 게시"),
            item(2, "주문, 재고, 배송, 반품, 정산, 결제 및 고객관리 기능"),
            item(3, "클라우드 배포, 도메인, 서버 운영, 24시간 모니터링, 보안관제 및 운영대행"),
            item(4, "의약품·의료기기·건강기능식품·화장품 등 규제상품의 적법성 판단, 인증 취득 및 법률 검토"),
            item(5, "외부 API·AI·번역·이미지 생성 서비스의 이용료와 정책 변경에 따른 재개발"),
            P("4. 오류 등급", article_title),
        ]
    )

    defect_rows = [
        [P("등급", table_head), P("기준", table_head), P("검수 처리", table_head)],
        [P("중대", table_small), P("프로그램 실행 불가, 핵심 분석 흐름 전면 중단 또는 산출물 저장 불가", table_small), P("최종 검수 전 우선 보정", table_small)],
        [P("일반", table_small), P("핵심 흐름은 가능하나 특정 입력에서 합의 기능이 재현 가능하게 잘못 동작", table_small), P("QA 기간 또는 합의 일정에 보정", table_small)],
        [P("경미", table_small), P("문구, 정렬, 일부 표시 등 목적 달성에 중대한 영향이 없는 문제", table_small), P("무료 유지보수 기간에 보정 가능", table_small)],
    ]
    defect_table = Table(defect_rows, colWidths=[22 * mm, 100 * mm, CONTENT_W - 122 * mm], repeatRows=1, hAlign="LEFT")
    defect_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GRAY]),
            ]
        )
    )
    story.extend(
        [
            defect_table,
            Spacer(1, 6 * mm),
            info_note("범위 확인: 실 판매채널 API 연동 또는 실제 게시 기능을 이번 3주 계약에 포함하려면, 서명 전에 별도의 기능 목록·계정 조건·추가 대금·일정을 본 별지에 서면으로 추가해야 한다."),
            Spacer(1, 7 * mm),
            P("갑 확인: ____________________ (인)                         을 확인: 김창희 ____________________ (인)", body_left),
        ]
    )
    return story


def payment_schedule_table() -> Table:
    rows = [
        [P("구분", table_head), P("비율", table_head), P("금액", table_head), P("지급 시점", table_head)],
        [P("선금", table_small), P("40%", table_small), P("1,600,000원", table_small), P("계약일인 2026년 8월 15일", table_small)],
        [P("중도금", table_small), P("10%", table_small), P("400,000원", table_small), P("실제 개발 완료 통지일 (예정: 2026년 8월 21일)", table_small)],
        [P("잔금", table_small), P("50%", table_small), P("2,000,000원", table_small), P("모든 QA 완료 통지일 후 2영업일 이내 (예정: 2026년 9월 4일)", table_small)],
    ]
    table = Table(rows, colWidths=[26 * mm, 22 * mm, 36 * mm, CONTENT_W - 84 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 1), (2, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GRAY]),
            ]
        )
    )
    return table


def completion_check_table() -> LongTable:
    rows = [
        [P("확인 항목", table_head), P("개발 완료 확인 방법", table_head)],
        [P("GitHub", table_small), P("갑이 지정된 저장소에 접속하여 소스코드와 실행 안내를 확인함", table_small)],
        [P("Vercel", table_small), P("을이 전달한 웹 주소가 열리고 주요 화면을 사용할 수 있음", table_small)],
        [P("Supabase", table_small), P("검수용 상품정보가 저장되고 다시 조회됨", table_small)],
        [P("Android APK", table_small), P("전달받은 APK가 안드로이드 기기에 설치되고 앱이 실행됨", table_small)],
        [P("로그인", table_small), P("회원가입·로그인·로그아웃이 되고 서로 다른 사용자의 상품 작업과 결과가 구분됨", table_small)],
        [P("상품 설명·링크", table_small), P("사진 아래에 입력한 설명 또는 공개 링크의 상품정보가 분석되고 상세페이지·설정 이미지 제작에 반영됨", table_small)],
        [P("여러 상품 작업", table_small), P("한 상품 처리 중 다른 상품을 접수할 수 있고 최소 2개 상품의 상태와 결과가 서로 구분됨", table_small)],
        [P("스토리보드", table_small), P("상품별 스토리보드를 확인할 수 있고 확정된 구성이 상세페이지와 설정 이미지에 반영됨", table_small)],
        [P("핵심 기능", table_small), P("사진 입력·분석, 이미지·상세페이지 생성, 가격 계산 및 4개 판매채널 등록 흐름을 확인함", table_small)],
        [P("완료 통지", table_small), P("을이 전자우편 또는 업무 메신저로 개발 완료와 확인 방법을 보냄", table_small)],
    ]
    table = LongTable(rows, colWidths=[40 * mm, CONTENT_W - 40 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GRAY]),
            ]
        )
    )
    return table


def build_story_v2() -> list:
    story: list = []
    story.extend(
        [
            Spacer(1, 5 * mm),
            P("SOFTWARE DEVELOPMENT SERVICES", title_kicker),
            P("소프트웨어 개발용역계약서", title),
            P("AI 쇼핑 채널 상품등록 자동화(셀러파일럿)", subtitle),
            HRFlowable(width="100%", thickness=1.1, color=NAVY, spaceBefore=0, spaceAfter=8 * mm),
            key_terms_table(),
            Spacer(1, 7 * mm),
            P(
                "____________________(이하 '갑'이라 한다)과 십일월삼일(대표 김창희, 이하 '을'이라 한다)은 "
                "AI 쇼핑 채널 상품등록 자동화 소프트웨어의 개발, QA 및 유지보수에 관하여 다음과 같이 계약을 체결한다.",
                lead,
            ),
        ]
    )

    story.extend(
        article(
            1,
            "계약 목적",
            [
                P(
                    "을은 이 계약과 별지 1에 적힌 소프트웨어를 개발하여 갑에게 제공하고, "
                    "갑은 정해진 시점에 개발비를 지급한다. 양 당사자는 개발 완료와 QA 완료 여부를 이 계약의 확인 방법에 따라 판단한다."
                )
            ],
        )
    )
    story.extend(
        article(
            2,
            "업무 범위와 제공물",
            [
                item(1, "구체적인 기능과 완료 확인 방법은 별지 1에 따른다."),
                item(2, "을은 Qoo10, Shopee, Lazada, eBay 상품 등록 흐름을 개발한다. 갑이 판매자 계정과 필요한 접속권한을 제때 제공하면 해당 계정으로 연결과 등록을 확인한다."),
                item(3, "을은 소스코드를 GitHub로 공유하고, 웹 서비스는 Vercel로 배포하며, 데이터베이스는 Supabase로 관리한다. 안드로이드 기기에 설치할 수 있는 APK 파일도 제공한다."),
                item(4, "을은 사용자 회원가입·로그인·로그아웃 기능과 로그인 사용자별 상품 작업 목록을 제공한다. 각 사용자는 자신의 상품 작업과 결과만 확인할 수 있도록 구분한다."),
                item(5, "한 상품이 분석 또는 이미지 생성 중이어도 다른 상품을 새로 입력하고 접수할 수 있게 하며, 각 상품의 진행 상태와 결과를 작업 목록에서 따로 확인할 수 있도록 한다."),
                item(6, "상품 사진 아래에는 간단한 상품 설명 또는 공개 링크를 입력할 수 있게 한다. 프로그램은 입력한 설명과 링크에서 확인 가능한 상품정보를 분석하여 상세페이지, 설정 이미지와 스토리보드 제작에 반영한다."),
                item(7, "을은 상세페이지와 설정 이미지 제작 전에 장면 순서, 핵심 문구와 이미지 구성을 확인할 수 있는 상품별 스토리보드를 제공하고, 확정된 스토리보드를 최종 제작물에 반영한다."),
                item(8, "상품정보·이미지·가격·판매문구의 정확성과 판매 가능 여부는 갑이 최종 확인한다. 을은 프로그램이 만든 결과를 갑이 확인할 수 있도록 제공한다."),
                item(9, "새 화면, 새 판매채널, 새로운 업무 흐름 등 별지 1에 없는 기능은 양 당사자가 비용과 일정을 서면으로 합의한 뒤 진행한다."),
            ],
        )
    )
    story.extend(
        article(
            3,
            "기간과 일정",
            [
                item(1, "전체 계약기간은 2026년 8월 15일부터 2026년 9월 4일까지 최대 3주를 예정한다."),
                item(2, "QA를 제외한 개발기간은 2026년 8월 15일부터 8월 21일까지 최대 1주이며, 을은 준비 상황에 따라 이보다 일찍 개발을 완료할 수 있다."),
                item(3, "개발이 예정일보다 일찍 완료되면 완료 통지 다음 날부터 QA를 시작한다. 이에 따라 QA 예정일과 전체 계약 종료일도 같은 만큼 앞당겨질 수 있으며, 최종 QA가 완료된 날을 실제 계약 종료일로 본다."),
                item(4, "QA 기간은 개발 완료 다음 날부터 최대 2주로 하며, 예정기간은 2026년 8월 22일부터 9월 4일까지다. QA도 양 당사자가 모두 완료를 확인하면 예정일보다 일찍 종료할 수 있다."),
                item(5, "갑이 계정, 접속권한, 상품자료 또는 확인 의견을 늦게 제공하면 그만큼 일정이 연장된다. 판매채널의 계정 승인 지연이나 정책 변경도 을의 개발 지연으로 보지 않는다."),
                item(6, "실제 개발 완료일, QA 시작일과 계약 종료일은 을의 완료 통지 및 양 당사자의 전자우편 또는 업무 메신저 기록으로 확인한다."),
            ],
        )
    )
    story.extend(
        article(
            4,
            "개발비와 지급일정",
            [
                item(1, "총 개발비는 금 사백만원정(₩4,000,000, VAT 별도)이다."),
                payment_schedule_table(),
                item(2, "을이 세금계산서를 발행하면 갑은 아래 일정에 따라 우리은행 75115540402101(예금주 김창희) 계좌로 지급한다."),
                item(3, "갑의 새로운 기능 요청이나 서비스 핵심 사용을 막지 않는 일반·경미한 오류는 중도금 또는 잔금 지급을 미루는 사유가 되지 않는다."),
                item(4, "Vercel, Supabase, 판매채널, 도메인 등 외부 서비스에서 유료 요금제가 필요한 경우 그 이용료는 갑이 부담한다."),
                item(5, "지급일이 지난 뒤 을이 3영업일 안에 지급해 달라고 알렸는데도 지급되지 않으면 을은 작업, 배포 또는 인계를 잠시 중지할 수 있으며, 중지된 기간만큼 일정은 연장된다."),
            ],
        )
    )
    story.extend(
        article(
            5,
            "개발 완료와 중도금",
            [
                item(1, "별지 1의 개발 완료 확인 항목을 제공하고 을이 완료 통지를 보내면 1주 개발이 완료된 것으로 본다."),
                item(2, "갑은 완료 통지를 받은 날부터 2영업일 이내에 확인 결과를 한 번에 정리하여 서면으로 알려야 한다. 이 기간 안에 의견이 없으면 개발 완료를 확인한 것으로 본다."),
                item(3, "로그인, 상품 설명·링크 반영, 여러 상품 작업, 스토리보드와 사진 입력부터 결과 생성까지의 흐름은 개발 완료 확인 항목에 포함한다. 다만 일부 문구·표시 또는 특정 입력에서 생기는 문제는 QA 기간에 수정한다."),
                item(4, "중대한 문제가 아닌 수정사항은 바로 이어지는 QA 기간에 고친다. 이 경우에도 400,000원의 중도금은 실제 개발 완료 통지일에 지급하며, 예정 완료일은 2026년 8월 21일이다."),
            ],
        )
    )
    story.extend(
        article(
            6,
            "QA 완료와 잔금",
            [
                item(1, "QA는 이미 합의한 기능의 오류를 찾아 고치는 기간이다. 새로운 기능이나 디자인 변경은 QA에 포함되지 않는다."),
                item(2, "갑은 오류가 생긴 순서, 사용한 자료와 화면을 함께 보내고, 을은 확인 가능한 오류를 QA 기간에 수정한다."),
                item(3, "을은 예정일인 2026년 9월 4일까지 최종본과 QA 완료 통지를 보낸다. 개발 또는 QA가 일찍 끝나면 완료 통지도 그만큼 앞당길 수 있다. 갑은 통지를 받은 날부터 2영업일 이내에 서비스 핵심 사용을 막는 중대한 문제가 있는지 서면으로 알려야 한다."),
                item(4, "이 기간 안에 중대한 문제에 대한 서면 통지가 없거나 갑이 최종본을 영업, 시연, 배포 또는 실제 업무에 사용하면 모든 QA가 완료되고 최종 검수가 끝난 것으로 본다."),
                item(5, "일부 문구, 정렬, 특정 자료에서만 생기는 문제 등 핵심 사용을 막지 않는 오류는 무료 유지보수 기간에 고칠 수 있으며, 잔금 지급을 미루는 사유가 되지 않는다."),
                item(6, "중대한 문제가 확인되면 을은 이를 수정해 다시 완료 통지를 보낸다. 갑은 다시 통지받은 날부터 1영업일 이내에 같은 문제의 수정 여부를 확인한다."),
            ],
        )
    )
    story.extend(
        article(
            7,
            "갑이 제공할 사항",
            [
                item(1, "갑은 개발에 필요한 대표 상품 이미지, 상품정보, 기대 결과와 검수 담당자 1명을 개발 시작 후 1영업일 이내에 정한다."),
                item(2, "갑은 GitHub, Vercel, Supabase와 Qoo10, Shopee, Lazada, eBay 판매자 계정 및 필요한 접속권한을 을의 요청일에 제공한다."),
                item(3, "갑이 판매채널 계정 또는 권한을 제때 제공하지 않으면, 을이 연결 화면과 준비된 코드 및 설정을 제시한 때 해당 부분을 개발 완료로 본다. 실제 계정 확인 일정은 권한 제공 뒤 따로 정한다."),
                item(4, "갑은 스토리보드를 받은 뒤 1영업일 이내에 확인 의견을 한 번에 정리해 보낸다. 확정된 스토리보드의 방향을 나중에 전면 변경하는 요청은 추가 업무로 본다."),
                item(5, "로그인이 필요하거나 접근이 제한된 링크처럼 프로그램이 내용을 확인할 수 없는 경우 갑은 필요한 상품 설명을 직접 입력한다. 접근할 수 없는 링크의 내용을 읽지 못한 것은 을의 오류로 보지 않는다."),
                item(6, "갑이 제공한 자료나 지시로 생긴 문제는 을의 개발 오류로 보지 않는다."),
            ],
        )
    )
    story.extend(
        article(
            8,
            "GitHub·Vercel·Supabase·APK 인계",
            [
                item(1, "을은 개발 완료일에 GitHub 저장소 접근권한을 갑에게 제공하고, QA 종료일까지 최종 소스코드를 올린다."),
                item(2, "웹 서비스는 Vercel 주소로 제공하고, 데이터는 Supabase에 저장·관리한다. 원칙적으로 갑 명의 계정을 사용하며 갑은 필요한 계정과 이용료를 준비한다."),
                item(3, "을은 Supabase의 관리자용 비밀정보가 공개 화면에 드러나지 않도록 하고, 업무에 필요한 사람만 데이터에 접근하도록 설정한다."),
                item(4, "로그인 사용자의 상품 작업, 입력자료와 결과는 사용자별로 구분하여 저장하고, 다른 일반 사용자가 볼 수 없도록 접근권한을 설정한다. 갑이 별도로 지정한 관리자 권한은 예외로 한다."),
                item(5, "을은 QA 확인용 Android APK를 제공한다. 갑은 전달받은 APK를 설치하여 실행 여부를 확인한다."),
                item(6, "총 개발비가 모두 지급되면 을은 갑이 요청하는 범위에서 GitHub 저장소와 Vercel·Supabase 프로젝트의 최종 관리자 권한을 인계한다."),
            ],
        )
    )
    story.extend(
        article(
            9,
            "무료 및 유상 유지보수",
            [
                item(1, "무료 유지보수는 최종 QA 완료 다음 날부터 2개월이다. 예정기간은 2026년 9월 5일부터 2026년 11월 4일까지이며, QA가 일찍 완료되면 시작일과 종료일도 같은 만큼 앞당겨진다."),
                item(2, "무료 유지보수는 계약한 기존 기능에서 나중에 추가로 발견된 오류를 고치는 기간이며, 기능 추가는 포함하지 않는다."),
                item(3, "무료 유지보수 종료 다음 날부터 추가 오류 보정과 경미한 업데이트는 요청 1건당 50,000원(VAT 별도)이다. 예정 유상 전환일은 2026년 11월 5일이며, 같은 원인으로 생긴 문제는 한 건으로 본다."),
                item(4, "새 기능, 큰 화면 변경, 새로운 판매채널 추가 등은 건별 유지보수가 아니라 별도 견적과 일정으로 진행한다."),
                item(5, "갑이나 제3자가 소스코드·설정을 바꾸었거나, 외부 서비스의 정책·요금·연결방법이 바뀌어 생긴 작업은 무료 유지보수에 포함되지 않는다."),
                item(6, "을은 유지보수 요청을 받은 뒤 원칙적으로 3영업일 이내에 접수 여부와 예상 일정을 알려준다."),
            ],
        )
    )
    story.extend(
        article(
            10,
            "기능 변경과 추가 요청",
            [
                item(1, "갑이 별지 1에 없는 기능을 요청하면 을은 추가 비용과 일정을 먼저 알려준다."),
                item(2, "양 당사자가 전자우편 또는 업무 메신저로 범위, 비용과 일정을 확인한 뒤 추가 작업을 시작한다."),
                item(3, "추가 요청 때문에 이미 끝난 작업을 다시 해야 하는 경우 그 작업도 추가 비용과 일정에 포함한다."),
            ],
        )
    )
    story.extend(
        article(
            11,
            "소스코드와 저작권",
            [
                item(1, "갑이 총 개발비를 모두 지급하면 갑의 요청에 맞추어 새로 만든 최종 소스코드와 결과물의 저작재산권은 갑에게 이전된다."),
                item(2, "을이 이 계약 전부터 가지고 있던 개발도구, 공통 모듈, 템플릿과 개발 경험은 을에게 남는다. 갑은 최종 프로그램을 운영하는 데 필요한 범위에서 이를 계속 사용할 수 있다."),
                item(3, "오픈소스와 외부 프로그램은 각 사용조건에 따른다."),
                item(4, "갑이 제공한 이미지, 상표와 상품정보를 사용할 권리가 있는지는 갑이 확인한다."),
            ],
        )
    )
    story.extend(
        article(
            12,
            "비밀유지와 보안",
            [
                item(1, "양 당사자는 계약 중 알게 된 상대방의 영업정보, 기술정보, 고객정보와 계정정보를 이 업무 외의 목적으로 사용하거나 다른 사람에게 공개하지 않는다."),
                item(2, "계정과 비밀번호는 필요한 범위에서만 공유하고, 업무가 끝나면 상대방의 요청에 따라 반환하거나 삭제한다."),
                item(3, "일반 비밀유지의무는 계약 종료 후 2년간 유지되며, 법에서 영업비밀로 보호되는 정보는 그 보호기간 동안 유지된다."),
            ],
        )
    )
    story.extend(
        article(
            13,
            "계약 중지·종료와 책임",
            [
                item(1, "상대방이 계약의 중요한 약속을 지키지 않으면 5영업일 이상의 기간을 정해 서면으로 시정을 요청할 수 있고, 그 기간 안에 고치지 않으면 계약을 종료할 수 있다."),
                item(2, "갑이 개발 도중 계약을 종료하면 종료일까지 끝난 작업의 비율에 해당하는 금액과 이미 발생한 외부 비용을 지급한다."),
                item(3, "각 당사자는 자신의 잘못으로 상대방에게 직접 생긴 통상적인 손해를 배상한다. 을의 전체 배상한도는 갑이 실제 지급한 총 개발비로 한다. 다만 고의 또는 중대한 과실은 관계 법령에 따른다."),
                item(4, "판매채널, Vercel, Supabase 등 외부 서비스의 장애·승인 지연·정책 변경과 갑이 제공한 자료 또는 변경으로 생긴 손해는 을의 책임으로 보지 않는다."),
            ],
        )
    )
    story.extend(
        article(
            14,
            "통지와 분쟁 해결",
            [
                item(1, "계약 관련 통지는 계약서에 적은 전자우편 또는 양 당사자가 사용하는 업무 메신저로 한다."),
                item(2, "이 계약과 별지 1, 이후의 서면 변경합의가 양 당사자의 전체 합의다."),
                item(3, "분쟁이 생기면 먼저 협의하고, 해결되지 않으면 민사소송법에 따른 관할법원에서 해결한다."),
                item(4, "전자서명이나 스캔본도 원본과 같은 효력이 있다."),
            ],
        )
    )

    story.extend(
        [
            PageBreak(),
            P("계약 체결 및 서명", annex_title),
            P("본 계약서와 별지 1을 확인하고 동일한 내용으로 2부를 작성하여 갑과 을이 각 1부씩 보관한다.", annex_subtitle),
            Spacer(1, 5 * mm),
            P("2026년 8월 15일", ParagraphStyle("DateV2", parent=subtitle, fontName="Nanum-Bold", textColor=NAVY, fontSize=11.5, spaceAfter=14 * mm)),
            signature_table(),
            Spacer(1, 10 * mm),
            P("첨부: 별지 1 과업범위 및 완료 확인기준 1부", note),
            PageBreak(),
            P("별지 1", title_kicker),
            P("과업범위 및 완료 확인기준", annex_title),
            P("이 별지는 제공할 기능과 개발 완료·QA 완료를 확인하는 간단한 기준을 정한다.", annex_subtitle),
            scope_table(),
            Spacer(1, 7 * mm),
            P("1. 개발 완료 확인", article_title),
            completion_check_table(),
            Spacer(1, 5 * mm),
            item(1, "을이 위 항목과 확인 방법을 전자우편 또는 업무 메신저로 보내면 개발 완료 통지가 된다."),
            item(2, "갑은 2영업일 이내에 확인 의견을 한 번에 정리해 보내며, 답이 없으면 개발 완료로 본다."),
            item(3, "갑이 판매자 계정이나 접속권한을 제공하지 않아 실제 연결을 확인할 수 없는 경우, 준비된 연결 화면·코드·설정을 확인하면 개발 완료로 본다."),
            item(4, "스토리보드 확인 의견은 갑이 한 번에 정리하여 보내며, 확정된 스토리보드의 전면 변경은 추가 요청으로 본다."),
            P("2. QA와 최종 완료 확인", article_title),
        ]
    )

    qa_rows = [
        [P("구분", table_head), P("쉽게 보는 기준", table_head), P("대금 지급과의 관계", table_head)],
        [P("중대한 문제", table_small), P("전체 사용자가 로그인할 수 없거나 앱·웹이 전혀 실행되지 않거나 사진 입력부터 결과 생성까지 핵심 흐름 전체를 사용할 수 없음", table_small), P("을이 우선 수정하고 다시 완료 통지", table_small)],
        [P("일반 오류", table_small), P("주요 사용은 가능하지만 특정 자료나 일부 기능에서 잘못된 결과가 재현됨", table_small), P("QA 또는 무료 유지보수 중 수정하며 잔금은 예정대로 지급", table_small)],
        [P("경미한 오류", table_small), P("문구, 정렬, 일부 표시처럼 서비스 핵심 사용을 막지 않는 문제", table_small), P("무료 유지보수 중 수정 가능하며 잔금은 예정대로 지급", table_small)],
        [P("기능 추가", table_small), P("새 화면, 새 채널, 새 업무 흐름 또는 합의한 내용의 변경", table_small), P("별도 비용과 일정 합의", table_small)],
    ]
    qa_table = Table(qa_rows, colWidths=[28 * mm, 92 * mm, CONTENT_W - 120 * mm], repeatRows=1, hAlign="LEFT")
    qa_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GRAY]),
            ]
        )
    )
    story.extend(
        [
            qa_table,
            Spacer(1, 6 * mm),
            info_note("최종 QA 완료 통지 후 2영업일 안에 중대한 문제에 대한 서면 의견이 없거나 갑이 프로그램을 실제 업무에 사용하면 최종 검수가 완료된 것으로 본다."),
            Spacer(1, 7 * mm),
            P("갑 확인: ____________________ (인)                         을 확인: 김창희 ____________________ (인)", body_left),
        ]
    )
    return story


def build_pdf() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = ContractDocTemplate(str(OUTPUT))
    doc.build(build_story_v2(), canvasmaker=NumberedCanvas)


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
