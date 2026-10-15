const { SystemSettings } = require('../models/index');
const User = require('../models/User');
const { getSheetsClient, isConfigured } = require('../utils/googleSheetsClient');
const { invalidateLimitsCache } = require('../middleware/rateLimiters');
const { invalidateFeatureAccessCache } = require('../middleware/authorizeFeature');

// Defaults that must exist in every document — used to patch legacy docs
const FIELD_DEFAULTS = {
  departments: ['Management', 'Sales', 'Engineering', 'Marketing', 'Support', 'General'],
  positions:   ['Developer', 'Graphic Designer', 'Video Editor', 'SEO', 'HR', 'BDE', 'SMM', 'Other'],
  industries:  ['Technology', 'Retail', 'Marketing', 'Finance', 'Healthcare', 'Education', 'Real Estate', 'Other'],
};

// @GET /api/settings
exports.getSystemSettings = async (req, res, next) => {
  try {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({});
      return res.json({ success: true, data: settings });
    }

    // Use .lean() raw data to accurately detect fields missing from legacy documents
    const rawSettings = settings.toObject();
    const missing = {};
    for (const [field, defaultValue] of Object.entries(FIELD_DEFAULTS)) {
      if (!Object.prototype.hasOwnProperty.call(rawSettings, field) || !rawSettings[field] || rawSettings[field].length === 0) {
        missing[field] = defaultValue;
      }
    }

    // One-time migration: featureAccess didn't exist before this feature
    // shipped. On the first read after upgrade, persist the schema defaults
    // AND seed featureAccess.campaigns.userIds from every user who already
    // had the old campaignsAccess flag, so nobody silently loses campaign
    // access on cutover. Only ever runs once per document.
    //
    // Detection MUST use a separate .lean() query, not rawSettings above —
    // Mongoose applies a Map field's schema default during hydration itself,
    // so `settings.toObject()` (and thus rawSettings) always shows
    // featureAccess as present with its full default, even on a document
    // that has never actually persisted it. Only .lean() reflects the true
    // raw stored document (verified directly against this DB while building
    // this: hydrated .toObject() → hasOwnProperty true always; .lean() →
    // undefined when truly never-stored). Getting this wrong means the
    // migration silently never runs and legacy campaignsAccess users
    // silently lose campaign access — exactly what this exists to prevent.
    const leanCheck = await SystemSettings.findById(settings._id).select('featureAccess').lean();
    if (!leanCheck.featureAccess) {
      const featureAccessObj = {};
      for (const [key, rule] of settings.featureAccess.entries()) {
        featureAccessObj[key] = { roles: [...rule.roles], userIds: rule.userIds.map(String) };
      }
      const flaggedUsers = await User.find({ campaignsAccess: true }).select('_id');
      const campaignUserIds = new Set(featureAccessObj.campaigns?.userIds || []);
      flaggedUsers.forEach((u) => campaignUserIds.add(String(u._id)));
      featureAccessObj.campaigns = {
        roles: featureAccessObj.campaigns?.roles || ['admin', 'manager'],
        userIds: [...campaignUserIds],
      };
      missing.featureAccess = featureAccessObj;
    }

    if (Object.keys(missing).length > 0) {
      settings = await SystemSettings.findByIdAndUpdate(
        settings._id,
        { $set: missing },
        { new: true }
      );
    }

    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
};

// @PUT /api/settings
exports.updateSystemSettings = async (req, res, next) => {
  try {
    const role = req.user.role;
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({});
    }

    let updateData = { ...req.body };

    // Manager role checks: Restrict manager from updating global/system tier fields
    if (role === 'manager') {
      const allowedManagerFields = [
        'departments',
        'positions',
        'industries',
        'teams',
        'assignmentRules',
        'emailTemplates',
        'snippetLibrary',
        'integrations',
        'dataControl',
        'notificationRouting'
      ];
      
      // Delete any keys not in the allowed list
      Object.keys(updateData).forEach((key) => {
        if (!allowedManagerFields.includes(key)) {
          delete updateData[key];
        }
      });
    }

    // Apply updates
    const updatedSettings = await SystemSettings.findByIdAndUpdate(
      settings._id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    // A changed rate-limit cap should apply to the very next request, not
    // wait out the middleware's own cache TTL.
    if (updateData.rateLimits) invalidateLimitsCache();
    if (updateData.featureAccess) invalidateFeatureAccessCache();

    // Broadcast live config sync to internal staff only. This document holds
    // the whole system configuration (feature-access rules, pipelines, rate
    // limits, integration endpoints) — a bare io.emit() pushed all of it to
    // every connected socket, client-portal logins included, which have no
    // use for it (hasFeatureAccess short-circuits for the client role).
    const io = req.app.get('io');
    io?.to('staff').emit('settings:updated', updatedSettings);

    res.json({ success: true, data: updatedSettings });
  } catch (err) { next(err); }
};

// @POST /api/settings/users (Dynamic Invite/Create member)
exports.inviteUser = async (req, res, next) => {
  try {
    const { name, email, role, position, department, color, phone } = req.body;
    
    // Check if user already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }

    // Setup initials
    const initials = name ? name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2) : 'U';

    // Create user with a secure default password 'welcome123'
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      role: role || 'member',
      position: position || 'Team Member',
      department: department || 'General',
      color: color || '#6366f1',
      phone: phone || '',
      initials,
      joinDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      password: 'welcome123', // Default welcome password, they can update in personal security tab
      status: 'offline'
    });

    // Broadcast new user created to all clients
    const io = req.app.get('io');
    io?.emit('user:updated', newUser);

    res.status(201).json({ success: true, data: newUser });
  } catch (err) { next(err); }
};

// @GET /api/settings/assignment-sheet-test — verifies the service account
// can actually reach the configured spreadsheet, and cross-checks every
// user's assignmentSheetTab against the tab names that really exist there
// (a typo'd tab name is otherwise a silent no-op — todos just never sync,
// with nothing in the UI to explain why).
exports.testAssignmentSheet = async (req, res, next) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_ASSIGNMENT_SHEET_ID must all be set in backend/.env',
      });
    }

    const spreadsheetId = process.env.GOOGLE_ASSIGNMENT_SHEET_ID;
    let meta;
    try {
      const sheets = await getSheetsClient();
      meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' });
    } catch (err) {
      const reason = err.response?.data?.error?.message || err.message;
      return res.status(400).json({
        success: false,
        message: `Could not access the spreadsheet — ${reason}. Make sure it's shared with the service account's email as an Editor.`,
      });
    }

    const tabNames = (meta.data.sheets || []).map((s) => s.properties.title);
    const users = await User.find({ isDeleted: { $ne: true } }).select('name assignmentSheetTab').lean();
    const mapped = users.filter((u) => u.assignmentSheetTab);
    const badMappings = mapped.filter((u) => !tabNames.includes(u.assignmentSheetTab));

    res.json({
      success: true,
      data: {
        spreadsheetTitle: meta.data.properties?.title || '',
        tabsFound: tabNames,
        usersMapped: mapped.map((u) => ({ name: u.name, tab: u.assignmentSheetTab })),
        badMappings: badMappings.map((u) => ({ name: u.name, tab: u.assignmentSheetTab })),
      },
    });
  } catch (err) { next(err); }
};
