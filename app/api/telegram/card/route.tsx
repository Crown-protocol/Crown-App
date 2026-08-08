import { ImageResponse } from "next/og";

// Notification cards for the Telegram bot — the site's design, drawn as a PNG. The bot downloads
// from here and uploads to Telegram as a photo (Telegram can't reach localhost itself).
// Layouts are fixed, values come in as query params: ?t=notify&label=…&value=…&title=…&sub=…
// or ?t=stats&title=…&rows=Label:Value|Label:Value|…
//
// Charter (docs/front.md §II): the exact site tokens, one purple accent per card — the brand mark
// (the same CheerBadge gradient hexagon as the nav) plus its echo in the footer strip. Everything
// else neutral: the label is a pill (status by shape, not color), figures are big white bold.

export const runtime = "edge";

// globals.css tokens, inlined (an edge image route can't read CSS variables).
const BG = "#141318"; // --bg-0
const PANEL = "#1B1A21"; // --bg-1
const LINE = "rgba(235, 233, 244, 0.08)"; // --line
const LINE_STRONG = "rgba(235, 233, 244, 0.16)"; // --line-strong
const TEXT_1 = "#F1EFF7";
const TEXT_2 = "#A6A2B4";
const GRAD_TOP = "#8B7CF6"; // --grad-top (accent gradient: GRAD_TOP → GRAD_END)
const GRAD_END = "#F4F2FE";
// The public domain printed on shared cards. Configurable so a non-cheer.tv deployment shows its
// own host instead of a hardcoded one; cheer.tv is the documented production default.
const SITE_DOMAIN = process.env.NEXT_PUBLIC_SITE_DOMAIN || "cheer.tv";

// The site's brand mark, verbatim from components/CheerBadge.tsx — the gradient hexagon with the
// cheer punched through to the page. This is the card's one accent-gradient spot.
function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GRAD_TOP} />
            <stop offset="100%" stopColor={GRAD_END} />
          </linearGradient>
        </defs>
        <path d="M24 1.5 44.5 13.25 44.5 34.75 24 46.5 3.5 34.75 3.5 13.25Z" fill="url(#g)" />
        <path d="M24 5.6 40.9 15.3 40.9 32.7 24 42.4 7.1 32.7 7.1 15.3Z" fill="none" stroke={BG} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M12.6 32.4 14.2 19.4 19.3 26.2 24 14.6 28.7 26.2 33.8 19.4 35.4 32.4C29.6 34.6 18.4 34.6 12.6 32.4Z" fill={BG} />
        <circle cx="14.2" cy="17.6" r="2.4" fill={BG} />
        <circle cx="24" cy="12.8" r="2.7" fill={BG} />
        <circle cx="33.8" cy="17.6" r="2.4" fill={BG} />
        <path d="M14.4 30.6C20 33 28 33 33.6 30.6 28 31.9 20 31.9 14.4 30.6Z" fill="url(#g)" />
      </svg>
      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5, color: TEXT_1 }}>Cheer</div>
    </div>
  );
}

// The category label — a neutral pill, like every status on the site: shape carries the meaning,
// color stays out of it (the accent belongs to the brand mark alone).
function Chip({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "10px 22px",
        borderRadius: 999,
        border: `2px solid ${LINE_STRONG}`,
        color: TEXT_2,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: 3,
      }}
    >
      {text.toUpperCase()}
    </div>
  );
}

// Clip a single line to a pixel width, ellipsis included. Satori has no text-overflow, so a string
// that doesn't fit simply overruns the card instead of being cut — which is exactly what happened
// the first time someone pasted a wall of text with no spaces in it.
//
// The width estimate is deliberately rough: Inter's average glyph runs ~0.55em, but CJK and emoji
// are full-width, so those count double. Erring narrow costs a few characters; erring wide puts
// text outside the image.
function fit(text: string, fontSize: number, maxWidth: number): string {
  const widthOf = (s: string) => {
    let w = 0;
    for (const ch of s) w += /[ᄀ-ᇿ⺀-鿿가-힯＀-｠]|\p{Extended_Pictographic}/u.test(ch) ? 1 : 0.55;
    return w * fontSize;
  };
  if (widthOf(text) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && widthOf(chars.join("") + "…") > maxWidth) chars.pop();
  return chars.join("") + "…";
}

// Same idea across several wrapped lines: break long unbroken runs so they wrap at all, then clip
// to `lines`. Words are kept whole where they fit — only a word too long for one line is chopped.
function clamp(text: string, fontSize: number, maxWidth: number, lines: number): string {
  const per = Math.max(4, Math.floor(maxWidth / (fontSize * 0.55)));
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    // A single word wider than the line: chop it into line-sized pieces so it wraps instead of
    // running off the edge.
    while (w.length > per) {
      if (line) { out.push(line); line = ""; }
      out.push(w.slice(0, per));
      w = w.slice(per);
      if (out.length >= lines) return out.slice(0, lines).join(" ").slice(0, per * lines - 1) + "…";
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= per) line += " " + w;
    else { out.push(line); line = w; }
    if (out.length >= lines) return out.slice(0, lines).join(" ") + "…";
  }
  if (line) out.push(line);
  return out.length > lines ? out.slice(0, lines).join(" ") + "…" : out.join(" ");
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: BG,
        padding: 56,
      }}
    >
      {children}
      <div
        style={{
          display: "flex",
          height: 8,
          width: 320,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${GRAD_TOP}, ${GRAD_END})`,
          marginTop: "auto",
        }}
      />
    </div>
  );
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const t = p.get("t") ?? "notify";
  const title = p.get("title") ?? "";
  const sub = p.get("sub") ?? "";
  const label = p.get("label") ?? "";
  const value = p.get("value") ?? "";
  const handle = p.get("handle") ?? "";

  if (t === "stats") {
    // rows: "Label:Value|Label:Value" — the prepared captions; only the figures change.
    // "|" as the row separator because the figures themselves contain commas ($4,120).
    //
    // Split on the FIRST colon only: values are free text now (a suggested game's name, someone's
    // @handle), and "Idea:it works 1:1" must not be dropped for having two colons.
    const rows = (p.get("rows") ?? "")
      .split("|")
      .map((r) => {
        const i = r.indexOf(":");
        return i === -1 ? null : [r.slice(0, i), r.slice(i + 1)];
      })
      .filter((r): r is string[] => r !== null && r[1].trim() !== "");

    return new ImageResponse(
      (
        <Frame>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Wordmark />
            {label ? <Chip text={label} /> : null}
          </div>
          {/* One line, always: a wrapped title printed straight over the tiles, because this row is
              laid out at its own height and a second line doesn't push anything down. Clipping to a
              fixed height instead sliced the letters in half — so keep the row its natural height
              and make sure the text can't wrap in the first place. */}
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontSize: 46,
              fontWeight: 700,
              color: TEXT_1,
              marginTop: 34,
              marginBottom: 22,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {fit(title, 46, 1040)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {rows.map(([k, v], i) => {
              // A tile is 500 wide with 28 of padding either side, so 444 of usable text. Values used
              // to be figures ("$4,120") and always fit; now they can be anything a stranger typed,
              // and one long unbroken word ran straight off the card. Shrink first, then clip.
              //
              // Long values get two lines rather than one tiny one: at 26px a single line holds
              // barely half a sentence, and the cut landed mid-word often enough to look like the
              // text itself was broken.
              const size = v.length > 26 ? 26 : v.length > 16 ? 34 : 44;
              const shown = size === 26 ? clamp(v, 26, 444, 2) : fit(v, size, 444);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: 500,
                    marginRight: i % 2 === 0 ? 44 : 0,
                    marginBottom: 18,
                    padding: "18px 28px",
                    background: PANEL,
                    border: `1px solid ${LINE}`,
                    borderRadius: 18,
                  }}
                >
                  <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: TEXT_2, letterSpacing: 1 }}>
                    {fit(k, 22, 444)}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: size,
                      fontWeight: 700,
                      color: TEXT_1,
                      marginTop: 4,
                      lineHeight: 1.25,
                      maxWidth: 444,
                    }}
                  >
                    {shown}
                  </div>
                </div>
              );
            })}
          </div>
        </Frame>
      ),
      { width: 1200, height: 630 }
    );
  }

  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark />
          {label ? <Chip text={label} /> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: value ? 40 : 72 }}>
          {value ? (
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700, color: TEXT_1, lineHeight: 1, letterSpacing: -3 }}>
              {fit(value, 150, 1088)}
            </div>
          ) : null}
          {/* maxWidth wraps on spaces, but an unbroken run of characters ignores it — so cap the
              number of lines too. Two for the title, three for the body: past that the card stops
              being a card and the full text is in the message underneath anyway. */}
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: TEXT_1, marginTop: 28, lineHeight: 1.15, maxWidth: 1050 }}>
            {clamp(title, 52, 1050, 2)}
          </div>
          {sub ? (
            <div style={{ display: "flex", fontSize: 30, color: TEXT_2, marginTop: 18, lineHeight: 1.35, maxWidth: 1000 }}>
              {clamp(sub, 30, 1000, 3)}
            </div>
          ) : null}
        </div>
        {handle ? (
          <div style={{ display: "flex", fontSize: 24, color: TEXT_2, marginTop: 30 }}>{`${SITE_DOMAIN}/@${handle}`}</div>
        ) : null}
      </Frame>
    ),
    { width: 1200, height: 630 }
  );
}
