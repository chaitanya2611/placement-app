import express from "express";
import Group from "../models/Group.js";
import CodingProblem from "../models/CodingProblem.js";
import CodeSubmission from "../models/CodeSubmission.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

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

    const { code, output } = req.body;
    const visibleTests = problem.testCases.filter((testCase) => !testCase.isHidden);
    const firstTest = visibleTests[0] || problem.testCases[0];

    res.json({
      message: "Python execution provider is not connected yet. Frontend can preview code, and submissions will compare provided output for the first visible test case.",
      language: "python",
      code,
      input: firstTest?.input || "",
      expectedOutput: firstTest?.expectedOutput || "",
      receivedOutput: output || "",
      isCorrect: normalizeOutput(output) === normalizeOutput(firstTest?.expectedOutput || ""),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to run code" });
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

    const { code, outputs = [] } = req.body;

    if (!code?.trim()) {
      return res.status(400).json({ message: "Code is required" });
    }

    let passedTests = 0;
    const resultLines = [];

    problem.testCases.forEach((testCase, index) => {
      const received = outputs[index] || "";
      const passed = normalizeOutput(received) === normalizeOutput(testCase.expectedOutput);
      if (passed) passedTests += 1;

      resultLines.push(
        `Test ${index + 1}: ${passed ? "Passed" : "Failed"}${testCase.isHidden ? " (hidden)" : ""}`,
      );
    });

    const totalTests = problem.testCases.length;
    const status = passedTests === totalTests ? "Accepted" : "Wrong Answer";

    const submission = await CodeSubmission.create({
      problem: problem._id,
      group: problem.group,
      user: req.user._id,
      language: "python",
      code,
      status,
      passedTests,
      totalTests,
      output: resultLines.join("\n"),
    });

    res.status(201).json({
      message: status,
      submission,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit code" });
  }
});

export default router;
