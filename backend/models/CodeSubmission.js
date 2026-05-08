import mongoose from "mongoose";

const codeSubmissionSchema = new mongoose.Schema(
  {
    problem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CodingProblem",
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
    language: {
      type: String,
      default: "python",
      enum: ["python"],
    },
    code: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["Accepted", "Wrong Answer", "Error"],
      required: true,
    },
    passedTests: {
      type: Number,
      default: 0,
    },
    totalTests: {
      type: Number,
      default: 0,
    },
    output: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

const CodeSubmission = mongoose.model("CodeSubmission", codeSubmissionSchema);

export default CodeSubmission;
