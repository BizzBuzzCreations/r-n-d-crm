'use strict';
const mongoose = require('mongoose');
const { Channel } = require('../models/index');

// Can `user` read / post in `threadId`?  Single source of truth for channel privacy,
// used by the REST message endpoints and by the socket room-join.
//
//  - admin               -> always (admins can see every group, member or not)
//  - client              -> their dedicated channel, or a private channel they're a member of
//  - everyone else       -> public channels, or private channels they're a member of
//  - DMs / legacy string ids ("general", "dm-...") aren't Channel documents, so they're
//    not decided here (callers keep their existing handling).
async function getChannelAccess(user, threadId) {
  if (!threadId || String(threadId).startsWith('dm-') || !mongoose.isValidObjectId(threadId)) {
    return { allowed: true, channel: null };
  }
  const channel = await Channel.findOne({ _id: threadId }, 'clientId isPrivate members createdBy').lean();
  if (!channel) return { allowed: true, channel: null };
  if (user.role === 'admin') return { allowed: true, channel };

  const uid = String(user._id || user.id);
  const isMember = (channel.members || []).some((m) => String(m) === uid);
  if (user.role === 'client') {
    const dedicated = channel.clientId && String(channel.clientId) === String(user.clientId);
    return { allowed: !!(dedicated || (channel.isPrivate && isMember)), channel };
  }
  return { allowed: !channel.isPrivate || isMember, channel };
}

module.exports = { getChannelAccess };
