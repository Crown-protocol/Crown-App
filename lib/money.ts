// The one money formatter for the whole UI. Money is the product, so it must read the same
// everywhere — one format: a leading "$", thousands separators, whole dollars.
//   usd(2000)  → "$2,000"
//   usd(1440)  → "$1,440"
// Before this the app mixed "$1,600", "1,600 $" and "1600 $", sometimes on the same screen.
// Amounts here are already whole USDC dollars (minor units are divided out upstream).
export function usd(n: number | undefined | null): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
