import test from "node:test";
import assert from "node:assert/strict";
import { reviewHandoff } from "../app/review-handoff.mjs";

test("review becomes ready only after delivery completion, including slow completion", async () => {
  const work = { task: "fixture", status: "finalizing", summary: "Actual submission" };
  let task = { status: "working" }, release;
  const finishing = reviewHandoff(work, {
    readTask: async () => task,
    completeTask: async (_id, body) => {
      assert.equal(body.status, "completed");
      assert.equal(body.result.summary, work.summary);
      await new Promise(resolve => { release = resolve; });
      task = { status: "completed" };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(work.status, "finalizing");
  release(); await finishing;
  assert.equal(work.status, "ready");assert.ok(work.finished);
});

test("a lost completion response reconciles once without duplicate completion", async () => {
  const work = { task: "fixture", status: "finalizing", summary: "Saved" };
  let task = { status: "working" }, calls = 0;
  const deps = {readTask: async () => task, completeTask: async () => {
    calls++; task = {status:"completed"}; throw Error("Transport interrupted after commit");
  }};
  await reviewHandoff(work,deps);assert.equal(work.status,"finalizing");assert.match(work.handoffError,/Reconnecting/);
  await reviewHandoff(work,deps);assert.equal(work.status,"ready");assert.equal(calls,1);assert.equal(work.handoffError,undefined);
});

test("failed or canceled deliveries never advertise ready changes", async () => {
  for (const status of ["failed","canceled","pruned"]) {
    const work={task:"fixture",status:"finalizing",summary:"Saved changes"};
    await reviewHandoff(work,{readTask:async()=>({status}),completeTask:async()=>assert.fail("Cannot complete a terminal delivery")});
    assert.equal(work.status,status==="canceled"?"canceled":"failed");assert.ok(work.handoffError);assert.equal(work.finished,undefined);
  }
});

test("cancellation or a newer delivery wins over a pending handoff", async () => {
  for (const change of [work=>{work.status="canceling"},work=>{work.task="new-delivery"}]) {
    const work={task:"fixture",status:"finalizing",summary:"Saved"};let release;
    const pending=reviewHandoff(work,{readTask:()=>new Promise(resolve=>{release=resolve}),completeTask:async()=>assert.fail("Obsolete handoff cannot complete")});
    change(work);release({status:"completed"});await pending;
    assert.notEqual(work.status,"ready");assert.equal(work.finished,undefined);
  }
});
