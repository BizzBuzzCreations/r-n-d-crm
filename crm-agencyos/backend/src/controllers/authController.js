const jwt   = require('jsonwebtoken');
const fs    = require('fs');
const path  = require('path');
const { avatarDir } = require('../middleware/uploadAvatar');
const User  = require('../models/User');
const { Client } = require('../models/index');
const audit = require('../services/auditService');

// Send tokens helper
const sendTokens = (user, statusCode, res) => {
  const accessToken  = user.getAccessToken();
  const refreshToken = user.getRefreshToken();

  const cookieOpts = {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  };

  res
    // Must match User.getRefreshToken()'s JWT expiry (30d) — a shorter
    // cookie maxAge would delete the cookie before the longer-lived token
    // inside it actually expires, defeating the point of extending it.
    .cookie('refreshToken', refreshToken, { ...cookieOpts, maxAge: 30*24*60*60*1000 })
    .status(statusCode)
    .json({
      success: true,
      accessToken,
      user: {
        _id:        user._id,
        id:         user._id,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        position:   user.position,
        department: user.department,
        phone:      user.phone,
        color:      user.color,
        initials:   user.initials,
        status:     user.status,
        joinDate:   user.joinDate,
        bio:        user.bio,
        avatar:     user.avatar,
        emailSync:  user.emailSync,
        calendarSyncEnabled: user.calendarSyncEnabled,
        notificationPrefs:   user.notificationPrefs,
        personalSignature:   user.personalSignature,
        defaultLandingView:  user.defaultLandingView,
      },
    });
};

// @POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const match = await user.matchPassword(password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    // Block client users whose Client record has been deactivated or soft-deleted
    if (user.role === 'client' && user.clientId) {
      const clientRec = await Client.findById(user.clientId, 'status isDeleted name').lean();
      if (!clientRec || clientRec.isDeleted || clientRec.status === 'inactive') {
        return res.status(403).json({
          success: false,
          message: 'Your portal access has been deactivated. Please contact your account manager.',
        });
      }
    }

    // Mark online
    user.status = 'online';
    await user.save({ validateBeforeSave: false });

    audit.log(
      { user: { _id: user._id, name: user.name, role: user.role }, ip: req.ip, headers: req.headers },
      { action: 'login', category: 'auth', targetTitle: user.email, metadata: { role: user.role } }
    );

    sendTokens(user, 200, res);
  } catch (err) { next(err); }
};

// @POST /api/auth/logout
exports.logout = async (req, res, next) => {
  try {
    let userId = null;
    let token = null;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.id) {
          userId = decoded.id;
        }
      } catch (err) {
        // Ignore token decoding errors on logout
      }
    }

    if (userId) {
      const loggedOut = await User.findByIdAndUpdate(userId, { status: 'offline' }).lean();
      if (loggedOut) {
        audit.log(
          { user: { _id: loggedOut._id, name: loggedOut.name, role: loggedOut.role }, ip: req.ip, headers: req.headers },
          { action: 'logout', category: 'auth', targetTitle: loggedOut.email }
        );
      }
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ success: true, message: 'Logged out' });
  } catch (err) { next(err); }
};

// @POST /api/auth/refresh
exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ success: false, message: 'No refresh token' });

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user    = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    // Revoke refresh for deactivated or soft-deleted client accounts
    if (user.role === 'client' && user.clientId) {
      const clientRec = await Client.findById(user.clientId, 'status isDeleted').lean();
      if (!clientRec || clientRec.isDeleted || clientRec.status === 'inactive') {
        res.clearCookie('refreshToken');
        return res.status(403).json({
          success: false,
          message: 'Portal access has been deactivated. Please contact your account manager.',
        });
      }
    }

    sendTokens(user, 200, res);
  } catch (err) {
    res.clearCookie('refreshToken');
    return res.status(401).json({ success: false, message: 'Refresh token expired, please login again' });
  }
};

// @GET /api/auth/me
exports.me = async (req, res) => {
  res.json({ success: true, user: req.user });
};

// @PUT /api/auth/profile
// Remove a previously uploaded avatar file from disk (ignores missing files and non-local URLs).
const deleteAvatarFile = (avatarPath) => {
  if (!avatarPath || !avatarPath.startsWith('/uploads/avatars/')) return;
  const file = path.join(avatarDir, path.basename(avatarPath));
  fs.promises.unlink(file).catch(() => {});
};

const saveAvatar = async (req, res, next, newPath) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const old = user.avatar;
    user.avatar = newPath;
    await user.save();
    deleteAvatarFile(old);
    req.app.get('io')?.emit('user:updated', user);
    res.json({ success: true, user });
  } catch (err) { next(err); }
};

exports.uploadAvatar = (req, res, next) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
  return saveAvatar(req, res, next, `/uploads/avatars/${req.file.filename}`);
};

exports.removeAvatar = (req, res, next) => saveAvatar(req, res, next, null);

exports.updateProfile = async (req, res, next) => {
  try {
    const { name, email, position, phone, bio, color, emailSync, calendarSyncEnabled, notificationPrefs, personalSignature, defaultLandingView } = req.body;
    
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (position !== undefined) user.position = position;
    if (phone !== undefined) user.phone = phone;
    if (bio !== undefined) user.bio = bio;
    if (color !== undefined) user.color = color;
    if (emailSync !== undefined) user.emailSync = emailSync;
    if (calendarSyncEnabled !== undefined) user.calendarSyncEnabled = calendarSyncEnabled;
    if (personalSignature !== undefined) user.personalSignature = personalSignature;
    if (defaultLandingView !== undefined) user.defaultLandingView = defaultLandingView;

    if (notificationPrefs !== undefined && typeof notificationPrefs === 'object') {
      Object.entries(notificationPrefs).forEach(([key, val]) => {
        user.notificationPrefs.set(key, !!val);
      });
    }

    await user.save();

    // Broadcast update for real-time presence/visual sync
    const io = req.app.get('io');
    io?.emit('user:updated', user);

    res.json({ success: true, user });
  } catch (err) { next(err); }
};

// @PUT /api/auth/password
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    const match = await user.matchPassword(currentPassword);
    if (!match) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) { next(err); }
};
