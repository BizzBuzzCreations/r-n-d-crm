const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const dir = path.join(__dirname, '../../uploads/leaves');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    // Extension comes from the validated mime type, not the client-supplied filename.
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${EXT_BY_MIME[file.mimetype]}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) cb(null, true);
    else cb(new Error('Attachment must be a PDF, JPG, PNG or DOC file'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = upload;
