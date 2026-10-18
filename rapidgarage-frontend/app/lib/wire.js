import React from 'react';

const CONTROLS = { input: 1, select: 1, textarea: 1 };
// The id / aria props belong on the real form control, even when it sits in a
// wrapper (e.g. an input with a "miles" suffix). Components pass them through.
export function wireControl(el, props) {
  if (!React.isValidElement(el)) return el;
  if (typeof el.type !== 'string' || CONTROLS[el.type]) return React.cloneElement(el, props);
  let done = false;
  const kids = React.Children.map(el.props.children, (c) => {
    if (done || !React.isValidElement(c)) return c;
    const out = wireControl(c, props);
    if (out !== c) done = true;
    return out;
  });
  return done ? React.cloneElement(el, {}, kids) : el;
}

