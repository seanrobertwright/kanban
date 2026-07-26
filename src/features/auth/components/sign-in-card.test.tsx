// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignInCard } from "./sign-in-card";

const { social, sso } = vi.hoisted(() => ({
  social: vi.fn(),
  sso: vi.fn(),
}));

vi.mock("../client/auth-client", () => ({
  authClient: { signIn: { social, sso } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignInCard", () => {
  it("signs in with GitHub", async () => {
    social.mockResolvedValue({});
    render(<SignInCard />);

    fireEvent.click(screen.getByRole("button", { name: /Continue with GitHub/ }));

    await waitFor(() =>
      expect(social).toHaveBeenCalledWith({ provider: "github", callbackURL: "/" })
    );
  });

  it("reveals the SSO email form and starts the SSO flow", async () => {
    // The redirect plugin navigates on success — no error means nothing to render.
    sso.mockResolvedValue({ data: { url: "https://idp.test", redirect: true } });
    render(<SignInCard />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with SSO/ }));
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "carol@corp.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with SSO" }));

    await waitFor(() =>
      expect(sso).toHaveBeenCalledWith({
        email: "carol@corp.example",
        callbackURL: "/",
      })
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains when no provider is registered for the domain", async () => {
    sso.mockResolvedValue({
      error: { status: 404, message: "No provider found for the issuer" },
    });
    render(<SignInCard />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with SSO/ }));
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "dave@unknown.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with SSO" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "No SSO provider is registered for unknown.example"
    );
    // The form stays usable for a retry with a different address.
    expect(screen.getByLabelText("Work email")).toBeDefined();
  });

  it("surfaces other SSO failures verbatim", async () => {
    sso.mockResolvedValue({
      error: { status: 400, message: "Provider domain has not been verified" },
    });
    render(<SignInCard />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with SSO/ }));
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "erin@corp.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with SSO" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Provider domain has not been verified"
    );
  });
});
