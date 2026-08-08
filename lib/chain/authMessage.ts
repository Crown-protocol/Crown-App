// The signed-mutation message format — shared by the browser (builds & signs)
// and the server (rebuilds & verifies). One format for every mutating API:
//
//   cheer-app:<action>:<subject>:<ts>:<bodyHashHex>
//
// ts is unix seconds (server rejects anything older/newer than the window);
// bodyHash pins the exact JSON payload so a captured signature can't be
// replayed with a different body. Isomorphic: WebCrypto only.

export const AUTH_WINDOW_SECONDS = 300;

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildAuthMessage(action: string, subject: string, ts: number, body: unknown): Promise<Uint8Array> {
  const bodyHash = body === null ? "-" : await sha256Hex(JSON.stringify(body));
  return new TextEncoder().encode(`cheer-app:${action}:${subject.toLowerCase()}:${ts}:${bodyHash}`);
}
