"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CrownMark, GameIcon } from "@/components/icons";
import { FundraiserFill } from "@/components/FundraiserFill";
import { OVERLAYS, type OverlayKind } from "@/lib/data/overlays";
import styles from "./ObsWidgets.module.css";

// The QR mockup renders a REAL scannable code (same recipe as the cabinet) — a fake pixel grid
// reads as a fake product the moment someone points a camera at it. Since it IS scannable, it must
// lead somewhere real: it used to encode a hardcoded crown.tv/@toffi, a handle that exists nowhere,
// so anyone pointing a phone at the landing page got a dead link. It now encodes this deployment's
// own origin (localhost while developing, the real domain in production) and @nova — a built-in
// demo page that always resolves. The handle shown under it matches what the code actually holds.
const QR_HANDLE = "nova";

function QrMock() {
  const [qr, setQr] = useState("");
  useEffect(() => {
    // window.origin, not a baked-in domain: the code a visitor scans belongs to the site they're on.
    const base = window.location.origin || process.env.NEXT_PUBLIC_SITE_URL || "https://crown.tv";
    QRCode.toDataURL(`${base}/@${QR_HANDLE}`, { margin: 0, width: 96, color: { dark: "#F1EFF7", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, []);
  return (
    <div className={styles.qr}>
      <div className={styles.qrLabel}>Donate</div>
      {qr ? <img src={qr} alt="" width={84} height={84} /> : <span className={styles.qrBox} />}
      <div className={styles.qrHandle}>@{QR_HANDLE}</div>
    </div>
  );
}

const TOP_DONORS: [string, string][] = [
  ["toffi", "$120"],
  ["demon_x", "$85"],
  ["mira.eth", "$60"],
];

// The actual widget mockups, drawn a bit larger — no captions, the widget is the whole point.
// Exported so the cabinet Widgets tab reuses these exact populated mockups as its card previews
// (a live-scaled real overlay reads as a tiny unreadable speck in a 330px card).
export function Widget({ kind }: { kind: OverlayKind }) {
  if (kind === "alerts") {
    return (
      <div className={styles.alert}>
        <span className={styles.alertAvatar} aria-hidden>
          T
        </span>
        <div className={styles.alertBody}>
          <div className={styles.alertRow}>
            <span className={styles.alertName}>toffi</span>
            <span className={styles.amtPill}>$50</span>
          </div>
          <span className={styles.alertMsg}>Beat the boss with no armor on</span>
        </div>
      </div>
    );
  }
  if (kind === "rank") {
    return (
      <div className={styles.alert}>
        <span className={styles.rankBadge} aria-hidden>
          <CrownMark />
        </span>
        <div className={styles.alertBody}>
          <div className={styles.rankLine}>
            <b>toffi</b> reached <span className={styles.rankTier}>VIP</span>
          </div>
        </div>
      </div>
    );
  }
  if (kind === "goal") {
    return (
      <div className={styles.goal}>
        <div className={styles.goalTop}>
          <span className={styles.goalLabel}>New stream setup</span>
          <span className={styles.goalPct}>66%</span>
        </div>
        <div className={styles.goalTrack}>
          <span className={styles.goalFill} />
        </div>
        <span className={styles.goalSub}>$1,320 of $2,000</span>
      </div>
    );
  }
  if (kind === "roulette") {
    return (
      <div className={styles.game}>
        <div className={styles.gameHead}>
          <GameIcon id="roulette" width={16} height={16} />
          Roulette
          <span className={styles.gamePot}>$1,600 pot</span>
        </div>
        <div className={styles.gameRow}>
          <span className={styles.gameName}>Warcraft III</span>
          <span className={styles.gameBar}>
            <span style={{ width: "62%" }} />
          </span>
          <span className={styles.gamePct}>62%</span>
        </div>
        <div className={styles.gameRow}>
          <span className={styles.gameName}>Fortnite</span>
          <span className={styles.gameBar}>
            <span style={{ width: "31%" }} />
          </span>
          <span className={styles.gamePct}>31%</span>
        </div>
      </div>
    );
  }
  if (kind === "task") {
    return (
      <div className={styles.game}>
        <div className={styles.gameHead}>
          <GameIcon id="task" width={16} height={16} />
          Task
          <span className={styles.gamePot}>$50</span>
        </div>
        <div className={styles.gameText}>“Beat the boss with no armor on.”</div>
        <div className={styles.gameSub}>toffi · 24h to do it</div>
      </div>
    );
  }
  if (kind === "auction") {
    return (
      <div className={styles.game}>
        <div className={styles.gameHead}>
          <GameIcon id="auction" width={16} height={16} />
          Auction
          <span className={styles.gamePot}>$120 leads</span>
        </div>
        <div className={styles.gameRow}>
          <span className={styles.gameName}>Hardest difficulty</span>
          <span className={styles.gameBar}>
            <span style={{ width: "100%" }} />
          </span>
          <span className={styles.gamePct}>$120</span>
        </div>
        <div className={styles.gameRow}>
          <span className={styles.gameName}>Cam upside down</span>
          <span className={styles.gameBar}>
            <span style={{ width: "71%" }} />
          </span>
          <span className={styles.gamePct}>$85</span>
        </div>
      </div>
    );
  }
  if (kind === "fundraiser") {
    return (
      <div className={styles.fund}>
        {/* the NEW brand mark (hexagon badge) filling up — same figure as the real fundraiser page */}
        <FundraiserFill pct={0.72} size={58} />
        <div className={styles.fundBody}>
          <div className={styles.fundPct}>72%</div>
          <div className={styles.fundNums}>$1,440 of $2,000</div>
        </div>
      </div>
    );
  }
  if (kind === "ticker") {
    return (
      <div className={styles.ticker}>
        {[
          ["toffi", "$120"],
          ["demon_x", "$85"],
          ["mira.eth", "$60"],
        ].map(([name, amt], i) => (
          <span className={styles.tickerEntry} key={name}>
            {i > 0 && <span className={styles.tickerDot} aria-hidden />}
            <span className={styles.tickerName}>{name}</span>
            <span className={styles.tickerAmt}>{amt}</span>
          </span>
        ))}
        <span className={styles.tickerTotal}>Tonight $412</span>
      </div>
    );
  }
  if (kind === "qr") {
    return <QrMock />;
  }
  if (kind === "session") {
    return (
      <div className={styles.session}>
        <span className={styles.sessionDot} aria-hidden />
        <span className={styles.sessionAmt}>$1,234</span>
        <span className={styles.sessionSub}>this stream · 18 donations</span>
      </div>
    );
  }
  if (kind === "record") {
    return (
      <div className={styles.record}>
        <div className={styles.recordHead}>Stream record</div>
        <div className={styles.recordWho}>
          <CrownMark /> Whale
        </div>
        <div className={styles.recordAmt}>$120</div>
        <div className={styles.recordFoot}>beat it</div>
      </div>
    );
  }
  if (kind === "train") {
    return (
      <div className={styles.train}>
        <div className={styles.trainX}>
          TRAIN <b>×4</b>
        </div>
        <div className={styles.trainSum}>$63</div>
        <div className={styles.trainFuse}>
          <span />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.top}>
      <div className={styles.topTitle}>Top supporters</div>
      {TOP_DONORS.map(([name, amt], idx) => (
        <div className={styles.topRow} key={name}>
          <span className={styles.rank}>{idx + 1}</span>
          <span className={styles.name}>{name}</span>
          <span className={styles.amt}>{amt}</span>
        </div>
      ))}
    </div>
  );
}

const CYCLE_MS = 3200;

// One widget at a time, animating to the next every few seconds and looping. The widget is keyed
// by index so React remounts it each cycle and its enter animation replays.
export function ObsWidgets() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % OVERLAYS.length), CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Drop them straight into OBS</h2>

      <div className={styles.stage}>
        <div key={i} className={styles.widget}>
          <Widget kind={OVERLAYS[i].kind} />
        </div>
      </div>
      {/* No pager dots: a row of them counts the set out loud and caps how many widgets the
          reel appears to hold. It just keeps cycling instead. */}
    </div>
  );
}
