import { NextResponse } from "next/server";

import { resolveWebBuildIdentity } from "../../../lib/build-info";

// The pages are statically prerendered, so the identity is read per request
// here rather than baked into the HTML at build time.
export const dynamic = "force-dynamic";

/**
 * Which build the web service is actually serving.
 *
 * The API exposes the same information at GET /version. This is the web's
 * own copy, so a reader can ask either service and get the identity of
 * that service.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true, build: resolveWebBuildIdentity() });
}
