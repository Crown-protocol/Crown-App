import type { Metadata } from "next";
import { resolveMaker, makerMetadata } from "@/lib/server/publicMeta";

// Per-game share card ("{name} · task" + its own OG image). Passthrough — the existing /@handle
// existence gate and 404 live one level up in [handle]/layout.tsx.
export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const maker = await resolveMaker(params.handle);
  return maker ? makerMetadata(maker, "task", "/task") : {};
}

export default function TaskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
