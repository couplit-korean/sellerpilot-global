const pendingTargetRequests = new Map<"shopee" | "lazada", Promise<Response>>();

export async function fetchChannelTargets(channel: "shopee" | "lazada", accessToken: string) {
  const pending = pendingTargetRequests.get(channel);
  if (pending) return (await pending).clone();
  const request = (method: "GET" | "POST") => fetch(`/api/admin/channel-targets?channel=${channel}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify({ channel }) } : {}),
    cache: "no-store",
  });
  const task = (async () => {
    const cached = await request("GET");
    if (cached.ok || cached.status === 401 || cached.status === 403) return cached;
    return await request("POST");
  })();
  pendingTargetRequests.set(channel, task);
  try {
    return (await task).clone();
  } finally {
    if (pendingTargetRequests.get(channel) === task) pendingTargetRequests.delete(channel);
  }
}
