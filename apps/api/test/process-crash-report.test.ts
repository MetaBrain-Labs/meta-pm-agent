/**
 * Node.js 进程崩溃报告测试
 *
 * 验证报告默认开启、显式关闭和同步落盘行为，不在测试进程中制造真实未捕获异常。
 *
 * Responsibilities:
 * - 验证默认开启语义
 * - 验证报告文件名、目录和诊断内容
 * - 验证敏感环境变量不会进入报告
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isCrashReportingEnabled,
  resolveCrashReportOutputDir,
  writeAbnormalWorkflowAbortReport,
  writeProcessCrashReport,
} from "../src/process-crash-report";

test("enables process crash reporting by default", () => {
  const previous = process.env.PROCESS_CRASH_REPORT_ENABLED;
  delete process.env.PROCESS_CRASH_REPORT_ENABLED;
  try {
    assert.equal(isCrashReportingEnabled(), true);
  } finally {
    restoreEnvironmentValue("PROCESS_CRASH_REPORT_ENABLED", previous);
  }
});

test("writes a timestamped fatal error report without environment secrets", () => {
  const outputDir = resolveCrashReportOutputDir();
  const previousEnabled = process.env.PROCESS_CRASH_REPORT_ENABLED;
  const previousSecret = process.env.OPENAI_API_KEY;
  process.env.PROCESS_CRASH_REPORT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "must-not-appear-in-crash-report";

  try {
    const filePath = writeProcessCrashReport(
      new Error("fatal projection rejection"),
      "unhandledRejection",
    );
    assert.ok(filePath);
    assert.equal(filePath.startsWith(outputDir), true);
    assert.match(filePath, /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+-\d{4}-process-crash\.md$/);

    const content = readFileSync(filePath, "utf8");
    assert.match(content, /Origin: `unhandledRejection`/);
    assert.match(content, /fatal projection rejection/);
    assert.doesNotMatch(content, /must-not-appear-in-crash-report/);
    rmSync(filePath, { force: true });
  } finally {
    restoreEnvironmentValue("PROCESS_CRASH_REPORT_ENABLED", previousEnabled);
    restoreEnvironmentValue("OPENAI_API_KEY", previousSecret);
  }
});

test("allows process crash reporting to be explicitly disabled", () => {
  const previous = process.env.PROCESS_CRASH_REPORT_ENABLED;
  process.env.PROCESS_CRASH_REPORT_ENABLED = "false";
  try {
    assert.equal(isCrashReportingEnabled(), false);
    assert.equal(writeProcessCrashReport(new Error("disabled")), null);
  } finally {
    restoreEnvironmentValue("PROCESS_CRASH_REPORT_ENABLED", previous);
  }
});

test("writes a distinct abnormal workflow abort report", () => {
  const previous = process.env.PROCESS_CRASH_REPORT_ENABLED;
  process.env.PROCESS_CRASH_REPORT_ENABLED = "true";
  try {
    const filePath = writeAbnormalWorkflowAbortReport({
      activeAgentTypes: ["orchestrator", "planner"],
      conversationId: "conversation-001",
      error: new DOMException("This operation was aborted", "AbortError"),
      origin: "client_disconnect",
      requestFormId: "request-form-001",
    });
    assert.ok(filePath);
    assert.match(filePath, /-workflow-abort\.md$/);
    const content = readFileSync(filePath, "utf8");
    assert.match(content, /Abort origin: `client_disconnect`/);
    assert.match(content, /Active Agent types: orchestrator, planner/);
    assert.match(content, /not proof of a Node\.js process crash/);
    rmSync(filePath, { force: true });
  } finally {
    restoreEnvironmentValue("PROCESS_CRASH_REPORT_ENABLED", previous);
  }
});

test("writes the report before an uncaught exception keeps its fatal exit", () => {
  const outputDir = resolveCrashReportOutputDir();
  const existingFiles = new Set(
    (existsSync(outputDir) ? readdirSync(outputDir, { withFileTypes: true }) : [])
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );
  const reporterUrl = new URL("../src/process-crash-report.ts", import.meta.url);
  const child = spawnSync(
    process.execPath,
    [
      "--import=tsx",
      "--input-type=module",
      "--eval",
      `import { installProcessCrashReporter } from ${JSON.stringify(reporterUrl.href)}; installProcessCrashReporter(); setImmediate(() => { throw new Error("fatal-listener-probe"); });`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PROCESS_CRASH_REPORT_ENABLED: "true" },
    },
  );

  const newFile = readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !existingFiles.has(entry.name))
    .map((entry) => entry.name)
    .find((name) => name.endsWith("-process-crash.md"));
  assert.notEqual(child.status, 0);
  assert.ok(newFile, child.stderr || "expected a crash report file");

  const reportPath = path.join(outputDir, newFile);
  try {
    assert.match(readFileSync(reportPath, "utf8"), /fatal-listener-probe/);
  } finally {
    rmSync(reportPath, { force: true });
  }
});

/** 恢复测试修改的环境变量，避免污染同进程中的其他测试。 */
function restoreEnvironmentValue(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
