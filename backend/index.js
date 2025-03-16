import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import fs from "fs";

const app = express();
const server = http.createServer(app);

// Set the URL based on environment:
// In production, use your deployed URL (with trailing slash)
// In development, use localhost.
const url = process.env.NODE_ENV === "production"
  ? "https://render-hosting-se2b.onrender.com/"
  : "http://localhost:5000/";

// Interval for the ping (to keep the site awake on Render)
const interval = 30000;

function reloadWebsite() {
  axios
    .get(url)
    .then(() => {
      console.log("Website reloaded");
    })
    .catch((error) => {
      console.error(`Reload error: ${error.message}`);
    });
}

// Only run the reload ping in production (or adjust as needed)
if (process.env.NODE_ENV === "production") {
  setInterval(reloadWebsite, interval);
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine the path to your built frontend files
// Adjust the "../frontend/dist" if your project structure differs.
const staticPath = path.join(__dirname, "../frontend/dist");
console.log("Static files path:", staticPath);

// Check if index.html exists at the expected location
const indexPath = path.join(staticPath, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error("index.html not found at:", indexPath);
}

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User Connected", socket.id);

  let currentRoom = null;
  let currentUser = null;

  socket.on("join", ({ roomId, userName }) => {
    // If already in a room, leave that room first
    if (currentRoom) {
      socket.leave(currentRoom);
      const roomSet = rooms.get(currentRoom);
      if (roomSet) {
        roomSet.delete(currentUser);
        io.to(currentRoom).emit("userJoined", Array.from(roomSet));
      }
    }

    currentRoom = roomId;
    currentUser = userName;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(userName);
    io.to(roomId).emit("userJoined", Array.from(rooms.get(roomId)));
  });

  socket.on("codeChange", ({ roomId, code }) => {
    socket.to(roomId).emit("codeUpdate", code);
  });

  socket.on("leaveRoom", () => {
    if (currentRoom && currentUser) {
      const roomSet = rooms.get(currentRoom);
      if (roomSet) {
        roomSet.delete(currentUser);
        io.to(currentRoom).emit("userJoined", Array.from(roomSet));
      }
      socket.leave(currentRoom);
      currentRoom = null;
      currentUser = null;
    }
  });

  socket.on("typing", ({ roomId, userName }) => {
    socket.to(roomId).emit("userTyping", userName);
  });

  socket.on("languageChange", ({ roomId, language }) => {
    io.to(roomId).emit("languageUpdate", language);
  });

  socket.on("compileCode", async ({ code, roomId, language, version }) => {
    try {
      const response = await axios.post("https://emkc.org/api/v2/piston/execute", {
        language,
        version,
        files: [
          {
            content: code,
          },
        ],
      });
      // Emit the code response directly to the room
      io.to(roomId).emit("codeResponse", response.data);
    } catch (error) {
      console.error("Error compiling code:", error.message);
      io.to(roomId).emit("codeResponse", { error: error.message });
    }
  });

  socket.on("disconnect", () => {
    if (currentRoom && currentUser) {
      const roomSet = rooms.get(currentRoom);
      if (roomSet) {
        roomSet.delete(currentUser);
        io.to(currentRoom).emit("userJoined", Array.from(roomSet));
      }
    }
    console.log("User Disconnected");
  });
});

const port = process.env.PORT || 5000;

// Serve static files from the frontend build folder
app.use(express.static(staticPath));

// Catch-all route to serve index.html for any route (for SPA routing)
app.get("*", (req, res) => {
  res.sendFile(indexPath);
});

server.listen(port, () => {
  console.log(`Server is working on port ${port}`);
});


