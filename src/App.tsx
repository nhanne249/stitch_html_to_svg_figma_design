import { useCallback, useEffect, useRef, useState } from 'react';
import { htmlToSvg } from './htmlToSvg';
import './App.css';

type ToastState = {
    message: string;
    tone: 'success' | 'error';
};

type SanitizedMarkup = {
    markup: string;
    inlineCss: string;
    stylesheetLinks: string[];
    tailwindCdnUrl?: string;
    tailwindConfigInline?: string;
};

const DOCTYPE_REGEX = /<!doctype[^>]*>/gi;
const SCRIPT_REGEX = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const STYLE_REGEX = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const STYLESHEET_LINK_REGEX = /<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi;
const HREF_REGEX = /href\s*=\s*("|')(.*?)\1/i;
const BODY_REGEX = /<body[^>]*>([\s\S]*?)<\/body>/i;
const HTML_REGEX = /<html[^>]*>([\s\S]*?)<\/html>/i;

const sanitizeHtmlInput = (value: string): SanitizedMarkup => {
    const trimmed = value.trim();
    if (!trimmed) {
        return { markup: '', inlineCss: '', stylesheetLinks: [], tailwindCdnUrl: undefined, tailwindConfigInline: undefined };
    }

    const styleBlocks: string[] = [];
    const stylesheetLinks: string[] = [];

    const withoutDoctype = trimmed.replace(DOCTYPE_REGEX, '');
    let tailwindCdnUrl: string | undefined;
    let tailwindConfigInline: string | undefined;
    const withoutScripts = withoutDoctype.replace(SCRIPT_REGEX, (match) => {
        // Extract Tailwind CDN URL
        const cdnMatch = match.match(/<script[^>]*src\s*\=\s*['"](https:\/\/cdn\.tailwindcss\.com[^'"}]*)['"][^>]*>/i);
        if (cdnMatch && cdnMatch[1]) {
            tailwindCdnUrl = cdnMatch[1];
            return '';
        }
        // Extract inline tailwind.config assignment block
        const configMatch = match.match(/tailwind\.config\s*\=\s*\{[\s\S]*?\}/i);
        if (configMatch && configMatch[0]) {
            tailwindConfigInline = configMatch[0];
            return '';
        }
        // Drop other scripts entirely
        return '';
    });
    const withoutStyles = withoutScripts.replace(STYLE_REGEX, (match, cssContent: string) => {
        const css = cssContent?.trim();
        if (css) {
            styleBlocks.push(css);
        }
        return '';
    });
    const withoutStylesheets = withoutStyles.replace(STYLESHEET_LINK_REGEX, (match) => {
        const hrefMatch = match.match(HREF_REGEX);
        const href = hrefMatch?.[2]?.trim();
        if (href) {
            stylesheetLinks.push(href);
        }
        return '';
    });

    const bodyMatch = BODY_REGEX.exec(withoutStylesheets);
    const htmlMatch = HTML_REGEX.exec(withoutStylesheets);
    const markup = bodyMatch?.[1]?.trim() ?? htmlMatch?.[1]?.trim() ?? withoutStylesheets.trim();

    const linkImports = stylesheetLinks.map((href) => `@import url('${href}');`);
    const inlineCss = [...linkImports, ...styleBlocks].filter(Boolean).join('\n');

    return { markup, inlineCss, stylesheetLinks, tailwindCdnUrl, tailwindConfigInline };
};

const mountHiddenMarkup = (container: HTMLElement, markup: string, inlineCss: string): HTMLElement => {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    // Add 'dark' class to activate Tailwind dark mode variants during style computation
    wrapper.className = 'hidden-renderer-root dark';

    if (inlineCss) {
        const styleElement = document.createElement('style');
        styleElement.setAttribute('data-inline-css', 'true');
        styleElement.textContent = inlineCss;
        wrapper.appendChild(styleElement);
    }

    const template = document.createElement('template');
    template.innerHTML = markup;
    wrapper.appendChild(template.content.cloneNode(true));
    container.appendChild(wrapper);
    return wrapper;
};

const hasLayoutBox = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};

const copySvgToClipboard = async (svgString: string): Promise<void> => {
    if (!navigator.clipboard) {
        throw new Error('Clipboard API is not available in this browser.');
    }

    const supportsRichClipboard =
        typeof window !== 'undefined' && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem !== 'undefined';

    if (supportsRichClipboard) {
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
        const textBlob = new Blob([svgString], { type: 'text/plain' });
        await navigator.clipboard.write([
            new ClipboardItem({
                'image/svg+xml': svgBlob,
                'text/plain': textBlob,
            }),
        ]);
        return;
    }

    await navigator.clipboard.writeText(svgString);
};

const App = () => {
    const [htmlInput, setHtmlInput] = useState('');
    const [svgOutput, setSvgOutput] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeAction, setActiveAction] = useState<'generate' | 'copy' | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);
    const hiddenContainerRef = useRef<HTMLDivElement | null>(null);

    const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
        setToast({ message, tone });
    }, []);

    useEffect(() => {
        if (!toast) {
            return;
        }
        const id = window.setTimeout(() => setToast(null), 2400);
        return () => window.clearTimeout(id);
    }, [toast]);

    useEffect(() => {
        return () => {
            if (hiddenContainerRef.current) {
                hiddenContainerRef.current.innerHTML = '';
            }
        };
    }, []);

    const handleGenerate = useCallback(
        async (shouldCopy: boolean) => {
            if (!hiddenContainerRef.current) {
                showToast('Hidden renderer is not ready', 'error');
                return;
            }

            if (!htmlInput.trim()) {
                const message = 'Please paste your HTML before generating.';
                setErrorMessage(message);
                showToast(message, 'error');
                return;
            }

            setIsGenerating(true);
            setActiveAction(shouldCopy ? 'copy' : 'generate');
            setErrorMessage(null);

            try {
                // Snapshot existing <style> tags so we only collect newly added ones later (e.g., Tailwind output),
                // avoiding unrelated extension or host-page styles.
                const baselineStyles = new Set<HTMLStyleElement>(Array.from(document.querySelectorAll('style')));

                const container = hiddenContainerRef.current;
                const { markup, inlineCss, stylesheetLinks, tailwindCdnUrl, tailwindConfigInline } = sanitizeHtmlInput(htmlInput);
                if (!markup) {
                    throw new Error('Markup could not be parsed.');
                }

                // Attempt to inline external stylesheets referenced via <link rel="stylesheet"> rather than relying on @import.
                let collectedCss = inlineCss;
                if (stylesheetLinks.length) {
                    try {
                        const fetched = await Promise.all(
                            stylesheetLinks.map(async (href) => {
                                try {
                                    const res = await fetch(href, { mode: 'cors' });
                                    if (!res.ok) return '';
                                    const text = await res.text();
                                    return text ?? '';
                                } catch {
                                    return '';
                                }
                            }),
                        );
                        const inlined = fetched.filter(Boolean).join('\n');
                        if (inlined) {
                            collectedCss = [inlined, inlineCss].filter(Boolean).join('\n');
                        }
                    } catch {
                        // Ignore fetch failures; fallback to @import in inlineCss
                    }
                }

                // Rewrite CSS so selectors and common properties work against our SVG structure.
                const rewriteCssForSvg = (css: string): string => {
                    if (!css) return css;
                    // Map HTML tag selectors to our group wrappers via data-tag.
                    const tagNames = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'ul', 'ol', 'li', 'button', 'a'];
                    let out = css;
                    tagNames.forEach((tag) => {
                        const re = new RegExp(`(^|[\n\r\s,{])${tag}([\n\r\s,{.:#\[]|$)`, 'gi');
                        out = out.replace(re, (m, p1, p2) => `${p1}g[data-tag="${tag}"], text[data-tag="${tag}"]${p2}`);
                    });
                    // Convert common properties to SVG equivalents.
                    out = out.replace(/background-color\s*:\s*([^;]+);/gi, 'fill: $1;');
                    out = out.replace(/color\s*:\s*([^;]+);/gi, 'fill: $1;');
                    out = out.replace(/border-color\s*:\s*([^;]+);/gi, 'stroke: $1;');
                    out = out.replace(/border-width\s*:\s*([^;]+);/gi, 'stroke-width: $1;');
                    out = out.replace(/outline-color\s*:\s*([^;]+);/gi, 'stroke: $1;');
                    out = out.replace(/outline-width\s*:\s*([^;]+);/gi, 'stroke-width: $1;');
                    // Text alignment: map to text-anchor roughly.
                    out = out.replace(/text-align\s*:\s*center\s*;/gi, 'text-anchor: middle;');
                    out = out.replace(/text-align\s*:\s*right\s*;/gi, 'text-anchor: end;');
                    return out;
                };

                collectedCss = rewriteCssForSvg(collectedCss);

                const rootElement = mountHiddenMarkup(container, markup, collectedCss);
                // If Tailwind CDN is present in the input, load it dynamically so utilities apply.
                if (tailwindCdnUrl) {
                    // Inject inline tailwind.config first (if provided)
                    if (tailwindConfigInline) {
                        const existingConfig = document.querySelector('script[data-tailwind-config-inline]');
                        if (existingConfig) existingConfig.remove();
                        const cfgScript = document.createElement('script');
                        cfgScript.type = 'text/javascript';
                        cfgScript.setAttribute('data-tailwind-config-inline', 'true');
                        cfgScript.text = tailwindConfigInline;
                        document.head.appendChild(cfgScript);
                    }

                    // Load CDN script
                    const existingCdn = document.querySelector(`script[data-tailwind-cdn="${tailwindCdnUrl}"]`);
                    const ensureCdnLoaded = async () => {
                        if (existingCdn) return;
                        await new Promise<void>((resolve, reject) => {
                            const cdnScript = document.createElement('script');
                            cdnScript.src = tailwindCdnUrl!;
                            cdnScript.async = true;
                            cdnScript.defer = true;
                            cdnScript.setAttribute('data-tailwind-cdn', tailwindCdnUrl!);
                            cdnScript.onload = () => resolve();
                            cdnScript.onerror = () => reject(new Error('Failed to load Tailwind CDN'));
                            document.head.appendChild(cdnScript);
                        });
                    };
                    try {
                        await ensureCdnLoaded();
                        // Wait briefly for Tailwind to scan the DOM and emit styles
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    } catch {
                        // Non-fatal, continue
                    }

                    // Collect any new style blocks Tailwind emitted globally (excluding pre-existing styles and wrapper styles)
                    const wrapperStyleElements = Array.from(rootElement.querySelectorAll('style'));
                    const generatedGlobal = Array.from(document.querySelectorAll('style'))
                        .filter((el) => !baselineStyles.has(el) && !wrapperStyleElements.includes(el))
                        .map((el) => el.textContent || '')
                        .filter(Boolean)
                        .join('\n');
                    if (generatedGlobal) {
                        collectedCss = [collectedCss, rewriteCssForSvg(generatedGlobal)].filter(Boolean).join('\n');
                    }

                    // Also collect styles inside the wrapper (if any)
                    const generatedLocal = wrapperStyleElements
                        .map((el) => el.textContent || '')
                        .filter(Boolean)
                        .join('\n');
                    if (generatedLocal) {
                        collectedCss = [collectedCss, rewriteCssForSvg(generatedLocal)].filter(Boolean).join('\n');
                    }
                }
                if (!hasLayoutBox(rootElement)) {
                    throw new Error('Root element has no measurable layout');
                }
                const svgString = htmlToSvg(rootElement, { inlineCss: collectedCss });
                setSvgOutput(svgString);

                if (shouldCopy) {
                    await copySvgToClipboard(svgString);
                    showToast('Copied SVG to clipboard');
                } else {
                    showToast('SVG generated');
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to generate SVG.';
                setSvgOutput('');
                setErrorMessage(message);
                showToast(message, 'error');
            } finally {
                setIsGenerating(false);
                setActiveAction(null);
            }
        },
        [htmlInput, showToast],
    );

    return (
        <div className="app-shell">
            <div className="panel">
                <header className="panel-header">
                    <div>
                        <p className="eyebrow">Utility</p>
                        <h1>HTML -&gt; Figma SVG</h1>
                        <p className="subtitle">Paste any page markup, map it to a simple SVG, and drop it into Figma.</p>
                    </div>
                </header>

                <label className="field-label" htmlFor="html-input">
                    Source HTML
                </label>
                <textarea
                    id="html-input"
                    className="text-input"
                    placeholder="Paste your full page HTML here"
                    value={htmlInput}
                    onChange={(event) => setHtmlInput(event.target.value)}
                    spellCheck={false}
                />

                <div className="controls">
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={showPreview}
                            onChange={(event) => setShowPreview(event.target.checked)}
                        />
                        <span>Show SVG preview</span>
                    </label>
                    <div className="button-row">
                        <button
                            type="button"
                            className="btn"
                            onClick={() => handleGenerate(false)}
                            disabled={isGenerating}
                        >
                            {isGenerating && activeAction === 'generate' ? 'Generating...' : 'Generate SVG'}
                        </button>
                        <button
                            type="button"
                            className="btn primary"
                            onClick={() => handleGenerate(true)}
                            disabled={isGenerating}
                        >
                            {isGenerating && activeAction === 'copy' ? 'Copying...' : 'Generate & Copy SVG'}
                        </button>
                    </div>
                </div>

                <label className="field-label" htmlFor="svg-output">
                    SVG output
                </label>
                <textarea
                    id="svg-output"
                    className="text-output"
                    value={svgOutput}
                    readOnly
                    placeholder="Generated SVG will appear here"
                    spellCheck={false}
                />

                {showPreview && svgOutput && (
                    <div className="preview" dangerouslySetInnerHTML={{ __html: svgOutput }} />
                )}

                {errorMessage && <div className="error-banner">{errorMessage}</div>}
            </div>

            {toast && (
                <div className={`toast toast-${toast.tone}`} role="status">
                    {toast.message}
                </div>
            )}

            <div
                ref={hiddenContainerRef}
                className="hidden-renderer"
                aria-hidden="true"
            />
        </div>
    );
};

export default App;
