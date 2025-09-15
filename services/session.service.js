// src/services/session.service.js
const TTL_MS = 2 * 60 * 60 * 1000; 
const store = new Map();

function _empty() {
  return {
    region: 'med',      
    crop: null,
    intent: null,
    disease: null,
    pest: null,
    updatedAt: Date.now(),
  };
}

function getCtx(userId) {
  const s = store.get(userId);
  if (!s) {
    const v = _empty();
    store.set(userId, v);
    return v;
  }
  if (Date.now() - s.updatedAt > TTL_MS) {
    const v = _empty();
    store.set(userId, v);
    return v;
  }
  return s;
}

function setCtx(userId, patch) {
  const cur = getCtx(userId);
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  store.set(userId, next);
  return next;
}

function clearCtx(userId) {
  store.delete(userId);
}

module.exports = { getCtx, setCtx, clearCtx };
