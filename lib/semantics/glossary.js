/**
 * What the company's words mean, written once and included in every prompt
 * that answers from company data (Analytics, DM @AI, Dashboards, Audit).
 * Keep it short: it is read on every question.
 */

export const DOMAIN_GLOSSARY = `Canada Gold buys and sells precious metals (bullion, coins, scrap jewelry) in retail stores across Canada. Three POS tenants hold the ledger: Canada Gold East (Quebec and Atlantic stores), GTA (Ontario), and PMX (Richmond Hill). Each tenant's orders (SO) and purchases (PO) records are the ledger at ticket grain: date, store, employee, customer, items, total, and every label on the record (currency, payment method, source, delivery, item status, bookkeeping status, customer type, product and transaction tags, till). Any count, dollar figure, or breakdown by any of those is computed from the records, whether or not an app screen shows it; the same goes for the labels on product, payment, and customer records (metal, form, priority; method, till, direction; type, status, city). Store names are the join key between systems; "Quebec City" and "Quebec" are the same store, "Sauga" is Mississauga, "Richmond" is Richmond Hill.

Documents: SO# is a sale (we sold to a customer). PO# is a purchase (we bought from a customer). TR# is a transfer of stock between stores. A ticket's amount is its total; a ticket can be paid by several methods (cash, debit/Interac, cheque, e-transfer, credit card, bank wire), and a split ticket is grouped under both names ("Cash + Debit"). Source is where a ticket came from (Website, In store, eBay, Whatnot, Walmart); delivery is Ship or In person for sales. Item status is received (purchase taken in), pending (sale not yet delivered), or sent (delivered). Bookkeeping status is Paid, Not paid, To be received, or Partially paid; "Paid" or "Cleared" is the only status that moves cash. FINTRAC: a cash deal at or above $10,000 needs a Large Cash Transaction Report.

Products: GBAR is a gold bar, SBAR a silver bar, GML a Gold Maple Leaf (also Maplegram, MLBD), SML a Silver Maple Leaf, RCM the Royal Canadian Mint. Codes and long names are the same product.

Money on hand: the till (Till 1 CAD, and a separate USD drawer) is the cash physically in the store right now; "financials" is the flow of cash payments in and out over a period. They are different questions. Expected till = yesterday's closing count + today's cleared cash payments net + today's manual till entries net; variance = counted − expected.

People and time: Rippling holds punches and the shift schedule and carries no store; a person's store is their default store in the POS directory. RingCentral holds calls per store; an inbound call is "answered" if it was picked up on the first ring or recovered later by a callback or a later answered call, "still missed" otherwise; answer rate = answered / inbound. A day with no inbound calls has no answer rate (null), never 0%. Google reviews are per store. All dates and days are Toronto local time.

Triage: staff evaluate purchase tickets. An error is a purchase marked incorrect, and each error carries a recorded dollar amount (errorAmount — the Amount column in the Triage app). That amount is the value of the mistake, not the PO ticket total; errorValue is the sum of those amounts.`;
