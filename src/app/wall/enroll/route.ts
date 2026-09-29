import { getDb } from "@/lib/db/client";
import { handleEnroll } from "@/lib/wall/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return handleEnroll(getDb(), request);
}
