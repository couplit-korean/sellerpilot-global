import type { ActiveChannelKey } from "./channels/catalog";
import type { ListingRequirement } from "./channels/listing-preflight";
export type RegistrationRequirement = Omit<ListingRequirement, "source"> & { source: string };
export type RegistrationValue = string | number | boolean | null | RegistrationValue[] | { [key: string]: RegistrationValue };
export type RegistrationPatch = { path: string[]; value: RegistrationValue };
export type RegistrationField = { path: string[]; label: string; value: RegistrationValue; required: boolean; issue?: string; help?: string; inputType?: "number" | "boolean"; options?: string[] };
const blocked = new Set(["__proto__", "prototype", "constructor"]);
const hidden = new Set(["sellerpilotAssets", "sellerpilotLazadaPricePolicy", "sellerpilotLazadaPricePolicyRequired", "sellerpilotDraftError", "resumeRemoteId", "shopId", "country", "sku"]);
const boundKeys = new Set(["SellerCode", "sellerPrdCd", "sellerManagementCode", "externalVendorSku", "externalGoodsId", "externalSkuId", "SellerSku", "sellerSku", "sku", "marketplaceId", "categoryId", "category_id", "leafCategoryId", "displayCategoryCode", "dispCtgrNo", "SecondSubCat", "PrimaryCategory", "extCatName", "sellerProductId", "productId", "vendorId"]);
const registrationIdentityChangedMessage = "채널 상품 식별 구조(SKU·카테고리)가 변경되어 저장할 수 없습니다. 원래 채널 초안을 다시 불러온 뒤 값만 수정해 주세요.";
const labels: Record<string,string> = {
  ItemTitle:"현지 상품명", PromotionName:"홍보 문구", ItemDescription:"상품 설명", StandardImage:"대표 이미지 주소", ItemPrice:"판매가", RetailPrice:"정가", ItemQty:"판매 가능 수량", ShippingNo:"배송비 코드", AvailableDateType:"출고일 유형", AvailableDateValue:"출고 소요일", ProductionPlace:"원산지", ProductionPlaceType:"원산지 유형", Keyword:"검색어", ExpireDate:"판매 종료일", ContactTel:"고객상담 연락처", TaxRate:"세금 유형", AdultYN:"성인용 여부", IndustrialCode:"상품 바코드", IndustrialCodeType:"바코드 유형", BrandNo:"브랜드 코드", ManufactureNo:"제조사 코드", OuterSecondSubCat:"외부 분류", Drugtype:"의약품 분류", AdditionalOption:"추가 옵션", ItemType:"상품 유형",
  name:"이름", title:"상품명", description:"상품 설명", short_description:"짧은 설명", shortDescription:"짧은 설명", brand:"브랜드", original_brand_name:"브랜드명", manufacturer:"제조사", material:"소재·성분", packageContents:"판매 구성", countryOfOrigin:"원산지", condition:"상품 상태", weightKg:"배송 포장 중량 (kg)", weightAttribute:"판매 단위 순중량", quantityAttribute:"판매 구성 수량", certificationEvidence:"인증 근거", noticeContent:"상품정보제공고시", noticeCategoryName:"고시 상품군", details:"고시 항목", quantity:"판매 가능 수량", normal_stock:"판매 가능 수량", stockQuantity:"판매 가능 수량", global_item_name:"현지 상품명", item_name:"현지 상품명", original_price:"판매가", price:"판매가", value:"값", amount:"금액", currency:"통화", normal_price:"정가", package_content:"판매 구성", package_weight:"배송 포장 중량 (kg)", package_length:"포장 가로 (cm)", package_width:"포장 세로 (cm)", package_height:"포장 높이 (cm)", weight:"배송 포장 중량", length:"가로", width:"세로", height:"높이",
  sellerProductName:"관리용 상품명", displayProductName:"노출 상품명", itemName:"옵션 상품명", generalProductName:"상품 종류", saleStartedAt:"판매 시작일", saleEndedAt:"판매 종료일", deliveryMethod:"배송 방법", deliveryCompanyCode:"택배사 코드", deliveryChargeType:"배송비 유형", deliveryCharge:"배송비", freeShipOverAmount:"무료배송 기준금액", deliveryChargeOnReturn:"최초 배송비", returnCharge:"반품 배송비", outboundShippingPlaceCode:"출고지 코드", returnCenterCode:"반품지 코드", returnChargeName:"반품 수령인", companyContactNumber:"판매자 연락처", returnZipCode:"반품 우편번호", returnAddress:"반품 주소", returnAddressDetail:"반품 상세주소", requested:"판매 승인 요청", originalPrice:"정가", salePrice:"판매가", maximumBuyCount:"판매 가능 수량", maximumBuyForPerson:"1인 최대 구매수량", maximumBuyForPersonPeriod:"구매수량 제한 기간", outboundShippingTimeDay:"출고 소요일", unitCount:"판매 구성 수량", adultOnly:"성인용 여부", taxType:"과세 유형", parallelImported:"병행수입 여부", overseasPurchased:"해외구매 여부", pccNeeded:"개인통관번호 필요 여부", barcode:"바코드", emptyBarcode:"바코드 없음 확인", emptyBarcodeReason:"바코드 없는 사유", modelNo:"모델명", modelName:"모델명", imageOrder:"이미지 순서", imageType:"이미지 역할", vendorPath:"이미지 주소", noticeCategoryDetailName:"고시 항목명", content:"내용", attributeTypeName:"속성명", attributeValueName:"속성값", contentsType:"설명 형식", detailType:"상세 형식",
  prdNm:"상품명", selPrc:"판매가", prdSelQty:"판매 가능 수량", htmlDetail:"상품 상세설명", orgnNmVal:"원산지", asDetail:"A/S 안내", rtngExchDetail:"반품·교환 안내", rtngdDlvCst:"반품 배송비", exchDlvCst:"교환 배송비", prdImage01:"대표 이미지", prdImage02:"추가 이미지 1", prdImage03:"추가 이미지 2", prdImage04:"추가 이미지 3", code:"항목 코드", type:"유형", url:"이미지 주소", statusType:"상품 상태", saleType:"판매 유형", detailContent:"상품 상세설명", minorPurchasable:"미성년자 구매 가능", productInfoProvidedNoticeType:"고시 상품군", certificateDetails:"인증 내용", customerServicePhoneNumber:"고객상담 연락처", afterServiceTelephoneNumber:"A/S 연락처", afterServiceGuideContent:"A/S 안내", originAreaCode:"원산지 코드", returnCostReason:"반품비 안내", noRefundReason:"환불 불가 사유", qualityAssuranceStandard:"품질보증 기준", compensationProcedure:"보상 절차", troubleShootingContents:"분쟁 해결 안내", purchaseReviewExposure:"구매후기 노출", naverShoppingRegistration:"네이버쇼핑 노출", channelProductName:"스토어 상품명", channelProductDisplayStatusType:"스토어 노출 상태", unitPriceYn:"단위가격 표시 여부", totalCapacityValue:"전체 순용량", unitCapacity:"단위가격 기준량", indicationUnit:"용량 단위",
  fulfillmentPolicyId:"배송 정책", paymentPolicyId:"결제 정책", returnPolicyId:"반품 정책", merchantLocationKey:"재고 위치", availableQuantity:"판매 가능 수량", listingDescription:"현지 상품 설명", format:"판매 방식", mpn:"제조사 부품번호", language:"상품 언어", goodsName:"상품명", goodsDesc:"상품 설명", costTemplate:"배송 템플릿", productType:"상품 유형", barCodeType:"바코드 유형", barCodeId:"바코드 번호",
};
export function registrationFieldLabel(path: string[]): string {
  const key = path.at(-1) ?? "";
  if (/^\d+$/.test(key)) return `${registrationFieldLabel(path.slice(0,-1))} ${Number(key)+1}`;
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ");
}
export function registrationValueAt(input: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value,key)=>value && typeof value==="object" && Object.hasOwn(value,key) ? (value as Record<string,unknown>)[key] : undefined,input);
}
export function setRegistrationValue(input: Record<string,unknown>, path: string[], value: RegistrationValue): Record<string,unknown> {
  if (!path.length || path.length>16 || path.some(p=>!p || blocked.has(p))) throw Error("REGISTRATION_FIELD_PATH_INVALID");
  const clone=structuredClone(input); let current: Record<string,unknown>|unknown[]=clone;
  for(let i=0;i<path.length;i++) {
    const key=path[i];
    if (Array.isArray(current) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key)>current.length)) throw Error("REGISTRATION_ARRAY_PATH_INVALID");
    if (!Array.isArray(current) && /^(0|[1-9]\d*)$/.test(key)) throw Error("REGISTRATION_OBJECT_PATH_INVALID");
    const target=current as Record<string,unknown>;
    if(i===path.length-1) { target[key]=structuredClone(value); break; }
    if(target[key]==null) target[key]=/^(0|[1-9]\d*)$/.test(path[i+1]) ? [] : {};
    if(typeof target[key]!=="object") throw Error("REGISTRATION_FIELD_CONTAINER_INVALID");
    current=target[key] as Record<string,unknown>;
  }
  return clone;
}
export function editableRegistrationPath(path: string[]) {
  return path.length>0 && !hidden.has(path[0]) && !path.some(p=>blocked.has(p)||boundKeys.has(p))
    && !path.some(p=>/token|password|secret|signature/i.test(p));
}
function identityPathAllowed(path: string[]) {
  return path.length>0
    && (!hidden.has(path[0]) || (path.length===1 && boundKeys.has(path[0])))
    && !path.some(p=>blocked.has(p)||/token|password|secret|signature/i.test(p));
}
function registrationIdentityState(value: unknown) {
  const identities=new Map<string,string>();
  const arrays=new Map<string,number>();
  const hasIdentityDescendant=(node: unknown,path: string[]): boolean => {
    if(path.length && !identityPathAllowed(path))return false;
    if(!node || typeof node!=="object")return false;
    return Object.entries(node).some(([key,child])=>{
      const childPath=[...path,key];
      return identityPathAllowed(childPath) && (boundKeys.has(key)||hasIdentityDescendant(child,childPath));
    });
  };
  const visit=(node: unknown,path: string[])=>{
    if(path.length && !identityPathAllowed(path))return;
    if(Array.isArray(node)) {
      if(hasIdentityDescendant(node,path))arrays.set(JSON.stringify(path),node.length);
      node.forEach((child,index)=>visit(child,[...path,String(index)]));
      return;
    }
    if(!node || typeof node!=="object")return;
    for(const [key,child] of Object.entries(node)) {
      const childPath=[...path,key];
      if(!identityPathAllowed(childPath))continue;
      if(boundKeys.has(key))identities.set(JSON.stringify(childPath),JSON.stringify(child)??"undefined");
      else visit(child,childPath);
    }
  };
  visit(value,[]);
  return {identities,arrays};
}
export function registrationIdentityIssue(base: Record<string,unknown>,current: Record<string,unknown>): string|null {
  const before=registrationIdentityState(base);
  const after=registrationIdentityState(current);
  const identityPaths=new Set([...before.identities.keys(),...after.identities.keys()]);
  for(const path of identityPaths)if(before.identities.get(path)!==after.identities.get(path))return registrationIdentityChangedMessage;
  const arrayPaths=new Set([...before.arrays.keys(),...after.arrays.keys()]);
  for(const path of arrayPaths)if(before.arrays.get(path)!==after.arrays.get(path))return registrationIdentityChangedMessage;
  return null;
}
function containsBoundIdentity(value: unknown): boolean {
  return Boolean(value && typeof value==="object" && Object.entries(value).some(([key,child])=>boundKeys.has(key)||containsBoundIdentity(child)));
}
export function registrationPatches(base: Record<string,unknown>, current: Record<string,unknown>): RegistrationPatch[] {
  const identityIssue=registrationIdentityIssue(base,current);
  if(identityIssue) {
    const error=new Error(identityIssue);
    error.name="RegistrationIdentityError";
    throw error;
  }
  const result: RegistrationPatch[]=[];
  function visit(value: unknown,path: string[]) {
    if(path.length && !editableRegistrationPath(path)) return;
    const before=registrationValueAt(base,path);
    if(JSON.stringify(before)===JSON.stringify(value)) return;
    const hasProtectedDescendant = (node: unknown, at: string[]): boolean => {
      if (at.length && !editableRegistrationPath(at)) return true;
      return Boolean(node && typeof node === "object" && Object.entries(node).some(([key,child]) => hasProtectedDescendant(child,[...at,key])));
    };
    if (Array.isArray(value) && path.length && !hasProtectedDescendant(value,path)) result.push({path,value:value as RegistrationValue});
    else if(value && typeof value==="object" && path.length
        && (!Object.keys(value).length || Boolean(before && typeof before === "object" && Object.keys(before).some(key=>!Object.hasOwn(value,key))))
        && !hasProtectedDescendant(value,path) && !hasProtectedDescendant(before,path)) result.push({path,value:value as RegistrationValue});
    else if(value && typeof value==="object") {
      for(const [key,child] of Object.entries(value)) visit(child,[...path,key]);
    } else if(path.length && value!==undefined) result.push({path,value:value as RegistrationValue});
  }
  visit(current,[]); return result;
}
export function applyRegistrationPatches(base: Record<string,unknown>, patches: RegistrationPatch[]) {
  return patches.reduce((draft,patch)=>{
    if(!editableRegistrationPath(patch.path))return draft;
    if(containsBoundIdentity(patch.value)) {
      const error=new Error("REGISTRATION_PATCH_IDENTITY_FORBIDDEN");
      error.name="RegistrationIdentityError";
      throw error;
    }
    const next=setRegistrationValue(draft,patch.path,patch.value);
    if(registrationIdentityIssue(draft,next)) {
      const error=new Error("REGISTRATION_PATCH_IDENTITY_FORBIDDEN");
      error.name="RegistrationIdentityError";
      throw error;
    }
    return next;
  },base);
}
export function channelRegistrationFields(channel: ActiveChannelKey,draft: Record<string,unknown>,requirements: RegistrationRequirement[]): RegistrationField[] {
  const fields=new Map<string,RegistrationField>();
  const walk=(value: unknown,path: string[],depth=0)=>{
    if(depth>16 || (path.length && !editableRegistrationPath(path)) || (channel === "coupang" && (path.includes("notices") || path.includes("noticeContent")))) return;
    if(Array.isArray(value)) value.forEach((child,index)=>walk(child,[...path,String(index)],depth+1));
    else if(value && typeof value==="object") Object.entries(value).forEach(([key,child])=>walk(child,[...path,key],depth+1));
    else if(path.length && value!=="SERVER_MANAGED" && value!=="PROGRAM_UPLOAD_PENDING") fields.set(JSON.stringify(path),{path,label:registrationFieldLabel(path),value:(value??null) as RegistrationValue,required:false,inputType:typeof value==="number"?"number":typeof value==="boolean"?"boolean":undefined});
  };
  walk(draft,[]);
  for(const requirement of requirements) {
    const path=requirement.manualPath;
    if(!path || !editableRegistrationPath(path) || (channel==="coupang" && requirement.key==="notices")) continue;
    const value=registrationValueAt(draft,path);
    fields.set(JSON.stringify(path),{path,label:requirement.label,value:(value==="SERVER_MANAGED"?null:value??null) as RegistrationValue,required:requirement.status!=="runtime",issue:requirement.status==="manual"?"필수값을 확인해 주세요.":undefined,help:requirement.help,inputType:requirement.inputType,...(requirement.key==="unit-indication"?{options:["g","kg","ml","L","cm","m","개","개입","매","매입","정","캡슐","구미","포","구"]}:{})});
  }
  return [...fields.values()];
}
