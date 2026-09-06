"use client";
import { useMemo, useState } from "react";
import type { ActiveChannelKey } from "../lib/channels/catalog";
import { channelRegistrationFields, registrationValueAt, type RegistrationValue, type RegistrationRequirement } from "../lib/channel-registration-form";
import {
  asRegistrationValue,
  coupangCommonLeadTimeDay,
  coupangDraftPackagingRule,
  coupangDraftShippingRule,
  coupangLeadTimeConfirmationPath,
  coupangLeadTimeItemPaths,
  isCoupangStructuredShippingPath,
  readCoupangLeadTimeDraftConfirmation,
  updateCoupangLeadTimeDraftConfirmation,
} from "../lib/channels/coupang-registration-input";

type Props = { channel: ActiveChannelKey; draft: Record<string,unknown>; requirements: RegistrationRequirement[]; editedPaths: string[]; onChange:(path:string[],value:RegistrationValue)=>void };
export function ChannelRegistrationFields({channel,draft,requirements,editedPaths,onChange}:Props) {
  const [view,setView]=useState<"review"|"all">("review");
  const [search,setSearch]=useState("");
  const [noticeError,setNoticeError]=useState("");
  const fields=useMemo(()=>channelRegistrationFields(channel,draft,requirements).filter((field)=>
    channel!=="coupang" || !isCoupangStructuredShippingPath(field.path)),[channel,draft,requirements]);
  const visible=fields.filter(field=>(view==="all"||field.required||field.issue) && (!search || field.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  const runtime=requirements.filter(field=>field.status==="runtime");
  const envelope=registrationValueAt(draft,["facts","noticeContent"]);
  let notices: {noticeCategoryName:string;details:Record<string,string>}={noticeCategoryName:"",details:{}};
  try { const parsed=typeof envelope==="string"?JSON.parse(envelope):envelope; if(parsed && typeof parsed==="object" && typeof parsed.noticeCategoryName==="string" && parsed.details && typeof parsed.details==="object" && !Array.isArray(parsed.details)) notices=parsed; } catch { /* Preserve the original draft; show editable fields without rewriting it. */ }
  const nativeNotices=registrationValueAt(draft,["body","items","0","notices"]);
  const hasNativeNotices=Array.isArray(nativeNotices);
  const noticeRows: Array<{noticeCategoryName:string;noticeCategoryDetailName:string;content:string}> = hasNativeNotices
    ? nativeNotices.map(row=>({noticeCategoryName:String(row?.noticeCategoryName??""),noticeCategoryDetailName:String(row?.noticeCategoryDetailName??""),content:String(row?.content??"")}))
    : Object.entries(notices.details).map(([name,value])=>({noticeCategoryName:notices.noticeCategoryName,noticeCategoryDetailName:name,content:String(value)}));
  const noticeGroup=hasNativeNotices?noticeRows[0]?.noticeCategoryName??notices.noticeCategoryName:notices.noticeCategoryName;
  const coupangShippingRule=channel==="coupang"?coupangDraftShippingRule(draft):"";
  const coupangPackagingRule=channel==="coupang"?coupangDraftPackagingRule(draft):"";
  const coupangShippingRuleReview=registrationValueAt(draft,["sellerpilotAssets","shipping","shippingRuleReview"]);
  const coupangPackagingRuleReview=registrationValueAt(draft,["sellerpilotAssets","shipping","packagingRuleReview"]);
  const coupangLeadTime=readCoupangLeadTimeDraftConfirmation(draft);
  const coupangItemPaths=channel==="coupang"?coupangLeadTimeItemPaths(draft):[];
  const coupangCommonDay=coupangCommonLeadTimeDay(draft);
  const coupangRequirement=(key:string)=>requirements.find((requirement)=>requirement.key===key);
  const writeCoupangConfirmation=(update:Parameters<typeof updateCoupangLeadTimeDraftConfirmation>[1])=>
    onChange([...coupangLeadTimeConfirmationPath],asRegistrationValue(updateCoupangLeadTimeDraftConfirmation(draft,update)));
  const writeNotices=(rows:typeof noticeRows,group=noticeGroup)=>{
    setNoticeError("");
    if(hasNativeNotices || Array.isArray(nativeNotices)) {
      onChange(["body","items","0","notices"],rows);
      // Keep the optional envelope in sync so its previous values cannot override a native edit.
      if(envelope!=null) onChange(["facts","noticeContent"],{noticeCategoryName:group,details:Object.fromEntries(rows.map(row=>[row.noticeCategoryDetailName,row.content]))});
    } else onChange(["facts","noticeContent"],{noticeCategoryName:group,details:Object.fromEntries(rows.map(row=>[row.noticeCategoryDetailName,row.content]))});
  };
  return <section className="registration-channel-form" aria-label="채널별 상품정보 입력">
    <div className="registration-form-toolbar"><div role="group" aria-label="입력 항목 보기"><button type="button" aria-pressed={view==="review"} onClick={()=>setView("review")}>필수·확인 항목</button><button type="button" aria-pressed={view==="all"} onClick={()=>setView("all")}>전체 항목 ({fields.length})</button></div><label><span className="registration-search-label">항목 찾기</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="상품명, 배송비, 고시…" /></label></div>
    <p className="registration-form-explanation">자동 입력값을 확인하고 필요한 부분을 수정하세요. 공통정보는 위에서 한 번에 바꾸고, 이 채널에서만 다른 값은 여기에서 보완할 수 있습니다.</p>
    <div className="registration-field-grid">{visible.map(field=>{
      const key=JSON.stringify(field.path), edited=editedPaths.includes(key);
      const value=field.value==null?"":typeof field.value==="object"?"":String(field.value);
      const longText=/description|content|detail|html|guide|material|성분|설명|안내/i.test(field.path.at(-1)??"") || value.length>180;
      const inputProps={id:`${channel}-registration-${encodeURIComponent(field.path.join("/"))}`,"aria-invalid":Boolean(field.issue),"aria-describedby":field.help?`${channel}-${encodeURIComponent(key)}-help`:undefined};
      const change=(text:string)=>onChange(field.path,field.inputType==="number" ? (text===""?null:Number(text)) : field.inputType==="boolean" ? (text===""?null:text==="true") : text);
      return <label className={`registration-field ${field.issue?"needs-review":""}`} key={key}><span className="registration-field-title"><b>{field.label}</b><small>{field.required?"필수":"추가정보"}</small></span><span className={`registration-value-source ${edited?"human":""}`}>{edited?"직접 수정":value===""?"입력 필요":"자동 입력 · 검토 가능"}</span>{field.inputType==="boolean"?<select {...inputProps} value={value} onChange={event=>change(event.target.value)}><option value="">확인 후 선택</option><option value="true">예</option><option value="false">아니요</option></select>:field.options?<select {...inputProps} value={value} onChange={event=>change(event.target.value)}><option value="">단위 선택</option>{field.options.map(option=><option key={option}>{option}</option>)}</select>:longText?<textarea {...inputProps} rows={3} value={value} onChange={event=>change(event.target.value)} />:<input {...inputProps} type={field.inputType==="number"?"number":"text"} step={field.inputType==="number"?"any":undefined} value={value} onChange={event=>change(event.target.value)} />}{field.issue&&<small className="registration-field-error">{field.issue}</small>}{field.help&&<small id={`${channel}-${encodeURIComponent(key)}-help`}>{field.help}</small>}</label>;
    })}</div>
    {!visible.length&&<p className="registration-empty">{search?"일치하는 항목이 없습니다.":"현재 보기에서 추가로 입력할 항목이 없습니다. 전체 항목에서 자동 입력값을 확인할 수 있습니다."}</p>}
    {channel==="coupang"&&<fieldset className="registration-shipping-form"><legend>쿠팡 출고 설정 확인</legend><p>WING의 현재 설정에서 출고 소요일과 기준을 직접 대조하세요. 문구의 범위나 기본값으로 일수를 추정하지 않습니다.</p>
      <label><span>승인된 배송 규칙</span><textarea rows={2} value={coupangShippingRule} readOnly /></label>
      {coupangShippingRule&&<label><span>배송 규칙 적용 확인</span><select value={coupangShippingRuleReview==="확인"?"확인":""} onChange={event=>onChange(["sellerpilotAssets","shipping","shippingRuleReview"],event.target.value)}><option value="">확인 필요</option><option value="확인">확인</option></select>{coupangRequirement("shipping-shippingRule")?.status==="manual"&&<small className="registration-field-error">현재 승인 규칙이 실제 출고 절차에 적용되는지 확인하세요.</small>}</label>}
      {coupangPackagingRule&&<><label><span>승인된 포장 규칙</span><textarea rows={2} value={coupangPackagingRule} readOnly /></label><label><span>포장 규칙 적용 확인</span><select value={coupangPackagingRuleReview==="확인"?"확인":""} onChange={event=>onChange(["sellerpilotAssets","shipping","packagingRuleReview"],event.target.value)}><option value="">확인 필요</option><option value="확인">확인</option></select>{coupangRequirement("shipping-packagingRule")?.status==="manual"&&<small className="registration-field-error">현재 포장 규칙이 실제 포장 절차에 적용되는지 확인하세요.</small>}</label></>}
      {coupangItemPaths.length>0&&<label><span>{coupangItemPaths.length===1?"상품 1 출고 소요일":"모든 상품 공통 출고 소요일"}</span><input type="number" min="1" step="1" value={coupangCommonDay.day??""} onChange={event=>{const next=event.target.value===""?null:Number(event.target.value);for(const path of coupangItemPaths)onChange(path,next);writeCoupangConfirmation({outboundShippingTimeDay:next});}} />{coupangItemPaths.some((_,index)=>coupangRequirement(`shipping-lead-time-${index}`)?.status==="manual")&&<small className="registration-field-error">WING에서 확인한 양의 정수 API 일수를 입력하고 아래 기준을 확인하세요. 이 확인값은 모든 상품 항목에 동일하게 적용됩니다.</small>}</label>}
      {coupangCommonDay.inconsistent&&<p className="registration-field-error">상품별 출고 소요일이 서로 달라 단일 확인 근거와 일치하지 않습니다. WING에서 공통 일수를 확인해 다시 입력하세요. 현재 값: {coupangCommonDay.itemValues.map((value,index)=>`상품 ${index+1} ${value??"미입력"}`).join(" · ")}</p>}
      {!coupangItemPaths.length&&<p className="registration-field-error">등록할 쿠팡 상품 항목이 없어 출고 소요일을 확인할 수 없습니다.</p>}
      <label className="registration-confirmation-check"><input type="checkbox" checked={coupangLeadTime.orderDateAndCalendarConfirmed} onChange={event=>writeCoupangConfirmation({orderDateAndCalendarConfirmed:event.target.checked})} /><span>주문일 기준, 마감시간, 판매자 배송달력을 WING에서 확인했습니다.</span></label>
      <label className="registration-confirmation-check"><input type="checkbox" checked={coupangLeadTime.approvedPromiseMatched} onChange={event=>writeCoupangConfirmation({approvedPromiseMatched:event.target.checked})} /><span>입력한 API 일수가 현재 승인된 출고 약속과 일치합니다.</span></label>
      <label className="registration-confirmation-check"><input type="checkbox" checked={coupangLeadTime.sameDayShipping===false} onChange={event=>writeCoupangConfirmation({sameDayShipping:event.target.checked?false:null})} /><span>이 상품은 당일출고 계약이 아닌 일반배송입니다.</span></label>
      {coupangRequirement("shipping-lead-time-confirmation")?.status==="manual"&&<small className="registration-field-error">출고 소요일과 세 확인 항목이 모두 필요합니다.</small>}
      <small>확인 결과는 구조화된 등록 근거로 초안에 저장됩니다. 원본 내부 데이터나 인증정보는 표시하지 않습니다.</small>
    </fieldset>}
    {channel==="coupang"&&<fieldset className="registration-notice-form"><legend>상품정보제공고시</legend><p>카테고리에서 확인한 고시 상품군과 항목별 내용을 확인·보완하세요.</p><label><span>고시 상품군</span><input value={noticeGroup} onChange={event=>{const group=event.target.value;if(!noticeRows.length)onChange(["facts","noticeContent"],{noticeCategoryName:group,details:{}});else writeNotices(noticeRows.map(row=>({...row,noticeCategoryName:group})),group);}} /></label>{noticeRows.map((row,index)=><div className="registration-notice-row" key={index}><label><span>고시 항목명</span><input value={row.noticeCategoryDetailName} onChange={event=>{
      const name=event.target.value;
      if(!name.trim() || ["__proto__","constructor","prototype"].includes(name) || noticeRows.some((other,otherIndex)=>otherIndex!==index&&other.noticeCategoryDetailName===name)) {setNoticeError("항목명은 비어 있거나 다른 항목명과 같을 수 없습니다. 기존 내용은 유지했습니다.");return;}
      writeNotices(noticeRows.map((other,otherIndex)=>otherIndex===index?{...other,noticeCategoryDetailName:name}:other));
    }} /></label><label><span>확인한 내용</span><textarea rows={2} value={row.content} onChange={event=>writeNotices(noticeRows.map((other,otherIndex)=>otherIndex===index?{...other,content:event.target.value}:other))} /></label><button type="button" aria-label={`${row.noticeCategoryDetailName||"고시"} 항목 삭제`} onClick={()=>writeNotices(noticeRows.filter((_,otherIndex)=>otherIndex!==index))}>삭제</button></div>)}{noticeError&&<p role="alert" className="registration-field-error">{noticeError}</p>}<button type="button" onClick={()=>{let name="새 항목";let index=1;while(noticeRows.some(row=>row.noticeCategoryDetailName===name))name=`새 항목 ${++index}`;writeNotices([...noticeRows,{noticeCategoryName:noticeGroup,noticeCategoryDetailName:name,content:""}]);}}>고시 항목 추가</button><small>공식 고시 항목과 대조합니다. 입력한 고시는 초안에 저장되고 실제 채널 요청에 포함됩니다.</small></fieldset>}
    {runtime.length>0&&<details className="registration-runtime-fields"><summary>계정·카테고리 자동 확인 {runtime.length}개</summary><ul>{runtime.map(field=><li key={field.key}><b>{field.label}</b><span>{field.help??"등록 전에 채널에서 실제 적용 조건을 확인합니다."}</span></li>)}</ul></details>}
  </section>;
}
