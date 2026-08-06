import { describe, expect, it } from "vitest";

import type { CustomField } from "@/features/custom-fields/types";
import type { Task } from "@/features/tasks/types";
import { annotatableFields, fieldAnnotation } from "./field-annotation";

/**
 * The shared half of the schedule lenses' custom-field annotation (the 035
 * follow-up): what a bar says, and in what order the picker offers the fields.
 */

const field = (over: Partial<CustomField> = {}): CustomField => ({
  id: 1,
  boardId: 1,
  name: "Client",
  type: "text",
  options: [],
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const task = (values: { fieldId: number; value: string }[]) =>
  ({ customFields: values }) as Pick<Task, "customFields">;

describe("fieldAnnotation", () => {
  it("formats the chosen field's answer", () => {
    expect(fieldAnnotation(task([{ fieldId: 1, value: "Acme" }]), field())).toBe(
      "Acme"
    );
  });

  it("renders a checkbox as its word, the way the list does", () => {
    const flag = field({ id: 2, name: "Billable", type: "checkbox" });
    expect(fieldAnnotation(task([{ fieldId: 2, value: "true" }]), flag)).toBe("Yes");
    expect(fieldAnnotation(task([{ fieldId: 2, value: "false" }]), flag)).toBe("No");
  });

  // Three ways to have nothing to say, all of which must annotate nothing
  // rather than "—": a schedule row's space is the scarcest in the app, and
  // spending it to report an unanswered question is the worst trade available.
  it("says nothing when there is nothing to say", () => {
    expect(fieldAnnotation(task([]), field())).toBeNull();
    expect(fieldAnnotation(task([{ fieldId: 1, value: "" }]), field())).toBeNull();
    expect(fieldAnnotation(task([{ fieldId: 1, value: "Acme" }]), undefined)).toBeNull();
  });

  it("reads only the chosen field, not whichever answer comes first", () => {
    const answers = task([
      { fieldId: 9, value: "Staging" },
      { fieldId: 1, value: "Acme" },
    ]);
    expect(fieldAnnotation(answers, field())).toBe("Acme");
    expect(fieldAnnotation(answers, field({ id: 9, name: "Env" }))).toBe("Staging");
  });
});

describe("annotatableFields", () => {
  // Integer-keyed object iteration is by ascending id, not position, which is
  // the same trap the list view's column order documents.
  it("orders by position, then id, so the picker matches the list's columns", () => {
    const byId = {
      7: field({ id: 7, name: "Third", position: 2 }),
      2: field({ id: 2, name: "First", position: 0 }),
      5: field({ id: 5, name: "Second", position: 1 }),
    };
    expect(annotatableFields(byId).map((f) => f.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("is empty for a board with no custom fields", () => {
    expect(annotatableFields(undefined)).toEqual([]);
    expect(annotatableFields({})).toEqual([]);
  });
});
