const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { Channel, Task, Project } = require('../models/index');
const { getChannelAccess } = require('../utils/channelAccess');

const disconnectTimeouts = new Map();

module.exports = (io) => {
  // Auth middleware for sockets
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user    = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = String(socket.user._id);
    console.log(`🔌 Socket connected: ${socket.user.name} (${userId})`);

    // Cancel any pending disconnect cleanup timeout for this user
    if (disconnectTimeouts.has(userId)) {
      clearTimeout(disconnectTimeouts.get(userId));
      disconnectTimeouts.delete(userId);
    }

    // ── Mark user online ──────────────────────────────────
    User.findByIdAndUpdate(userId, { status: 'online' }).exec();
    socket.broadcast.emit('user:online', { userId, name: socket.user.name });

    // ── Join personal user room (for cross-session timer sync) ──
    socket.join(`user:${userId}`);
    if (socket.user.role === 'admin') {
      socket.join('admin');
    }

    // ── System log streaming (admin only) ─────────────────────
    socket.on('system:logs:subscribe', () => {
      if (socket.user.role !== 'admin') return;
      socket.join('admin:syslog');
      // Deliver the last ~200 lines from every available source as the initial snapshot
      if (io._logWatcher) io._logWatcher.sendAllInitial(socket, 200);
    });

    socket.on('system:logs:unsubscribe', () => {
      socket.leave('admin:syslog');
    });
 
    // ── Auto-join channels and DM rooms ───────────────────
    try {
      let filter = { isDeleted: { $ne: true } };
      if (socket.user.role === 'client') {
        // Clients join: dedicated channel (clientId match) OR any private channel they're a member of
        filter = {
          isDeleted: { $ne: true },
          $or: [
            { clientId: socket.user.clientId },
            { isPrivate: true, members: userId },
          ],
        };
      } else if (socket.user.role !== 'admin') {
        filter = {
          isDeleted: { $ne: true },
          $or: [
            { isPrivate: false },
            { isPrivate: true, members: userId },
          ],
        };
      }
      const dbChannels = await Channel.find(filter, '_id').exec();
      dbChannels.forEach((ch) => {
        socket.join(String(ch._id));
      });
      // Legacy channels: staff and admin only — clients are never added here
      if (socket.user.role !== 'client') {
        const legacyChannels = ['general', 'design', 'dev', 'marketing', 'client-updates'];
        legacyChannels.forEach((chId) => socket.join(chId));
      }
    } catch (err) {
      console.error('Error auto-joining database channels:', err);
    }

    try {
      if (socket.user.role === 'client' && socket.user.clientId) {
        // Clients only join DM rooms with admins + users assigned to their projects/tasks
        const clientId = socket.user.clientId;
        const [admins, projects, tasks] = await Promise.all([
          User.find({ role: 'admin' }, '_id').lean(),
          Project.find({ clientId }, 'assignedTeam').lean(),
          Task.find({ clientId }, 'assignedTo').lean(),
        ]);
        const allowedIds = new Set(admins.map((u) => String(u._id)));
        projects.forEach((p) => (p.assignedTeam || []).forEach((uid) => allowedIds.add(String(uid))));
        tasks.forEach((t) => t.assignedTo && allowedIds.add(String(t.assignedTo)));

        allowedIds.forEach((otherId) => {
          if (otherId !== userId) {
            const sorted = [userId, otherId].sort();
            socket.join(`dm-${sorted[0]}-${sorted[1]}`);
          }
        });
      } else {
        // Staff: join DM rooms with every other user
        const allUsers = await User.find({}, '_id').exec();
        allUsers.forEach((otherUser) => {
          const otherId = String(otherUser._id);
          if (otherId !== userId) {
            const sorted = [userId, otherId].sort();
            socket.join(`dm-${sorted[0]}-${sorted[1]}`);
          }
        });
      }
    } catch (err) {
      console.error('Error joining DM rooms on socket connection:', err);
    }

    // ── Canonical DM helper ──────────────────────────────
    const getCanonicalRoom = (threadId, socketUser) => {
      if (threadId && threadId.startsWith('dm-')) {
        const otherUserId = threadId.replace('dm-', '');
        const myId = String(socketUser._id);
        const sorted = [myId, otherUserId].sort();
        return `dm-${sorted[0]}-${sorted[1]}`;
      }
      return threadId;
    };

    // ── Join rooms ────────────────────────────────────────
    socket.on('join:thread', async (threadId) => {
      const room = getCanonicalRoom(threadId, socket.user);
      // For clients: only join DM rooms they're already authorised for (joined at connect time)
      if (socket.user.role === 'client' && room.startsWith('dm-') && !socket.rooms.has(room)) {
        return; // silently reject unauthorised DM join
      }
      // Private groups: only members (and admins) may join the live room
      try {
        const { allowed } = await getChannelAccess(socket.user, room);
        if (!allowed) return;
      } catch { return; }
      socket.join(room);
    });

    socket.on('leave:thread', (threadId) => {
      // Keep user in the room to allow background unread notifications and cache updates
    });

    // ── Typing indicators ─────────────────────────────────
    socket.on('typing:start', ({ threadId }) => {
      const room = getCanonicalRoom(threadId, socket.user);
      socket.to(room).emit('typing:start', {
        userId,
        name: socket.user.name,
        threadId: room,
      });
    });

    socket.on('typing:stop', ({ threadId }) => {
      const room = getCanonicalRoom(threadId, socket.user);
      socket.to(room).emit('typing:stop', { userId, threadId: room, name: socket.user.name });
    });

    // ── Status updates ────────────────────────────────────
    socket.on('status:update', async ({ status }) => {
      try {
        await User.findByIdAndUpdate(userId, { status });
        io.emit('user:status', { userId, status });
      } catch {}
    });

    // ── Timer cross-session sync ──────────────────────────
    // Relay the authoritative timer state to all other sessions of this user
    socket.on('timer:sync', (payload) => {
      // Broadcast to all other sockets in this user's personal room (not back to sender)
      socket.to(`user:${userId}`).emit('timer:sync', payload);
      // Broadcast to all connected clients (admins and managers) for team tracking
      io.emit('member:timer:update', { userId, ...payload });
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${socket.user.name}`);
      
      // Delay disconnect cleanup by 5 seconds to handle page reloads smoothly
      const timeoutId = setTimeout(async () => {
        try {
          disconnectTimeouts.delete(userId);
          const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`);
          const hasActiveConnections = userRoom && userRoom.size > 0;

          if (!hasActiveConnections) {
            await User.findByIdAndUpdate(userId, { status: 'offline' });
            io.emit('user:offline', { userId });
            // Deliberately NOT touching WorkLog.active/breakActive here — a dropped
            // socket (backgrounded tab, network blip, laptop sleep) is not a check-out.
            // The work timer only stops via explicit logout/pause or an unload beacon.
          }
        } catch (err) {
          console.error('Error on socket disconnect cleanup:', err);
        }
      }, 5000);

      disconnectTimeouts.set(userId, timeoutId);
    });
  });
};
