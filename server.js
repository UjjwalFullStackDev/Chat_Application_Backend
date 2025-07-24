const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://chat-application-frontent.vercel.app/"
];

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like Postman) or whitelisted
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

// Socket.IO configuration
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// Connect to MongoDB
connectDB();

// Middleware
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return next(new Error('Authentication error'));
    }
    
    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// Socket.IO connection handling
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.name}`);
  
  // Store connected user
  connectedUsers.set(socket.userId, socket.id);
  
  // Update user online status
  User.findByIdAndUpdate(socket.userId, { 
    isOnline: true, 
    lastSeen: new Date() 
  }).exec();

  // Handle user joining
  socket.on('user-join', (data) => {
    socket.join(`user_${socket.userId}`);
    console.log(`User ${socket.user.name} joined room: user_${socket.userId}`);
  });

  // Handle chat messages
  socket.on('chat-message', async (data) => {
    try {
      const { receiverId, content } = data;
      
      // Save message to database
      const message = new Message({
        sender: socket.userId,
        receiver: receiverId,
        content: content.trim()
      });
      console.log(message)
      
      await message.save();
      
      // Populate sender and receiver info
      await message.populate('sender', 'name');
      await message.populate('receiver', 'name');

      // Send to receiver if online
      const receiverSocketId = connectedUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('new-message', {
          _id: message._id,
          sender: message.sender,
          receiver: message.receiver,
          content: message.content,
          timestamp: message.timestamp,
          createdAt: message.createdAt
        });
      }

      // Send back to sender for confirmation
      socket.emit('message-sent', {
        _id: message._id,
        sender: message.sender,
        receiver: message.receiver,
        content: message.content,
        timestamp: message.timestamp,
        createdAt: message.createdAt
      });

    } catch (error) {
      console.error('Message error:', error);
      socket.emit('message-error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    const receiverSocketId = connectedUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user-typing', {
        senderId: socket.userId,
        senderName: socket.user.name
      });
    }
  });

  socket.on('stop-typing', (data) => {
    const receiverSocketId = connectedUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user-stop-typing', {
        senderId: socket.userId
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.name}`);
    
    // Remove from connected users
    connectedUsers.delete(socket.userId);
    
    // Update user offline status
    User.findByIdAndUpdate(socket.userId, { 
      isOnline: false, 
      lastSeen: new Date() 
    }).exec();
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});