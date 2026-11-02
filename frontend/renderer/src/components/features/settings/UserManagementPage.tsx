import { useEffect, useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Card } from "@renderer/components/ui/Card";
import { Input } from "@renderer/components/ui/Input";
import { PasswordInput } from "@renderer/components/ui/PasswordInput";
import { Select } from "@renderer/components/ui/Select";
import { CellInput } from "@renderer/components/features/wholesale/shared/formFields";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  CELL,
  CELL_TD,
} from "@renderer/components/features/wholesale/receiving/cellStyles";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
  CloseIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersIcon,
} from "@renderer/components/ui/icons";

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: RoleValue;
  branch_id: string | null;
  branch_name: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

type RoleValue =
  "development" | "admin" | "retail_management" | "retail" | "wholesale";

const ROLE_OPTIONS: { value: RoleValue; label: string; description: string }[] =
  [
    {
      value: "development",
      label: "Development",
      description:
        "Full access to every workspace, setting, and role assignment",
    },
    {
      value: "admin",
      label: "Admin",
      description:
        "Summary and health dashboard, basic settings, and user management",
    },
    {
      value: "retail_management",
      label: "Retail management",
      description: "Full access to the retail workspace",
    },
    {
      value: "retail",
      label: "Retail user",
      description: "Import and import history only",
    },
    {
      value: "wholesale",
      label: "Wholesale management",
      description: "Full access to the wholesale workspace",
    },
  ];

interface Props {
  session: Session;
  profile: Profile | null;
}

function roleNeedsBranch(role: RoleValue): boolean {
  return role === "wholesale";
}

const USER_CELL = `${CELL} !min-h-11 !py-2`;
const USER_CELL_TD = `${CELL_TD} [&_div]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11`;

function errorMessage(response: Response, fallback: string): Promise<Error> {
  return response
    .json()
    .then((body: { detail?: string }) => new Error(body.detail || fallback))
    .catch(() => new Error(fallback));
}

export function UserManagementPage({
  session,
  profile,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const isDevelopment = profile?.role === "development";
  const assignableRoles = useMemo(
    () =>
      isDevelopment
        ? ROLE_OPTIONS
        : ROLE_OPTIONS.filter((option) => option.value !== "development"),
    [isDevelopment],
  );
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [savedUsers, setSavedUsers] = useState<Map<string, ManagedUser>>(
    new Map(),
  );
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [passwordFor, setPasswordFor] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "retail" as RoleValue,
    branch_id: "",
  });

  const branchMap = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  async function loadUsers(): Promise<void> {
    setLoadingError(null);
    try {
      const [usersResponse, branchesResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/users`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${apiBaseUrl}/api/branches?kind=all`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!usersResponse.ok)
        throw await errorMessage(usersResponse, "Couldn't load users");
      if (!branchesResponse.ok)
        throw await errorMessage(branchesResponse, "Couldn't load branches");
      const loaded = (await usersResponse.json()) as ManagedUser[];
      setUsers(loaded);
      setSavedUsers(new Map(loaded.map((item) => [item.id, item])));
      setBranches((await branchesResponse.json()) as BranchOption[]);
    } catch (error) {
      setLoadingError(
        error instanceof Error ? error.message : "Couldn't load users",
      );
    }
  }

  useEffect(() => {
    void loadUsers();
    // The session object is stable for the lifetime of this page; refreshing the token
    // should not clear the table or interrupt an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  useEffect(() => {
    if (!isCreateOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !creating) setIsCreateOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [creating, isCreateOpen]);

  function updateDraft(id: string, patch: Partial<ManagedUser>): void {
    setUsers(
      (current) =>
        current?.map((account) =>
          account.id === id ? { ...account, ...patch } : account,
        ) ?? current,
    );
  }

  async function saveUser(account: ManagedUser): Promise<void> {
    if (!account.name.trim()) {
      showToast("error", "Name can't be empty");
      return;
    }
    if (roleNeedsBranch(account.role) && !account.branch_id) {
      showToast("error", "Select a branch for this account first");
      return;
    }
    setSavingId(account.id);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users/${account.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: account.name,
          role: account.role,
          branch_id: account.branch_id,
        }),
      });
      if (!response.ok)
        throw await errorMessage(response, "Couldn't update account");
      const updated = (await response.json()) as ManagedUser;
      setSavedUsers((current) => new Map(current).set(updated.id, updated));
      setUsers(
        (current) =>
          current?.map((item) => (item.id === updated.id ? updated : item)) ??
          current,
      );
      showToast("success", "Account updated");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't update account",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function createUser(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (roleNeedsBranch(newUser.role) && !newUser.branch_id) {
      showToast("error", "Select a branch for this account");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: newUser.name,
          email: newUser.email,
          password: newUser.password,
          role: newUser.role,
          branch_id: newUser.branch_id || null,
        }),
      });
      if (!response.ok)
        throw await errorMessage(response, "Couldn't create account");
      const created = (await response.json()) as ManagedUser;
      setSavedUsers((current) => new Map(current).set(created.id, created));
      setUsers((current) =>
        [...(current ?? []), created].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setNewUser({
        name: "",
        email: "",
        password: "",
        role: "retail",
        branch_id: "",
      });
      setIsCreateOpen(false);
      showToast("success", "Account created");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't create account",
      );
    } finally {
      setCreating(false);
    }
  }

  function closePasswordDialog(): void {
    if (savingPassword) return;
    setPasswordFor(null);
    setNewPassword("");
  }

  async function resetPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!passwordFor) return;
    setSavingPassword(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/users/${passwordFor.id}/password`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ password: newPassword }),
        },
      );
      if (!response.ok)
        throw await errorMessage(response, "Couldn't change the password");
      showToast("success", `${passwordFor.name}'s password changed`);
      setPasswordFor(null);
      setNewPassword("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't change the password",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteUser(account: ManagedUser): Promise<void> {
    if (
      !window.confirm(
        `Delete ${account.name}'s account? This cannot be undone.`,
      )
    )
      return;
    setDeletingId(account.id);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users/${account.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok)
        throw await errorMessage(response, "Couldn't delete account");
      setUsers(
        (current) =>
          current?.filter((item) => item.id !== account.id) ?? current,
      );
      showToast("success", "Account deleted");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't delete account",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loadingError) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="Couldn't load user management"
        description={loadingError}
        action={<Button onClick={() => void loadUsers()}>Try again</Button>}
      />
    );
  }

  const userCount = users?.length ?? 0;
  const adminCount =
    users?.filter((account) => account.role === "admin").length ?? 0;
  const branchAssignedCount =
    users?.filter((account) => account.branch_id !== null).length ?? 0;

  return (
    <div className="flex w-full flex-col gap-5 px-1.5 pb-6 sm:px-2.5 lg:px-3">
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">
            User management
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Invite your team, choose what they can access, and assign
            branch-based roles.
          </p>
          <p className="mt-2 text-xs text-text-muted">
            {userCount} team members{" "}
            <span className="px-1 text-border-strong">·</span> {adminCount}{" "}
            administrators <span className="px-1 text-border-strong">·</span>{" "}
            {branchAssignedCount} assigned to a branch
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setIsCreateOpen(true);
          }}
        >
          <PlusIcon className="h-4 w-4" /> Add user
        </Button>
      </div>

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-user-title"
        >
          <button
            type="button"
            aria-label="Close new user dialog"
            className="absolute inset-0 cursor-default"
            onClick={() => {
              if (!creating) setIsCreateOpen(false);
            }}
          />
          <Card className="relative z-10 w-full max-w-2xl overflow-hidden p-0 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-brand-subtle/40 px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
                  Team access
                </p>
                <h2
                  id="create-user-title"
                  className="mt-1 text-lg font-semibold tracking-tight text-text-primary"
                >
                  Add a user
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  They can sign in immediately with the temporary password you
                  set below.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close new user dialog"
                disabled={creating}
                onClick={() => setIsCreateOpen(false)}
                className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary disabled:opacity-50"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={createUser}
              className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 sm:py-6"
            >
              <Input
                label="Name"
                placeholder="Jane Doe"
                value={newUser.name}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
              <Input
                type="email"
                label="Email"
                placeholder="jane@branchwise.app"
                value={newUser.email}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
              <PasswordInput
                                    label="Temporary password"
                  placeholder="At least 8 characters"
                  minLength={8}
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  required
                />
              <Select
                label="Role"
                value={newUser.role}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    role: event.target.value as RoleValue,
                  }))
                }
              >
                {assignableRoles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Branch"
                value={newUser.branch_id}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    branch_id: event.target.value,
                  }))
                }
              >
                <option value="">No branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
              <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-2">
                <p className="text-xs text-text-muted">
                  {
                    ROLE_OPTIONS.find((option) => option.value === newUser.role)
                      ?.description
                  }
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={creating}
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" loading={creating}>
                    Create user
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      {passwordFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-password-title"
        >
          <button
            type="button"
            aria-label="Close change password dialog"
            className="absolute inset-0 cursor-default"
            onClick={closePasswordDialog}
          />
          <Card className="relative z-10 w-full max-w-md overflow-hidden p-0 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-brand-subtle/40 px-5 py-4">
              <div>
                <h2
                  id="reset-password-title"
                  className="text-lg font-semibold tracking-tight text-text-primary"
                >
                  Change password
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {passwordFor.name} ({passwordFor.email}) will be signed out
                  everywhere and must use the new password.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close change password dialog"
                disabled={savingPassword}
                onClick={closePasswordDialog}
                className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary disabled:opacity-50"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={resetPassword} className="grid gap-4 px-5 py-5">
              <PasswordInput
                                label="New password"
                placeholder="At least 8 characters"
                minLength={8}
                autoFocus
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={savingPassword}
                  onClick={closePasswordDialog}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={savingPassword}>
                  Change password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        {users === null ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-5 w-5 text-text-muted" />
          </div>
        ) : users.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={<UsersIcon />}
              title="No accounts yet"
              description="Create the first account above."
            />
          </div>
        ) : (
          <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
            <Thead className="top-0">
              <Tr>
                <Th className="w-12 !py-3 text-center">#</Th>
                <Th
                  className="min-w-[12rem] !py-3"
                  title={EDITABLE_COLUMN_HINT}
                >
                  Name <EditMark />
                </Th>
                <Th className="min-w-[14rem] !py-3">Email</Th>
                <Th className="w-56 !py-3" title={EDITABLE_COLUMN_HINT}>
                  Role <EditMark />
                </Th>
                <Th className="w-48 !py-3" title={EDITABLE_COLUMN_HINT}>
                  Branch <EditMark />
                </Th>
                <Th className="w-[7rem] !py-3" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {users.map((account, index) => {
                const original = savedUsers.get(account.id);
                const dirty =
                  !original ||
                  original.name !== account.name ||
                  original.role !== account.role ||
                  original.branch_id !== account.branch_id;
                return (
                  <Tr key={account.id}>
                    <Td className="!py-3 text-center font-mono text-[13px] text-text-muted">
                      {index + 1}
                    </Td>
                    <Td className={USER_CELL_TD}>
                      <CellInput
                        label={`Name of ${account.email}`}
                        placeholder="Name"
                        value={account.name}
                        onChange={(name) => updateDraft(account.id, { name })}
                        className={USER_CELL}
                      />
                    </Td>
                    <Td className="!py-3 text-[13px] text-text-muted">
                      {account.email}
                    </Td>
                    <Td className={USER_CELL_TD}>
                      <Select
                        aria-label={`Role for ${account.name}`}
                        value={account.role}
                        className={USER_CELL}
                        onChange={(event) =>
                          updateDraft(account.id, {
                            role: event.target.value as RoleValue,
                          })
                        }
                      >
                        {(account.role === "development"
                          ? ROLE_OPTIONS
                          : assignableRoles
                        ).map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={
                              !isDevelopment && option.value === "development"
                            }
                          >
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td className={USER_CELL_TD}>
                      <Select
                        aria-label={`Branch for ${account.name}`}
                        value={account.branch_id ?? ""}
                        className={USER_CELL}
                        onChange={(event) =>
                          updateDraft(account.id, {
                            branch_id: event.target.value || null,
                            branch_name:
                              branchMap.get(event.target.value) ?? null,
                          })
                        }
                      >
                        <option value="">No branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td className="!px-2 !py-2 text-center align-middle whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!dirty}
                        loading={savingId === account.id}
                        onClick={() => void saveUser(account)}
                        className="mr-1 h-6 px-2 text-[13px]"
                      >
                        Save
                      </Button>
                      <button
                        type="button"
                        title="Change password"
                        aria-label={`Change ${account.name}'s password`}
                        onClick={() => {
                          setPasswordFor(account);
                        }}
                        className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
                      >
                        <ShieldCheckIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete account"
                        aria-label={`Delete ${account.name}'s account`}
                        disabled={deletingId === account.id}
                        onClick={() => void deleteUser(account)}
                        className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </Td>
                  </Tr>
                );
              })}
              <Tr className="bg-bg-subtle font-semibold">
                <Td className="!py-2" />
                <Td className="!py-2 text-[13px]">Total</Td>
                <Td className="!py-2 font-mono text-[13px]" colSpan={4}>
                  {userCount} accounts
                </Td>
              </Tr>
            </Tbody>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}

export default UserManagementPage;
