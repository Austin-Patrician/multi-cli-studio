import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type SkillDocSection = {
  title: string;
  body: string;
};

type SkillDoc = {
  title: string;
  description: string | null;
  metadata: Array<{ label: string; value: string }>;
  intro: string;
  sections: SkillDocSection[];
};

function normalizeScalar(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseFrontmatter(raw: string) {
  const result: Record<string, string> = {};
  let parentKey: string | null = null;

  for (const line of raw.split("\n")) {
    const parentMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (parentMatch) {
      const [, key, value] = parentMatch;
      parentKey = value.trim().length === 0 ? key : null;
      if (value.trim().length > 0) {
        result[key] = normalizeScalar(value);
      }
      continue;
    }

    const childMatch = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (childMatch && parentKey) {
      const [, key, value] = childMatch;
      if (value.trim().length > 0) {
        result[`${parentKey}.${key}`] = normalizeScalar(value);
      }
    }
  }

  return result;
}

function parseSkillMarkdown(content: string): SkillDoc {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = frontmatterMatch ? parseFrontmatter(frontmatterMatch[1]) : {};
  const body = frontmatterMatch ? normalized.slice(frontmatterMatch[0].length).trim() : normalized;

  const lines = body.split("\n");
  let extractedTitle = "";
  if (lines[0]?.startsWith("# ")) {
    extractedTitle = lines.shift()?.replace(/^#\s+/, "").trim() ?? "";
    while (lines[0]?.trim() === "") {
      lines.shift();
    }
  }

  const introLines: string[] = [];
  const sections: SkillDocSection[] = [];
  let currentSectionTitle: string | null = null;
  let currentSectionLines: string[] = [];

  const pushSection = () => {
    if (!currentSectionTitle) return;
    sections.push({
      title: currentSectionTitle,
      body: currentSectionLines.join("\n").trim(),
    });
    currentSectionLines = [];
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      pushSection();
      currentSectionTitle = sectionMatch[1].trim();
      continue;
    }

    if (currentSectionTitle) {
      currentSectionLines.push(line);
    } else {
      introLines.push(line);
    }
  }
  pushSection();

  const title = frontmatter.name || extractedTitle || "SKILL";
  const description = frontmatter.description || frontmatter["metadata.short-description"] || null;
  const metadata = Object.entries(frontmatter)
    .filter(([key, value]) => value.trim().length > 0 && key !== "name" && key !== "description")
    .map(([key, value]) => ({
      label: key === "metadata.short-description" ? "short description" : key.replace(/^metadata\./, ""),
      value,
    }));

  return {
    title,
    description,
    metadata,
    intro: introLines.join("\n").trim(),
    sections,
  };
}

const markdownComponents = {
  p: ({ children }) => <p className="dcc-skill-doc-paragraph">{children}</p>,
  ul: ({ children }) => <ul className="dcc-skill-doc-list">{children}</ul>,
  ol: ({ children }) => <ol className="dcc-skill-doc-list is-ordered">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="dcc-skill-doc-strong">{children}</strong>,
  em: ({ children }) => <em className="dcc-skill-doc-em">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="dcc-skill-doc-link">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="dcc-skill-doc-quote">{children}</blockquote>,
  h3: ({ children }) => <h4 className="dcc-skill-doc-subheading">{children}</h4>,
  h4: ({ children }) => <h5 className="dcc-skill-doc-microheading">{children}</h5>,
  code: ({ className, children, ...props }: any) => {
    if (!className) {
      return (
        <code {...props} className="dcc-skill-doc-inline-code">
          {children}
        </code>
      );
    }

    return (
      <code {...props} className={`${className ?? ""} dcc-skill-doc-code-block-inner`}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="dcc-skill-doc-code-block">{children}</pre>,
  hr: () => <hr className="dcc-skill-doc-rule" />,
} satisfies Components;

export function SkillMarkdownPreview({ content }: { content: string }) {
  const document = parseSkillMarkdown(content);

  return (
    <div className="dcc-skill-doc">
      <section className="dcc-skill-doc-hero">
        <div className="dcc-skill-doc-kicker">Skill Blueprint</div>
        <div className="dcc-skill-doc-title-row">
          <h2 className="dcc-skill-doc-title">{document.title}</h2>
          <span className="dcc-detail-chip">SKILL.md</span>
        </div>
        {document.description ? (
          <p className="dcc-skill-doc-description">{document.description}</p>
        ) : null}
        {document.metadata.length > 0 ? (
          <div className="dcc-skill-doc-metadata">
            {document.metadata.map((item) => (
              <span key={`${item.label}:${item.value}`} className="dcc-skill-doc-meta-pill">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </span>
            ))}
          </div>
        ) : null}
        {document.intro ? (
          <div className="dcc-skill-doc-intro">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {document.intro}
            </ReactMarkdown>
          </div>
        ) : null}
      </section>

      {document.sections.length > 0 ? (
        <div className="dcc-skill-doc-grid">
          {document.sections.map((section, index) => (
            <article key={`${section.title}:${index}`} className="dcc-skill-doc-card">
              <div className="dcc-skill-doc-card-index">{String(index + 1).padStart(2, "0")}</div>
              <h3 className="dcc-skill-doc-card-title">{section.title}</h3>
              <div className="dcc-skill-doc-card-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {section.body}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
