import React from 'react';
import { Link } from 'react-router-dom';
import { Route as RouteIcon, Check } from 'lucide-react';
import * as plan from '../lib/routePlan';
import toast from '../components/toast';
import { t } from '../i18n';

// "Add to route" toggle for one sale (sale page, Favorites). Works logged out:
// the picks stay on this device.
export default class AddToRouteButton extends React.Component {
  constructor(props) { super(props); this.update = () => this.forceUpdate(); }
  componentDidMount() { this.unsub = plan.subscribe(this.update); }
  componentWillUnmount() { if (this.unsub) this.unsub(); }

  toggle() {
    const { post } = this.props;
    if (plan.isPicked(post.id)) { plan.remove(post.id); toast.success(t('rt.removedToast')); return; }
    if (plan.isFull()) { toast.error(t('rt.fullToast', { max: plan.MAX_STOPS })); return; }
    plan.add(post.id);
    toast.success(t('rt.addedToast', { count: plan.picked().length }));
  }

  render() {
    const { post, compact } = this.props;
    if (!post || post.hidden) return null;
    const on = plan.isPicked(post.id);
    return (
      <span className="route-add">
        <button type="button" className={'btn btn-secondary' + (compact ? ' btn-sm' : '') + (on ? ' is-on' : '')} aria-pressed={on}
          aria-label={compact ? (on ? t('rt.removeNamed', { title: post.title }) : t('rt.addNamed', { title: post.title })) : undefined}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); this.toggle(); }}>
          {on ? <Check size={16} aria-hidden="true" /> : <RouteIcon size={16} aria-hidden="true" />}{on ? t('rt.onRoute') : t('rt.add')}
        </button>
        {on && !compact ? <Link className="small" to="/route">{t('rt.open', { count: plan.picked().length })}</Link> : null}
      </span>
    );
  }
}
