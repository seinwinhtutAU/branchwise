"""Which branch a chat tool should look at.

One rule shared by every tool: a branch-scoped account always gets its own branch,
whatever the model asked for; an account with no branch (admin/development) gets the
branch the model named, else the conversation's branch, else every branch.
"""

from sqlalchemy.orm import Session

from app.models.user import User
from app.services.branches import list_retail_branches


class BranchScope:
    def __init__(self, db: Session, user: User, context_branch_id: str | None = None) -> None:
        self._db = db
        self._user = user
        self._context_branch_id = context_branch_id
        self._names: dict[str, str] = {}

    def names(self) -> dict[str, str]:
        """Retail branch id -> name, loaded once per request."""
        if not self._names:
            self._names.update({b.id: b.name for b in list_retail_branches(self._db).all()})
        return self._names

    def resolve(self, branch: str) -> tuple[str | None, str | None]:
        """(branch_id, error). `None` branch_id means every branch."""
        if self._user.branch_id is not None:
            return self._user.branch_id, None
        wanted = branch.strip().lower()
        if wanted:
            known = self.names()
            for branch_id, name in known.items():
                if wanted in (branch_id.lower(), name.lower()):
                    return branch_id, None
            partial = [branch_id for branch_id, name in known.items() if wanted in name.lower()]
            if len(partial) == 1:
                return partial[0], None
            return None, (
                f"Unknown branch '{branch}'. Branches: "
                + ", ".join(sorted(known.values()))
                + "."
            )
        return self._context_branch_id, None

    def label(self, branch_id: str | None) -> str:
        return self.names().get(branch_id, "Selected branch") if branch_id else "All branches"
