import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
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

    topic: {
      type: String,
      default: "General",
      trim: true,
    },

    questionText: {
      type: String,
      required: true,
    },

    questionImageUrl: {
      type: String,
      default: "",
    },

    questionImagePublicId: {
      type: String,
      default: "",
    },

    options: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => arr.length === 4,
        message: "Exactly 4 options are required",
      },
    },

    correctOption: {
      type: Number,
      required: true,
      min: 0,
      max: 3,
    },

    explanation: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

const Question = mongoose.model("Question", questionSchema);

export default Question;
