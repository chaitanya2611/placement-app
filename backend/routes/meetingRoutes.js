import express from "express";
import crypto from "crypto";
import Group from "../models/Group.js";
import Meeting from "../models/Meeting.js";
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

const createRoomName = (groupId) => {
  const randomCode = crypto.randomBytes(4).toString("hex");
  return `prep-to-place-${groupId}-${randomCode}`;
};

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can view meetings" });
    }

    const meetings = await Meeting.find({ group: req.params.groupId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json(meetings);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch meetings" });
  }
});

router.post("/:groupId", authMiddleware, async (req, res) => {
  try {
    const group = await isGroupMember(req.params.groupId, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can create meetings" });
    }

    const { title, description, scheduledAt } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Meeting title is required" });
    }

    const roomName = createRoomName(req.params.groupId);
    const meetingUrl = `https://meet.jit.si/${roomName}`;
    const hasSchedule = Boolean(scheduledAt);

    const meeting = await Meeting.create({
      group: req.params.groupId,
      createdBy: req.user._id,
      title: title.trim(),
      description: description || "",
      roomName,
      meetingUrl,
      scheduledAt: hasSchedule ? new Date(scheduledAt) : null,
      meetingType: hasSchedule ? "scheduled" : "instant",
      status: hasSchedule ? "scheduled" : "active",
    });

    const populatedMeeting = await Meeting.findById(meeting._id).populate(
      "createdBy",
      "name email",
    );

    res.status(201).json({
      message: hasSchedule ? "Meeting scheduled successfully" : "Meeting started successfully",
      meeting: populatedMeeting,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create meeting" });
  }
});

router.put("/:meetingId/end", authMiddleware, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.meetingId);

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    const group = await isGroupMember(meeting.group, req.user._id);

    if (!group) {
      return res.status(403).json({ message: "Only group members can update meetings" });
    }

    if (meeting.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only meeting creator can end this meeting" });
    }

    meeting.status = "ended";
    await meeting.save();

    res.json({ message: "Meeting marked as ended", meeting });
  } catch (error) {
    res.status(500).json({ message: "Failed to end meeting" });
  }
});

router.delete("/:meetingId", authMiddleware, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.meetingId);

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    const group = await Group.findById(meeting.group);

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const isMember = group.members.some(
      (memberId) => memberId.toString() === req.user._id.toString(),
    );

    if (!isMember) {
      return res.status(403).json({ message: "Only group members can delete meetings" });
    }

    if (group.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only group creator can delete meeting details" });
    }

    await Meeting.findByIdAndDelete(meeting._id);

    res.json({ message: "Meeting deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete meeting" });
  }
});

export default router;
