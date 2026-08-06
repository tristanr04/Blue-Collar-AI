/**
 * Workspaces API client — wraps all /api/workspaces endpoints.
 */

const API_BASE = "/api";

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  plan: string;
  maxSeats: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "removed";
  invitedEmail: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInvitationResult {
  token: string;
  invitation: { id: string; email: string; role: string; expiresAt: string };
}

async function wsFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Workspace API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listWorkspaces(token: string): Promise<Workspace[]> {
  const data = await wsFetch<{ workspaces: Workspace[] }>("/workspaces", token);
  return data.workspaces;
}

export async function createWorkspace(
  token: string,
  name: string,
  maxSeats = 5,
): Promise<Workspace> {
  const data = await wsFetch<{ workspace: Workspace }>("/workspaces", token, {
    method: "POST",
    body: JSON.stringify({ name, maxSeats }),
  });
  return data.workspace;
}

export async function getWorkspace(token: string, id: string): Promise<Workspace> {
  const data = await wsFetch<{ workspace: Workspace }>(`/workspaces/${id}`, token);
  return data.workspace;
}

export async function listMembers(
  token: string,
  workspaceId: string,
): Promise<WorkspaceMembership[]> {
  const data = await wsFetch<{ members: WorkspaceMembership[] }>(
    `/workspaces/${workspaceId}/members`,
    token,
  );
  return data.members;
}

export async function sendInvitation(
  token: string,
  workspaceId: string,
  email: string,
  role: "admin" | "member" = "member",
): Promise<WorkspaceInvitationResult> {
  return wsFetch(`/workspaces/${workspaceId}/invitations`, token, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export async function acceptInvitation(
  token: string,
  invitationToken: string,
): Promise<WorkspaceMembership> {
  const data = await wsFetch<{ membership: WorkspaceMembership }>(
    "/workspaces/invitations/accept",
    token,
    { method: "POST", body: JSON.stringify({ token: invitationToken }) },
  );
  return data.membership;
}

export async function removeMember(
  token: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await wsFetch(`/workspaces/${workspaceId}/members/${userId}`, token, { method: "DELETE" });
}

export async function promoteToAdmin(
  token: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await wsFetch(`/workspaces/${workspaceId}/members/${userId}/promote`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function transferOwnership(
  token: string,
  workspaceId: string,
  newOwnerId: string,
): Promise<void> {
  await wsFetch(`/workspaces/${workspaceId}/transfer`, token, {
    method: "POST",
    body: JSON.stringify({ newOwnerId }),
  });
}

export async function revokeInvitation(
  token: string,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await wsFetch(`/workspaces/${workspaceId}/invitations/${invitationId}`, token, {
    method: "DELETE",
  });
}
