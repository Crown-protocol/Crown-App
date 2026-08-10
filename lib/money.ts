// The one money formatter for the whole UI. Money is the product, so it must read
// the same everywhere: a leading "$", thousands separators, and cents ONLY when
// there are cents.
//   usd(2000)  → "$2,000"
//   usd(12.5)  → "$12.50"
//   usd(0.98)  → "$0.98"
//
// It used to round to whole dollars, on the assumption that every amount in the
// app was a whole number of dollars. That assumption came from the mock era. Real
// donations are USDC with six decimals: the first live one was $0.98 and every
// screen showed it as "$1" — or, where the amount was floored on the way in, as
// "$0". Rounding money is how a feed ends up claiming a creator was paid a dollar
// they never received.
export function usd(n: number | undefined | null): string {
  const v = n || 0;
  if (Number.isInteger(v)) return "$" + v.toLocaleString("en-US");
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** @deprecated `usd` keeps cents now — this is the same function, kept so call sites can migrate. */
export const usdPrecise = usd;
