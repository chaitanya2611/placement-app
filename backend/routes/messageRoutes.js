import express from "express";
import multer from "multer";
import streamifier from "streamifier";
import Message from "../models/Message.js";
import Group from "../models/Group.js";
import authMiddleware from "../middleware/authMiddleware.js";
import cloudinary from "../utils/cloudinary.js";

const router = express.Router();

const storage = multer.memoryStorage();
const allowedReactions = ["👍", "❤️", "😂", "🔥", "👏", "😮"];

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

const getPopulatedMessage = (messageId) => {
  return Message.findById(messageId)
    .populate("sender", "name email")
    .populate("reactions.user", "name email");
};

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const result = await checkGroupMember(req.params.groupId, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    const messages = await Message.find({ group: req.params.groupId })
      .populate("sender", "name email")
      .populate("reactions.user", "name email")
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

      const populatedMessage = await getPopulatedMessage(message._id);

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

router.put("/:messageId", authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text?.trim()) {
      return res.status(400).json({ message: "Message text is required" });
    }

    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const result = await checkGroupMember(message.group, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can edit only your messages" });
    }

    message.text = text.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await getPopulatedMessage(message._id);

    req.app
      .get("io")
      .to(message.group.toString())
      .emit("messageUpdated", populatedMessage);

    res.json(populatedMessage);
  } catch (error) {
    res.status(500).json({ message: "Failed to update message" });
  }
});

router.delete("/:messageId", authMiddleware, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const result = await checkGroupMember(message.group, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can delete only your messages" });
    }

    if (message.imagePublicId) {
      await cloudinary.uploader.destroy(message.imagePublicId);
    }

    await Message.findByIdAndDelete(message._id);

    req.app
      .get("io")
      .to(message.group.toString())
      .emit("messageDeleted", { messageId: message._id });

    res.json({ message: "Message deleted successfully", messageId: message._id });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete message" });
  }
});

router.post("/:messageId/reactions", authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;

    if (!allowedReactions.includes(emoji)) {
      return res.status(400).json({ message: "Invalid reaction" });
    }

    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const result = await checkGroupMember(message.group, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    const existingReactionIndex = message.reactions.findIndex(
      (reaction) => reaction.user.toString() === req.user._id.toString(),
    );

    if (existingReactionIndex >= 0) {
      if (message.reactions[existingReactionIndex].emoji === emoji) {
        message.reactions.splice(existingReactionIndex, 1);
      } else {
        message.reactions[existingReactionIndex].emoji = emoji;
      }
    } else {
      message.reactions.push({ user: req.user._id, emoji });
    }

    await message.save();

    const populatedMessage = await getPopulatedMessage(message._id);

    req.app
      .get("io")
      .to(message.group.toString())
      .emit("messageUpdated", populatedMessage);

    res.json(populatedMessage);
  } catch (error) {
    res.status(500).json({ message: "Failed to react to message" });
  }
});

export default router;
