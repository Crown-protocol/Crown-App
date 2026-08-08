// One line at the top of every game's rules form, saying the thing the form otherwise leaves
// implicit: these are your STANDING rules, and editing them does not reach a session that is
// already running.
//
// It matters because the alternative reads as a bug from both sides. Without it, a maker changes a
// minimum mid-run and reasonably expects the live page to follow — it doesn't, and can't: a session
// snapshots its rules when it opens (lib/data/gameConfig.ts), precisely so nobody can move the
// goalposts under money already in escrow. Saying so here turns "why didn't my change apply?" into
// a rule people can hold in their head.
export function RulesScopeNote() {
  return (
    <p className="footnote rules-scope-note">
      These are your default rules — they apply to <b>sessions you start from now on</b>. A session
      already running keeps the rules it opened with, so nothing changes for money already in play.
    </p>
  );
}
