import Link from "next/link";
import { CheerBadge } from "./CheerBadge";

export function Logo() {
  return (
    <Link className="logo" href="/">
      <CheerBadge size={26} />
      Cheer
    </Link>
  );
}
