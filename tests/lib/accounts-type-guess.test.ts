import { describe, expect, it } from "vitest";
import { guessAccountType } from "@/lib/accounts/type-guess";

describe("guessAccountType", () => {
  it.each([
    "Amazon Prime Rewards Visa Signature (1234)",
    "Chase Freedom Unlimited CARD",
    "Bank Credit Line",
    "World Mastercard",
    "Amex Blue",
    "American Express Gold",
    "Discover it",
  ])("treats %s as a credit card", (name) => {
    expect(guessAccountType(name)).toBe("credit");
  });
  it.each([
    "TOTAL CHECKING (0000)",
    "EVERYDAY CHECKING",
    "Savings",
  ])("leaves %s as checking", (name) => {
    expect(guessAccountType(name)).toBe("checking");
  });
});
