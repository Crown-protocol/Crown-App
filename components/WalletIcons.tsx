// Wallet brand marks for the connect picker — self-contained SVG app-icon tiles (brand background +
// mark), so each wallet is recognisable at a glance. Kept deliberately simple/clean; they identify
// the wallet, they're not pixel-exact reproductions.

export function PhantomIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect width="40" height="40" rx="11" fill="#AB9FF2" />
      {/* ghost: domed top, gently waved hem */}
      <path
        d="M9 27.2V19a11 11 0 0 1 22 0v8.2c0 1.35-1.6 2.1-2.7 1.3l-1.7-1.2a1.9 1.9 0 0 0-2.2 0l-1.9 1.35a1.9 1.9 0 0 1-2.2 0l-1.9-1.35a1.9 1.9 0 0 0-2.2 0l-1.7 1.2c-1.1.8-2.7.05-2.7-1.3Z"
        fill="#FFFDF9"
      />
      <ellipse cx="16.2" cy="18.6" rx="1.7" ry="2.9" fill="#534BB1" />
      <ellipse cx="24.2" cy="18.6" rx="1.7" ry="2.9" fill="#534BB1" />
    </svg>
  );
}

export function WalletConnectIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect width="40" height="40" rx="11" fill="#3396FF" />
      <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d="M12.6 18.4c4.1-4.05 10.7-4.05 14.8 0" />
        <path d="M16.1 21.9c2.15-2.1 5.65-2.1 7.8 0" />
      </g>
    </svg>
  );
}

export function SolflareIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="cheer-sf" x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFC10B" />
          <stop offset="1" stopColor="#FC7227" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="#12101A" />
      <g fill="url(#cheer-sf)">
        <circle cx="20" cy="20" r="6" />
        {/* eight tapered rays around the core */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI) / 4;
          const cx = 20 + Math.cos(a) * 10.5;
          const cy = 20 + Math.sin(a) * 10.5;
          return <circle key={i} cx={Number(cx.toFixed(2))} cy={Number(cy.toFixed(2))} r={i % 2 === 0 ? 2.1 : 1.5} />;
        })}
      </g>
    </svg>
  );
}
