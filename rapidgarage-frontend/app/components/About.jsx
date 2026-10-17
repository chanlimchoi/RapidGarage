import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Camera, Search, Store } from 'lucide-react';

const FEATURES = [
  [Search, 'Search by distance', 'Find sales within 5 to 50 miles of you or any address.'],
  [Camera, 'Photos on every listing', 'Up to five photos per sale, resized and stripped of location data.'],
  [MapPin, 'See it on the map', 'Nearby pins group together so busy weekends stay readable.'],
];

export default function About() {
  return (
    <div className="container container-narrow">
      <header className="page-header"><div><h1>About RapidGarage</h1><p>The easiest way to find and post garage and yard sales near you.</p></div></header>
      <div className="stack">
        {FEATURES.map(([Icon, title, text]) => (
          <div key={title} className="panel row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <span className="empty-icon" style={{ margin: 0, width: 44, height: 44, flex: 'none' }}><Icon size={20} aria-hidden="true" /></span>
            <div><h2 className="h4" style={{ marginBottom: 4 }}>{title}</h2><p className="muted" style={{ margin: 0 }}>{text}</p></div>
          </div>
        ))}
        <div className="form-actions"><Link className="btn btn-primary" to="/newpost"><Store size={16} aria-hidden="true" />Post a sale</Link><Link className="btn btn-secondary" to="/">Browse sales</Link></div>
      </div>
    </div>
  );
}
