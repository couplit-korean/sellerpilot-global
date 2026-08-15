from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageOps, ImageDraw
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path("/Users/kimchangheemac/Documents/ChatGPT/ai 쇼핑 채널 등록 자동화")
SCREEN_DIR = ROOT / "tmp/pdfs/screens"
OUTPUT = ROOT / "output/pdf/SellerPilot_멀티채널_커머스_운영센터_스토리보드.pdf"
CONTACT_SHEET = ROOT / "tmp/pdfs/screenshot_contact_sheet.png"

PAGE_W, PAGE_H = landscape(A4)

FONT_PATH = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
pdfmetrics.registerFont(TTFont("SP-KR", FONT_PATH))

COLORS = {
    "ink": HexColor("#172033"),
    "muted": HexColor("#727C91"),
    "line": HexColor("#E6E9F0"),
    "bg": HexColor("#F5F6FA"),
    "surface": white,
    "primary": HexColor("#5B5CF0"),
    "primary_dark": HexColor("#3D3E91"),
    "primary_soft": HexColor("#EFEFFF"),
    "sidebar": HexColor("#171927"),
    "success": HexColor("#20A779"),
    "warning": HexColor("#F0A229"),
    "danger": HexColor("#E95D68"),
    "blue": HexColor("#3B82F6"),
}

CHANNELS = [
    ("Q", "Qoo10 Japan", "#FF5E62"),
    ("S", "Shopee SG", "#FF7426"),
    ("L", "Lazada MY", "#7357FF"),
    ("C", "쿠팡", "#E8344E"),
    ("11", "11번가", "#FF2D55"),
    ("N", "스마트스토어", "#03C75A"),
    ("E", "eBay Global", "#3665F3"),
]


def set_alpha(c: canvas.Canvas, fill: float | None = None, stroke: float | None = None) -> None:
    if fill is not None:
        c.setFillAlpha(fill)
    if stroke is not None:
        c.setStrokeAlpha(stroke)


def reset_alpha(c: canvas.Canvas) -> None:
    set_alpha(c, 1, 1)


def wrap_lines(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def text_block(c: canvas.Canvas, text: str, x: float, y: float, width: float, size: float = 10,
               color=None, leading: float | None = None, max_lines: int | None = None) -> float:
    color = color or COLORS["ink"]
    leading = leading or size * 1.55
    lines = wrap_lines(text, "SP-KR", size, width)
    if max_lines:
        lines = lines[:max_lines]
    c.setFont("SP-KR", size)
    c.setFillColor(color)
    cursor = y
    for line in lines:
        c.drawString(x, cursor, line)
        cursor -= leading
    return cursor


def title(c: canvas.Canvas, kicker: str, heading: str, page: int, subtitle: str | None = None) -> None:
    c.setFillColor(COLORS["bg"])
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFont("SP-KR", 7.2)
    c.setFillColor(COLORS["primary"])
    c.drawString(44, PAGE_H - 38, kicker.upper())
    c.setFont("SP-KR", 22)
    c.setFillColor(COLORS["ink"])
    c.drawString(44, PAGE_H - 69, heading)
    if subtitle:
        c.setFont("SP-KR", 8)
        c.setFillColor(COLORS["muted"])
        c.drawRightString(PAGE_W - 44, PAGE_H - 62, subtitle)
    c.setStrokeColor(COLORS["line"])
    c.line(44, 34, PAGE_W - 44, 34)
    c.setFont("SP-KR", 6.6)
    c.setFillColor(COLORS["muted"])
    c.drawString(44, 21, "SellerPilot · AI Commerce Operating System")
    c.drawRightString(PAGE_W - 44, 21, f"2026.08.15  |  {page:02d}")


def rounded_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill=white,
                 stroke=None, radius: float = 12, shadow: bool = True) -> None:
    if shadow:
        set_alpha(c, 0.08)
        c.setFillColor(COLORS["ink"])
        c.roundRect(x + 2, y - 3, w, h, radius, fill=1, stroke=0)
        reset_alpha(c)
    c.setFillColor(fill)
    c.setStrokeColor(stroke or COLORS["line"])
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def pill(c: canvas.Canvas, x: float, y: float, label: str, fill, text_color=white,
         width: float | None = None, height: float = 22) -> float:
    width = width or max(34, pdfmetrics.stringWidth(label, "SP-KR", 7) + 18)
    c.setFillColor(fill)
    c.roundRect(x, y, width, height, height / 2, fill=1, stroke=0)
    c.setFont("SP-KR", 7)
    c.setFillColor(text_color)
    c.drawCentredString(x + width / 2, y + 7.5, label)
    return width


def metric_card(c: canvas.Canvas, x: float, y: float, w: float, label: str, value: str,
                detail: str, tone) -> None:
    rounded_card(c, x, y, w, 82, white, shadow=False)
    c.setFillColor(tone)
    c.roundRect(x + 12, y + 46, 27, 24, 7, fill=1, stroke=0)
    c.setFont("SP-KR", 7)
    c.setFillColor(COLORS["muted"])
    c.drawString(x + 48, y + 60, label)
    c.setFont("SP-KR", 17)
    c.setFillColor(COLORS["ink"])
    c.drawString(x + 13, y + 25, value)
    c.setFont("SP-KR", 6.5)
    c.setFillColor(COLORS["muted"])
    c.drawRightString(x + w - 12, y + 28, detail)


def draw_image_fit(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float,
                   crop: bool = True) -> None:
    with Image.open(path) as image:
        iw, ih = image.size
    scale = max(w / iw, h / ih) if crop else min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    c.saveState()
    clipping = c.beginPath()
    clipping.roundRect(x, y, w, h, 8)
    c.clipPath(clipping, stroke=0, fill=0)
    c.drawImage(str(path), dx, dy, dw, dh, mask="auto")
    c.restoreState()


def browser_frame(c: canvas.Canvas, image_path: Path, x: float, y: float, w: float, h: float,
                  crop: bool = True) -> None:
    rounded_card(c, x, y, w, h, white, stroke=HexColor("#DDE1EA"), radius=10)
    bar_h = 22
    c.setFillColor(HexColor("#F6F7FA"))
    c.roundRect(x + 1, y + h - bar_h - 1, w - 2, bar_h, 9, fill=1, stroke=0)
    c.setFillColor(HexColor("#FF6B6B")); c.circle(x + 13, y + h - 12, 2.5, fill=1, stroke=0)
    c.setFillColor(HexColor("#F3BC3B")); c.circle(x + 21, y + h - 12, 2.5, fill=1, stroke=0)
    c.setFillColor(HexColor("#37C978")); c.circle(x + 29, y + h - 12, 2.5, fill=1, stroke=0)
    c.setFillColor(white)
    c.roundRect(x + 48, y + h - 17, w - 64, 10, 4, fill=1, stroke=0)
    c.setFillColor(COLORS["muted"])
    c.setFont("SP-KR", 4.8)
    c.drawString(x + 56, y + h - 14.2, "sellerpilot · operation center")
    draw_image_fit(c, image_path, x + 5, y + 5, w - 10, h - bar_h - 8, crop=crop)


def number_callout(c: canvas.Canvas, x: float, y: float, number: int, heading: str, body: str,
                   width: float = 170) -> None:
    c.setFillColor(COLORS["primary"])
    c.circle(x + 10, y - 1, 10, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("SP-KR", 7)
    c.drawCentredString(x + 10, y - 3.5, str(number))
    c.setFont("SP-KR", 9)
    c.setFillColor(COLORS["ink"])
    c.drawString(x + 28, y + 1, heading)
    text_block(c, body, x + 28, y - 14, width - 28, 6.7, COLORS["muted"], 9.5, 3)


def scene_page(c: canvas.Canvas, page: int, kicker: str, heading: str, screenshot: str,
               purpose: str, actions: list[str], outcomes: list[str], callouts: list[tuple[str, str]],
               image_on_right: bool = True) -> None:
    title(c, kicker, heading, page, purpose)
    image_x = 310 if image_on_right else 44
    info_x = 44 if image_on_right else 570
    browser_frame(c, SCREEN_DIR / screenshot, image_x, 88, 488, 425, crop=True)
    rounded_card(c, info_x, 370, 235 if image_on_right else 228, 143, white, shadow=False)
    pill(c, info_x + 14, 480, "USER ACTION", COLORS["primary_soft"], COLORS["primary_dark"], 78, 19)
    cursor = 455
    for idx, action in enumerate(actions[:4], 1):
        c.setFillColor(COLORS["primary"])
        c.circle(info_x + 18, cursor + 2, 5, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("SP-KR", 4.8)
        c.drawCentredString(info_x + 18, cursor + 0.3, str(idx))
        cursor = text_block(c, action, info_x + 30, cursor + 4, 190, 7.2, COLORS["ink"], 10.5, 2) - 7

    rounded_card(c, info_x, 88, 235 if image_on_right else 228, 266, white, shadow=False)
    pill(c, info_x + 14, 322, "SYSTEM RESPONSE", COLORS["success"], white, 96, 19)
    cursor = 294
    for outcome in outcomes[:4]:
        c.setFillColor(COLORS["success"])
        c.circle(info_x + 19, cursor + 1, 3, fill=1, stroke=0)
        cursor = text_block(c, outcome, info_x + 30, cursor + 4, 190, 7.1, COLORS["ink"], 10.3, 2) - 7
    c.setStrokeColor(COLORS["line"])
    c.line(info_x + 14, 181, info_x + 220, 181)
    c.setFont("SP-KR", 6.5)
    c.setFillColor(COLORS["muted"])
    c.drawString(info_x + 14, 164, "DESIGN CHECKPOINT")
    cy = 145
    for number, (head, body) in enumerate(callouts[:2], 1):
        number_callout(c, info_x + 10, cy, number, head, body, 210)
        cy -= 49
    c.showPage()


def make_contact_sheet() -> None:
    paths = sorted(SCREEN_DIR.glob("*.png"))
    thumb_w, thumb_h = 360, 225
    cols = 3
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + 30)), "#EDEFF5")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(paths):
        with Image.open(path).convert("RGB") as image:
            thumb = ImageOps.fit(image, (thumb_w - 12, thumb_h - 12), method=Image.Resampling.LANCZOS)
        x = (i % cols) * thumb_w + 6
        y = (i // cols) * (thumb_h + 30) + 6
        sheet.paste(thumb, (x, y))
        draw.text((x + 3, y + thumb_h), path.stem, fill="#172033")
    sheet.save(CONTACT_SHEET, quality=92)


def build_pdf() -> None:
    make_contact_sheet()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("SellerPilot 멀티채널 커머스 운영센터 서비스 스토리보드")
    c.setAuthor("SellerPilot")
    c.setSubject("멀티채널 상품 등록, 마진, 판매, 주문, CS 운영 경험")

    # 01 Cover
    c.setFillColor(COLORS["sidebar"]); c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    set_alpha(c, 0.16)
    c.setFillColor(COLORS["primary"]); c.circle(PAGE_W - 50, PAGE_H - 45, 225, fill=1, stroke=0)
    c.setFillColor(COLORS["blue"]); c.circle(65, 5, 150, fill=1, stroke=0)
    reset_alpha(c)
    c.setFillColor(white); c.roundRect(48, PAGE_H - 78, 32, 32, 9, fill=1, stroke=0)
    c.setFillColor(COLORS["sidebar"]); c.setFont("SP-KR", 17); c.drawCentredString(64, PAGE_H - 68, "S")
    c.setFillColor(white); c.setFont("SP-KR", 15); c.drawString(91, PAGE_H - 67, "SellerPilot")
    c.setFillColor(HexColor("#B7B8FF")); c.setFont("SP-KR", 7.5)
    c.drawString(49, PAGE_H - 132, "AI COMMERCE OPERATING SYSTEM · STORYBOARD V2.0")
    c.setFillColor(white); c.setFont("SP-KR", 34)
    c.drawString(48, PAGE_H - 184, "멀티채널 커머스 운영센터")
    c.setFillColor(HexColor("#B9B8FF")); c.setFont("SP-KR", 34)
    c.drawString(48, PAGE_H - 226, "서비스 스토리보드")
    text_block(c, "사진 기반 상품 등록에서 채널별 마진 검증, 판매·주문·재고·CS까지\n7개 국내외 마켓을 하나의 운영 화면으로 연결합니다.", 50, PAGE_H - 267, 410, 10, HexColor("#C8CBDD"), 17)
    px = 50
    for code, label, color in CHANNELS:
        c.setFillColor(HexColor(color)); c.roundRect(px, 144, 30, 30, 8, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 7); c.drawCentredString(px + 15, 154, code)
        c.setFillColor(HexColor("#AEB3C8")); c.setFont("SP-KR", 5.8); c.drawCentredString(px + 15, 133, label[:8])
        px += 53
    browser_frame(c, SCREEN_DIR / "02-dashboard.png", 505, 88, 292, 346, crop=True)
    c.setFillColor(HexColor("#8D93AA")); c.setFont("SP-KR", 7)
    c.drawString(50, 63, "Prepared for product planning · UX review · development handoff")
    c.drawRightString(PAGE_W - 48, 63, "2026.08.15")
    c.showPage()

    # 02 Vision and scope
    title(c, "01 · PRODUCT VISION", "한 번의 등록, 모든 마켓에", 2, "화면 검증용 샘플 데이터 기준")
    rounded_card(c, 44, 358, 470, 155, COLORS["sidebar"], stroke=COLORS["sidebar"])
    c.setFillColor(HexColor("#B9B8FF")); c.setFont("SP-KR", 8); c.drawString(66, 486, "PRODUCT PROMISE")
    c.setFillColor(white); c.setFont("SP-KR", 23); c.drawString(66, 448, "운영자가 30초 안에")
    c.drawString(66, 417, "오늘의 우선순위를 결정한다.")
    text_block(c, "매출·등록·주문·재고·CS가 흩어진 문제를 하나의 판단·실행 루프로 통합합니다.", 66, 388, 420, 8, HexColor("#C5C8DA"), 12)
    metric_card(c, 530, 431, 128, "연결 채널", "7개", "국내 4 · 해외 3", COLORS["primary"])
    metric_card(c, 670, 431, 128, "핵심 장면", "11", "로그인 → 개선", COLORS["blue"])
    metric_card(c, 530, 337, 128, "월간 TOP", "1–10위", "상품별 기여", COLORS["success"])
    metric_card(c, 670, 337, 128, "반응형", "3종", "PC · 태블릿 · 모바일", COLORS["warning"])

    rounded_card(c, 44, 88, 754, 230, white, shadow=False)
    c.setFont("SP-KR", 8); c.setFillColor(COLORS["primary"]); c.drawString(64, 286, "CORE USER PROBLEMS")
    problems = [
        ("01", "상황 파악 지연", "여러 마켓을 오가며 매출·오류·CS를 따로 확인"),
        ("02", "반복 등록", "동일 상품 정보와 이미지를 채널 규격마다 재입력"),
        ("03", "수익성 불확실", "수수료·환율·광고비가 달라 실제 마진 비교가 어려움"),
        ("04", "운영 누락", "재고 부족·등록 실패·미답변 문의가 늦게 발견"),
    ]
    for i, (no, head, body) in enumerate(problems):
        x = 64 + (i % 2) * 365
        y = 241 - (i // 2) * 86
        c.setFillColor(COLORS["primary_soft"]); c.roundRect(x, y - 4, 34, 34, 9, fill=1, stroke=0)
        c.setFillColor(COLORS["primary"]); c.setFont("SP-KR", 8); c.drawCentredString(x + 17, y + 8, no)
        c.setFillColor(COLORS["ink"]); c.setFont("SP-KR", 10); c.drawString(x + 48, y + 15, head)
        text_block(c, body, x + 48, y - 3, 282, 7.2, COLORS["muted"], 11, 2)
    c.showPage()

    # 03 IA
    title(c, "02 · INFORMATION ARCHITECTURE", "한 화면에서 판단하고 다음 화면에서 실행", 3, "대표 · 상품 운영 · 주문 · CS 역할 공통")
    rounded_card(c, 44, 308, 754, 205, white, shadow=False)
    c.setFont("SP-KR", 7); c.setFillColor(COLORS["muted"]); c.drawString(62, 489, "GLOBAL NAVIGATION")
    navs = [
        ("총괄", "KPI · TOP10 · 긴급 항목", COLORS["primary"]),
        ("상품", "원장 · 재고 · 채널 상태", COLORS["blue"]),
        ("등록", "사진 · OCR · 번역 · 게시", COLORS["success"]),
        ("마진", "원가 · 수수료 · 환율", COLORS["warning"]),
        ("주문", "출고 · 배송 · 중앙 재고", HexColor("#6C72D8")),
        ("CS", "번역 · AI 초안 · SLA", HexColor("#E56B8C")),
        ("채널", "매출 · 전환 · 건강도", HexColor("#2AA99B")),
    ]
    card_w = 96
    for i, (head, body, tone) in enumerate(navs):
        x = 61 + i * 104
        c.setFillColor(HexColor("#FAFBFC")); c.setStrokeColor(COLORS["line"])
        c.roundRect(x, 339, card_w, 122, 10, fill=1, stroke=1)
        c.setFillColor(tone); c.roundRect(x + 11, 418, 30, 30, 8, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 8); c.drawCentredString(x + 26, 428, str(i + 1))
        c.setFillColor(COLORS["ink"]); c.setFont("SP-KR", 10); c.drawString(x + 11, 393, head)
        text_block(c, body, x + 11, 375, 76, 6.5, COLORS["muted"], 9, 3)

    roles = [
        ("최고 관리자", "전체 보기 · 실행 · 설정", "대표/총괄"),
        ("상품 운영자", "사진 분석 · 가격 · 게시", "상품팀"),
        ("주문 담당자", "주문 수집 · 출고 · 재고", "물류팀"),
        ("CS 담당자", "문의 번역 · 답변 · SLA", "고객팀"),
    ]
    for i, (role, permission, team) in enumerate(roles):
        x = 44 + i * 191
        rounded_card(c, x, 88, 178, 195, white, shadow=False)
        c.setFillColor(COLORS["primary_soft"]); c.circle(x + 35, 238, 22, fill=1, stroke=0)
        c.setFillColor(COLORS["primary"]); c.setFont("SP-KR", 11); c.drawCentredString(x + 35, 234, team[0])
        c.setFillColor(COLORS["ink"]); c.setFont("SP-KR", 11); c.drawString(x + 66, 244, role)
        c.setFillColor(COLORS["muted"]); c.setFont("SP-KR", 6.5); c.drawString(x + 66, 228, team)
        c.setStrokeColor(COLORS["line"]); c.line(x + 15, 205, x + 163, 205)
        text_block(c, permission, x + 16, 182, 145, 7.4, COLORS["ink"], 11, 3)
        c.setFillColor(COLORS["success"]); c.roundRect(x + 16, 111, 146, 34, 8, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 7); c.drawCentredString(x + 89, 124, "권한 기반 화면 접근")
    c.showPage()

    # 04 Journey
    title(c, "03 · END-TO-END JOURNEY", "로그인부터 성과 개선까지 11개의 핵심 장면", 4, "DISCOVER → AUTOMATE → OPERATE → GROW")
    phases = [("DISCOVER", 44, 490, COLORS["primary"]), ("AUTOMATE", 420, 490, COLORS["success"]),
              ("OPERATE", 44, 293, COLORS["blue"]), ("GROW", 608, 293, COLORS["warning"])]
    for label, x, y, tone in phases:
        pill(c, x, y, label, tone, white, 84, 20)
    journey = [
        (1, "로그인", "ID·PW"), (2, "통합 현황", "KPI·TOP10"), (3, "상품 촬영", "대표·옵션컷"),
        (4, "AI 분석", "OCR·매칭"), (5, "마진 검증", "수수료·환율"), (6, "채널 등록", "7개 동시"),
        (7, "주문 수집", "상태 정규화"), (8, "재고 동기화", "품절 방지"), (9, "CS 응대", "번역·AI 초안"),
        (10, "채널 분석", "건강도"), (11, "성과 개선", "집중 상품"),
    ]
    for i, (no, head, sub) in enumerate(journey):
        row = 0 if i < 6 else 1
        col = i if i < 6 else i - 6
        x = 44 + col * 126 if row == 0 else 44 + col * 141
        y = 355 if row == 0 else 136
        tone = COLORS["primary"] if no <= 2 else COLORS["success"] if no <= 6 else COLORS["blue"] if no <= 9 else COLORS["warning"]
        rounded_card(c, x, y, 112 if row == 0 else 127, 130, white, shadow=False)
        c.setFillColor(tone); c.circle(x + 23, y + 101, 14, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 7.5); c.drawCentredString(x + 23, y + 98.5, str(no))
        c.setFillColor(COLORS["ink"]); c.setFont("SP-KR", 9.5); c.drawString(x + 13, y + 68, head)
        c.setFillColor(COLORS["muted"]); c.setFont("SP-KR", 6.5); c.drawString(x + 13, y + 49, sub)
        c.setStrokeColor(COLORS["line"]); c.line(x + 13, y + 36, x + (99 if row == 0 else 114), y + 36)
        c.setFillColor(COLORS["success"]); c.setFont("SP-KR", 6); c.drawString(x + 13, y + 18, "완료 조건 확인")
    c.showPage()

    # 05-08 scenes
    scene_page(c, 5, "SCENE 01 · SECURE ENTRY", "관리자 로그인", "01-login.png",
               "권한에 맞는 운영 데이터로 진입",
               ["아이디와 비밀번호 입력", "로그인 상태 유지 선택", "대시보드 접속"],
               ["입력값 검증 후 운영센터로 이동", "역할별 권한을 기준으로 메뉴 노출", "실서비스는 서버 인증·2FA로 교체"],
               [("가치 선행", "로그인 전에 7개 채널·AI 자동화 가치 전달"), ("안전한 진입", "비밀번호 표시·복구·지원 경로 제공")])

    scene_page(c, 6, "SCENE 02 · COMMAND CENTER", "통합 대시보드", "02-dashboard.png",
               "30초 안에 오늘의 우선순위 결정",
               ["기간 7일·30일·90일 선택", "월간 판매 TOP 10 확인", "긴급 항목에서 담당 화면 이동"],
               ["총매출·주문·등록·CS KPI 표시", "7개 채널의 실시간 운영 상태 비교", "환율과 자동 등록 파이프라인 노출"],
               [("판단 우선", "핵심 수치와 증감률을 같은 카드에 배치"), ("즉시 실행", "재고·등록 오류·CS를 바로 담당 화면으로 연결")])

    scene_page(c, 7, "SCENE 03 · PRODUCT MASTER", "상품 관리 · 월간 TOP 10", "03-products.png",
               "중앙 상품 원장과 채널 상태를 함께 관리",
               ["상품명·SKU 검색", "채널·상태 필터", "재고주의·품절 상품 선택"],
               ["7개 채널 등록 여부를 한 줄로 표시", "30일 판매량·매출·재고 통합", "저성과·오류 상품을 빠르게 분류"],
               [("하나의 기준", "채널보다 상품 ID·SKU를 중앙 기준으로 사용"), ("성과 연결", "재고와 판매 실적을 같은 표에서 판단")])

    scene_page(c, 8, "SCENE 04 · AI PUBLISHING", "대표사진부터 상세 정보까지 한 번에 등록", "04-publishing.png",
               "반복 입력을 없애고 검증 가능한 등록 초안 생성",
               ["대표사진 1장 필수 업로드", "정면·후면·좌우·라벨·바코드 추가", "간략 설명과 공개 상품 링크 입력", "등록할 7개 채널 선택"],
               ["모든 사진의 OCR·바코드 교차분석", "설명·링크를 이미지 분석 문맥에 반영", "신뢰도별 자동 진행·재촬영·제외", "채널 규격별 초안과 번역 생성"],
               [("증거 기반", "대표사진과 옵션컷의 충돌 정보를 확인 필요로 분류"), ("확장 가능", "이미지 슬롯과 상세컷은 수량 제한 없이 추가")])

    # 09 automation diagram
    title(c, "SCENE 05–06 · AUTOMATION PIPELINE", "AI 분석에서 7개 채널 동시 등록까지", 9, "사실정보 보호 · 중복 방지 · 재시도")
    stages = [
        ("INPUT", "이미지·설명·링크", COLORS["primary"]),
        ("EXTRACT", "OCR·바코드", COLORS["blue"]),
        ("MATCH", "공급사·카탈로그", COLORS["success"]),
        ("POLICY", "신뢰도·규제", COLORS["warning"]),
        ("CONTENT", "번역·상세페이지", HexColor("#8A65D6")),
        ("PRICE", "마진·환율", HexColor("#E36B78")),
        ("PUBLISH", "7개 채널 어댑터", HexColor("#2AA99B")),
    ]
    sx, sy = 45, 355
    for i, (label, body, tone) in enumerate(stages):
        x = sx + i * 108
        rounded_card(c, x, sy, 94, 118, white, shadow=False)
        c.setFillColor(tone); c.roundRect(x + 12, sy + 72, 31, 31, 9, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 8); c.drawCentredString(x + 27.5, sy + 83, str(i + 1))
        c.setFillColor(COLORS["ink"]); c.setFont("SP-KR", 7.5); c.drawString(x + 12, sy + 52, label)
        text_block(c, body, x + 12, sy + 35, 70, 6.2, COLORS["muted"], 9, 2)
        if i < len(stages) - 1:
            c.setStrokeColor(COLORS["line"]); c.setLineWidth(1.5); c.line(x + 94, sy + 59, x + 108, sy + 59)
            c.setFillColor(COLORS["line"]); c.circle(x + 108, sy + 59, 2, fill=1, stroke=0)

    policies = [
        ("G0 · 자동 진행", "바코드·공식 카탈로그 일치", COLORS["success"]),
        ("G1 · 자동 진행", "검증 확률 97% 이상", COLORS["blue"]),
        ("G2 · 재촬영", "85–97% 또는 옵션 충돌", COLORS["warning"]),
        ("G3 · 자동 제외", "85% 미만·규제 정보 부족", COLORS["danger"]),
    ]
    for i, (head, body, tone) in enumerate(policies):
        x = 45 + i * 190
        rounded_card(c, x, 173, 176, 118, white, shadow=False)
        c.setFillColor(tone); c.roundRect(x + 14, 248, 62, 21, 7, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 6.5); c.drawCentredString(x + 45, 255.8, head.split(" · ")[0])
        c.setFillColor(COLORS["ink"]); c.setFont("SP-KR", 9); c.drawString(x + 14, 224, head.split(" · ")[1])
        text_block(c, body, x + 14, 204, 148, 6.8, COLORS["muted"], 10, 2)
    c.setFillColor(COLORS["primary_soft"]); c.roundRect(45, 94, 746, 55, 10, fill=1, stroke=0)
    c.setFillColor(COLORS["primary_dark"]); c.setFont("SP-KR", 8); c.drawString(62, 124, "운영 원칙")
    text_block(c, "모든 결과는 입력 증거와 계산식을 감사로그로 남기고, 채널 장애 시 작업을 잃지 않도록 재시도하며 중복 등록을 차단합니다.", 126, 124, 640, 7.2, COLORS["ink"], 11, 2)
    c.showPage()

    # 10 margin
    scene_page(c, 10, "SCENE 05 · PROFIT PRICING", "7개 채널 마진 계산", "05-margin.png",
               "팔아도 남는 가격과 집중 채널 결정",
               ["계획 판매가·시장 참고가 입력", "매입·배송·3PL·통관 원가 입력", "채널별 수수료와 목표 마진 조정", "권장 판매가 적용 또는 결과 저장"],
               ["예상 순이익·마진율 즉시 계산", "손익분기점과 목표 마진 판매가 산출", "JPY·SGD·MYR·KRW·USD 환산", "자동 등록 가능·가격 조정·확인 판정"],
               [("계산 투명성", "고정 원가·변동비·순이익 배분을 시각화"), ("API 교체", "샘플 수수료·환율을 실제 규칙 데이터로 대체 가능")])

    # 11 order
    scene_page(c, 11, "SCENE 07–08 · ORDER & INVENTORY", "주문 · 판매 · 중앙 재고", "06-orders.png",
               "중복판매와 품절 위험을 줄이는 통합 처리",
               ["결제·출고·배송 상태 탭 선택", "주문번호·구매자·상품 검색", "선택 주문 일괄 출고"],
               ["채널 주문을 공통 상태로 정규화", "결제 시 중앙 재고 우선 예약", "송장과 채널 표시 재고 동기화"],
               [("업무 단위", "채널이 아닌 처리 상태를 중심으로 목록 구성"), ("동시성 보호", "재고 원장과 Outbox로 순서·중복 문제 제어")])

    # 12 CS
    scene_page(c, 12, "SCENE 09 · MULTILINGUAL CS", "다국어 CS 통합함", "07-cs.png",
               "언어가 달라도 하나의 상담함에서 SLA 준수",
               ["미답변·처리중·완료 문의 선택", "번역 원문과 주문 문맥 확인", "AI 답변 초안 검토 후 전송"],
               ["고객 메시지 자동 번역", "주문·배송·운영 정책 기반 초안 생성", "평균 응답·24시간 해결률·AI 사용률 집계"],
               [("문맥 보존", "현재 주문·송장·고객 구매 이력을 함께 제공"), ("사람 중심 자동화", "AI가 초안을 만들고 운영자가 최종 답변 통제")])

    # 13 channel
    scene_page(c, 13, "SCENE 10–11 · CHANNEL PERFORMANCE", "채널별 운영 페이지 · 성과 개선", "08-channel.png",
               "스토어 건강도와 성장 액션을 채널 단위로 결정",
               ["채널 선택 후 API 상태 확인", "매출·주문·상품·CS KPI 비교", "저성과·재고 위험 상품 점검"],
               ["매출·주문 추이와 전환율 표시", "광고 ROAS·반품률·객단가 비교", "상품 정보·배송·CS·재고 건강도 점수화"],
               [("일관된 구조", "모든 채널 페이지의 지표 위치를 동일하게 유지"), ("우선순위", "건강도 점수와 TOP 상품으로 개선 대상을 압축")])

    # 14 responsive
    title(c, "04 · RESPONSIVE EXPERIENCE", "PC · 태블릿 · 모바일 최적화", 14, "운영 밀도는 유지하고 탐색 방식만 전환")
    # Desktop card
    browser_frame(c, SCREEN_DIR / "02-dashboard.png", 44, 101, 398, 391, crop=True)
    c.setFont("SP-KR", 9); c.setFillColor(COLORS["ink"]); c.drawString(57, 474, "PC · 1440px")
    c.setFont("SP-KR", 6.5); c.setFillColor(COLORS["muted"]); c.drawString(57, 460, "고정 사이드바 · 다열 KPI · 데이터 테이블")
    # Tablet and phone framed as devices
    rounded_card(c, 468, 101, 181, 391, HexColor("#202335"), stroke=HexColor("#202335"), radius=16)
    draw_image_fit(c, SCREEN_DIR / "12-tablet-margin.png", 477, 113, 163, 358, crop=True)
    c.setFillColor(white); c.roundRect(542, 478, 32, 3, 1.5, fill=1, stroke=0)
    c.setFont("SP-KR", 8); c.setFillColor(COLORS["ink"]); c.drawCentredString(558, 82, "태블릿 · 820px")
    rounded_card(c, 676, 101, 122, 391, HexColor("#1D1F2D"), stroke=HexColor("#1D1F2D"), radius=20)
    draw_image_fit(c, SCREEN_DIR / "11-mobile-margin.png", 683, 114, 108, 356, crop=True)
    c.setFillColor(white); c.roundRect(716, 479, 41, 4, 2, fill=1, stroke=0)
    c.setFont("SP-KR", 8); c.setFillColor(COLORS["ink"]); c.drawCentredString(737, 82, "모바일 · 390px")
    c.setFillColor(COLORS["primary_soft"]); c.roundRect(44, 47, 754, 35, 9, fill=1, stroke=0)
    c.setFont("SP-KR", 7); c.setFillColor(COLORS["primary_dark"])
    c.drawCentredString(PAGE_W / 2, 60, "표는 내부 가로 스크롤 · 메뉴는 슬라이드 패널 · 입력과 결과는 한 열로 재배치 · 320px 최소 폭 지원")
    c.showPage()

    # 15 handoff/roadmap
    title(c, "05 · DELIVERY ROADMAP", "샘플 데이터에서 실제 운영 데이터로", 15, "현재 UI 구조를 유지하며 API 어댑터 교체")
    columns = [
        ("NOW · UX PROTOTYPE", COLORS["primary"], ["임의 상품·매출·주문·CS 데이터", "샘플 환율·수수료 규칙", "데모 로그인·화면 상태 저장"]),
        ("MVP · OPERATING CORE", COLORS["blue"], ["서버 인증·역할 권한", "중앙 상품·주문·재고 원장", "채널 API·작업 큐·감사로그"]),
        ("NEXT · PROFIT OPTIMIZATION", COLORS["success"], ["판매·전환 기반 자동 재가격", "광고·쿠폰·반품 실비 반영", "예측 재고·성장 기회 추천"]),
    ]
    for i, (head, tone, items) in enumerate(columns):
        x = 44 + i * 253
        rounded_card(c, x, 265, 235, 248, white, shadow=False)
        c.setFillColor(tone); c.roundRect(x, 466, 235, 47, 12, fill=1, stroke=0)
        c.setFillColor(white); c.setFont("SP-KR", 8); c.drawString(x + 16, 485, head)
        y = 432
        for idx, item in enumerate(items, 1):
            c.setFillColor(COLORS["primary_soft"]); c.circle(x + 24, y + 3, 10, fill=1, stroke=0)
            c.setFillColor(COLORS["primary"]); c.setFont("SP-KR", 6.5); c.drawCentredString(x + 24, y + 0.5, str(idx))
            y = text_block(c, item, x + 43, y + 6, 174, 7.4, COLORS["ink"], 11, 2) - 20
        c.setStrokeColor(COLORS["line"]); c.line(x + 16, 306, x + 219, 306)
        c.setFillColor(COLORS["muted"]); c.setFont("SP-KR", 6.4)
        c.drawString(x + 16, 288, "완료 기준과 운영 지표를 단계별 검증")

    rounded_card(c, 44, 88, 754, 153, COLORS["sidebar"], stroke=COLORS["sidebar"])
    c.setFillColor(HexColor("#B9B8FF")); c.setFont("SP-KR", 7); c.drawString(64, 213, "IMPLEMENTATION HANDOFF")
    c.setFillColor(white); c.setFont("SP-KR", 17); c.drawString(64, 180, "UI는 완성, 다음 단계는 실제 데이터 연결입니다.")
    text_block(c, "인증·DB·공식 채널 API·환율/수수료 규칙을 연결하면 현재 화면의 샘플 데이터 어댑터를 실제 응답으로 교체할 수 있습니다. 모든 가격 결정과 자동 게시 결과는 입력값·적용 규칙·기준시각을 함께 저장해야 합니다.", 64, 153, 520, 8, HexColor("#C7CBDD"), 13, 4)
    pill(c, 628, 149, "READY FOR API", COLORS["success"], white, 130, 28)
    c.showPage()

    c.save()


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
