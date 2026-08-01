"use client";

import Link from "next/link";
import { useCrown } from "@/lib/data/DataProvider";
import { usePublicProfile } from "@/lib/data/usePublicProfile";
import { tierInfo } from "@/lib/level";
import { Logo } from "@/components/Logo";
import { DonateForm } from "@/components/DonateForm";
import { Feed } from "@/components/Feed";
import { ViewerLive } from "@/components/ViewerLive";
import { Mono } from "@/components/Mono";
import { SocialIcon, SOCIAL_LABEL } from "@/components/icons";
import { normalizeSocialLink } from "@/lib/data/social-links";

export default function StreamerPage({ params }: { params: { handle: string } }) {
  const { getReputation, lastGainFor } = useCrown();
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  // Resolve the maker by handle against the Crown DB (same source the game sub-pages use), WITH a
  // loading gate — getStreamer() resolved synchronously and flashed the "no such maker" screen on a
  // real page's primary donation link while /api/profiles was still in flight.
  const { profile: streamer, status } = usePublicProfile(handle);

  // Blank frame while resolving — never the "nothing here" gate mid-fetch.
  if (status === "loading") return <main className="page" />;

  if (!streamer) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>No such content maker</h1>
          <p>Check the link — there might be a typo in the handle.</p>
          <Link className="btn" href="/">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const reputation = getReputation(streamer.handle);
  const lastGain = lastGainFor(streamer.handle);
  const { current, next } = tierInfo(reputation, streamer.tiers);
  // Progress toward the next tier: from the current tier's threshold (or 0) up to the next one.
  const fromT = current?.threshold ?? 0;
  const repPct = next ? Math.min(100, Math.max(0, Math.round(((reputation - fromT) / Math.max(1, next.threshold - fromT)) * 100))) : 100;
  const hasTiers = (streamer.tiers?.length ?? 0) > 0;

  return (
    <main className="page vpage">
      {/* One calm centred column: who you're supporting → the donate action (the whole point) with a
          slim reputation strip → what else is live → who's supporting. No competing sidebar, no void. */}
      <div className="vcol">
        {/* ---- identity ---- */}
        <header className="vhero">
          <Mono name={streamer.name} size={88} src={streamer.avatarUrl} />
          <h1 className="vname">{streamer.name}</h1>
          <div className="vhandle">@{streamer.handle}</div>
          {streamer.socials.length > 0 && (
            <div className="vsocials">
              {streamer.socials.map((s) => {
                // Output-side anti-phishing: only render a clickable link if it canonicalizes to a real
                // profile URL on the platform's domain. A bad link isn't shown as a link at all.
                const safe = normalizeSocialLink(s.kind, s.url);
                if (!safe) return null;
                return (
                  <a key={s.kind} href={safe} target="_blank" rel="noreferrer nofollow" aria-label={SOCIAL_LABEL[s.kind]}>
                    <SocialIcon kind={s.kind} />
                  </a>
                );
              })}
            </div>
          )}
        </header>

        {/* ---- the donate action: the hero of the page ---- */}
        <section className="vdonate" aria-label={`Donate to ${streamer.name}`}>
          <DonateForm handle={streamer.handle} defaultAmount={5} streamerName={`${streamer.name}'s wallet`} presets={streamer.donatePresets} />

          {/* Reputation as a slim strip under the donate card — informative, never a competing box. */}
          <div className="vrep">
            <div className="vrep-top">
              <span className="vrep-label">Your reputation with {streamer.name}</span>
              <span className="vrep-num num">
                {reputation}
                <span className={`vrep-gain num${lastGain ? " show" : ""}`}>{lastGain ? `+${lastGain}` : ""}</span>
              </span>
            </div>
            {hasTiers && (
              <>
                <div className="vrep-tierline">
                  {current ? (
                    <span className="vrep-tier">
                      <span className="vrep-dot" style={{ background: current.color }} />
                      {current.name}
                    </span>
                  ) : (
                    <span className="vrep-tier vrep-tier-none">Not a member yet</span>
                  )}
                  {next && (
                    <span className="vrep-toNext">
                      {next.threshold - reputation} to <b>{next.name}</b>
                    </span>
                  )}
                </div>
                {next && (
                  <div className="vrep-track">
                    <div className="vrep-fill" style={{ width: `${repPct}%` }} />
                  </div>
                )}
              </>
            )}
            <div className="vrep-foot">
              <span className="vrep-hint">$1 donated = 1 reputation</span>
              <Link className="vrep-link" href="/me">
                All your reputation →
              </Link>
            </div>
          </div>
        </section>

      </div>

      {/* Below the donate hero the page widens into two columns — live games on the left, recent
          supporters on the right — so the horizontal space is used and the page doesn't run long.
          On a phone they stack. (Each side renders nothing when empty, and the row collapses to one
          column then.) */}
      <div className="vsecondary">
        <div className="vsec-live">
          <ViewerLive handle={streamer.handle} name={streamer.name} profile={streamer} />
        </div>
        <section className="vfeed">
          <Feed title="Recent supporters" limit={5} />
        </section>
      </div>

      <footer className="vfooter">
        <Logo />
      </footer>
    </main>
  );
}
