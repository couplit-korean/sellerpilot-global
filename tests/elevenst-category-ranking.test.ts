import assert from "node:assert/strict";
import test from "node:test";
import {scoreElevenstCategory} from "../lib/product-registration/elevenst/category-ranking";
import {executeElevenst,elevenstCategoryScore,type ElevenstCategory} from "../lib/product-registration/channels/elevenst";

// Public category rows from the actual a753d128 receipt; no account data.
const observed: ElevenstCategory[] = [
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865404",
    "categoryName": "생활풍속사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 생활풍속사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865405",
    "categoryName": "사회문화사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 사회문화사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865406",
    "categoryName": "고고학/문화인류학",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 고고학/문화인류학",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865412",
    "categoryName": "인물사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 인물사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865413",
    "categoryName": "정치사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 정치사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865422",
    "categoryName": "경제사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 경제사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865423",
    "categoryName": "건국/멸망사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 건국/멸망사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865426",
    "categoryName": "사회운동사/혁명사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 사회운동사/혁명사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865428",
    "categoryName": "여성사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 여성사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865431",
    "categoryName": "예술사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 예술사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865432",
    "categoryName": "과학기술사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 과학기술사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "865435",
    "categoryName": "전쟁사",
    "categoryPath": "도서/음반 > 역사와 문화 > 주제로 읽는 역사 > 전쟁사",
    "parentCategoryId": "865376"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "1012588",
    "categoryName": "500GB~1TB",
    "categoryPath": "저장장치 > HDD > 노트북용HDD > 500GB~1TB",
    "parentCategoryId": "1010833"
  },
  {
    "leaf": true,
    "depth": 4,
    "categoryId": "1012594",
    "categoryName": "500GB이하",
    "categoryPath": "저장장치 > HDD > 데스크탑용HDD > 500GB이하",
    "parentCategoryId": "1010834"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009790",
    "categoryName": "과즙탄산음료",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 과즙탄산음료",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009792",
    "categoryName": "사이다",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 사이다",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009793",
    "categoryName": "스포츠/이온음료",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 스포츠/이온음료",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009794",
    "categoryName": "아이스티",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 아이스티",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009795",
    "categoryName": "에너지음료",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 에너지음료",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009796",
    "categoryName": "에이드",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 에이드",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009797",
    "categoryName": "콜라",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 콜라",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1009798",
    "categoryName": "기타 탄산음료",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 기타 탄산음료",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1341043",
    "categoryName": "밀키스/암바사",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 밀키스/암바사",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1341044",
    "categoryName": "환타/써니텐",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 환타/써니텐",
    "parentCategoryId": "1001491"
  },
  {
    "leaf": true,
    "depth": 3,
    "categoryId": "1341045",
    "categoryName": "웰치스",
    "categoryPath": "커피/생수/음료 > 탄산음료 > 웰치스",
    "parentCategoryId": "1001491"
  }
];
const ranked=(query:string,items=observed)=>items.map(item=>({item,score:scoreElevenstCategory(query,item)}))
 .filter(row=>row.score>0).sort((a,b)=>b.score-a.score);

test("actual Narangd receipt ranks the cider leaf first; zero/500 cannot admit books or HDD",()=>{
 for(const query of ["나랑드사이다 제로 탄산음료 500 ml 1병","나랑드 사이다 제로 500ml 1병","나랑드사이다제로500ml1병"]) {
  const result=ranked(query);
  assert.equal(result[0].item.categoryId,"1009792",query);
  assert.ok(result.every(row=>!row.item.categoryPath.startsWith("도서/") && !row.item.categoryPath.startsWith("저장장치")),query);
  assert.equal(elevenstCategoryScore(query,result[0].item),result[0].score);
 }
 for(const query of ["500","500ml","500 ml 1병","제로 500ml",""])assert.deepEqual(ranked(query),[],query);
});

test("real category meaning still selects books, storage, cosmetics and verified cable organizers",()=>{
 const extra=(name:string,path:string,depth=3):ElevenstCategory=>({categoryId:`fixture-${name}`,categoryName:name,categoryPath:path,depth,leaf:true,parentCategoryId:"fixture-parent"});
 const all=[...observed,
  extra("2TB","저장장치 > HDD > 노트북용HDD > 2TB",4),
  extra("500GB","저장장치 > SSD > 500GB",3),
  extra("세럼","화장품 > 스킨케어 > 세럼"),
  extra("케이블 정리소품","생활잡화 > 정리소품 > 케이블 정리소품"),
  extra("케이블타이","생활잡화 > 정리소품 > 케이블타이")];
 assert.ok(ranked("한국 역사 도서",all)[0].item.categoryPath.startsWith("도서/"));
 const drive=ranked("노트북 HDD 500 GB",all);
 assert.equal(drive[0].item.categoryId,"1012588");
 assert.ok(drive.every(row=>row.item.categoryPath.includes("HDD")));
 assert.equal(ranked("보습 세럼 30ml",all)[0].item.categoryName,"세럼");
 assert.equal(ranked("부착형 케이블 정리 클립 6개 세트",all)[0].item.categoryName,"케이블 정리소품");
 assert.equal(scoreElevenstCategory("사이다",extra("엉뚱한 상품","무관한 분류 > 엉뚱한 상품",20)),0);
});

test("11st category-suggestions endpoint uses corrected ranking and still returns only supplied official leaves",async()=>{
 // Reconstruct the public path hierarchy for a mocked official XML response.
 const nodes=new Map<string,{id:string;name:string;parent:string;leaf:boolean;depth:number}>();
 let next=9000000;
 for(const item of observed) {
  const parts=item.categoryPath.split(" > ");let parent="0";
  parts.forEach((name,index)=>{
   const path=parts.slice(0,index+1).join(" > ");
   const node=nodes.get(path)??{id:index===parts.length-1?item.categoryId:String(next++),name,parent,leaf:index===parts.length-1,depth:index+1};
   nodes.set(path,node);parent=node.id;
  });
 }
 const xml=`<categorys>${[...nodes.values()].map(n=>`<category><dispNo>${n.id}</dispNo><dispNm>${n.name}</dispNm><parentDispNo>${n.parent}</parentDispNo><leafYn>${n.leaf?"Y":"N"}</leafYn><depth>${n.depth}</depth></category>`).join("")}</categorys>`;
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init?.method,"GET");return new Response(xml,{status:200,headers:{"content-type":"application/xml; charset=utf-8"}});};
 try {
  const result=await executeElevenst({channel:"elevenst",operation:"categories.suggest",environment:"production",payload:{},arguments:{query:"나랑드사이다 제로 탄산음료 500 ml 1병"}});
  assert.equal(calls,1);assert.equal(result.ok,true);
  const items=result.steps[0].data.items as ElevenstCategory[];
  assert.equal(items[0].categoryId,"1009792");
  assert.ok(items.every(item=>item.leaf && observed.some(row=>row.categoryId===item.categoryId)));
  assert.ok(items.every(item=>!item.categoryPath.startsWith("도서/") && !item.categoryPath.startsWith("저장장치")));
 }finally{globalThis.fetch=originalFetch;}
});
