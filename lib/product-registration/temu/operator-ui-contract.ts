import { createHash } from "node:crypto";

export const temuCollectorUiContractV1 = Object.freeze({
  contract: "temu_partner_ui_contract_2026_09_10_v1",
  sellerpilotOrigin: "https://sellerpilot-global.vercel.app",
  pages: {
    app: {
      urlPrefix: "https://partner.temu.com/app/app-mgmt",
      appNameSelector: "[data-testid='app-name']",
      appIdSelector: "[data-testid='app-id']",
      appStateSelector: "[data-testid='app-state']",
      complianceStateSelector: "[data-testid='compliance-state']",
      rejectionReasonSelector: "[data-testid='compliance-rejection-reason']",
      accountSubjectSelector: "[data-testid='partner-account-id']",
      mallIdSelector: "[data-testid='mall-id']",
      regionIdSelector: "[data-testid='region-id']",
    },
    shipping: {
      urlPrefix: "https://seller.temu.com/shipping/templates",
      defaultTemplateIdSelector: "[data-testid='default-shipping-template-id']",
      warehouseVerifiedSelector: "[data-testid='warehouse-verification']",
      feeRuleVerifiedSelector: "[data-testid='shipping-fee-rule-verification']",
      returnPolicyVerifiedSelector: "[data-testid='return-policy-verification']",
    },
    egress: {
      urlPrefix: "https://partner.temu.com/app/app-mgmt/ip-allowlist",
      stateSelector: "[data-testid='ip-allowlist-state']",
      verificationMethodSelector: "[data-testid='ip-verification-method']",
    },
  },
});

export const temuCollectorUiContractSha256 = createHash("sha256")
  .update(JSON.stringify(temuCollectorUiContractV1), "utf8").digest("hex");
