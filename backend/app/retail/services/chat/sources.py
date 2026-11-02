"""What a chat tool actually looked at, recorded by the tool itself.

A citation built from the model's own words can be wrong; one built from what the tool
queried cannot. Every tool appends a `ToolSource` when it runs, and the agent turns that
list into the citations saved with the answer.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolSource:
    source_name: str
    label: str
    branch: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    # The newest data the tool saw (latest sale date, stock count date, ...), so a reader
    # can tell "no sales" from "the file hasn't been imported yet".
    as_of: str | None = None
    # A section id the app can open (see App.tsx's Section type); None when there is no
    # single page behind the figure.
    route: str | None = None
    # For an ad-hoc query: the SQL that ran and how many rows it returned, so the answer
    # can be checked rather than trusted.
    query: str | None = None
    row_count: int | None = None
    # For knowledge: the article the answer came from, so the panel can open it.
    article_id: str | None = None
    # For a chart: the spec (kind, labels, series) as JSON, drawn under the answer. Built by
    # `chart_spec` from rows a query returned, never from the model's own words.
    chart: str | None = None

    def details(self) -> dict[str, str]:
        fields = {
            "branch": self.branch,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "as_of": self.as_of,
            "route": self.route,
            "query": self.query,
            "row_count": None if self.row_count is None else str(self.row_count),
            "article_id": self.article_id,
            "chart": self.chart,
        }
        return {key: value for key, value in fields.items() if value}
