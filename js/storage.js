const DB_NAME = 'qingdu';
const DB_VERSION = 1;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('books')) {
        d.createObjectStore('books', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('vocabulary')) {
        const v = d.createObjectStore('vocabulary', { keyPath: 'id' });
        v.createIndex('word', 'word', { unique: false });
        v.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ===== Books =====

function saveBook(book) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('books', 'readwrite');
      tx.objectStore('books').put(book);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function getAllBooks() {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('books', 'readonly');
      const req = tx.objectStore('books').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function getBook(id) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('books', 'readonly');
      const req = tx.objectStore('books').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function deleteBook(id) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('books', 'readwrite');
      tx.objectStore('books').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

// ===== Vocabulary =====

function saveWord(wordData) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('vocabulary', 'readwrite');
      tx.objectStore('vocabulary').put(wordData);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function getAllWords() {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('vocabulary', 'readonly');
      const store = tx.objectStore('vocabulary');
      const idx = store.index('addedAt');
      const req = idx.getAll();
      req.onsuccess = () => resolve((req.result || []).reverse());
      req.onerror = () => reject(req.error);
    });
  });
}

function deleteWord(id) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('vocabulary', 'readwrite');
      tx.objectStore('vocabulary').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function findWord(word) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      const tx = d.transaction('vocabulary', 'readonly');
      const idx = tx.objectStore('vocabulary').index('word');
      const req = idx.getAll(word);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}
