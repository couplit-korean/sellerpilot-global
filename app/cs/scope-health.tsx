"use client";
import { useEffect,useRef,useState } from "react";
import { channelCatalog } from "../../lib/channels/catalog";
import { csScopeHealthSchema,type CsScopeHealth } from "../../lib/cs/scope-health";
import styles from "./lazada-quarantine.module.css";
type AuthenticatedFetch=(input:string,init?:RequestInit)=>Promise<Response>;
const time=(value:string|null)=>value?new Date(value).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"관측 없음";
const labels={needs_attention:"확인 필요",unverified:"미검증",zero_unverified:"0건·전량 미확정",observed:"수신 관측"} as const;
export function CsScopeHealth({authenticatedFetch}:{authenticatedFetch:AuthenticatedFetch}){
 const [health,setHealth]=useState<CsScopeHealth|null>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState("");const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 const load=async()=>{abort.current?.abort();const controller=new AbortController();abort.current=controller;setLoading(true);setError("");
  try{const response=await authenticatedFetch("/api/admin/cs/scope-health",{cache:"no-store",signal:controller.signal});if(!response.ok)throw new Error();const next=csScopeHealthSchema.parse(await response.json());if(!controller.signal.aborted)setHealth(next);}
  catch{if(!controller.signal.aborted){setHealth(null);setError("범위별 상태를 조회하지 못했습니다.");}}finally{if(!controller.signal.aborted)setLoading(false);}};
 return <details className={`panel ${styles.panel}`}><summary>계정·Shop·문의종류별 연결 상태</summary><p>한 계정의 성공으로 다른 Shop 실패를 가리지 않습니다. 0건 성공도 과거 전량 완료로 계산하지 않습니다.</p>
  <button type="button" className="filter-button" disabled={loading} onClick={()=>void load()}>{loading?"조회 중…":"범위별 상태 조회"}</button>{error?<p role="alert">{error}</p>:null}
  <div className={styles.messages}>{health?.scopes.map(scope=><article key={`${scope.credentialId}:${scope.shopId??"all"}:${scope.ticketKind}`}><header><strong>{channelCatalog[scope.channel].name} · {scope.shopId??"Shop 미분리"} · {scope.ticketKind==="after_sales"?"반품·환불":"고객 대화"}</strong><span>{labels[scope.state]}</span></header><dl>
   <div><dt>자격·권한</dt><dd>{scope.credentialStatus} · {scope.permissionStatus} · 만료 {time(scope.credentialExpiresAt)}</dd></div><div><dt>최근 시도/성공</dt><dd>{time(scope.lastAttemptAt)} / {time(scope.lastSuccessAt)}</dd></div><div><dt>최근 고객 수신</dt><dd>{time(scope.lastInboundAt)}</dd></div><div><dt>대기·불확실</dt><dd>{scope.pendingReplyCount} / {scope.uncertainReplyCount} · 최장 {scope.queueAgeSeconds===null?"없음":`${scope.queueAgeSeconds}초`}</dd></div><div><dt>과거 누락·속도 재개</dt><dd>{scope.archiveGapCount}개 · {time(scope.rateLimitRetryAt)}</dd></div>
  </dl></article>)}</div></details>;
}
