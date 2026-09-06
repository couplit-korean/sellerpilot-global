import assert from "node:assert/strict";
import test from "node:test";
import { applyRegistrationPatches, registrationIdentityIssue, registrationPatches } from "../lib/channel-registration-form";

const identityMessage = "채널 상품 식별 구조(SKU·카테고리)가 변경되어 저장할 수 없습니다. 원래 채널 초안을 다시 불러온 뒤 값만 수정해 주세요.";
const base = {
  categoryId: "CAT-100",
  body: {
    items: [
      { externalVendorSku: "SKU-A", price: 10, notices: [{ noticeCategoryName: "식품", noticeCategoryDetailName: "원산지", content: "대한민국" }] },
      { externalVendorSku: "SKU-B", price: 20, notices: [] },
    ],
  },
};

function expectIdentityRejection(current: Record<string,unknown>) {
  assert.equal(registrationIdentityIssue(base,current),identityMessage);
  assert.throws(
    ()=>registrationPatches(base,current),
    (error: unknown)=>error instanceof Error && error.name==="RegistrationIdentityError" && error.message===identityMessage,
  );
}

test("identity-bearing item arrays reject deletion, insertion, reorder and identity changes",()=>{
  const deleted=structuredClone(base);
  deleted.body.items.shift();
  expectIdentityRejection(deleted);

  const inserted=structuredClone(base);
  inserted.body.items.push({externalVendorSku:"SKU-C",price:30,notices:[]});
  expectIdentityRejection(inserted);

  const reordered=structuredClone(base);
  reordered.body.items.reverse();
  expectIdentityRejection(reordered);

  const rebound=structuredClone(base);
  rebound.body.items[1].externalVendorSku="SKU-C";
  expectIdentityRejection(rebound);

  const recategorized=structuredClone(base);
  recategorized.categoryId="CAT-200";
  expectIdentityRejection(recategorized);
});

test("normal scalar edits and identity-free notice deletion remain restorable",()=>{
  const edited=structuredClone(base);
  edited.body.items[1].price=0;
  edited.body.items[0].notices=[];
  assert.equal(registrationIdentityIssue(base,edited),null);
  const patches=registrationPatches(base,edited);
  assert.ok(patches.some(patch=>JSON.stringify(patch.path)===JSON.stringify(["body","items","1","price"])&&patch.value===0));
  assert.ok(patches.some(patch=>JSON.stringify(patch.path)===JSON.stringify(["body","items","0","notices"])&&Array.isArray(patch.value)&&patch.value.length===0));
  const restored=applyRegistrationPatches(base,patches) as typeof base;
  assert.equal(restored.body.items[0].externalVendorSku,"SKU-A");
  assert.equal(restored.body.items[1].externalVendorSku,"SKU-B");
  assert.equal(restored.body.items[1].price,0);
  assert.deepEqual(restored.body.items[0].notices,[]);
});

test("fresh hidden and signed evidence is neither an identity issue nor a saved patch",()=>{
  const before={...structuredClone(base),sellerpilotAssets:{categoryId:"EVIDENCE-OLD",signedUrl:"old",token:"old"}};
  const edited=structuredClone(before);
  edited.sellerpilotAssets={categoryId:"EVIDENCE-NEW",signedUrl:"new",token:"new"};
  edited.body.items[0].price=11;
  assert.equal(registrationIdentityIssue(before,edited),null);
  assert.deepEqual(registrationPatches(before,edited),[{path:["body","items","0","price"],value:11}]);
});

test("adding a protected identity to an identity-free draft is rejected",()=>{
  const generated={sellerpilotAssets:{token:"secret"},body:{items:[{externalVendorSku:"SKU-A",price:23}]}};
  assert.equal(registrationIdentityIssue({},generated),identityMessage);
  assert.throws(()=>registrationPatches({},generated),(error:unknown)=>error instanceof Error&&error.name==="RegistrationIdentityError"&&error.message===identityMessage);
});

test("restoring stale or malicious parent patches cannot smuggle bound identities",()=>{
  assert.throws(
    ()=>applyRegistrationPatches(base,[{path:["body","items"],value:[{externalVendorSku:"SKU-B",price:20,notices:[]}]}]),
    (error: unknown)=>error instanceof Error && error.name==="RegistrationIdentityError" && error.message==="REGISTRATION_PATCH_IDENTITY_FORBIDDEN",
  );
  assert.throws(
    ()=>applyRegistrationPatches(base,[{path:["body"],value:{categoryId:"CAT-ATTACK",items:[]}}]),
    (error: unknown)=>error instanceof Error && error.name==="RegistrationIdentityError" && error.message==="REGISTRATION_PATCH_IDENTITY_FORBIDDEN",
  );
  assert.throws(
    ()=>applyRegistrationPatches(base,[{path:["body","items"],value:[]}]),
    (error: unknown)=>error instanceof Error && error.name==="RegistrationIdentityError" && error.message==="REGISTRATION_PATCH_IDENTITY_FORBIDDEN",
    "an empty parent array cannot erase established SKU identities",
  );
  assert.throws(
    ()=>applyRegistrationPatches(base,[{path:["body"],value:{}}]),
    (error: unknown)=>error instanceof Error && error.name==="RegistrationIdentityError" && error.message==="REGISTRATION_PATCH_IDENTITY_FORBIDDEN",
    "an empty parent object cannot erase established SKU identities",
  );
  assert.throws(
    ()=>applyRegistrationPatches(base,[{path:["body","items","0","notices"],value:[{noticeCategoryName:"식품",noticeCategoryDetailName:"원산지",content:"대한민국",vendorId:"VENDOR-ATTACK"}]}]),
    (error: unknown)=>error instanceof Error && error.name==="RegistrationIdentityError" && error.message==="REGISTRATION_PATCH_IDENTITY_FORBIDDEN",
  );
  assert.deepEqual(
    applyRegistrationPatches(base,[{path:["body","items","0","externalVendorSku"],value:"SKU-ATTACK"}]),
    base,
    "a direct protected path remains ignored rather than applied",
  );
});
