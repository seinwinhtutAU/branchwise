"""Account and role management for admin and development accounts."""

from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.services.auth_password import set_auth_password
from app.db.base import Base
from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantFeedback,
    AssistantMessage,
    AssistantRun,
)

router = APIRouter(prefix="/api/users", tags=["users"])

RoleValue = Literal["development", "admin", "retail_management", "retail", "wholesale"]
ORIGIN_HEADER = "http://localhost:8000"
AUTH_TIMEOUT = httpx.Timeout(15.0)


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=255)
    role: RoleValue
    branch_id: str | None = None

    @field_validator("name", "email")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be blank")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address")
        return value.lower()


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: RoleValue | None = None
    branch_id: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value


class PasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=255)


def _require_user_manager(user: User) -> None:
    if user.role not in (UserRole.ADMIN, UserRole.DEVELOPMENT):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin or development account can manage users",
        )


def _require_assignable_role(actor: User, role: UserRole) -> None:
    if actor.role == UserRole.ADMIN and role == UserRole.DEVELOPMENT:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only a development account can assign the development role",
        )


def _validate_assignment(role: UserRole, branch_id: str | None, db: Session) -> None:
    if role in (UserRole.DEVELOPMENT, UserRole.ADMIN, UserRole.RETAIL_MANAGEMENT, UserRole.RETAIL):
        # A branch is optional here; without one the account sees every branch. (For a
        # retail user that means every retail branch, with a retail user's usual limits.)
        if branch_id is not None and db.get(Branch, branch_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The selected branch does not exist")
        return

    if branch_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A branch is required for wholesale management accounts",
        )
    if db.get(Branch, branch_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The selected branch does not exist")


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role.value,
        "branch_id": user.branch_id,
        "branch_name": user.branch.name if user.branch else None,
    }


def _create_auth_account(email: str, password: str, name: str) -> str:
    base = get_settings().neon_auth_base_url.rstrip("/")
    if not base:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "The authentication service is not configured",
        )

    try:
        with httpx.Client(timeout=AUTH_TIMEOUT) as client:
            response = client.post(
                f"{base}/sign-up/email",
                json={"email": email, "password": password, "name": name},
                headers={"Origin": ORIGIN_HEADER},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not reach the authentication service") from exc

    if response.status_code != 200:
        if response.status_code == 409:
            raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
        try:
            message = response.json().get("message") or "Authentication service rejected the account"
        except ValueError:
            message = "Authentication service rejected the account"
        raise HTTPException(
            response.status_code if response.status_code in (400, 401, 403, 422) else status.HTTP_502_BAD_GATEWAY,
            message,
        )

    auth_user_id = response.json().get("user", {}).get("id")
    if not auth_user_id:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Authentication service returned no user id")
    return str(auth_user_id)


@router.get("")
def list_users(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    _require_user_manager(user)
    return [_user_out(account) for account in db.query(User).order_by(User.name, User.email).all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_user_manager(user)
    role = UserRole(payload.role)
    _require_assignable_role(user, role)
    _validate_assignment(role, payload.branch_id, db)

    existing = (
        db.query(User)
        .filter(func.lower(User.email) == payload.email.lower())
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An app account with this email already exists")

    auth_user_id = _create_auth_account(payload.email, payload.password, payload.name)
    account = User(
        name=payload.name,
        email=payload.email,
        role=role,
        branch_id=payload.branch_id,
        auth_user_id=auth_user_id,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from exc
    db.refresh(account)
    return _user_out(account)


@router.patch("/{user_id}")
def update_user(
    user_id: str,
    payload: UserUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_user_manager(user)
    account = db.get(User, user_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    next_role = UserRole(payload.role) if payload.role is not None else account.role
    if payload.role is not None:
        _require_assignable_role(user, next_role)
    branch_was_sent = "branch_id" in payload.model_fields_set
    next_branch_id = payload.branch_id if branch_was_sent else account.branch_id
    _validate_assignment(next_role, next_branch_id, db)

    if payload.name is not None:
        account.name = payload.name
    account.role = next_role
    account.branch_id = next_branch_id
    db.commit()
    db.refresh(account)
    return _user_out(account)


@router.put("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(
    user_id: str,
    payload: PasswordReset,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    _require_user_manager(user)
    account = db.get(User, user_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    # An admin cannot manage a development account, and that includes its password.
    _require_assignable_role(user, account.role)
    if not account.auth_user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account has no sign-in to change")
    # Neon Auth's tables only exist on Postgres (not in the SQLite test database).
    if db.get_bind().dialect.name != "postgresql":
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The sign-in service is not available")
    if not set_auth_password(db, account.auth_user_id, payload.password):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This account has no password sign-in")
    db.commit()


# Tables where a row belongs to one person and goes with them. Everything else that points
# at a user is a "who did this" column that is allowed to be empty and is simply cleared.
PERSONAL_USER_TABLES = {"assistant_conversations", "assistant_feedback"}


def user_foreign_keys() -> list:
    """Every column in the database that points at users.id (the users table itself aside)."""
    return [
        column
        for table in Base.metadata.sorted_tables
        if table.name != User.__tablename__
        for column in table.columns
        if any(fk.column.table.name == User.__tablename__ for fk in column.foreign_keys)
    ]


def _detach_user_records(db: Session, user_id: str) -> None:
    """Remove what belongs only to this person (their assistant chats and ratings) and keep
    every record they merely took part in, such as imports, branch closures and knowledge
    edits, by clearing who did it. Without this a row still pointing at the user stops the
    delete."""
    conversation_ids = select(AssistantConversation.id).where(AssistantConversation.user_id == user_id)
    message_ids = select(AssistantMessage.id).where(AssistantMessage.conversation_id.in_(conversation_ids))
    run_ids = select(AssistantRun.id).where(AssistantRun.conversation_id.in_(conversation_ids))
    db.query(AssistantFeedback).filter(AssistantFeedback.message_id.in_(message_ids)).delete(
        synchronize_session=False
    )
    db.query(AssistantFeedback).filter(AssistantFeedback.user_id == user_id).delete(synchronize_session=False)
    db.query(AssistantCitation).filter(AssistantCitation.run_id.in_(run_ids)).delete(synchronize_session=False)
    db.query(AssistantRun).filter(AssistantRun.conversation_id.in_(conversation_ids)).delete(
        synchronize_session=False
    )
    db.query(AssistantMessage).filter(AssistantMessage.conversation_id.in_(conversation_ids)).delete(
        synchronize_session=False
    )
    db.query(AssistantConversation).filter(AssistantConversation.user_id == user_id).delete(
        synchronize_session=False
    )

    for column in user_foreign_keys():
        if column.table.name in PERSONAL_USER_TABLES:
            continue
        if column.nullable:
            db.execute(column.table.update().where(column == user_id).values({column.name: None}))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    _require_user_manager(user)
    if user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account")

    account = db.get(User, user_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if account.role == UserRole.ADMIN and db.query(User).filter(User.role == UserRole.ADMIN).count() <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The last admin account cannot be deleted")

    _detach_user_records(db, account.id)

    # Neon Auth stores its own tables in the same Postgres database. Removing the auth
    # row revokes the login as well as the app profile. SQLite test databases do not have
    # the Neon Auth schema, so this is intentionally Postgres-only.
    if account.auth_user_id and db.get_bind().dialect.name == "postgresql":
        db.execute(
            text('DELETE FROM neon_auth."user" WHERE id = :auth_user_id'),
            {"auth_user_id": account.auth_user_id},
        )

    db.delete(account)
    db.commit()
