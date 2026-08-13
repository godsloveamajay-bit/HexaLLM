import { useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import js from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import ts from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import py from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import { Clipboard, ClipboardCheck } from 'lucide-react'

const LANGUAGES: Array<[string, string]> = [
  ['javascript', js], ['typescript', ts], ['tsx', tsx], ['jsx', jsx],
  ['python', py], ['py', py], ['bash', bash], ['shell', bash], ['sh', bash],
  ['zsh', bash], ['json', json], ['css', css], ['html', markup], ['xml', markup],
  ['svg', markup], ['markup', markup], ['rust', rust], ['go', go], ['sql', sql],
  ['yaml', yaml], ['yml', yaml], ['markdown', markdown], ['md', markdown],
  ['java', java], ['c', c], ['cpp', cpp], ['csharp', csharp], ['php', php],
  ['ruby', ruby], ['kotlin', kotlin], ['swift', swift], ['docker', docker],
  ['dockerfile', docker], ['diff', diff],
]
for (const [name, lang] of LANGUAGES) SyntaxHighlighter.registerLanguage(name, lang)

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="relative group/code my-3">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-1.5 rounded-t-lg border border-gray-700/60 border-b-0">
        <span className="text-xs text-gray-500 font-mono">{language || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          {copied
            ? <><ClipboardCheck className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400">Copied</span></>
            : <><Clipboard className="w-3.5 h-3.5" />Copy</>}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark as any}
        language={language || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: '0 0 0.5rem 0.5rem', border: '1px solid rgba(51,65,85,0.6)', borderTop: 'none' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

interface MarkdownProps {
  children: string
  streaming?: boolean
}

/**
 * Full markdown renderer: math ($…$, $$…$$), GFM (tables, task lists,
 * strikethrough), syntax-highlighted code with copy button, images and
 * external links. `streaming` swaps code highlighting for lightweight
 * inline rendering so partial chunks stay fast.
 */
export default function Markdown({ children, streaming = false }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      urlTransform={(url) => (url.startsWith('data:') ? url : defaultUrlTransform(url))}
      components={{
        code({ node, className, children }: { node?: { position?: { start?: { line: number }; end?: { line: number } } }; className?: string; children?: React.ReactNode }) {
          const lang = /language-([\w-]+)/.exec(className || '')?.[1]
          const startLine = node?.position?.start?.line ?? 0
          const endLine = node?.position?.end?.line ?? -1
          const isBlock = !!lang || startLine !== endLine
          if (!isBlock) {
            return (
              <code className="bg-gray-800 text-primary-300 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono">
                {children}
              </code>
            )
          }
          const code = String(children).replace(/\n$/, '')
          if (streaming) {
            return (
              <pre className="bg-gray-800 rounded-lg px-4 py-3 overflow-x-auto my-3 text-[0.85em] font-mono">
                <code>{code}</code>
              </pre>
            )
          }
          return <CodeBlock language={lang}>{code}</CodeBlock>
        },
        pre({ children }: { children?: React.ReactNode }) {
          // Block code renders its own wrapper — drop the default <pre>.
          return <>{children}</>
        },
        table({ children }: { children?: React.ReactNode }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="w-auto">{children}</table>
            </div>
          )
        },
        img({ src, alt }: { src?: string; alt?: string }) {
          return (
            <img
              src={src}
              alt={alt || ''}
              loading="lazy"
              className="rounded-lg border border-gray-700/60 max-w-full my-2"
              style={{ maxHeight: '512px' }}
            />
          )
        },
        a({ href, children }: { href?: string; children?: React.ReactNode }) {
          return (
            <a
              href={href}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer noopener"
              className="text-primary-400 hover:text-primary-300 underline decoration-primary-400/40 underline-offset-2"
            >
              {children}
            </a>
          )
        },
      } as any}
    >
      {children}
    </ReactMarkdown>
  )
}
