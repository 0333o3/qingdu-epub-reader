const DB_NAME = 'qingdu';
const DB_VERSION = 1;

let db = null;
let dbPromise = null;

function openDB() {
  // If we already have a valid connection, return it
  if (db) return Promise.resolve(db);

  // If a connection attempt is in progress, return that promise
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
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

    req.onsuccess = e => {
      db = e.target.result;
      dbPromise = null;

      // If connection closes, reset so we reconnect next time
      db.onclose = () => {
        db = null;
        dbPromise = null;
      };
      db.onversionchange = () => {
        if (db) { db.close(); db = null; dbPromise = null; }
      };

      resolve(db);
    };

    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };

    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('Database blocked'));
    };
  });

  return dbPromise;
}

// Helper: run a transaction with retry on connection-loss errors
function withTx(storeName, mode, fn) {
  return openDB().then(d => {
    return new Promise((resolve, reject) => {
      try {
        const tx = d.transaction(storeName, mode);
        const result = fn(tx, d);
        tx.oncomplete = () => resolve(result !== undefined ? result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
      } catch (err) {
        // Connection was closed - reset and retry once
        if (err.message && err.message.includes('closing')) {
          db = null;
          dbPromise = null;
          openDB().then(d2 => {
            const tx = d2.transaction(storeName, mode);
            const retryResult = fn(tx, d2);
            tx.oncomplete = () => resolve(retryResult !== undefined ? retryResult : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
          }).catch(reject);
        } else {
          reject(err);
        }
      }
    });
  });
}

// ===== Books =====

function saveBook(book) {
  return withTx('books', 'readwrite', tx => {
    tx.objectStore('books').put(book);
  });
}

function getAllBooks() {
  return withTx('books', 'readonly', tx => {
    const req = tx.objectStore('books').getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function getBook(id) {
  return withTx('books', 'readonly', tx => {
    const req = tx.objectStore('books').get(id);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function deleteBook(id) {
  return withTx('books', 'readwrite', tx => {
    tx.objectStore('books').delete(id);
  });
}

// ===== Vocabulary =====

function saveWord(wordData) {
  return withTx('vocabulary', 'readwrite', tx => {
    tx.objectStore('vocabulary').put(wordData);
  });
}

function getAllWords() {
  return withTx('vocabulary', 'readonly', tx => {
    const store = tx.objectStore('vocabulary');
    const idx = store.index('addedAt');
    const req = idx.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve((req.result || []).reverse());
      req.onerror = () => reject(req.error);
    });
  });
}

function deleteWord(id) {
  return withTx('vocabulary', 'readwrite', tx => {
    tx.objectStore('vocabulary').delete(id);
  });
}

function findWord(word) {
  return withTx('vocabulary', 'readonly', tx => {
    const idx = tx.objectStore('vocabulary').index('word');
    const req = idx.getAll(word);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}
