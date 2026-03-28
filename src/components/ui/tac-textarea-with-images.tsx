'use client';

import { useState, useRef, useCallback, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface TacTextareaWithImagesProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function TacTextareaWithImages({
  value,
  onChange,
  className,
  disabled,
  ...props
}: TacTextareaWithImagesProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [imageAdded, setImageAdded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const insertAtCursor = useCallback(
    (markdown: string) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        onChange(value + markdown);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const newValue = before + markdown + after;
      onChange(newValue);

      // Restore cursor position after the inserted text
      requestAnimationFrame(() => {
        const newPos = start + markdown.length;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
        textarea.focus();
      });
    },
    [value, onChange],
  );

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const markdown = `![screenshot](${base64})`;
        insertAtCursor(markdown);
        setImageAdded(true);
        setTimeout(() => setImageAdded(false), 2000);
      };
      reader.readAsDataURL(file);
    },
    [insertAtCursor],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          processFile(file);
          return;
        }
      }
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          processFile(file);
          return;
        }
      }
    },
    [processFile],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    [],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        disabled={disabled}
        className={cn(
          'w-full bg-dr-bg border border-dr-border text-dr-text font-tactical text-sm',
          'px-3 py-2 placeholder:text-dr-muted resize-vertical min-h-[80px]',
          'focus:border-dr-amber focus:outline-none',
          'disabled:opacity-70 disabled:cursor-not-allowed',
          isDragOver && 'border-dr-amber shadow-glow-amber',
          className,
        )}
        {...props}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-dr-muted font-tactical text-xs tracking-wider">
          Paste or drop images
        </span>
        {imageAdded && (
          <span className="text-dr-green font-tactical text-xs tracking-wider animate-pulse">
            Image added
          </span>
        )}
      </div>
    </div>
  );
}
