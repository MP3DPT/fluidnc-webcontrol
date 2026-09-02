import { useEffect, useState } from 'react';
import { ArrowUpCircle, Settings, Trash2, Wrench, X } from 'lucide-react';
import { Switch } from './ui/Switch';
import type { PluginInfo, SchemaField } from '../types';

interface Props {
  plugin: PluginInfo;
  send: (message: Record<string, unknown>) => void;
  onUninstall: (id: string) => void;
  /** Set only when the plugin index has a newer version than what's installed. */
  latestVersion?: string;
  onUpdate?: () => void;
  updating?: boolean;
}

function matches(condition: Record<string, unknown> | undefined, config: Record<string, unknown>): boolean {
  if (!condition) return true;
  return Object.entries(condition).every(([key, value]) => config[key] === value);
}

interface DeferredInputProps {
  type: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}

/**
 * Text/number fields used to persist on every keystroke, with the input's
 * displayed value bound straight to the server-echoed config prop - each
 * keystroke raced its own round trip against the next one, and a slower
 * network (or just typing faster than the round trip) reliably dropped
 * characters, since a stale echo arriving between keystrokes reset the DOM
 * value out from under whatever was being typed. Local state decouples
 * what's displayed from the round trip entirely; onCommit (blur, or Enter)
 * sends the final value once instead of once per character.
 */
function DeferredInput({ type, value, placeholder, onCommit }: DeferredInputProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  // Only follow external updates while the user isn't actively editing -
  // otherwise a settings broadcast arriving mid-edit would still clobber it.
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <input
      type={type}
      placeholder={placeholder}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function PluginCard({ plugin, send, onUninstall, latestVersion, onUpdate, updating }: Props) {
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
              <DeferredInput
                type="number"
                value={String(Number(value ?? 0))}
                onCommit={(v) => persist({ [key]: Number(v) })}
              />
              {field.unit && <span>{field.unit}</span>}
            </span>
          </label>
        ) : (
          <label>
            {field.label}
            <DeferredInput
              type={field.type}
              placeholder={field.placeholder}
              value={String(value ?? '')}
              onCommit={(v) => persist({ [key]: v })}
            />
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="plugin-card">
      <div className="plugin-card-title-row">
        <span className="plugin-card-title-group">
          <strong>{manifest.name}</strong>
          {manifest.tool && (
            <span className="plugin-card-tool-tag">
              <Wrench size={11} />
              Tool - open from Tools
            </span>
          )}
        </span>
        <div className="plugin-card-actions">
          {latestVersion && (
            <button onClick={onUpdate} disabled={updating} title={`Update to v${latestVersion}`}>
              <ArrowUpCircle size={14} />
              {updating ? 'Updating…' : `Update to v${latestVersion}`}
            </button>
          )}
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
