import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, valid } from "./lib/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/cron/")) return NextResponse.next();   // cron checks its own secret
  if (await valid(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/|favicon.ico|manifest.webmanifest|icon).*)"] };
