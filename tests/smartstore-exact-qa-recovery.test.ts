import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSmartstoreExactQaUpdateArguments,
  bindSmartstoreExactQaApprovedRepresentative,
  bindSmartstoreExactQaRecoveryArguments,
  smartstoreExactQaApprovedContentRequired,
  smartstoreExactQaCentralSkuVerified,
  smartstoreExactQaCreateForbidden,
  smartstoreExactQaReadinessBlock,
  smartstoreExactQaRecoveryArgument,
  smartstoreExactQaRecoveryBinding,
  smartstoreExactQaRecoveryCandidate,
  smartstoreExactQaRecoveryIdentity,
  smartstoreExactQaUpdateArgumentsValid,
} from "../lib/channels/smartstore-exact-qa-recovery";

function normalizedAsset(index: number) {
  const contentSha256 = index.toString(16).padStart(64, "0");
  const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
  return {
    role: `detail-section-${index}`,
    approvedObjectPath:
      `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/detail-${index}.png`,
    approvedSourceSha256: (index + 32).toString(16).padStart(64, "0"),
    publicUrl:
      `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256,
  };
}

function exactPreparedArguments() {
  const details = Array.from({ length: 8 }, (_, index) => normalizedAsset(index + 1));
  const representativeAsset = normalizedAsset(31);
  const representative = {
    role: "gallery-representative",
    approvedObjectPath:
      "results/33333333-3333-4333-8333-333333333333/claims/44444444-4444-4444-8444-444444444444/thumbnail-square.png",
    approvedSourceSha256: "e".repeat(64),
    publicUrl: representativeAsset.publicUrl,
    objectPath: representativeAsset.objectPath,
    contentSha256: representativeAsset.contentSha256,
  };
  return bindSmartstoreExactQaRecoveryArguments({
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
    imageUrls: [representative.publicUrl, ...details.map((image) => image.publicUrl)],
    body: {
      originProduct: {
        name: "부착형 케이블 정리 클립 6개 세트",
        detailContent: [
          "<p>케이블을 깔끔하게 정리하는 부착형 클립 세트입니다.</p>",
          ...details.map((image) => `<img src="${image.publicUrl}" alt="상세 이미지">`),
        ].join(""),
        salePrice: smartstoreExactQaRecoveryIdentity.priceKrw,
        stockQuantity: 1,
        detailAttribute: {
          sellerCodeInfo: {
            sellerManagementCode: smartstoreExactQaRecoveryIdentity.centralSku,
          },
        },
      },
      smartstoreChannelProduct: {
        channelProductName: "부착형 케이블 정리 클립 6개 세트",
      },
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: "a".repeat(64),
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 1,
      approvedManifestDigest: "b".repeat(64),
      approvedDetailImages: details,
      providerImageSurface: "gallery",
      providerTransportImages: [representative, ...details.map((image) => ({
        role: image.role,
        publicUrl: image.publicUrl,
        objectPath: image.objectPath,
        contentSha256: image.contentSha256,
      }))],
    },
  });
}

test("Smartstore exact QA recovery binding is server-owned and preserves null marketplace SKU", () => {
  const argumentsValue = bindSmartstoreExactQaRecoveryArguments({
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
  });
  assert.deepEqual(smartstoreExactQaRecoveryBinding(argumentsValue), {
    contract: "smartstore_exact_qa_recovery_v1",
    phase: "listing.update",
    productId: smartstoreExactQaRecoveryIdentity.productId,
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
    channelProductNo: smartstoreExactQaRecoveryIdentity.channelProductNo,
    centralSku: smartstoreExactQaRecoveryIdentity.centralSku,
    sellerManagementCodeSource: "provider_readback_required",
    sellerAccountLineage: "validated_by_service_rpc",
  });
  assert.equal(Object.hasOwn(argumentsValue, "marketplaceSku"), false);
  assert.equal(Object.hasOwn(argumentsValue, "marketplace_sku"), false);

  const forged = {
    ...argumentsValue,
    [smartstoreExactQaRecoveryArgument]: {
      ...argumentsValue[smartstoreExactQaRecoveryArgument] as Record<string, unknown>,
      channelProductNo: "99999999999",
    },
  };
  assert.equal(smartstoreExactQaRecoveryBinding(forged), null);
});

test("Smartstore exact readiness fails closed on credential, identity, and static egress", () => {
  const identity = smartstoreExactQaRecoveryBinding(exactPreparedArguments());
  assert.ok(identity);
  assert.deepEqual(smartstoreExactQaReadinessBlock({
    credentialId: crypto.randomUUID(),
    identity,
    environmentStaticEgressReady: true,
    databaseStaticEgressReady: true,
  }), {
    mode: "smartstore_exact_qa_credential_required",
    reason: "이 스마트스토어 기존상품에 결속된 운영 인증정보를 확인하지 못해 원격 반영을 차단했습니다.",
  });
  assert.equal(smartstoreExactQaReadinessBlock({
    credentialId: smartstoreExactQaRecoveryIdentity.credentialId,
    identity: null,
    environmentStaticEgressReady: true,
    databaseStaticEgressReady: true,
  })?.mode, "smartstore_exact_qa_atomic_identity_required");
  assert.equal(smartstoreExactQaReadinessBlock({
    credentialId: smartstoreExactQaRecoveryIdentity.credentialId,
    identity,
    environmentStaticEgressReady: true,
    databaseStaticEgressReady: false,
  })?.mode, "static_egress_required");
  assert.equal(smartstoreExactQaReadinessBlock({
    credentialId: smartstoreExactQaRecoveryIdentity.credentialId,
    identity,
    environmentStaticEgressReady: true,
    databaseStaticEgressReady: true,
  }), null);
});

test("Smartstore exact QA product is update-only and requires the observed failed ledger state", () => {
  assert.equal(smartstoreExactQaCreateForbidden({
    productId: smartstoreExactQaRecoveryIdentity.productId,
  }), true);
  assert.equal(smartstoreExactQaCreateForbidden({
    argumentsValue: {
      body: {
        originProduct: {
          detailAttribute: {
            sellerCodeInfo: {
              sellerManagementCode: smartstoreExactQaRecoveryIdentity.centralSku,
            },
          },
        },
      },
    },
  }), true);

  const exactState = {
    channel: "smartstore",
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
    remoteId: smartstoreExactQaRecoveryIdentity.originProductNo,
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: "external_action",
  };
  assert.equal(smartstoreExactQaRecoveryCandidate(exactState), true);
  assert.equal(smartstoreExactQaRecoveryCandidate({
    ...exactState,
    remoteId: "99999999999",
  }), false);
  assert.equal(smartstoreExactQaRecoveryCandidate({
    ...exactState,
    status: "published",
  }), false);
});

test("Smartstore exact QA update always requires the approved detail manifest", async () => {
  const exact = {
    channel: "smartstore",
    operation: "listing.update",
    productId: smartstoreExactQaRecoveryIdentity.productId,
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
  };
  assert.equal(smartstoreExactQaApprovedContentRequired(exact), true);
  assert.equal(smartstoreExactQaApprovedContentRequired({
    ...exact,
    listingId: "00000000-0000-4000-8000-000000000000",
  }), false);
  assert.equal(smartstoreExactQaApprovedContentRequired({
    ...exact,
    operation: "listing.stop",
  }), false);

  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /exactSmartstoreContentUpdate = smartstoreExactQaApprovedContentRequired/);
  assert.match(
    route,
    /contentBoundListingOperation = operation === "listing\.create"[\s\S]{0,300}\|\| exactSmartstoreContentUpdate/,
  );
});

test("Smartstore exact QA central SKU accepts no conflicting product or manual value", () => {
  assert.equal(smartstoreExactQaCentralSkuVerified({
    product: { sku: smartstoreExactQaRecoveryIdentity.centralSku },
    manualFields: {},
  }), true);
  assert.equal(smartstoreExactQaCentralSkuVerified({
    product: { sku: smartstoreExactQaRecoveryIdentity.centralSku },
    manualFields: { sellerSku: "OTHER-SKU" },
  }), false);
  assert.equal(smartstoreExactQaCentralSkuVerified({
    product: { sku: "OTHER-SKU" },
    manualFields: { sellerSku: smartstoreExactQaRecoveryIdentity.centralSku },
  }), false);
});

test("Smartstore exact QA final gateway payload requires Korean copy and one plus eight approved images", () => {
  const valid = exactPreparedArguments();
  assert.equal(smartstoreExactQaUpdateArgumentsValid(valid), true);
  assert.doesNotThrow(() => assertSmartstoreExactQaUpdateArguments(valid));

  const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
    ["near-miss listing", (value) => {
      (value.sellerpilotSmartstoreExactQaRecovery as Record<string, unknown>).listingId =
        "00000000-0000-4000-8000-000000000000";
    }],
    ["non-Korean title", (value) => {
      const body = value.body as Record<string, Record<string, unknown>>;
      body.originProduct.name = "Cable organizer clips";
    }],
    ["extra representative", (value) => {
      (value.imageUrls as string[]).push(normalizedAsset(30).publicUrl);
    }],
    ["reordered provider images", (value) => {
      const imageUrls = value.imageUrls as string[];
      [imageUrls[1], imageUrls[2]] = [imageUrls[2], imageUrls[1]];
    }],
    ["reordered detail HTML", (value) => {
      const body = value.body as Record<string, Record<string, unknown>>;
      const origin = body.originProduct;
      const urls = [...String(origin.detailContent).matchAll(/src="([^"]+)"/g)]
        .map((match) => match[1])
        .reverse();
      origin.detailContent = `<p>승인 상세 정보입니다.</p>${urls.map((url) => `<img src="${url}">`).join("")}`;
    }],
    ["forged detail digest", (value) => {
      const binding = value.sellerpilotPublicationAssetBinding as Record<string, unknown>;
      const transport = binding.providerTransportImages as Array<Record<string, unknown>>;
      transport[1].contentSha256 = "f".repeat(64);
    }],
    ["forged representative lineage", (value) => {
      const binding = value.sellerpilotPublicationAssetBinding as Record<string, unknown>;
      const transport = binding.providerTransportImages as Array<Record<string, unknown>>;
      transport[0].approvedObjectPath =
        "results/33333333-3333-4333-8333-333333333333/claims/44444444-4444-4444-8444-444444444444/hero.png";
    }],
    ["legacy representative filename", (value) => {
      const binding = value.sellerpilotPublicationAssetBinding as Record<string, unknown>;
      const transport = binding.providerTransportImages as Array<Record<string, unknown>>;
      transport[0].approvedObjectPath = String(transport[0].approvedObjectPath)
        .replace("thumbnail-square.png", "square.png");
    }],
  ];
  for (const [name, mutate] of cases) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.equal(smartstoreExactQaUpdateArgumentsValid(invalid), false, name);
    assert.throws(
      () => assertSmartstoreExactQaUpdateArguments(invalid),
      /SMARTSTORE_EXACT_QA_UPDATE_ARGUMENTS_INVALID/u,
      name,
    );
  }
});

test("Smartstore exact representative replaces browser gallery with server lineage", () => {
  const sourceObjectPath =
    "results/33333333-3333-4333-8333-333333333333/claims/44444444-4444-4444-8444-444444444444/thumbnail-square.png";
  const signedUrl =
    `https://sellerpilot.supabase.co/storage/v1/object/sign/sellerpilot-ai/${sourceObjectPath}?token=signed`;
  const bound = bindSmartstoreExactQaApprovedRepresentative({
    sellerpilotAssets: {
      galleryImageUrls: ["https://attacker.invalid/image.png"],
      detailImageUrls: ["https://example.invalid/detail.png"],
    },
  }, {
    signedUrl,
    sourceObjectPath,
    sourceSha256: "a".repeat(64),
  });
  assert.deepEqual(
    (bound.sellerpilotAssets as Record<string, unknown>).galleryImageUrls,
    [signedUrl],
  );
  assert.deepEqual(
    (bound.sellerpilotAssets as Record<string, unknown>).approvedGalleryImagePaths,
    [sourceObjectPath],
  );
  assert.throws(() => bindSmartstoreExactQaApprovedRepresentative(bound, {
    signedUrl,
    sourceObjectPath: sourceObjectPath.replace("thumbnail-square.png", "hero.png"),
    sourceSha256: "a".repeat(64),
  }), /SMARTSTORE_EXACT_QA_REPRESENTATIVE_INVALID/u);
  assert.throws(() => bindSmartstoreExactQaApprovedRepresentative(bound, {
    signedUrl: signedUrl.replace("thumbnail-square.png", "square.png"),
    sourceObjectPath: sourceObjectPath.replace("thumbnail-square.png", "square.png"),
    sourceSha256: "a".repeat(64),
  }), /SMARTSTORE_EXACT_QA_REPRESENTATIVE_INVALID/u);
});

test("Smartstore exact QA permit is armed before claim and final provider handoff", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const serverBinding = route.indexOf("boundSmartstoreExactQaRecovery = true");
  const representativeBinding = route.indexOf(
    "bindSmartstoreExactQaRepresentativeFromStorage({",
  );
  const permitArm = route.indexOf(
    '"sellerpilot_service_arm_exact_smartstore_qa_update"',
  );
  const claim = route.indexOf('userClient.rpc("sellerpilot_claim_channel_operation"');
  const finalValidation = route.indexOf(
    "assertSmartstoreExactQaUpdateArguments(gatewayArguments)",
  );
  const gateway = route.indexOf("executeViaChannelGateway({", finalValidation);
  assert.ok(serverBinding >= 0);
  assert.ok(representativeBinding > serverBinding);
  assert.ok(permitArm > representativeBinding);
  assert.ok(claim > permitArm);
  assert.ok(finalValidation > claim);
  assert.ok(gateway > finalValidation);
  assert.match(
    route,
    /mode: "smartstore_exact_qa_representative_required",[\s\S]{0,120}reasonCode: representative\.code/u,
  );
  assert.match(
    route,
    /!channelReleaseGateIsEffective[\s\S]{0,160}!qoo10ExactLocalizationUpdatePermitArmed[\s\S]{0,160}!smartstoreExactQaUpdatePermitArmed/u,
  );
});

test("Smartstore exact recovery is exposed only through the exact UI and proxy fences", async () => {
  const [workbench, remoteEdit] = await Promise.all([
    readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/remote-edit/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workbench, /smartstoreExactQaWorkbenchRecoveryCandidate/);
  assert.match(workbench, /productId === smartstoreExactQaRecoveryIdentity\.productId/);
  assert.match(workbench, /recoverableSmartstoreUpdate/);
  assert.match(remoteEdit, /allowExactSmartstoreRecovery = smartstoreExactQaRecoveryCandidate/);
  assert.match(remoteEdit, /sellerpilot_service_get_smartstore_exact_qa_recovery_identity/);
  assert.match(remoteEdit, /sellerpilot_service_serverless_static_egress_status/);
  assert.match(remoteEdit, /smartstoreExactQaReadinessBlock/);
  assert.match(workbench, /nextRemoteEditAvailability/);
  assert.match(workbench, /exactSmartstoreReadiness\?\.runnable === true/);
  assert.match(workbench, /safe mode \$\{exactSmartstoreReadiness\?\.mode/);
  assert.match(
    remoteEdit,
    /&& !allowExactLazadaRecovery[\s\S]{0,160}&& !allowExactSmartstoreRecovery/,
  );
});
