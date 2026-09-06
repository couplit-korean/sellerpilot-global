# SellerPilot 운영 UI 리팩터링 원칙

> 운영 사실(연결·IP·배포 SHA)은 [docs/현재상태.md](./현재상태.md)가 원장이다. 이 파일은 당시 기획/검수 스냅샷이다.

## 목표

SellerPilot을 흔한 AI SaaS 템플릿이 아니라, 매일 반복해서 사용하는 커머스 운영 도구로 보이게 만든다.
AI는 화면의 장식 언어가 아니라 상품 분석, 번역, 답변 초안처럼 실제 기능이 있는 위치에서만 드러낸다.

## 조사에서 반복된 문제

- 보라색·파란색 그라데이션을 기본 브랜드처럼 사용하는 구성
- 모든 콘텐츠를 큰 둥근 카드와 아이콘 박스에 넣는 구성
- 유리 효과, 흐린 대비, 과도한 그림자
- 모든 블록에 같은 간격과 같은 중요도를 주는 구성
- 설명을 작은 회색 글씨나 흐린 모노 글꼴로 처리하는 구성
- 제품 특성보다 “AI powered”, “workflow” 같은 범용 문구가 앞서는 구성
- 기존 디자인 체계 대신 화면마다 새로운 CSS 표현을 추가하는 방식

참고 커뮤니티:

- [Reddit UI Design — AI Fatigue from seeing same designs](https://www.reddit.com/r/UI_Design/comments/1tvb91q/ai_fatigue_from_seeing_same_designs/)
- [Reddit UI Design — How can you tell a design is AI?](https://www.reddit.com/r/UI_Design/comments/1uchh8o/how_can_you_tell_a_design_is_ai/)
- [Hacker News — High-information density UIs](https://news.ycombinator.com/item?id=43925732)

## 채택한 오픈소스 기반

### 커머스 판매자센터 구조

- 스마트스토어: 정산, 취소, 반품, 교환처럼 당장 처리할 상태를 홈에서 노출
- Shopify Home: 오늘 할 일, 최근 판매, 채널별 핵심 지표를 우선 배치
- Amazon Seller Central: 검색, 필터, 상품 상태와 즉시 수정 가능한 고밀도 표 사용

### 오픈소스 UI 기반

- IBM Carbon: 생산형 데이터 밀도와 키라인 원칙
- GitHub Primer: 업무 도구형 탐색, 상태, 표 패턴
- Lucide: 화면 기능을 설명하는 인터페이스 아이콘

### GOV.UK Design System 접근성 원칙

- 참고: <https://design-system.service.gov.uk/get-started/focus-states/>
- 적용: 키보드 포커스를 배경과 무관하게 식별할 수 있는 노란색 고대비 포커스 링

## SellerPilot 디자인 규칙

1. 기본 배경은 회색, 실제 작업 표면은 흰색으로 구분한다.
2. 운영 초록은 주요 행동과 현재 선택에, 주문 주황은 마감과 정산 강조에 제한해 사용한다.
3. 상태 색은 성공·주의·위험의 의미가 있을 때만 사용한다.
4. 패널은 약한 1px 키라인과 8~10px 모서리를 사용하되 모든 정보를 개별 카드로 쪼개지 않는다.
5. KPI는 독립 카드 묶음보다 하나의 연속된 정보 필드로 배치한다.
6. 표 본문은 최소 12px, 주요 설명은 최소 13px을 기준으로 한다.
7. 화면 분류와 상태는 한국어를 우선하며 장식용 대문자 영문 라벨을 사용하지 않는다.
8. AI 아이콘은 분석·생성·번역처럼 AI가 실제로 동작하는 곳에서만 사용한다.
9. 모바일에서는 장식보다 읽기 순서와 터치 크기를 먼저 보존한다.
10. 새 기능은 `operations-system.css`의 토큰과 기존 공통 클래스를 먼저 사용한다.

## 구현 위치

- 공통 디자인 토큰과 전역 컴포넌트 표현: `app/operations-system.css`
- 기본 글꼴과 스타일 적용 순서: `app/layout.tsx`
- 제품별 화면 구조와 문구: `app/page.tsx`, `app/margin-calculator.tsx`

## 2026-08-16 커머스 운영센터 재구성

- 로그인 화면의 별도 AI 디자인 샘플 진입점과 `/showcase` 샘플 라우트를 제거했다.
- 홈 첫 화면은 장식형 KPI 카드보다 신규 주문, 발송 마감, 클레임, 등록 오류, 정산 예정액을 먼저 보여준다.
- 스마트스토어의 정산·클레임 상태 중심 구조, Shopify Home의 오늘 할 일 중심 구조, Amazon Seller Central의 검색·필터·표 중심 구조를 혼합했다.
- 포인트 색은 네이버 계열의 운영 초록, Shopee 계열의 주문 주황, Amazon 계열의 정산 포인트를 역할별로 제한해 사용한다.
- 로그인과 대시보드 모두 프로모션 랜딩 페이지가 아니라 실제 판매자센터의 밀도와 탐색 구조를 우선한다.
