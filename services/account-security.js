const DEFAULT_PASSWORD = '123456';

function markPasswordModified(user) {
  if (!user) return;
  if (typeof user.markModified === 'function') {
    user.markModified('password');
    return;
  }
  if (user._modified && typeof user._modified.add === 'function') {
    user._modified.add('password');
  }
}

async function setUserPassword(user, password, { mustChangePassword } = {}) {
  user.password = password;
  markPasswordModified(user);
  if (mustChangePassword !== undefined) {
    user.mustChangePassword = mustChangePassword;
  }
  await user.save();
  return user;
}

module.exports = {
  DEFAULT_PASSWORD,
  markPasswordModified,
  setUserPassword,
};
