const crypto          = require('crypto');
const User            = require('../models/User');
const { Client, Task, Todo, Meeting, Project, Channel, Message, Notification } = require('../models/index');
const { Invoice }     = require('../models/Invoice');
const notifService    = require('../services/notificationService');
const audit           = require('../services/auditService');
const emailService    = require('../services/emailService');
const { syncTodoToSheet, deleteTodoFromSheet } = require('../utils/assignmentSheetSync');

// Generate a random readable password: 12 chars, alphanumeric
function generatePassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
    || Math.random().toString(36).slice(2, 14);
}

// ═══════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════
exports.getUsers = async (req, res, next) => {
  try {
    // Portal logins must never get the full staff directory (every name,
    // email, phone and emailSync config in the company). This route carries
    // no feature gate — only `protect` — so a client could simply call it.
    // The portal's own, properly scoped equivalent is GET /api/portal/contacts
    // (admins + the team actually assigned to that client), which is what the
    // portal UI already uses, so nothing legitimate reads this as a client.
    if (req.user.role === 'client') {
      return res.status(403).json({ success: false, message: 'Use /api/portal/contacts' });
    }
    const users = await User.find().sort({ createdAt: 1 });
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
};

// Fields a privileged caller may set when creating/updating a staff account.
// Everything else on the schema (clientId, notificationPrefs, status, ...) is
// either self-service or set by other flows, and passing req.body straight
// into User.create() let any of it be written from the Team page's request.
const USER_WRITABLE = ['name', 'email', 'password', 'role', 'position', 'department',
  'phone', 'color', 'joinDate', 'bio', 'campaignsAccess', 'assignmentSheetTab'];

const pickWritable = (body, allowed) => allowed.reduce((acc, k) => {
  if (body[k] !== undefined) acc[k] = body[k];
  return acc;
}, {});

exports.createUser = async (req, res, next) => {
  try {
    const payload = pickWritable(req.body, USER_WRITABLE);

    // Only an admin may create another admin. The route allows admin+manager,
    // so without this a manager could mint a full admin account for
    // themselves and escalate privileges outright.
    if (payload.role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can create an admin account' });
    }
    // Portal logins are provisioned by the client-creation flow (which links
    // them to a Client via clientId); minting a bare 'client' user here would
    // produce an account with portal access and no client to scope it to.
    if (payload.role === 'client') {
      return res.status(400).json({ success: false, message: 'Client portal logins are created from the client record' });
    }

    const user = await User.create(payload);
    audit.log(req, {
      action: 'create', category: 'user',
      targetId: user._id, targetModel: 'User',
      targetTitle: user.name, metadata: { role: user.role, email: user.email },
    });
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { password } = req.body;
    const rest = pickWritable(req.body, USER_WRITABLE.filter((k) => k !== 'password'));

    // An admin account may only be modified by an admin. Role changes were
    // already admin-only below, but `password` was still accepted from any
    // caller the route allows — so a manager could set a new password on an
    // admin account and simply log in as them, bypassing the role guard
    // entirely. Deleting an admin was open the same way (see deleteUser).
    const target = await User.findById(req.params.id).select('role name').lean();
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'admin' && req.user.role !== 'admin' && String(req.user._id) !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Only an admin can modify an admin account' });
    }

    // Only admin can change roles (managers cannot promote/demote)
    if (rest.role && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can change user roles' });
    }

    // Admin cannot demote themselves
    if (rest.role && String(req.user._id) === req.params.id && rest.role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot change your own role' });
    }

    // Recalculate initials if name changed
    if (rest.name) {
      rest.initials = rest.name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
    }

    const user = await User.findByIdAndUpdate(req.params.id, rest, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // If password provided, update it separately (triggers pre-save hash)
    if (password && password.length >= 6) {
      const userWithPwd = await User.findById(req.params.id).select('+password');
      userWithPwd.password = password;
      await userWithPwd.save();
    }

    // Broadcast update to all connected clients for real-time sync
    const io = req.app.get('io');
    io?.emit('user:updated', user);

    // If role changed, notify the affected user so their session picks up the new role
    if (rest.role) {
      io?.to(`user:${req.params.id}`).emit('role:changed', { role: rest.role });
    }

    audit.log(req, {
      action: rest.role ? 'update' : 'update', category: 'user',
      targetId: user._id, targetModel: 'User', targetTitle: user.name,
      metadata: rest.role ? { roleChanged: true, newRole: rest.role } : undefined,
    });

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    if (String(req.user._id) === req.params.id)
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    const target = await User.findById(req.params.id).lean();
    // Same boundary as updateUser: a manager must not be able to remove an
    // admin (nor delete the account and recreate it under their own control).
    if (target?.role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can delete an admin account' });
    }
    await User.findByIdAndDelete(req.params.id);
    audit.log(req, {
      action: 'delete', category: 'user',
      targetId: req.params.id, targetModel: 'User',
      targetTitle: target?.name ?? req.params.id,
    });
    res.json({ success: true, message: 'User removed' });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════
// A portal login may only ever see its own company record — without this it
// received the entire client book (every other client's contacts, internal
// notes, credit limit and billing notes). Portal reads have their own scoped
// endpoints under /api/portal; this is the backstop for the shared route.
const clientScope = (req) => (req.user.role === 'client'
  ? { _id: req.user.clientId, isDeleted: { $ne: true } }
  : { isDeleted: { $ne: true } });

exports.getClients = async (req, res, next) => {
  try {
    const clients = await Client.find(clientScope(req))
      .populate('assignedTeam', 'name email color initials status position')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: clients });
  } catch (err) { next(err); }
};

exports.getClient = async (req, res, next) => {
  try {
    if (req.user.role === 'client' && String(req.user.clientId) !== String(req.params.id)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this client' });
    }
    const client = await Client.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('assignedTeam', 'name email color initials status position');
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
};

exports.createClient = async (req, res, next) => {
  try {
    const {
      projectName,
      projectDesc,
      projectAssignedTeam,
      projectEndDate,
      projectBudget,
      ...clientData
    } = req.body;

    const client = await Client.create({ ...clientData, createdBy: req.user._id });

    // Create associated project if name is provided
    let initialProject = null;
    if (projectName) {
      initialProject = await Project.create({
        name: projectName,
        description: projectDesc || '',
        clientId: client._id,
        assignedTeam: projectAssignedTeam || [],
        endDate: projectEndDate || '',
        budget: projectBudget || client.budget || '',
        status: 'pending',
        createdBy: req.user._id,
      });
      client.projectCount = 1;
      await client.save();
    }

    // Auto-create a portal login for the client contact if they have an email
    let portalCreated = false;
    let portalEmail   = false;
    const contactEmail = (clientData.email || '').trim().toLowerCase();

    if (contactEmail) {
      const existing = await User.findOne({ email: contactEmail }).lean();
      if (!existing) {
        const password = generatePassword();
        await User.create({
          name:       clientData.contact || client.name,
          email:      contactEmail,
          password,
          role:       'client',
          clientId:   client._id,
          position:   'Client',
          department: 'External',
          color:      '#10B981',
          status:     'offline',
        });

        const loginUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        portalEmail = await emailService.sendClientWelcome({
          to:          contactEmail,
          clientName:  client.name,
          contactName: clientData.contact || client.name,
          password,
          loginUrl,
        });
        portalCreated = true;
      }
    }

    // ── Create dedicated private channel for this client ─────────────
    let clientChannel = null;
    try {
      // Collect member IDs: all admins + assigned team + client portal user (if created)
      const admins  = await User.find({ role: 'admin' }, '_id').lean();
      const adminIds = admins.map((u) => String(u._id));

      const teamIds = (clientData.assignedTeam || []).map(String);

      const memberSet = new Set([...adminIds, ...teamIds]);

      // Find the portal user we just created (or an existing one)
      if (contactEmail) {
        const portalUser = await User.findOne({ email: contactEmail, role: 'client' }, '_id').lean();
        if (portalUser) memberSet.add(String(portalUser._id));
      }

      const members = Array.from(memberSet);

      // Build a unique slug for the channel name
      const baseSlug = `client-${client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      let channelName = baseSlug;
      let attempt = 0;
      while (!clientChannel) {
        try {
          clientChannel = await Channel.create({
            name:        channelName,
            description: `Client channel for ${client.name}`,
            isPrivate:   true,
            members,
            createdBy:   req.user._id,
            clientId:    client._id,
          });
        } catch (e) {
          if (e.code === 11000) {
            attempt++;
            channelName = `${baseSlug}-${attempt + 1}`;
          } else { throw e; }
        }
      }

      // Notify all channel members via socket so their UI picks it up immediately
      const io = req.app.get('io');
      if (io && clientChannel) {
        const populated2 = await clientChannel.populate('members', 'name color initials position status role');
        members.forEach((uid) => io.to(`user:${uid}`).emit('channel:created', populated2));
      }
    } catch (chanErr) {
      console.warn('[createClient] Failed to create client channel:', chanErr.message);
    }

    // Create a dedicated project channel for the initial project (after portal user exists)
    if (initialProject) {
      try {
        const { createProjectChannel } = require('./extraControllers');
        await createProjectChannel(initialProject, req.user._id, req.app.get('io'));
      } catch (projChanErr) {
        console.warn('[createClient] Failed to create project channel:', projChanErr.message);
      }
    }

    // Auto-create a draft invoice if the client has a parseable budget
    let autoInvoice = false;
    try {
      const budgetStr = String(clientData.budget || '');
      const budgetNum = parseFloat(budgetStr.replace(/[^0-9.]/g, ''));
      if (budgetNum > 0) {
        const issueDate = new Date().toISOString().split('T')[0];
        const due       = new Date();
        due.setDate(due.getDate() + 30);
        const dueDate   = due.toISOString().split('T')[0];
        const desc      = (clientData.services || []).length
          ? (clientData.services).join(', ')
          : 'Professional Services';
        await Invoice.create({
          clientId:    client._id,
          title:       `${client.name} — Retainer Invoice`,
          lineItems:   [{ description: desc, quantity: 1, rate: budgetNum, amount: budgetNum }],
          subtotal:    budgetNum,
          taxRate:     0,
          taxAmount:   0,
          discount:    0,
          total:       budgetNum,
          balanceDue:  budgetNum,
          paidAmount:  0,
          issueDate,
          dueDate,
          currency:    'INR',
          status:      'draft',
          terms:       'Payment due within 30 days.',
          createdBy:   req.user._id,
        });
        autoInvoice = true;
      }
    } catch (invErr) {
      console.warn('[createClient] Auto-invoice skipped:', invErr.message);
    }

    const populated = await client.populate('assignedTeam', 'name email color initials status position');
    audit.log(req, {
      action: 'create', category: 'client',
      targetId: client._id, targetModel: 'Client', targetTitle: client.name,
      metadata: { portalCreated, portalEmailSent: portalEmail, channelCreated: !!clientChannel, autoInvoice },
    });

    res.status(201).json({
      success: true,
      data: populated,
      portalCreated,
      portalEmailSent: portalEmail,
      channelCreated: !!clientChannel,
    });
  } catch (err) { next(err); }
};

// POST /api/clients/:id/reset-portal-password  (admin only)
// Generates or accepts a new password for the client's portal User account
exports.resetPortalPassword = async (req, res, next) => {
  try {
    const clientRecord = await Client.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!clientRecord) return res.status(404).json({ success: false, message: 'Client not found' });
    const portalUser = await User.findOne({ clientId: req.params.id, role: 'client' }).select('+password');
    if (!portalUser) {
      return res.status(404).json({ success: false, message: 'No portal account found for this client. Create the client account first.' });
    }

    const newPassword = (req.body.password || '').trim() || generatePassword();
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    portalUser.password = newPassword;
    await portalUser.save();

    // Email the new credentials
    const client = await Client.findById(req.params.id, 'name contact').lean();
    const loginUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const emailSent = await emailService.sendClientWelcome({
      to:          portalUser.email,
      clientName:  client?.name  || portalUser.name,
      contactName: client?.contact || portalUser.name,
      password:    newPassword,
      loginUrl,
    });

    audit.log(req, {
      action: 'update', category: 'client',
      targetId: req.params.id, targetModel: 'Client',
      targetTitle: client?.name ?? req.params.id,
      metadata: { action: 'portal_password_reset', emailSent },
    });

    res.json({
      success: true,
      message: 'Portal password reset successfully',
      email:       portalUser.email,
      newPassword,        // always return so admin can share it if email fails
      emailSent,
    });
  } catch (err) { next(err); }
};

exports.updateClient = async (req, res, next) => {
  try {
    const existing = await Client.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('assignedTeam', 'name email color initials status position');
    audit.log(req, {
      action: 'update', category: 'client',
      targetId: client._id, targetModel: 'Client', targetTitle: client.name,
    });
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
};

exports.deleteClient = async (req, res, next) => {
  try {
    const clientId = req.params.id;
    const target = await Client.findOne({ _id: clientId, isDeleted: { $ne: true } }).lean();
    if (!target) return res.status(404).json({ success: false, message: 'Client not found' });

    // Soft-delete the client record — all associated data is preserved in the DB
    await Client.findByIdAndUpdate(clientId, { isDeleted: true, deletedAt: new Date() });

    audit.log(req, {
      action: 'delete', category: 'client',
      targetId: clientId, targetModel: 'Client',
      targetTitle: target.name,
      metadata: { softDelete: true },
    });

    // Notify all connected staff to remove this client from their local state
    const io = req.app.get('io');
    io?.emit('client:deleted', clientId);

    res.json({ success: true, message: `Client "${target.name}" has been removed` });
  } catch (err) { next(err); }
};

exports.addClientNote = async (req, res, next) => {
  try {
    const existing = await Client.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });
    const { text } = req.body;
    const note = {
      text,
      author: req.user.name,
      date:   new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { $push: { notes: note } },
      { new: true }
    ).populate('assignedTeam', 'name email color initials status position');
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════
const taskPopulate = [
  { path: 'assignedTo', select: 'name email color initials status' },
  { path: 'assignedBy', select: 'name' },
  { path: 'clientId',   select: 'name' },
  { path: 'projectId',  select: 'name' },
];

exports.getTasks = async (req, res, next) => {
  try {
    let filter = {};
    if (req.user.role === 'member') filter.assignedTo = req.user._id;
    if (req.user.role === 'client') filter.clientId   = req.user.clientId;

    // Date-range filtering: include tasks that overlap [startDate, endDate]
    const { startDate, endDate } = req.query;
    if (startDate || endDate) {
      const orClauses = [];
      if (startDate && endDate) {
        // overlap: task.startDate <= endDate AND task.dueDate >= startDate
        orClauses.push({ startDate: { $lte: endDate }, dueDate: { $gte: startDate } });
        // tasks that only have one of the two dates inside the window
        orClauses.push({ startDate: { $gte: startDate, $lte: endDate } });
        orClauses.push({ dueDate:   { $gte: startDate, $lte: endDate } });
        // tasks with no dates but created inside the window
        orClauses.push({
          startDate: { $in: [null, ''] },
          createdAt: { $gte: new Date(startDate), $lte: new Date(endDate + 'T23:59:59.999Z') },
        });
      } else if (startDate) {
        orClauses.push({ dueDate:   { $gte: startDate } });
        orClauses.push({ startDate: { $gte: startDate } });
        orClauses.push({ createdAt: { $gte: new Date(startDate) } });
      } else {
        orClauses.push({ startDate: { $lte: endDate } });
        orClauses.push({ dueDate:   { $lte: endDate } });
        orClauses.push({ createdAt: { $lte: new Date(endDate + 'T23:59:59.999Z') } });
      }
      filter.$or = orClauses;
    }

    filter.isDeleted = { $ne: true };
    const tasks = await Task.find(filter).populate(taskPopulate).sort({ createdAt: -1 });
    res.json({ success: true, data: tasks });
  } catch (err) { next(err); }
};

exports.createTask = async (req, res, next) => {
  try {
    const body = { ...req.body };
    if (body.clientId === '')  body.clientId = null;
    if (body.projectId === '') body.projectId = null;

    // Tags may arrive as JSON string or repeated form fields (tags[])
    if (typeof body.tags === 'string') {
      try { body.tags = JSON.parse(body.tags); } catch { body.tags = body.tags ? [body.tags] : []; }
    }
    if (!Array.isArray(body.tags)) body.tags = [];

    // File attachments (uploaded via multer)
    const fileAttachments = (req.files || []).map((f) => ({
      type:     'file',
      name:     f.originalname,
      url:      `/uploads/${f.filename}`,
      size:     f.size,
      mimeType: f.mimetype,
      filename: f.filename,
    }));

    // Link attachments (sent as JSON string in body.links)
    let linkAttachments = [];
    if (body.links) {
      try { linkAttachments = JSON.parse(body.links).map((l) => ({ type: 'link', name: l.name || l.url, url: l.url })); } catch {}
      delete body.links;
    }

    const task = await Task.create({
      ...body,
      assignedBy:  req.user._id,
      attachments: [...fileAttachments, ...linkAttachments],
    });
    const populated = await task.populate(taskPopulate);
    const io = req.app.get('io');
    io?.emit('task:created', populated);

    audit.log(req, {
      action: 'create', category: 'task',
      targetId: task._id, targetModel: 'Task',
      targetTitle: task.title, targetRef: `#${task.taskNumber || ''}`,
      metadata: { priority: task.priority, status: task.status, assignedTo: String(task.assignedTo ?? '') },
    });

    const assignedToId = String(task.assignedTo?._id ?? task.assignedTo);
    if (assignedToId !== String(req.user._id)) {
      notifService.dispatch(io, {
        recipient: task.assignedTo?._id ?? task.assignedTo,
        sender:    req.user._id,
        type:      'task_assigned',
        title:     'New task assigned',
        message:   `${req.user.name} assigned you: "${task.title}"`,
        link:      '/tasks',
        metadata:  { taskId: String(task._id) },
      });
    }

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.updateTask = async (req, res, next) => {
  try {
    const prev = await Task.findById(req.params.id).lean();
    // Every branch below reads prev.* — without this an unknown/deleted id
    // threw a TypeError and surfaced as a 500 instead of a clean 404.
    if (!prev) return res.status(404).json({ success: false, message: 'Task not found' });
    const body = { ...req.body };

    // Update assignedBy if task is reassigned to someone else
    if (body.assignedTo && String(body.assignedTo) !== String(prev.assignedTo)) {
      body.assignedBy = req.user._id;
    }

    if (body.clientId === '')  body.clientId = null;
    if (body.projectId === '') body.projectId = null;

    // Parse tags
    if (typeof body.tags === 'string') {
      try { body.tags = JSON.parse(body.tags); } catch { body.tags = body.tags ? [body.tags] : []; }
    }
    if (body['tags[]']) {
      body.tags = Array.isArray(body['tags[]']) ? body['tags[]'] : [body['tags[]']];
      delete body['tags[]'];
    }

    // Merge attachments: existing + new files + new links
    if (req.files?.length || body.links || body.existingAttachments !== undefined) {
      const existing = body.existingAttachments
        ? JSON.parse(body.existingAttachments)
        : (prev?.attachments || []);
      delete body.existingAttachments;

      const newFiles = (req.files || []).map((f) => ({
        type: 'file', name: f.originalname, url: `/uploads/${f.filename}`,
        size: f.size, mimeType: f.mimetype, filename: f.filename,
      }));

      let newLinks = [];
      if (body.links) {
        try { newLinks = JSON.parse(body.links).map((l) => ({ type: 'link', name: l.name || l.url, url: l.url })); } catch {}
        delete body.links;
      }

      body.attachments = [...existing, ...newFiles, ...newLinks];
    }

    const task = await Task.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true })
      .populate(taskPopulate);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const io = req.app.get('io');
    io?.emit('task:updated', task);

    // Determine the most specific action for the audit log
    const taskAction = (() => {
      if (body.status === 'completed' && prev.status !== 'completed') return 'approve';
      if (body.status === 'sent-for-approval' && prev.status !== 'sent-for-approval') return 'submit_approval';
      if (body.status && body.status !== prev.status) return 'status_change';
      if (body.assignedTo && String(body.assignedTo) !== String(prev.assignedTo)) return 'assign';
      return 'update';
    })();

    audit.log(req, {
      action: taskAction, category: 'task',
      targetId: task._id, targetModel: 'Task',
      targetTitle: task.title, targetRef: `#${task.taskNumber || ''}`,
      metadata: {
        ...(body.status && body.status !== prev.status ? { statusFrom: prev.status, statusTo: body.status } : {}),
        ...(body.assignedTo && String(body.assignedTo) !== String(prev.assignedTo) ? { reassigned: true } : {}),
      },
    });

    // Member marked task ready for approval → notify assigner
    if (req.body.readyForApproval && !prev.readyForApproval && task.assignedBy) {
      notifService.dispatch(io, {
        recipient: task.assignedBy?._id ?? task.assignedBy,
        sender:    req.user._id,
        type:      'task_ready_approval',
        title:     'Task ready for review',
        message:   `${req.user.name} marked "${task.title}" ready for approval`,
        link:      '/tasks',
        metadata:  { taskId: String(task._id) },
      });
    }

    // Manager approved (status → completed) → notify assignee
    if (req.body.status === 'completed' && prev.status !== 'completed') {
      const recipientId = String(task.assignedTo?._id || task.assignedTo);
      if (recipientId !== String(req.user._id)) {
        notifService.dispatch(io, {
          recipient: task.assignedTo?._id || task.assignedTo,
          sender:    req.user._id,
          type:      'task_approved',
          title:     'Task approved!',
          message:   `"${task.title}" has been approved and marked complete`,
          link:      '/tasks',
          metadata:  { taskId: String(task._id) },
        });
      }
    }

    res.json({ success: true, data: task });
  } catch (err) { next(err); }
};

exports.deleteTask = async (req, res, next) => {
  try {
    const target = await Task.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: false }).lean();
    if (!target) return res.status(404).json({ success: false, message: 'Task not found' });
    req.app.get('io')?.emit('task:deleted', req.params.id);
    audit.log(req, {
      action: 'delete', category: 'task',
      targetId: req.params.id, targetModel: 'Task',
      targetTitle: target?.title ?? req.params.id,
      targetRef: target?.taskNumber ? `#${target.taskNumber}` : '',
    });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// TODOS
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// TODOS
// ═══════════════════════════════════════════════════
const todoPopulate = [
  { path: 'userId',   select: 'name email color initials status' },
  { path: 'assignedBy', select: 'name' },
  { path: 'clientId', select: 'name' },
  { path: 'taskId',   select: 'title taskNumber' }
];

exports.getTodos = async (req, res, next) => {
  try {
    let filter = {};
    if (req.user.role === 'member') filter.userId   = req.user._id;
    if (req.user.role === 'client') filter.clientId = req.user.clientId;

    // Date-range filtering: include todos that overlap [startDate, endDate]
    const { startDate, endDate } = req.query;
    if (startDate || endDate) {
      const orClauses = [];
      if (startDate && endDate) {
        orClauses.push({ startDate: { $lte: endDate }, dueDate: { $gte: startDate } });
        orClauses.push({ startDate: { $gte: startDate, $lte: endDate } });
        orClauses.push({ dueDate:   { $gte: startDate, $lte: endDate } });
        orClauses.push({
          startDate: { $in: [null, ''] },
          createdAt: { $gte: new Date(startDate), $lte: new Date(endDate + 'T23:59:59.999Z') },
        });
      } else if (startDate) {
        orClauses.push({ dueDate:   { $gte: startDate } });
        orClauses.push({ startDate: { $gte: startDate } });
        orClauses.push({ createdAt: { $gte: new Date(startDate) } });
      } else {
        orClauses.push({ startDate: { $lte: endDate } });
        orClauses.push({ dueDate:   { $lte: endDate } });
        orClauses.push({ createdAt: { $lte: new Date(endDate + 'T23:59:59.999Z') } });
      }
      filter.$or = orClauses;
    }

    filter.isDeleted = { $ne: true };
    const todos = await Todo.find(filter)
      .populate(todoPopulate)
      .sort({ createdAt: -1 });
    res.json({ success: true, data: todos });
  } catch (err) { next(err); }
};

exports.createTodo = async (req, res, next) => {
  try {
    const body = { ...req.body };
    if (body.clientId === '') body.clientId = null;
    if (body.taskId === '')   body.taskId   = null;

    // Standard members can only self-assign
    if (req.user.role === 'member') {
      body.userId = req.user._id;
    } else {
      body.userId = body.userId || req.user._id;
    }

    // File attachments (uploaded via multer)
    const fileAttachments = (req.files || []).map((f) => ({
      type:     'file',
      name:     f.originalname,
      url:      `/uploads/${f.filename}`,
      size:     f.size,
      mimeType: f.mimetype,
      filename: f.filename,
    }));

    // Link attachments
    let linkAttachments = [];
    if (body.links) {
      try { linkAttachments = JSON.parse(body.links).map((l) => ({ type: 'link', name: l.name || l.url, url: l.url })); } catch {}
      delete body.links;
    }

    const todo = await Todo.create({
      ...body,
      assignedBy:  req.user._id,
      attachments: [...fileAttachments, ...linkAttachments],
    });

    const populated = await todo.populate(todoPopulate);
    const io = req.app.get('io');
    io?.emit('todo:created', populated);
    audit.log(req, {
      action: 'create', category: 'todo',
      targetId: todo._id, targetModel: 'Todo', targetTitle: todo.title,
      metadata: { priority: todo.priority, status: todo.status, assignedTo: String(todo.userId ?? '') },
    });
    // Fire-and-forget — a Sheets outage or bad credentials must never fail
    // (or even slow down) the actual todo creation response.
    syncTodoToSheet(todo).catch(() => {});
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.updateTodo = async (req, res, next) => {
  try {
    const prev = await Todo.findById(req.params.id).lean();
    if (!prev) return res.status(404).json({ success: false, message: 'Todo not found' });

    const body = { ...req.body };

    // Standard members cannot change assignee
    if (req.user.role === 'member') {
      delete body.userId; // ensure standard member cannot change it
    } else if (body.userId && String(body.userId) !== String(prev.userId)) {
      body.assignedBy = req.user._id;
    }

    if (body.clientId === '') body.clientId = null;
    if (body.taskId === '')   body.taskId   = null;

    // Merge attachments: existing + new files + new links
    if (req.files?.length || body.links || body.existingAttachments !== undefined) {
      const existing = body.existingAttachments
        ? JSON.parse(body.existingAttachments)
        : (prev?.attachments || []);
      delete body.existingAttachments;

      const newFiles = (req.files || []).map((f) => ({
        type: 'file', name: f.originalname, url: `/uploads/${f.filename}`,
        size: f.size, mimeType: f.mimetype, filename: f.filename,
      }));

      let newLinks = [];
      if (body.links) {
        try { newLinks = JSON.parse(body.links).map((l) => ({ type: 'link', name: l.name || l.url, url: l.url })); } catch {}
        delete body.links;
      }

      body.attachments = [...existing, ...newFiles, ...newLinks];
    }

    const todo = await Todo.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true })
      .populate(todoPopulate);

    const todoAction = (() => {
      if (body.status === 'completed' && prev.status !== 'completed') return 'approve';
      if (body.status === 'sent-for-approval' && prev.status !== 'sent-for-approval') return 'submit_approval';
      if (body.status && body.status !== prev.status) return 'status_change';
      return 'update';
    })();

    audit.log(req, {
      action: todoAction, category: 'todo',
      targetId: todo._id, targetModel: 'Todo', targetTitle: todo.title,
      metadata: {
        ...(body.status && body.status !== prev.status ? { statusFrom: prev.status, statusTo: body.status } : {}),
      },
    });

    const io = req.app.get('io');
    io?.emit('todo:updated', todo);
    syncTodoToSheet(todo).catch(() => {});
    res.json({ success: true, data: todo });
  } catch (err) { next(err); }
};

exports.deleteTodo = async (req, res, next) => {
  try {
    const target = await Todo.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: false }).lean();
    if (!target) return res.status(404).json({ success: false, message: 'Todo not found' });
    const io = req.app.get('io');
    io?.emit('todo:deleted', req.params.id);
    deleteTodoFromSheet(target).catch(() => {});
    audit.log(req, {
      action: 'delete', category: 'todo',
      targetId: req.params.id, targetModel: 'Todo',
      targetTitle: target?.title ?? req.params.id,
    });
    res.json({ success: true, message: 'Todo deleted' });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════
// MEETINGS
// ═══════════════════════════════════════════════════
const meetPopulate = [
  { path: 'participants', select: 'name color initials status' },
  { path: 'clientId',     select: 'name' },
];

exports.getMeetings = async (req, res, next) => {
  try {
    const filter = req.user.role === 'client' ? { clientId: req.user.clientId } : {};
    const meetings = await Meeting.find(filter).populate(meetPopulate).sort({ date: 1, time: 1 });
    res.json({ success: true, data: meetings });
  } catch (err) { next(err); }
};

exports.createMeeting = async (req, res, next) => {
  try {
    const meeting = await Meeting.create({ ...req.body, createdBy: req.user._id });
    const populated = await meeting.populate(meetPopulate);
    const io = req.app.get('io');
    io?.emit('meeting:created', populated);

    const participants = (req.body.participants || []).filter((id) => String(id) !== String(req.user._id));
    participants.forEach((pid) => {
      notifService.dispatch(io, {
        recipient: pid,
        sender:    req.user._id,
        type:      'meeting_scheduled',
        title:     'Meeting scheduled',
        message:   `${req.user.name} scheduled "${meeting.title}"${meeting.date ? ` on ${meeting.date}` : ''}`,
        link:      '/meetings',
        metadata:  { meetingId: String(meeting._id) },
      });
    });

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.updateMeeting = async (req, res, next) => {
  try {
    // Whitelisted — req.body went through wholesale, so createdBy and any
    // other schema path could be rewritten by an edit.
    const MEETING_WRITABLE = ['title', 'description', 'type', 'date', 'time', 'duration',
      'startTime', 'endTime', 'status', 'participants', 'clientId', 'location', 'notes',
      'meetingLink', 'emergencyFlag'];
    const patch = MEETING_WRITABLE.reduce((acc, k) => {
      if (req.body[k] !== undefined) acc[k] = req.body[k];
      return acc;
    }, {});

    const meeting = await Meeting.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true })
      .populate(meetPopulate);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });
    res.json({ success: true, data: meeting });
  } catch (err) { next(err); }
};

exports.deleteMeeting = async (req, res, next) => {
  try {
    await Meeting.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Meeting deleted' });
  } catch (err) { next(err); }
};
