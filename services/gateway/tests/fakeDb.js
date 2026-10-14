const { ObjectId } = require('mongodb');
function fakeDb() {
  const tables = new Map();
  const values = (doc, key) => key.split('.').reduce((list, part) => list.flatMap(value => Array.isArray(value) ? value.map(item => item?.[part]) : [value?.[part]]), [doc]);
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(doc, part));
    const candidates = values(doc, key);
    if (value instanceof RegExp) return candidates.some(v => value.test(String(v)));
    if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
      return Object.entries(value).every(([op, test]) => {
        if (op === '$exists') return candidates.some(v => v !== undefined) === test;
        if (op === '$gt') return candidates.some(v => v > test);
        if (op === '$in') return candidates.some(v => test.includes(v));
        if (op === '$not') return !candidates.some(v => test.test(String(v)));
        return false;
      });
    }
    return candidates.some(v => String(v) === String(value));
  });
  return {
    tables, matches,
    collection(name) {
      if (!tables.has(name)) tables.set(name, []);
      const list = tables.get(name);
      const remove = query => { const index = list.findIndex(doc => matches(doc, query)); return index < 0 ? null : list.splice(index, 1)[0]; };
      return {
        findOne: async query => list.find(doc => matches(doc, query)) || null,
        findOneAndDelete: async query => remove(query),
        find(query = {}) { const cursor = { sort() { return cursor; }, limit() { return cursor; }, skip() { return cursor; }, project() { return cursor; }, async toArray() { return list.filter(doc => matches(doc, query)); } }; return cursor; },
        async insertOne(doc) { const value = { ...doc, _id: doc._id || new ObjectId() }; if (list.some(old => String(old._id) === String(value._id))) throw new Error('duplicate _id'); list.push(value); return { insertedId: value._id }; },
        async updateOne(query, update, options = {}) { let doc = list.find(item => matches(item, query)); if (!doc && options.upsert) { doc = { ...query, ...update.$setOnInsert }; if (list.some(old => String(old._id) === String(doc._id))) throw new Error('duplicate _id'); list.push(doc); } if (doc) { Object.assign(doc, update.$set); for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value; } return { matchedCount: doc ? 1 : 0 }; },
        async updateMany(query, update) { list.filter(doc => matches(doc, query)).forEach(doc => Object.assign(doc, update.$set)); return {}; },
        async deleteOne(query) { return { deletedCount: remove(query) ? 1 : 0 }; },
        async deleteMany(query) { let deletedCount = 0; while (remove(query)) deletedCount++; return { deletedCount }; },
        async countDocuments(query) { return list.filter(doc => matches(doc, query)).length; },
        async createIndex() {},
      };
    },
  };
}
module.exports = fakeDb;
