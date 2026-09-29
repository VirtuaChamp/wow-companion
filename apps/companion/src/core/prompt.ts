import type { Mention, Snapshot } from "@wow-companion/contracts";

function formatMention(mention: Mention): string {
  return mention.kind === "quest" ? `- quest ${mention.questId}` : `- item ${mention.itemId}`;
}

export const PLAIN_TEXT_RULE =
  "Write short plain text without markdown: no asterisks, no backticks, no headings, no tables.";

export const WEB_SOURCES_RULE =
  "For web lookups use only web search, and only wowhead.com, warcraft.wiki.gg and icy-veins.com; you cannot open pages and must never use any other website.";

export const WAYPOINT_RULE =
  "A waypoint is only offered to the player as a button they click; never say you placed or set one, say you are offering it.";

export const TITLE_SYSTEM =
  "You write short titles for chat conversations. Reply with the title only: 3 to 5 words, plain text, one line, no quotation marks, no punctuation at the end.";

export function buildTitlePrompt(question: string, reply: string): string {
  return [
    "Write a 3 to 5 word title for this conversation.",
    "",
    "Question:",
    question,
    "",
    "Answer:",
    reply,
  ].join("\n");
}

export function build(
  snapshot: Snapshot,
  mentions: readonly Mention[],
  transcriptSummary?: string,
): string {
  const lines: string[] = [];
  if (transcriptSummary !== undefined && transcriptSummary.length > 0) {
    lines.push("Previous conversation summary:", transcriptSummary, "");
  }
  lines.push(`Character: level ${snapshot.character.level}, ${snapshot.character.faction}`);
  lines.push(
    `Location: ${snapshot.position.zone} / ${snapshot.position.subzone} (${snapshot.position.x}, ${snapshot.position.y})`,
  );
  lines.push(`Money: ${snapshot.money}`);
  if (mentions.length > 0) {
    lines.push("Mentions:", ...mentions.map(formatMention));
  }
  return lines.join("\n");
}
