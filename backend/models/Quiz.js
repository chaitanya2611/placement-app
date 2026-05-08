import mongoose from "mongoose";

const quizQuestionSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      default: null,
    },
    questionText: {
      type: String,
      required: true,
      trim: true,
    },
    topic: {
      type: String,
      default: "General",
      trim: true,
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
    marks: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    negativeMarks: {
      type: Number,
      default: 0,
      min: 0,
    },
    sourceType: {
      type: String,
      enum: ["mcq", "custom"],
      default: "custom",
    },
  },
  { _id: true },
);

const quizSchema = new mongoose.Schema(
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
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
    },
    allowNegativeMarking: {
      type: Boolean,
      default: false,
    },
    questions: {
      type: [quizQuestionSchema],
      default: [],
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Quiz = mongoose.model("Quiz", quizSchema);

export default Quiz;
