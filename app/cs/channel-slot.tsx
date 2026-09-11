"use client";

import type { ActiveChannelKey } from "../../lib/channels/catalog";
import { csChannelDeskHint, csChannelHistoryCoverageLabel } from "../cs-release-state";
import { EbayCaseDisputeHistory } from "./channels/ebay/case-dispute-history";
import { EbayCasesDisputes } from "./channels/ebay/cases-disputes";
import { ElevenstReadStatePanel } from "./channels/elevenst/read-state";
import { LazadaSupplementalReadPanel } from "./channels/lazada/supplemental-read";
import { Qoo10ReviewChatStatusPanel } from "./channels/qoo10/review-chat-status";
import { ShopeeBuyerChatStatus } from "./channels/shopee/buyer-chat-status";
import { ShopeeHistoryProgress } from "./channels/shopee/history-progress";
import { TemuBuyerChatReadiness } from "./channels/temu/buyer-chat-readiness";
import { TemuHistoryResume } from "./channels/temu/history-resume";
import { EbayMessages } from "./ebay-messages";
import { LazadaQuarantine } from "./lazada-quarantine";
import { LazadaRawInbox } from "./lazada-raw-inbox";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function CsChannelSlot({ channel, authenticatedFetch }: {
  channel: ActiveChannelKey;
  authenticatedFetch: AuthenticatedFetch;
}) {
  return <section className="panel cs-channel-slot" aria-label={`${channel} 채널 연동`}>
    <p className="cs-channel-slot-lead">{csChannelDeskHint(channel)}</p>
    <small>{csChannelHistoryCoverageLabel(channel)}</small>
    {channel === "qoo10" ? <Qoo10ReviewChatStatusPanel authenticatedFetch={authenticatedFetch} /> : null}
    {channel === "shopee" ? <>
      <ShopeeBuyerChatStatus authenticatedFetch={authenticatedFetch} />
      <ShopeeHistoryProgress authenticatedFetch={authenticatedFetch} />
    </> : null}
    {channel === "lazada" ? <>
      <LazadaSupplementalReadPanel authenticatedFetch={authenticatedFetch} />
      <LazadaRawInbox authenticatedFetch={authenticatedFetch} />
      <LazadaQuarantine authenticatedFetch={authenticatedFetch} />
    </> : null}
    {channel === "elevenst" ? <ElevenstReadStatePanel authenticatedFetch={authenticatedFetch} /> : null}
    {channel === "ebay" ? <>
      <EbayMessages authenticatedFetch={authenticatedFetch} />
      <EbayCasesDisputes authenticatedFetch={authenticatedFetch} />
      <EbayCaseDisputeHistory authenticatedFetch={authenticatedFetch} />
    </> : null}
    {channel === "temu" ? <>
      <TemuBuyerChatReadiness authenticatedFetch={authenticatedFetch} />
      <TemuHistoryResume authenticatedFetch={authenticatedFetch} />
    </> : null}
  </section>;
}
