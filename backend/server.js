import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import authRoutes from "./routes/authRoutes.js";
import groupRoutes from "./routes/groupRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import questionRoutes from "./routes/questionRoutes.js";
import resourceRoutes from "./routes/resourceRoutes.js";
import quizRoutes from "./routes/quizRoutes.js";
import meetingRoutes from "./routes/meetingRoutes.js";
import codingRoutes from "./routes/codingRoutes.js";

import User from "./models/User.js";
import Group from "./models/Group.js";
import Message from "./models/Message.js";
import uploadRoutes from "./routes/uploadRoutes.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://placement-app-frontend-2a1r.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
});

app.set("io", io);

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Placement Prep API is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/coding", codingRoutes);
app.use("/api/upload", uploadRoutes);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("No token provided"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.user = user;
    next();
  } catch (error) {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.user.name);

  socket.on("joinGroupChat", async (groupId) => {
    const group = await Group.findById(groupId);

    if (!group) return;

    const isMember = group.members.some(
      (memberId) => memberId.toString() === socket.user._id.toString(),
    );

    if (!isMember) return;

    socket.join(groupId);
  });

  socket.on("sendMessage", async ({ groupId, text }) => {
    if (!text?.trim()) return;

    const group = await Group.findById(groupId);
    if (!group) return;

    const isMember = group.members.some(
      (memberId) => memberId.toString() === socket.user._id.toString(),
    );

    if (!isMember) return;

    const message = await Message.create({
      group: groupId,
      sender: socket.user._id,
      text: text.trim(),
      messageType: "text",
    });

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "name email")
      .populate("reactions.user", "name email");

    io.to(groupId).emit("receiveMessage", populatedMessage);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.user.name);
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    server.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
  })
  .catch((error) => console.log(error));
