const mongoose = require('mongoose');

const platformConfigSchema = new mongoose.Schema({
  studentRegistrationFee: {
    type: Number,
    default: 0,
    min: 0,
  },
  applyRegistrationFeeToExistingStudents: {
    type: Boolean,
    default: true,
  },
  studentRegistrationFeeActivatedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('PlatformConfig', platformConfigSchema);
