import React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { report } from '../lib/errorReporter';
import { EmptyState } from './ui';
import { t } from '../i18n';

// Catches render errors anywhere below it: shows a way out instead of a blank
// page, and reports the error when error tracking is on (lib/errorReporter).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error, info) {
    report('render', error, { componentStack: info && info.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container container-narrow error-boundary" role="alert">
        <EmptyState level={1} icon={TriangleAlert} title={t('crash.title')}
          action={(
            <div className="form-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}><RotateCcw size={16} aria-hidden="true" />{t('crash.reload')}</button>
              <a className="btn btn-secondary" href="/">{t('crash.home')}</a>
            </div>
          )}>
          {t('crash.text')}
        </EmptyState>
      </div>
    );
  }
}
