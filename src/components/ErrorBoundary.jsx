import React from 'react';

/**
 * 兜底：任何渲染期异常都显示在这里，而不是白屏。
 * 自用工具没有监控，白屏等于无从下手。
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error('[inkdraft] 渲染异常', err, info);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div className="crash">
        <h2>页面出错了</h2>
        <p className="hint">
          内容已自动保存在本地文件里，刷新通常不影响稿件。若反复出现，把下面的信息发出来。
        </p>
        <pre>{String(err?.stack || err)}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          刷新重试
        </button>
      </div>
    );
  }
}
