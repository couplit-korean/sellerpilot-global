// Local regression audit only. fetch is replaced; no credentials or provider traffic.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { parseEbayTradingResponse } from '../../lib/channels/protocols.ts';
import { executeEbayInquiry } from '../../lib/channels/ebay-inquiries.ts';
import { executeShopeeInquiry } from '../../lib/channels/shopee-inquiries.ts';
import { executeLazadaInquiry } from '../../lib/channels/lazada-inquiries.ts';
const results = [];
const originalFetch = globalThis.fetch;
try {
  const parsed = parseEbayTradingResponse('GetMyMessages', '<GetMyMessagesResponse><Ack>Success</Ack><Summary/></GetMyMessagesResponse>');
  assert.equal(parsed.summary.totalMessageCount, null);
  results.push({ id: 'REGRESSION-01', finding: 'missing_summary_count_remains_unknown', observed: parsed.summary });
  globalThis.fetch = async () => new Response('<GetMemberMessagesResponse><Ack>Success</Ack><MemberMessage/><PaginationResult><TotalNumberOfPages>2</TotalNumberOfPages><TotalNumberOfEntries>25</TotalNumberOfEntries></PaginationResult><HasMoreItems>true</HasMoreItems></GetMemberMessagesResponse>', {status:200});
  const ebay = await executeEbayInquiry({operation:'inquiries.list',payload:{access_token:'synthetic'},environment:'production',arguments:{marketplaceId:'EBAY_US',startCreationTime:'2026-09-01T00:00:00Z',endCreationTime:'2026-09-07T00:00:00Z',entriesPerPage:25,pageNumber:1}});
  assert.equal(ebay.steps.every(x => x.ok), false);
  assert.equal(ebay.continuationArguments, undefined);
  assert.equal(ebay.steps.at(-1).data.code, 'EBAY_ASQ_PAGINATION_INCONSISTENT');
  results.push({id:'REGRESSION-02',finding:'ebay_empty_page_with_remainder_is_rejected',allStepsOk:false,code:ebay.steps.at(-1).data.code});
  let calls=0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({error:'',response:{item_comment_list:[{comment_id:calls,item_id:1,comment:'synthetic'}],more:true,next_cursor:`cursor-${calls}`}});
  };
  const shopee = await executeShopeeInquiry({operation:'inquiries.list',payload:{partner_id:'1',partner_key:'synthetic',shop_id:'1',access_token:'synthetic'},environment:'production',arguments:{}});
  assert.equal(calls,4);
  assert.equal(shopee.steps.every(x => x.ok),true);
  assert.equal(shopee.continuationArguments.cursor,'cursor-4');
  results.push({id:'REGRESSION-03',finding:'shopee_bounded_page_batch_returns_resumable_cursor',calls,continuation:shopee.continuationArguments.cursor});
  globalThis.fetch = async () => Response.json({code:'0',data:{session_list:[{title:'synthetic missing session identity'}],has_more:false}});
  await assert.rejects(() => executeLazadaInquiry({operation:'inquiries.list',payload:{im_app_key:'1',im_app_secret:'synthetic',im_access_token:'synthetic',country:'sg'},arguments:{bootstrap:true}}), /LAZADA_HISTORY_SESSION_PAGE_INVALID/);
  results.push({id:'REGRESSION-04',finding:'lazada_missing_session_id_is_rejected_by_upstream_validator',classification:'existing_guard_verified'});
} finally { globalThis.fetch=originalFetch; }
const report={kind:'synthetic-local-regression-verification',observedAt:new Date().toISOString(),baseHead:'0a7f5662add45dec9afd7d754beabf01724b1747',providerRequests:0,results};
writeFileSync(new URL('./cs-audit-repro-20260907.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
