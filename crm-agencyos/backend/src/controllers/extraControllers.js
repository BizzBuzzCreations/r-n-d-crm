const path    = require('path');
const User    = require('../models/User');
const { Message, Task, Todo, WorkLog, Channel, Project, Client } = require('../models/index');
const notifService = require('../services/notificationService');
const audit = require('../services/auditService');
const { getChannelAccess } = require('../utils/channelAccess');
const { isValidObjectId } = require('mongoose');

// ── Shared helper: create a private channel for a project ────────
// Called both from createProject (API route) and createClient (initial project)
async function createProjectChannel(project, createdBy, io) {
  const [admins, client] = await Promise.all([
    User.find({ role: 'admin' }, '_id').lean(),
    Client.findById(project.clientId, 'name').lean(),
  ]);

  const adminIds  = admins.map((u) => String(u._id));
  const teamIds   = (project.assignedTeam || []).map(String);

  // Include the client portal user if one exists
  const portalUser = await User.findOne({ clientId: project.clientId, role: 'client' }, '_id').lean();
  const memberSet  = new Set([...adminIds, ...teamIds]);
  if (portalUser) memberSet.add(String(portalUser._id));
  const members = Array.from(memberSet);

  // Build a URL-safe channel name: {client-slug}-{project-slug}
  const slug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const baseSlug  = `${slug(client?.name || 'client')}-${slug(project.name)}`;
  let channelName = baseSlug;
  let attempt     = 0;
  let channel     = null;

  while (!channel) {
    try {
      channel = await Channel.create({
        name:        channelName,
        description: `Project channel for ${project.name}`,
        isPrivate:   true,
        members,
        createdBy,
        clientId:    project.clientId,
        projectId:   project._id,
      });
    } catch (e) {
      if (e.code === 11000) { attempt++; channelName = `${baseSlug}-${attempt + 1}`; }
      else throw e;
    }
  }

  if (io && channel) {
    const populated = await channel.populate('members', 'name color initials position status role');
    // Notify members so their sidebar updates immediately
    members.forEach((uid) => io.to(`user:${uid}`).emit('channel:created', populated));
    // Make all active sockets for each member join the new room
    members.forEach((uid) => {
      const room = io.sockets.adapter.rooms.get(`user:${uid}`);
      if (room) {
        room.forEach((socketId) => {
          const sock = io.sockets.sockets.get(socketId);
          if (sock) sock.join(String(channel._id));
        });
      }
    });
  }

  return channel;
}
exports.createProjectChannel = createProjectChannel;

// ═══════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════
const getCanonicalThreadId = (threadId, reqUser) => {
  if (threadId && threadId.startsWith('dm-')) {
    const otherUserId = threadId.replace('dm-', '');
    const myId = String(reqUser._id || reqUser.id);
    const sorted = [myId, otherUserId].sort();
    return `dm-${sorted[0]}-${sorted[1]}`;
  }
  return threadId;
};

exports.getThreadMessages = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const canonicalId = getCanonicalThreadId(threadId, req.user);
    const access = await getChannelAccess(req.user, canonicalId);
    if (!access.allowed) return res.status(403).json({ success: false, message: 'You do not have access to this conversation.' });
    const messages = await Message.find({ threadId: canonicalId })
      .populate('userId', 'name color initials status')
      .populate('reactions.userId', 'name')
      .sort({ createdAt: 1 })
      .limit(200);
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const canonicalId = getCanonicalThreadId(threadId, req.user);
    const { text } = req.body;

    // Clients can only post in private channels where they are a member (enforced at socket + API layer)
    if (req.user.role === 'client') {
      if (!canonicalId.startsWith('dm-')) {
        const ch = await Channel.findById(canonicalId, 'clientId isPrivate members').lean();
        const isMember = ch?.members?.some((m) => String(m) === String(req.user._id));
        const isDedicated = ch?.clientId && String(ch.clientId) === String(req.user.clientId);
        if (!ch || !(isDedicated || (ch.isPrivate && isMember))) {
          return res.status(403).json({ success: false, message: 'You do not have access to this channel.' });
        }
      }
    }

    if (req.user.role !== 'client') {
      const access = await getChannelAccess(req.user, canonicalId);
      if (!access.allowed) return res.status(403).json({ success: false, message: 'You do not have access to this conversation.' });
    }

    // Handle file attachments
    const attachments = (req.files || []).map((f) => ({
      name:     f.originalname,
      size:     f.size,
      type:     f.mimetype,
      filename: f.filename,
      url:      `/uploads/${f.filename}`,
    }));

    if (!text?.trim() && attachments.length === 0) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    const msg = await Message.create({
      threadId: canonicalId,
      userId: req.user._id,
      text:   text?.trim() || '',
      attachments,
    });
    const populated = await msg.populate('userId', 'name color initials status');

    const io = req.app.get('io');
    io?.to(canonicalId).emit('message:new', populated);

    const myId = String(req.user._id);

    if (canonicalId.startsWith('dm-')) {
      // Notify DM recipient
      const [, id1, id2] = canonicalId.split('-');
      const recipientId = id1 === myId ? id2 : id1;
      notifService.dispatch(io, {
        recipient: recipientId,
        sender:    req.user._id,
        type:      'message_dm',
        title:     `New message from ${req.user.name}`,
        message:   msg.text || '📎 Sent an attachment',
        link:      '/messages',
        metadata:  { threadId: canonicalId, senderId: myId },
      });
    } else {
      // For client-dedicated private channels, notify all other members
      // so the client sees staff replies and staff see client messages
      try {
        const ch = await Channel.findById(canonicalId, 'clientId isPrivate members name').lean();
        if (ch?.clientId && ch.isPrivate && ch.members?.length) {
          for (const memberId of ch.members) {
            const mid = String(memberId);
            if (mid !== myId) {
              notifService.dispatch(io, {
                recipient: memberId,
                sender:    req.user._id,
                type:      'message_dm',
                title:     `New message in #${ch.name}`,
                message:   msg.text || '📎 Sent an attachment',
                link:      '/messages',
                metadata:  { threadId: canonicalId, senderId: myId },
              });
            }
          }
        }
      } catch { /* non-fatal — message was already sent */ }
    }

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found' });

    // Only owner or admin can delete
    if (String(msg.userId) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { threadId } = msg;
    msg.isDeleted = true;
    await msg.save();

    req.app.get('io')?.to(threadId).emit('message:deleted', { id: req.params.id, threadId });

    res.json({ success: true, message: 'Message deleted', data: msg });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════
exports.getReport = async (req, res, next) => {
  try {
    const { period = 'month', userId, from, to } = req.query;

    const now   = new Date();
    let dateFrom, dateTo;

    if (period === 'today') {
      dateFrom = new Date(now.toDateString());
      dateTo   = new Date(now.toDateString());
    } else if (period === 'week') {
      const day  = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      dateFrom   = new Date(now.setDate(diff));
      dateTo     = new Date(dateFrom); dateTo.setDate(dateFrom.getDate() + 6);
    } else if (period === 'month') {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      dateTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === 'custom' && from && to) {
      dateFrom = new Date(from);
      dateTo   = new Date(to);
    } else {
      dateFrom = new Date(0);
      dateTo   = new Date();
    }

    const taskFilter = {
      $or: [
        { createdAt: { $gte: dateFrom, $lte: dateTo } },
        { dueDate:   { $gte: from || '', $lte: to || '9999' } },
      ],
    };
    const todoFilter = { createdAt: { $gte: dateFrom, $lte: dateTo } };

    if (userId && req.user.role !== 'member') {
      taskFilter.assignedTo = userId;
      todoFilter.userId     = userId;
    } else if (req.user.role === 'member') {
      taskFilter.assignedTo = req.user._id;
      todoFilter.userId     = req.user._id;
    }

    const [tasks, todos] = await Promise.all([
      Task.find(taskFilter).populate('assignedTo', 'name color'),
      Todo.find(todoFilter).populate('userId', 'name color'),
    ]);

    res.json({
      success: true,
      data: {
        tasks,
        todos,
        period: { from: dateFrom, to: dateTo, label: period },
        summary: {
          totalTasks:     tasks.length,
          completedTasks: tasks.filter((t) => t.status === 'completed').length,
          totalTodos:     todos.length,
          completedTodos: todos.filter((t) => t.status === 'completed').length,
        },
      },
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// WORK LOG
// ═══════════════════════════════════════════════════
exports.getWorkLog = async (req, res, next) => {
  try {
    let filter = {};
    if (req.user.role === 'member') filter.userId = req.user._id;
    if (req.query.userId && req.user.role !== 'member') filter.userId = req.query.userId;
    if (req.query.date) filter.date = req.query.date;

    const logs = await WorkLog.find(filter)
      .populate('userId', 'name color initials status role')
      .sort({ date: -1 })
      .limit(100);
    res.json({ success: true, data: logs });
  } catch (err) { next(err); }
};

exports.upsertWorkLog = async (req, res, next) => {
  try {
    const { date, workSeconds, sessionStart, breaks, active, breakActive, targetSeconds } = req.body;
    const log = await WorkLog.findOneAndUpdate(
      { userId: req.user._id, date },
      { userId: req.user._id, date, workSeconds, sessionStart, breaks, active, breakActive, targetSeconds },
      { upsert: true, new: true, runValidators: true }
    ).populate('userId', 'name color initials status');
    res.json({ success: true, data: log });
  } catch (err) { next(err); }
};

exports.setUserActive = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    await WorkLog.findOneAndUpdate(
      { userId: req.user._id, date: today },
      { active: req.body.active },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.adminUpdateWorkLog = async (req, res, next) => {
  try {
    const { workSeconds, targetSeconds } = req.body;
    const update = {};
    if (workSeconds !== undefined) {
      if (typeof workSeconds !== 'number' || !Number.isFinite(workSeconds) || workSeconds < 0) {
        return res.status(400).json({ success: false, message: 'workSeconds must be a non-negative number' });
      }
      update.workSeconds = workSeconds;
    }
    if (targetSeconds !== undefined) {
      if (typeof targetSeconds !== 'number' || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
        return res.status(400).json({ success: false, message: 'targetSeconds must be a positive number' });
      }
      update.targetSeconds = targetSeconds;
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const log = await WorkLog.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate('userId', 'name color initials status role');
    if (!log) return res.status(404).json({ success: false, message: 'Work log entry not found' });

    audit.log(req, {
      action: 'update', category: 'worklog',
      targetId: log._id, targetModel: 'WorkLog',
      targetTitle: `${log.userId?.name || 'Unknown'} — ${log.date}`,
      metadata: update,
    });

    res.json({ success: true, data: log });
  } catch (err) { next(err); }
};

exports.deleteWorkLog = async (req, res, next) => {
  try {
    const log = await WorkLog.findById(req.params.id).populate('userId', 'name');
    if (!log) return res.status(404).json({ success: false, message: 'Work log entry not found' });

    await log.deleteOne();

    audit.log(req, {
      action: 'delete', category: 'worklog',
      targetId: log._id, targetModel: 'WorkLog',
      targetTitle: `${log.userId?.name || 'Unknown'} — ${log.date}`,
    });

    res.json({ success: true, message: 'Work log entry deleted' });
  } catch (err) { next(err); }
};

exports.bulkDeleteWorkLogs = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, message: 'Payload must contain a non-empty ids array' });
    }

    const logs = await WorkLog.find({ _id: { $in: ids } }).populate('userId', 'name');
    if (!logs.length) return res.status(404).json({ success: false, message: 'No matching work log entries found' });

    await WorkLog.deleteMany({ _id: { $in: ids } });

    audit.log(req, {
      action: 'delete', category: 'worklog',
      targetModel: 'WorkLog',
      targetTitle: `${logs.length} work log ${logs.length === 1 ? 'entry' : 'entries'}`,
      metadata: { bulk: true, entries: logs.map((l) => `${l.userId?.name || 'Unknown'} — ${l.date}`) },
    });

    res.json({ success: true, message: `${logs.length} work log ${logs.length === 1 ? 'entry' : 'entries'} deleted`, deletedCount: logs.length });
  } catch (err) { next(err); }
};

exports.toggleReaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { emoji = '👍' } = req.body;
    const myId = req.user._id;

    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found' });

    const access = await getChannelAccess(req.user, msg.threadId);
    if (!access.allowed) return res.status(403).json({ success: false, message: 'You do not have access to this conversation.' });

    if (!msg.reactions) msg.reactions = [];
    const existingIdx = msg.reactions.findIndex((r) => String(r.userId) === String(myId) && r.emoji === emoji);
    if (existingIdx >= 0) {
      msg.reactions.splice(existingIdx, 1);
    } else {
      msg.reactions.push({ userId: myId, emoji });
    }
    await msg.save();

    const populated = await Message.findById(id)
      .populate('userId', 'name color initials status')
      .populate('reactions.userId', 'name');

    req.app.get('io')?.to(msg.threadId).emit('message:updated', populated);

    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// CHANNELS
// ═══════════════════════════════════════════════════
exports.getChannels = async (req, res, next) => {
  try {
    let filter = { isDeleted: { $ne: true } };

    if (req.user.role === 'client') {
      // Clients see: their dedicated channel (clientId match) OR any private channel they're a member of
      filter = {
        isDeleted: { $ne: true },
        $or: [
          { clientId: req.user.clientId },
          { isPrivate: true, members: req.user._id },
        ],
      };
    } else if (req.user.role !== 'admin') {
      filter = {
        isDeleted: { $ne: true },
        $or: [
          { isPrivate: false },
          { isPrivate: true, members: req.user._id },
        ],
      };
    }

    const channels = await Channel.find(filter)
      .populate('members', 'name color initials position status role')
      .sort({ name: 1 });
    res.json({ success: true, data: channels });
  } catch (err) { next(err); }
};

exports.createChannel = async (req, res, next) => {
  try {
    if (req.user.role === 'client') {
      return res.status(403).json({ success: false, message: 'Clients cannot create groups' });
    }
    const isAdmin = req.user.role === 'admin';
    const { name, description, members } = req.body;
    // Admins can create public channels or private groups; everyone else creates private group chats only.
    const isPrivate = isAdmin ? req.body.isPrivate : true;
    if (!isAdmin && String(name || '').trim().toLowerCase() === 'general') {
      return res.status(400).json({ success: false, message: 'That name is reserved' });
    }
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Channel name is required' });
    }
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    
    // Process members if private
    let groupMembers = [];
    if (isPrivate) {
      let parsedMembers = Array.isArray(members) ? members : [];
      if (!isAdmin) {
        // Non-admin creators can only add real, non-client staff accounts
        const wanted = parsedMembers.map(String).filter((id) => isValidObjectId(id));
        parsedMembers = (await User.find({ _id: { $in: wanted }, role: { $ne: 'client' } }, '_id').lean()).map((u) => String(u._id));
      }
      // Ensure creator is always in the private group
      const creatorIdStr = String(req.user._id);
      if (!parsedMembers.includes(creatorIdStr)) {
        parsedMembers.push(creatorIdStr);
      }
      groupMembers = parsedMembers;
    }

    const channel = await Channel.create({
      name: cleanName,
      description: description?.trim() || '',
      isPrivate: !!isPrivate,
      members: groupMembers,
      createdBy: req.user._id,
    });

    const populated = await channel.populate('members', 'name color initials position status role');

    const io = req.app.get('io');
    if (populated.isPrivate) {
      // Emit socket event to members of the private group only
      populated.members.forEach((m) => {
        io?.to(`user:${String(m._id || m)}`).emit('channel:created', populated);
      });
      // Also emit to active Admins who are not explicitly listed in members
      // (Admins have access to see and join everything)
      io?.to('admin').emit('channel:created', populated);
    } else {
      io?.emit('channel:created', populated);
    }

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Channel name already exists' });
    }
    next(err);
  }
};

exports.updateChannel = async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { name, description, members } = req.body;
    // A creator can't turn their private group public — only admins choose that.
    const isPrivate = isAdmin ? req.body.isPrivate : true;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Channel name is required' });
    }
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    
    // Get existing channel to know prior member list
    const existing = await Channel.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    if (!isAdmin && !(existing.isPrivate && String(existing.createdBy) === String(req.user._id))) {
      return res.status(403).json({ success: false, message: 'Only the group creator or an admin can edit this group' });
    }

    // Process members if private
    let groupMembers = [];
    if (isPrivate) {
      let parsedMembers = Array.isArray(members) ? members : [];
      if (!isAdmin) {
        const wanted = parsedMembers.map(String).filter((id) => isValidObjectId(id));
        parsedMembers = (await User.find({ _id: { $in: wanted }, role: { $ne: 'client' } }, '_id').lean()).map((u) => String(u._id));
      }
      const creatorIdStr = String(existing.createdBy || req.user._id);
      if (!parsedMembers.includes(creatorIdStr)) {
        parsedMembers.push(creatorIdStr);
      }
      groupMembers = parsedMembers;
    }

    const channel = await Channel.findByIdAndUpdate(
      req.params.id,
      { 
        name: cleanName, 
        description: description?.trim() || '',
        isPrivate: !!isPrivate,
        members: groupMembers,
      },
      { new: true, runValidators: true }
    ).populate('members', 'name color initials position status role');

    const io = req.app.get('io');
    
    // Clean up visibility sync on update:
    // Some users might have been removed, some added.
    // For simplicity and complete reactive reliability, we can broadcast:
    // - channel:deleted to the old member list (to cleanly wipe it from their client view if removed)
    // - channel:created or channel:updated to the new list
    const oldMembers = (existing.members || []).map(m => String(m));
    const newMembers = (channel.members || []).map(m => String(m._id || m));

    const allInvolved = Array.from(new Set([...oldMembers, ...newMembers]));

    allInvolved.forEach((userId) => {
      const hadAccess = !existing.isPrivate || oldMembers.includes(userId);
      const hasAccess = !channel.isPrivate || newMembers.includes(userId);

      if (hadAccess && !hasAccess) {
        // User was removed
        io?.to(`user:${userId}`).emit('channel:deleted', channel._id);
        io?.in(`user:${userId}`).socketsLeave(String(channel._id));
      } else if (!hadAccess && hasAccess) {
        // User was added
        io?.to(`user:${userId}`).emit('channel:created', channel);
      } else if (hasAccess) {
        // User kept access
        io?.to(`user:${userId}`).emit('channel:updated', channel);
      }
    });

    // Also notify active admins who are not in group
    io?.to('admin').emit('channel:updated', channel);

    res.json({ success: true, data: channel });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Channel name already exists' });
    }
    next(err);
  }
};

exports.deleteChannel = async (req, res, next) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (req.user.role !== 'admin' && !(channel.isPrivate && String(channel.createdBy) === String(req.user._id))) {
      return res.status(403).json({ success: false, message: 'Only the group creator or an admin can delete this group' });
    }

    if (channel.name === 'general') {
      return res.status(400).json({ success: false, message: 'Cannot delete the general channel' });
    }

    // Dynamic Production-grade Soft delete backup
    channel.isDeleted = true;
    await channel.save();
    
    // Soft delete all messages inside this channel's thread ID
    await Message.updateMany({ threadId: req.params.id }, { isDeleted: true });

    const io = req.app.get('io');
    if (channel.isPrivate) {
      const members = (channel.members || []).map(m => String(m));
      members.forEach((mId) => {
        io?.to(`user:${mId}`).emit('channel:deleted', req.params.id);
      });
      io?.to('admin').emit('channel:deleted', req.params.id);
    } else {
      io?.emit('channel:deleted', req.params.id);
    }

    res.json({ success: true, message: 'Channel deleted successfully' });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════
exports.getProjects = async (req, res, next) => {
  try {
    const filter = req.user.role === 'client' ? { clientId: req.user.clientId } : {};
    const projects = await Project.find(filter)
      .populate('clientId', 'name')
      .populate('assignedTeam', 'name email color initials status position');
    res.json({ success: true, data: projects });
  } catch (err) { next(err); }
};

exports.createProject = async (req, res, next) => {
  try {
    const project = await Project.create({ ...req.body, createdBy: req.user._id });

    // Increment project count for Client
    await Client.findByIdAndUpdate(project.clientId, { $inc: { projectCount: 1 } });

    // Auto-create a private channel for this project
    if (project.clientId) {
      try {
        await createProjectChannel(project, req.user._id, req.app.get('io'));
      } catch (chanErr) {
        console.warn('[createProject] Failed to create project channel:', chanErr.message);
      }
    }

    const populated = await Project.findById(project._id)
      .populate('clientId', 'name')
      .populate('assignedTeam', 'name email color initials status position');
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.updateProject = async (req, res, next) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('clientId', 'name')
      .populate('assignedTeam', 'name email color initials status position');
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, data: project });
  } catch (err) { next(err); }
};

exports.deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // Decrement project count for Client
    await Client.findByIdAndUpdate(project.clientId, { $inc: { projectCount: -1 } });

    // Delete the project's dedicated channel and its messages
    const projectChannel = await Channel.findOne({ projectId: project._id }).lean();
    if (projectChannel) {
      await Message.deleteMany({ threadId: String(projectChannel._id) });
      await Channel.deleteOne({ _id: projectChannel._id });
      const io = req.app.get('io');
      io?.emit('channel:deleted', String(projectChannel._id));
    }

    res.json({ success: true, message: 'Project deleted' });
  } catch (err) { next(err); }
};

