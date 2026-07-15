// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserMenu } from "./user-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../client/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

const user = {
  name: "Alice Example",
  email: "alice@example.test",
  image: null,
};

/** Same Base UI Menu.GroupLabel trap as BoardSwitcher — see that test. */
describe("UserMenu", () => {
  it("renders its menu contents without a missing MenuGroupContext", async () => {
    render(<UserMenu user={user} />);

    const trigger = screen.getByRole("button", { name: "Account" });
    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.pointerUp(trigger);
      fireEvent.click(trigger);
    });

    expect(screen.getByText(user.email)).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Sign out/ })).toBeDefined();
  });
});
