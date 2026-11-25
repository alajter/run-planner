// Vercel Cron: the daily sync. Vercel sends `Authorization: Bearer $CRON_SECRET`.
import { sync } from "@/lib/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const r = await sync();
  return Response.json(r, { status: r.errors.length ? 207 : 200 });
}
