# Wholesale: settings and lists

## Where do I change the wholesale settings?

Open **Settings** and choose the **Wholesale** tab. It is for admin accounts. It has:

- **Exchange rates**: today's Ks rate for each foreign currency (Baht). It only fills in a new line that is priced
  in that currency. A saved line keeps the rate it was saved with, so changing the rate never changes an old amount.
- **Selling price profit**: the profit the order form adds when it suggests a selling price. Choose `%` (a share
  of the selling price, under 100) or `Ks a set` (a fixed amount on every set). The default is 20%. The assistant
  reads the value in use today, so ask it rather than relying on this page.
- **Carriers**: who carries a shipment. Cargo companies and drivers are one list.
- **Fee types**: what a transportation cost was for, such as carrier fee, porters or a second trip.
- **Places**: every place products can be: stops on a route, receiving gates and warehouses. Tick **Warehouse**
  for a place that keeps stock. A place that products are moved to becomes a warehouse by itself.

## Can I add a name while I am typing it?

Yes. Where you type a supplier, a customer, a carrier, a place or a fee type, a name that is not in the list is
offered as a new entry, so you add it right there. A name is never added twice, whatever the letter case. A
product typed on an order or voucher line that is not in the product list yet can be added from the line.

## What happens when I delete one?

Lists are never emptied for good. A deleted supplier, customer, carrier, place or product is hidden from the
pickers, and the records that used it keep the name. You can bring hidden ones back by showing inactive entries.

## Can I get my data out?

On the Dashboard, **Export to Excel** gives one workbook with a sheet for each screen: **Customers**, **Orders**,
**Order Lines**, **Payments Received**, **Suppliers**, **Vouchers**, **Voucher Lines**, **Payments Made**,
**Shipments**, **Transportation Costs**, **Products** and **Stock Movements**. **CSV files** gives a zip of plain
files, one per sheet. The sheets use the screens' own words (Ready to deliver, Left to collect, Left to pay) and
write a quantity the way the screens do, such as "4 Sets 2 Pairs", so a number in the file is the number on the screen.
