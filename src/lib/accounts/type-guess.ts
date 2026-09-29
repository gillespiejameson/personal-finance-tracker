const CARD_WORDS =
  /card|credit|visa|mastercard|amex|american express|discover|rewards/i;

/** Guess an app account type from a bank-side name; the user can change it later. */
export function guessAccountType(name: string): "checking" | "credit" {
  return CARD_WORDS.test(name) ? "credit" : "checking";
}
