# 2026-09-10 Android 앱(TWA) Digital Asset Links 배포

이 문서는 SellerPilot 운영 앱에 **안드로이드 APK 설치 경로**를 추가하기 위해
`assetlinks.json`을 운영 배포 라인에 반영한 작업의 상세 기록이다.

기존 8채널 상품·CS·배송 작업과 **충돌하지 않도록** 변경 범위를 파일 1개로
한정했고, 그 근거와 검증·롤백 방법을 함께 남긴다.

---

## 1. 결론 요약

| 항목 | 값 |
|---|---|
| 변경 파일 | `public/.well-known/assetlinks.json` (신규 1개) |
| 기존 파일 수정 | **없음** (코드·설정·환경변수·migration 전부 무변경) |
| DB 변경 | **없음** |
| API·라우트 변경 | **없음** |
| 배포 경로 | `Kimchanghee/main` → `couplit-korean/main` → Vercel Production |
| 목적 | 안드로이드 앱이 주소창 없이 전체화면으로 뜨게 하는 검증 파일 제공 |

`assetlinks.json`은 "이 앱이 이 도메인의 주인이다"를 안드로이드에 알려주는
서명 지문 목록이다. 이 파일이 서버에 없으면 TWA 앱은 브라우저처럼 주소창이
보이는 상태로 열린다.

---

## 2. 왜 이 작업이 필요했나

SellerPilot 웹앱은 이미 안드로이드 앱 출시를 전제로 만들어져 있었다.

| 구성요소 | 파일 | 상태 |
|---|---|---|
| PWA 매니페스트 | `public/manifest.webmanifest` | `start_url=/?source=android-pwa`, 아이콘 3종, 바로가기 2종 |
| 서비스 워커 | `public/sw.js` | 주문·배송 푸시 수신, 알림 클릭 이동 |
| 앱 설치·푸시 UI | `app/mobile-push-manager.tsx` | `beforeinstallprompt`, 권한 요청, 구독 저장, 테스트 발송 |
| 모바일 최적화 | `app/mobile-optimization.css` | Android 뷰포트 대응 |

따라서 **웹 코드는 손댈 필요가 없었고**, 빠져 있던 것은 TWA 검증 파일 하나뿐이었다.
2026-09-10 확인 시 `/.well-known/assetlinks.json`은 404였다.

---

## 3. 서명 정보

TWA는 앱 서명 지문과 서버의 `assetlinks.json`이 정확히 일치해야 한다.

| 항목 | 값 |
|---|---|
| 패키지 ID | `app.vercel.sellerpilot_global.twa` |
| 앱 이름 | SellerPilot 판매관리 (홈화면: SellerPilot) |
| 여는 주소 | `https://sellerpilot-global.vercel.app` |
| SHA-256 지문 | `EE:EE:23:C2:B5:B5:37:27:59:D1:0E:18:E5:26:6E:C0:67:66:C3:66:35:18:E8:8C:92:50:AD:1D:E2:78:95:41` |
| 서명 키 종류 | RSA 4096, 유효기간 10000일 |

서명 키스토어와 비밀번호는 **저장소 밖** `D:\AndroidWebDev\Projects\sellerpilot-twa\release\`에만
있다. 이 저장소와 `docs/`에는 키 원문·비밀번호를 넣지 않는다.

빌드 산출물: TWA 프로젝트와 APK는 `D:\AndroidWebDev\Projects\sellerpilot-twa\`에 있으며
이 저장소에는 포함되지 않는다.

---

## 4. 배포 경로 (중요)

이 저장소는 코드 원본(`Kimchanghee`)과 Vercel이 배포하는 리포(`couplit-korean`)가 다르다.
`docs/계정연결.md` 기준이다.

```
Kimchanghee/sellerpilot-global      코드 원본. 여기 push만으로는 운영 반영 안 됨
        ↓ 같은 SHA를 main에 반영
couplit-korean/sellerpilot-global   Vercel Git 연결. Production 브랜치 = main
        ↓ 자동 배포
https://sellerpilot-global.vercel.app
```

즉 운영 반영을 위해서는 `couplit-korean/main`까지 올려야 한다.
이번 작업은 그 경로를 그대로 따랐다.

| 시점 | couplit-korean/main SHA |
|---|---|
| 작업 전 | `dd4f762f` (Document the retention finding for the new product evidence tables.) |
| 작업 후 | `ea7b72cd` (Publish Android Digital Asset Links for the SellerPilot TWA app.) |

`ea7b72cd`는 `dd4f762f` **바로 위에 얹힌 커밋**이라 fast-forward로 올라간다.
되돌리기 어려운 병합이나 이력 재작성은 하지 않았다.

---

## 5. 다른 작업과 겹치지 않는 근거

동시에 진행 중인 8채널·CS·상품등록 작업과 충돌하지 않는다는 근거는 다음과 같다.

1. **추가된 파일이 1개뿐이다.** `public/.well-known/assetlinks.json` 신규 생성만 한다.
2. **기존 파일을 한 줄도 수정하지 않는다.** `proxy.ts`, `next.config.ts`, `app/`, `lib/`, `supabase/` 모두 무변경.
3. **migration을 추가하지 않는다.** `supabase/migrations/` 무변경, 운영 DB 무변경.
4. **환경변수를 바꾸지 않는다.** Vercel env 무변경.
5. **`docs/현재상태.md`에 새 항목을 맨 위에 추가**하는 방식이라 기존 항목을 지우거나 덮어쓰지 않는다.
6. **브랜치 병합이 아니다.** 기존 `main` 위에 파일 1개 커밋을 얹는 fast-forward뿐이다.

`.vercelignore`와 `.gitignore` 모두 `public/.well-known/`을 제외하지 않는 것을 확인했다
(`git check-ignore` 결과 없음). 따라서 배포 산출물에 포함된다.

---

## 6. 검증 방법

배포 후 아래를 확인한다. Vercel 대시보드 로그인이 없는 환경이므로 HTTP 응답으로 판정한다.

```powershell
$UA = "Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
Invoke-WebRequest -Uri "https://sellerpilot-global.vercel.app/.well-known/assetlinks.json" -UserAgent $UA
```

- 성공 기준: HTTP 200, `Content-Type: application/json`, 본문의 `sha256_cert_fingerprints`가 위 3장의 값과 일치.
- 배포 전에는 404가 정상이다. Vercel 빌드가 끝나면 200으로 바뀐다.
- 캐시된 404가 보이면 쿼리 파라미터(`?v=<난수>`)를 붙여 재확인한다.

APK 쪽은 기기 설치 후 아래를 확인한다.
- 홈 화면 아이콘이 "SellerPilot"로 표시된다.
- 실행 시 주소창 없이 전체화면으로 열린다. (주소창이 보이면 `assetlinks` 불일치)
- 관리자 로그인 후 주문·CS 화면이 정상 렌더된다.
- 바로가기 2종("주문", "문의")이 동작한다.
- 알림 허용 시 푸시 구독이 저장된다. (서버 VAPID 키 설정 선행 필요)

---

## 7. 롤백 방법

되돌릴 때는 파일 1개만 제거하면 된다. DB·설정 롤백은 없다.

```powershell
git revert ea7b72cd
git push couplit main
```

revert 후 `/.well-known/assetlinks.json`은 404가 되고, 기존 앱은 주소창이 보이는
상태로 돌아간다. 다른 기능에는 영향이 없다.

---

## 8. 남은 작업 (이 문서 범위 밖)

| 항목 | 상태 | 비고 |
|---|---|---|
| Vercel Production 배포 확인 | 진행 | 200 응답 확인 필요 |
| DB runtime release SHA 대조 | 미확인 | 배포 SHA가 바뀌므로 기존 attested release와 대조 필요 |
| 웹 푸시 VAPID 키 설정 | 미확인 | 미설정 시 앱에 "푸시 키 설정 대기" 상태로 표시 |
| 실기기 설치 검증 | 미실시 | 이 PC에 Android 기기 미연결 |
| `integration-aside` 반영 여부 | 보류 | 운영 배포는 `main` 기준으로만 했다 |

DB release SHA 대조는 운영 정책 판단이 필요한 항목이라 이번 작업에서 임의로
바꾸지 않았다. 배포 SHA가 `ea7b72cd`로 갱신된 사실만 기록한다.

---

## 9. 이번 작업에서 하지 않은 것

- 앱 아이콘·앱 이름 변경 (기존 매니페스트 값 그대로 사용)
- 웹 코드·스타일·라우트 수정
- 환경변수·Vault 키 변경
- DB migration 추가·적용
- Vercel Git 연결 변경
- `integration-aside` 브랜치 병합
- 서명 키스토어를 저장소에 커밋

---

## 10. 재현 명령 (다른 PC에서 같은 작업을 할 때)

```powershell
# 1) 코드 원본에 파일 추가 후 커밋
git add public/.well-known/assetlinks.json
git commit -m "Publish Android Digital Asset Links for the SellerPilot TWA app."

# 2) 코드 원본 push
git push origin main

# 3) Vercel이 보는 리포로 같은 SHA 올리기
git remote add couplit https://github.com/couplit-korean/sellerpilot-global.git
git fetch couplit
git push couplit main

# 4) 배포 확인
Invoke-WebRequest -Uri "https://sellerpilot-global.vercel.app/.well-known/assetlinks.json"
```
