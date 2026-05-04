import express from "express";
import Group from "../models/Group.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

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
      .sort({ createdAt: -1 });

    res.json(groups);
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

      if (!group.members.includes(req.params.userId)) {
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
