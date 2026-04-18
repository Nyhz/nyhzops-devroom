'use client';

import { useCallback, useRef, useState } from 'react';
import { TacTextarea } from '@/components/ui/tac-input';

interface DocDropzoneProps {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function DocDropzone({
  label,
  hint,
  value,
  onChange,
  disabled,
}: DocDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > 1_000_000) {
        setError('File too large (max 1 MB).');
        return;
      }
      const text = await file.text();
      setFileName(file.name);
      onChange(text);
    },
    [onChange],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await readFile(file);
    },
    [readFile, disabled],
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await readFile(file);
      e.target.value = '';
    },
    [readFile],
  );

  const handleClear = useCallback(() => {
    setFileName(null);
    setError(null);
    onChange('');
  }, [onChange]);

  return (
    <div>
      <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
        {label}
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`border border-dashed p-3 text-center cursor-pointer font-tactical text-xs tracking-wider transition-colors ${
          dragOver
            ? 'border-dr-amber bg-dr-amber/5 text-dr-amber'
            : 'border-dr-border text-dr-dim hover:border-dr-amber hover:text-dr-amber'
        } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {fileName ? (
          <span className="text-dr-green">LOADED: {fileName}</span>
        ) : value ? (
          <span className="text-dr-green">CONTENT PASTED ({value.length.toLocaleString()} chars)</span>
        ) : (
          <span>DROP FILE OR CLICK TO SELECT</span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          onChange={handleFileInput}
          className="hidden"
          disabled={disabled}
        />
      </div>

      <div className="text-dr-dim font-tactical text-xs mt-1">{hint}</div>

      <TacTextarea
        value={value}
        onChange={(e) => {
          setFileName(null);
          onChange(e.target.value);
        }}
        placeholder="…or paste content here"
        rows={4}
        disabled={disabled}
        className="mt-2 font-data"
      />

      {error && (
        <div className="text-dr-red font-tactical text-xs mt-1">{error}</div>
      )}

      {(value || fileName) && (
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled}
          className="text-dr-dim font-tactical text-xs mt-1 hover:text-dr-amber underline"
        >
          clear
        </button>
      )}
    </div>
  );
}
