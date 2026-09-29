import { describe, expect, it } from "vitest";
import {
  accountsUrl,
  CLAIM_USED_ERROR,
  claimAccessUrl,
  fetchAccounts,
  maskAccessUrl,
  NETWORK_ERROR,
  REJECTED_ERROR,
  SUBSCRIPTION_ERROR,
  UNREADABLE_ERROR,
} from "@/lib/simplefin/client";
import { toParsedRows } from "@/lib/simplefin/map";

type Call = { url: string; init?: RequestInit };

/** A fake `fetch` that records calls and answers with a canned response. */
function fake(respond: (call: Call) => Response | Promise<Response>): {
  fetchFn: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const ACCESS = "https://alice:s3cret@sfin.test/simplefin";
const WINDOW = { start: 1780000000, end: 1788795000 };

const payload = {
  errors: [],
  accounts: [
    {
      id: "ACT-1",
      org: { domain: "bank.test", name: "Test Bank" },
      name: "Checking",
      currency: "USD",
      balance: "1234.56",
      "available-balance": "1200.00",
      "balance-date": 1788700000,
      transactions: [
        {
          id: "TRN-1",
          posted: 1788566400,
          amount: "-12.34",
          description: "KROGER",
          extra: "ignored",
        },
      ],
    },
  ],
};

describe("maskAccessUrl", () => {
  it("hides the credentials and keeps the host and path", () => {
    expect(maskAccessUrl(ACCESS)).toBe("https://…@sfin.test/simplefin");
    expect(maskAccessUrl("garbage")).toBe("…");
  });
});

describe("claimAccessUrl", () => {
  it("POSTs an empty body and returns the access URL from the body", async () => {
    const { fetchFn, calls } = fake(
      () => new Response(`${ACCESS}\n`, { status: 200 }),
    );
    const res = await claimAccessUrl(
      fetchFn,
      "https://bridge.simplefin.org/simplefin/claim/abc",
    );
    expect(res).toEqual({ ok: true, accessUrl: ACCESS });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://bridge.simplefin.org/simplefin/claim/abc",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe("");
  });

  it("maps 403 to the already-used message and other statuses to a plain one", async () => {
    const used = fake(() => new Response("", { status: 403 }));
    expect(await claimAccessUrl(used.fetchFn, "https://b.test/claim")).toEqual({
      ok: false,
      error: CLAIM_USED_ERROR,
    });
    const boom = fake(() => new Response("", { status: 500 }));
    expect(await claimAccessUrl(boom.fetchFn, "https://b.test/claim")).toEqual({
      ok: false,
      error: "SimpleFIN returned 500.",
    });
  });

  it("maps a thrown fetch to the network message", async () => {
    const { fetchFn } = fake(() => {
      throw new TypeError("fetch failed");
    });
    expect(await claimAccessUrl(fetchFn, "https://b.test/claim")).toEqual({
      ok: false,
      error: NETWORK_ERROR,
    });
  });

  it("rejects a body that is not a credentialed URL", async () => {
    const { fetchFn } = fake(
      () => new Response("https://sfin.test/simplefin", { status: 200 }),
    );
    expect(await claimAccessUrl(fetchFn, "https://b.test/claim")).toEqual({
      ok: false,
      error: UNREADABLE_ERROR,
    });
  });

  it("refuses to claim over plain http except on loopback", async () => {
    const { fetchFn, calls } = fake(
      () => new Response("http://u:p@127.0.0.1:1/simplefin", { status: 200 }),
    );
    expect(
      await claimAccessUrl(fetchFn, "http://evil.test/claim"),
    ).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    expect(await claimAccessUrl(fetchFn, "http://127.0.0.1:1/claim")).toEqual({
      ok: true,
      accessUrl: "http://u:p@127.0.0.1:1/simplefin",
    });
  });
});

describe("accountsUrl", () => {
  it("strips credentials, appends /accounts and the window", () => {
    expect(accountsUrl(new URL(ACCESS), WINDOW, { pending: true })).toBe(
      "https://sfin.test/simplefin/accounts?start-date=1780000000&end-date=1788795000&pending=1",
    );
    expect(
      accountsUrl(new URL(`${ACCESS}/`), WINDOW, { balancesOnly: true }),
    ).toBe(
      "https://sfin.test/simplefin/accounts?start-date=1780000000&end-date=1788795000&balances-only=1",
    );
  });
});

describe("fetchAccounts", () => {
  it("sends Basic auth built from the URL credentials and validates the payload", async () => {
    const { fetchFn, calls } = fake(
      () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await fetchAccounts(fetchFn, ACCESS, WINDOW, { pending: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.payload.accounts[0].transactions?.[0]).toEqual({
      id: "TRN-1",
      posted: 1788566400,
      amount: "-12.34",
      description: "KROGER",
    });
    expect(calls[0].url).toBe(
      "https://sfin.test/simplefin/accounts?start-date=1780000000&end-date=1788795000&pending=1",
    );
    expect(calls[0].init?.method).toBe("GET");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("alice:s3cret").toString("base64")}`,
    );
    expect(calls[0].url).not.toContain("s3cret");
  });

  it("decodes percent-encoded credentials before building the header", async () => {
    const { fetchFn, calls } = fake(
      () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }),
    );
    await fetchAccounts(
      fetchFn,
      "https://a%40b:p%2Fw@sfin.test/simplefin",
      WINDOW,
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("a@b:p/w").toString("base64")}`,
    );
  });

  it("maps 403, 402, other statuses, network errors and bad JSON", async () => {
    const at = (status: number, body = "") =>
      fake(() => new Response(body, { status })).fetchFn;
    expect(await fetchAccounts(at(403), ACCESS, WINDOW)).toEqual({
      ok: false,
      status: 403,
      error: REJECTED_ERROR,
    });
    expect(await fetchAccounts(at(402), ACCESS, WINDOW)).toEqual({
      ok: false,
      status: 402,
      error: SUBSCRIPTION_ERROR,
    });
    expect(await fetchAccounts(at(503), ACCESS, WINDOW)).toEqual({
      ok: false,
      status: 503,
      error: "SimpleFIN returned 503.",
    });
    expect(await fetchAccounts(at(200, "<html>"), ACCESS, WINDOW)).toEqual({
      ok: false,
      status: 200,
      error: UNREADABLE_ERROR,
    });
    expect(
      await fetchAccounts(at(200, JSON.stringify({ nope: 1 })), ACCESS, WINDOW),
    ).toEqual({ ok: false, status: 200, error: UNREADABLE_ERROR });
    const down = fake(() => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchAccounts(down.fetchFn, ACCESS, WINDOW)).toEqual({
      ok: false,
      error: NETWORK_ERROR,
    });
  });

  it("accepts nulls where a bridge has nothing to report", async () => {
    const nulls = {
      errors: null,
      accounts: [
        {
          id: "ACT-1",
          org: { domain: null, name: null },
          name: "Checking",
          currency: "USD",
          balance: "-12.00",
          "available-balance": null,
          "balance-date": 1788700000,
          transactions: [
            {
              id: "TRN-1",
              posted: 1788566400,
              amount: "-12.34",
              description: "KROGER",
              payee: null,
              memo: null,
              pending: null,
              transacted_at: null,
            },
          ],
        },
        {
          id: "ACT-2",
          name: "Savings",
          currency: "USD",
          balance: "5.00",
          "balance-date": 1788700000,
          org: null,
          transactions: null,
        },
      ],
    };
    const { fetchFn } = fake(
      () => new Response(JSON.stringify(nulls), { status: 200 }),
    );
    const res = await fetchAccounts(fetchFn, ACCESS, WINDOW);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    const t = res.payload.accounts[0].transactions?.[0];
    expect(t).toMatchObject({ payee: null, memo: null, transacted_at: null });
    // A posted timestamp carries the row even with every optional field null.
    expect(toParsedRows(t ? [t] : [])).toEqual({
      skipped: [],
      rows: [
        {
          externalId: "TRN-1",
          pending: false,
          row: {
            date: "2026-09-05",
            amountCents: -1234,
            rawDescription: "KROGER",
            merchant: "Kroger",
          },
        },
      ],
    });
    expect(res.payload.accounts[1].org).toBeNull();
  });

  it("refuses an access URL without credentials or over non-loopback http", async () => {
    const { fetchFn, calls } = fake(() => new Response("{}", { status: 200 }));
    expect(
      await fetchAccounts(fetchFn, "https://sfin.test/simplefin", WINDOW),
    ).toEqual({ ok: false, error: REJECTED_ERROR });
    expect(
      await fetchAccounts(fetchFn, "http://u:p@sfin.test/simplefin", WINDOW),
    ).toEqual({ ok: false, error: REJECTED_ERROR });
    expect(calls).toHaveLength(0);
  });
});
