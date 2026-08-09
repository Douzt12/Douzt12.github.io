(() => {
  "use strict";

  const ADMIN_EMAIL = "1766847587@qq.com";
  const BUCKET = "portfolio-photos";
  const SESSION_KEY = "douzt-admin-session";
  const config = window.DOUZT_GUESTBOOK_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const publishableKey = String(config.supabasePublishableKey || "");

  const state = {
    session: null,
    albums: [],
    photos: [],
    messages: [],
    settings: null,
    selectedAlbumId: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const loginView = $("#login-view");
  const adminView = $("#admin-view");
  const sessionPanel = $("#admin-session");
  const monthNamesZh = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const monthNamesEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = value == null ? "" : String(value);
    return node.innerHTML;
  }

  function setFormState(element, message = "", type = "") {
    element.textContent = message;
    element.className = `form-state${type ? ` ${type}` : ""}`;
  }

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { node.hidden = true; }, 2600);
  }

  function publicHeaders(extra = {}) {
    const headers = { apikey: publishableKey, ...extra };
    if (!publishableKey.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${publishableKey}`;
    return headers;
  }

  function authHeaders(extra = {}) {
    if (!state.session?.access_token) throw new Error("登录已经失效，请重新登录。");
    return { apikey: publishableKey, Authorization: `Bearer ${state.session.access_token}`, ...extra };
  }

  async function parseResponse(response) {
    if (response.ok) {
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    let detail = "操作没有完成，请稍后重试。";
    try {
      const body = await response.json();
      detail = body.message || body.msg || body.error_description || body.error || detail;
    } catch {}
    if (response.status === 401) signOut(false);
    throw new Error(detail);
  }

  async function rest(path, { method = "GET", body, prefer } = {}) {
    const headers = authHeaders({ "Content-Type": "application/json" });
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    return parseResponse(response);
  }

  async function authenticate(email, password) {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: publicHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email, password }),
    });
    const session = await parseResponse(response);
    const signedInEmail = String(session.user?.email || "").toLowerCase();
    if (signedInEmail !== ADMIN_EMAIL) throw new Error("这个账号没有摄影后台权限。");
    return session;
  }

  async function refreshSession(refreshToken) {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: publicHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return parseResponse(response);
  }

  function saveSession(session) {
    state.session = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
    sessionPanel.hidden = false;
    $("#session-email").textContent = ADMIN_EMAIL;
    showVisual();
  }

  function showVisual() {
    $("#visual-view").hidden = false;
    $("#advanced-view").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showAdvanced(targetId) {
    $("#visual-view").hidden = true;
    $("#advanced-view").hidden = false;
    window.setTimeout(() => {
      const target = targetId ? document.getElementById(targetId) : $("#advanced-view");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function refreshPreview() {
    const frame = $("#public-preview");
    if (frame) frame.src = `../?edit-refresh=${Date.now()}`;
  }

  function signOut(showMessage = true) {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
    loginView.hidden = false;
    adminView.hidden = true;
    sessionPanel.hidden = true;
    $("#login-password").value = "";
    if (showMessage) toast("已经安全退出。");
  }

  function albumLabel(album) {
    return `${album.year} / ${String(album.month).padStart(2, "0")} · ${album.title_zh || monthNamesZh[album.month - 1]}`;
  }

  function populateAlbumSelects() {
    const options = state.albums.map((album) => `<option value="${album.id}">${escapeHtml(albumLabel(album))}${album.published ? "" : "（草稿）"}</option>`).join("");
    const select = $("#photo-album");
    select.innerHTML = options || '<option value="">请先建立月度档案</option>';
    if (state.selectedAlbumId && state.albums.some((album) => String(album.id) === String(state.selectedAlbumId))) {
      select.value = String(state.selectedAlbumId);
    } else if (state.albums[0]) {
      state.selectedAlbumId = state.albums[0].id;
      select.value = String(state.selectedAlbumId);
    }
  }

  function renderAlbums() {
    $("#album-total").textContent = state.albums.length;
    const node = $("#album-list");
    if (!state.albums.length) {
      node.innerHTML = '<p class="empty-state">还没有月度档案，请先在上方建立第一个月份。</p>';
      populateAlbumSelects();
      return;
    }
    node.innerHTML = state.albums.map((album) => {
      const count = state.photos.filter((photo) => photo.album_id === album.id).length;
      return `<article class="record-row"><div><h3>${escapeHtml(albumLabel(album))}</h3><p>${escapeHtml(album.description || "暂无说明")} · ${count} 张照片 · ${album.published ? "已公开" : "草稿"}</p></div><div class="record-actions"><button type="button" data-edit-album="${album.id}">编辑</button><button type="button" data-toggle-album="${album.id}">${album.published ? "转为草稿" : "公开"}</button><button type="button" class="delete" data-delete-album="${album.id}">删除</button></div></article>`;
    }).join("");
    populateAlbumSelects();
  }

  function renderPhotos() {
    $("#photo-total").textContent = state.photos.length;
    const node = $("#photo-list");
    const photos = state.photos.filter((photo) => String(photo.album_id) === String(state.selectedAlbumId)).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    if (!state.selectedAlbumId) {
      node.innerHTML = '<p class="empty-state">请先建立或选择一个月份。</p>';
      return;
    }
    if (!photos.length) {
      node.innerHTML = '<p class="empty-state">这个月份还没有照片，可在上方一次选择多张上传。</p>';
      return;
    }
    node.innerHTML = photos.map((photo, index) => `<article class="photo-editor"><img src="${escapeHtml(photo.image_url)}" alt="${escapeHtml(photo.alt_text || photo.title_zh || "摄影作品")}" loading="lazy"><form data-photo-form="${photo.id}"><label><span>中文标题</span><input name="title_zh" maxlength="80" value="${escapeHtml(photo.title_zh)}"></label><label><span>英文标题</span><input name="title_en" maxlength="100" value="${escapeHtml(photo.title_en)}"></label><label><span>图片说明（无障碍文字）</span><input name="alt_text" maxlength="180" value="${escapeHtml(photo.alt_text)}"></label><label class="check-row"><input name="published" type="checkbox"${photo.published ? " checked" : ""}><span>公开显示</span></label><footer><div><button type="button" data-move-photo="${photo.id}" data-direction="-1"${index === 0 ? " disabled" : ""}>← 前移</button><button type="button" data-move-photo="${photo.id}" data-direction="1"${index === photos.length - 1 ? " disabled" : ""}>后移 →</button></div><div><button type="submit">保存</button><button type="button" class="delete" data-delete-photo="${photo.id}">删除</button></div></footer></form></article>`).join("");
  }

  function renderMessages() {
    $("#message-total").textContent = state.messages.length;
    const node = $("#message-list");
    if (!state.messages.length) {
      node.innerHTML = '<p class="empty-state">目前还没有公开留言。</p>';
      return;
    }
    node.innerHTML = state.messages.map((message) => `<article class="record-row message-admin-row"><div><strong>${escapeHtml(message.name || "访客")}</strong><time>${new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(message.created_at))}</time></div><blockquote>${escapeHtml(message.message)}</blockquote><button type="button" class="danger-button" data-delete-message="${message.id}">删除</button></article>`).join("");
  }

  function fillSettings() {
    const settings = state.settings || {};
    $("#setting-quote").value = settings.quote_text || "The image itself has not changed.";
    $("#setting-author").value = settings.quote_author || "Donald Alexander Sheff";
    $("#setting-about").value = settings.about_text || "独立黑白胶片摄影档案。每个月是一卷独立的观看记录。";
    $("#setting-hero-url").value = settings.hero_image_url || "";
  }

  async function loadAll() {
    const [albums, photos, settings, messages] = await Promise.all([
      rest("portfolio_albums?select=*&order=year.desc,month.desc"),
      rest("portfolio_photos?select=*&order=album_id.asc,sort_order.asc,created_at.asc"),
      rest("site_settings?select=*&id=eq.main&limit=1"),
      rest("guestbook_messages?select=id,name,message,created_at&order=created_at.desc&limit=100"),
    ]);
    state.albums = albums || [];
    state.photos = photos || [];
    state.settings = settings?.[0] || null;
    state.messages = messages || [];
    renderAlbums();
    renderPhotos();
    renderMessages();
    fillSettings();
    refreshPreview();
  }

  function resetAlbumForm() {
    $("#album-id").value = "";
    $("#album-year").value = new Date().getFullYear();
    $("#album-month").value = String(new Date().getMonth() + 1);
    $("#album-title-zh").value = monthNamesZh[new Date().getMonth()];
    $("#album-title-en").value = monthNamesEn[new Date().getMonth()];
    $("#album-description").value = "";
    $("#album-published").checked = false;
    $("#album-form-mode").textContent = "新建";
    setFormState($("#album-state"));
  }

  function editAlbum(id) {
    const album = state.albums.find((item) => item.id === Number(id));
    if (!album) return;
    $("#album-id").value = album.id;
    $("#album-year").value = album.year;
    $("#album-month").value = album.month;
    $("#album-title-zh").value = album.title_zh;
    $("#album-title-en").value = album.title_en;
    $("#album-description").value = album.description;
    $("#album-published").checked = album.published;
    $("#album-form-mode").textContent = "编辑";
    showAdvanced("albums");
  }

  function openPhotoEditor(index, albumId) {
    state.selectedAlbumId = Number(albumId);
    populateAlbumSelects();
    renderPhotos();
    showAdvanced("photos");
    window.setTimeout(() => {
      const card = $("#photo-list").children[index];
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.classList.add("editor-focus");
      window.setTimeout(() => card?.classList.remove("editor-focus"), 1800);
    }, 350);
  }

  function bindVisualPreview() {
    const frame = $("#public-preview");
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc?.body) return;
    const style = doc.createElement("style");
    style.textContent = `.hero-visual,.hero-copy,.month-bar,.photo-card,#guestbook,#about{cursor:pointer;transition:outline-color .16s ease,outline-offset .16s ease}.hero-visual:hover,.hero-copy:hover,.month-bar:hover,.photo-card:hover,#guestbook:hover,#about:hover{outline:3px solid #0969da;outline-offset:-3px}.photo-button{pointer-events:none}.lightbox{display:none!important}`;
    doc.head.appendChild(style);
    doc.addEventListener("click", (event) => {
      if (event.target.closest(".timeline-node")) return;
      const editable = event.target.closest(".hero-visual,.hero-copy,.month-bar,.photo-card,#guestbook,#about");
      if (!editable) return;
      event.preventDefault();
      event.stopPropagation();
      if (editable.matches(".hero-visual,.hero-copy,#about")) return showAdvanced("site-settings");
      if (editable.matches("#guestbook")) return showAdvanced("messages");
      const text = doc.querySelector(".month-bar h3")?.textContent || "";
      const match = text.match(/(\d{4})\s*\/\s*(\d{1,2})/);
      const album = match && state.albums.find((item) => Number(item.year) === Number(match[1]) && Number(item.month) === Number(match[2]));
      if (editable.matches(".month-bar")) return album ? editAlbum(album.id) : showAdvanced("albums");
      if (editable.matches(".photo-card") && album) {
        const cards = [...doc.querySelectorAll(".photo-card")];
        return openPhotoEditor(cards.indexOf(editable), album.id);
      }
    });
  }

  async function prepareWebImage(file, maxSide = 2400) {
    if (!file.type.startsWith("image/")) throw new Error("请选择 JPG、PNG 或 WebP 图片。");
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { return file; }
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxSide && file.size <= 2800000) {
      bitmap.close();
      return file;
    }
    const ratio = Math.min(1, maxSide / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("图片处理失败。")), "image/jpeg", 0.88));
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }

  function safeFileName(name) {
    const base = name.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "photo";
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${base}`;
  }

  async function uploadObject(file, path) {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${encodedPath}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": file.type, "x-upsert": "false" }),
      body: file,
    });
    await parseResponse(response);
    return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${encodedPath}`;
  }

  async function deleteObject(path) {
    if (!path) return;
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${encodedPath}`, { method: "DELETE", headers: authHeaders() });
    if (!response.ok && response.status !== 404) await parseResponse(response);
  }

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = $("#login-state");
    setFormState(output, "正在登录……");
    try {
      if (!supabaseUrl || !publishableKey) throw new Error("网站连接信息尚未配置。");
      const session = await authenticate($("#login-email").value.trim().toLowerCase(), $("#login-password").value);
      saveSession(session);
      showAdmin();
      await loadAll();
      setFormState(output);
    } catch (error) {
      setFormState(output, error.message.includes("Invalid login") ? "邮箱或密码不正确。" : error.message, "error");
    }
  });

  $("#sign-out").addEventListener("click", () => signOut());
  $("#show-visual").addEventListener("click", showVisual);
  $("#show-advanced").addEventListener("click", () => showAdvanced());
  $("#back-visual").addEventListener("click", showVisual);
  $("#visual-refresh").addEventListener("click", refreshPreview);
  $("#visual-new-album").addEventListener("click", () => { resetAlbumForm(); showAdvanced("albums"); });
  $("#visual-upload").addEventListener("click", () => showAdvanced("photos"));
  $("#public-preview").addEventListener("load", bindVisualPreview);
  $("#reset-album").addEventListener("click", resetAlbumForm);
  $("#album-month").innerHTML = monthNamesZh.map((name, index) => `<option value="${index + 1}">${String(index + 1).padStart(2, "0")} · ${name}</option>`).join("");
  $("#album-month").addEventListener("change", (event) => {
    const index = Number(event.target.value) - 1;
    if (!$("#album-id").value) {
      $("#album-title-zh").value = monthNamesZh[index];
      $("#album-title-en").value = monthNamesEn[index];
    }
  });

  $("#album-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = $("#album-state");
    const id = $("#album-id").value;
    const payload = {
      year: Number($("#album-year").value),
      month: Number($("#album-month").value),
      title_zh: $("#album-title-zh").value.trim(),
      title_en: $("#album-title-en").value.trim(),
      description: $("#album-description").value.trim(),
      published: $("#album-published").checked,
      sort_order: Number(`${$("#album-year").value}${String($("#album-month").value).padStart(2, "0")}`),
    };
    setFormState(output, "正在保存……");
    try {
      if (id) await rest(`portfolio_albums?id=eq.${id}`, { method: "PATCH", body: payload, prefer: "return=minimal" });
      else await rest("portfolio_albums", { method: "POST", body: payload, prefer: "return=minimal" });
      await loadAll();
      resetAlbumForm();
      setFormState(output, "月度档案已保存。", "success");
      toast("月度档案已保存。");
    } catch (error) { setFormState(output, error.message.includes("duplicate") ? "这个年月已经存在，请选择其他月份。" : error.message, "error"); }
  });

  $("#album-list").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-album]");
    if (edit) return editAlbum(edit.dataset.editAlbum);
    const toggle = event.target.closest("[data-toggle-album]");
    if (toggle) {
      const album = state.albums.find((item) => item.id === Number(toggle.dataset.toggleAlbum));
      if (!album) return;
      await rest(`portfolio_albums?id=eq.${album.id}`, { method: "PATCH", body: { published: !album.published }, prefer: "return=minimal" });
      await loadAll();
      toast(album.published ? "月份已转为草稿。" : "月份已经公开。");
      return;
    }
    const remove = event.target.closest("[data-delete-album]");
    if (remove) {
      const album = state.albums.find((item) => item.id === Number(remove.dataset.deleteAlbum));
      if (!album || !confirm(`确定删除 ${albumLabel(album)} 及其中的作品记录吗？`)) return;
      const albumPhotos = state.photos.filter((photo) => photo.album_id === album.id);
      for (const photo of albumPhotos) await deleteObject(photo.storage_path);
      await rest(`portfolio_albums?id=eq.${album.id}`, { method: "DELETE", prefer: "return=minimal" });
      state.selectedAlbumId = null;
      await loadAll();
      toast("月度档案已经删除。");
    }
  });

  $("#photo-album").addEventListener("change", (event) => {
    state.selectedAlbumId = event.target.value ? Number(event.target.value) : null;
    renderPhotos();
  });

  $("#upload-photos").addEventListener("click", async () => {
    const files = [...$("#photo-files").files];
    const album = state.albums.find((item) => item.id === Number($("#photo-album").value));
    const output = $("#photo-state");
    if (!album) return setFormState(output, "请先选择一个月度档案。", "error");
    if (!files.length) return setFormState(output, "请先选择照片。", "error");
    const progress = $("#upload-progress");
    progress.hidden = false;
    try {
      let sortOrder = Math.max(0, ...state.photos.filter((photo) => photo.album_id === album.id).map((photo) => photo.sort_order)) + 1;
      for (let index = 0; index < files.length; index += 1) {
        const original = files[index];
        progress.querySelector("span").textContent = `正在处理 ${index + 1} / ${files.length}：${original.name}`;
        progress.querySelector("i").style.width = `${index / files.length * 100}%`;
        const file = await prepareWebImage(original);
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${album.year}/${String(album.month).padStart(2, "0")}/${safeFileName(file.name)}.${extension}`;
        const imageUrl = await uploadObject(file, path);
        await rest("portfolio_photos", { method: "POST", body: { album_id: album.id, storage_path: path, image_url: imageUrl, title_zh: original.name.replace(/\.[^.]+$/, ""), title_en: "", alt_text: "黑白摄影作品", published: true, sort_order: sortOrder }, prefer: "return=minimal" });
        sortOrder += 1;
      }
      progress.querySelector("i").style.width = "100%";
      progress.querySelector("span").textContent = "上传完成";
      $("#photo-files").value = "";
      await loadAll();
      setFormState(output, `${files.length} 张照片已经上传。`, "success");
      toast("照片已上传并同步。");
    } catch (error) { setFormState(output, error.message, "error"); }
  });

  $("#photo-list").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-photo-form]");
    if (!form) return;
    event.preventDefault();
    const id = Number(form.dataset.photoForm);
    await rest(`portfolio_photos?id=eq.${id}`, { method: "PATCH", body: { title_zh: form.elements.title_zh.value.trim(), title_en: form.elements.title_en.value.trim(), alt_text: form.elements.alt_text.value.trim(), published: form.elements.published.checked }, prefer: "return=minimal" });
    await loadAll();
    toast("照片信息已保存。");
  });

  $("#photo-list").addEventListener("click", async (event) => {
    const move = event.target.closest("[data-move-photo]");
    if (move) {
      const photos = state.photos.filter((photo) => String(photo.album_id) === String(state.selectedAlbumId)).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      const index = photos.findIndex((photo) => photo.id === Number(move.dataset.movePhoto));
      const other = photos[index + Number(move.dataset.direction)];
      if (!other) return;
      const current = photos[index];
      await Promise.all([
        rest(`portfolio_photos?id=eq.${current.id}`, { method: "PATCH", body: { sort_order: other.sort_order }, prefer: "return=minimal" }),
        rest(`portfolio_photos?id=eq.${other.id}`, { method: "PATCH", body: { sort_order: current.sort_order }, prefer: "return=minimal" }),
      ]);
      await loadAll();
      return;
    }
    const remove = event.target.closest("[data-delete-photo]");
    if (remove) {
      const photo = state.photos.find((item) => item.id === Number(remove.dataset.deletePhoto));
      if (!photo || !confirm(`确定删除“${photo.title_zh || "这张照片"}”吗？`)) return;
      await deleteObject(photo.storage_path);
      await rest(`portfolio_photos?id=eq.${photo.id}`, { method: "DELETE", prefer: "return=minimal" });
      await loadAll();
      toast("照片已经删除。");
    }
  });

  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = $("#settings-state");
    const payload = { quote_text: $("#setting-quote").value.trim(), quote_author: $("#setting-author").value.trim(), about_text: $("#setting-about").value.trim(), hero_image_url: $("#setting-hero-url").value.trim() };
    setFormState(output, "正在保存……");
    try {
      if (state.settings) await rest("site_settings?id=eq.main", { method: "PATCH", body: payload, prefer: "return=minimal" });
      else await rest("site_settings", { method: "POST", body: { id: "main", ...payload }, prefer: "return=minimal" });
      await loadAll();
      setFormState(output, "首页内容已保存并同步。", "success");
      toast("首页内容已更新。");
    } catch (error) { setFormState(output, error.message, "error"); }
  });

  $("#upload-hero").addEventListener("click", async () => {
    const source = $("#hero-file").files[0];
    const output = $("#settings-state");
    if (!source) return setFormState(output, "请先选择一张首图。", "error");
    setFormState(output, "正在上传首图……");
    try {
      const file = await prepareWebImage(source, 2600);
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `site/${safeFileName(file.name)}.${extension}`;
      const url = await uploadObject(file, path);
      $("#setting-hero-url").value = url;
      setFormState(output, "首图已上传，请点击“保存首页内容”。", "success");
    } catch (error) { setFormState(output, error.message, "error"); }
  });

  $("#message-list").addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-delete-message]");
    if (!remove || !confirm("确定删除这条公开留言吗？")) return;
    await rest(`guestbook_messages?id=eq.${remove.dataset.deleteMessage}`, { method: "DELETE", prefer: "return=minimal" });
    await loadAll();
    toast("留言已经删除。");
  });

  async function restore() {
    resetAlbumForm();
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;
    try {
      let session = JSON.parse(stored);
      const expiresAt = Number(session.expires_at || 0) * 1000;
      if (expiresAt && expiresAt < Date.now() + 30000 && session.refresh_token) session = await refreshSession(session.refresh_token);
      if (String(session.user?.email || "").toLowerCase() !== ADMIN_EMAIL) throw new Error("wrong account");
      saveSession(session);
      showAdmin();
      await loadAll();
    } catch { signOut(false); }
  }

  restore();
})();
