/**
 * 화면 검증용 임시 데이터입니다.
 * 실제 백엔드가 연결되면 이 파일의 export 형태를 API 응답 어댑터로 교체합니다.
 */

export type ChannelKey = "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay";
export type AllChannelKey = ChannelKey | "alibaba" | "one688";

export type ChannelConfig = {
  name: string;
  market: string;
  color: string;
  letter: string;
  enabled: boolean;
};

export type Ticket = {
  id: string;
  customer: string;
  channel: string;
  subject: string;
  preview: string;
  time: string;
  status: "긴급" | "답변 대기" | "처리 중";
};

export const DEMO_DATA_META = {
  label: "샘플 데이터",
  기준일: "2026.08.15",
  currency: "KRW",
};

export const productImages = [
  "/demo/setting-shots/premium-studio.png",
  "/demo/setting-shots/morning-routine.png",
  "/demo/setting-shots/ingredient-flatlay.png",
  "/demo/setting-shots/daily-carry.png",
];

export const channels: Record<AllChannelKey, ChannelConfig> = {
  qoo10: { name: "Qoo10 Japan", market: "일본", color: "#ff5e62", letter: "Q", enabled: true },
  shopee: { name: "Shopee Singapore", market: "싱가포르", color: "#ff7426", letter: "S", enabled: true },
  lazada: { name: "Lazada Malaysia", market: "말레이시아", color: "#7357ff", letter: "L", enabled: true },
  coupang: { name: "쿠팡", market: "대한민국", color: "#e8344e", letter: "C", enabled: true },
  elevenst: { name: "11번가", market: "대한민국", color: "#ff2d55", letter: "11", enabled: true },
  smartstore: { name: "네이버 스마트스토어", market: "대한민국", color: "#03c75a", letter: "N", enabled: true },
  ebay: { name: "eBay Global", market: "글로벌", color: "#3665f3", letter: "E", enabled: true },
  alibaba: { name: "Alibaba.com", market: "글로벌 B2B", color: "#ff6a00", letter: "A", enabled: false },
  one688: { name: "1688.com", market: "중국 내수 B2B", color: "#ff7300", letter: "1688", enabled: false },
};

export const products = [
  { id: "SP-240815-001", name: "화이트토마토 글루타치온 30정", sku: "IB-WTG-30", image: productImages[0], stock: 86, sales: 382, revenue: "₩12,864,000", status: "판매중", channels: ["Q", "S", "L", "C", "11", "N", "E"] },
  { id: "SP-240813-018", name: "저분자 피쉬콜라겐 60포", sku: "IB-FC-60", image: productImages[1], stock: 42, sales: 247, revenue: "₩8,306,000", status: "판매중", channels: ["Q", "S", "C", "N"] },
  { id: "SP-240811-042", name: "비타민C 구미 90정", sku: "IB-VCG-90", image: productImages[2], stock: 18, sales: 196, revenue: "₩5,782,000", status: "재고주의", channels: ["Q", "S", "L", "11", "N", "E"] },
  { id: "SP-240809-011", name: "프로바이오틱스 데일리 30포", sku: "IB-PRO-30", image: productImages[3], stock: 0, sales: 121, revenue: "₩4,114,000", status: "품절", channels: ["S", "L", "C", "11"] },
  { id: "SP-240806-007", name: "세라마이드 모이스처 크림", sku: "IB-CER-50", image: productImages[0], stock: 73, sales: 98, revenue: "₩3,188,000", status: "판매중", channels: ["Q", "L", "N", "E"] },
  { id: "SP-240804-029", name: "레티놀 퍼밍 나이트 세럼", sku: "SK-RTN-30", image: productImages[1], stock: 64, sales: 84, revenue: "₩2,940,000", status: "판매중", channels: ["Q", "S", "L", "C", "N"] },
  { id: "SP-240801-014", name: "유기농 제주 말차 스틱 20포", sku: "FD-MTC-20", image: productImages[2], stock: 27, sales: 76, revenue: "₩2,128,000", status: "판매중", channels: ["Q", "S", "11", "E"] },
  { id: "SP-240729-005", name: "멀티비타민 미네랄 데일리", sku: "HL-MVM-60", image: productImages[3], stock: 9, sales: 61, revenue: "₩1,982,000", status: "재고주의", channels: ["S", "L", "C", "N"] },
  { id: "SP-240726-032", name: "콜드브루 콜라겐 젤리 14포", sku: "IB-CBJ-14", image: productImages[0], stock: 51, sales: 48, revenue: "₩1,536,000", status: "판매중", channels: ["C", "11", "N"] },
  { id: "SP-240722-016", name: "제주 비자림 클렌징 밤", sku: "SK-BJR-80", image: productImages[1], stock: 34, sales: 37, revenue: "₩1,184,000", status: "판매중", channels: ["Q", "L", "E"] },
];

export const orders = [
  { id: "QT-8603921", channel: "Q", customer: "Yuki Tanaka", product: "화이트토마토 글루타치온 30정", amount: "¥4,280", status: "결제완료", time: "오늘 14:32" },
  { id: "SP-5920248", channel: "S", customer: "Chloe Lim", product: "저분자 피쉬콜라겐 60포", amount: "S$44.90", status: "출고대기", time: "오늘 14:08" },
  { id: "LZ-1485027", channel: "L", customer: "Nur Aisyah", product: "비타민C 구미 90정", amount: "RM128.00", status: "배송중", time: "오늘 13:41" },
  { id: "QT-8603774", channel: "Q", customer: "Haruka Sato", product: "프로바이오틱스 데일리 30포", amount: "¥3,890", status: "결제완료", time: "오늘 12:56" },
  { id: "SP-5919821", channel: "S", customer: "Amelia Ong", product: "세라마이드 모이스처 크림", amount: "S$38.50", status: "배송완료", time: "오늘 11:22" },
  { id: "LZ-1484739", channel: "L", customer: "Siti Hajar", product: "레티놀 퍼밍 나이트 세럼", amount: "RM139.00", status: "출고대기", time: "오늘 10:48" },
  { id: "QT-8603512", channel: "Q", customer: "Rina Kobayashi", product: "유기농 제주 말차 스틱 20포", amount: "¥3,240", status: "배송중", time: "오늘 09:51" },
  { id: "SP-5919504", channel: "S", customer: "Marcus Lee", product: "멀티비타민 미네랄 데일리", amount: "S$35.90", status: "배송완료", time: "오늘 09:17" },
  { id: "CP-7402851", channel: "C", customer: "이수민", product: "콜드브루 콜라겐 젤리 14포", amount: "₩32,000", status: "결제완료", time: "오늘 08:54" },
  { id: "11-2084176", channel: "11", customer: "박서준", product: "비타민C 구미 90정", amount: "₩29,500", status: "출고대기", time: "오늘 08:31" },
  { id: "NV-6381920", channel: "N", customer: "김하은", product: "세라마이드 모이스처 크림", amount: "₩32,800", status: "배송중", time: "오늘 08:06" },
  { id: "EB-5840219", channel: "E", customer: "Olivia Smith", product: "제주 비자림 클렌징 밤", amount: "$34.00", status: "결제완료", time: "오늘 07:42" },
];

export const tickets: Ticket[] = [
  { id: "CS-2841", customer: "Yuki Tanaka", channel: "Qoo10", subject: "배송 조회가 되지 않아요", preview: "주문한 지 3일이 지났는데 아직 송장 조회가…", time: "8분 전", status: "긴급" },
  { id: "CS-2839", customer: "Nur Aisyah", channel: "Lazada", subject: "복용 방법 문의", preview: "Can I take two tablets at once after a meal?", time: "21분 전", status: "답변 대기" },
  { id: "CS-2837", customer: "Chloe Lim", channel: "Shopee", subject: "옵션 변경 요청", preview: "I selected the wrong option. Could you change…", time: "46분 전", status: "처리 중" },
  { id: "CS-2835", customer: "Rina Kobayashi", channel: "Qoo10", subject: "선물 포장 가능 여부", preview: "プレゼント用の包装はできますか？", time: "1시간 전", status: "답변 대기" },
  { id: "CS-2832", customer: "Siti Hajar", channel: "Lazada", subject: "성분표 확인 요청", preview: "Could you share the full ingredient list?", time: "2시간 전", status: "답변 대기" },
  { id: "CS-2828", customer: "Marcus Lee", channel: "Shopee", subject: "배송지 변경", preview: "Please update my delivery address before shipping.", time: "3시간 전", status: "처리 중" },
  { id: "CS-2826", customer: "김하은", channel: "네이버 스마트스토어", subject: "오늘 출고 가능한가요?", preview: "오후 주문인데 오늘 출고 가능한지 궁금해요.", time: "4시간 전", status: "답변 대기" },
  { id: "CS-2823", customer: "Olivia Smith", channel: "eBay", subject: "International shipping", preview: "Is tracking included for international delivery?", time: "5시간 전", status: "처리 중" },
];
