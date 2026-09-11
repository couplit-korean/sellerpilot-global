import { AlertTriangle, CircleCheck, Clock, LoaderCircle } from "lucide-react";
import {
  channelIntegrationStatus,
  type ChannelIntegrationInput,
  type ChannelIntegrationTone,
} from "../lib/channels/integration-status";

/**
 * The single way the product-registration area reports whether a sales channel
 * is linked.
 *
 * Label, tone and age text all come from lib/channels/integration-status.ts, the
 * same definition the connection page and the shell strip use, so one channel
 * can never look linked on one card and unlinked on another. This module only
 * decides how that state is drawn.
 */
const toneIcon: Record<ChannelIntegrationTone, typeof CircleCheck> = {
  ok: CircleCheck,
  stale: Clock,
  pending: AlertTriangle,
  failed: AlertTriangle,
  missing: AlertTriangle,
};

export function ChannelLinkBadge({
  input,
  loading = false,
  className = "",
}: {
  input: ChannelIntegrationInput | null | undefined;
  loading?: boolean;
  className?: string;
}) {
  const status = channelIntegrationStatus(input);
  const tone = loading ? "pending" : status.tone;
  const Icon = loading ? LoaderCircle : toneIcon[status.tone];
  const text = loading ? "확인 중" : status.short;
  return (
    <span
      className={`channel-link-badge ${tone}${className ? ` ${className}` : ""}`}
      title={loading ? "채널 연결 상태를 확인하고 있습니다." : status.label}
      role="status"
      aria-label={`채널 연동 ${text}`}
    >
      <Icon size={13} className={loading ? "spin" : undefined} />
      {text}
    </span>
  );
}
