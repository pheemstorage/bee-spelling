/**
 * Bee Spelling — Companion Google Apps Script Google Drive Sync Bridge
 *
 * Direct Zero-Login Google Drive Folder Sync:
 * Syncs units/, progress/, analytics/, and config/ JSON files directly inside
 * ROOT_FOLDER_ID with LockService concurrency protection and CacheService manifest indexing.
 *
 * Transport note (CORS & Redirect Compatibility):
 * Browser clients call this web app using a CORS "simple request":
 *   fetch(bridgeUrl, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'text/plain;charset=utf-8' },
 *     body: JSON.stringify(payload),
 *     redirect: 'follow'
 *   })
 * Using text/plain avoids an OPTIONS preflight request and allows browsers
 * (including iOS Safari) to follow Google's 302 redirect cleanly.
 *
 * Deployment steps:
 * 1. Create a new project at https://script.google.com and paste this entire file.
 * 2. Click Deploy -> New deployment -> Select type: Web app.
 * 3. Set "Execute as: Me" and "Who has access: Anyone".
 * 4. Authorize Drive access and copy the Web App URL into config.local.js
 *    (DRIVE_SYNC_WEBAPP_URL) or into Bee Spelling's Settings -> Vault.
 */

// Paste your Google Drive Folder ID below (or set 'ROOT_FOLDER_ID' in Script Properties):
const ROOT_FOLDER_ID = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties && PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID')) || 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE';
const FOLDER_CACHE_TTL_SECONDS = 21600; // 6 hours

const ALLOWED_CLIENT_PATHS = [
  /^units\/units_index\.json$/,
  /^units\/unit_[A-Za-z0-9_-]{1,64}\.json$/,
  /^progress\/user_progress\.json$/,
  /^analytics\/mistake_history\.json$/,
  /^analytics\/gemini_reports\.json$/,
  /^config\/app_settings\.json$/,
  /^backup\/user_data_backup\.json$/,
  /^backup\/backup_[A-Za-z0-9_-]{1,64}\.json$/
];

const DELETABLE_CLIENT_PATHS = [
  /^units\/unit_[A-Za-z0-9_-]{1,64}\.json$/
];

/**
 * Health check endpoint for browser visits and GET diagnostics.
 */
function doGet() {
  try {
    var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    return jsonResponse({
      ok: true,
      data: {
        service: 'Bee Spelling Google Drive Sync Bridge',
        rootFolderId: ROOT_FOLDER_ID,
        folderName: rootFolder.getName()
      }
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'bridge_error',
      detail: safeErrorMessage(err)
    });
  }
}

/**
 * Primary RPC endpoint. Never throws an uncaught exception or returns HTML.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      return jsonResponse({ ok: false, error: 'missing_body' });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (_) {
      return jsonResponse({ ok: false, error: 'invalid_json' });
    }

    if (!payload || typeof payload !== 'object') {
      return jsonResponse({ ok: false, error: 'invalid_payload' });
    }

    // Optional root folder match check
    if (payload.folderId && String(payload.folderId).trim() !== ROOT_FOLDER_ID) {
      return jsonResponse({ ok: false, error: 'folder_mismatch' });
    }

    var action = String(payload.action || '').trim();
    var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);

    switch (action) {
      case 'ping':
        return jsonResponse({
          ok: true,
          data: {
            message: 'Bee Spelling Google Drive bridge is running',
            rootFolderId: ROOT_FOLDER_ID,
            folderName: rootFolder.getName()
          }
        });

      case 'manifest':
        return handleManifest(rootFolder);

      case 'readFile':
        return handleReadFile(rootFolder, payload.path);

      case 'batchRead':
        return handleBatchRead(rootFolder, payload.paths);

      case 'writeFile':
        return withScriptLock(function () {
          return handleWriteFile(rootFolder, payload.path, payload.content);
        });

      case 'batchWrite':
        return withScriptLock(function () {
          return handleBatchWrite(rootFolder, payload.files, payload.deletes);
        });

      case 'deleteFile':
        return withScriptLock(function () {
          return handleDeleteFile(rootFolder, payload.path);
        });

      default:
        return jsonResponse({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'internal_error',
      detail: safeErrorMessage(err)
    });
  }
}

/* ==========================================================================
 * GOOGLE DRIVE FILE SYNC ACTIONS
 * ========================================================================== */

function handleManifest(rootFolder) {
  var filesMap = getOrBuildManifestMap(rootFolder);
  return jsonResponse({
    ok: true,
    data: {
      rootFolderId: ROOT_FOLDER_ID,
      files: filesMap
    }
  });
}

function handleReadFile(rootFolder, rawPath) {
  var safePath = validateAllowedPath(rawPath, ALLOWED_CLIENT_PATHS);
  if (!safePath) {
    return jsonResponse({ ok: false, error: 'forbidden_path' });
  }

  var parts = safePath.split('/');
  var subFolder = getOrCreateChildFolder(rootFolder, parts[0], 'root_sub:' + parts[0]);
  var content = readJsonFromFolder(subFolder, parts[1]);

  return jsonResponse({
    ok: true,
    data: {
      path: safePath,
      exists: content !== null,
      content: content
    }
  });
}

function handleBatchRead(rootFolder, rawPaths) {
  if (!Array.isArray(rawPaths) || rawPaths.length > 60) {
    return jsonResponse({ ok: false, error: 'invalid_paths' });
  }

  var out = {};
  for (var i = 0; i < rawPaths.length; i++) {
    var safePath = validateAllowedPath(rawPaths[i], ALLOWED_CLIENT_PATHS);
    if (!safePath) {
      return jsonResponse({ ok: false, error: 'forbidden_path' });
    }
    var parts = safePath.split('/');
    var subFolder = getOrCreateChildFolder(rootFolder, parts[0], 'root_sub:' + parts[0]);
    out[safePath] = readJsonFromFolder(subFolder, parts[1]);
  }

  return jsonResponse({
    ok: true,
    data: {
      files: out
    }
  });
}

function handleWriteFile(rootFolder, rawPath, contentObj) {
  var safePath = validateAllowedPath(rawPath, ALLOWED_CLIENT_PATHS);
  if (!safePath) {
    return jsonResponse({ ok: false, error: 'forbidden_path' });
  }

  var parsed = coerceJsonObject(contentObj);
  if (!parsed) {
    return jsonResponse({ ok: false, error: 'invalid_content' });
  }

  var ts = extractTimestamp(parsed);
  var parts = safePath.split('/');
  var subFolder = getOrCreateChildFolder(rootFolder, parts[0], 'root_sub:' + parts[0]);
  writeRawFile(subFolder, parts[1], JSON.stringify(parsed), MimeType.PLAIN_TEXT);

  var manifestMap = getOrBuildManifestMap(rootFolder);
  manifestMap[safePath] = ts;
  saveManifestMap(rootFolder, manifestMap);

  return jsonResponse({
    ok: true,
    data: {
      path: safePath,
      lastUpdated: ts
    }
  });
}

function handleBatchWrite(rootFolder, rawFiles, rawDeletes) {
  var filesList = Array.isArray(rawFiles) ? rawFiles : [];
  var deletesList = Array.isArray(rawDeletes) ? rawDeletes : [];

  if (filesList.length > 50 || deletesList.length > 50) {
    return jsonResponse({ ok: false, error: 'batch_too_large' });
  }

  var validatedWrites = [];
  for (var i = 0; i < filesList.length; i++) {
    var item = filesList[i];
    if (!item || typeof item !== 'object') {
      return jsonResponse({ ok: false, error: 'invalid_batch_item' });
    }
    var safePath = validateAllowedPath(item.path, ALLOWED_CLIENT_PATHS);
    if (!safePath) {
      return jsonResponse({ ok: false, error: 'forbidden_path' });
    }
    var parsed = coerceJsonObject(item.content);
    if (!parsed) {
      return jsonResponse({ ok: false, error: 'invalid_content' });
    }
    validatedWrites.push({
      path: safePath,
      parsed: parsed,
      ts: extractTimestamp(parsed)
    });
  }

  var validatedDeletes = [];
  for (var j = 0; j < deletesList.length; j++) {
    var delPath = validateAllowedPath(deletesList[j], DELETABLE_CLIENT_PATHS);
    if (!delPath) {
      return jsonResponse({ ok: false, error: 'forbidden_delete_path' });
    }
    validatedDeletes.push(delPath);
  }

  var manifestMap = getOrBuildManifestMap(rootFolder);
  var writtenOut = [];
  var deletedOut = [];

  for (var w = 0; w < validatedWrites.length; w++) {
    var writeItem = validatedWrites[w];
    var wParts = writeItem.path.split('/');
    var wFolder = getOrCreateChildFolder(rootFolder, wParts[0], 'root_sub:' + wParts[0]);
    writeRawFile(wFolder, wParts[1], JSON.stringify(writeItem.parsed), MimeType.PLAIN_TEXT);
    manifestMap[writeItem.path] = writeItem.ts;
    writtenOut.push({ path: writeItem.path, lastUpdated: writeItem.ts });
  }

  for (var d = 0; d < validatedDeletes.length; d++) {
    var dPath = validatedDeletes[d];
    var dParts = dPath.split('/');
    var dFolder = findChildFolder(rootFolder, dParts[0]);
    if (dFolder) {
      trashFilesByName(dFolder, dParts[1]);
    }
    delete manifestMap[dPath];
    deletedOut.push(dPath);
  }

  saveManifestMap(rootFolder, manifestMap);

  return jsonResponse({
    ok: true,
    data: {
      rootFolderId: ROOT_FOLDER_ID,
      written: writtenOut,
      deleted: deletedOut,
      manifest: manifestMap
    }
  });
}

function handleDeleteFile(rootFolder, rawPath) {
  var safePath = validateAllowedPath(rawPath, DELETABLE_CLIENT_PATHS);
  if (!safePath) {
    return jsonResponse({ ok: false, error: 'forbidden_delete_path' });
  }

  var parts = safePath.split('/');
  var subFolder = findChildFolder(rootFolder, parts[0]);
  if (subFolder) {
    trashFilesByName(subFolder, parts[1]);
  }

  var manifestMap = getOrBuildManifestMap(rootFolder);
  delete manifestMap[safePath];
  saveManifestMap(rootFolder, manifestMap);

  return jsonResponse({
    ok: true,
    data: {
      path: safePath
    }
  });
}

/* ==========================================================================
 * VALIDATION, DIRECTORY, MANIFEST & LOCK HELPERS
 * ========================================================================== */

function validateAllowedPath(rawPath, patterns) {
  if (typeof rawPath !== 'string') return '';
  var p = rawPath.trim();
  if (!p || p.indexOf('..') !== -1 || p.indexOf('\\') !== -1 || p.charAt(0) === '/') {
    return '';
  }
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(p)) {
      return p;
    }
  }
  return '';
}

function coerceJsonObject(val) {
  if (typeof val === 'string') {
    try {
      var parsed = JSON.parse(val);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val;
  }
  return null;
}

function extractTimestamp(obj) {
  var candidate = Number(obj.lastUpdated || obj.updatedAt || 0);
  return candidate > 0 ? candidate : Date.now();
}

function withScriptLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonResponse({ ok: false, error: 'server_busy' });
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function getCachedFolder(cacheKey) {
  if (!cacheKey) return null;
  try {
    var id = CacheService.getScriptCache().get('bee_dir_' + cacheKey);
    if (!id) return null;
    var folder = DriveApp.getFolderById(id);
    if (folder.isTrashed()) {
      CacheService.getScriptCache().remove('bee_dir_' + cacheKey);
      return null;
    }
    return folder;
  } catch (_) {
    CacheService.getScriptCache().remove('bee_dir_' + cacheKey);
    return null;
  }
}

function cacheFolder(cacheKey, folder) {
  if (!cacheKey || !folder) return;
  try {
    CacheService.getScriptCache().put('bee_dir_' + cacheKey, folder.getId(), FOLDER_CACHE_TTL_SECONDS);
  } catch (_) {}
}

function findChildFolder(parentFolder, name) {
  var iter = parentFolder.getFoldersByName(name);
  while (iter.hasNext()) {
    var f = iter.next();
    if (!f.isTrashed()) return f;
  }
  return null;
}

function getOrCreateChildFolder(parentFolder, name, cacheKey) {
  var cached = getCachedFolder(cacheKey);
  if (cached) return cached;
  var existing = findChildFolder(parentFolder, name);
  var folder = existing || parentFolder.createFolder(name);
  cacheFolder(cacheKey, folder);
  return folder;
}

function findChildFile(folder, filename) {
  var iter = folder.getFilesByName(filename);
  while (iter.hasNext()) {
    var file = iter.next();
    if (!file.isTrashed()) return file;
  }
  return null;
}

function writeRawFile(folder, filename, contentStr, mimeType) {
  var iter = folder.getFilesByName(filename);
  var primary = null;
  while (iter.hasNext()) {
    var file = iter.next();
    if (file.isTrashed()) continue;
    if (!primary) {
      primary = file;
    } else {
      file.setTrashed(true);
    }
  }
  if (primary) {
    primary.setContent(contentStr);
    return primary;
  }
  return folder.createFile(filename, contentStr, mimeType || MimeType.PLAIN_TEXT);
}

function trashFilesByName(folder, filename) {
  var iter = folder.getFilesByName(filename);
  while (iter.hasNext()) {
    var f = iter.next();
    if (!f.isTrashed()) {
      f.setTrashed(true);
    }
  }
}

function readJsonFromFolder(folder, filename) {
  var file = findChildFile(folder, filename);
  if (!file) return null;
  try {
    var text = file.getBlob().getDataAsString('UTF-8');
    if (!text) return null;
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function getOrBuildManifestMap(rootFolder) {
  var configFolder = getOrCreateChildFolder(rootFolder, 'config', 'root_sub:config');
  var meta = readJsonFromFolder(configFolder, 'manifest_meta.json');
  if (meta && meta.files && typeof meta.files === 'object') {
    return meta.files;
  }

  var rebuilt = {};
  var subNames = ['units', 'progress', 'analytics', 'config'];
  for (var i = 0; i < subNames.length; i++) {
    var subName = subNames[i];
    var sub = findChildFolder(rootFolder, subName);
    if (!sub) continue;
    var iter = sub.getFiles();
    while (iter.hasNext()) {
      var file = iter.next();
      if (file.isTrashed()) continue;
      var candidatePath = subName + '/' + file.getName();
      if (!validateAllowedPath(candidatePath, ALLOWED_CLIENT_PATHS)) continue;
      var ts = file.getLastUpdated().getTime();
      try {
        var parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        if (parsed && (parsed.lastUpdated || parsed.updatedAt)) {
          ts = Number(parsed.lastUpdated || parsed.updatedAt) || ts;
        }
      } catch (_) {}
      rebuilt[candidatePath] = ts;
    }
  }
  saveManifestMap(rootFolder, rebuilt);
  return rebuilt;
}

function saveManifestMap(rootFolder, filesMap) {
  var configFolder = getOrCreateChildFolder(rootFolder, 'config', 'root_sub:config');
  writeRawFile(
    configFolder,
    'manifest_meta.json',
    JSON.stringify({ updatedAt: Date.now(), files: filesMap }),
    MimeType.PLAIN_TEXT
  );
}

function safeErrorMessage(err) {
  if (!err) return 'Unknown error';
  var msg = String(err.message || err);
  return msg.slice(0, 180);
}

function jsonResponse(obj) {
  var out = {};
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      out[k] = obj[k];
    }
  }
  out.serverTime = Date.now();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
