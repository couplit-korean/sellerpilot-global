import { CsStandaloneWorkspace } from "./standalone-workspace";
import { csChannelFilterFromValue, csStatusFilterFromValue } from "../cs-navigation";

export default async function CsWorkspacePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <CsStandaloneWorkspace initialChannel={csChannelFilterFromValue(params.channel)}
    initialStatus={csStatusFilterFromValue(params.status)} initialTicketId={typeof params.ticketId === "string" ? params.ticketId : null} />;
}
