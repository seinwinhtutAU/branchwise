/** Examples for the kind of question a person asks most (see the server's habits.py). Two or
 *  three each, so the example is not the same every day. Every one is something the assistant
 *  can answer. */
const TOPIC_EXAMPLES: Record<string, string[]> = {
  sales: [
    "How much did we sell yesterday?",
    "Which products sold the most this week?",
    "How does this month compare with last month?",
  ],
  stock: [
    "What's low on stock?",
    "How much stock does each branch have?",
    "Which products haven't sold lately?",
  ],
  costs: [
    "What did we spend on purchases this month?",
    "What is our margin this month?",
    "Which supplier did we buy the most from?",
  ],
  warnings: [
    "Explain today's warnings.",
    "Which alert should I look at first?",
    "Are there any new warnings since yesterday?",
  ],
  imports: [
    "Has today's sales file been imported?",
    "Which branches haven't sent their files today?",
    "When was the last inventory file imported?",
  ],
  wholesale: [
    "What should I do next in Wholesale?",
    "Which customer orders are still open?",
    "What stock do we have in the warehouse?",
  ],
  wholesale_money: [
    "Which customers still owe us money?",
    "Which supplier vouchers are not paid yet?",
    "Who has been waiting longest to pay?",
  ],
};

/** An example question in the box starts with this; Tab turns it into the typed question. */
export const TRY_PREFIX = "Try: ";

const DEFAULT_PLACEHOLDER =
  "Ask about sales, inventory, purchases, or warnings…";

/** A follow-up idea that fits what the last answer was about, found from the question's words. */
const FOLLOW_UPS: { match: RegExp; text: string }[] = [
  {
    match: /\b(sell|sold|sale|sales|revenue|order|orders)\b/i,
    text: "Want it split by product or by customer?",
  },
  {
    match: /\b(stock|inventory|low|left)\b/i,
    text: "Want to know which of these sold fastest?",
  },
  {
    match: /\b(warning|warnings|alert|alerts)\b/i,
    text: "Ask what to do about any of these…",
  },
  {
    match: /\b(purchase|purchases|supplier|cost)\b/i,
    text: "Want to compare it with last month?",
  },
];

export function inputPlaceholder({
  branchName,
  lastQuestion,
  hasAnswer,
  failed,
  topic = null,
  day = new Date(),
}: {
  branchName: string | null;
  /** The newest thing the person asked, if the conversation has started. */
  lastQuestion: string | null;
  hasAnswer: boolean;
  failed: boolean;
  /** What this person asks about most, if they have a habit. */
  topic?: string | null;
  day?: Date;
}): string {
  if (failed) return "Try asking it another way, or ask something else…";
  if (lastQuestion === null) {
    const examples = topic === null ? undefined : TOPIC_EXAMPLES[topic];
    if (examples) {
      const pick = Math.floor(day.getTime() / 86_400_000) % examples.length;
      return `${TRY_PREFIX}${examples[pick]}`;
    }
    return branchName === null
      ? DEFAULT_PLACEHOLDER
      : `Ask about ${branchName} sales, inventory, purchases, or warnings…`;
  }
  if (!hasAnswer) return DEFAULT_PLACEHOLDER;
  const hint = FOLLOW_UPS.find((f) => f.match.test(lastQuestion));
  return hint?.text ?? "Ask a follow-up, or something new…";
}
