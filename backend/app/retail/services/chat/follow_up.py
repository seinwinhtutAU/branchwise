"""One suggested next question, written from what the person just asked and what the assistant
answered. It is only a hint for the empty message box, so any failure means no hint."""

from dataclasses import dataclass

from app.retail.services.chat.small_call import SmallCallResult, ask_model

TIMEOUT_SECONDS = 8
MAX_LENGTH = 90


@dataclass(frozen=True)
class FollowUp:
    question: str | None
    call: SmallCallResult | None


def suggest_follow_up(question: str, answer: str, *, business: str | None = None) -> FollowUp:
    """Suggest a follow-up in the same business as the answer it follows.

    The router determines ``business`` from the answer's cited tools, rather than trusting the
    browser to label its own question. Older or plain API clients may not send an answer id; in
    that case the model is allowed to use either side of the business.
    """
    business_rule = {
        "retail": (
            "Make it about Retail only: sales, stock, purchases, imports or warnings. "
            "Do not ask about Wholesale."
        ),
        "wholesale": (
            "Make it about Wholesale only: customer orders, customers owing money, supplier "
            "vouchers, shipments, receivings, warehouse stock, buying, pricing or payments. "
            "Do not ask about Retail."
        ),
    }.get(
        business,
        "Make it about the same side of the business as the answer: Retail or Wholesale.",
    )
    prompt = (
        "A shop owner asked a business assistant a question and got an answer. Write ONE short "
        "follow-up question they would likely ask next, in the same language they used. Rules: "
        "plain everyday words, under 12 words, and it must be something that can be answered "
        f"from shop data. {business_rule} Do not repeat the question "
        "they asked. Reply with the question only, no quotes.\n\n"
        f"Their question: {question[:500]}\n\nThe answer: {answer[:1500]}"
    )
    call = ask_model(prompt, temperature=0.4, timeout=TIMEOUT_SECONDS)
    if call is None:
        return FollowUp(None, None)
    text = call.text.strip("\"'“”").strip()
    if not text or "\n" in text or len(text) > MAX_LENGTH:
        return FollowUp(None, call)
    if text.lower() == question.strip().lower():
        return FollowUp(None, call)
    return FollowUp(text, call)
