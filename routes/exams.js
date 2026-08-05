const router = require('express').Router();
const Exam = require('../models/Exam');
const ExamAttempt = require('../models/ExamAttempt');
const Payment = require('../models/Payment');
const { auth, authorize } = require('../middleware/auth');
const { requireEntryPayment, getPricing, hasPaidEntry } = require('../services/payment-access');
const paystack = require('../services/paystack');
const crypto = require('crypto');

// CREATE EXAM
router.post('/', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    let totalMarks = 0;
    if (req.body.questions) {
      req.body.questions.forEach(q => {
        totalMarks += q.points || 1;
      });
    }

    // Exam source: 'past' papers belong to the platform (admin only).
    // Teacher exams are always FREE to take — entryFee is forced to 0.
    const source = req.body.source === 'past' ? 'past' : 'teacher';
    if (source === 'past' && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Only admins can create past-question papers'
      });
    }

    const pricing = {
      entryFee: source === 'past'
        ? (req.body.pricing?.entryFee !== undefined
            ? Math.max(0, Number(req.body.pricing.entryFee) || 0)
            : paystack.defaultEntryFee())   // default ₦300
        : 0,
      reviewFee: req.body.pricing?.reviewFee !== undefined
        ? Math.max(0, Number(req.body.pricing.reviewFee) || 0)
        : paystack.defaultReviewFee(),      // default ₦500
      currency: req.body.pricing?.currency || 'NGN'
    };

    const exam = new Exam({
      ...req.body,
      source,
      year: req.body.year ? Number(req.body.year) : undefined,
      pricing,
      creator: req.user._id,
      accessCode: crypto.randomBytes(4).toString('hex').toUpperCase()
    });

    // New exams allow the answer review by default; teachers opt out with
    // the toggle in the builder. (Old exams keep their stored value.)
    if (req.body.settings?.allowReview === undefined) {
      exam.settings.allowReview = true;
    }

    exam.settings.totalMarks = totalMarks;
    await exam.save();

    res.status(201).json({
      message: 'Exam created successfully',
      exam,
      accessCode: exam.accessCode
    });
  } catch (error) {
    console.error('Create exam error:', error);
    res.status(500).json({ message: 'Error creating exam' });
  }
});

// GET TEACHER EXAMS (active/draft only; past papers via their own endpoint)
router.get('/my-exams', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exams = await Exam.find({
      creator: req.user._id,
      source: { $ne: 'past' }
    })
      .sort({ createdAt: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exams' });
  }
});

// GET TEACHER'S PAST QUESTION PAPERS (for the teacher dashboard/sales view)
router.get('/my-past', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exams = await Exam.find({
      creator: req.user._id,
      source: 'past'
    }).sort({ createdAt: -1 });

    // Enrich with sales counts
    const Payment = require('../models/Payment');
    const enriched = await Promise.all(
      exams.map(async (exam) => {
        const sales = await Payment.countDocuments({
          exam: exam._id,
          status: 'paid',
          purpose: 'entry'
        });
        const revenue = await Payment.aggregate([
          { $match: { exam: exam._id, status: 'paid', purpose: 'entry' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        return {
          ...exam.toObject(),
          salesCount: sales,
          totalRevenue: revenue[0]?.total || 0
        };
      })
    );
    res.json(enriched);
  } catch (error) {
    console.error('My past papers error:', error);
    res.status(500).json({ message: 'Error fetching your past questions' });
  }
});

// JOIN EXAM
router.post('/join', auth, async (req, res) => {
  try {
    const { accessCode } = req.body;

    if (!accessCode) {
      return res.status(400).json({ message: 'Please enter access code' });
    }

    const exam = await Exam.findOne({
      accessCode: accessCode.toUpperCase(),
      'settings.isPublished': true,
      source: { $ne: 'past' } // past papers are NOT joinable by access code
    }).populate('creator', 'name');

    if (!exam) {
      return res.status(404).json({ message: 'Invalid access code or exam not published' });
    }

    const now = new Date();
    if (exam.settings.startDate) {
      const startDate = new Date(exam.settings.startDate);
      if (!isNaN(startDate.getTime()) && now < startDate) {
        return res.status(400).json({
          message: 'Exam has not started yet. Starts: ' + startDate.toLocaleString()
        });
      }
    }
    if (exam.settings.endDate) {
      const endDate = new Date(exam.settings.endDate);
      if (!isNaN(endDate.getTime()) && now > endDate) {
        return res.status(400).json({
          message: 'Exam has ended on: ' + endDate.toLocaleString()
        });
      }
    }

    const attemptCount = await ExamAttempt.countDocuments({
      exam: exam._id,
      student: req.user._id,
      status: { $ne: 'in-progress' }
    });

    if (attemptCount >= exam.settings.maxAttempts) {
      return res.status(400).json({ message: 'Maximum attempts reached' });
    }

    res.json({ message: 'Access granted', exam });
  } catch (error) {
    res.status(500).json({ message: 'Error joining exam' });
  }
});

// PUBLIC JOIN - No auth
router.post('/join-public', async (req, res) => {
  try {
    const { accessCode } = req.body;

    if (!accessCode) {
      return res.status(400).json({ message: 'Access code required' });
    }

    const exam = await Exam.findOne({
      accessCode: accessCode.toUpperCase(),
      'settings.isPublished': true,
      source: { $ne: 'past' }
    }).populate('creator', 'name');

    if (!exam) {
      return res.status(404).json({
        message: 'Exam not found or not published'
      });
    }

    const now = new Date();
    if (exam.settings.startDate) {
      const startDate = new Date(exam.settings.startDate);
      if (!isNaN(startDate.getTime()) && now < startDate) {
        return res.status(400).json({
          message: 'Exam has not started yet. Starts: ' + startDate.toLocaleString()
        });
      }
    }
    if (exam.settings.endDate) {
      const endDate = new Date(exam.settings.endDate);
      if (!isNaN(endDate.getTime()) && now > endDate) {
        return res.status(400).json({
          message: 'Exam has ended on: ' + endDate.toLocaleString()
        });
      }
    }

    res.json({
      message: 'Exam found',
      exam: {
        _id: exam._id,
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        creator: exam.creator,
        settings: {
          duration: exam.settings.duration,
          passingMarks: exam.settings.passingMarks,
          totalMarks: exam.settings.totalMarks
        },
        questions: exam.questions
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error loading exam' });
  }
});

// PAST QUESTION PAPERS — the paid library
// All published past papers (both admin platform papers and teacher-listed
// papers). maxAttempts === 0 means UNLIMITED retakes. Students see the price,
// whether they already bought entry, and whether they may start.
router.get('/past', auth, async (req, res) => {
  try {
    const { subject, year, search } = req.query;

    const filter = {
      source: 'past',
      'settings.isPublished': true
    };
    if (subject) filter.subject = subject;
    if (year) filter.year = Number(year);
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } }
      ];
    }

    const exams = await Exam.find(filter)
      .select('title description subject year creator source pricing settings questions')
      .populate('creator', 'name')
      .sort({ year: -1, subject: 1, createdAt: -1 });

    const now = new Date();
    const list = await Promise.all(exams.map(async (exam) => {
      const pricing = getPricing(exam);
      const purchasedEntry = pricing.entryFee > 0
        ? await hasPaidEntry(req.user._id, exam._id)
        : true;

      const completedCount = await ExamAttempt.countDocuments({
        exam: exam._id,
        student: req.user._id,
        status: { $ne: 'in-progress' }
      });

      const inProgress = await ExamAttempt.findOne({
        exam: exam._id,
        student: req.user._id,
        status: 'in-progress'
      });

      // 0 means unlimited; otherwise enforce maxAttempts.
      const maxAttempts = exam.settings.maxAttempts || 0;
      const unlimited = maxAttempts === 0;
      const startable =
        purchasedEntry &&
        (unlimited || completedCount < maxAttempts) &&
        (!exam.settings.startDate || new Date(exam.settings.startDate) <= now) &&
        (!exam.settings.endDate || new Date(exam.settings.endDate) >= now);

      return {
        _id: exam._id,
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        year: exam.year,
        source: exam.source,
        creatorName: exam.creator && typeof exam.creator === 'object' ? exam.creator.name : undefined,
        questionCount: exam.questions?.length || 0,
        settings: {
          duration: exam.settings.duration,
          totalMarks: exam.settings.totalMarks,
          passingMarks: exam.settings.passingMarks,
          maxAttempts,
          allowReview: Boolean(exam.settings.allowReview)
        },
        pricing,
        purchasedEntry,
        completedCount,
        unlimited,
        attemptsLeft: unlimited ? Infinity : Math.max(0, maxAttempts - completedCount),
        inProgressAttempt: inProgress ? { _id: inProgress._id } : null,
        startable,
        endsAt: exam.settings.endDate || null
      };
    }));

    res.json({ exams: list });
  } catch (error) {
    console.error('Past exams error:', error);
    res.status(500).json({ message: 'Error fetching past question papers' });
  }
});

// CONVERT A TEACHER'S OWN EXAM INTO A PAST-QUESTION PAPER FOR SALE
// Teachers set an entry fee (price students pay to practice). The review fee
// defaults to 0 (review included in purchase — the common "buy once, practice
// forever" expectation), but teachers can set it too. After conversion:
//   - source becomes 'past'
//   - the exam is unpublished so it can't be joined by access code for free
//   - a fresh access code is generated so the old code is invalid
//   - maxAttempts is set to 0 meaning UNLIMITED practice attempts
//   - pricing.entryFee is set (pricing.reviewFee defaults to 0)
// Students buy via the same Paystack flow used for admin past papers.
router.post('/:id/sell-as-past', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    if (exam.source === 'past') {
      return res.status(400).json({ message: 'This exam is already listed as a past question.' });
    }
    if (!exam.questions || exam.questions.length === 0) {
      return res.status(400).json({ message: 'Add at least one question before listing.' });
    }

    const entryFeeRaw = Number(req.body.entryFee);
    if (!Number.isFinite(entryFeeRaw) || entryFeeRaw < 0) {
      return res.status(400).json({ message: 'A valid entry fee (≥ 0) is required.' });
    }
    const reviewFeeRaw = req.body.reviewFee !== undefined
      ? Math.max(0, Number(req.body.reviewFee) || 0)
      : 0;

    exam.source = 'past';
    exam.year = req.body.year ? Number(req.body.year) : exam.year;
    if (req.body.description !== undefined) exam.description = req.body.description;
    exam.pricing = {
      entryFee: entryFeeRaw,
      reviewFee: reviewFeeRaw,
      currency: exam.pricing?.currency || 'NGN'
    };
    exam.settings.isPublished = true; // past papers need to be published to appear in the store
    // 0 = unlimited attempts (we treat 0 specially in the past-papers list and attempt start)
    exam.settings.maxAttempts = 0;
    // Rotate access code so it can't be shared for free entry.
    exam.accessCode = crypto.randomBytes(4).toString('hex').toUpperCase() + '_PQ';

    await exam.save();

    res.json({ message: 'Exam listed as a past question for sale.', exam });
  } catch (error) {
    console.error('Sell-as-past error:', error);
    res.status(500).json({ message: 'Error listing exam as past question.' });
  }
});

// UN-LIST A PAST PAPER (convert back to teacher draft)
// Available to the teacher who owns it, or to admins.
router.post('/:id/unlist-past', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    if (exam.source !== 'past') {
      return res.status(400).json({ message: 'This exam is not listed as a past question.' });
    }
    exam.source = 'teacher';
    exam.pricing.entryFee = 0;
    exam.settings.isPublished = false;
    exam.settings.maxAttempts = 1;
    exam.accessCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    await exam.save();
    res.json({ message: 'Removed from Past Questions store.', exam });
  } catch (error) {
    console.error('Unlist past error:', error);
    res.status(500).json({ message: 'Error removing exam from store.' });
  }
});

// TEACHER: update past-paper pricing (without going through full exam update)
router.patch('/:id/pricing', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    if (exam.source !== 'past') {
      return res.status(400).json({ message: 'This is not a past-question paper.' });
    }
    const { entryFee, reviewFee } = req.body;
    if (entryFee !== undefined) {
      const v = Math.max(0, Number(entryFee) || 0);
      exam.pricing.entryFee = v;
    }
    if (reviewFee !== undefined) {
      exam.pricing.reviewFee = Math.max(0, Number(reviewFee) || 0);
    }
    await exam.save();
    res.json({ message: 'Pricing updated.', exam });
  } catch (error) {
    console.error('Update pricing error:', error);
    res.status(500).json({ message: 'Error updating pricing.' });
  }
});

// GET EXAM STATS
router.get('/:id/stats', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    }).populate('questions.question');

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const attempts = await ExamAttempt.find({
      exam: req.params.id,
      status: { $ne: 'in-progress' }
    })
    .populate('student', 'name email')
    .sort({ completedAt: -1 });

    const inProgressCount = await ExamAttempt.countDocuments({
      exam: req.params.id,
      status: 'in-progress'
    });

    let stats = {
      totalAttempts: attempts.length + inProgressCount,
      completed: attempts.length,
      inProgress: inProgressCount,
      averageScore: 0,
      highestScore: 0,
      lowestScore: 0,
      passRate: 0
    };

    if (attempts.length > 0) {
      const scores = attempts.map(a => a.percentage || 0);
      stats.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      stats.highestScore = Math.max(...scores);
      stats.lowestScore = Math.min(...scores);
      const passedCount = attempts.filter(
        a => (a.percentage || 0) >= (exam.settings.passingMarks || 50)
      ).length;
      stats.passRate = (passedCount / attempts.length) * 100;
    }

    res.json({ exam, attempts, stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Error fetching statistics' });
  }
});

// GET EXAM TO TAKE
router.get('/:id/take', auth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate({
        path: 'questions.question',
        select: '-correctAnswer -explanation'
      });

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    // Paid papers: no entry payment → locked.
    if (!(await requireEntryPayment(req, res, exam))) return;

    const examObj = exam.toObject();
    let questions = [...(examObj.questions || [])];
    if (examObj.settings?.shuffleQuestions) {
      questions = questions.sort(() => Math.random() - 0.5);
    }

    // Never leak answer keys to a student taking an exam: strip correct
    // answers, explanations AND the option-correctness flags.
    questions = questions.map(ref => {
      if (ref.question && typeof ref.question === 'object') {
        ref.question.options = (ref.question.options || []).map(option => ({
          _id: option._id,
          text: option.text
        }));
        delete ref.question.correctAnswer;
        delete ref.question.explanation;
      }
      return ref;
    });

    res.json({ ...examObj, questions });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exam' });
  }
});

// PUBLISH OR UNPUBLISH
router.patch('/:id/publish', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOneAndUpdate(
      { _id: req.params.id, creator: req.user._id },
      { 'settings.isPublished': req.body.isPublished },
      { new: true }
    );
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    res.json({ message: 'Exam updated successfully', exam });
  } catch (error) {
    res.status(500).json({ message: 'Error updating exam' });
  }
});

// DELETE EXAM
router.delete('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOneAndDelete({
      _id: req.params.id,
      creator: req.user._id
    });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    await ExamAttempt.deleteMany({ exam: req.params.id });
    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting exam' });
  }
});
// UPDATE EXAM
router.put('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { title, description, subject, questions, settings } = req.body;

    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    });

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    // Teachers cannot change source via generic update (use /sell-as-past).
    // Admins can set any source.
    if (req.body.source === 'past' && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Use "Sell as past question" to list your exam for sale.'
      });
    }
    if (req.body.source && req.user.role === 'admin') {
      exam.source = req.body.source;
    }
    if (req.body.year !== undefined) {
      exam.year = req.body.year ? Number(req.body.year) : undefined;
    }

    // Pricing (NGN). Teachers set their own entry+review fees for papers
    // they have converted to past; admin can always edit any pricing.
    if (req.body.pricing) {
      const pricing = req.body.pricing;
      const canSetEntry =
        req.user.role === 'admin' ||
        (req.user.role === 'teacher' && exam.source === 'past');
      if (canSetEntry && pricing.entryFee !== undefined) {
        exam.pricing.entryFee = Math.max(0, Number(pricing.entryFee) || 0);
      }
      if (pricing.reviewFee !== undefined) {
        exam.pricing.reviewFee = Math.max(0, Number(pricing.reviewFee) || 0);
      }
      if (pricing.currency) exam.pricing.currency = pricing.currency;
    }

    // Update fields
    if (title) exam.title = title;
    if (description !== undefined) exam.description = description;
    if (subject !== undefined) exam.subject = subject;

    if (questions) {
      exam.questions = questions;
      let totalMarks = 0;
      questions.forEach(q => {
        totalMarks += q.points || 1;
      });
      exam.settings.totalMarks = totalMarks;
    }

    if (settings) {
      if (settings.duration !== undefined) exam.settings.duration = settings.duration;
      if (settings.passingMarks !== undefined) exam.settings.passingMarks = settings.passingMarks;
      if (settings.shuffleQuestions !== undefined) exam.settings.shuffleQuestions = settings.shuffleQuestions;
      if (settings.shuffleOptions !== undefined) exam.settings.shuffleOptions = settings.shuffleOptions;
      if (settings.showResults !== undefined) exam.settings.showResults = settings.showResults;
      if (settings.allowReview !== undefined) exam.settings.allowReview = settings.allowReview;
      if (settings.maxAttempts !== undefined) exam.settings.maxAttempts = settings.maxAttempts;
      if (settings.safeMode !== undefined) exam.settings.safeMode = settings.safeMode;
      if (settings.maxViolations !== undefined) {
        exam.settings.maxViolations = Math.max(1, Number(settings.maxViolations) || 3);
      }
      if (settings.startDate !== undefined) exam.settings.startDate = settings.startDate;
      if (settings.endDate !== undefined) exam.settings.endDate = settings.endDate;
      if (settings.isPublished !== undefined) exam.settings.isPublished = settings.isPublished;
    }

    await exam.save();

    res.json({
      message: 'Exam updated successfully',
      exam
    });
  } catch (error) {
    console.error('Update exam error:', error);
    res.status(500).json({ message: 'Error updating exam' });
  }
});

// GET SINGLE EXAM FOR EDITING
router.get('/:id/edit', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    }).populate('questions.question');

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exam' });
  }
});

module.exports = router;