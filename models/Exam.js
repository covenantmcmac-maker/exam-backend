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