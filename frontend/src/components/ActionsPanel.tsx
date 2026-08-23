import { Home, RotateCcw, Unlock as UnlockIcon } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';

interface Props {
  disabled: boolean;
  send: (message: Record<string, unknown>) => void;
}

export function ActionsPanel({ disabled, send }: Props) {
  return (
    <Card>
      <CardHeader>Actions</CardHeader>
      <CardContent className="button-stack">
        <div className="row">
          <button disabled={disabled} title="$H" onClick={() => send({ type: 'home' })}>
            <Home size={15} />
            Home
          </button>
          <button disabled={disabled} title="$X" onClick={() => send({ type: 'unlock' })}>
            <UnlockIcon size={15} />
            Unlock
          </button>
          <button className="danger" disabled={disabled} onClick={() => send({ type: 'reset' })}>
            <RotateCcw size={15} />
            Soft Reset
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
