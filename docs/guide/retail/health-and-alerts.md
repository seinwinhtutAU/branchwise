# Retail: the health score and Business Alerts

## What is the health score?

One number from 0 to 100 for a branch, on the Dashboard's **Health** tab. It answers: is this branch healthy, and if
not, why? 80 or more is Healthy, 60 to 79 Needs attention, and below 60 is Critical. It never invents figures:
every number behind it is one you can see on the Revenue, Cost, Inventory and Customer tabs or on the Data Quality
page.

## What goes into it?

Five parts, each with its own score and a default share of the total:

- **Sales** (25%): is the branch selling more than the same days last year, in revenue, in average sale and in pairs.
- **Profit** (25%): the gross margin. If less than half of the revenue has a known buying price, the Profit part is
  not scored, and the page says so.
- **Inventory** (25%): how much stock has not sold for 90 days, how many products are about to run out, and how much
  stock is very old. It is always about today's shelf.
- **Customer** (15%): are transactions growing, and is the conversion rate healthy.
- **Data Quality** (10%): how many rows in the imported data look wrong, and how many products have a stock mismatch.
  It tells you whether the other four can be trusted.

A figure that cannot be worked out is left out, and the rest share its weight. The page says why.

## How do I see what to do about it?

Each part links to the tab or page that holds its evidence. Hover a measure to see what it means and the figures
behind it. The branch's most important problems are on **Business Alerts**.

## Can the weights be changed?

Yes, by admin accounts, on the Health tab (**Edit weights**). The weights do not have to add up to 100, and 0 leaves a
part or a measure out. The same weights are used for every branch, so branch scores stay comparable. **Reset to
default** only fills the boxes: nothing changes until you save. Ask the assistant for the weights in use today.

## What are Business Alerts?

**Business Alerts** lists the things that need a decision, for every retail branch. It has Sales, Inventory, Reorder,
Customer and Data quality tabs. Each alert says what is wrong, why, and what to do. Critical needs a decision now,
Warning needs a look, and Normal is only for your information. Alerts have no period: they describe stock as it
is now or a fixed recent history. The alert rules are built in. There is nothing to switch on, and the only
settings that matter are the Data Quality page's check windows.

The full list of alerts, with when each one appears and what to do, is in "Business Alerts".

## What is the difference between Business Alerts and the Data Quality page?

Business Alerts is about the business: stock about to run out, sales falling. The Data Quality page is about the
imported data being wrong: a bad number, a missing record. Data problems are also listed in Business Alerts under
the **Data quality** tab, but the rows themselves are on the Data Quality page.
