(function () {
  var loginPanel = document.getElementById('moderation-login');
  var consolePanel = document.getElementById('moderation-console');
  var loginForm = document.getElementById('moderation-login-form');
  var loginStatus = document.getElementById('moderation-login-status');
  var statusLine = document.getElementById('moderation-status');
  var list = document.getElementById('moderation-list');
  var logout = document.getElementById('moderation-logout');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-status]'));
  if (!loginPanel || !consolePanel || !loginForm) return;

  var tokenKey = 'tzl_moderation_token';
  var currentStatus = 'pending';

  function setLoginStatus(text, kind) {
    if (!loginStatus) return;
    loginStatus.textContent = text || '';
    loginStatus.classList.toggle('is-error', kind === 'error');
    loginStatus.classList.toggle('is-success', kind === 'success');
  }

  function setStatus(text, kind) {
    if (!statusLine) return;
    statusLine.textContent = text || '';
    statusLine.classList.toggle('is-error', kind === 'error');
    statusLine.classList.toggle('is-success', kind === 'success');
  }

  function getToken() { return sessionStorage.getItem(tokenKey) || ''; }

  function authHeaders() {
    return { Accept: 'application/json', 'x-moderation-token': getToken() };
  }

  function showConsole() {
    loginPanel.hidden = true;
    consolePanel.hidden = false;
    loadMessages();
  }

  function showLogin() {
    loginPanel.hidden = false;
    consolePanel.hidden = true;
    sessionStorage.removeItem(tokenKey);
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function button(action, id, label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = action;
    btn.dataset.id = id;
    btn.textContent = label;
    return btn;
  }

  function renderItem(item) {
    var article = document.createElement('article');
    article.className = 'moderation-item';

    var meta = document.createElement('div');
    meta.className = 'moderation-item__meta';
    var name = document.createElement('strong');
    name.textContent = item.authorName || '匿名';
    var time = document.createElement('span');
    time.textContent = formatDate(item.createdAt);
    var state = document.createElement('span');
    state.textContent = '状态：' + (item.status || '');
    meta.appendChild(name); meta.appendChild(time); meta.appendChild(state);

    var content = document.createElement('p');
    content.className = 'moderation-item__content';
    content.textContent = item.content || '';

    var contact = document.createElement('p');
    contact.className = 'moderation-item__contact';
    contact.textContent = item.contact ? '联系邮箱：' + item.contact : '未留联系邮箱';

    var actions = document.createElement('div');
    actions.className = 'moderation-item__actions';
    if (item.status !== 'published') actions.appendChild(button('approve', item.id, '通过'));
    if (item.status !== 'rejected') actions.appendChild(button('reject', item.id, '拒绝'));
    actions.appendChild(button('reply', item.id, '回复'));
    actions.appendChild(button('delete', item.id, '删除'));

    article.appendChild(meta); article.appendChild(content); article.appendChild(contact); article.appendChild(actions);
    if (item.adminReply) {
      var reply = document.createElement('p');
      reply.className = 'moderation-item__content';
      reply.textContent = '回复：' + item.adminReply;
      article.appendChild(reply);
    }
    return article;
  }

  async function loadMessages() {
    if (!list) return;
    setStatus('加载中…');
    list.textContent = '';
    try {
      var response = await fetch('/api/site-moderation/messages?status=' + encodeURIComponent(currentStatus) + '&pageSize=50', { headers: authHeaders() });
      var payload = await response.json();
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok || !payload.success) throw new Error(payload.message || '加载失败');
      var items = (payload.data && payload.data.items) || [];
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'message-empty';
        empty.textContent = '当前分类没有留言。';
        list.appendChild(empty);
      }
      items.forEach(function (item) { list.appendChild(renderItem(item)); });
      setStatus('共 ' + ((payload.data && payload.data.total) || items.length) + ' 条');
    } catch (error) {
      setStatus(error.message || '加载失败', 'error');
    }
  }

  async function act(action, id) {
    var body = {};
    if (action === 'reply') {
      var reply = window.prompt('输入回复内容（1–500 字）');
      if (!reply) return;
      body.reply = reply;
    }
    if (action === 'reject') {
      var reason = window.prompt('拒绝原因（可留空）') || '';
      body.reason = reason;
    }
    if (action === 'approve') body.reason = '';
    if (action === 'delete' && !window.confirm('确定删除这条留言？')) return;
    try {
      var response = await fetch('/api/site-moderation/messages/' + id + '/' + action, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body)
      });
      var payload = await response.json();
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok || !payload.success) throw new Error(payload.message || '操作失败');
      await loadMessages();
    } catch (error) {
      setStatus(error.message || '操作失败', 'error');
    }
  }

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    setLoginStatus('正在验证…');
    try {
      var response = await fetch('/api/site-moderation/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: new FormData(loginForm).get('password') || '' })
      });
      var payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || '密码错误');
      sessionStorage.setItem(tokenKey, payload.data.token);
      setLoginStatus('');
      showConsole();
    } catch (error) {
      setLoginStatus(error.message || '登录失败', 'error');
    }
  });

  if (logout) logout.addEventListener('click', async function () {
    var token = getToken();
    if (token) {
      try {
        await fetch('/api/site-moderation/logout', {
          method: 'POST',
          headers: { 'x-moderation-token': token }
        });
      } catch (error) {}
    }
    showLogin();
  });
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (item) { item.classList.remove('is-active'); });
      tab.classList.add('is-active');
      currentStatus = tab.dataset.status || 'pending';
      loadMessages();
    });
  });
  if (list) {
    list.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!target) return;
      act(target.dataset.action, target.dataset.id);
    });
  }

  if (getToken()) showConsole(); else showLogin();
})();
