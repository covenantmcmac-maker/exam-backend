/**
 * In-memory stand-in for mongoose used by scripts/route-logic-test.js.
 *
 * Implements exactly the query surface the Express routes use (find, findOne,
 * countDocuments, populate chains, saves, deletes, a small aggregate) so the
 * monetisation logic can be exercised without a running MongoDB.
 *
 * This is a TEST DOUBLE, not a database. It does not enforce unique indexes,
 * validation or transactions.
 */
const bcrypt = require('bcryptjs');

/* ------------------------------------------------------------ collection */

const collections = new Map(); // modelName -> array of docs

function coll(name) {
  if (!collections.has(name)) collections.set(name, []);
  return collections.get(name);
}

/* --------------------------------------------------------------- matcher */

function getPath(doc, path) {
  if (path === '_id') return doc._id;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), doc);
}

function matches(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((clause) => matches(doc, clause));

    const value = getPath(doc, key);

    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      // Operator object: { $ne, $in, $regex, $eq, … }
      for (const [op, operand] of Object.entries(cond)) {
        if (op === '$ne') {
          if (looseEq(value, operand)) return false;
        } else if (op === '$in') {
          if (!operand.some((o) => looseEq(value, o))) return false;
        } else if (op === '$regex') {
          const re = operand instanceof RegExp ? operand : new RegExp(operand, 'i');
          if (!re.test(String(value ?? ''))) return false;
        } else if (op === '$eq') {
          if (!looseEq(value, operand)) return false;
        } else if (op === '$gt') {
          if (!(Number(value) > Number(operand))) return false;
        } else if (op === '$gte') {
          if (!(Number(value) >= Number(operand))) return false;
        } else if (op === '$lt') {
          if (!(Number(value) < Number(operand))) return false;
        } else if (op === '$lte') {
          if (!(Number(value) <= Number(operand))) return false;
        } else {
          throw new Error(`stub matcher: unsupported operator ${op}`);
        }
      }
      return true;
    }

    return looseEq(value, cond);
  });
}

/** null and undefined are considered equal; ids compare by string value. */
function looseEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' && typeof b === 'object' && a.toString === b.toString) {
    return a.toString() === b.toString();
  }
  return String(a) === String(b);
}

/* ------------------------------------------------------------- pipeline */

function evalExpr(expr, doc) {
  if (expr === null || expr === undefined) return expr;
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return getPath(doc, expr.slice(1));
  }
  if (Array.isArray(expr)) {
    return expr.map((e) => evalExpr(e, doc));
  }
  if (typeof expr === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(expr)) out[k] = evalExpr(v, doc);
    return out;
  }
  return expr;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function evalCond(cond, doc) {
  const [op, ...args] = Object.entries(cond)[0];
  const [l, r] = args.map((a) => evalExpr(a, doc));
  switch (op) {
    case '$eq': return looseEq(l, r);
    case '$ne': return !looseEq(l, r);
    case '$gt': return Number(l) > Number(r);
    case '$gte': return Number(l) >= Number(r);
    case '$lt': return Number(l) < Number(r);
    case '$lte': return Number(l) <= Number(r);
    default: throw new Error(`stub aggregate: unsupported cond ${op}`);
  }
}

/* ------------------------------------------------------------- defaults */

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])
    ) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function withDefaults(def, body) {
  const out = {};
  if (def && typeof def === 'object' && !Array.isArray(def) && !('type' in def)) {
    for (const [key, sub] of Object.entries(def)) {
      if (Array.isArray(sub)) {
        out[key] = body?.[key] ?? [];
      } else if (sub && typeof sub === 'object' && !Array.isArray(sub) && !('type' in sub)) {
        out[key] = withDefaults(sub, body?.[key]);
      } else if (sub && typeof sub === 'object' && 'default' in sub) {
        out[key] = typeof sub.default === 'function' ? sub.default() : sub.default;
      }
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body)
    ? deepMerge(out, body)
    : out;
}

/* ---------------------------------------------------------------- model */

let idCounter = 0;

/** Clone for query results: keeps model prototypes so instance methods such
 *  as toObject() work; nested plain data is copied so populate/save never
 *  mutate the store. */
function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (v && typeof v === 'object') {
    if (v instanceof Date || v.constructor !== Object) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deepClone(x);
    return out;
  }
  return v;
}

/** Full plain-object clone (drops prototypes) — used when field projection
 *  needs to delete nested paths without touching the stored document. */
function plainDeepClone(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (seen.has(v)) return seen.get(v);
  if (Array.isArray(v)) {
    const a = [];
    seen.set(v, a);
    for (const x of v) a.push(plainDeepClone(x, seen));
    return a;
  }
  const out = {};
  seen.set(v, out);
  for (const [k, x] of Object.entries(v)) out[k] = plainDeepClone(x, seen);
  return out;
}

function makeModel(name, schemaDef) {
  class Model {
    constructor(body = {}) {
      Object.assign(this, withDefaults(schemaDef.def, body));
      this._id = body._id ?? `id_${name}_${++idCounter}`;
      Object.defineProperty(this, '_modified', {
        value: new Set(),
        writable: true,
        enumerable: false,
      });
      Object.defineProperty(this, '__saved', { value: false, writable: true, enumerable: false });
    }

    isModified(field) {
      return field ? this._modified.has(field) : this._modified.size > 0;
    }

    async save() {
      // Hook into the schema's pre('save') middleware (User hashing).
      if (schemaDef._pre && schemaDef._pre.save) {
        await schemaDef._pre.save.call(this, () => {});
      }
      const list = coll(name);
      const idx = list.findIndex((d) => looseEq(d._id, this._id));
      if (idx === -1) list.push(this);
      else list[idx] = this;
      this.__saved = true;
      return this;
    }

    toObject() {
      const out = {};
      for (const [k, v] of Object.entries(this)) {
        if (k.startsWith('__') || k === '_modified') continue;
        out[k] = v && typeof v.toObject === 'function' ? v.toObject() : v;
      }
      return out;
    }

    async comparePassword(candidate) {
      if (typeof this.password !== 'string') return false;
      return bcrypt.compare(candidate, this.password);
    }
  }

  // Schema-declared instance methods (e.g. User.comparePassword).
  if (schemaDef.methods) {
    for (const [m, fn] of Object.entries(schemaDef.methods)) {
      Model.prototype[m] = fn;
    }
  }

  const deletePath = (obj, path) => {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (Array.isArray(cur)) {
        cur.forEach((item) => deletePath(item, keys.slice(i).join('.')));
        return;
      }
      cur = cur?.[keys[i]];
      if (cur == null) return;
    }
    if (cur && Array.isArray(cur)) {
      cur.forEach((item) => delete item[keys[keys.length - 1]]);
    } else if (cur) {
      delete cur[keys[keys.length - 1]];
    }
  };

  const applySelect = (doc, select) => {
    if (!select) return doc;
    const fields = String(select).trim().split(/\s+/).filter(Boolean);
    const exclude = fields.every((f) => f.startsWith('-'));
    if (exclude) {
      const removed = fields.map((f) => f.slice(1));
      // Deep-clone so nested deletions never touch the stored document.
      const out = plainDeepClone(doc);
      for (const f of removed) deletePath(out, f);
      return out;
    }
    const out = { _id: doc._id };
    for (const f of fields) {
      const val = getPath(doc, f);
      if (val !== undefined) setPath(out, f, val);
    }
    return out;
  };

  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      cur[keys[i]] = cur[keys[i]] ?? {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  };

  const populateDoc = (doc, spec) => {
    if (!spec) return doc;
    const { path, select, populate: nested } =
      typeof spec === 'string' ? { path: spec } : spec;

    if (path.includes('.')) {
      // Nested array path like questions.question
      const [arrPath, field] = path.split('.');
      const arr = doc[arrPath];
      if (Array.isArray(arr)) {
        const Target = models[field === 'question' ? 'Question' : field];
        arr.forEach((entry) => {
          if (entry && entry[field]) {
            const found = Target && coll(Target.modelName).find((d) => looseEq(d._id, entry[field]));
            if (found) {
              entry[field] = applySelect(found, select);
              if (nested) entry[field] = populateDoc(entry[field], nested);
            }
          }
        });
      }
      return doc;
    }

    const id = doc[path];
    if (id == null) return doc;
    const REF_TARGETS = { creator: 'User', student: 'User', exam: 'Exam', question: 'Question' };
    const targetName = REF_TARGETS[path];
    const Target = targetName ? models[targetName] : undefined;
    const found = Target ? coll(Target.modelName).find((d) => looseEq(d._id, id)) : undefined;
    if (found) {
      doc[path] = applySelect(found, select);
      if (nested) doc[path] = populateDoc(doc[path], nested);
    }
    return doc;
  };

  const runQuery = (filter, { select, sort, skip, limit, populate } = {}) => {
    // Clone each stored doc (keeping the model prototype so instance methods
    // such as toObject() work) — populate mutates the query result, never
    // the store, just like real mongoose.
    let docs = coll(name).filter((d) => matches(d, filter)).map((d) => {
      const clone = Object.create(Object.getPrototypeOf(d));
      for (const [k, v] of Object.entries(d)) {
        if (k.startsWith('__') || k === '_modified') continue;
        clone[k] = deepClone(v);
      }
      return clone;
    });
    for (const spec of populate || []) docs = docs.map((d) => populateDoc(d, spec));
    if (sort) {
      const keys = Object.keys(sort);
      docs.sort((a, b) => {
        for (const key of keys) {
          const dir = sort[key] < 0 ? -1 : 1;
          const av = getPath(a, key);
          const bv = getPath(b, key);
          let cmp;
          if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
          else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
          if (cmp !== 0) return cmp * dir;
        }
        return 0;
      });
    }
    if (skip) docs = docs.slice(skip);
    if (limit !== undefined && limit !== null) docs = docs.slice(0, limit);
    if (select) docs = docs.map((d) => applySelect(d, select));
    return docs;
  };

  Model.modelName = name;
  Model.collection = coll(name);

  Model.find = (filter = {}, opts = {}) => {
    const state = { filter, select: null, sort: null, skip: 0, limit: null, populate: [] };
    const chain = {
      select: (s) => { state.select = s; return chain; },
      sort: (s) => { state.sort = s; return chain; },
      skip: (n) => { state.skip = n; return chain; },
      limit: (n) => { state.limit = n; return chain; },
      populate: (spec) => { state.populate.push(spec); return chain; },
      then: (resolve, reject) => Promise.resolve(runQuery(state.filter, state)).then(resolve, reject),
    };
    return chain;
  };

  Model.findOne = (filter = {}, opts = {}) => {
    const state = { filter, select: null, populate: [] };
    const chain = {
      select: (s) => { state.select = s; return chain; },
      sort: () => chain,
      populate: (spec) => { state.populate.push(spec); return chain; },
      then: (resolve, reject) => {
        const docs = runQuery(state.filter, { select: state.select, populate: state.populate });
        return Promise.resolve(docs[0] ?? null).then(resolve, reject);
      },
    };
    return chain;
  };

  Model.findById = (id, opts) => Model.findOne({ _id: id }, opts);
  Model.findByIdAndUpdate = (id, update, opts = {}) => {
    const doc = coll(name).find((d) => looseEq(d._id, id));
    if (!doc) return Promise.resolve(null);
    applyUpdate(doc, update);
    if (opts.new !== false) return Promise.resolve(opts.select ? applySelect(doc, opts.select) : doc);
    return Promise.resolve(doc);
  };
  Model.findOneAndUpdate = (filter, update, opts = {}) => {
    const doc = coll(name).find((d) => matches(d, filter)) ?? null;
    if (!doc) return Promise.resolve(null);
    applyUpdate(doc, update);
    return Promise.resolve(opts.select ? applySelect(doc, opts.select) : doc);
  };
  Model.findOneAndDelete = (filter) => {
    const idx = coll(name).findIndex((d) => matches(d, filter));
    if (idx === -1) return Promise.resolve(null);
    return Promise.resolve(coll(name).splice(idx, 1)[0]);
  };
  Model.findByIdAndDelete = (id) => Model.findOneAndDelete({ _id: id });
  Model.deleteMany = (filter = {}) => {
    const before = coll(name).length;
    const remaining = coll(name).filter((d) => !matches(d, filter));
    collections.set(name, remaining);
    return Promise.resolve({ deletedCount: before - remaining.length });
  };
  Model.countDocuments = (filter = {}) =>
    Promise.resolve(coll(name).filter((d) => matches(d, filter)).length);
  Model.insertMany = (docs) => {
    const saved = docs.map((d) => {
      const m = new Model(d);
      m.__saved = true;
      coll(name).push(m);
      return m;
    });
    return Promise.resolve(saved);
  };
  Model.aggregate = (pipeline) => {
    let rows = coll(name).map((d) => ({ ...d }));
    for (const stage of pipeline) {
      if (stage.$match) {
        rows = rows.filter((r) => matches(r, stage.$match));
      } else if (stage.$group) {
        const out = {};
        for (const row of rows) {
          const key = String(evalExpr(stage.$group._id, row));
          const bucket = (out[key] = out[key] ?? { _id: key });
          for (const [field, spec] of Object.entries(stage.$group)) {
            if (field === '_id') continue;
            if (spec.$sum !== undefined) {
              const operand = spec.$sum;
              bucket[field] = (bucket[field] ?? 0) + sumValue(operand, row);
            } else {
              bucket[field] = evalExpr(spec, row);
            }
          }
        }
        rows = Object.values(out);
      } else {
        throw new Error(`stub aggregate: unsupported stage ${Object.keys(stage)[0]}`);
      }
    }
    return Promise.resolve(rows);
  };

  const sumValue = (operand, row) => {
    if (typeof operand === 'string' && operand.startsWith('$')) return Number(getPath(row, operand.slice(1))) || 0;
    if (operand && typeof operand === 'object' && operand.$cond) {
      const [cond, thenVal, elseVal] = operand.$cond;
      return truthy(evalExpr(cond, row)) ? Number(evalExpr(thenVal, row)) : Number(evalExpr(elseVal, row));
    }
    return Number(operand) || 0;
  };

  return Model;
}

function applyUpdate(doc, update) {
  for (const [k, v] of Object.entries(update)) {
    if (k === '$set') {
      for (const [sk, sv] of Object.entries(v)) {
        setPath(doc, sk, sv);
      }
    } else {
      setPath(doc, k, v);
    }
  }
}

/* --------------------------------------------------------------- exports */

const models = {};

function Schema(def) {
  this.def = def;
  this.methods = {};
  this._pre = {};
}
Schema.prototype.pre = function (hook, fn) {
  this._pre[hook] = fn;
  return this;
};
Schema.prototype.method = function (name, fn) {
  this.methods[name] = fn;
  return this;
};
Schema.prototype.index = function () {
  return this; // index definitions are irrelevant to the in-memory stub
};
Schema.Types = { ObjectId: function ObjectId() {} };

const stub = {
  Schema,
  SchemaTypes: {},
  model(name, schema) {
    if (schema) {
      const Model = makeModel(name, schema);
      models[name] = Model;
      return Model;
    }
    return models[name];
  },
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  Types: { ObjectId: function ObjectId() {} },
  mongo: {},
  connection: { readyState: 1 },
};

module.exports = { stub, models, collections };
