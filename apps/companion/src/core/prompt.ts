import type { Mention, Snapshot } from "@wow-companion/contracts";

function formatMention(mention: Mention): string {
  return mention.kind === "quest" ? `- quest ${mention.questId}` : `- item ${mention.itemId}`;
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
