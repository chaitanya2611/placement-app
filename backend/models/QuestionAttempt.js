import mongoose from "mongoose";

const questionAttemptSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    selectedOption: {
      type: Number,
      required: true,
      min: 0,
      max: 3,
    },
    isCorrect: {
      type: Boolean,
      required: true,
    },
  },
  { timestamps: true },
);

questionAttemptSchema.index({ question: 1, user: 1 }, { unique: true });

const QuestionAttempt = mongoose.model("QuestionAttempt", questionAttemptSchema);

export default QuestionAttempt;
