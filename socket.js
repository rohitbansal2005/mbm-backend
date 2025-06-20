const socketIO = require('socket.io');
const User = require('./models/User');
const UserSettings = require('./models/UserSettings');
const Message = require('./models/Message');
const Event = require('./models/Event');
const { Server } = require('socket.io');

// Move onlineUsersMap to module scope so it can be accessed outside initializeSocket
const onlineUsersMap = new Map(); // userId -> Set of socketIds

let io;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    path: '/socket.io',
    allowEIO3: true,
    cookie: {
      name: 'io',
      path: '/',
      httpOnly: true,
      sameSite: 'lax'
    }
  });

  // Function to emit online users based on privacy settings
  const emitOnlineUsers = async () => {
    try {
      // Get all online user IDs from the map
      const onlineUserIds = Array.from(onlineUsersMap.keys());
      console.log('Online user IDs:', onlineUserIds);

      if (!onlineUserIds.length) {
        io.emit('onlineUsers', []);
        return;
      }

      // Fetch users who are online
      const users = await User.find({
        _id: { $in: onlineUserIds }
      }).select('_id username profilePicture avatar fullName');

      console.log('Found online users:', users);

      // Get settings for these users
      const settings = await UserSettings.find({
        user: { $in: onlineUserIds }
      });

      // Create a map of user settings
      const settingsMap = new Map(
        settings.map(s => [s.user.toString(), s])
      );

      // Filter users based on settings
      const usersToShowAsOnline = users.filter(user => {
        const userSettings = settingsMap.get(user._id.toString());
        // If no settings exist, default to showing online status
        return !userSettings || userSettings.showOnlineStatus;
      }).map(user => ({
        _id: user._id,
        username: user.username,
        profilePicture: user.profilePicture,
        avatar: user.avatar,
        fullName: user.fullName
      }));

      console.log('Emitting online users:', usersToShowAsOnline);
      io.emit('onlineUsers', usersToShowAsOnline);
    } catch (error) {
      console.error('Error emitting online users:', error);
      io.emit('onlineUsers', []);
    }
  };

  io.on('connection', async (socket) => {
    console.log('New client connected:', socket.id);

    // Add heartbeat mechanism
    const heartbeatInterval = setInterval(async () => {
        if (socket.userId) {
            try {
                await User.findByIdAndUpdate(socket.userId, {
                    lastSeen: new Date()
                });
            } catch (error) {
                console.error('Error updating lastSeen:', error);
            }
        }
    }, 60000); // Update every minute

    socket.on('joinUserRoom', (userId) => {
      if (!userId) {
        console.error('No userId provided for joinUserRoom');
        return;
      }
      socket.join(userId);
      console.log(`User ${userId} joined their room`);
    });

    socket.on('userLogin', async (userId) => {
      try {
        if (!userId) {
          console.error('No userId provided for userLogin');
          return;
        }
        // Validate userId is a valid ObjectId
        if (!/^[a-fA-F0-9]{24}$/.test(userId)) {
          console.error('Invalid userId for userLogin:', userId);
          return;
        }
        console.log('User login attempt:', userId);
        socket.userId = userId;
        
        // Add socket.id to the Set for this user
        if (!onlineUsersMap.has(userId)) {
          onlineUsersMap.set(userId, new Set());
        }
        onlineUsersMap.get(userId).add(socket.id);
        
        // Mark user as online in DB
        await User.findByIdAndUpdate(userId, { 
          isOnline: true,
          lastSeen: new Date()
        });
        
        console.log('User marked as online:', userId);
        
        // Emit updated online users list
        emitOnlineUsers();

      } catch (error) {
        console.error('Error in userLogin:', error);
      }
    });

    socket.on('disconnect', async () => {
      try {
        console.log('Client disconnected:', socket.id);
        
        // Clear heartbeat interval
        clearInterval(heartbeatInterval);
        
        // Find the user ID associated with this socket ID
        let disconnectedUserId = null;
        for (const [userId, socketSet] of onlineUsersMap.entries()) {
          if (socketSet.has(socket.id)) {
            socketSet.delete(socket.id);
            if (socketSet.size === 0) {
              onlineUsersMap.delete(userId);
              disconnectedUserId = userId;
            }
            break;
          }
        }

        if (disconnectedUserId) {
          // Mark user as offline in DB
          await User.findByIdAndUpdate(disconnectedUserId, { 
            isOnline: false,
            lastSeen: new Date()
          });
          
          console.log('User marked as offline:', disconnectedUserId);
          
          // Emit updated online users list
          emitOnlineUsers();
        }
      } catch (error) {
        console.error('Error in disconnect:', error);
      }
    });
  });

  return io;
};

// Expose a getter for online user IDs
const getOnlineUserIds = () => {
  const ids = Array.from(onlineUsersMap.keys());
  console.log('Getting online user IDs:', ids);
  return ids;
};

module.exports = {
  initializeSocket,
  getIO: () => io,
  getOnlineUserIds
}; 