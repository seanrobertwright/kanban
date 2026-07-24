import { describe, expect, it } from "vitest"; import { extractMeetingActions } from "./meeting-actions";
describe("extractMeetingActions",()=>it("extracts only unchecked meeting actions and their hints",()=>expect(extractMeetingActions("- [ ] Send brief (owner: Ada) due 2026-08-01\n- [x] Done\nnotes")).toEqual([{title:"Send brief",ownerHint:"Ada",dueDate:"2026-08-01"}])));
