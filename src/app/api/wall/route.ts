import { getDb } from "@/lib/db/client";
import { handleWallRequest } from "@/lib/wall/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return handleWallRequest(getDb(), request);
}
