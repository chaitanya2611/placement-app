import express from "express";
import multer from "multer";
import streamifier from "streamifier";
import Question from "../models/Question.js";
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

// Any group member can add MCQ
router.post(
  "/:groupId",
  authMiddleware,
  upload.single("questionImage"),
  async (req, res) => {
    try {
      const { questionText, correctOption, explanation } = req.body;

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

// Get MCQs
router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res
        .status(403)
        .json({ message: "Only group members can view MCQs" });
    }

    const questions = await Question.find({ group: req.params.groupId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
