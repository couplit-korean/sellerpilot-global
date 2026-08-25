// Backward-compatible alias. All marketplace replies use the same claim-bound,
// idempotent gateway path so older clients cannot bypass duplicate fencing.
import { POST as replyPost } from "../reply/route";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = replyPost;
