import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownProps {
  content: string;
  className?: string;
}

const components = {
  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    if (!src) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt ?? ''}
        {...props}
        className={cn('max-w-full h-auto border border-dr-border', props.className)}
      />
    );
  },
};

/**
 * URL transformer for <img>/<a> hrefs. react-markdown's default sanitizer
 * strips `data:` URIs, which blocks pasted screenshot data URLs from
 * rendering in mission briefings. Allow http(s), relative paths, and
 * `data:image/*` — reject everything else (javascript:, file:, etc.).
 */
function urlTransform(url: string): string {
  const u = url.trim();
  if (u.startsWith('data:image/')) return u;
  if (/^(https?:\/\/|\/|#|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(u)) return ''; // unknown scheme → drop
  return u;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('general-markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
