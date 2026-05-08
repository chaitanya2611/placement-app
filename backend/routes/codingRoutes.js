import express from "express";
import Group from "../models/Group.js";
import CodingProblem from "../models/CodingProblem.js";
import CodeSubmission from "../models/CodeSubmission.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

const PISTON_API_URL = process.env.PISTON_API_URL || "";
const PYTHON_VERSION = process.env.PISTON_PYTHON_VERSION || "3.10.0";
const JUDGE0_API_URL = process.env.JUDGE0_API_URL || "";
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || "";
const JUDGE0_API_HOST = process.env.JUDGE0_API_HOST || "";
const JUDGE0_PYTHON_LANGUAGE_ID = Number(process.env.JUDGE0_PYTHON_LANGUAGE_ID || 71);
const CODE_EXECUTION_PROVIDER =
  process.env.CODE_EXECUTION_PROVIDER ||
  (JUDGE0_API_URL ? "judge0" : PISTON_API_URL ? "piston" : "none");

const isGroupMember = async (groupId, userId) => {
  const group = await Group.findById(groupId);
  if (!group) return null;

  const isMember = group.members.some(
    (memberId) => memberId.toString() === userId.toString(),
  );

  return isMember ? group : null;
};

const ensureCodingEnabled = (group) => {
  return group?.codingEnabled === true;
};

const normalizeOutput = (value = "") => {
  return String(value).replace(/\r\n/g, "\n").trim();
};

const ensureExecutionProvider = () => {
  if (CODE_EXECUTION_PROVIDER === "piston" && PISTON_API_URL) return;
  if (CODE_EXECUTION_PROVIDER === "judge0" && JUDGE0_API_URL) return;

  throw new Error(
    "Code execution provider is not configured. Set CODE_EXECUTION_PROVIDER=judge0 with JUDGE0_API_URL, or set CODE_EXECUTION_PROVIDER=piston with a self-hosted PISTON_API_URL.",
  );
};

const runPythonWithPiston = async (code, stdin = "") => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(PISTON_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language: "python",
        version: PYTHON_VERSION,
        files: [
          {
            name: "main.py",
            content: code,
          },
        ],
        stdin,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Piston execution failed");
    }

    const data = await response.json();
    const run = data.run || {};

    return {
      stdout: run.stdout || "",
      stderr: run.stderr || "",
      output: run.output || `${run.stdout || ""}${run.stderr || ""}`,
      code: typeof run.code === "number" ? run.code : 0,
      signal: run.signal || null,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runPythonWithJudge0 = async (code, stdin = "") => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const baseUrl = JUDGE0_API_URL.replace(/\/$/, "");
    const headers = {
      "Content-Type": "application/json",
    };

    if (JUDGE0_API_KEY) {
      headers["X-RapidAPI-Key"] = JUDGE0_API_KEY;
    }

    if (JUDGE0_API_HOST) {
      headers["X-RapidAPI-Host"] = JUDGE0_API_HOST;
    }

    const response = await fetch(`${baseUrl}/submissions?base64_encoded=false&wait=true`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_code: code,
        language_id: JUDGE0_PYTHON_LANGUAGE_ID,
        stdin,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Judge0 execution failed");
    }

    const data = await response.json();

    return {
      stdout: data.stdout || "",
      stderr: data.stderr || data.compile_output || "",
      output: data.stdout || data.stderr || data.compile_output || "",
      code: data.status?.id === 3 ? 0 : data.status?.id || 1,
      signal: null,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runPythonCode = async (code, stdin = "") => {
  ensureExecutionProvider();

  if (CODE_EXECUTION_PROVIDER === "judge0") {
    return runPythonWithJudge0(code, stdin);
  }

  return runPythonWithPiston(code, stdin);
};

const evaluateCodeAgainstTests = async (code, testCases) => {
  const results = [];
  let passedTests = 0;
  let hasRuntimeError = false;

  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index];
    const execution = await runPythonCode(code, testCase.input || "");
    const receivedOutput = execution.stdout || "";
    const expectedOutput = testCase.expectedOutput || "";
    const passed =
      execution.code === 0 &&
      normalizeOutput(receivedOutput) === normalizeOutput(expectedOutput);

    if (passed) passedTests += 1;
    if (execution.code !== 0 || execution.stderr) hasRuntimeError = true;

    results.push({
      testNumber: index + 1,
      hidden: Boolean(testCase.isHidden),
      passed,
      input: testCase.isHidden ? "" : testCase.input || "",
      expectedOutput: testCase.isHidden ? "Hidden" : expectedOutput,
      receivedOutput: testCase.isHidden ? "Hidden" : receivedOutput,
      stderr: testCase.isHidden ? "" : execution.stderr || "",
      exitCode: execution.code,
    });
  }

  const totalTests = testCases.length;
  const status = hasRuntimeError
    ? "Error"
    : passedTests === totalTests
      ? "Accepted"
      : "Wrong Answer";

  return {
    passedTests,
    totalTests,
    status,
    results,
    output: results
      .map((result) => `Test ${result.testNumber}: ${result.passed ? "Passed" : "Failed"}${result.hidden ? " (hidden)" : ""}`)
      .join("\n"),
  };
};

router.post("/:groupId/problems", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can create coding problems" });
    }

    if (!ensureCodingEnabled(group)) {
      return res.status(403).json({ message: "Coding interface is not enabled for this group" });
    }

    const { title, description, topic, starterCode, testCases } = req.body;

    if (!title?.trim() || !description?.trim()) {
      return res.status(400).json({ message: "Problem title and description are required" });
    }

    if (!testCases || testCases.length === 0) {
      return res.status(400).json({ message: "At least one test case is required" });
    }

    const problem = await CodingProblem.create({
      group: req.params.groupId,
      createdBy: req.user._id,
      title,
      description,
      topic: topic?.trim() || "General",
      starterCode: starterCode || "# Write your Python solution here\n",
      testCases: testCases.map((testCase) => ({
        input: testCase.input || "",
        expectedOutput: testCase.expectedOutput,
        isHidden: Boolean(testCase.isHidden),
      })),
    });

    const populatedProblem = await CodingProblem.findById(problem._id).populate("createdBy", "name email");

    res.status(201).json({ message: "Coding problem created successfully", problem: populatedProblem });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create coding problem" });
  }
});

router.get("/:groupId/problems", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can view coding problems" });
    }

    if (!ensureCodingEnabled(group)) {
      return res.status(403).json({ message: "Coding interface is not enabled for this group" });
    }

    const problems = await CodingProblem.find({ group: req.params.groupId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    const submissions = await CodeSubmission.find({
      group: req.params.groupId,
      user: req.user._id,
    }).sort({ createdAt: -1 });

    const bestSubmissionMap = {};
    submissions.forEach((submission) => {
      const problemId = submission.problem.toString();
      if (!bestSubmissionMap[problemId] || submission.status === "Accepted") {
        bestSubmissionMap[problemId] = submission;
      }
    });

    res.json(
      problems.map((problem) => ({
        ...problem.toObject(),
        testCases: problem.testCases.map((testCase) => ({
          _id: testCase._id,
          input: testCase.isHidden ? "" : testCase.input,
          expectedOutput: testCase.isHidden ? "Hidden" : testCase.expectedOutput,
          isHidden: testCase.isHidden,
        })),
        userSubmission: bestSubmissionMap[problem._id.toString()] || null,
      })),
    );
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch coding problems" });
  }
});

router.get("/problems/:problemId", authMiddleware, async (req, res) => {
  try {
    const problem = await CodingProblem.findById(req.params.problemId).populate("createdBy", "name email");

    if (!problem) {
      return res.status(404).json({ message: "Problem not found" });
    }

    const group = await isGroupMember(problem.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can view this problem" });
    }

    if (!ensureCodingEnabled(group)) {
      return res.status(403).json({ message: "Coding interface is not enabled for this group" });
    }

    const latestSubmission = await CodeSubmission.findOne({
      problem: problem._id,
      user: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({
      ...problem.toObject(),
      testCases: problem.testCases.map((testCase) => ({
        _id: testCase._id,
        input: testCase.isHidden ? "" : testCase.input,
        expectedOutput: testCase.isHidden ? "Hidden" : testCase.expectedOutput,
        isHidden: testCase.isHidden,
      })),
      userSubmission: latestSubmission || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch problem" });
  }
});

router.post("/problems/:problemId/run", authMiddleware, async (req, res) => {
  try {
    const problem = await CodingProblem.findById(req.params.problemId);

    if (!problem) {
      return res.status(404).json({ message: "Problem not found" });
    }

    const group = await isGroupMember(problem.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can run code" });
    }

    if (!ensureCodingEnabled(group)) {
      return res.status(403).json({ message: "Coding interface is not enabled for this group" });
    }

    const { code } = req.body;

    if (!code?.trim()) {
      return res.status(400).json({ message: "Code is required" });
    }

    const visibleTests = problem.testCases.filter((testCase) => !testCase.isHidden);
    const testsToRun = visibleTests.length ? visibleTests : problem.testCases.slice(0, 1);
    const evaluation = await evaluateCodeAgainstTests(code, testsToRun);

    res.json({
      message: evaluation.status,
      language: "python",
      passedTests: evaluation.passedTests,
      totalTests: evaluation.totalTests,
      status: evaluation.status,
      results: evaluation.results,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to run Python code" });
  }
});

router.post("/problems/:problemId/submit", authMiddleware, async (req, res) => {
  try {
    const problem = await CodingProblem.findById(req.params.problemId);

    if (!problem) {
      return res.status(404).json({ message: "Problem not found" });
    }

    const group = await isGroupMember(problem.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can submit code" });
    }

    if (!ensureCodingEnabled(group)) {
      return res.status(403).json({ message: "Coding interface is not enabled for this group" });
    }

    const { code } = req.body;

    if (!code?.trim()) {
      return res.status(400).json({ message: "Code is required" });
    }

    const evaluation = await evaluateCodeAgainstTests(code, problem.testCases);

    const submission = await CodeSubmission.create({
      problem: problem._id,
      group: problem.group,
      user: req.user._id,
      language: "python",
      code,
      status: evaluation.status,
      passedTests: evaluation.passedTests,
      totalTests: evaluation.totalTests,
      output: evaluation.output,
    });

    res.status(201).json({
      message: evaluation.status,
      submission,
      results: evaluation.results,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to submit Python code" });
  }
});

export default router;
