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

test("parses user_input from tagged blocks", () => {
  const records = parseUserInputPayload(`<user-input>
  {
    "user_input": [
      { "index": 1, "content": "用户需要整理输入。", "type": "请求" }
    ]
  }
  </user-input>`);

  assert.deepEqual(records, [
    { index: 1, content: "用户需要整理输入。", type: "请求" },
  ]);
});

test("parses user_input when downstream blocks are present", () => {
  const records = parseUserInputPayload(`<user-input>
  {
    "user_input": [
      { "index": 1, "content": "Need a team workspace.", "type": "请求" }
    ]
  }
  </user-input>
  <request-analysis>
  {
    "business_model": [],
    "questions": [],
    "chitchat": []
  }
  </request-analysis>`);

  assert.deepEqual(records, [
    { index: 1, content: "Need a team workspace.", type: "请求" },
  ]);
});

test("rejects non-JSON user_input payloads", () => {
  const records = parseUserInputPayload("user_input: not json");

  assert.equal(records, null);
});
