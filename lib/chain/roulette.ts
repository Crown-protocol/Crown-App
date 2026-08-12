// ──────────────────────────────────────────────────────────────────
// roulette: the wheel's derivations, this side of the wire.
//
// A byte-for-byte twin of `crown-games/roulette/logic` — the round id, the entry
// key, the memo, the tally and the spin. The game has no canister and no
// signature over its verdict: its entire trust model is that **independent
// implementations reach the same winner**, so a drift between this file and that
// crate is not a bug in a feature, it is the game quietly ceasing to be
// verifiable while still looking fine.
//
// That is why `npm run verify:games` does not read this file, it *runs* it,
// against the vectors pinned in `roulette/logic/tests/vectors.rs`.
//
// **Deliberately free of imports.** No `@/` aliases, no `@solana/web3.js`, no
// `Buffer` — plain `Uint8Array` and `crypto.subtle`, which both the browser and
// bare Node have. The check script can then import this module directly instead
// of re-implementing it and hoping the two agree. Callers holding a `PublicKey`
// pass `.toBytes()`; that conversion belongs to them, not here.
// ──────────────────────────────────────────────────────────────────

export const RL_DOMAIN_ROUND = "crown:roulette:v2:round";
export const RL_DOMAIN_ENTRY = "crown:roulette:v2:entry";
export const RL_DOMAIN_SPIN = "crown:roulette:v2:spin";

/** Memo prefix and the exact length of a well-formed memo, in bytes. */
export const RL_MEMO_PREFIX = "crown:rl:1:";
export const RL_MEMO_LEN = 140;

export const RL_MAX_TITLE_BYTES = 128;
export const RL_MAX_TOPIC_BYTES = 64;

const enc = new TextEncoder();

/** The rules of one wheel — what the recipient signs, and what `round_id` hashes. */
export interface RouletteAnnouncement {
  /** `sha256("crown-chain:v1:" ‖ cluster)`, 32 bytes — the book's own chain key. */
  chain: Uint8Array;
  /** Recipient's wallet, 32 bytes. */
  recipient: Uint8Array;
  /** Tells apart concurrent rounds of the same recipient. */
  nonce: bigint;
  /** First slot whose stakes count. */
  openSlot: bigint;
  /** Stakes count strictly below this slot; the beacon is drawn at or above it. */
  closeSlot: bigint;
  /** Floor on a stake, measured on what the splitter moves. */
  minGross: bigint;
  /** How long the recipient commits to playing the winner. */
  playMinutes: bigint;
  /**
   * Slots between elimination stages. **`0` means one spin decides it.**
   *
   * Anything else turns the round into knock-outs, each with its own beacon at
   * `closeSlot + k · stageSlots` — so a donation between stages lands in the next
   * stage's weights. One beacon for the whole series would fix every knock-out at
   * the close, and then giving between stages would change nothing, which is the
   * entire point of the format.
   */
  stageSlots: bigint;
  /** One word for what goes on the wheel ("game", "film"), raw bytes. */
  topic: Uint8Array;
}

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

function u16le(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** Lowercase hex, the only spelling this game admits. */
export function rlHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function fromHex32(s: string): Uint8Array | null {
  if (s.length !== 64 || !/^[0-9a-f]+$/.test(s)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The canonical bytes of an announcement.
 *
 * `round_id` hashes **all** of them rather than a chosen subset, and that is
 * load-bearing: a signature can be issued twice, so a recipient whose id did not
 * commit, say, `playMinutes` could sign a second announcement with the same id
 * and a different promise. Hashing everything makes that arithmetically
 * impossible — different rules are a different round.
 *
 * `null` when the topic cannot carry its own length prefix, which the validator
 * rejects long before.
 */
export function encodeAnnouncement(a: RouletteAnnouncement): Uint8Array | null {
  if (a.chain.length !== 32 || a.recipient.length !== 32) return null;
  if (a.topic.length > 0xffff) return null;
  return concat([
    a.chain,
    a.recipient,
    u64le(a.nonce),
    u64le(a.openSlot),
    u64le(a.closeSlot),
    u64le(a.minGross),
    u64le(a.playMinutes),
    u64le(a.stageSlots),
    u16le(a.topic.length),
    a.topic,
  ]);
}

/**
 * The inverse of [`encodeAnnouncement`] — the rules back out of the bytes.
 *
 * Kept beside the encoder rather than near either of its callers: a decoder that
 * drifts from its encoder produces rounds that look valid and hash to something
 * else, and the two are only obviously in step when they are read together.
 * `null` on anything that is not exactly one announcement, length included.
 */
export function decodeAnnouncement(bytes: Uint8Array): RouletteAnnouncement | null {
  if (bytes.length < 114) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const topicLen = dv.getUint16(112, true);
  if (bytes.length !== 114 + topicLen) return null;
  return {
    chain: bytes.slice(0, 32),
    recipient: bytes.slice(32, 64),
    nonce: dv.getBigUint64(64, true),
    openSlot: dv.getBigUint64(72, true),
    closeSlot: dv.getBigUint64(80, true),
    minGross: dv.getBigUint64(88, true),
    playMinutes: dv.getBigUint64(96, true),
    stageSlots: dv.getBigUint64(104, true),
    topic: bytes.slice(114, 114 + topicLen),
  };
}

/** Hex → bytes, for the places that carry an announcement as a string. */
export function rlFromHex(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** `sha256(RL_DOMAIN_ROUND ‖ announcement)`. */
export async function deriveRoundId(a: RouletteAnnouncement): Promise<Uint8Array | null> {
  const bytes = encodeAnnouncement(a);
  return bytes ? sha256(concat([enc.encode(RL_DOMAIN_ROUND), bytes])) : null;
}

/** Why an announcement is not a wheel this client will build. */
export type RouletteInvalid = "TopicTooLong" | "SlotsOutOfOrder" | "FloorBelowPlatform";

/**
 * `platformFloor` is the round floor the network will honour, i.e. the *net* of
 * the paid-donation floor — passed in rather than imported, because it is a
 * per-cluster number and this module deliberately knows no config.
 */
export function validateAnnouncement(
  a: RouletteAnnouncement,
  platformFloor: bigint
): RouletteInvalid | null {
  if (a.topic.length > RL_MAX_TOPIC_BYTES) return "TopicTooLong";
  if (a.closeSlot <= a.openSlot) return "SlotsOutOfOrder";
  if (a.minGross < platformFloor) return "FloorBelowPlatform";
  return null;
}

/**
 * `sha256(RL_DOMAIN_ENTRY ‖ round_id ‖ title)` — the identity of one slice, and
 * the only thing about a variant that ever reaches the chain.
 *
 * **The title is hashed raw, with no normalization.** Case folding and NFKC
 * would drag Unicode tables into the one path that must agree between strangers,
 * making the winner depend on which table version a verifier happens to hold.
 * The price is that "Warcraft III" and "warcraft iii" are two slices — which the
 * UI must warn about BEFORE the donor signs, since afterwards there is nothing
 * left to merge them with.
 */
export async function deriveEntryKey(
  roundId: Uint8Array,
  title: Uint8Array
): Promise<Uint8Array | null> {
  if (title.length === 0 || title.length > RL_MAX_TITLE_BYTES) return null;
  return sha256(concat([enc.encode(RL_DOMAIN_ENTRY), roundId, title]));
}

/** The memo a stake carries: `crown:rl:1:<64 hex round>:<64 hex entry>`. */
export function buildMemo(roundId: Uint8Array, entryKey: Uint8Array): string {
  return `${RL_MEMO_PREFIX}${rlHex(roundId)}:${rlHex(entryKey)}`;
}

/** The memo for a title, or `null` if the title is not one the game accepts. */
export async function memoForTitle(roundId: Uint8Array, title: Uint8Array): Promise<string | null> {
  const key = await deriveEntryKey(roundId, title);
  return key ? buildMemo(roundId, key) : null;
}

export interface RouletteMemoTag {
  roundId: Uint8Array;
  entryKey: Uint8Array;
}

/**
 * Read a memo instruction as a stake tag, or refuse it.
 *
 * Strict on purpose — exact length, exact prefix, lowercase hex, one separator.
 * The chain is shared with every other application's memos, and a rule that
 * admits spellings then has to say which ones.
 */
export function parseMemo(data: string | Uint8Array): RouletteMemoTag | null {
  const s = typeof data === "string" ? data : new TextDecoder().decode(data);
  if (s.length !== RL_MEMO_LEN || !s.startsWith(RL_MEMO_PREFIX)) return null;
  const rest = s.slice(RL_MEMO_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const roundId = fromHex32(rest.slice(0, sep));
  // Any further separator stays in this half and fails the hex test — that is
  // how "one separator" is enforced without counting them.
  const entryKey = fromHex32(rest.slice(sep + 1));
  return roundId && entryKey ? { roundId, entryKey } : null;
}

/** One recognized stake: a slice key and what the splitter actually moved. */
export interface RouletteStake {
  key: Uint8Array;
  /** `Settled.gross`, minor units. */
  gross: bigint;
}

/** One slice of the wheel. */
export interface RouletteSlice {
  key: Uint8Array;
  /** Σ `Settled.gross` behind it — and therefore its odds. */
  weight: bigint;
}

export interface RouletteWheel {
  /** Slices in canonical order: ascending by key, never by arrival. */
  slices: RouletteSlice[];
  total: bigint;
}

/**
 * Aggregate recognized stakes into the round's wheel.
 *
 * The floor applies to **each** stake, and that includes backing something
 * already on the wheel: topping up is a donation of its own, so a sub-floor
 * top-up buys nothing. Counter-intuitive and worth saying out loud in the UI
 * before the donor signs.
 */
export function tallyWheel(stakes: RouletteStake[], minGross: bigint): RouletteWheel {
  const byKey = new Map<string, bigint>();
  let total = 0n;
  for (const s of stakes) {
    if (s.gross < minGross) continue;
    const k = rlHex(s.key);
    byKey.set(k, (byKey.get(k) ?? 0n) + s.gross);
    total += s.gross;
  }
  const slices = [...byKey.entries()]
    // Fixed-length lowercase hex sorts exactly as the raw bytes do.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, weight]) => ({ key: fromHex32(k) as Uint8Array, weight }));
  return { slices, total };
}

export type RouletteVerdict =
  | { kind: "void" }
  | { kind: "winner"; key: Uint8Array; weight: bigint; total: bigint };

/**
 * The spin: `x = be(sha256(RL_DOMAIN_SPIN ‖ round_id ‖ beacon)[..16]) mod total`.
 *
 * `beacon` is the blockhash of the first produced block at or above the round's
 * close slot. Stakes count strictly *below* that slot, so by the time the seed
 * exists the entry set is already in the past — there is no window in which
 * someone sees the seed and still places a stake.
 */
export async function spinWheel(
  roundId: Uint8Array,
  beacon: Uint8Array,
  wheel: RouletteWheel
): Promise<RouletteVerdict> {
  if (wheel.total === 0n) return { kind: "void" };
  // Stage 0: a single-spin round is the one-stage case of the same draw.
  const x = (await draw(roundId, beacon, 0)) % wheel.total;

  let acc = 0n;
  for (const s of wheel.slices) {
    acc += s.weight;
    if (x < acc) return { kind: "winner", key: s.key, weight: s.weight, total: wheel.total };
  }
  // Unreachable: `x < total` and the weights sum to `total`.
  return { kind: "void" };
}

/** `be(sha256(RL_DOMAIN_SPIN ‖ round_id ‖ beacon ‖ u32le(stage))[..16])`. */
async function draw(roundId: Uint8Array, beacon: Uint8Array, stage: number): Promise<bigint> {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, stage, true);
  const seed = await sha256(concat([enc.encode(RL_DOMAIN_SPIN), roundId, beacon, idx]));
  let x = 0n;
  for (let i = 0; i < 16; i++) x = (x << 8n) | BigInt(seed[i]);
  return x;
}

/**
 * Integer square root — Newton's method on BigInt.
 *
 * Integer on purpose: a floating-point root in a rule that decides where money
 * goes would make the winner depend on a language's math library. This is the
 * same value `u128::isqrt` returns, exactly, on every input.
 */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Numerator of the elimination weight — see the crate for why this size. */
const ELIM_SCALE = 1n << 64n;

/**
 * How likely each survivor is to be **knocked out** — the inverse of the square
 * root of its pool. Money protects here instead of winning.
 *
 * Inverse, not `max − sqrt + 1`: the latter pins the leader's weight at 1, so a
 * pool ahead by one percent becomes fifty times safer and one ahead fourfold is
 * untouchable. The inverse is smooth — four times the money is about twice the
 * safety, ten times about three.
 */
export function eliminationWeights(alive: RouletteSlice[]): bigint[] {
  return alive.map((s) => {
    const root = isqrt(s.weight);
    return ELIM_SCALE / (root > 0n ? root : 1n);
  });
}

/**
 * The slice this stage knocks out, or `null` when there is nothing to knock out.
 *
 * `alive` is the wheel **as it stands at this stage**: the caller rebuilds it
 * from the stakes visible at the stage's slot, minus whoever is already out —
 * which is what makes a donation between stages matter.
 */
export async function knockOut(
  roundId: Uint8Array,
  beacon: Uint8Array,
  stage: number,
  alive: RouletteWheel
): Promise<Uint8Array | null> {
  if (alive.slices.length < 2) return null;
  const weights = eliminationWeights(alive.slices);
  const total = weights.reduce((a, w) => a + w, 0n);
  if (total === 0n) return null;
  const x = (await draw(roundId, beacon, stage)) % total;
  let acc = 0n;
  for (let i = 0; i < alive.slices.length; i++) {
    acc += weights[i];
    if (x < acc) return alive.slices[i].key;
  }
  return alive.slices[alive.slices.length - 1].key;
}

/**
 * What reaches the splitter when a donor pays `donation` at `feeBps` — the floor
 * a round must publish to demand a donation of that size.
 *
 * The two floors are one number seen from two sides, and this is the one place
 * that translates: a maker sets "$5 minimum" (a donation), while the tally
 * measures what the splitter moved.
 */
export function entryFloorFromDonation(donation: bigint, feeBps: number): bigint {
  return donation - (donation * BigInt(feeBps)) / 10_000n;
}

/**
 * How a stake with no published title is shown — never invented, never blank.
 * A memo can be built by any client, so a slice whose preimage nobody published
 * is an ordinary case rather than an error (spec §Тексты).
 */
export function shortKey(entryKey: Uint8Array): string {
  return `0x${rlHex(entryKey).slice(0, 8)}`;
}
