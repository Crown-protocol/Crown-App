"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCrown } from "@/lib/data/DataProvider";
import { DonateForm } from "@/components/DonateForm";
import { Mono } from "@/components/Mono";
import { usd } from "@/lib/money";

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

export default function CampaignPage({ params }: { params: { handle: string; slug: string } }) {
  const { getStreamer, getCampaign } = useCrown();
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  const slug = decodeURIComponent(params.slug);
  const streamer = getStreamer(handle);
  const campaign = getCampaign(handle, slug);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!streamer || !campaign) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>Campaign not found</h1>
          <p>Check the link.</p>
          <Link className="btn" href="/">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const goal = campaign.goal ?? 0;
  const pct = goal ? Math.min(100, (campaign.raised / goal) * 100) : 0;
  const left = Math.max(0, goal - campaign.raised);

  return (
    <main className="page">
      <div className="wrap">
        <Link className="trust" href={`/@${streamer.handle}`}>
          <Mono name={streamer.name} size={26} src={streamer.avatarUrl} />
          <span>
            <b>{streamer.name}</b> · @{streamer.handle}
          </span>
        </Link>

        <h1>{campaign.title}</h1>
        <p className="lead">{campaign.lead}</p>

        {goal ? (
          <div className="card">
            <div className="goal-sum">
              <span className="goal-now num">{usd(campaign.raised)}</span>
              <span className="goal-of num">of {usd(goal)}</span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: mounted ? `${pct}%` : "0%" }} />
            </div>
            <div className="goal-meta num">
              {campaign.count} {plural(campaign.count, "donation", "donations")} · {usd(left)} left
            </div>
          </div>
        ) : null}

        <DonateForm handle={streamer.handle} defaultAmount={10} streamerName={`${streamer.name}'s wallet`} slug={campaign.slug} />

        <div className="powered">
          Powered by <Link href="/">Crown</Link>
        </div>
      </div>
    </main>
  );
}
