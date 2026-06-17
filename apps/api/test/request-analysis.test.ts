import assert from "node:assert/strict";
import test from "node:test";
import { parseRequestAnalysisPayload } from "../src/utils/request-analysis";

test("parses request analysis from tagged blocks", () => {
  const analysis = parseRequestAnalysisPayload(`<request-analysis>
  {
    "business_model": [
      {
        "index": 1,
        "user_goal": "Build a team workspace.",
        "goal_constraints": [],
        "missing_information": [
          {
            "index": 1,
            "description": "Target team size is unknown.",
            "importance": 0.7
          }
        ],
        "covered_user_input_indexes": [1]
      }
    ],
    "questions": [2],
    "chitchat": [3]
  }
  </request-analysis>`);

  assert.equal(analysis?.business_model[0]?.user_goal, "Build a team workspace.");
  assert.deepEqual(analysis?.questions, [2]);
  assert.deepEqual(analysis?.chitchat, [3]);
});

test("rejects invalid request analysis payloads", () => {
  assert.equal(parseRequestAnalysisPayload("<request-analysis>{}</request-analysis>"), null);
});
