"use client";
import { useEffect,useRef,useState } from "react";
import { activeChannelKeys,channelCatalog } from "../../lib/channels/catalog";
import { archiveFiltersSchema,archivePageSchema,type ArchiveFilters,type ArchivePage } from "../../lib/cs/archive";
import { ConversationTimeline } from "./conversation-timeline";
import { LazadaQuarantine } from "./lazada-quarantine";
import { LazadaRawInbox } from "./lazada-raw-inbox";
import { CsHistoryCoverage } from "./history-coverage";
import { CsScopeHealth } from "./scope-health";
import { CsCapabilityInventory } from "./capability-inventory";
import { CsCredentialBindings } from "./credential-bindings";
import { CsImportStaging } from "./import-staging";
import { CsOrderBindingHealth } from "./order-binding-health";
import { CsRecoveryReadiness } from "./recovery-readiness";
import { ShopeeHistoryProgress } from "./channels/shopee/history-progress";
import { ElevenstReadStatePanel } from "./channels/elevenst/read-state";
import styles from "./archive.module.css";

type FetchArchive=(input:string,init?:RequestInit)=>Promise<Response>;
const statuses={waiting:"미답변",urgent:"긴급",in_progress:"처리 중",resolved:"완료"};
export function CsArchive({authenticatedFetch}:{authenticatedFetch:FetchArchive}){
 const [query,setQuery]=useState("");const [channel,setChannel]=useState("");const [status,setStatus]=useState("");
 const [from,setFrom]=useState("");const [to,setTo]=useState("");const [page,setPage]=useState<ArchivePage|null>(null);
 const [accountId,setAccountId]=useState("");const [shopId,setShopId]=useState("");
 const [ticketKind,setTicketKind]=useState("");const [source,setSource]=useState("");
 const [selected,setSelected]=useState<ArchivePage["tickets"][number]|null>(null);
 const [error,setError]=useState("");const [loading,setLoading]=useState(false);
 const controller=useRef<AbortController|null>(null);const generation=useRef(0);
 const filters=useRef<ArchiveFilters|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const search=async(more=false)=>{
  const parsed=archiveFiltersSchema.safeParse(more?filters.current:{query,channel:channel||null,status:status||null,from:from||null,to:to||null,
   accountId:accountId||null,shopId:shopId||null,ticketKind:ticketKind||null,source:source||null});
  if(!parsed.success){setError("검색어는 120자 이내이며 시작일은 종료일보다 늦을 수 없습니다.");return;}
  if(more&&!page?.nextCursor)return;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const run=++generation.current;
  setLoading(true);setError("");
  if(!more){setPage(null);setSelected(null);filters.current=parsed.data;}
  const params=new URLSearchParams();for(const [key,value] of Object.entries(parsed.data))if(value)params.set(key,value);
  if(more&&page?.nextCursor)params.set("cursor",JSON.stringify(page.nextCursor));
  try{
   const response=await authenticatedFetch(`/api/admin/cs/archive?${params}`,{cache:"no-store",signal:abort.signal});
   if(!response.ok)throw new Error("archive unavailable");const next=archivePageSchema.parse(await response.json());
   if(abort.signal.aborted||run!==generation.current)return;
   setPage(current=>({...next,tickets:more?[...new Map([...(current?.tickets??[]),...next.tickets].map(ticket=>[ticket.id,ticket])).values()]:next.tickets}));
  }catch{if(!abort.signal.aborted&&run===generation.current){setPage(null);setSelected(null);setError("보관 문의 검색에 실패했습니다. 다시 검색해 주세요.");}}
  finally{if(run===generation.current)setLoading(false);}
 };
 return <><CsCapabilityInventory /><ElevenstReadStatePanel authenticatedFetch={authenticatedFetch} /><CsCredentialBindings authenticatedFetch={authenticatedFetch} /><CsScopeHealth authenticatedFetch={authenticatedFetch} /><CsOrderBindingHealth authenticatedFetch={authenticatedFetch} /><CsHistoryCoverage authenticatedFetch={authenticatedFetch} /><ShopeeHistoryProgress authenticatedFetch={authenticatedFetch} /><CsImportStaging authenticatedFetch={authenticatedFetch} /><CsRecoveryReadiness authenticatedFetch={authenticatedFetch} /><LazadaRawInbox authenticatedFetch={authenticatedFetch} /><LazadaQuarantine authenticatedFetch={authenticatedFetch} /><details className={`panel ${styles.archive}`}><summary>전체 보관 문의 검색 · 과거 대화 보기</summary>
  <p>이미 수집한 문의와 판매자 답변을 전체 기간에서 검색합니다. 기간은 한국 시간의 문의 등록일 기준입니다.</p>
  <form className={styles.filters} onSubmit={event=>{event.preventDefault();void search();}}>
   <label>검색어<input value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} placeholder="문의번호, 고객명, 질문·답변 원문" /></label>
   <label>판매채널<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">전체 채널</option>{activeChannelKeys.map(key=><option key={key} value={key}>{channelCatalog[key].name}</option>)}</select></label>
   <label>처리 상태<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">모든 상태</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>연결 계정 ID<input value={accountId} onChange={e=>setAccountId(e.target.value)} placeholder="자격증명 UUID" /></label>
   <label>Shop ID<input value={shopId} maxLength={120} onChange={e=>setShopId(e.target.value)} placeholder="shop 또는 seller ID" /></label>
   <label>문의 종류<select value={ticketKind} onChange={e=>setTicketKind(e.target.value)}><option value="">모든 종류</option><option value="conversation">고객 대화</option><option value="after_sales">반품·환불</option></select></label>
   <label>수집 출처<select value={source} onChange={e=>setSource(e.target.value)}><option value="">모든 출처</option><option value="channel">채널 수집 원장</option><option value="legacy_ticket">이전 문의 원장</option></select></label>
   <label>시작일<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
   <label>종료일<input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
   <button type="submit" className="filter-button" disabled={loading}>{loading?"검색 중…":"보관 문의 검색"}</button>
  </form>
  {error?<p role="alert">{error}</p>:null}
  {page?<p role="status">현재 {page.tickets.length}건 표시{page.nextCursor?" · 더 많은 결과가 있습니다.":" · 검색 결과 끝"}</p>:null}
  <div className={styles.results}>{page?.tickets.map(ticket=><button key={ticket.id} type="button" aria-pressed={selected?.id===ticket.id} onClick={()=>setSelected(ticket)}>
   <span>{channelCatalog[ticket.channel].name} · {statuses[ticket.status]} · {ticket.ticketKind==="after_sales"?"반품·환불":"고객 대화"} · {ticket.source==="channel"?"채널 수집":"이전 원장"} · {new Date(ticket.receivedAt).toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"})}
    {ticket.latestMessageState==="recalled"?" · 최신 메시지 회수됨":ticket.latestMessageState==="conflict_review_required"?" · 메시지 변경 검토 필요":""}
   </span>
   <strong>{ticket.subject}</strong><span>{ticket.customer} · {ticket.externalId}</span><p>{ticket.preview}</p>
  </button>)}</div>
  {page?.nextCursor?<button type="button" className="filter-button" disabled={loading} onClick={()=>void search(true)}>검색 결과 더 보기</button>:null}
  {selected?<section className={styles.detail} aria-label="보관 문의 대화"><h3>{selected.subject}</h3><p>{channelCatalog[selected.channel].name} · {selected.externalId}</p>
   <ConversationTimeline key={selected.id} ticketId={selected.id} refreshKey={page?.asOf??""} authenticatedFetch={authenticatedFetch}/>
  </section>:null}
 </details></>;
}
