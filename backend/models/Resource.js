import mongoose from "mongoose";

const resourceSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    uploadedBy: {
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
      trim: true,
    },
    resourceType: {
      type: String,
      enum: ["file", "link"],
      required: true,
    },
    fileUrl: {
      type: String,
      default: "",
    },
    filePublicId: {
      type: String,
      default: "",
    },
    fileName: {
      type: String,
      default: "",
    },
    fileMimeType: {
      type: String,
      default: "",
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    linkUrl: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

const Resource = mongoose.model("Resource", resourceSchema);

export default Resource;
