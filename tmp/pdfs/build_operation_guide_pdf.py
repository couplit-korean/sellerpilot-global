from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "셀러파일럿_실제사진_작동방식_간단안내.pdf"
SOURCE_IMAGE = ROOT / "outputs" / "kakao-test" / "white-tomato-source.png"
THUMBNAIL_IMAGE = ROOT / "outputs" / "kakao-test" / "white-tomato-thumbnail-local.png"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")

PAGE_W, PAGE_H = A4
NAVY = HexColor("#071528")
NAVY_2 = HexColor("#10233D")
BLUE = HexColor("#1477F8")
BLUE_SOFT = HexColor("#EAF3FF")
MINT = HexColor("#16B981")
MINT_SOFT = HexColor("#EAFBF5")
AMBER = HexColor("#E99524")
AMBER_SOFT = HexColor("#FFF6E9")
TEXT = HexColor("#142033")
MUTED = HexColor("#65738A")
LINE = HexColor("#DCE5F0")
SURFACE = HexColor("#F5F8FC")


def wrap_text(text, font_name, font_size, max_width):
    lines = []
    for paragraph in text.split("\n"):
        current = ""
        for char in paragraph:
            candidate = current + char
            if pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = char
        lines.append(current)
    return lines


def draw_wrapped(c, text, x, y, max_width, font_size=9, color=TEXT, leading=None, max_lines=None):
    leading = leading or font_size * 1.45
    lines = wrap_text(text, "KR", font_size, max_width)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-1] + "…"
    c.setFont("KR", font_size)
    c.setFillColor(color)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_pill(c, x, y, width, text, bg, fg):
    c.setFillColor(bg)
    c.roundRect(x, y, width, 22, 11, fill=1, stroke=0)
    c.setFillColor(fg)
    c.setFont("KR", 8)
    text_w = pdfmetrics.stringWidth(text, "KR", 8)
    c.drawString(x + (width - text_w) / 2, y + 7, text)


def draw_fitted_image(c, path, x, y, width, height, pad=8):
    with PILImage.open(path) as image:
        image_width, image_height = image.size
    scale = min((width - pad * 2) / image_width, (height - pad * 2) / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    c.drawImage(
        str(path),
        x + (width - draw_width) / 2,
        y + (height - draw_height) / 2,
        draw_width,
        draw_height,
        preserveAspectRatio=True,
        mask="auto",
    )


def draw_footer(c, page_number):
    c.setStrokeColor(LINE)
    c.line(42, 42, PAGE_W - 42, 42)
    c.setFont("KR", 7.5)
    c.setFillColor(MUTED)
    c.drawString(42, 25, "셀러파일럿 로컬 데모 | 2026-08-12")
    page_text = f"{page_number} / 2"
    c.drawRightString(PAGE_W - 42, 25, page_text)


def draw_page_one(c):
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 168, PAGE_W, 168, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.roundRect(42, PAGE_H - 51, 116, 20, 10, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("KR", 7.8)
    c.drawString(54, PAGE_H - 44, "SELLERPILOT  LOCAL DEMO")
    c.setFont("KR", 25)
    c.drawString(42, PAGE_H - 91, "상품 사진 한 장으로")
    c.setFillColor(HexColor("#69AEFF"))
    c.drawString(42, PAGE_H - 123, "등록 초안까지 자동 생성")
    c.setFillColor(HexColor("#C6D4E8"))
    c.setFont("KR", 9)
    c.drawString(42, PAGE_H - 149, "화이트토마토 실제 사진으로 검증한 로컬 데모 작동 안내")

    status_y = 624
    cards = [
        (42, "실제 사진 OCR", "Apple Vision으로 사진 문구 인식", MINT_SOFT, MINT),
        (215, "1000 x 1000 썸네일", "제품 영역 보정 후 PNG 생성", BLUE_SOFT, BLUE),
        (388, "3개 언어 초안", "일본어·영어·말레이어", AMBER_SOFT, AMBER),
    ]
    for x, title, note, bg, accent in cards:
        c.setFillColor(bg)
        c.roundRect(x, status_y, 165, 52, 10, fill=1, stroke=0)
        c.setFillColor(accent)
        c.circle(x + 18, status_y + 27, 5, fill=1, stroke=0)
        c.setFillColor(TEXT)
        c.setFont("KR", 9.4)
        c.drawString(x + 31, status_y + 31, title)
        c.setFillColor(MUTED)
        c.setFont("KR", 7.2)
        c.drawString(x + 31, status_y + 15, note)

    c.setFillColor(TEXT)
    c.setFont("KR", 12)
    c.drawString(42, 592, "원본 사진 → 자동 생성 결과")
    c.setFillColor(MUTED)
    c.setFont("KR", 7.8)
    c.drawRightString(PAGE_W - 42, 592, "고정 샘플이 아닌 업로드 파일을 직접 처리")

    image_y = 351
    image_w = 246
    image_h = 220
    for x, label, path, label_bg, label_fg in [
        (42, "사용자가 준 원본 사진", SOURCE_IMAGE, NAVY_2, white),
        (307, "실제 생성된 대표 썸네일", THUMBNAIL_IMAGE, BLUE, white),
    ]:
        c.setFillColor(white)
        c.setStrokeColor(LINE)
        c.roundRect(x, image_y, image_w, image_h, 12, fill=1, stroke=1)
        c.setFillColor(label_bg)
        c.roundRect(x + 10, image_y + image_h - 31, 132, 21, 8, fill=1, stroke=0)
        c.setFillColor(label_fg)
        c.setFont("KR", 7.5)
        c.drawString(x + 20, image_y + image_h - 24, label)
        draw_fitted_image(c, path, x + 6, image_y + 10, image_w - 12, image_h - 48, pad=3)

    c.setFillColor(TEXT)
    c.setFont("KR", 12)
    c.drawString(42, 319, "한 번의 실행으로 처리되는 6단계")

    steps = [
        ("01", "사진 업로드", "PNG·JPG·WebP 선택"),
        ("02", "상품 문구 OCR", "한글·영문 라벨 인식"),
        ("03", "사실정보 추출", "상품명·브랜드·용량·성분"),
        ("04", "썸네일 생성", "제품 보정·흰 배경·중앙 정렬"),
        ("05", "판매 초안 생성", "3개 언어 제목·설명"),
        ("06", "마진 가격 계산", "원가·수수료·환율 반영"),
    ]
    col_width = 165
    gap = 8
    for index, (number, title, note) in enumerate(steps):
        row = index // 3
        col = index % 3
        x = 42 + col * (col_width + gap)
        y = 225 - row * 82
        c.setFillColor(SURFACE)
        c.setStrokeColor(LINE)
        c.roundRect(x, y, col_width, 66, 10, fill=1, stroke=1)
        c.setFillColor(BLUE if row == 0 else MINT)
        c.roundRect(x + 11, y + 35, 30, 20, 8, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("KR", 8)
        c.drawString(x + 19, y + 42, number)
        c.setFillColor(TEXT)
        c.setFont("KR", 9.2)
        c.drawString(x + 49, y + 43, title)
        draw_wrapped(c, note, x + 12, y + 20, col_width - 24, font_size=7.2, color=MUTED, leading=10, max_lines=2)

    draw_footer(c, 1)


def draw_page_two(c):
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 104, PAGE_W, 104, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("KR", 20)
    c.drawString(42, PAGE_H - 57, "작동 방식과 현재 연결 범위")
    c.setFillColor(HexColor("#C6D4E8"))
    c.setFont("KR", 8.5)
    c.drawString(42, PAGE_H - 80, "시연용 로컬 프로그램 기준 - 실제 작동과 미연동 기능을 분리해서 표시")

    c.setFillColor(TEXT)
    c.setFont("KR", 12)
    c.drawString(42, 707, "사용 방법")
    instructions = [
        ("1", "프로그램 실행", "프로젝트 폴더에서 npm run demo 실행 후 localhost:3000 접속"),
        ("2", "상품 사진 선택", "정면 사진을 넣고, 바코드·후면 라벨 사진이 있으면 함께 준비"),
        ("3", "이미지 자동 분석 시작", "업로드 파일 바이트를 로컬 분석 서버로 보내 OCR과 제품 영역 보정"),
        ("4", "결과 검수", "상품명·브랜드·용량·성분과 OCR 원문을 함께 확인"),
        ("5", "콘텐츠·가격 확인", "생성 썸네일, 3개 언어 초안, 목표 마진 가격 확인"),
        ("6", "등록 초안 생성", "선택한 채널 3곳의 로컬 검수 대기 초안을 생성"),
    ]
    start_y = 672
    for index, (number, title, note) in enumerate(instructions):
        y = start_y - index * 58
        c.setFillColor(BLUE_SOFT if index < 3 else MINT_SOFT)
        c.circle(57, y + 12, 13, fill=1, stroke=0)
        c.setFillColor(BLUE if index < 3 else MINT)
        c.setFont("KR", 9)
        c.drawCentredString(57, y + 9, number)
        c.setFillColor(TEXT)
        c.setFont("KR", 9.6)
        c.drawString(82, y + 17, title)
        draw_wrapped(c, note, 82, y + 2, 455, font_size=7.4, color=MUTED, leading=10, max_lines=2)

    c.setFillColor(TEXT)
    c.setFont("KR", 12)
    c.drawString(42, 337, "현재 구현 상태")
    table_x = 42
    table_y = 162
    table_w = PAGE_W - 84
    header_h = 29
    row_h = 36
    widths = [150, 255, 106]
    headers = ["기능", "현재 상태", "판정"]
    c.setFillColor(NAVY_2)
    c.roundRect(table_x, table_y + row_h * 4, table_w, header_h, 7, fill=1, stroke=0)
    x = table_x
    for header, width in zip(headers, widths):
        c.setFillColor(white)
        c.setFont("KR", 8)
        c.drawString(x + 10, table_y + row_h * 4 + 10, header)
        x += width

    rows = [
        ("사진 OCR·정보 추출", "화이트토마토 사진에서 상품 사실정보 추출 완료", "작동 확인", True),
        ("썸네일·3개 언어 초안", "1000px PNG와 일본어·영어·말레이어 초안 생성", "작동 확인", True),
        ("마진·채널별 권장가", "원가·배송·수수료·환율·목표 마진으로 계산", "작동 확인", True),
        ("최저가·게시·재고·주문", "Qoo10·Shopee·Lazada 판매자 API 자격증명 필요", "아직 미연동", False),
    ]
    for row_index, (feature, state, verdict, connected) in enumerate(rows):
        y = table_y + row_h * (3 - row_index)
        c.setFillColor(white if row_index % 2 == 0 else SURFACE)
        c.setStrokeColor(LINE)
        c.rect(table_x, y, table_w, row_h, fill=1, stroke=1)
        c.setFillColor(TEXT)
        c.setFont("KR", 7.8)
        c.drawString(table_x + 10, y + 13, feature)
        draw_wrapped(c, state, table_x + widths[0] + 10, y + 13, widths[1] - 20, font_size=7.1, color=MUTED, leading=9, max_lines=2)
        pill_bg = MINT_SOFT if connected else AMBER_SOFT
        pill_fg = MINT if connected else AMBER
        draw_pill(c, table_x + widths[0] + widths[1] + 10, y + 7, 84, verdict, pill_bg, pill_fg)

    c.setFillColor(BLUE_SOFT)
    c.roundRect(42, 83, PAGE_W - 84, 57, 10, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.setFont("KR", 9.5)
    c.drawString(56, 118, "이번 실제 사진 분석 결과")
    result_text = "화이트토마토 글루타치온 · BEYOND ORIGIN · 1,100 mg x 30정 · OCR 신뢰도 표시 97% · 바코드는 후면 사진 필요"
    draw_wrapped(c, result_text, 56, 98, PAGE_W - 112, font_size=7.6, color=TEXT, leading=11, max_lines=2)

    c.setFillColor(AMBER_SOFT)
    c.roundRect(42, 52, PAGE_W - 84, 22, 8, fill=1, stroke=0)
    c.setFillColor(AMBER)
    c.setFont("KR", 7.2)
    c.drawString(54, 60, "주의: 이번 시연에서는 외부 판매채널에 상품을 등록하거나 재고·주문 데이터를 변경하지 않았습니다.")

    draw_footer(c, 2)


def main():
    if not FONT_PATH.exists():
        raise FileNotFoundError(f"Korean font not found: {FONT_PATH}")
    for required in [SOURCE_IMAGE, THUMBNAIL_IMAGE]:
        if not required.exists():
            raise FileNotFoundError(required)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("KR", str(FONT_PATH)))
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("셀러파일럿 실제사진 작동방식 간단안내")
    c.setAuthor("SellerPilot")
    draw_page_one(c)
    c.showPage()
    draw_page_two(c)
    c.showPage()
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
