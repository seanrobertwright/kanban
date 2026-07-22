import type {
  CapacityPlan,
  MemberCapacity,
  SetMemberCapacityInput,
} from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchCapacity(boardId: number): Promise<CapacityPlan> {
  const res = await fetch(`/api/board/${boardId}/capacity`, {
    cache: "no-store",
  });
  return jsonOrThrow<CapacityPlan>(res);
}

export function setMemberCapacity(
  workspaceId: string,
  userId: string,
  input: SetMemberCapacityInput
): Promise<MemberCapacity> {
  return fetch(`/api/workspaces/${workspaceId}/capacity/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<MemberCapacity>(res));
}
