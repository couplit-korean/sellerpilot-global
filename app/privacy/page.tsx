import "./privacy.css";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · SellerPilot",
  description: "SellerPilot 개인정보 처리 및 마켓플레이스 데이터 보호 정책",
};

const sections = [
  ["1. 처리 목적", "SellerPilot은 판매자가 연결한 마켓플레이스의 상품 등록, 주문 처리, 배송 상태 확인, 고객 문의 대응, 보안 감사에 필요한 범위에서만 데이터를 처리합니다. 판매자와 마켓플레이스가 합의한 목적 외의 광고·프로파일링에는 사용하지 않습니다."],
  ["2. 처리하는 정보", "상품·SKU·가격·재고·주문번호·주문 상태와, 주문 이행에 필요한 경우 구매자 이름 및 마켓플레이스가 제공한 배송·연락 정보가 포함될 수 있습니다. 비밀번호와 API 비밀값은 암호화된 자격증명 저장소에 보관하며 일반 화면이나 작업 로그에 표시하지 않습니다."],
  ["3. 처리 위치와 수탁자", "애플리케이션 요청과 서버리스 실행이 허용된 마켓플레이스 API 작업은 운영 프로젝트의 Vercel 인프라에서 처리합니다. 유료 Vercel Static IP는 사용하지 않습니다. 고정 송신 IP가 필요한 채널을 위한 한국의 운영자 관리 worker 경로는 설계된 경로이며, 채널 승인이나 현재 실행 가능성을 뜻하지 않습니다. 2026-09-06 확인 기준 Temu 앱은 준법 심사 거절로 미활성 상태이며 API 실행이 불가능합니다. 한국 worker를 통한 Temu 연결이나 개인정보 처리가 운영 중이라고 표시하지 않습니다. 채널별 승인·인증·허용 IP와 실제 송신 경로가 확인되지 않으면 호출하지 않습니다. AI 상품 분석과 이미지 제작도 Vercel 서버에서 처리하며, AI Gateway에는 Vercel이 발급한 단기 OIDC를 사용합니다. 별도 OpenAI API Key나 운영자 개인 기기의 로그인 자격정보를 저장하지 않습니다. 운영 데이터와 암호화된 채널 자격증명은 Supabase 싱가포르 리전에 저장합니다. 각 처리 환경과 공급자는 서비스 제공·보안·장애 복구 목적에 한해 데이터를 처리합니다."],
  ["4. 보유기간과 삭제", "배송 완료·취소·환불된 주문 및 해결된 고객 문의의 직접 식별자와 자유 입력 내용은 목적 종료 후 최대 30일 이내 자동 익명화합니다. 채널 작업자의 원격 응답 원문과 완료된 AI 작업 파일은 30일 이내 삭제합니다. 공개 상품 이미지는 해당 상품의 판매·오류 재처리에 필요한 동안 보관하고, 상품 삭제 요청과 연결된 정리 절차에 따라 제거합니다. 법령상 보존 의무가 있는 비개인 거래 증빙은 필요한 기간 동안 분리 보관할 수 있습니다."],
  ["5. 보호조치", "전송 구간은 TLS 1.2 이상을 사용하고, 저장된 채널 자격증명은 Vault에서 암호화합니다. 역할 기반 관리자 접근, 판매자별 데이터 분리, 쓰기 작업 재확인, 멱등성 키, 감사 로그, 정기 토큰 갱신과 30일 보관기간 정리를 적용합니다."],
  ["6. 정보주체의 권리", "정보주체는 접근, 정정, 삭제, 처리 제한을 요청할 수 있습니다. 구매가 이루어진 마켓플레이스의 개인정보 문의 절차 또는 SellerPilot 운영자와 체결된 계약상 연락 창구로 요청하면, 해당 마켓플레이스와 협력해 신원을 확인하고 법정 기한 내 처리합니다."],
  ["7. 보안사고", "개인정보 침해가 의심되면 접근을 차단하고 영향 범위를 조사하며 증거를 보존합니다. 마켓플레이스 데이터가 관련된 확인된 사고는 계약상 기한에 따라, Temu 관련 사고는 인지 후 24시간 이내 1차 통지를 목표로 보고하고 후속 조치 내용을 갱신합니다."],
  ["8. 정책 변경", "본 정책은 최소 반기마다, 또는 처리 목적·수탁자·보안 통제가 변경될 때 검토합니다. 중요한 변경은 적용 전에 이 페이지에 게시합니다."],
] as const;

export default function PrivacyPage() {
  return <main className="privacy-page">
    <header>
      <Link href="/" aria-label="SellerPilot 홈">SellerPilot</Link>
      <span>Marketplace data protection</span>
    </header>
    <article>
      <p className="privacy-kicker">PUBLIC POLICY · EFFECTIVE 2026-08-29</p>
      <h1>개인정보 처리 및<br />마켓플레이스 데이터 보호 정책</h1>
      <p className="privacy-lead">SellerPilot은 상품 등록과 주문 이행에 필요한 최소 데이터만 처리하고, 채널별 접근 권한과 보유기간을 기술적으로 제한합니다.</p>
      <div className="privacy-grid">
        {sections.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}
      </div>
      <aside>
        <b>English summary</b>
        <p>SellerPilot processes marketplace data only for listing, order fulfilment, support, and security. Application requests and marketplace API operations permitted for serverless execution run on the production project&apos;s Vercel infrastructure. Paid Vercel Static IP is not used. An operator-managed worker in the Republic of Korea is a designed route for channels requiring a fixed source IP, not proof of channel approval or current execution availability. As verified on 2026-09-06, the Temu app is inactive following compliance rejection and cannot execute API operations. Temu connectivity or personal-data processing through the Korean worker is not represented as operational. Channel approval, authentication, allowed source IPs, and the actual egress route must be verified; otherwise the operation is blocked. AI product analysis and image production also run on the Vercel server and authenticate to the AI Gateway with short-lived OIDC issued by Vercel. SellerPilot does not store a separate OpenAI API key or an operator&apos;s personal-device login credentials. Operational data and encrypted marketplace credentials are stored in the Supabase Singapore region. Direct identifiers in completed orders and resolved support cases, raw gateway responses, and completed AI work files are erased or anonymized within 30 days after their operational purpose ends. Public product images remain available while required for an active listing or error recovery and are removed through the product-deletion workflow. Data-subject requests are coordinated through the marketplace privacy channel or the operator&apos;s contractual contact.</p>
      </aside>
      <footer><span>Policy version 1.4</span><span>Last reviewed: 2026-09-06</span></footer>
    </article>
  </main>;
}
