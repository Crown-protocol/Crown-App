// The viewer's preferred display name on donations — set once on /me, prefilled into every donate
// form (still editable per-donation). Plain localStorage, same pattern as the demo session.
const KEY = "cheer-donor-name";

export function readDonorName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeDonorName(name: string) {
  try {
    const v = name.trim().slice(0, 40);
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {}
}
