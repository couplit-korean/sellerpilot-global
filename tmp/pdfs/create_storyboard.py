from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path("/Users/kimchangheemac/Documents/ChatGPT/ai 쇼핑 채널 등록 자동화")
CAPTURE = ROOT / "tmp/pdfs/storyboard-captures"
OUTPUT_DIR = ROOT / "output/pdf"
OUTPUT = OUTPUT_DIR / "SellerPilot_UIUX_Storyboard_2026-08.pdf"

PAGE_W, PAGE_H = landscape(A4)

INK = HexColor("#17211F")
DEEP = HexColor("#0D352F")
DEEP_2 = HexColor("#143F38")
TEAL = HexColor("#087466")
MINT = HexColor("#E3F1ED")
ORANGE = HexColor("#D96743")
ORANGE_SOFT = HexColor("#F7E5DD")
PAPER = HexColor("#F2F1EC")
WHITE = HexColor("#FFFEFA")
LINE = HexColor("#D7DAD2")
MUTED = HexColor("#69736F")
PALE = HexColor("#F7F6F1")
YELLOW = HexColor("#F4DDA6")
RED = HexColor("#C94D45")
BLUE = HexColor("#326B8C")

FONT_REGULAR = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
FONT_FALLBACK = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
FONT_MONO = "/System/Library/Fonts/SFNSMono.ttf"

pdfmetrics.registerFont(TTFont("SP-KR", FONT_REGULAR if os.path.exists(FONT_REGULAR) else FONT_FALLBACK))
pdfmetrics.registerFont(TTFont("SP-Mono", FONT_MONO))


def draw_text(c: canvas.Canvas, text: str, x: float, y: float, size: float = 10,
              color=INK, font: str = "SP-KR", max_width: float | None = None,
              leading: float | None = None) -> float:
    c.setFont(font, size)
    c.setFillColor(color)
    if not max_width:
        c.drawString(x, y, text)
        return y
    leading = leading or size * 1.45
    lines: list[str] = []
    for paragraph in str(text).split("\n"):
        current = ""
        for ch in paragraph:
            candidate = current + ch
            if current and pdfmetrics.stringWidth(candidate, font, size) > max_width:
                lines.append(current.rstrip())
                current = ch.lstrip()
            else:
                current = candidate
        lines.append(current)
    cursor = y
    for line in lines:
        c.drawString(x, cursor, line)
        cursor -= leading
    return cursor


def draw_bullet_list(c: canvas.Canvas, items: Iterable[str], x: float, y: float,
                     width: float, size: float = 9.2, gap: float = 7,
                     marker_color=ORANGE) -> float:
    cursor = y
    for item in items:
        c.setFillColor(marker_color)
        c.roundRect(x, cursor - 4, 4, 4, 1, fill=1, stroke=0)
        cursor = draw_text(c, item, x + 11, cursor, size=size, color=INK,
                           max_width=width - 11, leading=size * 1.42) - gap
    return cursor


def pill(c: canvas.Canvas, text: str, x: float, y: float, bg=MINT, fg=TEAL,
         size: float = 8.2, pad_x: float = 8, h: float = 20) -> float:
    w = pdfmetrics.stringWidth(text, "SP-KR", size) + pad_x * 2
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, 3, fill=1, stroke=0)
    draw_text(c, text, x + pad_x, y + 6, size=size, color=fg)
    return w


def page_base(c: canvas.Canvas, number: int, section: str, dark: bool = False) -> None:
    c.setFillColor(DEEP if dark else PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    if dark:
        c.setStrokeColor(Color(1, 1, 1, alpha=.09))
        for y in range(52, int(PAGE_H), 44):
            c.line(0, y, PAGE_W, y)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 7, PAGE_W, 7, fill=1, stroke=0)
    draw_text(c, "SELLERPILOT / UI·UX STORYBOARD", 34, 24, 7.6,
              color=HexColor("#AAB6B2") if dark else MUTED, font="SP-Mono")
    c.setFont("SP-Mono", 7.6)
    c.setFillColor(HexColor("#AAB6B2") if dark else MUTED)
    c.drawRightString(PAGE_W - 34, 24, f"{section.upper()}   {number:02d}")


def title_block(c: canvas.Canvas, kicker: str, title: str, description: str,
                x: float = 34, y: float = PAGE_H - 42, width: float = 760) -> float:
    draw_text(c, kicker.upper(), x, y, 8.2, TEAL, "SP-Mono")
    draw_text(c, title, x, y - 29, 23, INK, max_width=width, leading=28)
    return draw_text(c, description, x, y - 58, 9.5, MUTED, max_width=width, leading=14)


def image_fit(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float,
              border: bool = True, bg=WHITE) -> tuple[float, float, float, float]:
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, 5, fill=1, stroke=0)
    with Image.open(path) as im:
        iw, ih = im.size
    ratio = min(w / iw, h / ih)
    dw, dh = iw * ratio, ih * ratio
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    c.drawImage(ImageReader(str(path)), dx, dy, dw, dh, preserveAspectRatio=True, mask="auto")
    if border:
        c.setLineWidth(.8)
        c.setStrokeColor(LINE)
        c.roundRect(x, y, w, h, 5, fill=0, stroke=1)
    return dx, dy, dw, dh


def marker(c: canvas.Canvas, n: int, x: float, y: float) -> None:
    c.setFillColor(ORANGE)
    c.circle(x, y, 9, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("SP-Mono", 7.5)
    c.drawCentredString(x, y - 2.7, str(n))


def info_card(c: canvas.Canvas, x: float, y: float, w: float, h: float,
              label: str, title: str, lines: Sequence[str], tone=MINT, accent=TEAL) -> None:
    c.setFillColor(WHITE)
    c.roundRect(x, y, w, h, 5, fill=1, stroke=0)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, w, h, 5, fill=0, stroke=1)
    c.setFillColor(accent)
    c.rect(x, y, 4, h, fill=1, stroke=0)
    pill(c, label, x + 14, y + h - 31, bg=tone, fg=accent, size=7.5, h=18)
    draw_text(c, title, x + 14, y + h - 52, 12.5, INK, max_width=w - 28, leading=15)
    draw_bullet_list(c, lines, x + 14, y + h - 80, w - 28, size=8.5, gap=5, marker_color=accent)


def draw_scene(c: canvas.Canvas, page_num: int, scene_no: str, title: str,
               subtitle: str, image: str, purpose: str,
               flow: Sequence[str], actions: Sequence[str], states: Sequence[str],
               callouts: Sequence[tuple[int, float, float]] = ()) -> None:
    page_base(c, page_num, f"SCENE {scene_no}")
    title_block(c, f"SCENE {scene_no}", title, subtitle)
    sx, sy, sw, sh = 34, 116, 536, 335
    dx, dy, dw, dh = image_fit(c, CAPTURE / image, sx, sy, sw, sh)
    for n, rx, ry in callouts:
        marker(c, n, dx + dw * rx, dy + dh * ry)
    rx, rw = 590, PAGE_W - 624
    draw_text(c, "화면 목적", rx, 450, 8.2, TEAL)
    draw_text(c, purpose, rx, 429, 10.8, INK, max_width=rw, leading=15)
    draw_text(c, "핵심 흐름", rx, 380, 8.2, TEAL)
    cursor = draw_bullet_list(c, flow, rx, 358, rw, 8.8, 5)
    draw_text(c, "주요 동작", rx, cursor - 2, 8.2, TEAL)
    cursor = draw_bullet_list(c, actions, rx, cursor - 24, rw, 8.8, 5, TEAL)
    draw_text(c, "상태·예외", rx, cursor - 2, 8.2, TEAL)
    draw_bullet_list(c, states, rx, cursor - 24, rw, 8.8, 5, RED)
    c.showPage()


def arrow(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float, color=LINE) -> None:
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.5)
    c.line(x1, y1, x2, y2)
    if abs(x2 - x1) > abs(y2 - y1):
        direction = 1 if x2 > x1 else -1
        c.line(x2, y2, x2 - 6 * direction, y2 + 4)
        c.line(x2, y2, x2 - 6 * direction, y2 - 4)
    else:
        direction = 1 if y2 > y1 else -1
        c.line(x2, y2, x2 - 4, y2 - 6 * direction)
        c.line(x2, y2, x2 + 4, y2 - 6 * direction)


def flow_box(c: canvas.Canvas, x: float, y: float, w: float, h: float,
             number: str, title: str, subtitle: str, accent=TEAL, fill=WHITE) -> None:
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, 5, fill=1, stroke=0)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, w, h, 5, fill=0, stroke=1)
    c.setFillColor(accent)
    c.rect(x, y + h - 5, w, 5, fill=1, stroke=0)
    draw_text(c, number, x + 13, y + h - 24, 7.5, accent, "SP-Mono")
    draw_text(c, title, x + 13, y + h - 45, 11.2, INK, max_width=w - 26, leading=14)
    draw_text(c, subtitle, x + 13, y + 20, 7.8, MUTED, max_width=w - 26, leading=11)


def build_pdf() -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("SellerPilot UI/UX Storyboard")
    c.setAuthor("SellerPilot")
    c.setSubject("Current design storyboard, August 2026")

    # 01 Cover
    page_base(c, 1, "COVER", dark=True)
    draw_text(c, "CURRENT DESIGN · PRODUCT STORYBOARD", 48, PAGE_H - 65, 8.5,
              color=HexColor("#AFC8C2"), font="SP-Mono")
    draw_text(c, "SellerPilot", 48, PAGE_H - 121, 38, white)
    draw_text(c, "멀티채널 커머스 운영센터\nUI·UX 스토리보드", 48, PAGE_H - 168,
              25, white, max_width=340, leading=34)
    draw_text(c, "로그인부터 상품 등록, AI 디자인, 판매, 주문, CS까지\n현재 배포 디자인을 기준으로 정리한 화면·기능 명세", 48, PAGE_H - 252,
              11, HexColor("#C5D5D1"), max_width=350, leading=17)
    x_cursor = 48
    for label in ["7 운영 채널", "2 준비 채널", "PC·태블릿·모바일", "샘플 데이터"]:
        x_cursor += pill(c, label, x_cursor, 158, bg=DEEP_2, fg=HexColor("#D7E7E3"), size=8.2, h=22) + 7
    draw_text(c, "VERSION", 48, 111, 7.3, HexColor("#89A39D"), "SP-Mono")
    draw_text(c, "2026.08 / CURRENT PRODUCTION", 48, 91, 9.5, white, "SP-Mono")
    image_fit(c, CAPTURE / "01-dashboard-desktop.png", 444, 101, 352, 337, border=False, bg=DEEP_2)
    c.setStrokeColor(ORANGE)
    c.setLineWidth(2)
    c.roundRect(438, 95, 364, 349, 7, fill=0, stroke=1)
    url = "https://sellerpilot-global.vercel.app/"
    draw_text(c, url, 444, 73, 8, HexColor("#BFD2CD"), "SP-Mono")
    c.linkURL(url, (444, 66, 740, 82), relative=0)
    c.showPage()

    # 02 Product/design overview
    page_base(c, 2, "PRODUCT FRAME")
    title_block(c, "01 PRODUCT FRAME", "AI 툴이 아니라, 운영자가 매일 쓰는 커머스 데스크",
                "한 번 등록한 상품을 여러 채널에 배포하고 판매·주문·CS를 같은 맥락에서 관리하는 것이 제품의 중심입니다.")
    info_card(c, 34, 272, 244, 174, "PRODUCT GOAL", "운영 복잡도를 한 화면으로",
              ["채널별 데이터를 총괄 화면에서 비교", "상품 등록·번역·디자인 작업 자동화", "등록 실패와 CS 지연을 즉시 식별"])
    info_card(c, 296, 272, 244, 174, "PRIMARY USER", "멀티채널 운영 관리자",
              ["국내외 마켓을 동시에 운영", "상품·주문·문의 상태를 빠르게 판단", "반복 입력보다 검수와 의사결정에 집중"], tone=ORANGE_SOFT, accent=ORANGE)
    info_card(c, 558, 272, 250, 174, "DESIGN PRINCIPLE", "Data-first operations desk",
              ["IBM Plex Sans KR 기반 정보 계층", "잉크 네이비·청록·오렌지 포인트", "낮은 곡률·얕은 그림자·높은 정보 밀도"], tone=HexColor("#E8EDF0"), accent=BLUE)
    draw_text(c, "CHANNEL COVERAGE", 34, 241, 8.2, TEAL, "SP-Mono")
    active = ["Qoo10", "Shopee", "Lazada", "쿠팡", "11번가", "스마트스토어", "eBay"]
    planned = ["Alibaba.com", "1688.com"]
    x = 34
    for label in active:
        x += pill(c, label, x, 202, bg=MINT, fg=TEAL, size=8.5, h=24) + 7
    x = 34
    for label in planned:
        x += pill(c, f"{label} · 준비중", x, 167, bg=ORANGE_SOFT, fg=HexColor("#9C4C32"), size=8.5, h=24) + 7
    draw_text(c, "상태 기준", 565, 208, 8, MUTED)
    draw_text(c, "운영 채널은 등록·통계·채널 페이지 활성", 565, 190, 9, INK)
    draw_text(c, "준비 채널은 노출하되 선택·이동 비활성", 565, 171, 9, INK)
    c.showPage()

    # 03 Information architecture
    page_base(c, 3, "INFORMATION ARCHITECTURE")
    title_block(c, "02 INFORMATION ARCHITECTURE", "로그인 이후 모든 업무가 통합 대시보드에서 갈라집니다",
                "사용자는 총괄 상태를 먼저 파악한 뒤 상품, 등록, 마진, 주문, CS 또는 개별 채널로 이동합니다.")
    flow_box(c, 34, 342, 136, 78, "00", "로그인", "ID·PW 입력\n인증 후 진입", ORANGE, ORANGE_SOFT)
    arrow(c, 174, 381, 207, 381, ORANGE)
    flow_box(c, 211, 342, 160, 78, "01", "통합 대시보드", "매출·TOP 10·환율\n등록·CS·알림", TEAL, MINT)
    branches = [
        (34, 194, "02", "상품 관리", "재고·등록 상태·성과"),
        (190, 194, "03", "상품 등록", "사진·설명·링크·AI"),
        (346, 194, "04", "마진 계산", "7개 채널 손익 비교"),
        (502, 194, "05", "주문·판매", "주문·배송 일괄 처리"),
        (658, 194, "06", "CS 통합함", "번역·답변·고객 정보"),
    ]
    for bx, by, no, name, sub in branches:
        flow_box(c, bx, by, 140, 83, no, name, sub)
        arrow(c, 291, 342, bx + 70, by + 87)
    draw_text(c, "CHANNEL DETAIL", 404, 399, 8.2, TEAL, "SP-Mono")
    flow_box(c, 404, 314, 188, 74, "07", "7개 판매 채널", "채널별 매출·상품·주문·CS")
    flow_box(c, 612, 314, 196, 74, "08", "Alibaba · 1688", "준비중 · 비활성 상태", ORANGE, ORANGE_SOFT)
    arrow(c, 371, 381, 400, 351)
    arrow(c, 596, 351, 608, 351, ORANGE)
    draw_text(c, "GLOBAL ACTIONS", 34, 152, 8.2, TEAL, "SP-Mono")
    draw_bullet_list(c, ["통합 검색: 상품·주문·CS를 메뉴 이동 없이 탐색", "알림: 등록 실패·재고 부족·미답변 CS 확인", "반응형 내비게이션: 태블릿·모바일에서는 드로어로 전환"],
                     34, 126, 760, 9.3, 7)
    c.showPage()

    draw_scene(c, 4, "01", "운영센터 로그인", "관리자 인증을 통과한 사용자만 통합 운영 화면에 접근합니다.",
               "00-login.png", "서비스 가치와 연결 채널을 확인하고 관리자 계정으로 진입하는 첫 화면",
               ["아이디 입력", "비밀번호 입력·표시 전환", "대시보드 접속"],
               ["로그인 상태 유지", "비밀번호 표시 전환", "비밀번호 찾기·지원팀 문의"],
               ["필수값 누락 시 오류 메시지", "인증 성공 시 통합 대시보드로 전환"],
               [(1, .12, .71), (2, .72, .54), (3, .78, .34)])

    draw_scene(c, 5, "02", "통합 대시보드", "한 달의 핵심 성과와 지금 처리해야 할 업무를 한 화면에서 판단합니다.",
               "01-dashboard-desktop.png", "모든 판매 채널의 오늘과 최근 30일 성과를 총괄하는 기본 업무 화면",
               ["실시간 환율·기간 선택", "매출·주문·등록·CS 핵심 지표", "이번 달 판매 TOP 10 확인"],
               ["매출 리포트·전체 상품으로 이동", "채널 운영 현황 선택", "등록·출고·AI 답변 빠른 실행"],
               ["샘플 데이터 기준일 표시", "등록 실패·재고 부족·미답변 CS 경고"],
               [(1, .49, .84), (2, .38, .70), (3, .84, .48)])

    draw_scene(c, 6, "03", "상품 관리", "전체 상품의 채널 등록 상태와 재고·판매 성과를 비교합니다.",
               "02-products.png", "여러 마켓에 흩어진 상품을 하나의 기준 상품 목록으로 관리",
               ["상품명·SKU 검색", "채널·상태 필터", "판매량·재고·마진 비교"],
               ["새 상품 등록으로 이동", "상품별 상세 작업 메뉴", "페이지 이동·다중 선택"],
               ["판매중·대기·품절 상태 구분", "저재고 수치는 경고 색상으로 강조"],
               [(1, .36, .82), (2, .49, .67), (3, .50, .42)])

    draw_scene(c, 7, "04", "상품 등록 센터", "대표사진·옵션사진·설명·링크를 함께 분석해 여러 채널 등록 자료를 만듭니다.",
               "03-publishing.png", "상품 자료를 한 번 입력해 7개 운영 채널용 등록 정보로 변환",
               ["대표사진 1장 필수", "앞·뒤·양옆·상단·라벨 등 옵션사진", "간략 설명과 상품 링크 입력"],
               ["활성 채널 선택", "OCR·번역·가격·카테고리 자동 분석", "썸네일·상세페이지 생성 및 검수"],
               ["Alibaba·1688은 준비중·선택 불가", "대표사진 없으면 분석 시작 차단"],
               [(1, .43, .71), (2, .83, .56), (3, .47, .31)])

    # 08 AI workflow diagram
    page_base(c, 8, "AI GENERATION FLOW")
    title_block(c, "SCENE 05", "사진 한 장에서 채널용 썸네일과 상세페이지까지",
                "AI는 초안을 만들고 운영자는 상품 사실과 채널 정책을 검수한 뒤 발행합니다.")
    steps = [
        (34, "01", "상품 자료", "대표사진 필수\n옵션사진 다중"),
        (167, "02", "분석 컨텍스트", "상품 설명\n원본 링크"),
        (300, "03", "AI 분석", "OCR·특징\n카테고리·번역"),
        (433, "04", "디자인 생성", "썸네일\n상세 블록"),
        (566, "05", "운영자 검수", "사실·문구\n정책·가격"),
        (699, "06", "채널 발행", "7개 채널\n등록 큐"),
    ]
    for i, (x, no, name, sub) in enumerate(steps):
        box_x = x
        flow_box(c, box_x, 300, 110, 102, no, name, sub, ORANGE if i in (0, 4) else TEAL,
                 ORANGE_SOFT if i in (0, 4) else WHITE)
        if i < len(steps) - 1 and box_x < 698:
            arrow(c, box_x + 113, 351, box_x + 137, 351, TEAL)
    info_card(c, 34, 125, 238, 130, "INPUT RULE", "이미지 구성",
              ["대표사진: 정확히 1장 필수", "옵션·추가 사진: 다중 첨부", "설명·링크: 분석 프롬프트에 반영"])
    info_card(c, 290, 125, 238, 130, "OUTPUT", "생성 결과",
              ["채널 비율별 썸네일", "모바일 우선 상세페이지", "제품명·특징·CTA 구성"], tone=HexColor("#E8EDF0"), accent=BLUE)
    info_card(c, 546, 125, 262, 130, "HUMAN REVIEW", "자동 발행 전 확인",
              ["이미지 라벨과 생성 문구 일치", "과장 표현·법적 고지 검토", "판매가·재고·채널 정책 확인"], tone=ORANGE_SOFT, accent=ORANGE)
    c.showPage()

    draw_scene(c, 9, "06", "마진 계산", "원가와 채널 비용을 반영해 팔아도 남는 가격을 비교합니다.",
               "04-margin.png", "7개 활성 채널의 수수료·환율·배송비를 반영한 가격 의사결정 화면",
               ["계산 상품 선택", "원가·배송·광고·반품 비용 입력", "채널별 순이익·마진율 비교"],
               ["목표 마진 판매가 계산", "설정값 복원", "계산 결과 저장"],
               ["마진 부족 시 경고 상태", "Alibaba·1688은 계산 대상에서 제외"],
               [(1, .45, .75), (2, .45, .46), (3, .80, .47)])

    draw_scene(c, 10, "07", "주문·판매", "전체 채널의 주문, 결제, 배송 흐름을 일괄 처리합니다.",
               "05-orders.png", "채널별 주문을 한 목록으로 모아 출고 우선순위와 상태를 관리",
               ["주문 상태 탭 선택", "주문번호·구매자·상품 검색", "결제·출고·배송 상태 확인"],
               ["다중 선택 후 일괄 처리", "채널·상태 필터", "주문 상세 열기"],
               ["출고 지연·취소·환불 상태 구분", "채널별 주문 식별 마크 유지"],
               [(1, .45, .78), (2, .46, .62), (3, .57, .36)])

    draw_scene(c, 11, "08", "CS 통합함", "언어와 채널이 달라도 한 상담함에서 고객 문의에 답변합니다.",
               "06-cs.png", "미답변 문의를 우선 처리하고 주문·고객 정보를 대화 맥락과 함께 제공",
               ["문의 목록에서 우선순위 선택", "번역된 대화 확인", "주문·고객 정보 동시 조회"],
               ["AI 답변 초안", "템플릿·첨부·번역", "답변 전송"],
               ["긴급·미답변 상태 강조", "전송 전 운영자 최종 검수"],
               [(1, .32, .60), (2, .58, .51), (3, .84, .43)])

    draw_scene(c, 12, "09", "채널별 운영 페이지", "개별 스토어의 매출·상품·주문·CS 건강도를 집중 확인합니다.",
               "07-channel.png", "총괄 화면에서 발견한 이슈를 특정 채널 단위로 좁혀 진단",
               ["채널 매출·주문 추이", "등록 상품과 주문 상태", "운영 건강도·동기화 상태"],
               ["상품 등록·주문 화면으로 이동", "기간 변경", "채널별 상세 목록 확인"],
               ["7개 채널만 활성", "Alibaba·1688 메뉴는 준비중·이동 불가"],
               [(1, .33, .78), (2, .50, .54), (3, .82, .42)])

    # 15 Responsive
    page_base(c, 13, "RESPONSIVE")
    title_block(c, "03 RESPONSIVE SYSTEM", "같은 업무 흐름을 화면 크기에 맞게 재배치합니다",
                "PC는 비교와 동시 확인, 태블릿은 집중 작업, 모바일은 핵심 지표와 빠른 실행을 우선합니다.")
    image_fit(c, CAPTURE / "01-dashboard-desktop.png", 34, 211, 400, 250)
    image_fit(c, CAPTURE / "10-dashboard-tablet.png", 451, 211, 236, 250)
    image_fit(c, CAPTURE / "09-dashboard-mobile.png", 704, 211, 104, 250)
    pill(c, "PC · 1440", 34, 178, bg=MINT, fg=TEAL, size=8, h=21)
    pill(c, "TABLET · 1024", 451, 178, bg=HexColor("#E8EDF0"), fg=BLUE, size=8, h=21)
    pill(c, "MOBILE · 390", 704, 178, bg=ORANGE_SOFT, fg=ORANGE, size=8, h=21)
    draw_text(c, "고정 사이드바 · 4열 KPI · 비교 중심", 34, 148, 8.8, INK)
    draw_text(c, "드로어 메뉴 · 2열 KPI · 세로 재배치", 451, 148, 8.8, INK)
    draw_text(c, "터치 우선 · 단일/2열 · 핵심 정보 축약", 704, 148, 8.8, INK, max_width=104, leading=12)
    draw_bullet_list(c, ["900px 이하: 사이드바를 메뉴 드로어로 전환", "720px 이하: 툴바·필터·작업 패널을 세로 배치", "480px 이하: KPI를 단일 열로 전환하고 비핵심 보조정보 축약"],
                     34, 104, 760, 9, 5)
    c.showPage()

    # 16 States and data handoff
    page_base(c, 14, "STATES & HANDOFF")
    title_block(c, "04 STATES & DATA HANDOFF", "샘플 데이터에서 실제 운영 데이터로 교체할 때의 기준",
                "현재 화면 구조와 상태 표현을 유지하고 API·DB 값만 연결하면 되도록 화면 계약을 명확히 합니다.")
    info_card(c, 34, 282, 244, 166, "STATE", "필수 화면 상태",
              ["로딩: 스켈레톤 또는 진행률", "빈 상태: 다음 행동 제시", "오류: 원인·재시도·지원 경로", "권한 없음: 접근 범위 안내"])
    info_card(c, 296, 282, 244, 166, "DATA", "실데이터 연결 항목",
              ["채널 OAuth·API 동기화", "상품·재고·주문·CS 스키마", "환율·수수료·배송비", "AI 생성 이력·비용·결과 URL"], tone=HexColor("#E8EDF0"), accent=BLUE)
    info_card(c, 558, 282, 250, 166, "CONTROL", "운영 안전장치",
              ["AI 생성물 사람 검수", "채널 발행 전 미리보기", "실패 재처리·감사 로그", "개인정보·상품정보 권한 분리"], tone=ORANGE_SOFT, accent=ORANGE)
    draw_text(c, "ACCEPTANCE CHECK", 34, 244, 8.2, TEAL, "SP-Mono")
    checks = [
        "로그인 성공 후 대시보드 접근 / 실패 시 명확한 오류",
        "대표사진 없는 상품은 분석·발행 불가",
        "Alibaba·1688은 모든 선택 지점에서 비활성",
        "매출 TOP 10은 최근 30일 기준으로 정렬",
        "모바일 390px에서 가로 넘침 없이 핵심 업무 수행",
        "AI 썸네일·상세페이지 결과에 고유 URL과 생성 이력 부여",
    ]
    left = checks[:3]
    right = checks[3:]
    draw_bullet_list(c, left, 34, 216, 360, 9.2, 8, TEAL)
    draw_bullet_list(c, right, 430, 216, 378, 9.2, 8, TEAL)
    c.setFillColor(DEEP)
    c.roundRect(34, 65, 774, 48, 4, fill=1, stroke=0)
    draw_text(c, "NEXT", 49, 92, 7.5, HexColor("#9BB7B0"), "SP-Mono")
    draw_text(c, "실데이터 API 계약 → 인증·권한 → 저장소 → 채널 연동 → 운영 로그 순으로 연결", 105, 88, 10.2, white)
    c.showPage()

    c.save()
    return OUTPUT


if __name__ == "__main__":
    result = build_pdf()
    print(result)
