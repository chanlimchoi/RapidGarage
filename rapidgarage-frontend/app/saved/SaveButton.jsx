import React from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import * as saved from '../lib/saved';

// Star toggle for one sale. variant="card" is the round icon on a card photo;
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
      return <Link className={cls} to="/login"><Star size={16} aria-hidden="true" />Log in to save</Link>;
    }
    const on = saved.isSaved(post.id);
    const label = on ? 'Saved' : 'Save';
    return (
      <button type="button" className={cls + (on ? ' is-saved' : '')} aria-pressed={on}
        aria-label={card ? (on ? 'Remove ' + post.title + ' from Saved' : 'Save ' + post.title) : undefined}
        title={card ? (on ? 'Saved' : 'Save this sale') : undefined}
        disabled={saved.isPending(post.id)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); saved.toggle(post); }}>
        <Star size={card ? 18 : 16} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />
        {card ? null : label}
      </button>
    );
  }
}
