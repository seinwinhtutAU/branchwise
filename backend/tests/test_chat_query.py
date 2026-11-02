"""The assistant's ad-hoc query path: the views, the SQL guard, and the read-only runner."""

from datetime import date, datetime

import pytest
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.retail.services.chat.data_views import VIEWS, examples
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.sql_guard import UnsafeQuery, check
from app.retail.services.chat.tools import build_tools
from app.retail.services.stock import latest_stock_query


def _seed(db: Session) -> None:
    db.add_all(
        [
            Branch(id="a", name="Branch A", phone_number="0", address="x"),
            Branch(id="b", name="Branch B", phone_number="0", address="x"),
            Branch(id="w", name="Wholesale", phone_number="0", address="x"),
            User(
                id="wu",
                name="W",
                email="w@example.com",
                role=UserRole.WHOLESALE,
                branch_id="w",
            ),
            Product(id="p1", stock_code="P1", description="Shoe", group_name="Shoes"),
            Product(id="p2", stock_code="P2", description="Bag"),
        ]
    )
    db.flush()
    sales = [
        # id, branch, day, product, qty, net
        ("s1", "a", date(2026, 10, 5), "p1", 2, 3000),  # Monday
        ("s2", "a", date(2026, 10, 4), "p2", 1, 500),  # Sunday
        ("s3", "b", date(2026, 9, 28), "p1", 4, 8000),
    ]
    for sale_id, branch, day, product, qty, net in sales:
        db.add(
            Sale(
                id=sale_id,
                branch_id=branch,
                slip_id=sale_id,
                slip_number="1",
                sale_date=day,
            )
        )
        db.flush()
        db.add(
            SaleLine(
                id=f"l-{sale_id}",
                sale_id=sale_id,
                line_id=f"x-{sale_id}",
                line_no=1,
                product_id=product,
                qty=qty,
                selling_price=net / qty,
                net_amount=net,
            )
        )
    # Branch A was counted twice; only the newer count is "current".
    for snap, qty in ((datetime(2026, 10, 1), 9), (datetime(2026, 10, 3), 4)):
        db.add(
            StockLevel(
                branch_id="a", product_id="p1", on_hand_qty=qty, snapshot_at=snap
            )
        )
    db.add(
        StockLevel(
            branch_id="b",
            product_id="p2",
            on_hand_qty=7,
            snapshot_at=datetime(2026, 10, 2),
        )
    )
    purchase = Purchase(
        id="pu1", branch_id="a", purchase_number="PO1", purchase_date=date(2026, 10, 2)
    )
    db.add(purchase)
    db.flush()
    db.add(
        PurchaseLine(
            id="pl1", purchase_id="pu1", product_id="p1", quantity=10, buying_price=1200
        )
    )
    db.commit()


def _admin() -> User:
    return User(id="u", name="A", email="a@example.com", role=UserRole.ADMIN)


def _tools(db: Session, user: User | None = None):
    sources: list[ToolSource] = []
    tools = {t.name: t for t in build_tools(db, user or _admin(), sources=sources)}
    return tools, sources


def _query(db: Session, sql: str, user: User | None = None) -> str:
    tools, _ = _tools(db, user)
    return tools["run_query"].invoke({"sql": sql})


# --- the views say what the screens say ---------------------------------------------


def test_v_sales_total_matches_the_sales_metric(db_session: Session):
    _seed(db_session)
    tools, _ = _tools(db_session)
    from_tool = tools["calculate_metric"].invoke(
        {
            "rule_id": "sales_summary",
            "date_from": "2026-09-01",
            "date_to": "2026-10-31",
            "group_by": ["branch"],
        }
    )
    assert "Branch A: Sales 2; Items sold 3; Net revenue Ks 3,500" in from_tool
    assert "Branch B: Sales 1; Items sold 4; Net revenue Ks 8,000" in from_tool

    assert "11500" in _query(
        db_session, "SELECT SUM(net_amount) AS revenue FROM v_sales"
    )


def test_v_stock_current_is_each_branchs_newest_count(db_session: Session):
    _seed(db_session)
    expected = {
        (branch.name, product.stock_code, float(stock.on_hand_qty))
        for stock, product, branch in latest_stock_query(db_session).all()
    }

    text = _query(
        db_session,
        "SELECT branch, stock_code, on_hand_qty FROM v_stock_current ORDER BY branch",
    )

    rows = {tuple(line.split(" | ")) for line in text.splitlines()[1:]}
    assert {(b, c, float(q)) for b, c, q in rows} == expected
    assert ("Branch A", "P1", 4.0) in expected  # the older count of 9 is not current


def test_v_stock_history_keeps_every_count(db_session: Session):
    _seed(db_session)
    assert "3" in _query(db_session, "SELECT COUNT(*) AS n FROM v_stock_history")


def test_v_purchases_cost_matches_the_purchase_metric(db_session: Session):
    _seed(db_session)
    tools, _ = _tools(db_session)
    assert "Ks 12,000" in tools["calculate_metric"].invoke(
        {
            "rule_id": "purchase_summary",
            "date_from": "2026-10-01",
            "date_to": "2026-10-31",
        }
    )

    assert "12000" in _query(db_session, "SELECT SUM(cost) AS cost FROM v_purchases")


def test_approved_retail_metric_rules_match_sales_product_and_purchase_totals(
    db_session: Session,
):
    _seed(db_session)
    tools, sources = _tools(db_session)

    sales = tools["calculate_metric"].invoke(
        {
            "rule_id": "sales_summary",
            "date_from": "2026-09-01",
            "date_to": "2026-10-31",
            "group_by": ["branch"],
            "measures": ["transactions", "quantity", "revenue", "average_sale"],
            "sort_by": "revenue",
        }
    )
    products = tools["calculate_metric"].invoke(
        {
            "rule_id": "top_selling_products",
            "date_from": "2026-09-01",
            "date_to": "2026-10-31",
        }
    )
    purchases = tools["calculate_metric"].invoke(
        {
            "rule_id": "purchase_summary",
            "date_from": "2026-10-01",
            "date_to": "2026-10-31",
        }
    )

    assert (
        "Branch B: Sales 1; Items sold 4; Net revenue Ks 8,000; Average sale Ks 8,000"
        in sales
    )
    assert "P1 — Shoe: Items sold 6; Net revenue Ks 11,000" in products
    assert "2026-10-02: Quantity purchased 10; Purchase cost Ks 12,000" in purchases
    assert [source.source_name for source in sources] == [
        "get_retail_metric",
        "get_retail_metric",
        "get_retail_metric",
    ]


def test_month_weekday_and_category_are_precomputed(db_session: Session):
    _seed(db_session)

    text = _query(
        db_session,
        "SELECT sale_date, sale_month, weekday, category FROM v_sales "
        "WHERE branch = 'Branch A' ORDER BY sale_date",
    )

    assert "2026-10-04 | 2026-10 | 7 | Uncategorized" in text  # Sunday, no category
    assert "2026-10-05 | 2026-10 | 1 | Shoes" in text  # Monday


def test_v_branches_lists_retail_branches_only(db_session: Session):
    _seed(db_session)

    text = _query(db_session, "SELECT branch FROM v_branches ORDER BY branch")

    assert text.splitlines()[1:] == ["Branch A", "Branch B"]


# --- the guard ------------------------------------------------------------------------


@pytest.mark.parametrize("dialect", ["postgresql", "sqlite"])
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT branch, SUM(net_amount) FROM v_sales GROUP BY branch",
        "WITH m AS (SELECT * FROM v_sales) SELECT COUNT(*) FROM m",
        "SELECT s.branch, p.category FROM v_sales s JOIN v_products p ON p.stock_code = s.stock_code",
        "SELECT ROW_NUMBER() OVER (PARTITION BY branch ORDER BY net_amount DESC) FROM v_sales",
        "SELECT ROUND(SUM(net_amount) / 3, 2), COALESCE(MAX(qty), 0), LOWER(branch) "
        "FROM v_sales WHERE branch LIKE '%A%' GROUP BY branch",
        "SELECT 1 UNION SELECT 2",
        "SELECT name FROM v_sales WHERE x = ':not_a_bind'",
    ],
)
def test_guard_accepts_ordinary_reads(sql: str, dialect: str):
    assert check(sql, dialect).sql


@pytest.mark.parametrize("dialect", ["postgresql", "sqlite"])
@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM sales",
        "UPDATE sales SET net_amount = 0",
        "DROP TABLE sales",
        "SELECT 1; SELECT 2",
        "SELECT * FROM v_sales; DROP TABLE sales",
        "SELECT * FROM users",
        "SELECT * FROM sales",
        "SELECT * FROM public.sales",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM pg_catalog.pg_tables",
        "SELECT * FROM v_sales WHERE x IN (SELECT password FROM users)",
        "WITH v_sales AS (SELECT 1) SELECT * FROM v_sales",
        "WITH x AS (DELETE FROM sales RETURNING *) SELECT * FROM x",
        "SELECT * INTO copy FROM v_sales",
        "SELECT * FROM v_sales FOR UPDATE",
        "SELECT pg_sleep(60)",
        "SELECT set_config('a', 'b', false)",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT * FROM generate_series(1, 100000000)",
        "SELECT generate_series(1, 100000000)",
        "",
        "   ;  ",
    ],
)
def test_guard_refuses_anything_that_is_not_a_plain_read_of_the_views(
    sql: str, dialect: str
):
    with pytest.raises(UnsafeQuery):
        check(sql, dialect)


def test_guard_runs_the_regenerated_query_not_the_original_text():
    guarded = check(
        "select  branch /* ; drop table sales */ from v_sales -- x", "postgresql"
    )

    assert "drop" not in guarded.sql.lower()
    assert guarded.views == ("v_sales",)


def test_guard_rejects_an_overlong_query():
    with pytest.raises(UnsafeQuery, match="too long"):
        check("SELECT " + "1," * 3000 + "1", "postgresql")


# --- running it -------------------------------------------------------------------------


def test_run_query_returns_a_table_and_records_the_sql_as_the_source(
    db_session: Session,
):
    _seed(db_session)
    tools, sources = _tools(db_session)

    text = tools["run_query"].invoke(
        {
            "sql": "SELECT branch, SUM(net_amount) AS revenue FROM v_sales GROUP BY branch ORDER BY branch"
        }
    )

    assert text.splitlines() == [
        "branch | revenue",
        "Branch A | 3500",
        "Branch B | 8000",
    ]
    source = sources[0]
    assert source.source_name == "run_query"
    assert source.row_count == 2
    assert "v_sales" in source.query
    assert source.branch == "All branches"


def test_query_tools_do_not_offer_a_code_runner(db_session: Session):
    _seed(db_session)
    tools, _ = _tools(db_session)
    assert "run_calculation_code" not in tools


def test_a_refused_query_says_why_and_records_no_source(db_session: Session):
    _seed(db_session)
    tools, sources = _tools(db_session)

    text = tools["run_query"].invoke({"sql": "DELETE FROM sales"})

    assert text.startswith("Query refused:")
    assert sources == []
    assert db_session.query(Sale).count() == 3


def test_a_bad_column_gives_a_short_message_without_a_traceback(db_session: Session):
    _seed(db_session)

    text = _query(db_session, "SELECT nonsense_column FROM v_sales")

    assert text.startswith("Query failed:")
    assert "Traceback" not in text and len(text) < 300


def test_results_are_cut_at_the_row_cap(db_session: Session):
    _seed(db_session)
    db_session.add_all(
        Product(id=f"x{i}", stock_code=f"X{i}", description=f"Item {i}")
        for i in range(250)
    )
    db_session.commit()

    text = _query(db_session, "SELECT stock_code FROM v_products")

    lines = text.splitlines()
    assert len(lines) == 1 + 200 + 1  # header, capped rows, cut-off note
    assert "cut off at 200 rows" in lines[-1]


def test_the_database_is_writable_again_after_a_query(db_session: Session):
    _seed(db_session)
    _query(db_session, "SELECT COUNT(*) FROM v_sales")

    db_session.add(Product(id="later", stock_code="L1", description="Later"))
    db_session.commit()

    assert db_session.get(Product, "later") is not None


def test_a_branch_scoped_account_sees_only_its_own_branch_in_every_view(
    db_session: Session,
):
    _seed(db_session)
    scoped = User(
        id="s", name="S", email="s@example.com", role=UserRole.RETAIL, branch_id="a"
    )

    sales = _query(db_session, "SELECT DISTINCT branch FROM v_sales", scoped)
    stock = _query(db_session, "SELECT DISTINCT branch FROM v_stock_current", scoped)
    history = _query(db_session, "SELECT DISTINCT branch FROM v_stock_history", scoped)
    purchases = _query(db_session, "SELECT DISTINCT branch FROM v_purchases", scoped)
    branches = _query(db_session, "SELECT branch FROM v_branches", scoped)

    for text in (sales, stock, history, purchases, branches):
        assert text.splitlines()[1:] == ["Branch A"]


def test_every_example_in_describe_data_runs(db_session: Session):
    _seed(db_session)
    tools, _ = _tools(db_session)

    described = tools["describe_data"].invoke({})
    assert all(view.name in described for view in VIEWS)
    for question, sql in examples(db_session):
        result = tools["run_query"].invoke({"sql": sql})
        assert not result.startswith("Query"), f"{question}: {result}"


def test_report_gap_is_saved_as_a_source(db_session: Session):
    tools, sources = _tools(db_session)

    tools["report_gap"].invoke({"what_was_needed": "customer birthdays"})

    assert sources[0].source_name == "gap"
    assert "customer birthdays" in sources[0].label


def test_weekday_name_spells_the_day_out(db_session: Session):
    _seed(db_session)

    text = _query(
        db_session,
        "SELECT sale_date, weekday, weekday_name FROM v_sales WHERE branch = 'Branch A' ORDER BY sale_date",
    )

    assert "2026-10-04 | 7 | Sunday" in text
    assert "2026-10-05 | 1 | Monday" in text


def test_sales_metric_gives_transaction_totals_and_average(
    db_session: Session,
):
    _seed(db_session)
    tools, _ = _tools(db_session)

    text = tools["calculate_metric"].invoke(
        {
            "rule_id": "sales_summary",
            "date_from": "2026-10-01",
            "date_to": "2026-10-31",
            "branch": "Branch A",
            "group_by": ["branch"],
        }
    )

    assert "Sales 2" in text
    assert "Average sale Ks 1,750" in text  # (3000 + 500) / 2


def _agent_returning(
    monkeypatch: pytest.MonkeyPatch, tool_names: list[str], reply: str
):
    from langchain_core.messages import AIMessage, ToolMessage

    from app.retail.services.chat import agent as agent_module

    messages = [
        ToolMessage(content="x", name=name, tool_call_id=str(i))
        for i, name in enumerate(tool_names)
    ] + [AIMessage(content=reply)]

    class _Agent:
        def stream(self, payload, config=None, stream_mode=None):
            yield {"messages": [*payload["messages"], *messages]}

    monkeypatch.setattr(agent_module, "create_react_agent", lambda *a, **k: _Agent())
    monkeypatch.setattr(agent_module, "ChatOpenAI", lambda **k: object())
    monkeypatch.setattr(
        agent_module,
        "get_settings",
        lambda: type("S", (), {"openai_api_key": "k", "openai_chat_model": "m"})(),
    )
    return agent_module


@pytest.mark.parametrize(
    ("tools", "reply", "labelled"),
    [
        (["run_query"], "Bags earned Ks 470,890.", True),
        (
            ["run_query"],
            "Bags earned Ks 470,890 (an ad-hoc query).",
            False,
        ),  # already says so
        (["calculate_metric"], "Sales were Ks 1.", False),  # not an ad-hoc figure
    ],
)
def test_an_answer_from_run_query_always_says_it_is_ad_hoc(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tools: list[str],
    reply: str,
    labelled: bool,
):
    agent_module = _agent_returning(monkeypatch, tools, reply)

    result = agent_module.run_chat(
        db_session, _admin(), [{"role": "user", "content": "q"}]
    )

    assert result.reply.endswith(agent_module.AD_HOC_NOTE) is labelled
    assert result.reply.count("ad-hoc") <= 1


def test_the_stock_tool_says_when_its_list_is_cut_off(db_session: Session):
    _seed(db_session)
    db_session.add_all(
        Product(id=f"y{i}", stock_code=f"Y{i}", description=f"Item {i}")
        for i in range(40)
    )
    db_session.flush()
    db_session.add_all(
        StockLevel(
            branch_id="b",
            product_id=f"y{i}",
            on_hand_qty=i,
            snapshot_at=datetime(2026, 10, 3),
        )
        for i in range(40)
    )
    db_session.commit()
    tools, _ = _tools(db_session)

    text = tools["get_current_stock"].invoke({"branch": "Branch B"})

    # The new count (10-03) replaces Branch B's older one, so exactly the 40 new rows match.
    assert "CUT OFF: showing 30 of 40 matching products" in text
    assert "CUT OFF" not in tools["get_current_stock"].invoke(
        {"branch": "Branch B", "search": "Item 3"}
    )
