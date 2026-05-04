import express from "express";
import multer from "multer";
import streamifier from "streamifier";
import Message from "../models/Message.js";
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
        folder: "placement-app/group-chat",
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

const checkGroupMember = async (groupId, userId) => {
  const group = await Group.findById(groupId);

  if (!group) {
    return { error: "Group not found", status: 404 };
  }

  const isMember = group.members.some(
    (memberId) => memberId.toString() === userId.toString(),
  );

  if (!isMember) {
    return { error: "Only group members can access chat", status: 403 };
  }

  return { group };
};

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const result = await checkGroupMember(req.params.groupId, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    const messages = await Message.find({ group: req.params.groupId })
      .populate("sender", "name email")
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:groupId/image",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      const { text } = req.body;

      if (!req.file && !text?.trim()) {
        return res
          .status(400)
          .json({ message: "Message or image is required" });
      }

      const result = await checkGroupMember(req.params.groupId, req.user._id);

      if (result.error) {
        return res.status(result.status).json({ message: result.error });
      }

      let uploadResult = null;

      if (req.file) {
        uploadResult = await uploadToCloudinary(req.file.buffer);
      }

      const message = await Message.create({
        group: req.params.groupId,
        sender: req.user._id,
        text: text || "",
        imageUrl: uploadResult?.secure_url || "",
        imagePublicId: uploadResult?.public_id || "",
        messageType:
          text?.trim() && uploadResult
            ? "mixed"
            : uploadResult
              ? "image"
              : "text",
      });

      const populatedMessage = await Message.findById(message._id).populate(
        "sender",
        "name email",
      );

      req.app
        .get("io")
        .to(req.params.groupId)
        .emit("receiveMessage", populatedMessage);

      res.status(201).json(populatedMessage);
    } catch (error) {
      res.status(500).json({ message: error.message || "Image upload failed" });
    }
  },
);

export default router;
