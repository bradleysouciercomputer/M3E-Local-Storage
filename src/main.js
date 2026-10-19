import "./style.css";
import "@m3e/web/all";

const DB_NAME = "m3e-local-storage";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  db: null,
  entries: [],
  section: "files",
  folderId: null,
  view: "grid",
  sort: "name",
  query: "",
  selected: new Set(),
  openMenuId: null,
  dialog: null,
  previewId: null,
  previewUrl: null,
  dark: false,
  dragDepth: 0
};

const labels = {
  files: { title: "All files", subtitle: "A calm place for everything in your local library.", heading: "Your files", desc: "Folders and files saved locally", eyebrow: "YOUR PRIVATE WORKSPACE" },
  recent: { title: "Recent", subtitle: "Pick up where you left off.", heading: "Recently updated", desc: "Your latest changes, all in one place", eyebrow: "QUICK ACCESS" },
  favorites: { title: "Favorites", subtitle: "The things you want close at hand.", heading: "Your favorites", desc: "Files and folders you have starred", eyebrow: "QUICK ACCESS" },
  trash: { title: "Trash", subtitle: "Items in trash stay here until you remove them permanently.", heading: "Trash", desc: "Restore items or permanently delete them", eyebrow: "LIBRARY" }
};

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("parentId", "parentId", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("trashedAt", "trashedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
    request.onblocked = () => reject(new Error("Browser storage is busy in another tab. Close other copies of this site and reload."));
  });
}

function dbRequest(mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try { request = operation(store); } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error || new Error("Browser storage operation failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage operation was cancelled."));
  });
}

const dbGetAll = () => dbRequest("readonly", store => store.getAll());
const dbPut = value => dbRequest("readwrite", store => store.put(value));
const dbDelete = id => dbRequest("readwrite", store => store.delete(id));

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1) return "0 B";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = n / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return (size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)) + " " + units[index];
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return "Today, " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function extensionOf(name) {
  const parts = String(name || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function iconFor(entry) {
  if (entry.type === "folder") return "folder";
  const ext = extensionOf(entry.name);
  const mime = entry.mimeType || "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(ext)) return "image";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) return "movie";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio_file";
  if (["pdf"].includes(ext)) return "picture_as_pdf";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "article";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "table_chart";
  if (["ppt", "pptx", "odp"].includes(ext)) return "slideshow";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "folder_zip";
  if (["js", "ts", "jsx", "tsx", "html", "css", "json", "py", "java", "c", "cpp", "md", "xml", "yml", "yaml"].includes(ext)) return "code";
  if (["txt", "log"].includes(ext) || mime.startsWith("text/")) return "description";
  return "draft";
}

function fileKind(entry) {
  if (entry.type === "folder") return "Folder";
  const ext = extensionOf(entry.name);
  if (ext) return ext.toUpperCase() + " file";
  if (entry.mimeType) return entry.mimeType;
  return "File";
}

function allById() {
  return new Map(state.entries.map(entry => [entry.id, entry]));
}

function getEntry(id) {
  return state.entries.find(entry => entry.id === id);
}

function directChildren(folderId, includeTrash = false) {
  return state.entries.filter(entry => (entry.parentId || null) === (folderId || null) && (includeTrash || !entry.trashedAt));
}

function isDescendant(candidateId, ancestorId) {
  let item = getEntry(candidateId);
  const seen = new Set();
  while (item && item.parentId) {
    if (item.parentId === ancestorId) return true;
    if (seen.has(item.parentId)) return false;
    seen.add(item.parentId);
    item = getEntry(item.parentId);
  }
  return false;
}

function descendantsOf(id) {
  const result = [];
  const queue = [id];
  const seen = new Set(queue);
  while (queue.length) {
    const parent = queue.shift();
    state.entries.forEach(entry => {
      if (entry.parentId === parent && !seen.has(entry.id)) {
        seen.add(entry.id);
        result.push(entry);
        if (entry.type === "folder") queue.push(entry.id);
      }
    });
  }
  return result;
}

function folderPath(id) {
  const path = [];
  let item = getEntry(id);
  const seen = new Set();
  while (item && !seen.has(item.id)) {
    seen.add(item.id);
    path.unshift(item);
    item = item.parentId ? getEntry(item.parentId) : null;
  }
  return path;
}

function activeFolders() {
  return state.entries.filter(entry => entry.type === "folder" && !entry.trashedAt);
}

function totalBytes() {
  return state.entries.filter(entry => entry.type === "file").reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
}

function getVisibleEntries() {
  let result;
  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    result = state.entries.filter(entry => !entry.trashedAt && entry.name.toLowerCase().includes(q));
  } else if (state.section === "recent") {
    result = state.entries.filter(entry => entry.type === "file" && !entry.trashedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 60);
  } else if (state.section === "favorites") {
    result = state.entries.filter(entry => entry.favorite && !entry.trashedAt);
  } else if (state.section === "trash") {
    result = state.entries.filter(entry => entry.trashedAt && (!entry.parentId || !getEntry(entry.parentId) || !getEntry(entry.parentId).trashedAt));
  } else {
    result = directChildren(state.folderId, false);
  }

  if (state.sort === "updated") result.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  else if (state.sort === "size") result.sort((a, b) => (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name));
  else if (state.sort === "type") result.sort((a, b) => fileKind(a).localeCompare(fileKind(b)) || a.name.localeCompare(b.name));
  else result.sort((a, b) => (a.type === b.type ? 0 : a.type === "folder" ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  return result;
}

function breadcrumbHTML() {
  if (state.query.trim()) {
    return '<m3e-breadcrumb><m3e-breadcrumb-item data-action="clear-search">Search results</m3e-breadcrumb-item></m3e-breadcrumb>';
  }
  if (state.section !== "files") return "";
  const parts = [{ id: null, name: "All files" }].concat(folderPath(state.folderId));
  return '<m3e-breadcrumb wrap>' + parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    return '<m3e-breadcrumb-item data-action="breadcrumb" data-id="' + (part.id || "") + '" ' + (isLast ? 'current="page"' : "") + '>' + escapeHTML(part.name) + '</m3e-breadcrumb-item>';
  }).join("") + '</m3e-breadcrumb>';
}

function itemMenuTrigger(entry) {
  return '<m3e-icon-button class="card-action menu-trigger" aria-label="More actions for ' + escapeHTML(entry.name) + '" title="More actions">' +
    '<m3e-menu-trigger for="entry-menu-' + entry.id + '"><m3e-icon name="more_vert"></m3e-icon></m3e-menu-trigger>' +
    '</m3e-icon-button>';
}

function itemMenuMarkup(entry, isTrash) {
  const folder = entry.type === "folder";
  let items;
  if (isTrash) {
    items =
      '<m3e-menu-item data-action="restore" data-id="' + entry.id + '"><m3e-icon slot="icon" name="restore"></m3e-icon>Restore</m3e-menu-item>' +
      '<m3e-menu-item data-action="delete-permanent" data-id="' + entry.id + '"><m3e-icon slot="icon" name="delete_forever"></m3e-icon>Delete forever</m3e-menu-item>';
  } else {
    items =
      '<m3e-menu-item data-action="open-entry" data-id="' + entry.id + '"><m3e-icon slot="icon" name="' + (folder ? "folder_open" : "visibility") + '"></m3e-icon>' + (folder ? "Open folder" : "Preview") + '</m3e-menu-item>' +
      '<m3e-menu-item data-action="rename" data-id="' + entry.id + '"><m3e-icon slot="icon" name="drive_file_rename_outline"></m3e-icon>Rename</m3e-menu-item>' +
      '<m3e-menu-item data-action="move" data-id="' + entry.id + '"><m3e-icon slot="icon" name="drive_file_move"></m3e-icon>Move to folder</m3e-menu-item>' +
      '<m3e-menu-item data-action="toggle-favorite" data-id="' + entry.id + '"><m3e-icon slot="icon" name="' + (entry.favorite ? "star" : "star_border") + '"></m3e-icon>' + (entry.favorite ? "Remove from favorites" : "Add to favorites") + '</m3e-menu-item>' +
      '<m3e-divider></m3e-divider>' +
      '<m3e-menu-item data-action="trash-entry" data-id="' + entry.id + '"><m3e-icon slot="icon" name="delete_outline"></m3e-icon>Move to trash</m3e-menu-item>';
  }
  return '<m3e-menu class="context-menu" id="entry-menu-' + entry.id + '">' + items + '</m3e-menu>';
}

function renderGridCard(entry) {
  const folder = entry.type === "folder";
  const isTrash = state.section === "trash";
  const selected = state.selected.has(entry.id);
  const childCount = folder ? directChildren(entry.id, isTrash).length : 0;
  const details = folder ? (childCount + (childCount === 1 ? " item" : " items")) : formatBytes(entry.size || 0);
  const parent = entry.parentId && (state.section === "recent" || state.section === "favorites" || state.query.trim()) ? getEntry(entry.parentId) : null;
  const actions = isTrash
    ? '<m3e-icon-button class="card-action" variant="standard" data-action="restore" data-id="' + entry.id + '" aria-label="Restore" title="Restore"><m3e-icon name="restore"></m3e-icon></m3e-icon-button>' +
      '<m3e-icon-button class="card-action" variant="standard" data-action="delete-permanent" data-id="' + entry.id + '" aria-label="Delete forever" title="Delete forever"><m3e-icon name="delete_forever"></m3e-icon></m3e-icon-button>'
    : '<m3e-icon-button class="card-action ' + (entry.favorite ? "starred" : "") + '" variant="standard" toggle ' + (entry.favorite ? "selected" : "") + ' data-action="toggle-favorite" data-id="' + entry.id + '" aria-label="' + (entry.favorite ? "Remove favorite" : "Add favorite") + '" title="' + (entry.favorite ? "Remove favorite" : "Add favorite") + '"><m3e-icon name="' + (entry.favorite ? "star" : "star_border") + '"></m3e-icon></m3e-icon-button>' +
      itemMenuTrigger(entry);
  return '<m3e-card class="file-card ' + (selected ? "is-selected " : "") + (folder ? "folder-card " : "file-tile ") + '" variant="outlined" ' +
    (isTrash ? "" : 'actionable data-action="open-entry" ') +
    'data-entry-card data-id="' + entry.id + '" data-type="' + entry.type + '" draggable="true">' +
    '<div class="card-top"><div class="select-wrap" title="Select item"><m3e-checkbox class="select-item" data-select="' + entry.id + '" aria-label="Select ' + escapeHTML(entry.name) + '" ' + (selected ? "checked" : "") + '></m3e-checkbox></div>' +
    '<div class="card-actions">' + actions + '</div></div>' +
    '<div class="file-main">' +
    '<div class="file-art ' + (folder ? "folder-art" : "file-art-" + extensionOf(entry.name).replace(/[^a-z0-9]/g, "").slice(0, 8)) + '"><m3e-icon name="' + iconFor(entry) + '"></m3e-icon>' + (!folder && entry.favorite ? '<span class="art-favorite"><m3e-icon name="star"></m3e-icon></span>' : "") + '</div>' +
    '<div class="file-title-line"><m3e-heading variant="title" size="small" level="3" title="' + escapeHTML(entry.name) + '">' + escapeHTML(entry.name) + '</m3e-heading></div>' +
    '<span class="file-detail">' + escapeHTML(details) + '</span>' +
    (parent ? '<span class="file-location"><m3e-icon name="folder"></m3e-icon> ' + escapeHTML(parent.name) + '</span>' : "") +
    (!folder ? '<span class="file-date">' + escapeHTML(formatDate(entry.updatedAt || entry.createdAt)) + '</span>' : "") +
    '</div>' +
    (isTrash ? "" : itemMenuMarkup(entry, false)) +
    '</m3e-card>';
}

function renderListRow(entry) {
  const isTrash = state.section === "trash";
  const selected = state.selected.has(entry.id);
  const folder = entry.type === "folder";
  const parent = entry.parentId && (state.section === "recent" || state.section === "favorites" || state.query.trim()) ? getEntry(entry.parentId) : null;
  const actions = isTrash
    ? '<m3e-icon-button class="card-action" variant="standard" data-action="restore" data-id="' + entry.id + '" title="Restore" aria-label="Restore"><m3e-icon name="restore"></m3e-icon></m3e-icon-button><m3e-icon-button class="card-action" variant="standard" data-action="delete-permanent" data-id="' + entry.id + '" title="Delete forever" aria-label="Delete forever"><m3e-icon name="delete_forever"></m3e-icon></m3e-icon-button>'
    : '<m3e-icon-button class="card-action ' + (entry.favorite ? "starred" : "") + '" variant="standard" toggle ' + (entry.favorite ? "selected" : "") + ' data-action="toggle-favorite" data-id="' + entry.id + '" title="Favorite" aria-label="Favorite"><m3e-icon name="' + (entry.favorite ? "star" : "star_border") + '"></m3e-icon></m3e-icon-button>' + itemMenuTrigger(entry);
  return '<m3e-card class="list-row ' + (selected ? "is-selected" : "") + '" variant="outlined" ' +
    (isTrash ? "" : 'actionable data-action="open-entry" ') +
    'data-entry-card data-id="' + entry.id + '" data-type="' + entry.type + '" draggable="true">' +
    '<div class="list-name-cell"><div class="select-wrap"><m3e-checkbox class="select-item" data-select="' + entry.id + '" aria-label="Select ' + escapeHTML(entry.name) + '" ' + (selected ? "checked" : "") + '></m3e-checkbox></div><span class="list-file-icon ' + (folder ? "folder-color" : "") + '"><m3e-icon name="' + iconFor(entry) + '"></m3e-icon></span><m3e-heading class="list-entry-name" variant="title" size="small" level="3">' + escapeHTML(entry.name) + '</m3e-heading>' + (parent ? '<span class="list-parent">' + escapeHTML(parent.name) + '</span>' : "") + '</div>' +
    '<span class="list-type">' + escapeHTML(fileKind(entry)) + '</span><span class="list-size">' + (folder ? "—" : escapeHTML(formatBytes(entry.size || 0))) + '</span><span class="list-date">' + escapeHTML(formatDate(entry.updatedAt || entry.createdAt)) + '</span><div class="list-actions">' + actions + '</div>' +
    (isTrash ? "" : itemMenuMarkup(entry, false)) +
    '</m3e-card>';
}

function render() {
  const meta = labels[state.section] || labels.files;
  const currentFolder = state.section === "files" && state.folderId ? getEntry(state.folderId) : null;
  $("#page-title").textContent = state.query.trim() ? "Search results" : (currentFolder ? currentFolder.name : meta.title);
  $("#page-subtitle").textContent = state.query.trim() ? "Matches found in your locally stored items." : (currentFolder ? "A folder in your local library. Nothing is uploaded." : meta.subtitle);
  $("#section-eyebrow").textContent = state.query.trim() ? "LOCAL SEARCH" : meta.eyebrow;
  $("#content-heading").textContent = state.query.trim() ? "Matching items" : (currentFolder ? "Folder contents" : meta.heading);
  $("#content-description").textContent = state.query.trim() ? "Searches file and folder names on this device" : meta.desc;
  $("#breadcrumbs").innerHTML = breadcrumbHTML();
  $("#breadcrumbs").classList.toggle("hidden", state.section !== "files" && !state.query.trim());
  $(".nav-item").forEach(item => {
    const selected = item.dataset.section === state.section && !state.query.trim();
    item.toggleAttribute("selected", selected);
    item.classList.toggle("active", selected);
  });
  $("#sort-select").value = state.sort;
  $("#selection-bar").classList.toggle("hidden", state.selected.size === 0 || state.section === "trash");
  $("#selection-label").textContent = state.selected.size + (state.selected.size === 1 ? " selected" : " selected");
  $(".view-button").forEach(button => {
    const selected = button.dataset.view === state.view;
    button.toggleAttribute("selected", selected);
    button.setAttribute("variant", selected ? "tonal" : "standard");
    button.classList.toggle("selected", selected);
  });

  const entries = getVisibleEntries();
  $("#item-count-label").textContent = entries.length + (entries.length === 1 ? " item" : " items");
  const container = $("#files-container");
  container.className = state.view === "grid" ? "files-grid" : "files-list";
  if (state.section === "trash" && state.view === "grid") container.classList.add("trash-grid");
  container.innerHTML = state.view === "grid"
    ? entries.map(renderGridCard).join("")
    : '<div class="list-header"><span>Name</span><span>Type</span><span>Size</span><span>Last modified</span><span></span></div>' + entries.map(renderListRow).join("");

  const empty = entries.length === 0;
  $("#empty-state").classList.toggle("hidden", !empty);
  container.classList.toggle("hidden", empty);
  if (empty) {
    if (state.query.trim()) {
      $("#empty-title").textContent = "No matching items";
      $("#empty-description").textContent = "Try another name or clear your search.";
    } else if (state.section === "trash") {
      $("#empty-title").textContent = "Trash is clear";
      $("#empty-description").textContent = "Items you move to trash will show up here.";
    } else if (state.section === "favorites") {
      $("#empty-title").textContent = "Nothing starred yet";
      $("#empty-description").textContent = "Use the star on a file or folder to keep it here.";
    } else if (state.section === "recent") {
      $("#empty-title").textContent = "No recent files yet";
      $("#empty-description").textContent = "Files you add or update will appear here.";
    } else if (state.folderId) {
      $("#empty-title").textContent = "This folder is empty";
      $("#empty-description").textContent = "Drop files here, upload something, or create a subfolder.";
    } else {
      $("#empty-title").textContent = "Your workspace is ready";
      $("#empty-description").textContent = "Create a folder or add files to start building your private library.";
    }
    $("#empty-state .empty-actions").classList.toggle("hidden", state.section === "trash" || state.query.trim());
  }

  $("#count-files").textContent = state.entries.filter(entry => !entry.trashedAt).length;
  $("#count-trash").textContent = state.entries.filter(entry => !!entry.trashedAt && (!entry.parentId || !getEntry(entry.parentId) || !getEntry(entry.parentId).trashedAt)).length;
  updateStorage();
}

async function refresh() {
  state.entries = await dbGetAll();
  state.selected = new Set(Array.from(state.selected).filter(id => getEntry(id) && !getEntry(id).trashedAt));
  if (state.folderId && (!getEntry(state.folderId) || getEntry(state.folderId).trashedAt)) state.folderId = null;
  render();
}

async function updateStorage() {
  const bytes = totalBytes();
  $("#storage-used-mini").textContent = formatBytes(bytes);
  try {
    const estimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const quota = estimate && estimate.quota ? estimate.quota : 0;
    const usage = estimate && estimate.usage ? estimate.usage : 0;
    $("#storage-limit-mini").textContent = quota ? formatBytes(Math.max(0, quota - usage)) + " available to this site" : "Browser-managed storage";
    $("#storage-fill-mini").style.width = quota ? Math.min(100, Math.max(2, (bytes / quota) * 100)) + "%" : (bytes ? "8%" : "2%");
  } catch (_) {
    $("#storage-limit-mini").textContent = "Browser-managed storage";
    $("#storage-fill-mini").style.width = bytes ? "8%" : "2%";
  }
}

function showToast(message, kind) {
  const text = kind === "error" ? "Something needs attention: " + message : message;
  try {
    if (globalThis.M3eSnackbar && typeof globalThis.M3eSnackbar.open === "function") {
      globalThis.M3eSnackbar.open(text);
      return;
    }
  } catch (_) {}
  const snackbar = $("#toast");
  if (snackbar) {
    snackbar.textContent = text;
    snackbar.open = true;
  }
}

function navigate(section, folderId) {
  state.section = section || "files";
  state.sort = state.section === "recent" ? "updated" : "name";
  if (folderId !== undefined) state.folderId = folderId;
  if (state.section !== "files") state.folderId = null;
  state.selected.clear();
  state.openMenuId = null;
  state.query = "";
  $("#search-input").value = "";
  render();
}

function showDialog(kind, data) {
  data = data || {};
  state.openMenuId = null;
  state.dialog = { kind: kind, data: data };
  const panel = $("#app-dialog");
  $("#dialog-kicker").textContent = "M3E LOCAL STORAGE";
  $("#dialog-body").innerHTML = "";
  let title = "Confirm action";
  let submit = "Continue";
  let body = "";

  if (kind === "folder") {
    title = "Create a folder";
    submit = "Create folder";
    body = '<p class="dialog-copy">Give this folder a name. It will be created ' +
      (state.section === "files" && state.folderId
        ? "inside <strong>" + escapeHTML(getEntry(state.folderId)?.name || "this folder") + "</strong>"
        : "in <strong>All files</strong>") +
      '.</p><m3e-form-field class="dialog-field" variant="outlined"><label slot="label" for="dialog-input">Folder name</label><input id="dialog-input" name="name" maxlength="160" required placeholder="e.g. Design references" autocomplete="off"><span slot="hint">You can rename or move it later.</span></m3e-form-field>';
  } else if (kind === "rename") {
    title = "Rename item";
    submit = "Save name";
    body = '<p class="dialog-copy">Choose a new name for <strong>' + escapeHTML(data.entry.name) +
      '</strong>.</p><m3e-form-field class="dialog-field" variant="outlined"><label slot="label" for="dialog-input">Name</label><input id="dialog-input" name="name" maxlength="240" required value="' +
      escapeHTML(data.entry.name) + '" autocomplete="off"></m3e-form-field>';
  } else if (kind === "move") {
    title = "Move to folder";
    submit = "Move here";
    const movingIds = data.ids || [data.entry.id];
    const excluded = new Set(movingIds);
    movingIds.forEach(id => descendantsOf(id).forEach(entry => excluded.add(entry.id)));
    const options = activeFolders()
      .filter(folder => !excluded.has(folder.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(folder => {
        const path = folderPath(folder.id).map(item => item.name).join(" / ");
        return '<m3e-option value="' + escapeHTML(folder.id) + '">' + escapeHTML(path) + '</m3e-option>';
      }).join("");
    body = '<p class="dialog-copy">Choose where to move ' + movingIds.length +
      (movingIds.length === 1 ? " item" : " items") +
      '. Items remain stored locally; moving only changes their folder.</p><m3e-form-field class="dialog-field" variant="outlined"><label slot="label" for="dialog-folder">Destination folder</label><m3e-select id="dialog-folder" value="' +
      escapeHTML(state.folderId || "") + '"><m3e-option value="">All files (root)</m3e-option>' + options +
      '</m3e-select></m3e-form-field>';
  } else if (kind === "confirmTrash") {
    title = "Move to trash?";
    submit = "Move to trash";
    body = '<p class="dialog-copy">Move ' + data.ids.length +
      (data.ids.length === 1 ? " item" : " items") +
      ' to trash? You can restore them later. Folder contents will move with their folder.</p>';
  } else if (kind === "confirmDelete") {
    title = "Delete permanently?";
    submit = "Delete forever";
    body = '<p class="dialog-copy">This permanently removes <strong>' + escapeHTML(data.entry.name) +
      '</strong> and its contents from this browser. <strong>This cannot be undone.</strong></p>';
  } else if (kind === "storageInfo") {
    title = "How local storage works";
    submit = "Got it";
    body = '<m3e-card class="storage-explainer" variant="filled"><div class="explain-icon"><m3e-icon name="shield_lock"></m3e-icon></div><p>Your files are saved in this browser using IndexedDB. This app does not upload file contents to a server or require an account.</p><p>Local browser storage can be cleared by browser settings, and storage limits depend on your browser and device. Use <strong>Export backup</strong> to save a portable copy before clearing browser data or changing devices.</p><p>Closing the tab will not remove your files, but data is tied to this browser and site origin.</p></m3e-card>';
  } else {
    body = '<p class="dialog-copy">Continue with this action?</p>';
  }

  $("#dialog-title").textContent = title;
  $("#dialog-submit").textContent = submit;
  $("#dialog-submit").setAttribute("variant", "filled");
  $("#dialog-body").innerHTML = body;
  panel.dataset.kind = kind;
  panel.open = true;

  setTimeout(() => {
    const input = $("#dialog-input") || $("#dialog-folder");
    if (input && typeof input.focus === "function") {
      input.focus();
      if (typeof input.select === "function") input.select();
    }
  }, 50);
}

function closeDialog() {
  const panel = $("#app-dialog");
  if (panel) panel.open = false;
  state.dialog = null;
}

async function handleDialogSubmit(event) {
  event.preventDefault();
  if (!state.dialog) return;
  const current = state.dialog;
  const kind = current.kind;
  const data = current.data;
  const nameInput = $("#dialog-input");
  if ((kind === "folder" || kind === "rename") && nameInput && !nameInput.value.trim()) {
    nameInput.setCustomValidity("Enter a name.");
    nameInput.reportValidity();
    return;
  }
  try {
    if (kind === "folder") {
      const name = nameInput.value.trim();
      const parentId = state.section === "files" ? state.folderId : null;
      const now = Date.now();
      await dbPut({ id: uid(), name: name, type: "folder", parentId: parentId || null, createdAt: now, updatedAt: now, favorite: false, trashedAt: null });
      closeDialog();
      await refresh();
      showToast("Folder created");
    } else if (kind === "rename") {
      const name = nameInput.value.trim();
      const entry = getEntry(data.entry.id);
      if (!entry) { closeDialog(); return; }
      entry.name = name;
      entry.updatedAt = Date.now();
      await dbPut(entry);
      closeDialog();
      await refresh();
      showToast("Name updated");
    } else if (kind === "move") {
      const destination = $("#dialog-folder").value || null;
      await moveEntries(data.ids || [data.entry.id], destination);
      closeDialog();
      await refresh();
      showToast("Items moved");
    } else if (kind === "confirmTrash") {
      await trashEntries(data.ids);
      closeDialog();
      await refresh();
      showToast("Moved to trash");
    } else if (kind === "confirmDelete") {
      await permanentlyDelete(data.entry.id);
      closeDialog();
      await refresh();
      showToast("Deleted permanently");
    } else {
      closeDialog();
    }
  } catch (error) {
    showToast(error.message || "Could not complete that action", "error");
  }
}

async function moveEntries(ids, destinationId) {
  for (const id of ids) {
    const entry = getEntry(id);
    if (!entry) continue;
    if (entry.type === "folder" && destinationId && (destinationId === entry.id || isDescendant(destinationId, entry.id))) {
      throw new Error("A folder cannot be moved into itself or one of its own subfolders.");
    }
  }
  for (const id of ids) {
    const entry = getEntry(id);
    if (!entry || entry.trashedAt) continue;
    entry.parentId = destinationId || null;
    entry.updatedAt = Date.now();
    await dbPut(entry);
  }
  state.selected.clear();
}

async function trashEntries(ids) {
  const all = new Set();
  ids.forEach(id => {
    const entry = getEntry(id);
    if (!entry || entry.trashedAt) return;
    all.add(id);
    if (entry.type === "folder") descendantsOf(id).forEach(child => all.add(child.id));
  });
  const now = Date.now();
  for (const id of all) {
    const entry = getEntry(id);
    if (!entry) continue;
    entry.trashedAt = now;
    entry.updatedAt = now;
    await dbPut(entry);
  }
  state.selected.clear();
  state.openMenuId = null;
  if (state.folderId && all.has(state.folderId)) state.folderId = null;
}

async function restoreEntry(id) {
  const entry = getEntry(id);
  if (!entry) return;
  const all = [entry];
  if (entry.type === "folder") all.push(...descendantsOf(id));
  for (const item of all) {
    if (!item.trashedAt) continue;
    item.trashedAt = null;
    item.updatedAt = Date.now();
    await dbPut(item);
  }
  await refresh();
  showToast("Item restored");
}

async function permanentlyDelete(id) {
  const entry = getEntry(id);
  if (!entry) return;
  const ids = [id];
  if (entry.type === "folder") descendantsOf(id).forEach(child => ids.push(child.id));
  for (const itemId of ids) await dbDelete(itemId);
  state.selected.delete(id);
}

async function uploadFiles(fileList, targetFolderId) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (state.section === "trash" && targetFolderId === undefined) {
    showToast("Open a folder before uploading files", "error");
    return;
  }
  const destination = targetFolderId === undefined ? (state.section === "files" ? state.folderId : null) : targetFolderId;
  try {
    let done = 0;
    for (const file of files) {
      const now = Date.now();
      const content = file.slice(0, file.size, file.type || "application/octet-stream");
      await dbPut({
        id: uid(),
        name: file.name,
        type: "file",
        parentId: destination || null,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        lastModified: file.lastModified || now,
        content: content,
        createdAt: now,
        updatedAt: now,
        favorite: false,
        trashedAt: null
      });
      done += 1;
    }
    if (state.section !== "files" && !state.query.trim()) {
      state.section = "files";
      state.folderId = destination || null;
    }
    state.selected.clear();
    await refresh();
    showToast(done + (done === 1 ? " file added locally" : " files added locally"));
  } catch (error) {
    showToast("Upload failed: " + (error.message || "browser storage could not save the file"), "error");
    await refresh();
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function downloadEntry(id) {
  const entry = getEntry(id);
  if (!entry || entry.type !== "file" || !entry.content) {
    showToast("The file contents are not available", "error");
    return;
  }
  downloadBlob(entry.content, entry.name);
}

function closePreview() {
  const previewDialog = $("#preview-dialog");
  if (previewDialog) previewDialog.open = false;
  $("#preview-content").innerHTML = "";
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.previewId = null;
}

async function openPreview(id) {
  const entry = getEntry(id);
  if (!entry || entry.type !== "file" || entry.trashedAt) return;
  if (!entry.content) {
    showToast("This file has no locally stored contents", "error");
    return;
  }
  closePreview();
  state.previewId = id;
  state.previewUrl = URL.createObjectURL(entry.content);
  $("#preview-title").textContent = entry.name;
  $("#preview-meta").textContent = fileKind(entry) + " · " + formatBytes(entry.size || 0) + " · " + formatDate(entry.updatedAt || entry.createdAt);
  $("#preview-icon").setAttribute("name", iconFor(entry));
  const content = $("#preview-content");
  const mime = entry.mimeType || "";
  const ext = extensionOf(entry.name);
  const isImage = mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"].includes(ext);
  const isVideo = mime.startsWith("video/") || ["mp4", "webm", "ogv"].includes(ext);
  const isAudio = mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext);
  const isPdf = mime === "application/pdf" || ext === "pdf";
  const isText = mime.startsWith("text/") || ["txt", "md", "json", "js", "ts", "html", "css", "xml", "yml", "yaml", "csv", "log", "py", "sh", "sql", "svg"].includes(ext);
  if (isImage) content.innerHTML = '<div class="preview-media-wrap"><img class="preview-image" alt="' + escapeHTML(entry.name) + '" src="' + state.previewUrl + '"></div>';
  else if (isVideo) content.innerHTML = '<div class="preview-media-wrap"><video class="preview-video" src="' + state.previewUrl + '" controls playsinline></video></div>';
  else if (isAudio) content.innerHTML = '<div class="preview-audio-wrap"><div class="audio-art"><m3e-icon name="audio_file"></m3e-icon></div><p>' + escapeHTML(entry.name) + '</p><audio src="' + state.previewUrl + '" controls></audio></div>';
  else if (isPdf) content.innerHTML = '<iframe class="preview-pdf" title="PDF preview of ' + escapeHTML(entry.name) + '" src="' + state.previewUrl + '"></iframe>';
  else if (isText && entry.size < 1200000) {
    content.innerHTML = '<div class="text-preview-loading">Opening text preview…</div>';
    try {
      const text = await entry.content.text();
      if (state.previewId !== id) return;
      content.innerHTML = '<div class="text-preview"><div class="text-preview-top"><span>' + escapeHTML(ext.toUpperCase() || "TEXT") + '</span><span>' + escapeHTML(text.split("\n").length) + ' lines</span></div><pre>' + escapeHTML(text) + '</pre></div>';
    } catch (_) {
      content.innerHTML = previewDetailsHTML(entry);
    }
  } else {
    content.innerHTML = previewDetailsHTML(entry);
  }
  $("#preview-dialog").open = true;
  const opened = getEntry(id);
  if (opened) { opened.updatedAt = Date.now(); await dbPut(opened); await refresh(); }
}

function previewDetailsHTML(entry) {
  return '<div class="preview-generic"><div class="generic-file-art"><m3e-icon name="' + iconFor(entry) + '"></m3e-icon></div><h3>' + escapeHTML(entry.name) + '</h3><p>This file type cannot be previewed here, but the original file is saved locally and can be downloaded.</p><div class="detail-grid"><span>File type</span><strong>' + escapeHTML(fileKind(entry)) + '</strong><span>Size</span><strong>' + escapeHTML(formatBytes(entry.size || 0)) + '</strong><span>Last updated</span><strong>' + escapeHTML(formatDate(entry.updatedAt || entry.createdAt)) + '</strong></div><m3e-button class="primary-native" variant="filled" data-action="download-preview"><m3e-icon slot="icon" name="download"></m3e-icon> Download file</m3e-button></div>';
}

function toggleFavorite(id) {
  const entry = getEntry(id);
  if (!entry) return;
  entry.favorite = !entry.favorite;
  entry.updatedAt = Date.now();
  dbPut(entry).then(refresh).then(() => showToast(entry.favorite ? "Added to favorites" : "Removed from favorites")).catch(error => showToast(error.message, "error"));
}

function selectItem(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  state.openMenuId = null;
  render();
}

function openMoveDialog(ids) {
  const entries = ids.map(id => getEntry(id)).filter(Boolean);
  if (!entries.length) return;
  showDialog("move", { ids: entries.map(entry => entry.id), entry: entries[0] });
}

async function exportBackup() {
  try {
    showToast("Preparing a local backup…");
    const entries = [];
    for (const entry of state.entries) {
      const copy = Object.assign({}, entry);
      if (entry.type === "file") {
        copy.contentBase64 = entry.content ? await blobToBase64(entry.content) : "";
        delete copy.content;
      }
      entries.push(copy);
    }
    const backup = { schema: "m3e-local-storage-backup", version: 1, exportedAt: new Date().toISOString(), entries: entries };
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    downloadBlob(blob, "m3e-local-storage-backup-" + new Date().toISOString().slice(0, 10) + ".json");
    showToast("Backup exported");
  } catch (error) {
    showToast("Backup failed: " + (error.message || "not enough memory"), "error");
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read file for backup"));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64 || "");
  const chunks = [];
  const size = 1024 * 512;
  for (let offset = 0; offset < binary.length; offset += size) {
    const slice = binary.slice(offset, offset + size);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: mime || "application/octet-stream" });
}

async function importBackup(file) {
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.schema !== "m3e-local-storage-backup" || !Array.isArray(backup.entries)) throw new Error("This is not a valid M3E Local Storage backup.");
    const idMap = new Map();
    backup.entries.forEach(entry => idMap.set(entry.id, uid()));
    const safeEntries = [];
    for (const raw of backup.entries) {
      if (!raw || !raw.id || !["file", "folder"].includes(raw.type) || typeof raw.name !== "string") continue;
      const imported = {
        id: idMap.get(raw.id),
        name: raw.name.slice(0, 240),
        type: raw.type,
        parentId: raw.parentId && idMap.has(raw.parentId) ? idMap.get(raw.parentId) : null,
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Date.now(),
        favorite: !!raw.favorite,
        trashedAt: raw.trashedAt ? Date.now() : null
      };
      if (raw.type === "file") {
        imported.mimeType = String(raw.mimeType || "application/octet-stream");
        imported.size = Number(raw.size) || 0;
        imported.lastModified = Number(raw.lastModified) || imported.createdAt;
        imported.content = base64ToBlob(String(raw.contentBase64 || ""), imported.mimeType);
        imported.size = imported.content.size;
      }
      safeEntries.push(imported);
    }
    for (const entry of safeEntries) await dbPut(entry);
    await refresh();
    showToast("Imported " + safeEntries.length + (safeEntries.length === 1 ? " item" : " items"));
  } catch (error) {
    showToast(error.message || "Could not import that backup", "error");
  }
}

async function handleAction(action, id, button) {
  const entry = id ? getEntry(id) : null;
  try {
    switch (action) {
      case "home":
        navigate("files", null);
        break;
      case "new-folder":
        if (state.section !== "files" || state.query.trim()) navigate("files", null);
        showDialog("folder");
        break;
      case "upload":
        if (state.section === "trash") { showToast("Restore an item or open All files before uploading", "error"); break; }
        $("#file-input").click();
        break;
      case "toggle-theme":
        state.dark = !state.dark;
        document.documentElement.classList.toggle("dark-theme", state.dark);
        button.setAttribute("aria-label", state.dark ? "Switch to light mode" : "Toggle dark mode");
        break;
      case "export-backup":
        await exportBackup();
        break;
      case "import-backup":
        $("#backup-input").click();
        break;
      case "learn-storage":
        showDialog("storageInfo");
        break;
      case "close-dialog":
        closeDialog();
        break;
      case "close-preview":
        closePreview();
        break;
      case "dialog-submit":
        await handleDialogSubmit({ preventDefault() {} });
        break;
      case "download-preview":
        if (state.previewId) await downloadEntry(state.previewId);
        break;
      case "open-entry":
        if (!entry) break;
        state.openMenuId = null;
        if (entry.type === "folder") {
          if (entry.trashedAt) { showToast("Restore this folder before opening it", "error"); break; }
          navigate("files", entry.id);
        } else {
          await openPreview(entry.id);
        }
        break;
      case "rename":
        if (entry) showDialog("rename", { entry: entry });
        break;
      case "move":
        if (entry) openMoveDialog([entry.id]);
        break;
      case "move-selected":
        openMoveDialog(Array.from(state.selected));
        break;
      case "toggle-favorite":
        if (entry) toggleFavorite(id);
        break;
      case "trash-entry":
        if (entry) {
          await trashEntries([id]);
          await refresh();
          showToast("Moved to trash");
        }
        break;
      case "trash-selected":
        if (state.selected.size) showDialog("confirmTrash", { ids: Array.from(state.selected) });
        break;
      case "restore":
        if (entry) await restoreEntry(id);
        break;
      case "delete-permanent":
        if (entry) showDialog("confirmDelete", { entry: entry });
        break;
      case "select-all":
        getVisibleEntries().forEach(item => state.selected.add(item.id));
        render();
        break;
      case "clear-selection":
        state.selected.clear();
        render();
        break;
      case "clear-search":
        state.query = "";
        $("#search-input").value = "";
        render();
        break;
      case "breadcrumb":
        navigate("files", id || null);
        break;
      default:
        break;
    }
  } catch (error) {
    showToast(error.message || "Something went wrong", "error");
  }
}

document.addEventListener("click", event => {
  const controlWithoutParentAction = event.target.closest("m3e-checkbox, m3e-menu-trigger, m3e-icon-button:not([data-action])");
  if (controlWithoutParentAction) return;
  const actionElement = event.target.closest("[data-action]");
  if (actionElement) {
    event.preventDefault();
    handleAction(actionElement.dataset.action, actionElement.dataset.id || null, actionElement);
    return;
  }
  const nav = event.target.closest("[data-section]");
  if (nav) {
    navigate(nav.dataset.section, null);
    return;
  }
  const view = event.target.closest("[data-view]");
  if (view) {
    state.view = view.dataset.view;
    state.openMenuId = null;
    render();
    return;
  }

});

document.addEventListener("change", event => {
  if (event.target.matches(".select-item")) {
    selectItem(event.target.dataset.select, event.target.checked);
    return;
  }
  if (event.target.id === "sort-select") {
    state.sort = event.target.value;
    render();
  }
});

$("#search-input").addEventListener("input", event => {
  state.query = event.target.value;
  state.openMenuId = null;
  render();
});
$("#search-bar").addEventListener("clear", () => {
  $("#search-input").value = "";
  state.query = "";
  render();
});

$("#file-input").addEventListener("change", async event => {
  await uploadFiles(event.target.files);
  event.target.value = "";
});

$("#backup-input").addEventListener("change", async event => {
  await importBackup(event.target.files[0]);
  event.target.value = "";
});

$("#app-dialog").addEventListener("closed", () => {
  state.dialog = null;
});
$("#preview-dialog").addEventListener("closed", () => {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.previewId = null;
  $("#preview-content").innerHTML = "";
});
document.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && $("#app-dialog").open &&
      (event.target.id === "dialog-input" || event.target.id === "dialog-folder")) {
    event.preventDefault();
    handleDialogSubmit({ preventDefault() {} });
  }
});

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#search-input").focus();
  } else if (event.key === "Escape") {
    if ($("#preview-dialog").open) closePreview();
    else if ($("#app-dialog").open) closeDialog();
    else if (state.openMenuId) { state.openMenuId = null; render(); }
    else if (state.selected.size) { state.selected.clear(); render(); }
  } else if ((event.key === "Delete" || event.key === "Backspace") && state.selected.size && !/INPUT|TEXTAREA|SELECT|M3E-SELECT|M3E-CHECKBOX/.test(document.activeElement.tagName) && state.section !== "trash") {
    event.preventDefault();
    showDialog("confirmTrash", { ids: Array.from(state.selected) });
  }
});

const mainPanel = $(".main-panel");
mainPanel.addEventListener("dragenter", event => {
  if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files")) {
    event.preventDefault();
    state.dragDepth += 1;
    $("#drag-overlay").classList.add("visible");
  }
});
mainPanel.addEventListener("dragover", event => {
  if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const card = event.target.closest("[data-entry-card][data-type='folder']");
    $$(".file-card.drag-target, .list-row.drag-target").forEach(el => el.classList.remove("drag-target"));
    if (card && state.section !== "trash") card.classList.add("drag-target");
  }
});
mainPanel.addEventListener("dragleave", event => {
  if (!mainPanel.contains(event.relatedTarget)) {
    state.dragDepth = 0;
    $("#drag-overlay").classList.remove("visible");
    $$(".drag-target").forEach(el => el.classList.remove("drag-target"));
  }
});
mainPanel.addEventListener("drop", async event => {
  if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes("Files")) return;
  event.preventDefault();
  state.dragDepth = 0;
  $("#drag-overlay").classList.remove("visible");
  $$(".drag-target").forEach(el => el.classList.remove("drag-target"));
  const card = event.target.closest("[data-entry-card][data-type='folder']");
  const target = card && state.section !== "trash" ? card.dataset.id : undefined;
  if (state.section === "trash" && target === undefined) {
    showToast("Drop files into All files or a folder, not Trash", "error");
    return;
  }
  await uploadFiles(event.dataTransfer.files, target);
});

async function init() {
  // Test the storage API separately from the first UI render so a UI bug is
  // never misreported as an IndexedDB failure.
  try {
    if (!("indexedDB" in window) || !window.indexedDB) {
      throw new Error("This browser or browsing mode has disabled IndexedDB.");
    }
    state.db = await openDatabase();
  } catch (error) {
    $("#empty-state").classList.remove("hidden");
    $("#files-container").classList.add("hidden");
    $("#empty-title").textContent = "Browser storage is unavailable";
    $("#empty-description").textContent = error.message || "IndexedDB could not be opened. Enable site storage in your browser settings, then reload.";
    $("#empty-state .empty-actions").classList.add("hidden");
    showToast(error.message || "Could not open local storage", "error");
    console.error("[M3E Local Storage] IndexedDB initialization failed:", error);
    return;
  }

  try {
    await refresh();
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      navigator.storage.persist().catch(() => {});
    }
  } catch (error) {
    $("#empty-state").classList.remove("hidden");
    $("#files-container").classList.add("hidden");
    $("#empty-title").textContent = "The workspace could not load";
    $("#empty-description").textContent = "Browser storage opened successfully, but the workspace failed to render. Reload the page; if this persists, open the browser console for details.";
    $("#empty-state .empty-actions").classList.add("hidden");
    showToast(error.message || "Could not load the workspace", "error");
    console.error("[M3E Local Storage] Workspace initialization failed:", error);
  }
}

init();
