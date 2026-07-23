import { describe, expect, it } from "vitest";
import { proposeSchedule } from "./schedule-proposal";
describe("proposeSchedule", () => it("places dependent work after its blocker", () => {
  const result = proposeSchedule([{id:1,title:"A",estimate:2,startDate:null,dueDate:null,assigneeId:"u"},{id:2,title:"B",estimate:1,startDate:null,dueDate:null,assigneeId:"u"}], [{taskId:2,dependsOnId:1}], "2026-07-01");
  expect(result).toEqual([{taskId:1,startDate:"2026-07-01",dueDate:"2026-07-02",reasons:["next available schedule slot"]},{taskId:2,startDate:"2026-07-03",dueDate:"2026-07-03",reasons:["after dependency #1"]}]);
}));
