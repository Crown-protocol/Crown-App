// The streamer's own background-photo library. Uploading a photo in the Design tab ("Your photo")
// stores it here so it becomes a reusable tile in the gallery — pick it again on any page or game,
// no re-uploading. localStorage like the rest of the mock backend; shared across every page builder.
//
// Photos are downscaled before they reach this store (see DesignTab), so the library stays well
// under the localStorage budget even with a dozen images.

const KEY = "cheer-bg-library";
const MAX = 12; // keep the newest dozen; plenty for a page's looks, safe for localStorage

export interface BgPhoto {
  id: string;
  url: string; // a (downscaled) data URL
}

export function readBgLibrary(): BgPhoto[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: BgPhoto[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // over quota — drop the oldest and retry once so a fresh upload still lands
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.max(1, list.length - 2))));
    } catch {}
  }
}

// Add a photo (newest first, de-duped by identical data URL) and return the new library.
export function addBgPhoto(url: string): BgPhoto[] {
  const existing = readBgLibrary().filter((p) => p.url !== url);
  const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const next = [{ id, url }, ...existing].slice(0, MAX);
  write(next);
  return next;
}

export function removeBgPhoto(id: string): BgPhoto[] {
  const next = readBgLibrary().filter((p) => p.id !== id);
  write(next);
  return next;
}
