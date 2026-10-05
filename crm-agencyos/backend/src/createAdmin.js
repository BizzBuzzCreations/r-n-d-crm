// Create or update a single admin user (idempotent).
//
//   ADMIN_NAME="Utkarsh" ADMIN_EMAIL="utkarsh@bizzbuzzcreations.com" \
//   ADMIN_PASSWORD="..." npm run create-admin
//
// Credentials come from env vars so no password lives in the repo.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('./models/User');

const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

(async () => {
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD env vars');
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

  const email = ADMIN_EMAIL.toLowerCase().trim();
  let user = await User.findOne({ email }).select('+password');
  const created = !user;
  if (!user) user = new User({ email, position: 'Admin' });
  user.name = ADMIN_NAME;
  user.role = 'admin';
  user.password = ADMIN_PASSWORD; // hashed by the model's pre-save hook
  await user.save();

  console.log(`${created ? 'Created' : 'Updated'} admin ${email} in db "${mongoose.connection.name}"`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('create-admin failed:', err.message);
  process.exit(1);
});
