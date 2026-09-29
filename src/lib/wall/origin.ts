/**
 * The origin the client actually used: the tunnel's host and scheme when the
 * request came through a proxy, else the request URL's own origin.
 */
export function requestOrigin(i: { url: string; headers: Headers }): string {
  const url = new URL(i.url);
  const host =
    i.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const forwarded = i.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded || url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}
