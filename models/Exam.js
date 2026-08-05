const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Exam title is required']
  },
  description: String,
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Who owns the paper:
  //   'teacher' — a teacher's own exam, shared by access code, FREE to take.
  //   'past'    — platform-owned past question paper, sold by the platform.
  source: {
    type: String,
    enum: ['teacher', 'past'],
    default: 'teacher'
  },
  // Exam year for past question papers (e.g. "Biology 2022").
  year: Number,
  // Monetisation. All amounts are in `currency` (whole units, e.g. naira).
  pricing: {
    entryFee: {
      type: Number,
      default: 0,
      min: 0
    },
    reviewFee: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: 'NGN'
    }
  },
  subject: String,
  questions: [
    {
      question: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
      },
      points: {
        type: Number,
        default: 1
      },
      order: Number
    }
  ],
  settings: {
    duration: {
      type: Number,
      required: true,
      default: 60
    },
    totalMarks: {
      type: Number,
      default: 0
    },
    passingMarks: {
      type: Number,
      default: 40
    },
    shuffleQuestions: {
      type: Boolean,
      default: false
    },
    shuffleOptions: {
      type: Boolean,
      default: false
    },
    showResults: {
      type: Boolean,
      default: true
    },
    allowReview: {
      type: Boolean,
      default: false
    },
    maxAttempts: {
      type: Number,
      default: 1
    },
    // Locks down the exam client and automatically submits after 3 violations.
    // Strict mode blocks copying and captures integrity violations while an
    // attempt is open. Three violations automatically submit the attempt.
    safeMode: {
      type: Boolean,
      default: false
    },
    maxViolations: {
      type: Number,
      default: 3,
      min: 1
    },
    startDate: Date,
    endDate: Date,
    isPublished: {
      type: Boolean,
      default: false
    }
  },
  accessCode: {
    type: String,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Exam', examSchema);