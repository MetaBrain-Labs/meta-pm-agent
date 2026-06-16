import assert from "node:assert/strict";
import test from "node:test";
import { parseUserInputPayload } from "../src/utils/user-input";

test("parses user_input JSON records", () => {
  const records = parseUserInputPayload(`{
    "user_input": [
      { "index": 1, "content": "用户希望创建一个项目。", "type": "请求" },
      { "index": 2, "content": "用户补充目标用户是团队负责人。", "type": "补充" }
    ],
    "form_type": "request"
  }`);

  assert.deepEqual(records, [
    { index: 1, content: "用户希望创建一个项目。", type: "请求" },
    { index: 2, content: "用户补充目标用户是团队负责人。", type: "补充" },
  ]);
});

test("rejects non-JSON user_input payloads", () => {
  const records = parseUserInputPayload("user_input: not json");

  assert.equal(records, null);
});
