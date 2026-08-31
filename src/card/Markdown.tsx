import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMediaUrl } from '@/media/mediaUrl';

/**
 * The one markdown renderer in the app (spec 7.1: render only, editing is a
 * plain textarea). GitHub-flavoured, raw HTML dropped, links forced to open in
 * a new tab, and image sources that point at board media resolved through the
 * read SAS.
 */

const ABSOLUTE = /^(?:https?:|data:|blob:)/i;

export interface MarkdownProps {
  children: string;
  className?: string;
}

export default function Markdown({ children, className }: MarkdownProps): JSX.Element {
  const mediaUrl = useMediaUrl();

  const components = useMemo<Components>(
    () => ({
      a({ node: _node, children: content, href, ...props }) {
        return (
          <a
            {...props}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--focus)] underline underline-offset-2 hover:no-underline"
          >
            {content}
          </a>
        );
      },
      img({ node: _node, src, alt, ...props }) {
        const raw = typeof src === 'string' ? src : '';
        const resolved = raw.length === 0 || ABSOLUTE.test(raw) ? raw : (mediaUrl(raw) ?? '');
        if (resolved.length === 0) return <span className="text-ink-muted">{alt ?? 'Image'}</span>;
        return (
          <img
            {...props}
            src={resolved}
            alt={alt ?? ''}
            loading="lazy"
            className="my-2 max-w-full rounded border border-line"
          />
        );
      },
      h1: ({ node: _node, ...props }) => (
        <h1 {...props} className="mb-1 mt-3 font-condensed text-[19px] font-semibold first:mt-0" />
      ),
      h2: ({ node: _node, ...props }) => (
        <h2 {...props} className="mb-1 mt-3 font-condensed text-[17px] font-semibold first:mt-0" />
      ),
      h3: ({ node: _node, ...props }) => (
        <h3 {...props} className="mb-1 mt-3 font-condensed text-[15px] font-semibold first:mt-0" />
      ),
      h4: ({ node: _node, ...props }) => (
        <h4 {...props} className="mb-1 mt-3 text-[15px] font-semibold first:mt-0" />
      ),
      p: ({ node: _node, ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
      ul: ({ node: _node, ...props }) => <ul {...props} className="my-2 list-disc pl-5" />,
      ol: ({ node: _node, ...props }) => <ol {...props} className="my-2 list-decimal pl-5" />,
      li: ({ node: _node, ...props }) => <li {...props} className="my-0.5 marker:text-ink-muted" />,
      blockquote: ({ node: _node, ...props }) => (
        <blockquote {...props} className="my-2 border-l-2 border-line pl-3 text-ink-muted" />
      ),
      code: ({ node: _node, ...props }) => (
        <code
          {...props}
          className="rounded bg-sunken px-1 py-0.5 font-mono text-[13px] text-ink"
        />
      ),
      pre: ({ node: _node, ...props }) => (
        <pre
          {...props}
          className="my-2 overflow-x-auto rounded border border-line bg-sunken p-3 font-mono text-[13px] [&>code]:bg-transparent [&>code]:p-0"
        />
      ),
      hr: ({ node: _node, ...props }) => <hr {...props} className="my-3 border-line" />,
      table: ({ node: _node, ...props }) => (
        <div className="my-2 overflow-x-auto">
          <table {...props} className="w-full border-collapse text-[14px]" />
        </div>
      ),
      th: ({ node: _node, ...props }) => (
        <th {...props} className="border border-line bg-sunken px-2 py-1 text-left font-semibold" />
      ),
      td: ({ node: _node, ...props }) => <td {...props} className="border border-line px-2 py-1 align-top" />,
      input: ({ node: _node, ...props }) => (
        <input {...props} readOnly className="mr-1 align-middle accent-[var(--focus)]" />
      ),
    }),
    [mediaUrl],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
