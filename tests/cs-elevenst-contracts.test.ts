import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyElevenstQnaResponse,
  elevenstCsCapabilities,
  normalizeElevenstAlimiRow,
  planElevenstWindows,
  verifyElevenstAlimiWriteAcceptance,
  verifyElevenstProductQnaReplyReadback,
} from "../lib/channels/cs/elevenst/contracts";

test("11st history planner partitions 30 days into the existing five exact Q&A windows", () => {
  assert.deepEqual(planElevenstWindows({
    startDate: "20260810", endDate: "20260908", maxWindowDays: 7,
  }), [
    { startDate: "20260810", endDate: "20260816" },
    { startDate: "20260817", endDate: "20260823" },
    { startDate: "20260824", endDate: "20260830" },
    { startDate: "20260831", endDate: "20260906" },
    { startDate: "20260907", endDate: "20260908" },
  ]);
  assert.deepEqual(planElevenstWindows({
    startDate: "20260810", endDate: "20260908", maxWindowDays: 30,
  }), [{ startDate: "20260810", endDate: "20260908" }]);
  assert.throws(() => planElevenstWindows({
    startDate: "20260909", endDate: "20260908", maxWindowDays: 7,
  }), /ELEVENST_RANGE_INVALID/u);
});

test("11st Product Q&A result 500 is a business error, never a zero-row success", () => {
  assert.equal(classifyElevenstQnaResponse({
    httpStatus: 200, accepted: false, resultCode: "500", providerRows: 0,
  }), "business_error");
  assert.equal(classifyElevenstQnaResponse({
    httpStatus: 200, accepted: true, resultCode: "500", providerRows: 0,
  }), "business_error");
  assert.equal(classifyElevenstQnaResponse({
    httpStatus: 200, accepted: true, resultCode: null, providerRows: 0,
  }), "accepted_empty");
});

test("11st capability inventory keeps Q&A, alimi, seller talk and reviews separate", () => {
  assert.equal(elevenstCsCapabilities.product_qna.access, "official_open_api");
  assert.equal(elevenstCsCapabilities.urgent_alimi.maxWindowDays, 30);
  assert.deepEqual(elevenstCsCapabilities.urgent_alimi.classification, {
    urgent_inquiry: "10", urgent_notice: "11",
  });
  assert.deepEqual(elevenstCsCapabilities.seller_talk.retention, {
    maximum: 3,
    unit: "month",
    exactDays: null,
  });
  assert.equal("retentionDays" in elevenstCsCapabilities.seller_talk, false);
  assert.equal(elevenstCsCapabilities.seller_talk.read, null);
  assert.equal(elevenstCsCapabilities.review.import, "seller_office_xls");
});

test("11st alimi normalization separates reply requests from notices and excludes member IDs", () => {
  const normalized = normalizeElevenstAlimiRow({
    emerNtceSeq: "5590778",
    emerCtntSeq: "1",
    emerTypeCd: "01",
    emerNtceCrntCd: "02",
    emerNtceClfNo1: "10",
    emerNtceSubject: "배송 확인 요청",
    emerCtnt: "확인이 필요합니다.",
    createDt: "20260908",
    createTm: "12:30:30",
    emerReplyDt: "20260909",
    ordNo: "202609080001",
    ordPrdSeq: "1",
    memId: "must-not-survive",
    memNm: "must-not-survive",
    emerReplyList: [],
  });
  assert.equal(normalized.kind, "urgent_inquiry");
  assert.equal(normalized.type, "reply_request");
  assert.equal(normalized.replySupported, true);
  assert.equal(normalized.createdAt, "2026-09-08T12:30:30+09:00");
  assert.equal(normalized.orderProductSequence, "1");
  assert.doesNotMatch(JSON.stringify(normalized), /must-not-survive|memId|memNm/u);
});

test("11st Product Q&A remote echo requires exact board, product, body and answer date", () => {
  const expected = { brdInfoNo: "81234567", prdNo: "13749310594", reply: "확인했습니다." };
  const row = {
    brdInfoNo: "81234567", brdInfoClfNo: "13749310594", answerYn: "Y",
    answerCont: "확인했습니다.", answerDt: "2026/09/08",
  };
  assert.deepEqual(verifyElevenstProductQnaReplyReadback({ expected, rows: [row] }), {
    observed: true, reason: "exact_remote_echo",
  });
  assert.deepEqual(verifyElevenstProductQnaReplyReadback({
    expected, rows: [{ ...row, brdInfoClfNo: "999" }],
  }), { observed: false, reason: "product_identity_mismatch" });
  assert.deepEqual(verifyElevenstProductQnaReplyReadback({
    expected, rows: [{ ...row, answerCont: "다른 답변" }],
  }), { observed: false, reason: "reply_body_mismatch" });
});

test("11st alimi ACK codes are action-specific and still require readback", () => {
  assert.deepEqual(verifyElevenstAlimiWriteAcceptance({
    expectedEmerNtceSeq: "5590778",
    intendedAction: "confirm_notice",
    response: { emerNtceSeq: "5590778", result_code: "100" },
  }), { accepted: true, remoteObservationRequired: true });
  assert.deepEqual(verifyElevenstAlimiWriteAcceptance({
    expectedEmerNtceSeq: "5590778",
    intendedAction: "reply_request",
    response: { emerNtceSeq: "5590778", result_code: "100" },
  }), { accepted: false, remoteObservationRequired: true });
});
