import express from "express";
import Group from "../models/Group.js";
import Question from "../models/Question.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

const getCreatorGroup = async (groupId, userId) => {
  const group = await Group.findById(groupId)
    .populate("creator", "name email")
    .populate("members", "name email");

  if (!group) return { error: "Group not found", status: 404 };

  const creatorId = group.creator?._id || group.creator;
  if (creatorId.toString() !== userId.toString()) {
    return { error: "Only the group creator can view quiz reports", status: 403 };
  }

  return { group };
};

const buildQuizReports = async (group) => {
  const [quizzes, attempts] = await Promise.all([
    Quiz.find({ group: group._id }).populate("createdBy", "name email").sort({ createdAt: -1 }),
    QuizAttempt.find({ group: group._id }).populate("user", "name email").sort({ submittedAt: 1 }),
  ]);

  const members = group.members || [];

  return quizzes.map((quiz) => {
    const quizAttempts = attempts.filter(
      (attempt) => attempt.quiz.toString() === quiz._id.toString(),
    );
    const attemptsByUser = new Map(
      quizAttempts.map((attempt) => [attempt.user?._id?.toString(), attempt]),
    );
    const results = members.map((member) => {
      const attempt = attemptsByUser.get(member._id.toString());
      return {
        user: { id: member._id, name: member.name, email: member.email },
        attended: Boolean(attempt),
        score: attempt?.score ?? null,
        totalMarks: attempt?.totalMarks ?? null,
        percentage: attempt?.percentage ?? null,
        correctCount: attempt?.correctCount ?? null,
        wrongCount: attempt?.wrongCount ?? null,
        unattemptedCount: attempt?.unattemptedCount ?? null,
        submittedAt: attempt?.submittedAt ?? null,
      };
    });
    const attended = results.filter((result) => result.attended);

    return {
      quiz: {
        id: quiz._id,
        title: quiz.title,
        createdBy: quiz.createdBy,
        createdAt: quiz.createdAt,
        totalMarks: quiz.questions.reduce(
          (sum, question) => sum + Number(question.marks || 0),
          0,
        ),
      },
      summary: {
        totalMembers: members.length,
        attendedCount: attended.length,
        absentCount: members.length - attended.length,
        attendancePercentage: members.length
          ? Math.round((attended.length / members.length) * 100)
          : 0,
        averagePercentage: attended.length
          ? Math.round(
              attended.reduce((sum, result) => sum + result.percentage, 0) /
                attended.length,
            )
          : 0,
      },
      results,
    };
  });
};

const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const isGroupMember = async (groupId, userId) => {
  const group = await Group.findById(groupId);
  if (!group) return null;

  const isMember = group.members.some(
    (memberId) => memberId.toString() === userId.toString(),
  );

  return isMember ? group : null;
};

const sanitizeQuizQuestions = (questions = [], allowNegativeMarking = false) => {
  return questions.map((question) => ({
    question: question.question || null,
    questionText: question.questionText,
    topic: question.topic?.trim() || "General",
    options: question.options,
    correctOption: Number(question.correctOption),
    explanation: question.explanation || "",
    marks: Number(question.marks) || 1,
    negativeMarks: allowNegativeMarking ? Number(question.negativeMarks) || 0 : 0,
    sourceType: question.sourceType === "mcq" ? "mcq" : "custom",
  }));
};

router.post("/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can create quizzes" });
    }

    const {
      title,
      description,
      durationMinutes,
      allowNegativeMarking,
      questions,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Quiz title is required" });
    }

    if (!durationMinutes || Number(durationMinutes) < 1) {
      return res.status(400).json({ message: "Quiz duration is required" });
    }

    if (!questions || questions.length === 0) {
      return res.status(400).json({ message: "At least one question is required" });
    }

    for (const question of questions) {
      if (!question.questionText?.trim() || !question.options || question.options.length !== 4) {
        return res.status(400).json({ message: "Each quiz question needs text and 4 options" });
      }
    }

    const quiz = await Quiz.create({
      group: req.params.groupId,
      createdBy: req.user._id,
      title,
      description,
      durationMinutes: Number(durationMinutes),
      allowNegativeMarking: Boolean(allowNegativeMarking),
      questions: sanitizeQuizQuestions(questions, Boolean(allowNegativeMarking)),
    });

    const populatedQuiz = await Quiz.findById(quiz._id).populate("createdBy", "name email");

    res.status(201).json({ message: "Quiz created successfully", quiz: populatedQuiz });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create quiz" });
  }
});

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can view quizzes" });
    }

    const quizzes = await Quiz.find({ group: req.params.groupId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    const attempts = await QuizAttempt.find({
      group: req.params.groupId,
      user: req.user._id,
    });

    const attemptMap = {};
    attempts.forEach((attempt) => {
      attemptMap[attempt.quiz.toString()] = attempt;
    });

    res.json(
      quizzes.map((quiz) => ({
        ...quiz.toObject(),
        userAttempt: attemptMap[quiz._id.toString()] || null,
      })),
    );
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quizzes" });
  }
});

router.get("/:groupId/reports", authMiddleware, async (req, res) => {
  try {
    const lookup = await getCreatorGroup(req.params.groupId, req.user._id);
    if (lookup.error) {
      return res.status(lookup.status).json({ message: lookup.error });
    }

    const reports = await buildQuizReports(lookup.group);
    res.json({
      group: { id: lookup.group._id, title: lookup.group.title },
      generatedAt: new Date().toISOString(),
      reports,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate quiz reports" });
  }
});

router.get("/:groupId/reports.csv", authMiddleware, async (req, res) => {
  try {
    const lookup = await getCreatorGroup(req.params.groupId, req.user._id);
    if (lookup.error) {
      return res.status(lookup.status).json({ message: lookup.error });
    }

    const reports = await buildQuizReports(lookup.group);
    const rows = [
      [
        "Quiz",
        "Student",
        "Email",
        "Attendance",
        "Score",
        "Total Marks",
        "Percentage",
        "Correct",
        "Wrong",
        "Unattempted",
        "Submitted At",
      ],
    ];

    reports.forEach((report) => {
      report.results.forEach((result) => {
        rows.push([
          report.quiz.title,
          result.user.name,
          result.user.email,
          result.attended ? "Attended" : "Absent",
          result.score,
          result.totalMarks,
          result.percentage,
          result.correctCount,
          result.wrongCount,
          result.unattemptedCount,
          result.submittedAt ? new Date(result.submittedAt).toISOString() : "",
        ]);
      });
    });

    const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const filename = `${lookup.group.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "group"}-quiz-reports.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
  } catch (error) {
    res.status(500).json({ message: "Failed to download quiz reports" });
  }
});

router.get("/single/:quizId", authMiddleware, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId).populate("createdBy", "name email");

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const group = await isGroupMember(quiz.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can view this quiz" });
    }

    const attempt = await QuizAttempt.findOne({ quiz: quiz._id, user: req.user._id });

    res.json({ ...quiz.toObject(), userAttempt: attempt || null });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quiz" });
  }
});

router.delete("/single/:quizId", authMiddleware, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const group = await isGroupMember(quiz.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can delete quizzes" });
    }

    if (quiz.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only quiz creator can delete this quiz" });
    }

    await QuizAttempt.deleteMany({ quiz: quiz._id });
    await Quiz.findByIdAndDelete(quiz._id);

    res.json({ message: "Quiz deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete quiz" });
  }
});

router.post("/:quizId/submit", authMiddleware, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const group = await isGroupMember(quiz.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can submit this quiz" });
    }

    const existingAttempt = await QuizAttempt.findOne({ quiz: quiz._id, user: req.user._id });

    if (existingAttempt) {
      return res.status(400).json({ message: "You already attempted this quiz" });
    }

    const submittedAnswers = req.body.answers || [];
    const answerMap = {};

    submittedAnswers.forEach((answer) => {
      answerMap[answer.quizQuestionId] = answer.selectedOption;
    });

    let totalMarks = 0;
    let score = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;
    const evaluatedAnswers = [];

    for (const question of quiz.questions) {
      totalMarks += question.marks;
      const selectedOption = answerMap[question._id.toString()];

      if (question.sourceType === "custom" && !question.question) {
        const createdQuestion = await Question.create({
          group: quiz.group,
          createdBy: quiz.createdBy,
          topic: question.topic,
          questionText: question.questionText,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
        });

        question.question = createdQuestion._id;
      }

      if (selectedOption === undefined || selectedOption === null || selectedOption === "") {
        unattemptedCount += 1;
        evaluatedAnswers.push({
          quizQuestionId: question._id,
          selectedOption: null,
          isCorrect: false,
          marksAwarded: 0,
        });
        continue;
      }

      const numericSelected = Number(selectedOption);
      const isCorrect = numericSelected === question.correctOption;
      const marksAwarded = isCorrect
        ? question.marks
        : quiz.allowNegativeMarking
          ? -Math.abs(question.negativeMarks || 0)
          : 0;

      if (isCorrect) correctCount += 1;
      else wrongCount += 1;

      score += marksAwarded;

      evaluatedAnswers.push({
        quizQuestionId: question._id,
        selectedOption: numericSelected,
        isCorrect,
        marksAwarded,
      });
    }

    await quiz.save();

    const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;

    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      group: quiz.group,
      user: req.user._id,
      answers: evaluatedAnswers,
      totalMarks,
      score,
      correctCount,
      wrongCount,
      unattemptedCount,
      percentage,
    });

    res.status(201).json({
      message: "Quiz submitted successfully",
      attempt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to submit quiz" });
  }
});

export default router;
