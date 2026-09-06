"use client";
import { useEffect,useRef,useState } from "react";
import { activeChannelKeys,channelCatalog } from "../../lib/channels/catalog";
import { archiveFiltersSchema,archivePageSchema,type ArchiveFilters,type ArchivePage } from "../../lib/cs/archive";
import { ConversationTimeline } from "./conversation-timeline";
import styles from "./archive.module.css";

type FetchArchive=(input:string,init?:RequestInit)=>Promise<Response>;
const statuses={waiting:"미답변",urgent:"긴급",in_progress:"처리 중",resolved:"완료"};
export function CsArchive({authenticatedFetch}:{authenticatedFetch:FetchArchive}){
 const [query,setQuery]=useState("");const [channel,setChannel]=useState("");const [status,setStatus]=useState("");
 const [from,setFrom]=useState("");const [to,setTo]=useState("");const [page,setPage]=useState<ArchivePage|null>(null);
 const [selected,setSelected]=useState<ArchivePage["tickets"][number]|null>(null);
 const [error,setError]=useState("");const [loading,setLoading]=useState(false);
 const controller=useRef<AbortController|null>(null);const generation=useRef(0);
 const filters=useRef<ArchiveFilters|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const search=async(more=false)=>{
  const parsed=archiveFiltersSchema.safeParse(more?filters.current:{query,channel:channel||null,status:status||null,from:from||null,to:to||null});
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
  }catch{if(!abort.signal.aborted&&run===generation.current)setError("보관 문의 검색에 실패했습니다. 다시 검색해 주세요.");}
  finally{if(run===generation.current)setLoading(false);}
 };
 return <details className={`panel ${styles.archive}`}><summary>전체 보관 문의 검색 · 과거 대화 보기</summary>
  <p>이미 수집한 문의와 판매자 답변을 전체 기간에서 검색합니다. 기간은 한국 시간의 문의 등록일 기준입니다.</p>
  <form className={styles.filters} onSubmit={event=>{event.preventDefault();void search();}}>
   <label>검색어<input value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} placeholder="문의번호, 고객명, 질문·답변 원문" /></label>
   <label>판매채널<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">전체 채널</option>{activeChannelKeys.map(key=><option key={key} value={key}>{channelCatalog[key].name}</option>)}</select></label>
   <label>처리 상태<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">모든 상태</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>시작일<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
   <label>종료일<input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
   <button type="submit" className="filter-button" disabled={loading}>{loading?"검색 중…":"보관 문의 검색"}</button>
  </form>
  {error?<p role="alert">{error}</p>:null}
  {page?<p role="status">현재 {page.tickets.length}건 표시{page.nextCursor?" · 더 많은 결과가 있습니다.":" · 검색 결과 끝"}</p>:null}
  <div className={styles.results}>{page?.tickets.map(ticket=><button key={ticket.id} type="button" aria-pressed={selected?.id===ticket.id} onClick={()=>setSelected(ticket)}>
   <span>{channelCatalog[ticket.channel].name} · {statuses[ticket.status]} · {new Date(ticket.receivedAt).toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"})}</span>
   <strong>{ticket.subject}</strong><span>{ticket.customer} · {ticket.externalId}</span><p>{ticket.preview}</p>
  </button>)}</div>
  {page?.nextCursor?<button type="button" className="filter-button" disabled={loading} onClick={()=>void search(true)}>검색 결과 더 보기</button>:null}
  {selected?<section className={styles.detail} aria-label="보관 문의 대화"><h3>{selected.subject}</h3><p>{channelCatalog[selected.channel].name} · {selected.externalId}</p>
   <ConversationTimeline key={selected.id} ticketId={selected.id} refreshKey={page?.asOf??""} authenticatedFetch={authenticatedFetch}/>
  </section>:null}
 </details>;
}
