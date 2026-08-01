import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveMaker } from "@/lib/server/publicMeta";

// The dynamic share image (1200×630) behind every /@handle OpenGraph/Twitter card: the maker's
// avatar (or a monogram), their name and handle, and what the page is for. On-charter — deep violet
// backdrop, one purple accent, no gold. Runs on Node (reads the DB + a local font file).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Load the bundled font once (Noto Sans TTF — Cyrillic-capable, so Russian names render instead of
// tofu; a static TTF because Satori/@vercel/og can't parse woff2). Cached across invocations. If it
// can't be read, ImageResponse falls back to its built-in Latin font.
let fontData: ArrayBuffer | null = null;
async function loadFont(): Promise<ArrayBuffer | null> {
  if (fontData) return fontData;
  try {
    const buf = await readFile(join(process.cwd(), "public/fonts/OgSans.ttf"));
    fontData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return fontData;
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  task: "Set a task",
  roulette: "Game roulette",
  fundraiser: "Fundraiser",
  auction: "Auction",
};

const ACCENT = "#8B7CF6";
const BG = "#100f16";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const maker = await resolveMaker(searchParams.get("handle") || "");
  const kind = searchParams.get("kind") || "";

  const name = maker?.name || "Crown";
  const handle = maker?.handle ? `@${maker.handle}` : "";
  const label = KIND_LABEL[kind] || "Donations, straight to your wallet";
  const letter = (name.trim()[0] || "?").toUpperCase();
  const avatar = maker?.avatarUrl && maker.avatarUrl.startsWith("data:") ? maker.avatarUrl : null;

  const font = await loadFont();

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: BG,
          color: "#F1EFF7",
          fontFamily: "Inter",
          position: "relative",
        }}
      >
        {/* one soft purple wash in the corner — the single accent */}
        <div
          style={{
            position: "absolute",
            top: "-160px",
            right: "-120px",
            width: "560px",
            height: "560px",
            borderRadius: "9999px",
            background: "linear-gradient(135deg, rgba(139,124,246,0.42), rgba(139,124,246,0))",
          }}
        />

        {/* maker */}
        <div style={{ display: "flex", alignItems: "center", gap: "36px" }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              width={168}
              height={168}
              style={{ width: "168px", height: "168px", borderRadius: "9999px", objectFit: "cover", border: `3px solid ${ACCENT}` }}
              alt=""
            />
          ) : (
            <div
              style={{
                width: "168px",
                height: "168px",
                borderRadius: "9999px",
                background: "#211f2c",
                border: `3px solid ${ACCENT}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "84px",
                fontWeight: 700,
                color: "#CFC9E6",
              }}
            >
              {letter}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: "72px", fontWeight: 700, lineHeight: 1.05, maxWidth: "820px" }}>{name}</div>
            {handle ? <div style={{ fontSize: "34px", color: "#8A85A0", marginTop: "6px" }}>{handle}</div> : null}
          </div>
        </div>

        {/* tagline for this surface */}
        <div style={{ display: "flex", fontSize: "40px", color: "#CFC9E6", maxWidth: "980px", lineHeight: 1.25 }}>{label}</div>

        {/* Crown wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: ACCENT, display: "flex" }} />
          <div style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "0.04em" }}>CROWN</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      // Same TTF registered as both weights; Satori maps our `fontWeight: 700` name to it (Noto
      // Regular has no separate bold file, but this keeps the weight lookup from falling back to tofu).
      fonts: font
        ? [
            { name: "Inter", data: font, style: "normal" as const, weight: 400 as const },
            { name: "Inter", data: font, style: "normal" as const, weight: 700 as const },
          ]
        : undefined,
    }
  );
}
