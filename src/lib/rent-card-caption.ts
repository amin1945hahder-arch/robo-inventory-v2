import type { RentCardData } from "@/components/RentCardPaper";

export type { RentCardData };

/**
 * Caption text for a rent-card PDF: every data field on its own line.
 * Shared by the manual "Send PDF to group" button and the automated relay,
 * so the group always sees the same formatting regardless of the trigger.
 */
export function buildCardCaption(card: RentCardData, headline: string): string {
  const lines: string[] = [headline, ""];
  lines.push(`🏷 Item: ${card.groupName} (${card.tag})`);
  if (card.containerChain) lines.push(`📦 Container: ${card.containerChain}`);
  for (const u of card.extraUnits ?? []) lines.push(`   • ${u.groupName} (${u.tag})`);
  lines.push(`👤 Student: ${card.holderName}${card.studentId ? ` · ${card.studentId}` : ""}`);
  if (card.amount !== undefined)
    lines.push(`⚖️ Amount: ${card.amount} ${card.amountUnit ?? ""}`.trimEnd());
  lines.push(`📌 Status: ${card.statusLabel}`);
  if (card.projectName) lines.push(`🤖 Project: ${card.projectName}`);
  if (card.requestedAt)
    lines.push(`📅 Requested: ${new Date(card.requestedAt).toLocaleString("en-GB")}`);
  if (card.decidedAt)
    lines.push(`✅ Decided: ${new Date(card.decidedAt).toLocaleString("en-GB")}`);
  if (card.pickedUpAt)
    lines.push(`📦 Picked up: ${new Date(card.pickedUpAt).toLocaleString("en-GB")}`);
  if (card.returnedAt)
    lines.push(`↩️ Returned: ${new Date(card.returnedAt).toLocaleString("en-GB")}`);
  if (card.conditionReport) lines.push(`📝 Condition: ${card.conditionReport}`);
  return lines.join("\n");
}
