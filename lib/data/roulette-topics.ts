// Roulette isn't only about games. A streamer can put anything up for the wheel — films to watch,
// tracks to play, food to cook, workouts to suffer through — so the categories are per-TOPIC, not a
// hardcoded list of game genres. The streamer picks a topic (or writes their own categories) and the
// public page speaks that topic's language: "Suggest a film" instead of "Suggest a game".
//
// Adding a topic = one entry here. Nothing else in the app needs to know about it.

export interface RouletteTopic {
  id: string;
  label: string; // shown in the topic picker
  // What a single suggestion IS, in the streamer's words. Drives the public page's copy, so it must
  // read naturally in "Suggest a <noun>" and "<Noun> of the round".
  noun: string;
  categories: string[]; // the chips a viewer tags their suggestion with
}

export const ROULETTE_TOPICS: RouletteTopic[] = [
  {
    id: "games",
    label: "Games",
    noun: "game",
    categories: ["Action", "Shooter", "Strategy", "RPG", "Sports", "Horror", "Party", "Simulation", "Racing", "Other"],
  },
  {
    id: "films",
    label: "Films & series",
    noun: "film",
    categories: ["Action", "Comedy", "Drama", "Horror", "Sci-fi", "Thriller", "Animation", "Documentary", "Classic", "Other"],
  },
  {
    id: "music",
    label: "Music",
    noun: "track",
    categories: ["Pop", "Rock", "Hip-hop", "Electronic", "Metal", "Jazz", "Classical", "Folk", "Soundtrack", "Other"],
  },
  {
    id: "food",
    label: "Food & cooking",
    noun: "dish",
    categories: ["Breakfast", "Street food", "Baking", "Asian", "Italian", "Desserts", "Vegan", "Spicy", "Weird", "Other"],
  },
  {
    id: "challenges",
    label: "Challenges & dares",
    noun: "challenge",
    categories: ["Fitness", "Endurance", "Skill", "Speedrun", "Creative", "Silly", "Team", "Solo", "Risky", "Other"],
  },
  {
    id: "topics",
    label: "Talk topics",
    noun: "topic",
    categories: ["Q&A", "Story time", "Hot take", "Review", "Tutorial", "Debate", "Reaction", "Advice", "Behind the scenes", "Other"],
  },
  {
    id: "creative",
    label: "Creative work",
    noun: "piece",
    categories: ["Drawing", "Painting", "Design", "Writing", "Photo", "Video", "Music-making", "Craft", "Remix", "Other"],
  },
  {
    id: "custom",
    label: "Custom — my own",
    noun: "idea",
    categories: [], // the streamer writes their own; falls back to no categories at all
  },
];

export const DEFAULT_TOPIC_ID = "games";

export function topicById(id: string | undefined): RouletteTopic {
  return ROULETTE_TOPICS.find((t) => t.id === id) ?? ROULETTE_TOPICS[0];
}

// The word a suggestion IS, for all the public copy ("Suggest a <noun>", "back a <noun>").
//
// `topic` is now a free-text field the streamer types ("film", "track", "челлендж") — no more fixed
// picker. Two bits of backward-compat keep old pages reading right:
//   • a value that still matches a preset topic id (e.g. "films", saved before this change) resolves
//     to that preset's noun ("film"), so those pages don't suddenly say "filmss";
//   • empty / whitespace falls back to "game", the original default.
export function topicNoun(topic: string | undefined): string {
  const raw = (topic ?? "").trim();
  if (!raw) return "game";
  const preset = ROULETTE_TOPICS.find((t) => t.id === raw);
  return preset ? preset.noun : raw;
}

// The categories actually offered for a config: the topic's own list, plus whatever custom ones the
// streamer added. Custom topics live entirely on the custom list.
export function categoriesFor(topicId: string | undefined, custom: string[] | undefined): string[] {
  const base = topicById(topicId).categories;
  const extra = (custom ?? []).map((c) => c.trim()).filter(Boolean);
  // De-duplicate case-insensitively so "RPG" typed by hand doesn't sit next to the preset "RPG".
  const seen = new Set(base.map((c) => c.toLowerCase()));
  return [...base, ...extra.filter((c) => !seen.has(c.toLowerCase()))];
}
