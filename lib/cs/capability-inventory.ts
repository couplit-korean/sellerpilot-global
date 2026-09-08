import type { ActiveChannelKey } from "../channels/catalog";
export type CsCapabilityState="implemented"|"conditional"|"permission_pending"|"provider_unavailable"|"unverified";
export type CsCapabilitySurface={key:string;label:string;state:CsCapabilityState;receive:boolean;reply:boolean;history:boolean;attachments:boolean;note:string};
export const csCapabilityInventory:Record<ActiveChannelKey,CsCapabilitySurface[]>={
 qoo10:[
 {key:"qna",label:"MSG·HELP·ITEM 문의",state:"implemented",receive:true,reply:true,history:true,attachments:false,note:"날짜 분할 조회와 문의번호·순번 결속"},
  {key:"after_sales",label:"취소·반품·교환 클레임",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"공식 GetClaimInfo_V3를 요청일 기준 최대 90일 범위로 조회; 주문번호·사유·상태·배송만 보관하고 주소·연락처·구매자 ID와 mutation은 제외, 운영 readback 필요"},
  {key:"seller_chat",label:"판매자 채팅·긴 대화",state:"unverified",receive:false,reply:false,history:false,attachments:false,note:"QAPI 문의 계약과 별도 표면인지 원격 ID 대조 필요"},
  {key:"review",label:"상품 리뷰·댓글",state:"provider_unavailable",receive:false,reply:false,history:false,attachments:true,note:"QSM에는 별도 리뷰 관리 화면이 있지만 현재 공식 QAPI 전체 Method 목록에는 리뷰 조회·댓글 API가 없음"},
 ],
 shopee:[
  {key:"product_review",label:"상품 후기",state:"implemented",receive:true,reply:true,history:true,attachments:true,note:"OAuth Shop별 get_comment·reply_comment"},
  {key:"buyer_chat",label:"Buyer Chat",state:"provider_unavailable",receive:false,reply:false,history:false,attachments:false,note:"현재 승인된 공개 계약과 전용 webhook/history/reply 미확보"},
  {key:"return_refund",label:"반품·환불 작업함",state:"conditional",receive:true,reply:false,history:true,attachments:true,note:"Returns 목록·상세, 15일 창, 사유·협상·기한·구매자 첨부 구현; 실제 shop 권한 readback 필요"},
 ],
 lazada:[
  {key:"im",label:"IM Chat",state:"conditional",receive:true,reply:true,history:true,attachments:true,note:"bootstrap·Push·답변 구현, CS Bot app/token 실제 grant 결속 필요"},
  {key:"im_cards",label:"상품·주문·쿠폰 카드",state:"conditional",receive:true,reply:false,history:true,attachments:true,note:"native template 투영, 지원하지 않는 type은 원문 격리"},
 ],
 coupang:[
  {key:"product_qna",label:"상품 문의",state:"implemented",receive:true,reply:true,history:true,attachments:false,note:"판매자·고정 IP·문의 ID 결속"},
  {key:"call_center",label:"콜센터 문의",state:"implemented",receive:true,reply:true,history:true,attachments:false,note:"상품 문의와 별도 kind로 유지"},
  {key:"claims",label:"취소·반품·교환 상담",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"공식 반품·취소·교환 목록을 주문번호에 연결하고 사유·상태만 보관; 연락처·주소와 클레임 mutation은 제외, 실제 권한 readback 필요"},
 ],
 elevenst:[
  {key:"product_qna",label:"상품 Q&A",state:"conditional",receive:true,reply:true,history:true,attachments:false,note:"공식 최대 7일 목록 조회와 brdInfoNo·prdNo 결속 답변 구현; couplit 계정 로그인과 API 관리 화면 확인, 운영 Key로 원격 읽기 readback 필요"},
  {key:"seller_talk",label:"셀러톡",state:"unverified",receive:false,reply:false,history:false,attachments:false,note:"상품 Q&A와 합치지 않음"},
  {key:"urgent_inquiry",label:"긴급알리미 고객 문의",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"공식 GET result_code 0과 emerNtceClfNo1 10만 수신; 고객 ID 제외, 답변 PUT은 미개방"},
  {key:"urgent_notice",label:"긴급알리미 시스템 알림",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"공식 GET result_code 0과 emerNtceClfNo1 11만 시스템 발신으로 보존; 고객 문의와 분리"},
  {key:"review",label:"리뷰",state:"provider_unavailable",receive:false,reply:false,history:false,attachments:false,note:"현재 인증된 상품 Q&A 공식 가이드에는 목록 조회·답변 처리만 있으며 구매후기 조회·댓글 계약은 확인되지 않음"},
 ],
 smartstore:[
  {key:"product_qna",label:"상품 문의",state:"implemented",receive:true,reply:true,history:true,attachments:false,note:"questionId 결속"},
  {key:"customer_inquiry",label:"네이버페이 고객 문의",state:"implemented",receive:true,reply:true,history:true,attachments:false,note:"inquiryNo 결속 · 공식 상품·배송·반품·교환·환불·기타 분류 포함"},
  {key:"talktalk",label:"톡톡",state:"provider_unavailable",receive:false,reply:false,history:false,attachments:false,note:"현재 커머스 API 2종 수집과 별도"},
  {key:"review",label:"상품 리뷰",state:"provider_unavailable",receive:false,reply:false,history:false,attachments:false,note:"현재 Commerce API 문의 목차는 상품 문의·고객 문의만 제공하며 리뷰 조회·답변 API는 없음"},
 ],
 ebay:[
 {key:"asq",label:"Ask Seller Question",state:"conditional",receive:true,reply:true,history:true,attachments:false,note:"provider 인증 계정·site·parent·recipient가 일치할 때만 답변"},
  {key:"mailbox",label:"Trading Inbox",state:"implemented",receive:true,reply:false,history:true,attachments:true,note:"25 headers 후 최대 10 ID씩 본문 조회; 일반 답변은 미개방"},
  {key:"commerce_message",label:"Commerce Message 일반 대화",state:"conditional",receive:true,reply:true,history:true,attachments:true,note:"10개 대화·25개 메시지 continuation과 별도 conversation 답변 구현; commerce.message 권한 재동의·HTTP 200 필요"},
  {key:"case_dispute",label:"케이스·분쟁",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"케이스·결제분쟁 조회와 저장 이력 구현; 운영 적용·자동 수집 검증 및 결제분쟁 접근 확인 필요"},
 ],
 temu:[
  {key:"after_sales",label:"반품·환불 작업함",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"공식 목록·상세를 초 단위 기간과 10건 continuation으로 조회; 구매자 사유·환불 증거 저장, 승인 mutation은 분리"},
  {key:"buyer_chat",label:"Buyer Chat",state:"permission_pending",receive:false,reply:false,history:false,attachments:false,note:"Partner 앱 활성·승인·공식 계약 필요"},
 ],
};
export const csCapabilityTotals=Object.values(csCapabilityInventory).flat().reduce((totals,item)=>({
 total:totals.total+1,implemented:totals.implemented+(item.state==="implemented"?1:0),conditional:totals.conditional+(item.state==="conditional"?1:0),blocked:totals.blocked+(["permission_pending","provider_unavailable","unverified"].includes(item.state)?1:0),
}),{total:0,implemented:0,conditional:0,blocked:0});
