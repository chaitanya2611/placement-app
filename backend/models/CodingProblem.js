import mongoose from "mongoose";

const testCaseSchema = new mongoose.Schema(
  {
    input: {
      type: String,
      default: "",
    },
    expectedOutput: {
      type: String,
      required: true,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

const codingProblemSchema = new mongoose.Schema(
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
      required: true,
    },
    topic: {
      type: String,
      default: "General",
      trim: true,
    },
    starterCode: {
      type: String,
      default: "# Write your Python solution here\n",
    },
    testCases: {
      type: [testCaseSchema],
      default: [],
    },
  },
  { timestamps: true },
);

const CodingProblem = mongoose.model("CodingProblem", codingProblemSchema);

export default CodingProblem;
