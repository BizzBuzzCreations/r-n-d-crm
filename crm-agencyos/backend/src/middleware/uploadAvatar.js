const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const avatarDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    // Extension comes from the validated mime type, not the client-supplied filename.
    cb(null, `${req.user._id}-${Date.now()}${EXT_BY_MIME[file.mimetype]}`);
  },
});

const uploadAvatar = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) cb(null, true);
    else cb(new Error('Profile picture must be a JPG, PNG, WebP or GIF image'), false);
  },
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
});

module.exports = { uploadAvatar, avatarDir };
