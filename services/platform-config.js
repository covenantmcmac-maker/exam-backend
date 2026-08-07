const PlatformConfig = require('../models/PlatformConfig');

async function getPlatformConfig() {
  let config = await PlatformConfig.findOne();
  if (!config) {
    config = new PlatformConfig();
    await config.save();
  }
  return config;
}

async function updatePlatformConfig(updates = {}) {
  const config = await getPlatformConfig();
  const nextFee = updates.studentRegistrationFee !== undefined
    ? Math.max(0, Number(updates.studentRegistrationFee) || 0)
    : Math.max(0, Number(config.studentRegistrationFee) || 0);

  const previousFee = Math.max(0, Number(config.studentRegistrationFee) || 0);

  if (updates.studentRegistrationFee !== undefined) {
    config.studentRegistrationFee = nextFee;
    if (previousFee <= 0 && nextFee > 0) {
      config.studentRegistrationFeeActivatedAt = new Date();
    } else if (nextFee <= 0) {
      config.studentRegistrationFeeActivatedAt = null;
    }
  }

  if (updates.applyRegistrationFeeToExistingStudents !== undefined) {
    config.applyRegistrationFeeToExistingStudents = Boolean(
      updates.applyRegistrationFeeToExistingStudents
    );
  }

  await config.save();
  return config;
}

function sanitizePlatformConfig(config) {
  return {
    studentRegistrationFee: Math.max(0, Number(config?.studentRegistrationFee) || 0),
    applyRegistrationFeeToExistingStudents:
      config?.applyRegistrationFeeToExistingStudents !== false,
    studentRegistrationFeeActivatedAt: config?.studentRegistrationFeeActivatedAt || null,
  };
}

module.exports = {
  getPlatformConfig,
  updatePlatformConfig,
  sanitizePlatformConfig,
};
