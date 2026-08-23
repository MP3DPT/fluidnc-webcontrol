import { useEffect, useState } from 'react';
import { Settings, Trash2, X } from 'lucide-react';
import { Switch } from './ui/Switch';
import type { PluginInfo, SchemaField } from '../types';

interface Props {
  plugin: PluginInfo;
  send: (message: Record<string, unknown>) => void;
  onUninstall: (id: string) => void;
}

function matches(condition: Record<string, unknown> | undefined, config: Record<string, unknown>): boolean {
  if (!condition) return true;
  return Object.entries(condition).every(([key, value]) => config[key] === value);
}

export function PluginCard({ plugin, send, onUninstall }: Props) {
  const { manifest, schema, config } = plugin;
  const [configuring, setConfiguring] = useState(false);

  const persist = (patch: Record<string, unknown>) => {
    send({ type: 'updatePluginSettings', pluginId: manifest.id, settings: patch });
  };

  // showIf conditions often reference a field the user hasn't touched yet -
  // its value only exists as a schema default, not yet in the saved config.
  // Fold every field's default into the config used for matching (and for
  // display), so a still-default value still satisfies a showIf check.
  const effectiveConfig: Record<string, unknown> = { ...config };
  for (const field of schema?.fields ?? []) {
    if (field.key && effectiveConfig[field.key] === undefined) {
      effectiveConfig[field.key] = field.default;
    }
  }

  // The plugin's own backend logic reads straight from the saved config, not
  // the schema - so a field left at its (only client-side) default never
  // actually reaches the plugin until the user edits it. Backfill any
  // missing defaults into the real saved config as soon as the card is
  // opened, so what's displayed always matches what the plugin sees.
  useEffect(() => {
    if (!configuring || !schema) return;
    const missing: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.key && config[field.key] === undefined && field.default !== undefined) {
        missing[field.key] = field.default;
      }
    }
    if (Object.keys(missing).length > 0) persist(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuring, schema, config]);

  const renderField = (field: SchemaField, index: number) => {
    if (!matches(field.showIf, effectiveConfig)) return null;

    if (field.type === 'hint') {
      return (
        <p className="hint" key={index}>
          {field.text}
        </p>
      );
    }

    const key = field.key as string;
    const value = effectiveConfig[key];

    return (
      <div className="row" key={key}>
        {field.type === 'checkbox' ? (
          <label>
            <input type="checkbox" checked={Boolean(value)} onChange={(e) => persist({ [key]: e.target.checked })} />
            {' '}
            {field.label}
          </label>
        ) : field.type === 'select' ? (
          <label>
            {field.label}
            <select value={String(value ?? '')} onChange={(e) => persist({ [key]: e.target.value })}>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : field.type === 'number' ? (
          <label>
            {field.label}
            <span className="field-row">
              <input
                type="number"
                value={Number(value ?? 0)}
                onChange={(e) => persist({ [key]: Number(e.target.value) })}
              />
              {field.unit && <span>{field.unit}</span>}
            </span>
          </label>
        ) : (
          <label>
            {field.label}
            <input
              type={field.type}
              placeholder={field.placeholder}
              value={String(value ?? '')}
              onChange={(e) => persist({ [key]: e.target.value })}
            />
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="plugin-card">
      <div className="plugin-card-title-row">
        <strong>{manifest.name}</strong>
        <div className="plugin-card-actions">
          <button onClick={() => setConfiguring((v) => !v)}>
            {configuring ? <X size={14} /> : <Settings size={14} />}
            {configuring ? 'Close' : 'Configure'}
          </button>
          <Switch
            checked={Boolean(config.enabled)}
            onChange={(checked) => persist({ enabled: checked })}
            label={config.enabled ? 'Enabled' : 'Disabled'}
          />
        </div>
      </div>
      <p className="plugin-meta">
        Version {manifest.version} · Author: {manifest.author} · ID: {manifest.id}
      </p>
      <p className="hint" style={{ margin: '0.2rem 0 0' }}>
        {manifest.description}
      </p>

      {configuring && (
        <div className="plugin-card-body">
          {schema?.fields.map(renderField)}

          {schema?.actions && schema.actions.length > 0 && (
            <div className="row">
              {schema.actions.map((action) => (
                <button
                  key={action.id}
                  disabled={!matches(action.enabledIf, effectiveConfig)}
                  className={action.danger ? 'danger' : undefined}
                  onClick={() => send({ type: 'pluginAction', pluginId: manifest.id, actionId: action.id })}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          <div className="row">
            <button className="danger" onClick={() => onUninstall(manifest.id)}>
              <Trash2 size={14} />
              Uninstall plugin
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
