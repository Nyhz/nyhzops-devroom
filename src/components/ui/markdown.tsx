import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('prose-tactical', className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-dr-amber font-tactical text-lg tracking-wider mt-4 mb-2">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-dr-amber font-tactical text-base tracking-wider mt-3 mb-2">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-dr-amber font-tactical text-sm tracking-wider mt-2 mb-1">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-dr-text mb-2 leading-relaxed">{children}</p>
        ),
        code: ({ className: codeClassName, children, ...props }) => {
          const isBlock = codeClassName?.includes('language-');
          return isBlock ? (
            <code
              className={cn(
                'block bg-dr-bg font-data text-sm p-3 border border-dr-border overflow-x-auto my-2',
                codeClassName,
              )}
              {...props}
            >
              {children}
            </code>
          ) : (
            <code
              className="bg-dr-elevated px-1.5 py-0.5 font-data text-sm border border-dr-border"
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="bg-dr-bg font-data text-sm border border-dr-border overflow-x-auto my-2">
            {children}
          </pre>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-dr-blue underline hover:text-dr-blue/80"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside text-dr-text mb-2 ml-2">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside text-dr-text mb-2 ml-2">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-dr-text mb-0.5">{children}</li>
        ),
        table: ({ children }) => (
          <table className="border-collapse border border-dr-border my-2 w-full">
            {children}
          </table>
        ),
        th: ({ children }) => (
          <th className="border border-dr-border bg-dr-elevated px-3 py-1.5 text-dr-amber text-left font-tactical text-xs">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-dr-border px-3 py-1.5 text-dr-text text-sm">
            {children}
          </td>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-dr-amber pl-3 my-2 text-dr-muted italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-dr-border my-4" />,
        img: ({ src, alt }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt || ''}
            className="max-w-full my-2 border border-dr-border"
          />
        ),
      }}
    />
    </div>
  );
}
