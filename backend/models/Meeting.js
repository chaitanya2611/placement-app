import mongoose from "mongoose";

const meetingSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    meetingUrl: {
      type: String,
      required: true,
    },
    roomName: {
      type: String,
      required: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    meetingType: {
      type: String,
      enum: ["instant", "scheduled"],
      default: "instant",
    },
    status: {
      type: String,
      enum: ["active", "scheduled", "ended"],
      default: "active",
    },
  },
  { timestamps: true },
);

const Meeting = mongoose.model("Meeting", meetingSchema);

export default Meeting;
