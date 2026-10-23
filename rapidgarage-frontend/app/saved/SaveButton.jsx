import React from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import * as saved from '../lib/saved';
import { t } from '../i18n';

// Heart (favorite) toggle for one sale. variant="card" is the round icon on a card photo;
// "full" is a labelled button (sale page, Saved page).
export default class SaveButton extends React.Component {
  constructor(props) {
    super(props);
    this.update = () => this.forceUpdate();
  }

  componentDidMount() { this.unsub = saved.subscribe(this.update); }
  componentWillUnmount() { if (this.unsub) this.unsub(); }

  render() {
    const { post, variant } = this.props;
    const user = saved.currentUser();
    if (user === undefined || !post || post.hidden) return null;
    if (user && user.id === post.userId) return null; // your own sale
    const card = variant === 'card';
    const cls = card ? 'save-btn save-btn-card' : 'btn btn-secondary save-btn save-btn-full';
    if (!user) {
      if (card) return null;
      return <Link className={cls} to="/login"><Heart size={16} aria-hidden="true" />{t('save.login')}</Link>;
    }
    const on = saved.isSaved(post.id);
    const label = on ? t('save.saved') : t('save.save');
    return (
      <button type="button" className={cls + (on ? ' is-saved' : '')} aria-pressed={on}
        aria-label={card ? (on ? t('save.removeNamed', { title: post.title }) : t('save.saveNamed', { title: post.title })) : undefined}
        title={card ? (on ? t('save.saved') : t('save.thisSale')) : undefined}
        disabled={saved.isPending(post.id)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); saved.toggle(post); }}>
        <Heart size={card ? 18 : 16} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />
        {card ? null : label}
      </button>
    );
  }
}
