class Stuff {
  constructor() {
    this.env = null;
    this.container = null;
    this.cm = null;
    this.fallbackTextarea = null;
    this.currentFileName = 'stuff.txt';
    this.rawFileText = '';
    this.isEncryptedFile = false;
    this.isDecrypted = false;
    this.isDirty = false;
    this.dirHandle = null;
    this.fileHandle = null;
    this.dbName = 'StuffEditorDB';
    this.storeName = 'secrets';
    this.magicHeader = 'STUFF_ENC_V1:';
  }

  async run(env) {
    if (!env || !env.container) {
      throw new Error('[Stuff] run() requires an environment object with a valid container.');
    }
    this.env = env;
    this.container = env.container;

    await this._loadCodeMirrorDeps();
    this._renderUI();
    await this._initDB();

    const savedPwd = await this._getStoredPassword();
    if (savedPwd) {
      if (this.pwdInput) {
        this.pwdInput.value = savedPwd;
        this.rememberCheckbox.checked = true;
      }
    }

    this._setupShortcuts();
    await this.loadFile(this.currentFileName);
  }

  async _loadCodeMirrorDeps() {
    if (typeof CodeMirror !== 'undefined') return;

    const loadCss = (href) => {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      document.head.appendChild(l);
    };

    const loadScript = (src) => {
      return new Promise((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.head.appendChild(s);
      });
    };

    loadCss('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css');
    loadCss('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/material-darker.min.css');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/markdown/markdown.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js');
  }

  _renderUI() {
    this.container.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'stuff-editor-shell';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'stuff-toolbar';

    // Brand
    const brand = document.createElement('div');
    brand.className = 'stuff-brand';
    brand.innerHTML = `<span>⚡</span><span>Stuff</span>`;

    // File Group
    const fileGroup = document.createElement('div');
    fileGroup.className = 'stuff-group';

    this.filenameInput = document.createElement('input');
    this.filenameInput.className = 'stuff-input';
    this.filenameInput.type = 'text';
    this.filenameInput.value = this.currentFileName;
    this.filenameInput.style.width = '120px';
    this.filenameInput.title = 'Filename to edit / load';
    this.filenameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.loadFile(this.filenameInput.value.trim());
      }
    });

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'stuff-btn';
    reloadBtn.innerHTML = '↻ Reload';
    reloadBtn.title = 'Reload file from server / local path';
    reloadBtn.onclick = () => this.loadFile(this.filenameInput.value.trim());

    const folderBtn = document.createElement('button');
    folderBtn.className = 'stuff-btn';
    folderBtn.innerHTML = '📁 Link Folder';
    folderBtn.title = 'Pick directory to enable 1-click & Ctrl+S saving';
    folderBtn.onclick = () => this.selectFolder();
    this.folderBtn = folderBtn;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'stuff-btn primary';
    saveBtn.innerHTML = '💾 Save';
    saveBtn.title = 'Save file (Ctrl+S / Cmd+S)';
    saveBtn.onclick = () => this.saveFile();

    fileGroup.append(this.filenameInput, reloadBtn, folderBtn, saveBtn);

    // Separator
    const sep = document.createElement('div');
    sep.className = 'stuff-sep';

    // Encryption Group
    const encGroup = document.createElement('div');
    encGroup.className = 'stuff-group';

    this.pwdInput = document.createElement('input');
    this.pwdInput.className = 'stuff-input';
    this.pwdInput.type = 'password';
    this.pwdInput.placeholder = '🔒 Password...';
    this.pwdInput.style.width = '140px';
    this.pwdInput.addEventListener('input', () => {
      if (this.rememberCheckbox.checked) {
        this._setStoredPassword(this.pwdInput.value);
      }
      this._updateBadges();
    });
    this.pwdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.decryptCurrentEditor();
      }
    });

    const togglePwdBtn = document.createElement('button');
    togglePwdBtn.className = 'stuff-btn';
    togglePwdBtn.innerHTML = '👁';
    togglePwdBtn.title = 'Toggle password view';
    togglePwdBtn.onclick = () => {
      this.pwdInput.type = this.pwdInput.type === 'password' ? 'text' : 'password';
    };

    const decryptBtn = document.createElement('button');
    decryptBtn.className = 'stuff-btn';
    decryptBtn.innerHTML = '🔓 Decrypt';
    decryptBtn.title = 'Decrypt editor content with current password';
    decryptBtn.onclick = () => this.decryptCurrentEditor();
    this.decryptBtn = decryptBtn;

    const encryptCheckboxLabel = document.createElement('label');
    encryptCheckboxLabel.className = 'stuff-checkbox-label';
    this.encryptCheckbox = document.createElement('input');
    this.encryptCheckbox.type = 'checkbox';
    encryptCheckboxLabel.append(this.encryptCheckbox, document.createTextNode('Encrypt on Save'));

    const rememberCheckboxLabel = document.createElement('label');
    rememberCheckboxLabel.className = 'stuff-checkbox-label';
    this.rememberCheckbox = document.createElement('input');
    this.rememberCheckbox.type = 'checkbox';
    this.rememberCheckbox.addEventListener('change', () => {
      if (this.rememberCheckbox.checked) {
        this._setStoredPassword(this.pwdInput.value);
      } else {
        this._setStoredPassword('');
      }
    });
    rememberCheckboxLabel.append(this.rememberCheckbox, document.createTextNode('Remember PW'));

    encGroup.append(this.pwdInput, togglePwdBtn, decryptBtn, encryptCheckboxLabel, rememberCheckboxLabel);

    toolbar.append(brand, fileGroup, sep, encGroup);

    // Statusbar
    const statusbar = document.createElement('div');
    statusbar.className = 'stuff-statusbar';

    const leftStatus = document.createElement('div');
    leftStatus.className = 'stuff-group';

    this.fileBadge = document.createElement('span');
    this.fileBadge.className = 'stuff-badge plain';
    this.fileBadge.textContent = this.currentFileName;

    this.encBadge = document.createElement('span');
    this.encBadge.className = 'stuff-badge plain';
    this.encBadge.textContent = 'Plain';

    this.dirtyBadge = document.createElement('span');
    this.dirtyBadge.className = 'stuff-badge plain';
    this.dirtyBadge.textContent = 'Clean';

    leftStatus.append(this.fileBadge, this.encBadge, this.dirtyBadge);

    this.statusMsg = document.createElement('div');
    this.statusMsg.textContent = 'Ready';

    statusbar.append(leftStatus, this.statusMsg);

    // Editor Area
    const editorContainer = document.createElement('div');
    editorContainer.className = 'stuff-editor-container';

    shell.append(toolbar, statusbar, editorContainer);
    this.container.appendChild(shell);

    // Mount CodeMirror or Fallback Textarea
    if (typeof CodeMirror !== 'undefined') {
      this.cm = CodeMirror(editorContainer, {
        value: '',
        mode: 'markdown',
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: true,
        indentUnit: 2,
        tabSize: 2,
      });

      this.cm.on('change', () => {
        this.isDirty = true;
        this._updateBadges();
      });
    } else {
      this.fallbackTextarea = document.createElement('textarea');
      this.fallbackTextarea.className = 'stuff-fallback-textarea';
      this.fallbackTextarea.addEventListener('input', () => {
        this.isDirty = true;
        this._updateBadges();
      });
      editorContainer.appendChild(this.fallbackTextarea);
    }
  }

  _setupShortcuts() {
    this._keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveFile();
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  getEditorText() {
    if (this.cm) return this.cm.getValue();
    if (this.fallbackTextarea) return this.fallbackTextarea.value;
    return '';
  }

  setEditorText(text) {
    if (this.cm) {
      this.cm.setValue(text);
      this.cm.clearHistory();
    } else if (this.fallbackTextarea) {
      this.fallbackTextarea.value = text;
    }
    this.isDirty = false;
    this._updateBadges();
  }

  async loadFile(fileName) {
    this.currentFileName = fileName || 'stuff.txt';
    this.filenameInput.value = this.currentFileName;
    this.statusMsg.textContent = `Loading ${this.currentFileName}...`;

    try {
      const resp = await fetch(this.currentFileName, { cache: 'no-cache' });
      if (!resp.ok) {
        throw new Error(`Server returned HTTP ${resp.status} (${resp.statusText})`);
      }
      const text = await resp.text();
      this.rawFileText = text;

      if (this.isEncrypted(text)) {
        this.isEncryptedFile = true;
        this.encryptCheckbox.checked = true;

        const pwd = this.pwdInput.value;
        if (pwd) {
          try {
            const dec = await this.decrypt(text, pwd);
            this.setEditorText(dec);
            this.isDecrypted = true;
            this.statusMsg.textContent = `Loaded & decrypted ${this.currentFileName}.`;
          } catch (err) {
            this.setEditorText(text);
            this.isDecrypted = false;
            this.statusMsg.textContent = `File is encrypted. Incorrect saved password.`;
          }
        } else {
          this.setEditorText(text);
          this.isDecrypted = false;
          this.statusMsg.textContent = `File is encrypted. Enter password and click Decrypt.`;
        }
      } else {
        this.isEncryptedFile = false;
        this.isDecrypted = false;
        this.setEditorText(text);
        this.statusMsg.textContent = `Loaded ${this.currentFileName} (${text.length} chars).`;
      }
    } catch (err) {
      this.rawFileText = '';
      this.setEditorText('');
      this.isEncryptedFile = false;
      this.isDecrypted = false;
      this.statusMsg.textContent = `Could not fetch ${this.currentFileName}: ${err.message}. Ready to create new.`;
    }

    this._updateBadges();
  }

  async decryptCurrentEditor() {
    const pwd = this.pwdInput.value;
    if (!pwd) {
      alert('Please enter a password first.');
      this.pwdInput.focus();
      return;
    }

    const currentText = this.getEditorText();
    if (!this.isEncrypted(currentText)) {
      this.statusMsg.textContent = 'Content is already in plain text.';
      return;
    }

    try {
      const dec = await this.decrypt(currentText, pwd);
      this.setEditorText(dec);
      this.isDecrypted = true;
      this.encryptCheckbox.checked = true;
      this.statusMsg.textContent = 'Decrypted successfully.';
      if (this.rememberCheckbox.checked) {
        await this._setStoredPassword(pwd);
      }
    } catch (err) {
      alert('Decryption failed: ' + err.message);
      this.statusMsg.textContent = 'Decryption failed: wrong password.';
    }

    this._updateBadges();
  }

  async selectFolder() {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support the File System Access Directory Picker API. You can still use the regular Save button.');
      return;
    }

    try {
      this.dirHandle = await window.showDirectoryPicker();
      this.folderBtn.innerHTML = `📁 ${this.dirHandle.name}`;
      this.folderBtn.classList.add('primary');
      this.statusMsg.textContent = `Linked folder "${this.dirHandle.name}". Saves will write directly to disk.`;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        alert('Could not link directory: ' + err.message);
      }
    }
  }

  async saveFile() {
    const rawContent = this.getEditorText();
    let contentToSave = rawContent;
    const shouldEncrypt = this.encryptCheckbox.checked;
    const pwd = this.pwdInput.value;

    if (shouldEncrypt) {
      if (!pwd) {
        alert('Encryption is enabled but no password was entered. Please provide a password before saving.');
        this.pwdInput.focus();
        return;
      }
      try {
        contentToSave = await this.encrypt(rawContent, pwd);
        if (this.rememberCheckbox.checked) {
          await this._setStoredPassword(pwd);
        }
      } catch (err) {
        alert('Encryption failed: ' + err.message);
        return;
      }
    }

    const fileName = this.filenameInput.value.trim() || 'stuff.txt';
    this.currentFileName = fileName;

    try {
      // Direct directory handle write
      if (this.dirHandle) {
        const fileHandle = await this.dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(contentToSave);
        await writable.close();
        this.isDirty = false;
        this.statusMsg.textContent = `Saved ${fileName} directly into folder "${this.dirHandle.name}".`;
        this._updateBadges();
        return;
      }

      // File System Access showSaveFilePicker
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'Text Files',
            accept: { 'text/plain': ['.txt', '.md', '.json', '.js', '.html'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(contentToSave);
        await writable.close();
        this.isDirty = false;
        this.statusMsg.textContent = `Saved ${fileName} to disk.`;
        this._updateBadges();
        return;
      }

      // Fallback: browser download
      this._downloadFallback(fileName, contentToSave);
      this.isDirty = false;
      this.statusMsg.textContent = `Downloaded ${fileName}. Place it in the app directory.`;
      this._updateBadges();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        alert('Save error: ' + err.message);
      }
    }
  }

  _downloadFallback(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 500);
  }

  _updateBadges() {
    this.fileBadge.textContent = this.currentFileName;

    const editorVal = this.getEditorText();
    const currentlyEncrypted = this.isEncrypted(editorVal);

    if (currentlyEncrypted) {
      this.encBadge.className = 'stuff-badge encrypted';
      this.encBadge.textContent = 'Encrypted (Locked)';
      this.decryptBtn.style.display = 'inline-flex';
    } else if (this.encryptCheckbox.checked) {
      this.encBadge.className = 'stuff-badge decrypted';
      this.encBadge.textContent = 'Auto-Encrypt on Save';
      this.decryptBtn.style.display = 'none';
    } else {
      this.encBadge.className = 'stuff-badge plain';
      this.encBadge.textContent = 'Plain Text';
      this.decryptBtn.style.display = 'none';
    }

    if (this.isDirty) {
      this.dirtyBadge.className = 'stuff-badge unsaved';
      this.dirtyBadge.textContent = 'Unsaved Changes';
    } else {
      this.dirtyBadge.className = 'stuff-badge plain';
      this.dirtyBadge.textContent = 'Saved';
    }
  }

  // Web Crypto AES-GCM 256
  isEncrypted(str) {
    return typeof str === 'string' && str.startsWith(this.magicHeader);
  }

  async _deriveKey(password, saltUint8) {
    const enc = new TextEncoder();
    const passKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltUint8,
        iterations: 100000,
        hash: 'SHA-256',
      },
      passKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this._deriveKey(password, salt);

    const enc = new TextEncoder();
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );

    const b64Salt = this._u8ToBase64(salt);
    const b64Iv = this._u8ToBase64(iv);
    const b64Cipher = this._u8ToBase64(new Uint8Array(cipherBuffer));

    return `${this.magicHeader}${b64Salt}:${b64Iv}:${b64Cipher}`;
  }

  async decrypt(cipherString, password) {
    if (!this.isEncrypted(cipherString)) return cipherString;
    const parts = cipherString.substring(this.magicHeader.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted payload format.');
    }

    const salt = this._base64ToU8(parts[0]);
    const iv = this._base64ToU8(parts[1]);
    const cipherData = this._base64ToU8(parts[2]);

    const key = await this._deriveKey(password, salt);

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        cipherData
      );
      const dec = new TextDecoder();
      return dec.decode(decryptedBuffer);
    } catch (err) {
      throw new Error('Incorrect password or corrupt ciphertext.');
    }
  }

  _u8ToBase64(u8) {
    let binary = '';
    const len = u8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    return btoa(binary);
  }

  _base64ToU8(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      u8[i] = binary.charCodeAt(i);
    }
    return u8;
  }

  // IndexedDB Helper
  _initDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve();
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }

  _getStoredPassword() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve('');
      const req = indexedDB.open(this.dbName, 1);
      req.onsuccess = (e) => {
        try {
          const db = e.target.result;
          const tx = db.transaction(this.storeName, 'readonly');
          const store = tx.objectStore(this.storeName);
          const getReq = store.get('saved_editor_password');
          getReq.onsuccess = () => resolve(getReq.result || '');
          getReq.onerror = () => resolve('');
        } catch (_) {
          resolve('');
        }
      };
      req.onerror = () => resolve('');
    });
  }

  _setStoredPassword(pwd) {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve();
      const req = indexedDB.open(this.dbName, 1);
      req.onsuccess = (e) => {
        try {
          const db = e.target.result;
          const tx = db.transaction(this.storeName, 'readwrite');
          const store = tx.objectStore(this.storeName);
          if (pwd) {
            store.put(pwd, 'saved_editor_password');
          } else {
            store.delete('saved_editor_password');
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch (_) {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  }

  onResize() {
    if (this.cm) {
      this.cm.refresh();
    }
  }

  destroy() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
    if (this.cm) {
      this.cm.toTextArea?.();
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

globalThis.Stuff = Stuff;
if (typeof module !== 'undefined' && module.exports) module.exports = Stuff;