/**
 * dsh-localnote — 浏览器端（client.js）
 *
 * dsh 客户端插件：在 shell.overlay 槽位注册一个"笔记 / 待办"面板浮窗。
 * - 列出笔记（GET /dsh-localnote/notes）
 * - 新建（POST /dsh-localnote/notes）
 * - 切换完成态（PATCH /dsh-localnote/notes/toggle）
 * - 删除（DELETE /dsh-localnote/notes）
 *
 * 结构要点（与 dsh-stock-watch 的 client.js 一致）：
 *   - window.__ModuleLoader__.load({ id, factory }) 打包成 loader 可识别的模块
 *   - factory 返回带 apply / inject 的 module exports
 *   - apply(ctx) 通过 ctx.slots.inject("shell.overlay", ...) 把 React 组件挂到页面浮图层
 */
window.__ModuleLoader__.load({
  id: 'dsh-localnote',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');
    const { useState, useEffect, useRef } = react;

    // ---------------------------------------------------------------- CSS
    const styleTag = document.createElement('style');
    styleTag.textContent = `
.hd-panel{position:fixed;top:64px;right:16px;z-index:9990;width:300px;max-height:70vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:rgba(15,18,26,.96);border:1px solid rgba(255,255,255,.14);color:#e5e7eb;box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(10px);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;pointer-events:auto}
.hd-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex:none;cursor:move;user-select:none}
.hd-title{font-weight:700;color:#22d3ee;white-space:nowrap}
.hd-close{background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;border-radius:6px}
.hd-close:hover{color:#fff;background:rgba(255,255,255,.08)}
.hd-stats{padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.06);color:#9ca3af;font-size:11px;flex:none}
.hd-list{overflow-y:auto;padding:6px;flex:1 1 auto}
.hd-empty{padding:16px 10px;text-align:center;color:#6b7280}
.hd-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}
.hd-row:hover{background:rgba(255,255,255,.05)}
.hd-check{flex:none;width:16px;height:16px;border-radius:4px;border:1px solid #4b5563;background:transparent;cursor:pointer;color:transparent;font-size:11px;line-height:14px;text-align:center}
.hd-check.hd-on{background:#22d3ee;border-color:#22d3ee;color:#0f121a}
.hd-text{flex:1 1 auto;word-break:break-word}
.hd-text.hd-done{color:#6b7280;text-decoration:line-through}
.hd-del{flex:none;background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:13px;padding:0 4px;border-radius:4px;opacity:0}
.hd-row:hover .hd-del{opacity:1}
.hd-del:hover{color:#ff6b6b}
.hd-inputbar{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(255,255,255,.08);flex:none}
.hd-input{flex:1 1 auto;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e5e7eb;padding:6px 10px;font:inherit;outline:none}
.hd-input:focus{border-color:#22d3ee}
.hd-add{flex:none;background:#22d3ee;border:none;border-radius:8px;color:#0f121a;font-weight:700;padding:6px 12px;cursor:pointer}
.hd-add:disabled{opacity:.5;cursor:not-allowed}
.hd-pill{position:fixed;top:64px;right:16px;z-index:9989;padding:6px 12px;border-radius:999px;background:rgba(15,18,26,.93);border:1px solid rgba(34,211,238,.5);color:#22d3ee;cursor:pointer;font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;user-select:none;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.hd-pill:hover{border-color:#22d3ee;background:rgba(34,211,238,.16)}
`;
    document.head.appendChild(styleTag);

    // ---------------------------------------------------------- 面板组件
    function HelloPanel(props) {
      const [open, setOpen] = useState(false);
      const [notes, setNotes] = useState(null);
      const [stats, setStats] = useState(null);
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState(null);
      const inputRef = useRef(null);
      // 可拖动：pos 是相对初始位置（右上角）的像素偏移 (dx, dy)。
      const [pos, setPos] = useState({ x: 0, y: 0 });

      // 在标题栏按住鼠标左键开始拖动；mousemove 更新偏移，mouseup 结束。
      const onHeaderDown = (e) => {
        if (e.button !== 0) return; // 只认左键
        const startX = e.clientX, startY = e.clientY;
        const baseX = pos.x, baseY = pos.y;
        const onMove = (ev) => {
          setPos({ x: baseX + (ev.clientX - startX), y: baseY + (ev.clientY - startY) });
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.userSelect = 'none'; // 拖动时不选中文本
        e.preventDefault();
      };

      const load = () => {
        Promise.all([
          fetch('/dsh-localnote/notes').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
          fetch('/dsh-localnote/stats').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
        ]).then(([n, s]) => {
          setNotes(n.notes);
          setStats(s);
        }).catch((e) => setErr(String(e && e.message ? e.message : e)));
      };

      useEffect(() => {
        if (!open) return;
        setErr(null);
        load();
      }, [open]);

      const addNote = () => {
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true); setErr(null);
        fetch('/dsh-localnote/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: t }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(() => { setText(''); load(); })
          .catch((e) => setErr(String(e && e.message ? e.message : e)))
          .finally(() => setBusy(false));
      };

      const toggle = (id) => {
        fetch('/dsh-localnote/notes/toggle', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); })
          .then(load)
          .catch((e) => setErr(String(e && e.message ? e.message : e)));
      };

      const del = (id) => {
        fetch('/dsh-localnote/notes', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); })
          .then(load)
          .catch((e) => setErr(String(e && e.message ? e.message : e)));
      };

      const onKey = (e) => { if (e.key === 'Enter') addNote(); };

      const body = !open ? null : react.createElement('div', { className: 'hd-panel', style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' } },
        react.createElement('div', { className: 'hd-header', onMouseDown: onHeaderDown,
          title: '按住拖动面板' },
          react.createElement('span', { className: 'hd-title' }, '📝 dsh-localnote 笔记'),
          react.createElement('button', { className: 'hd-close', onClick: () => setOpen(false) }, '✕'),
        ),
        react.createElement('div', { className: 'hd-stats' },
          stats ? (stats.total + ' 条 · ' + stats.done + ' 已完成') : '…'
        ),
        react.createElement('div', { className: 'hd-list' },
          err
            ? react.createElement('div', { className: 'hd-empty' }, '出错了: ' + err)
            : !notes
              ? react.createElement('div', { className: 'hd-empty' }, '加载中…')
              : notes.length === 0
                ? react.createElement('div', { className: 'hd-empty' }, '还没有笔记，加一条吧')
                : notes.map((n) => react.createElement('div', { key: n.id, className: 'hd-row' },
                    react.createElement('button', {
                      className: 'hd-check' + (n.done ? ' hd-on' : ''),
                      onClick: () => toggle(n.id),
                      title: n.done ? '标记为未完成' : '标记为完成',
                    }, n.done ? '✓' : ''),
                    react.createElement('span', { className: 'hd-text' + (n.done ? ' hd-done' : '') }, n.text),
                    react.createElement('button', { className: 'hd-del', onClick: () => del(n.id), title: '删除' }, '✕'),
                  )),
        ),
        react.createElement('div', { className: 'hd-inputbar' },
          react.createElement('input', {
            ref: inputRef,
            className: 'hd-input',
            value: text,
            placeholder: '加一条笔记…',
            onChange: (e) => setText(e.target.value),
            onKeyDown: onKey,
          }),
          react.createElement('button', { className: 'hd-add', onClick: addNote, disabled: busy || !text.trim() }, '添加'),
        ),
      );

      const pill = react.createElement('button', { className: 'hd-pill', onClick: () => setOpen(!open), style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' } },
        open ? '关闭' : '📝 笔记');
      return react.createElement('div', null, pill, body);
    }

    // ---------------------------------------------------------- 插件主体
    /** Required services: slots（布局挂载点）。 */
    const inject = ['slots'];

    /**
     * Client plugin body：在 shell.overlay 注册右上角浮窗。
     * @param ctx - client root context。
     */
    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-localnote',
      }, (props) => react.createElement(HelloPanel, Object.assign({}, props, {
        connection: ctx.get('connection'),
      }))));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
