import React from 'react';
import { t } from './index';

// Like t(), but {placeholders} may be React elements, so a sentence can hold
// a link without splitting it into fragments that can't be reordered:
//   tx('map.noKeyUser', { link: <Link to="/settings">{t('map.addKeyLink')}</Link> })
export function tx(key, vars) {
  const strVars = {};
  const elements = {};
  Object.keys(vars || {}).forEach((k) => {
    if (React.isValidElement(vars[k])) elements[k] = vars[k]; else strVars[k] = vars[k];
  });
  // Keep element placeholders intact, then split on them.
  Object.keys(elements).forEach((k) => { strVars[k] = '{' + k + '}'; });
  const s = t(key, strVars);
  const parts = s.split(/(\{\w+\})/);
  return (
    <React.Fragment>
      {parts.map((p, i) => {
        const m = /^\{(\w+)\}$/.exec(p);
        return m && elements[m[1]] ? <React.Fragment key={i}>{elements[m[1]]}</React.Fragment> : p;
      })}
    </React.Fragment>
  );
}
