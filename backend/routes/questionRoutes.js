import express from "express";
import multer from "multer";
import streamifier from "streamifier";
import Question from "../models/Question.js";
import QuestionAttempt from "../models/QuestionAttempt.js";
import Group from "../models/Group.js";
import authMiddleware from "../middleware/authMiddleware.js";
import cloudinary from "../utils/cloudinary.js";

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
    }
  },
});

const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "placement-app/mcq-images",
        resource_type: "image",
      },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      },
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

const isGroupMember = async (groupId, userId) => {
  const group = await Group.findById(groupId);

  if (!group) return null;

  const member = group.members.some(
    (id) => id.toString() === userId.toString(),
  );

  return member ? group : null;
};

router.post(
  "/:groupId",
  authMiddleware,
  upload.single("questionImage"),
  async (req, res) => {
    try {
      const { questionText, correctOption, explanation } = req.body;
      const topic = req.body.topic?.trim() || "General";

      let options = req.body.options;

      if (typeof options === "string") {
        options = JSON.parse(options);
      }

      const group = await isGroupMember(req.params.groupId, req.user._id);

      if (!group) {
        return res
          .status(403)
          .json({ message: "Only group members can add MCQs" });
      }

      if (!questionText || !options || options.length !== 4) {
        return res
          .status(400)
          .json({ message: "Question and 4 options are required" });
      }

      let uploadResult = null;

      if (req.file) {
        uploadResult = await uploadToCloudinary(req.file.buffer);
      }

      const question = await Question.create({
        group: req.params.groupId,
        createdBy: req.user._id,
        topic,
        questionText,
        questionImageUrl: uploadResult?.secure_url || "",
        questionImagePublicId: uploadResult?.public_id || "",
        options,
        correctOption: Number(correctOption),
        explanation,
      });

      res.status(201).json({
        message: "MCQ added successfully",
        question,
      });
    } catch (error) {
      res.status(500).json({
        message: error.message || "Failed to add MCQ",
      });
    }
  },
);

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res
        .status(403)
        .json({ message: "Only group members can view MCQs" });
    }

    const query = { group: req.params.groupId };

    if (req.query.topic && req.query.topic !== "All") {
      query.topic = req.query.topic;
    }

    const questions = await Question.find(query)
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    const attempts = await QuestionAttempt.find({
      group: req.params.groupId,
      user: req.user._id,
    });

    const attemptMap = {};

    attempts.forEach((attempt) => {
      attemptMap[attempt.question.toString()] = {
        selectedOption: attempt.selectedOption,
        isCorrect: attempt.isCorrect,
      };
    });

    const questionsWithAttempts = questions.map((question) => ({
      ...question.toObject(),
      userAttempt: attemptMap[question._id.toString()] || null,
    }));

    res.json(questionsWithAttempts);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/topics/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res
        .status(403)
        .json({ message: "Only group members can view topics" });
    }

    const topics = await Question.distinct("topic", {
      group: req.params.groupId,
    });

    res.json(topics.filter(Boolean).sort());
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch topics" });
  }
});

router.put("/single/:questionId", authMiddleware, async (req, res) => {
  try {
    const question = await Question.findById(req.params.questionId);

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    const group = await isGroupMember(question.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can edit MCQs" });
    }

    if (question.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can edit only your own MCQs" });
    }

    const { topic, questionText, options, correctOption, explanation } = req.body;

    let parsedOptions = options;
    if (typeof parsedOptions === "string") {
      parsedOptions = JSON.parse(parsedOptions);
    }

    if (!questionText || !parsedOptions || parsedOptions.length !== 4) {
      return res.status(400).json({ message: "Question and 4 options are required" });
    }

    question.topic = topic?.trim() || "General";
    question.questionText = questionText;
    question.options = parsedOptions;
    question.correctOption = Number(correctOption);
    question.explanation = explanation || "";

    await question.save();

    await QuestionAttempt.deleteMany({ question: question._id });

    const updatedQuestion = await Question.findById(question._id).populate("createdBy", "name email");

    res.json({ message: "MCQ updated successfully", question: updatedQuestion });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to update MCQ" });
  }
});

router.delete("/single/:questionId", authMiddleware, async (req, res) => {
  try {
    const question = await Question.findById(req.params.questionId);

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    const group = await isGroupMember(question.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can delete MCQs" });
    }

    if (question.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can delete only your own MCQs" });
    }

    if (question.questionImagePublicId) {
      await cloudinary.uploader.destroy(question.questionImagePublicId);
    }

    await QuestionAttempt.deleteMany({ question: question._id });
    await Question.findByIdAndDelete(question._id);

    res.json({ message: "MCQ deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete MCQ" });
  }
});

router.post("/attempt/:questionId", authMiddleware, async (req, res) => {
  try {
    const { selectedOption } = req.body;

    const question = await Question.findById(req.params.questionId);

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    const group = await isGroupMember(question.group, req.user._id);

    if (!group) {
      return res
        .status(403)
        .json({ message: "Only group members can attempt MCQs" });
    }

    const existingAttempt = await QuestionAttempt.findOne({
      question: question._id,
      user: req.user._id,
    });

    if (existingAttempt) {
      return res.status(400).json({
        message: "You already attempted this question",
      });
    }

    const isCorrect = Number(selectedOption) === question.correctOption;

    const attempt = await QuestionAttempt.create({
      question: question._id,
      group: question.group,
      user: req.user._id,
      selectedOption: Number(selectedOption),
      isCorrect,
    });

    const totalAttempts = await QuestionAttempt.countDocuments({
      group: question.group,
      user: req.user._id,
    });

    const correctAttempts = await QuestionAttempt.countDocuments({
      group: question.group,
      user: req.user._id,
      isCorrect: true,
    });

    res.json({
      message: isCorrect ? "Correct answer" : "Wrong answer",
      isCorrect,
      correctOption: question.correctOption,
      explanation: question.explanation,
      attempt,
      stats: {
        totalAttempts,
        correctAttempts,
        scorePercentage:
          totalAttempts > 0
            ? Math.round((correctAttempts / totalAttempts) * 100)
            : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit attempt" });
  }
});

router.get("/stats/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res
        .status(403)
        .json({ message: "Only group members can view stats" });
    }

    const totalAttempts = await QuestionAttempt.countDocuments({
      group: req.params.groupId,
      user: req.user._id,
    });

    const correctAttempts = await QuestionAttempt.countDocuments({
      group: req.params.groupId,
      user: req.user._id,
      isCorrect: true,
    });

    res.json({
      totalAttempts,
      correctAttempts,
      wrongAttempts: totalAttempts - correctAttempts,
      scorePercentage:
        totalAttempts > 0
          ? Math.round((correctAttempts / totalAttempts) * 100)
          : 0,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

export default router;
