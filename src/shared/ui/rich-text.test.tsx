// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichText } from "./rich-text";

/**
 * The point of these tests is the security property, not the formatting: a body
 * is rendered as React elements from a fixed grammar, so anything outside that
 * grammar — HTML, a javascript: URL — becomes inert text. An agent writes here
 * (033), so "hostile input renders as characters" is the load-bearing claim.
 */

describe("RichText", () => {
  it("formats the inline subset", () => {
    const { container } = render(
      <RichText text="**bold** and *italic* and `code` here" />
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders a safe link as an anchor with a hardened rel", () => {
    const { container } = render(
      <RichText text="see [the docs](https://example.com/x)" />
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/x");
    expect(a?.textContent).toBe("the docs");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });

  it("never renders raw HTML in the body — it is literal text", () => {
    const evil = '<script>alert(1)</script><img src=x onerror="alert(2)">';
    const { container } = render(<RichText text={evil} />);
    // No injected nodes: the markup is text, not elements.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The characters a person typed are present, escaped, as text.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("neutralises a javascript: link — no anchor, rendered as text", () => {
    const { container } = render(
      <RichText text="[click](javascript:alert(1))" />
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[click](javascript:alert(1))");
  });

  it("renders a fragment link in-page — no new tab, no rejection", () => {
    // The docs preview writes resolved [[wiki links]] as #doc-<id>; a fragment
    // cannot execute, and it must stay in this page for the dialog to intercept.
    const { container } = render(<RichText text="See [Other page](#doc-42)" />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("#doc-42");
    expect(a?.getAttribute("target")).toBeNull();
  });

  it("renders # headings — the doc templates are built of them", () => {
    const { container } = render(
      <RichText text={"# Attendees\nAlice\n## Agenda"} />
    );
    expect(container.querySelector("h1")?.textContent).toBe("Attendees");
    expect(container.querySelector("h2")?.textContent).toBe("Agenda");
    expect(container.textContent).not.toContain("#");
  });

  it("renders a bullet list and a fenced code block", () => {
    const { container } = render(
      <RichText text={"- one\n- two\n\n```\nx = 1\n```"} />
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("x = 1");
  });

  it("keeps code-block contents literal, not parsed as markup", () => {
    const { container } = render(
      <RichText text={"```\n<script>evil</script>\n```"} />
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "<script>evil</script>"
    );
  });
});
