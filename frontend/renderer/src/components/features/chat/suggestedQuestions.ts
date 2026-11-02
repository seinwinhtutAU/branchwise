const PER_BUSINESS = 2;

/** The starter chips on an empty chat: two about retail and two about wholesale. Only
 *  development and admin accounts can use the assistant, and both see both businesses, so the
 *  set does not depend on the role or the page. Every question is one the assistant's tools
 *  can answer. */
const RETAIL = [
  "How much did we sell today?",
  "What are our top-selling products this month?",
  "What's low on stock?",
  "Explain today's warnings.",
  "How does this week compare with last week?",
  "Which products haven't sold lately?",
];

const WHOLESALE = [
  "Which customers still owe us money?",
  "Which customer orders are still open?",
  "What stock do we have in the warehouse?",
  "Which supplier vouchers are not paid yet?",
  "Which customers ordered the most this month?",
  "Which products are still on the way?",
];

function pick(pool: string[], offset: number): string[] {
  return Array.from(
    { length: PER_BUSINESS },
    (_, i) => pool[(offset + i * 2) % pool.length],
  );
}

/** `day` rotates which questions show, so the chips are not the same every morning. */
export function suggestedQuestions(day: Date): string[] {
  const offset = Math.floor(day.getTime() / 86_400_000);
  return [...pick(RETAIL, offset), ...pick(WHOLESALE, offset)];
}
