import { Fragment, useMemo } from 'react';

const IMAGE_PATTERN = /!\[([^\]]*)\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g;

interface CommanderContentProps {
  content: string;
}

/** Renders commander message text, replacing inline base64 images with visual placeholders */
export function CommanderContent({ content }: CommanderContentProps) {
  const parts = useMemo(() => {
    const result: { type: 'text' | 'image'; value: string }[] = [];
    let lastIndex = 0;
    let imageCount = 0;
    let match: RegExpExecArray | null;

    const regex = new RegExp(IMAGE_PATTERN.source, 'g');
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      imageCount++;
      const alt = match[1] || `Image #${imageCount}`;
      result.push({ type: 'image', value: alt || `Image #${imageCount}` });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      result.push({ type: 'text', value: content.slice(lastIndex) });
    }

    return result;
  }, [content]);

  if (parts.length === 1 && parts[0].type === 'text') {
    return <>{content}</>;
  }

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <Fragment key={i}>{part.value}</Fragment>
        ) : (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-dr-bg border border-dr-border text-dr-blue font-tactical text-[10px] tracking-wider px-2 py-0.5 mx-0.5 align-middle"
          >
            {part.value}
          </span>
        ),
      )}
    </>
  );
}
