import Markdown, { type Components } from 'react-markdown';

// Model output can be steered by untrusted content (email, Slack). Never auto-load remote images,
// and open links in a new tab without leaking the referrer.
const components: Components = {
  img: ({ alt, src }) => <span>{`[image: ${alt ?? ''}] ${typeof src === 'string' ? src : ''}`}</span>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
};

export function SafeMarkdown({ children }: { children: string }) {
  return <Markdown components={components}>{children}</Markdown>;
}
