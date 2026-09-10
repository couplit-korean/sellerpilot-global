import { redirect } from "next/navigation";

export default async function CsWorkspacePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams({ view: "cs" });
  for (const key of ["channel", "status", "ticketId"] as const) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) next.set(key, value);
  }
  redirect(`/?${next.toString()}`);
}
