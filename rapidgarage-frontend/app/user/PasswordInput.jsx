import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Password input with a show/hide toggle. Extra props go to the <input>.
export default class PasswordInput extends React.Component {
  constructor(props) {
    super(props);
    this.state = { visible: false };
  }

  render() {
    const { visible } = this.state;
    const props = Object.assign({}, this.props);
    return (
      <div className="input-wrap">
        <input {...props} className="input" type={visible ? 'text' : 'password'} />
        <button type="button" className="btn btn-ghost btn-icon btn-sm input-action" aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible} aria-controls={props.id} onClick={() => this.setState({ visible: !visible })}>
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    );
  }
}
