import { describe, expect, it } from "vitest";
import { requestOrigin } from "@/lib/wall/origin";

const at = (url: string, headers: Record<string, string> = {}) =>
  requestOrigin({ url, headers: new Headers(headers) });

describe("requestOrigin", () => {
  it("uses the request URL when nothing is forwarded", () => {
    expect(at("http://localhost:3000/wall/enroll?token=good")).toBe(
      "http://localhost:3000",
    );
    expect(at("https://finance.example.test/wall/enroll")).toBe(
      "https://finance.example.test",
    );
  });
  it("prefers the forwarded host and proto", () => {
    expect(
      at("http://localhost:3000/wall/enroll?token=good", {
        "x-forwarded-host": "finance.example.test",
        "x-forwarded-proto": "https",
      }),
    ).toBe("https://finance.example.test");
  });
  it("takes the first proto out of a comma list", () => {
    expect(
      at("http://localhost:3000/wall", {
        "x-forwarded-host": "finance.example.test",
        "x-forwarded-proto": "https,http",
      }),
    ).toBe("https://finance.example.test");
    expect(
      at("http://localhost:3000/wall", {
        "x-forwarded-proto": " https , http",
      }),
    ).toBe("https://localhost:3000");
  });
  it("takes the first host out of a comma list", () => {
    expect(
      at("http://localhost:3000/wall", {
        "x-forwarded-host": "a.example, b.example",
      }),
    ).toBe("http://a.example");
    expect(
      at("http://localhost:3000/wall", {
        "x-forwarded-host": " ",
      }),
    ).toBe("http://localhost:3000");
  });
  it("keeps the port of a LAN URL", () => {
    expect(at("http://192.168.1.20:3000/api/wall")).toBe(
      "http://192.168.1.20:3000",
    );
  });
});
