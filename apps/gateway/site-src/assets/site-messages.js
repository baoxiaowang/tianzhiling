(function () {
  var form = document.getElementById('message-form');
  var list = document.getElementById('message-list');
  var status = document.getElementById('message-status');
  var loadMore = document.getElementById('message-load-more');
  if (!form || !list) return;

  var page = 1;
  var hasMore = false;
  var loading = false;

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-success', kind === 'success');
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function renderItem(item) {
    var article = document.createElement('article');
    article.className = 'message-item';

    var head = document.createElement('div');
    head.className = 'message-item__head';
    var name = document.createElement('strong');
    name.textContent = item.authorName || '匿名';
    var time = document.createElement('time');
    time.textContent = formatDate(item.publishedAt);
    head.appendChild(name);
    head.appendChild(time);

    var body = document.createElement('p');
    body.className = 'message-item__body';
    body.textContent = item.content || '';
    article.appendChild(head);
    article.appendChild(body);

    if (item.adminReply) {
      var reply = document.createElement('div');
      reply.className = 'message-item__reply';
      var label = document.createElement('strong');
      label.textContent = '天之灵回复：';
      reply.appendChild(label);
      reply.appendChild(document.createTextNode(item.adminReply));
      article.appendChild(reply);
    }
    return article;
  }

  async function load(reset) {
    if (loading) return;
    loading = true;
    if (reset) {
      page = 1;
      list.textContent = '';
    }
    try {
      var response = await fetch('/api/site-messages?page=' + page + '&pageSize=10', { headers: { Accept: 'application/json' } });
      var payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || '加载失败');
      var data = payload.data || {};
      var items = data.items || [];
      if (!items.length && page === 1) {
        var empty = document.createElement('p');
        empty.className = 'message-empty';
        empty.textContent = '还没有公开留言。你可以写下第一条。';
        list.appendChild(empty);
      }
      items.forEach(function (item) { list.appendChild(renderItem(item)); });
      hasMore = Boolean(data.hasMore);
      if (loadMore) loadMore.hidden = !hasMore;
      page += 1;
    } catch (error) {
      if (page === 1) {
        var failed = document.createElement('p');
        failed.className = 'message-empty';
        failed.textContent = '留言暂时加载失败，请稍后刷新。';
        list.appendChild(failed);
      }
    } finally {
      loading = false;
    }
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    setStatus('正在提交…');
    var data = new FormData(form);
    var payload = {
      authorName: String(data.get('authorName') || ''),
      content: String(data.get('content') || ''),
      contact: String(data.get('contact') || ''),
      agreementAccepted: data.get('agreementAccepted') === 'on',
      website: String(data.get('website') || '')
    };
    try {
      var response = await fetch('/api/site-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      var result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || '提交失败');
      form.querySelector('#message-content').value = '';
      form.querySelector('#message-agreement').checked = false;
      setStatus('已提交，等待审核。通过后会显示在下面的留言区。', 'success');
    } catch (error) {
      setStatus(error.message || '提交失败，请稍后再试。', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });

  if (loadMore) {
    loadMore.addEventListener('click', function () { load(false); });
  }
  load(true);
})();
