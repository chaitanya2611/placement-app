import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddleware.js";
import Group from "../models/Group.js";
import Resource from "../models/Resource.js";

const router = express.Router();

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

const sanitizeFileName = (fileName) => {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
};

const uploadToGitHub = async ({ fileBuffer, originalname, groupId }) => {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;
  const folder = process.env.GITHUB_RESOURCE_FOLDER || "uploaded-resources";

  if (!owner || !repo || !token) {
    throw new Error("GitHub storage environment variables are missing");
  }

  const safeName = sanitizeFileName(originalname);
  const path = `${folder}/${groupId}/${Date.now()}-${safeName}`;
  const content = fileBuffer.toString("base64");

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        message: `Upload resource ${safeName}`,
        content,
        branch,
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "GitHub upload failed");
  }

  return {
    downloadUrl: data.content.download_url,
    path,
  };
};

const deleteFromGitHub = async (filePath) => {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token || !filePath) return;

  const getResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!getResponse.ok) return;

  const fileData = await getResponse.json();

  await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        message: `Delete resource ${filePath}`,
        sha: fileData.sha,
        branch,
      }),
    },
  );
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

      const uploadResult = await uploadToGitHub({
        fileBuffer: req.file.buffer,
        originalname: req.file.originalname,
        groupId: req.params.groupId,
      });

      const resource = await Resource.create({
        group: req.params.groupId,
        uploadedBy: req.user._id,
        title,
        description,
        resourceType: "file",
        fileUrl: uploadResult.downloadUrl,
        filePublicId: uploadResult.path,
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
      await deleteFromGitHub(resource.filePublicId);
    }

    await Resource.findByIdAndDelete(resource._id);

    res.json({ message: "Resource deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete resource" });
  }
});

export default router;
