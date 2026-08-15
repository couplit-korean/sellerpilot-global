# SellerPilot 운영 UI 리팩터링 원칙

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

### IBM Carbon Design System

- 저장소: <https://github.com/carbon-design-system/carbon>
- 적용: IBM Plex, 2× 간격 체계, 고정 헤더·사이드 패널, 키라인, 생산형 데이터 밀도
- 라이선스: Apache 2.0

### GitHub Primer

- 저장소: <https://github.com/primer/react>
- 적용: 업무 도구형 내비게이션, 명확한 활성 상태, 표·상태·도구 모음의 판독성
- 라이선스: MIT

### GOV.UK Design System 접근성 원칙

- 참고: <https://design-system.service.gov.uk/get-started/focus-states/>
- 적용: 키보드 포커스를 배경과 무관하게 식별할 수 있는 노란색 고대비 포커스 링

## SellerPilot 디자인 규칙

1. 기본 배경은 회색, 실제 작업 표면은 흰색으로 구분한다.
2. 브랜드 파란색은 주요 행동, 현재 선택, 정보 연결선에만 사용한다.
3. 상태 색은 성공·주의·위험의 의미가 있을 때만 사용한다.
4. 패널은 그림자보다 1px 키라인으로 구분하고 기본 모서리는 직각으로 둔다.
5. KPI는 독립 카드 묶음보다 하나의 연속된 정보 필드로 배치한다.
6. 표 본문은 최소 12px, 주요 설명은 최소 13px을 기준으로 한다.
7. 작은 영문 라벨은 장식이 아니라 실제 분류 정보가 있을 때만 사용한다.
8. AI 아이콘은 분석·생성·번역처럼 AI가 실제로 동작하는 곳에서만 사용한다.
9. 모바일에서는 장식보다 읽기 순서와 터치 크기를 먼저 보존한다.
10. 새 기능은 `operations-system.css`의 토큰과 기존 공통 클래스를 먼저 사용한다.

## 구현 위치

- 공통 디자인 토큰과 전역 컴포넌트 표현: `app/operations-system.css`
- 기본 글꼴과 스타일 적용 순서: `app/layout.tsx`
- 제품별 화면 구조와 문구: `app/page.tsx`, `app/margin-calculator.tsx`, `app/showcase/`
