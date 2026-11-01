// The Google Apps Script that gives Inventory its way into Google Drive.
//
// Why a script and not Google's OAuth: an Apps Script web app runs as the
// person who deployed it, inside their own Drive, with nothing to register in
// a Google Cloud console, no consent screen to have verified, and no refresh
// token that quietly expires after a week. Setting it up is a paste and two
// clicks. And because the household's server calls it — never a phone — it
// works the same from the Android app, an iPhone and a laptop, none of which
// has to sign in to Google.
//
// The script answers only requests carrying a secret. The `inventory` Edge
// Function generates that secret, keeps it in a table no client can read,
// and bakes it into this source when an owner asks for the script — so the
// secret is never in this repository, which is public.
//
// Plain ES5-ish JavaScript on purpose: it runs in Apps Script, not Deno.
// No backticks or `${` inside the source string, so it can sit in a template
// literal with the secret as the only substitution.

export const ROOT_NAME = 'Warranties, manuals, extra parts'
export const PARENT_NAME = 'Joint Stuff'

/** Keep in step with the ops the Edge Function forwards. */
export const BRIDGE_OPS = ['ping', 'folders', 'list', 'ensureFolder', 'upload', 'scan', 'preview', 'trash', 'readDoc', 'writeDoc'] as const
export type BridgeOp = (typeof BRIDGE_OPS)[number]

export function bridgeSource(secret: string): string {
  if (!/^[A-Za-z0-9_-]{24,}$/.test(secret)) throw new Error('Unexpected secret format')
  return `/**
 * Household — Inventory's way into Google Drive.
 *
 * 1. Paste this whole file into a new Apps Script project (script.google.com),
 *    replacing what's there, and save.
 * 2. Deploy → New deployment → type: Web app.
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Deploy, and allow it to use your Drive when Google asks.
 * 3. Copy the Web app URL and paste it into Inventory.
 *
 * It answers only the household's server, which knows the secret below, and
 * it only ever works inside one folder:
 *   ${PARENT_NAME} > ${ROOT_NAME}
 * which it creates if it isn't there. Every item is a folder in it.
 */
var SECRET = '${secret}';
var PARENT_NAME = '${PARENT_NAME}';
var ROOT_NAME = '${ROOT_NAME}';

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ error: 'Bad request' });
  }
  if (!req || req.secret !== SECRET) return reply({ error: 'Not allowed' });
  var handler = OPS[req.op];
  if (!handler) return reply({ error: 'Unknown operation: ' + req.op });
  try {
    return reply(handler(req));
  } catch (err) {
    return reply({ error: String((err && err.message) || err) });
  }
}

/** Opening the URL in a browser says what it is, and nothing else. */
function doGet() {
  return reply({ ok: true, app: 'household-inventory' });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** The folder every item lives in. Found once, then remembered. */
function root() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_ID');
  if (id) {
    try {
      var known = DriveApp.getFolderById(id);
      if (!known.isTrashed()) return known;
    } catch (err) {}
  }
  var found = null;
  var parents = DriveApp.getFoldersByName(PARENT_NAME);
  while (!found && parents.hasNext()) {
    var parent = parents.next();
    if (parent.isTrashed()) continue;
    var inside = parent.getFoldersByName(ROOT_NAME);
    while (inside.hasNext()) {
      var candidate = inside.next();
      if (!candidate.isTrashed()) {
        found = candidate;
        break;
      }
    }
  }
  if (!found) {
    var anywhere = DriveApp.getFoldersByName(ROOT_NAME);
    while (anywhere.hasNext()) {
      var loose = anywhere.next();
      if (!loose.isTrashed()) {
        found = loose;
        break;
      }
    }
  }
  if (!found) {
    var named = DriveApp.getFoldersByName(PARENT_NAME);
    var home = named.hasNext() ? named.next() : DriveApp.createFolder(PARENT_NAME);
    found = home.createFolder(ROOT_NAME);
  }
  props.setProperty('ROOT_ID', found.getId());
  return found;
}

function folderInfo(f) {
  return { id: f.getId(), name: f.getName(), url: f.getUrl(), created: f.getDateCreated().toISOString() };
}

function fileInfo(f) {
  return {
    id: f.getId(),
    name: f.getName(),
    mime: f.getMimeType(),
    size: f.getSize(),
    url: f.getUrl(),
    created: f.getDateCreated().toISOString(),
    description: f.getDescription() || ''
  };
}

/** An item's folder, but only one inside ROOT — never anywhere else in Drive. */
function itemFolder(id) {
  var folder = DriveApp.getFolderById(id);
  var rootId = root().getId();
  var parents = folder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === rootId) return folder;
  }
  throw new Error('That folder is not an Inventory item');
}

/** A file, but only one inside an item folder. */
function itemFile(id) {
  var file = DriveApp.getFileById(id);
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    try {
      itemFolder(p.getId());
      return file;
    } catch (err) {}
  }
  throw new Error('That file is not in an Inventory item');
}

function bytes(data, mime, name) {
  return Utilities.newBlob(Utilities.base64Decode(data), mime, name);
}

var OPS = {
  ping: function () {
    var r = root();
    return { ok: true, account: Session.getEffectiveUser().getEmail(), root: folderInfo(r) };
  },

  /** Every item folder, so ones made by hand can be brought into the app. */
  folders: function () {
    var it = root().getFolders();
    var out = [];
    while (it.hasNext()) {
      var f = it.next();
      if (!f.isTrashed()) out.push(folderInfo(f));
    }
    return { folders: out };
  },

  /** What's in one item's folder. */
  list: function (req) {
    var folder = itemFolder(req.folderId);
    var it = folder.getFiles();
    var files = [];
    while (it.hasNext()) {
      var f = it.next();
      if (!f.isTrashed()) files.push(fileInfo(f));
    }
    return { folder: folderInfo(folder), files: files };
  },

  /** The item's folder, created if it has none yet and renamed to match. */
  ensureFolder: function (req) {
    if (req.folderId) {
      try {
        var existing = itemFolder(req.folderId);
        if (!existing.isTrashed()) {
          if (req.name && existing.getName() !== req.name) existing.setName(req.name);
          return folderInfo(existing);
        }
      } catch (err) {}
    }
    return folderInfo(root().createFolder(req.name || 'Untitled item'));
  },

  upload: function (req) {
    var file = itemFolder(req.folderId).createFile(bytes(req.data, req.mime, req.name));
    if (req.description) file.setDescription(req.description);
    return fileInfo(file);
  },

  /** Photographed pages of a paper document, made into one PDF. */
  scan: function (req) {
    var folder = itemFolder(req.folderId);
    var title = req.name || 'Scan';
    var doc = DocumentApp.create(title + ' (being scanned)');
    var body = doc.getBody();
    body.setMarginTop(18).setMarginBottom(18).setMarginLeft(18).setMarginRight(18);
    var maxW = body.getPageWidth() - 36;
    var maxH = body.getPageHeight() - 36;
    for (var i = 0; i < req.pages.length; i++) {
      var page = req.pages[i];
      var para = i === 0 ? body.getParagraphs()[0] : body.appendParagraph('');
      var image = para.appendInlineImage(bytes(page.data, page.mime, 'page-' + (i + 1)));
      var scale = Math.min(maxW / image.getWidth(), maxH / image.getHeight(), 1);
      image.setWidth(Math.floor(image.getWidth() * scale));
      image.setHeight(Math.floor(image.getHeight() * scale));
      if (i < req.pages.length - 1) body.appendPageBreak();
    }
    doc.saveAndClose();
    var temp = DriveApp.getFileById(doc.getId());
    var pdf = folder.createFile(temp.getAs('application/pdf').setName(title + '.pdf'));
    if (req.description) pdf.setDescription(req.description);
    temp.setTrashed(true);
    return fileInfo(pdf);
  },

  /** A picture of any file — photo, PDF, doc — about size px on its long side. */
  preview: function (req) {
    var size = Math.max(64, Math.min(2000, Number(req.size) || 400));
    var file = itemFile(req.fileId);
    var blob = null;
    try {
      var auth = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
      var meta = JSON.parse(
        UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId() + '?fields=thumbnailLink', auth).getContentText()
      );
      if (meta.thumbnailLink) {
        var res = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s[0-9]+$/, '') + '=s' + size, auth);
        if (res.getResponseCode() === 200) blob = res.getBlob();
      }
    } catch (err) {}
    if (!blob) blob = file.getThumbnail();
    if (!blob) return { error: 'No preview for this file' };
    return { mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
  },

  trash: function (req) {
    itemFile(req.fileId).setTrashed(true);
    return { ok: true };
  },

  readDoc: function (req) {
    itemFile(req.docId);
    return { text: DocumentApp.openById(req.docId).getBody().getText() };
  },

  /** The item's notes doc, rewritten — or made, the first time. */
  writeDoc: function (req) {
    var folder = itemFolder(req.folderId);
    var doc = null;
    if (req.docId) {
      try {
        itemFile(req.docId);
        doc = DocumentApp.openById(req.docId);
      } catch (err) {
        doc = null;
      }
    }
    if (!doc) {
      doc = DocumentApp.create(req.title || 'Notes');
      DriveApp.getFileById(doc.getId()).moveTo(folder);
    }
    doc.getBody().setText(req.text || '');
    doc.saveAndClose();
    return fileInfo(DriveApp.getFileById(doc.getId()));
  }
};
`
}
