const mongoose = require('mongoose');

const examAccessGrantSchema = new mongoose.Schema({
  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true,
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  grantedAt: {
    type: Date,
    default: Date.now,
  },
});

examAccessGrantSchema.index({ exam: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('ExamAccessGrant', examAccessGrantSchema);
