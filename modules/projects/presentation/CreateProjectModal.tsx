import React, { useState } from 'react';
import { Project } from '../domain/Project';
import { X, FolderPlus, Pencil } from 'lucide-react';
import { useDialog } from '../../desktop/application/useDialog';

interface CreateProjectModalProps {
  isOpen: boolean;
  project?: Project;
  onClose: () => void;
  onSaveProject: (project: Project) => Promise<void>;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  project,
  onClose,
  onSaveProject
}) => {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [color, setColor] = useState(project?.color || '#6366f1');
  const [tagsInput, setTagsInput] = useState(project?.tags.join(', ') || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialog(isOpen, () => { if (!saving) onClose(); });

  if (!isOpen) return null;

  const presetColors = [
    '#6366f1',
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ec4899',
    '#8b5cf6',
    '#14b8a6',
    '#f43f5e'
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!name.trim()) {
      setError('Enter a project name.');
      return;
    }

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    const nextProject: Project = {
      id: project?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || (project ? '' : 'Cloud Infrastructure Project'),
      color,
      tags,
      createdAt: project?.createdAt ?? Date.now()
    };

    setSaving(true);
    try {
      await onSaveProject(nextProject);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this project.');
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="project-title" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <h3 id="project-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            {project ? <Pencil className="w-4 h-4 text-indigo-500" /> : <FolderPlus className="w-4 h-4 text-indigo-500" />}
            {project ? 'Edit project' : 'Create project'}
          </h3>
          <button
            aria-label="Close project dialog"
            disabled={saving}
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="project-name" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block mb-1">
              Project Name *
            </label>
            <input
              id="project-name"
              data-autofocus
              disabled={saving}
              maxLength={100}
              type="text"
              required
              placeholder="e.g. Acme Production, Global Edge APIs"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="project-description" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block mb-1">
              Description
            </label>
            <input
              id="project-description"
              disabled={saving}
              type="text"
              placeholder="e.g. High-throughput edge infrastructure"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block mb-1.5">
              Color Identifier
            </label>
            <div className="flex items-center gap-2">
              {presetColors.map(c => (
                <button
                  key={c}
                  type="button"
                  disabled={saving}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    color === c ? 'scale-125 ring-2 ring-neutral-400 dark:ring-neutral-500 ring-offset-2 dark:ring-offset-neutral-900' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Project color ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="project-tags" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block mb-1">
              Tags (comma separated)
            </label>
            <input
              id="project-tags"
              disabled={saving}
              type="text"
              placeholder="Production, Vercel, Netlify"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-[11px]"
            />
          </div>

          {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
          <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm transition-colors"
            >
              {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
