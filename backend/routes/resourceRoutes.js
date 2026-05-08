import express from "express";
import multer from "multer";
import streamifier from "streamifier";
import authMiddleware from "../middleware/authMiddleware.js";
import Group from "../models/Group.js";
import Resource from "../models/Resource.js";
import cloudinary from "../utils/cloudinary.js";

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const uploadToCloudinary = (fileBuffer, originalname) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "placement-app/resources",
        resource_type: "auto",
        public_id: `${Date.now()}-${originalname}`,
      },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      },
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

const checkMember = async (groupId, userId) => {
  const group = await Group.findById(groupId);

  if (!group) {
    return { error: "Group not found", status: 404 };
  }

  const isMember = group.members.some(
    (memberId) => memberId.toString() === userId.toString(),
  );

  if (!isMember) {
    return { error: "Only group members can access resources", status: 403 };
  }

  return { group };
};

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const result = await checkMember(req.params.groupId, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    const resources = await Resource.find({ group: req.params.groupId })
      .populate("uploadedBy", "name email")
      .sort({ createdAt: -1 });

    res.json(resources);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch resources" });
  }
});

router.post(
  "/:groupId/upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const result = await checkMember(req.params.groupId, req.user._id);

      if (result.error) {
        return res.status(result.status).json({ message: result.error });
      }

      if (!req.file) {
        return res.status(400).json({ message: "File is required" });
      }

      const { title, description } = req.body;

      if (!title?.trim()) {
        return res.status(400).json({ message: "Title is required" });
      }

      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
      );

      const resource = await Resource.create({
        group: req.params.groupId,
        uploadedBy: req.user._id,
        title,
        description,
        resourceType: "file",
        fileUrl: uploadResult.secure_url,
        filePublicId: uploadResult.public_id,
        fileName: req.file.originalname,
        fileMimeType: req.file.mimetype,
        fileSize: req.file.size,
      });

      const populated = await Resource.findById(resource._id).populate(
        "uploadedBy",
        "name email",
      );

      res.status(201).json(populated);
    } catch (error) {
      res.status(500).json({
        message: error.message || "Failed to upload resource",
      });
    }
  },
);

router.post("/:groupId/link", authMiddleware, async (req, res) => {
  try {
    const result = await checkMember(req.params.groupId, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    const { title, description, linkUrl } = req.body;

    if (!title?.trim() || !linkUrl?.trim()) {
      return res
        .status(400)
        .json({ message: "Title and link are required" });
    }

    const resource = await Resource.create({
      group: req.params.groupId,
      uploadedBy: req.user._id,
      title,
      description,
      resourceType: "link",
      linkUrl,
    });

    const populated = await Resource.findById(resource._id).populate(
      "uploadedBy",
      "name email",
    );

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: "Failed to add link resource" });
  }
});

router.delete("/:resourceId", authMiddleware, async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.resourceId);

    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const result = await checkMember(resource.group, req.user._id);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    if (resource.uploadedBy.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "You can delete only your own resources" });
    }

    if (resource.filePublicId) {
      await cloudinary.uploader.destroy(resource.filePublicId, {
        resource_type: "raw",
      });
    }

    await Resource.findByIdAndDelete(resource._id);

    res.json({ message: "Resource deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete resource" });
  }
});

export default router;
