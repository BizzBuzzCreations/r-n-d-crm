const AuditLog = require('../models/AuditLog');

// Neutralise regex metacharacters in user-supplied search text before it is
// used as a $regex pattern.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @GET /api/audit — paginated + filterable log list (admin only)
exports.getLogs = async (req, res, next) => {
  try {
    const {
      page     = 1,
      limit    = 50,
      category,
      action,
      actorId,
      search,
      dateFrom,
      dateTo,
    } = req.query;

    const filter = {};
    if (category) filter.category      = category;
    if (action)   filter.action        = action;
    if (actorId)  filter['actor.id']   = actorId;

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    if (search) {
      filter.$or = [
        // Escaped: the raw search string went straight into a regex, so a
        // stray '(' threw a 500 and a pathological pattern could pin the CPU.
        { 'actor.name':   { $regex: escapeRegex(search), $options: 'i' } },
        { 'target.title': { $regex: escapeRegex(search), $options: 'i' } },
        { 'target.ref':   { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const pg    = Math.max(1, Number(page));
    const lim   = Math.min(200, Math.max(1, Number(limit)));
    const skip  = (pg - 1) * lim;
    const total = await AuditLog.countDocuments(filter);

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .lean();

    res.json({
      success: true,
      data: logs,
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err) { next(err); }
};

// @GET /api/audit/stats — summary counts for the last 30 days (admin only)
exports.getStats = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [byCategory, byAction, topActors, todayCount, totalCount] = await Promise.all([
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: since }, 'actor.id': { $ne: null } } },
        { $group: {
            _id:   '$actor.id',
            name:  { $first: '$actor.name' },
            role:  { $first: '$actor.role' },
            count: { $sum: 1 },
        }},
        { $sort:  { count: -1 } },
        { $limit: 10 },
      ]),
      AuditLog.countDocuments({ createdAt: { $gte: todayStart } }),
      AuditLog.countDocuments({}),
    ]);

    res.json({
      success: true,
      data: { byCategory, byAction, topActors, todayCount, totalCount },
    });
  } catch (err) { next(err); }
};
