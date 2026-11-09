import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, extractArticleFromHtml } from "../html-extractor.js";

describe("HTML Extractor - decodeHtmlEntities", () => {
  it("decodes named, decimal, and hex HTML entities without double unescaping", () => {
    expect(decodeHtmlEntities("&quot;Hello&quot; &amp; &lt;World&gt;")).toBe('"Hello" & <World>');
    expect(decodeHtmlEntities("It&#39;s &apos;fine&apos; &nbsp; &mdash; &ndash;")).toBe(
      "It's 'fine'   — –"
    );
    expect(decodeHtmlEntities("&#65;&#66;&#67;")).toBe("ABC");
    expect(decodeHtmlEntities("&#x41;&#x42;&#x43;")).toBe("ABC");
    expect(decodeHtmlEntities("&#invalid;")).toBe("&#invalid;");
    // Verify no double unescaping occurs: &amp;lt; should become &lt;, NOT <
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;gt;")).toBe("&gt;");
    expect(decodeHtmlEntities("&amp;quot;")).toBe("&quot;");
  });
});

describe("HTML Extractor - extractArticleFromHtml", () => {
  it("handles empty or blank HTML input", () => {
    const empty1 = extractArticleFromHtml("");
    expect(empty1.title).toBe("Unbenannt");
    expect(empty1.content).toBe("");
    expect(empty1.textLength).toBe(0);

    const empty2 = extractArticleFromHtml("    \n\t  ");
    expect(empty2.title).toBe("Unbenannt");
    expect(empty2.content).toBe("");
  });

  it("extracts title from OpenGraph metadata", () => {
    const html1 = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta content="OpenGraph Article Title &amp; More" property="og:title">
          <title>Regular Title</title>
        </head>
        <body>
          <p>Main body text.</p>
        </body>
      </html>
    `;
    const article1 = extractArticleFromHtml(html1);
    expect(article1.title).toBe("OpenGraph Article Title & More");
    expect(article1.content).toBe("Main body text.");

    const html2 = '<meta property="og:title" content="Prop First Title"><p>Text</p>';
    const article2 = extractArticleFromHtml(html2);
    expect(article2.title).toBe("Prop First Title");
  });

  it("extracts title from <title> tag when og:title is absent", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Document Title &mdash; Section</title>
        </head>
        <body>
          <p>Some paragraph.</p>
        </body>
      </html>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.title).toBe("Document Title — Section");
  });

  it("extracts title from first <h1> tag when <title> is absent", () => {
    const html = `
      <html>
        <body>
          <h1>Heading Title</h1>
          <p>Content text</p>
        </body>
      </html>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.title).toBe("Heading Title");
    expect(article.content).toContain("Heading Title");
  });

  it("falls back to 'Unbenannt' if no title or heading is present", () => {
    const html = `
      <div>
        <p>Just simple text without any headings or titles.</p>
      </div>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.title).toBe("Unbenannt");
    expect(article.content).toBe("Just simple text without any headings or titles.");
  });

  it("strips script, style, noscript, template, svg, canvas, iframe and their content even with spaces or attributes in end tags", () => {
    const html = `
      <html>
        <head>
          <style>body { color: red; } .hidden { display: none; }</style bar="baz">
          <script>console.log("secret script execution");</script\t\n bar>
        </head>
        <body>
          <noscript><p>Please enable JS</p></noscript foo="bar">
          <template><p>Template content</p></template >
          <svg><text>SVG Text</text></svg >
          <canvas>Canvas fallback</canvas >
          <iframe src="https://example.com">Iframe text</iframe >
          <p>Actual visible readable text.</p>
        </body>
      </html>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.content).not.toContain("color: red");
    expect(article.content).not.toContain("secret script");
    expect(article.content).not.toContain("Please enable JS");
    expect(article.content).not.toContain("Template content");
    expect(article.content).not.toContain("SVG Text");
    expect(article.content).not.toContain("Canvas fallback");
    expect(article.content).not.toContain("Iframe text");
    expect(article.content).toBe("Actual visible readable text.");
  });

  it("strips navigation, header, footer, and aside elements", () => {
    const html = `
      <html>
        <body>
          <header>
            <h1>Site Header</h1>
            <nav><a href="/">Home</a><a href="/about">About</a></nav>
          </header>
          <aside>
            <p>Related links and sidebar</p>
          </aside>
          <main>
            <article>
              <p>Valuable core article content paragraph 1.</p>
              <p>Valuable core article content paragraph 2.</p>
            </article>
          </main>
          <footer>
            <p>Copyright 2026 Company Inc. All rights reserved.</p>
          </footer>
        </body>
      </html>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.content).not.toContain("Site Header");
    expect(article.content).not.toContain("Related links");
    expect(article.content).not.toContain("Copyright 2026");
    expect(article.content).toContain("Valuable core article content paragraph 1.");
    expect(article.content).toContain("Valuable core article content paragraph 2.");
  });

  it("strips typical banner and advertising boxes", () => {
    const html = `
      <div>
        <div class="advertisement">Sponsored Ad: Buy now!</div>
        <div class="ad-container">Banner promo</div>
        <div id="cookie-banner">Accept all cookies</div>
        <div class="popup-modal">Sign up for our newsletter!</div>
        <div class="content">Clean article text without distractions.</div>
      </div>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.content).not.toContain("Sponsored Ad");
    expect(article.content).not.toContain("Banner promo");
    expect(article.content).not.toContain("Accept all cookies");
    expect(article.content).not.toContain("Sign up for our newsletter");
    expect(article.content).toBe("Clean article text without distractions.");
  });

  it("preserves linebreaks between paragraphs, lists and headings", () => {
    const html = `
      <h2>Section 1</h2>
      <p>First paragraph.</p>
      <br/>
      <p>Second paragraph.</p>
      <ul>
        <li>Item A</li>
        <li>Item B</li>
      </ul>
    `;
    const article = extractArticleFromHtml(html);
    expect(article.content).toContain("Section 1");
    expect(article.content).toContain("First paragraph.");
    expect(article.content).toContain("Second paragraph.");
    expect(article.content).toContain("Item A");
    expect(article.content).toContain("Item B");
  });
});
