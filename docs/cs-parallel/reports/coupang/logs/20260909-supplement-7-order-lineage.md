# 2026-09-09 쿠팡 CS order-lineage 검증 로그

| 검증 | 결과 |
|---|---|
| 최신 public order wrapper hash | `7657c4469226c8a0873628e9f029380d` |
| Lazada predecessor hash | `1a426cc962f53f230a4fa4e0f147d22e` |
| Shopee predecessor hash | `72163b030ad8554f56df9b673f098510` |
| production pre-Temu hash | `fb7b4b6eea9d1d4b8c7e3a60c9949b31` |
| common exact predecessor hash | `1fdde0da2bcaf7c1e1d903e471f37c52` |
| 007 PGlite | 5/5, skip 0, exit 0 |
| CS boundary + 007 | 17/17, skip 0, exit 0 |
| Lazada + direct lineage TS | 4/4, skip 0, exit 0 |
| Coupang CS MJS | 26/26, skip 0, exit 0 |
| Coupang CS TS | 28/28, skip 0, exit 0 |
| ESLint direct repository binary | exit 0 |

검증 명령은 번들 Node 실행 파일과 기존 저장소 `node_modules`를 사용했다. 번들 pnpm 경유 ESLint 1회는 코드 진입 전 기존 modules directory 재설치 확인을 요구해 non-TTY에서 중단됐다. 의존성 설치/삭제는 하지 않았고, 같은 저장소의 `node_modules/eslint/bin/eslint.js` 직접 실행은 exit 0이었다.

운영 DB/provider/credential/order/reply/route/job은 변경하지 않았다. 고객 원문·주소·전화번호·secret을 출력하거나 저장하지 않았다.
