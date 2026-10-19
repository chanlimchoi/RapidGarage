import React from 'react';
import { withRouter } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { duplicateSale, errorMessage } from '../api';
import { Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

// "Duplicate sale": copies the details, prices, unsold items and photos into a
// new sale without dates, then opens it for editing so the seller picks days.
// props: postId, small (btn-sm), label (optional text)
class DuplicateButton extends React.Component {
  constructor(props) {
    super(props);
    this.state = { busy: false };
  }

  run() {
    this.setState({ busy: true });
    duplicateSale(this.props.postId).then(({ ok, data }) => {
      if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, t('dup.failed'))); return; }
      toast.success(t('dup.done'));
      this.props.history.push('/post/' + data.id + '/edit');
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.network')); });
  }

  render() {
    const size = this.props.small ? 14 : 16;
    return (
      <button type="button" className={'btn btn-secondary' + (this.props.small ? ' btn-sm' : '')} disabled={this.state.busy} onClick={() => this.run()}>
        {this.state.busy ? <Spinner /> : <Copy size={size} aria-hidden="true" />}{this.props.label || t('dup.button')}
      </button>
    );
  }
}

export default withRouter(DuplicateButton);
