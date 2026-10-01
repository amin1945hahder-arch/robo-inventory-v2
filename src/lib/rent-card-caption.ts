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
  // Dates only (en-GB day/month/year) — the day matters on a receipt.
  const d = (n: number) => new Date(n).toLocaleDateString("en-GB");
  if (card.requestedAt) lines.push(`📅 Requested: ${d(card.requestedAt)}`);
  if (card.decidedAt) lines.push(`✅ Decided: ${d(card.decidedAt)}`);
  if (card.pickedUpAt) lines.push(`📦 Picked up: ${d(card.pickedUpAt)}`);
  if (card.dueAt) lines.push(`⏳ Return by: ${d(card.dueAt)}`);
  if (card.returnedAt) lines.push(`↩️ Returned: ${d(card.returnedAt)}`);
  if (card.conditionReport) lines.push(`📝 Condition: ${card.conditionReport}`);
  return lines.join("\n");
}
