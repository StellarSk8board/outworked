import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState } from "react";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

export default function MarkdownMessage({
  content,
  className = "",
}: MarkdownMessageProps) {
  return (
    <div className={`markdown-message ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const codeString = String(children).replace(/\n$/, "");

            if (match) {
              return <CodeBlock language={match[1]} code={codeString} />;
            }

            // Inline code
            return (
              <code
                className="bg-slate-700/80 text-emerald-300 px-1 py-0.5 rounded text-[11px] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Paragraphs
          p({ children }) {
            return (
              <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>
            );
          },
          // Headers
          h1({ children }) {
            return (
              <h1 className="text-sm font-bold text-white mb-1.5 mt-2 first:mt-0">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-[13px] font-bold text-white mb-1 mt-2 first:mt-0">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-xs font-bold text-white mb-1 mt-1.5 first:mt-0">
                {children}
              </h3>
            );
          },
          // Lists
          ul({ children }) {
            return (
              <ul className="list-disc list-inside mb-1.5 space-y-0.5">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="list-decimal list-inside mb-1.5 space-y-0.5">
                {children}
              </ol>
            );
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          // Links
          a({ href, children }) {
            return (
              <a
                href={href}
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
          // Blockquotes
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-slate-500 pl-2 my-1.5 text-slate-400 italic">
                {children}
              </blockquote>
            );
          },
          // Tables
          table({ children }) {
            return (
              <div className="overflow-x-auto my-1.5">
                <table className="text-[11px] border-collapse w-full">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-slate-700/50">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="border border-slate-600 px-2 py-1 text-left text-slate-300 font-bold">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-slate-700 px-2 py-1 text-slate-300">
                {children}
              </td>
            );
          },
          // Horizontal rule
          hr() {
            return <hr className="border-slate-600 my-2" />;
          },
          // Strong / emphasis
          strong({ children }) {
            return <strong className="font-bold text-white">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic text-slate-300">{children}</em>;
          },
          // Pre (wrapper for code blocks) - just pass through
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-1.5 rounded overflow-hidden border border-slate-700/50 group">
      <div className="flex items-center justify-between bg-slate-800 px-2 py-0.5">
        <span className="text-[9px] font-mono text-slate-500">{language}</span>
        <button
          onClick={handleCopy}
          className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors opacity-0 group-hover:opacity-100"
        >
          {copied ? "copied!" : "copy"}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        customStyle={{
          margin: 0,
          padding: "8px",
          fontSize: "11px",
          lineHeight: "1.4",
          background: "rgba(15, 23, 42, 0.8)",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
