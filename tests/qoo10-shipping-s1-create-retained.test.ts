import assert from "node:assert/strict";
import test from "node:test";
import {
  qoo10LotteShippingS1Identity,
  qoo10ShippingS1CreateKeywordContainsRemote,
  qoo10ShippingS1CreateRetainedMetadataMatches,
} from "../lib/channels/qoo10-lotte-shipping-s1-identity";

const CREATE_KEYWORD = "ロッテ,ロッテサンド,韓国お菓子,ミルク味,ビスケット";
const REMOTE_KEYWORD = "ビスケット,ミルク味,韓国お菓子";
const CREATE_PROMOTION = "ミルク味サンドビスケット";
const UPDATE_TITLE = "洋菓子の販売者確認済み商品";

test("create-retained keyword is an exact token subset of the original create Keyword", () => {
  assert.equal(
    qoo10ShippingS1CreateKeywordContainsRemote(CREATE_KEYWORD, REMOTE_KEYWORD),
    true,
  );
  assert.equal(
    qoo10ShippingS1CreateKeywordContainsRemote(CREATE_KEYWORD, CREATE_KEYWORD),
    true,
  );
  assert.equal(
    qoo10ShippingS1CreateKeywordContainsRemote(
      CREATE_KEYWORD,
      "洋菓子の販売者確認済み商品,購入前確認",
    ),
    false,
  );
  assert.equal(
    qoo10ShippingS1CreateKeywordContainsRemote(CREATE_KEYWORD, "ビスケット,未知"),
    false,
  );
});

test("create-retained metadata requires S1, 806971, update title, and create promotion", () => {
  assert.equal(qoo10LotteShippingS1Identity.verifierJobId, "457b4481-0a66-4a76-89a0-884087d0c22e");
  assert.equal(
    qoo10ShippingS1CreateRetainedMetadataMatches({
      remoteId: qoo10LotteShippingS1Identity.remoteId,
      providerStatus: "S1",
      shippingNo: "806971",
      remoteTitle: UPDATE_TITLE,
      updateTitle: UPDATE_TITLE,
      remoteKeyword: REMOTE_KEYWORD,
      createKeyword: CREATE_KEYWORD,
      remotePromotionName: CREATE_PROMOTION,
      createPromotionName: CREATE_PROMOTION,
    }),
    true,
  );
  assert.equal(
    qoo10ShippingS1CreateRetainedMetadataMatches({
      remoteId: qoo10LotteShippingS1Identity.remoteId,
      providerStatus: "S1",
      shippingNo: "806971",
      remoteTitle: UPDATE_TITLE,
      updateTitle: UPDATE_TITLE,
      remoteKeyword: REMOTE_KEYWORD,
      createKeyword: CREATE_KEYWORD,
      remotePromotionName: "洋菓子の出品情報です。購入前に内容をご確",
      createPromotionName: CREATE_PROMOTION,
    }),
    false,
  );
});
