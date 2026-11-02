from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.routers import users as users_router


def _admin(db: Session) -> User:
    account = User(
        id="test-user-id",
        name="Admin",
        email="admin@example.com",
        role=UserRole.ADMIN,
    )
    db.add(account)
    db.flush()
    return account


def _development(db: Session) -> User:
    account = User(
        id="test-user-id",
        name="Development",
        email="development@example.com",
        role=UserRole.DEVELOPMENT,
    )
    db.add(account)
    db.flush()
    return account


def _branch(db: Session) -> Branch:
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db.add(branch)
    db.flush()
    return branch


def test_only_admin_can_list_users(authed_client, db_session: Session):
    db_session.add(
        User(
            id="test-user-id",
            name="Retail",
            email="retail@example.com",
            role=UserRole.RETAIL,
            branch_id=_branch(db_session).id,
        )
    )
    db_session.commit()

    assert authed_client.get("/api/users").status_code == 403


def test_admin_can_create_update_and_delete_user(
    authed_client, db_session: Session, monkeypatch
):
    _admin(db_session)
    branch = _branch(db_session)
    db_session.commit()
    monkeypatch.setattr(users_router, "_create_auth_account", lambda email, password, name: "auth-new")

    created = authed_client.post(
        "/api/users",
        json={
            "name": "Retail Operator",
            "email": "operator@example.com",
            "password": "password123",
            "role": "retail",
            "branch_id": branch.id,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["role"] == "retail"
    assert body["branch_name"] == "Retail 1"

    changed = authed_client.patch(
        f"/api/users/{body['id']}",
        json={"role": "retail_management", "branch_id": None},
    )
    assert changed.status_code == 200
    assert changed.json()["role"] == "retail_management"
    assert changed.json()["branch_id"] is None

    deleted = authed_client.delete(f"/api/users/{body['id']}")
    assert deleted.status_code == 204
    assert authed_client.get("/api/users").json() == [
        {
            "id": "test-user-id",
            "name": "Admin",
            "email": "admin@example.com",
            "role": "admin",
            "branch_id": None,
            "branch_name": None,
        }
    ]


def test_admin_cannot_assign_the_development_role(
    authed_client, db_session: Session, monkeypatch
):
    _admin(db_session)
    development = User(
        id="development-id",
        name="Development",
        email="development@example.com",
        role=UserRole.DEVELOPMENT,
    )
    db_session.add(development)
    db_session.commit()
    monkeypatch.setattr(users_router, "_create_auth_account", lambda *_: "auth-new")

    created = authed_client.post(
        "/api/users",
        json={
            "name": "Another Developer",
            "email": "another@example.com",
            "password": "password123",
            "role": "development",
        },
    )
    assert created.status_code == 403
    changed = authed_client.patch(
        "/api/users/development-id", json={"role": "admin"}
    )
    assert changed.status_code == 200
    assert changed.json()["role"] == "admin"
    assert authed_client.delete("/api/users/development-id").status_code == 204


def test_development_can_assign_every_role(authed_client, db_session: Session, monkeypatch):
    _development(db_session)
    db_session.commit()
    monkeypatch.setattr(users_router, "_create_auth_account", lambda *_: "auth-new")

    created = authed_client.post(
        "/api/users",
        json={
            "name": "Developer",
            "email": "developer@example.com",
            "password": "password123",
            "role": "development",
        },
    )
    assert created.status_code == 201
    assert created.json()["role"] == "development"


def test_every_column_pointing_at_a_user_is_handled_when_deleting_one():
    # A new "who did this" column must be nullable (it is cleared) or belong to the personal
    # tables (they are deleted); otherwise deleting an account stops on a foreign key.
    for column in users_router.user_foreign_keys():
        assert column.nullable or column.table.name in users_router.PERSONAL_USER_TABLES, (
            f"{column.table.name}.{column.name} blocks deleting a user"
        )


def test_deleting_a_user_keeps_their_records_and_removes_their_chats(
    authed_client, db_session: Session, monkeypatch
):
    from datetime import date

    from app.models.assistant_conversation import (
        AssistantConversation,
        AssistantFeedback,
        AssistantMessage,
    )
    from app.retail.models.branch_closure import BranchClosure
    from app.retail.models.import_batch import ImportType

    _admin(db_session)
    branch = _branch(db_session)
    other = User(id="other-id", name="Other", email="other@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    db_session.add(other)
    db_session.flush()
    closure = BranchClosure(
        branch_id=branch.id, closure_type=ImportType.SALES, closure_date=date(2026, 9, 1),
        closed_by=other.id,
    )
    conversation = AssistantConversation(user_id=other.id, title="Chat")
    db_session.add_all([closure, conversation])
    db_session.flush()
    message = AssistantMessage(conversation_id=conversation.id, sequence=1, role="assistant", content="Hi")
    db_session.add(message)
    db_session.flush()
    db_session.add(AssistantFeedback(message_id=message.id, user_id=other.id, rating="up"))
    db_session.commit()
    closure_id = closure.id

    assert authed_client.delete(f"/api/users/{other.id}").status_code == 204

    db_session.expire_all()
    assert db_session.get(User, "other-id") is None
    kept = db_session.get(BranchClosure, closure_id)
    assert kept is not None and kept.closed_by is None
    assert db_session.query(AssistantConversation).count() == 0
    assert db_session.query(AssistantMessage).count() == 0
    assert db_session.query(AssistantFeedback).count() == 0


def _retail_account(db: Session, auth_user_id: str | None = "auth-1") -> User:
    account = User(
        id="retail-1",
        name="Retail",
        email="retail1@example.com",
        role=UserRole.RETAIL,
        branch_id=_branch(db).id,
        auth_user_id=auth_user_id,
    )
    db.add(account)
    db.flush()
    return account


def test_hash_password_matches_the_better_auth_shape():
    from app.services.auth_password import hash_password, verify_password

    stored = hash_password("Correct-horse 1")
    salt, key = stored.split(":")
    assert len(salt) == 32 and len(key) == 128
    assert verify_password("Correct-horse 1", stored)
    assert not verify_password("wrong-password", stored)
    # The same text composed two ways is the same password (NFKC), as Better Auth treats it.
    assert hash_password("éclair!", salt) == hash_password("éclair!", salt)


def test_non_manager_cannot_reset_a_password(authed_client, db_session: Session):
    db_session.add(
        User(id="test-user-id", name="R", email="r@example.com", role=UserRole.RETAIL, branch_id=_branch(db_session).id)
    )
    db_session.commit()
    response = authed_client.put("/api/users/anyone/password", json={"password": "longenough1"})
    assert response.status_code == 403


def test_password_must_be_at_least_eight_characters(authed_client, db_session: Session):
    _admin(db_session)
    _retail_account(db_session)
    db_session.commit()
    assert authed_client.put("/api/users/retail-1/password", json={"password": "short"}).status_code == 422


def test_admin_cannot_reset_a_development_password(authed_client, db_session: Session):
    _admin(db_session)
    db_session.add(
        User(id="dev-1", name="Dev", email="dev@example.com", role=UserRole.DEVELOPMENT, auth_user_id="auth-dev")
    )
    db_session.commit()
    response = authed_client.put("/api/users/dev-1/password", json={"password": "longenough1"})
    assert response.status_code == 403


def test_account_without_a_sign_in_is_refused(authed_client, db_session: Session):
    _admin(db_session)
    _retail_account(db_session, auth_user_id=None)
    db_session.commit()
    response = authed_client.put("/api/users/retail-1/password", json={"password": "longenough1"})
    assert response.status_code == 400


def test_unknown_user_is_not_found(authed_client, db_session: Session):
    _admin(db_session)
    db_session.commit()
    assert authed_client.put("/api/users/missing/password", json={"password": "longenough1"}).status_code == 404


def test_reset_is_unavailable_without_the_sign_in_tables(authed_client, db_session: Session):
    _admin(db_session)
    _retail_account(db_session)
    db_session.commit()
    response = authed_client.put("/api/users/retail-1/password", json={"password": "longenough1"})
    assert response.status_code == 503


def test_retail_account_can_be_created_without_a_branch(authed_client, db_session: Session, monkeypatch):
    _admin(db_session)
    db_session.commit()
    monkeypatch.setattr(users_router, "_create_auth_account", lambda email, password, name: "auth-nb")
    response = authed_client.post(
        "/api/users",
        json={"name": "R", "email": "r@example.com", "password": "longenough1", "role": "retail", "branch_id": None},
    )
    assert response.status_code == 201
    assert response.json()["branch_id"] is None


def test_wholesale_account_still_needs_a_branch(authed_client, db_session: Session, monkeypatch):
    _admin(db_session)
    db_session.commit()
    monkeypatch.setattr(users_router, "_create_auth_account", lambda email, password, name: "auth-w")
    response = authed_client.post(
        "/api/users",
        json={"name": "W", "email": "w@example.com", "password": "longenough1", "role": "wholesale", "branch_id": None},
    )
    assert response.status_code == 400
