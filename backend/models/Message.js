import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    emoji: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: {
      type: String,
      default: "",
      trim: true,
    },

    imageUrl: {
      type: String,
      default: "",
    },

    imagePublicId: {
      type: String,
      default: "",
    },

    messageType: {
      type: String,
      enum: ["text", "image", "mixed"],
      default: "text",
    },

    reactions: {
      type: [reactionSchema],
      default: [],
    },

    isEdited: {
      type: Boolean,
      default: false,
    },

    editedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

const Message = mongoose.model("Message", messageSchema);

export default Message;
