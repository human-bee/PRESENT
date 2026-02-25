'use client';

import { useMemo, useState } from 'react';
import {
  filterGuidedSections,
  formatFieldSource,
  inputIdForPath,
  resolveApplyModeForPath,
} from '../_lib/guided-config';
import type { GuidedField, GuidedSection, ModelControlStatusResponse } from '../_lib/types';

type Props = {
  sections: GuidedSection[];
  status: ModelControlStatusResponse | null;
  guidedValues: Record<string, string>;
  busy: boolean;
  onGuidedFieldChange: (path: string, value: string) => void;
  onLoadEffectiveValues: () => void;
  onSaveGuidedUser: () => void;
  onSaveGuidedAdmin?: () => void;
  adminProfileForm?: {
    scopeType: 'global' | 'room' | 'user' | 'task';
    scopeId: string;
    taskPrefix: string;
    priority: string;
    enabled: boolean;
    onScopeTypeChange: (value: 'global' | 'room' | 'user' | 'task') => void;
    onScopeIdChange: (value: string) => void;
    onTaskPrefixChange: (value: string) => void;
    onPriorityChange: (value: string) => void;
    onEnabledChange: (value: boolean) => void;
  };
};

const modeClasses: Record<'live' | 'next_session' | 'restart_required', string> = {
  live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  next_session: 'bg-amber-50 text-amber-700 border-amber-200',
  restart_required: 'bg-rose-50 text-rose-700 border-rose-200',
};

const sourceClasses: Record<'gray' | 'indigo' | 'emerald' | 'amber', string> = {
  gray: 'bg-gray-50 text-gray-700 border-gray-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
};

const renderFieldInput = (params: {
  field: GuidedField;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
}) => {
  const { field, value, busy, onChange } = params;
  const inputId = inputIdForPath(field.path);
  if (field.kind === 'enum') {
    return (
      <select
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
        disabled={busy}
      >
        <option value="">Unset</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'boolean') {
    return (
      <select
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
        disabled={busy}
      >
        <option value="">Unset</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }
  const datalistId = field.suggestions?.length ? `${inputId}-suggestions` : undefined;
  return (
    <>
      <input
        id={inputId}
        type={field.kind === 'string' ? 'text' : 'number'}
        inputMode={field.kind === 'string' ? 'text' : 'decimal'}
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        list={datalistId}
        placeholder={field.path}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
        disabled={busy}
      />
      {datalistId ? (
        <datalist id={datalistId}>
          {field.suggestions?.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </>
  );
};

export function GuidedControlsPanel({
  sections,
  status,
  guidedValues,
  busy,
  onGuidedFieldChange,
  onLoadEffectiveValues,
  onSaveGuidedUser,
  onSaveGuidedAdmin,
  adminProfileForm,
}: Props) {
  const [search, setSearch] = useState('');
  const filteredSections = useMemo(() => filterGuidedSections(sections, search), [sections, search]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Guided Controls</h2>
          <p className="mt-1 text-sm text-gray-600">
            Use labeled fields with validation, source tracing, and apply-mode guidance. Leave a field blank to keep it unset.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onLoadEffectiveValues}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Load Effective Values
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <label className="text-sm">
          <span className="font-medium text-gray-800">Quick Filter</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search fields by name/path/help..."
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <div className="text-xs text-gray-600">
          Showing {filteredSections.reduce((sum, section) => sum + section.fields.length, 0)} fields
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {filteredSections.map((section, index) => (
          <details key={section.id} className="rounded-lg border border-gray-200 p-4" defaultOpen={index < 2 || search.trim().length > 0}>
            <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">{section.title}</summary>
            <p className="mt-1 text-xs text-gray-600">{section.description}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {section.fields.map((field) => {
                const value = guidedValues[field.path] ?? '';
                const applyMode = resolveApplyModeForPath(field.path, status?.resolved?.applyModes);
                const fieldSource = status?.resolved?.fieldSources?.[field.path];
                const sourceInfo = formatFieldSource(fieldSource);
                const sourceSuffix =
                  fieldSource && fieldSource.scope !== 'env' && fieldSource.scope !== 'request'
                    ? ` (${fieldSource.scopeId})`
                    : '';
                return (
                  <label key={field.path} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-800">{field.label}</span>
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${modeClasses[applyMode]}`}>
                        {applyMode}
                      </span>
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${sourceClasses[sourceInfo.tone]}`}>
                        {sourceInfo.label}
                        {sourceSuffix}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] font-mono text-gray-500">{field.path}</div>
                    {renderFieldInput({
                      field,
                      value,
                      busy,
                      onChange: (nextValue) => onGuidedFieldChange(field.path, nextValue),
                    })}
                    <span className="mt-1 block text-xs text-gray-500">{field.help}</span>
                  </label>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onSaveGuidedUser}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Save Guided User Overrides
        </button>
        {onSaveGuidedAdmin ? (
          <button
            type="button"
            disabled={busy}
            onClick={onSaveGuidedAdmin}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Save Guided Admin Profile
          </button>
        ) : null}
      </div>

      {adminProfileForm ? (
        <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium text-indigo-900">Admin Scope Type</span>
            <select
              value={adminProfileForm.scopeType}
              onChange={(event) =>
                adminProfileForm.onScopeTypeChange(event.target.value as 'global' | 'room' | 'user' | 'task')
              }
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              disabled={busy}
            >
              <option value="global">global</option>
              <option value="room">room</option>
              <option value="user">user</option>
              <option value="task">task</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-indigo-900">Admin Scope ID</span>
            <input
              type="text"
              value={adminProfileForm.scopeId}
              onChange={(event) => adminProfileForm.onScopeIdChange(event.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              disabled={busy}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-indigo-900">Task Prefix (optional)</span>
            <input
              type="text"
              value={adminProfileForm.taskPrefix}
              onChange={(event) => adminProfileForm.onTaskPrefixChange(event.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              disabled={busy}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-indigo-900">Priority (0-1000)</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={adminProfileForm.priority}
              onChange={(event) => adminProfileForm.onPriorityChange(event.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              disabled={busy}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-indigo-900 md:col-span-2">
            <input
              type="checkbox"
              checked={adminProfileForm.enabled}
              onChange={(event) => adminProfileForm.onEnabledChange(event.target.checked)}
              disabled={busy}
            />
            Profile enabled
          </label>
        </div>
      ) : null}
    </section>
  );
}
