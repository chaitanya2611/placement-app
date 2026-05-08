import express from "express";
import Group from "../models/Group.js";
import Question from "../models/Question.js";
import Resource from "../models/Resource.js";
import Message from "../models/Message.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

const attachGroupStats = async (groups, userId) => {
  return Promise.all(
    groups.map(async (groupDoc) => {
      const group = groupDoc.toObject();

      const [mcqCount, resourceCount, lastMessage, lastQuestion, lastResource] =
        await Promise.all([
          Question.countDocuments({ group: group._id }),
          Resource.countDocuments({ group: group._id }),
          Message.findOne({ group: group._id }).sort({ createdAt: -1 }),
          Question.findOne({ group: group._id }).sort({ createdAt: -1 }),
          Resource.findOne({ group: group._id }).sort({ createdAt: -1 }),
        ]);

      const pendingRequestsCount =
        group.creator?._id?.toString() === userId.toString()
          ? group.joinRequests.filter((request) => request.status === "pending").length
          : 0;

      const activityDates = [
        group.updatedAt,
        lastMessage?.createdAt,
        lastQuestion?.createdAt,
        lastResource?.createdAt,
      ].filter(Boolean);

      const lastActivityAt = activityDates.length
        ? new Date(Math.max(...activityDates.map((date) => new Date(date).getTime())))
        : group.createdAt;

      let lastActivityText = "Group created";

      if (lastMessage && new Date(lastMessage.createdAt).getTime() === lastActivityAt.getTime()) {
        lastActivityText = lastMessage.text
          ? `Last message: ${lastMessage.text.slice(0, 60)}`
          : "Image shared in chat";
      } else if (lastQuestion && new Date(lastQuestion.createdAt).getTime() === lastActivityAt.getTime()) {
        lastActivityText = `MCQ added: ${lastQuestion.topic || "General"}`;
      } else if (lastResource && new Date(lastResource.createdAt).getTime() === lastActivityAt.getTime()) {
        lastActivityText = `Resource added: ${lastResource.title}`;
      }

      return {
        ...group,
        stats: {
          membersCount: group.members?.length || 0,
          mcqCount,
          resourceCount,
          pendingRequestsCount,
          lastActivityAt,
          lastActivityText,
        },
      };
    }),
  );
};

/* CREATE GROUP */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Group title is required" });
    }

    const group = await Group.create({
      title,
      description,
      creator: req.user._id,
      members: [req.user._id],
    });

    res.status(201).json({
      message: "Group created successfully",
      group,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/* GET GROUPS CREATED OR JOINED BY USER */
router.get("/my-groups", authMiddleware, async (req, res) => {
  try {
    const groups = await Group.find({
      members: req.user._id,
    })
      .populate("creator", "name email")
      .populate("members", "name email")
      .populate("joinRequests.user", "name email")
      .sort({ createdAt: -1 });

    const groupsWithStats = await attachGroupStats(groups, req.user._id);

    res.json(groupsWithStats);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/* GET ALL GROUPS */
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const groups = await Group.find()
      .populate("creator", "name email")
      .populate("members", "name email")
      .populate("joinRequests.user", "name email")
      .sort({ createdAt: -1 });

    res.json(groups);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/* UPDATE GROUP DETAILS - CREATOR ONLY */
router.put("/:groupId", authMiddleware, async (req, res) => {
  try {
    const { title, description, codingEnabled } = req.body;
    const group = await Group.findById(req.params.groupId);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (group.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only creator can edit group details" });
    }

    if (!title?.trim()) {
      return res.status(400).json({ message: "Group title is required" });
    }

    group.title = title.trim();
    group.description = description || "";

    if (typeof codingEnabled === "boolean") {
      group.codingEnabled = codingEnabled;
    }

    await group.save();

    const updatedGroup = await Group.findById(group._id)
      .populate("creator", "name email")
      .populate("members", "name email")
      .populate("joinRequests.user", "name email");

    res.json({ message: "Group updated successfully", group: updatedGroup });
  } catch (error) {
    res.status(500).json({ message: "Failed to update group" });
  }
});

/* REMOVE MEMBER - CREATOR ONLY */
router.put("/:groupId/members/:userId/remove", authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (group.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only creator can remove members" });
    }

    if (req.params.userId === group.creator.toString()) {
      return res.status(400).json({ message: "Creator cannot be removed from the group" });
    }

    group.members = group.members.filter(
      (memberId) => memberId.toString() !== req.params.userId,
    );

    await group.save();

    res.json({ message: "Member removed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to remove member" });
  }
});

/* LEAVE GROUP - MEMBERS ONLY */
router.put("/:groupId/leave", authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (group.creator.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "Creator cannot leave their own group" });
    }

    const isMember = group.members.some(
      (memberId) => memberId.toString() === req.user._id.toString(),
    );

    if (!isMember) {
      return res.status(400).json({ message: "You are not a member of this group" });
    }

    group.members = group.members.filter(
      (memberId) => memberId.toString() !== req.user._id.toString(),
    );

    await group.save();

    res.json({ message: "You left the group successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to leave group" });
  }
});

/* SEND JOIN REQUEST */
router.post("/:groupId/request", authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (group.creator.toString() === req.user._id.toString()) {
      return res
        .status(400)
        .json({ message: "You are the creator of this group" });
    }

    const alreadyMember = group.members.some(
      (memberId) => memberId.toString() === req.user._id.toString(),
    );

    if (alreadyMember) {
      return res.status(400).json({ message: "You are already a member" });
    }

    const alreadyRequested = group.joinRequests.some(
      (request) =>
        request.user.toString() === req.user._id.toString() &&
        request.status === "pending",
    );

    if (alreadyRequested) {
      return res.status(400).json({ message: "Join request already sent" });
    }

    group.joinRequests.push({
      user: req.user._id,
      status: "pending",
    });

    await group.save();

    res.json({ message: "Join request sent successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/* GET JOIN REQUESTS FOR CREATOR */
router.get("/:groupId/requests", authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).populate(
      "joinRequests.user",
      "name email",
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (group.creator.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only creator can view requests" });
    }

    const pendingRequests = group.joinRequests.filter(
      (request) => request.status === "pending",
    );

    res.json(pendingRequests);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ACCEPT JOIN REQUEST */
router.put(
  "/:groupId/requests/:userId/accept",
  authMiddleware,
  async (req, res) => {
    try {
      const group = await Group.findById(req.params.groupId);

      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }

      if (group.creator.toString() !== req.user._id.toString()) {
        return res
          .status(403)
          .json({ message: "Only creator can accept requests" });
      }

      const request = group.joinRequests.find(
        (reqItem) =>
          reqItem.user.toString() === req.params.userId &&
          reqItem.status === "pending",
      );

      if (!request) {
        return res.status(404).json({ message: "Pending request not found" });
      }

      request.status = "accepted";

      const alreadyMember = group.members.some(
        (memberId) => memberId.toString() === req.params.userId,
      );

      if (!alreadyMember) {
        group.members.push(req.params.userId);
      }

      await group.save();

      res.json({ message: "Join request accepted" });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
);

/* REJECT JOIN REQUEST */
router.put(
  "/:groupId/requests/:userId/reject",
  authMiddleware,
  async (req, res) => {
    try {
      const group = await Group.findById(req.params.groupId);

      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }

      if (group.creator.toString() !== req.user._id.toString()) {
        return res
          .status(403)
          .json({ message: "Only creator can reject requests" });
      }

      const request = group.joinRequests.find(
        (reqItem) =>
          reqItem.user.toString() === req.params.userId &&
          reqItem.status === "pending",
      );

      if (!request) {
        return res.status(404).json({ message: "Pending request not found" });
      }

      request.status = "rejected";

      await group.save();

      res.json({ message: "Join request rejected" });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
);

export default router;
