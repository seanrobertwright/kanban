import { describe, expect, it } from "vitest"; import { draftAutomation } from "./draft";
describe("draftAutomation",()=>it("returns a disabled review draft",()=>expect(draftAutomation("When a PR merges, move it to Done",[{id:7,title:"Done"}])).toMatchObject({isEnabled:false,trigger:{event:"git.pr_merged"},actions:[{type:"move",columnId:7}]})));
