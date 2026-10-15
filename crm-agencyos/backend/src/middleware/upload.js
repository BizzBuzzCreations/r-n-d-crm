const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Extension is derived from the ACCEPTED mime type, not from the uploader's
// filename. Multer's fileFilter only checks the client-declared mimetype,
// while the stored name used path.extname(originalname) — so a file declared
// as `text/plain` but named `x.html` was saved as .html and served from this
// app's own origin (uploads are public and CSP is disabled), which is a
// stored-XSS primitive via task/todo/message/payment attachments.
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv', 'text/plain': '.txt',
  'application/zip': '.zip', 'application/x-rar-compressed': '.rar',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-msvideo': '.avi',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/aac': '.aac', 'audio/ogg': '.ogg',
  'audio/webm': '.weba', 'audio/mp4': '.m4a',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    // Falls back to .bin rather than trusting originalname for anything the
    // map doesn't cover (fileFilter should already have rejected it).
    cb(null, `${unique}${MIME_EXT[file.mimetype] || '.bin'}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = [
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv','text/plain',
    'application/zip','application/x-rar-compressed',
    'video/mp4','video/quicktime','video/webm','video/x-msvideo',
    'audio/mpeg','audio/wav','audio/aac','audio/ogg','audio/webm','audio/mp4',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error(`File type ${file.mimetype} not allowed`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = upload;
