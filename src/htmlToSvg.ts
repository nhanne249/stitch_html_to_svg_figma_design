/* eslint-disable @typescript-eslint/no-explicit-any */
export type GradientStop = {
    color: string;
    opacity: number;
    offset: number;
};

export type SolidFill = {
    kind: 'solid';
    color: string;
    opacity: number;
};

export type LinearGradientFill = {
    kind: 'linear-gradient';
    angle: number;
    stops: GradientStop[];
};

export type Fill = SolidFill | LinearGradientFill;

export type BorderSide = {
    width: number;
    color: string;
    opacity: number;
    style: string;
};

export type BorderSet = {
    top: BorderSide;
    right: BorderSide;
    bottom: BorderSide;
    left: BorderSide;
};

export type BorderRadius = {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
};

export type BoxShadow = {
    inset: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    color: string;
    opacity: number;
};

export type TextPayload = {
    content: string;
    color: string;
    opacity: number;
    fontFamily: string;
    fontSize: number;
    fontWeight: number | string;
    fontStyle: string;
    letterSpacing: number;
    lineHeight: number;
    textAnchor: 'start' | 'middle' | 'end';
};

export type BaseNode = {
    id: string;
    kind: 'box' | 'text';
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    className?: string;
};

export type BoxNode = BaseNode & {
    kind: 'box';
    tagName: string;
    background: Fill | null;
    borderRadius: BorderRadius;
    borders: BorderSet | null;
    shadows: BoxShadow[];
    overflowHidden?: boolean;
    children: SimpleNode[];
};

export type TextNode = BaseNode & {
    kind: 'text';
    tagName: string;
    text: TextPayload;
    children: [];
};

export type IconNode = BaseNode & {
    kind: 'icon';
    tagName: string;
    iconName: string;
    color: string;
    svgPath: string;
    viewBox: string;
    children: [];
};

export type SimpleNode = BoxNode | TextNode | IconNode;

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'TITLE', 'LINK', 'NOSCRIPT']);

const PX_REGEX = /(-?\d+(?:\.\d+)?)px/;
const RGBA_REGEX = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i;
const HEX_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SHADOW_COLOR_REGEX = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)$/i;

let nodeCounter = 0;

type RgbaColor = {
    color: string;
    opacity: number;
};

type RenderContext = {
    defs: string[];
    gradientIndex: number;
    filterIndex: number;
};

type HtmlToSvgOptions = {
    inlineCss?: string;
};

export const htmlToSvg = (rootElement: HTMLElement, options: HtmlToSvgOptions = {}): string => {
    if (!rootElement) {
        throw new Error('A root element is required to generate SVG.');
    }

    const rootRect = rootElement.getBoundingClientRect();
    if (rootRect.width === 0 || rootRect.height === 0) {
        throw new Error('Root element has no measurable layout.');
    }

    const simpleTree = createNodeFromElement(rootElement, rootRect, true);
    if (!simpleTree) {
        throw new Error('Unable to capture layout from the provided HTML.');
    }

    const context: RenderContext = { defs: [], gradientIndex: 0, filterIndex: 0 };
    const content = renderNode(simpleTree, context);
    const cssBlock = options.inlineCss?.trim();
    const styleDef = cssBlock ? createStyleDef(cssBlock) : null;
    const defsEntries = [...context.defs];
    if (styleDef) {
        defsEntries.unshift(styleDef);
    }
    const defsContent = defsEntries.length ? `<defs>${defsEntries.join('')}</defs>` : '';
    const width = formatNumber(rootRect.width);
    const height = formatNumber(rootRect.height);

    return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="presentation">${defsContent}${content}</svg>`;
};

const createNodeFromElement = (
    element: HTMLElement,
    rootRect: DOMRect,
    allowHidden = false,
): BoxNode | IconNode | null => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return null;
    }

    const style = window.getComputedStyle(element);
    if (!allowHidden && !isRenderable(style)) {
        return null;
    }

    // Check if this is a Material Symbols icon - return icon node directly
    if (element.classList.contains('material-symbols-outlined')) {
        return createIconNode(element, style, rootRect);
    }

    const id = element.id || `${element.tagName.toLowerCase()}-${nodeCounter++}`;
    const opacity = clampNumber(parseFloat(style.opacity), 1);

    const background = parseFill(style);
    const borderRadius = parseBorderRadius(style);
    const borders = parseBorders(style);
    const shadows = parseBoxShadows(style);
    const overflowHidden = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden';

    const children: SimpleNode[] = [];
    children.push(...collectTextNodes(element, style, rootRect));

    Array.from(element.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) {
            return;
        }
        if (IGNORED_TAGS.has(child.tagName)) {
            return;
        }
        // Propagate the same hidden handling down the tree so the root's policy applies consistently.
        const childNode = createNodeFromElement(child, rootRect, allowHidden);
        if (childNode) {
            children.push(childNode);
        }
    });

    return {
        id,
        kind: 'box',
        tagName: element.tagName.toLowerCase(),
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        opacity,
        className: element.className || undefined,
        background,
        borderRadius,
        borders,
        shadows,
        overflowHidden,
        children,
    };
};

// Material Symbols SVG paths - common icons used in the UI
const MATERIAL_SYMBOLS_PATHS: Record<string, { path: string; viewBox: string }> = {
    'dashboard': { path: 'M13 9V3h8v6h-8zm-2 0H3V3h8v6zm2 2h8v10h-8V11zm-2 0v10H3V11h8z', viewBox: '0 0 24 24' },
    'calendar_month': { path: 'M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z', viewBox: '0 0 24 24' },
    'bed': { path: 'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z', viewBox: '0 0 24 24' },
    'bar_chart': { path: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z', viewBox: '0 0 24 24' },
    'settings': { path: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z', viewBox: '0 0 24 24' },
    'help_center': { path: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 15h-2v-2h2v2zm1.07-7.75l-.9.92C11.45 11.9 11 12.5 11 14h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H6c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z', viewBox: '0 0 24 24' },
    'logout': { path: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z', viewBox: '0 0 24 24' },
    'search': { path: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z', viewBox: '0 0 24 24' },
    'expand_more': { path: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z', viewBox: '0 0 24 24' },
    'add': { path: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z', viewBox: '0 0 24 24' },
    'edit': { path: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z', viewBox: '0 0 24 24' },
    'content_copy': { path: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z', viewBox: '0 0 24 24' },
    'delete': { path: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z', viewBox: '0 0 24 24' },
    'chevron_left': { path: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z', viewBox: '0 0 24 24' },
    'chevron_right': { path: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z', viewBox: '0 0 24 24' },
};

const createIconNode = (element: HTMLElement, style: CSSStyleDeclaration, rootRect: DOMRect): IconNode | null => {
    const iconName = element.textContent?.trim() || '';
    const iconData = MATERIAL_SYMBOLS_PATHS[iconName];

    if (!iconData) {
        // If icon not found in our mapping, return null
        console.warn(`Material Symbol icon "${iconName}" not found in mapping`);
        return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return null;
    }

    const { color } = parseColor(style.color);
    const opacity = clampNumber(parseFloat(style.opacity), 1);

    return {
        id: `icon-${nodeCounter++}`,
        kind: 'icon',
        tagName: element.tagName.toLowerCase(),
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        opacity,
        className: element.className || undefined,
        iconName,
        color,
        svgPath: iconData.path,
        viewBox: iconData.viewBox,
        children: [],
    };
};

const collectTextNodes = (element: HTMLElement, style: CSSStyleDeclaration, rootRect: DOMRect): TextNode[] => {
    const results: TextNode[] = [];
    const opacity = clampNumber(parseFloat(style.opacity), 1);

    Array.from(element.childNodes).forEach((node) => {
        if (node.nodeType !== Node.TEXT_NODE) {
            return;
        }
        const fullText = node.textContent ?? '';
        const content = fullText.replace(/\s+/g, ' ').trim();
        if (!content) {
            return;
        }

        const { color, opacity: colorOpacity } = parseColor(style.color);
        const fontSize = parsePx(style.fontSize, 16);
        const fontFamily = sanitizeFontFamily(style.fontFamily);
        const lineHeight = parseLineHeight(style.lineHeight, fontSize);
        const letterSpacing = style.letterSpacing === 'normal' ? 0 : parsePx(style.letterSpacing, 0);
        const textAnchor = toTextAnchor(style.textAlign);

        // Split the text node into visual lines using Range measurements
        const lineSegments = splitTextByVisualLines(node as Text);
        lineSegments.forEach(({ text, rect }) => {
            if (!text.trim()) return;
            if (!rect || rect.width === 0 || rect.height === 0) return;

            // Adjust X coordinate based on text-anchor alignment
            let xPos = rect.left - rootRect.left;
            if (textAnchor === 'middle') {
                xPos = rect.left - rootRect.left + rect.width / 2;
            } else if (textAnchor === 'end') {
                xPos = rect.right - rootRect.left;
            }

            // Calculate baseline position using rect height and fontSize
            // For alphabetic baseline: top + (lineHeight - fontSize) / 2 + fontSize * 0.85
            const lineHeightPx = rect.height;
            const baselineOffset = (lineHeightPx - fontSize) / 2 + fontSize * 0.85;
            const yPos = rect.top - rootRect.top + baselineOffset;

            results.push({
                id: `text-${nodeCounter++}`,
                kind: 'text',
                tagName: element.tagName.toLowerCase(),
                x: xPos,
                y: yPos,
                width: rect.width,
                height: rect.height,
                opacity,
                className: element.className || undefined,
                text: {
                    content: text,
                    color,
                    opacity: colorOpacity,
                    fontFamily,
                    fontSize,
                    fontWeight: style.fontWeight,
                    fontStyle: style.fontStyle,
                    letterSpacing,
                    lineHeight,
                    textAnchor,
                },
                children: [],
            });
        });
    });

    return results;
};

// Measure visual lines by advancing a Range through the text node and
// splitting whenever the bounding rect's top changes (new line box).
const splitTextByVisualLines = (textNode: Text): Array<{ text: string; rect: DOMRect }> => {
    const segments: Array<{ text: string; rect: DOMRect }> = [];
    const content = textNode.textContent ?? '';
    if (!content) return segments;

    const range = document.createRange();
    // Group by per-character rect.top to avoid mid-word splits
    let currentTop: number | null = null;
    let lineStart = 0;
    // Track bounding box of the current line by aggregating character rects
    let aggLeft = Infinity;
    let aggTop = Infinity;
    let aggRight = -Infinity;
    let aggBottom = -Infinity;

    const commitLine = (endExclusive: number) => {
        if (endExclusive > lineStart && isFinite(aggLeft) && isFinite(aggTop) && isFinite(aggRight) && isFinite(aggBottom)) {
            const text = content.slice(lineStart, endExclusive);
            const width = Math.max(0, aggRight - aggLeft);
            const height = Math.max(0, aggBottom - aggTop);
            // Construct a DOMRect-like object for downstream usage
            const rect = {
                left: aggLeft,
                top: aggTop,
                right: aggRight,
                bottom: aggBottom,
                width,
                height,
                x: aggLeft,
                y: aggTop,
                toJSON: () => ({ left: aggLeft, top: aggTop, right: aggRight, bottom: aggBottom, width, height, x: aggLeft, y: aggTop }),
            } as DOMRect;
            segments.push({ text, rect });
        }
    };

    for (let i = 0; i < content.length; i += 1) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rect = range.getBoundingClientRect();
        // If rect invalid, skip but keep accumulating
        if (!rect || rect.width === 0 || rect.height === 0) {
            continue;
        }
        if (currentTop === null) {
            currentTop = rect.top;
            lineStart = i;
            aggLeft = rect.left;
            aggTop = rect.top;
            aggRight = rect.right;
            aggBottom = rect.bottom;
        } else if (Math.abs(rect.top - currentTop) > 0.5) {
            // New line detected, commit previous up to i
            commitLine(i);
            currentTop = rect.top;
            lineStart = i;
            aggLeft = rect.left;
            aggTop = rect.top;
            aggRight = rect.right;
            aggBottom = rect.bottom;
        } else {
            // Same line; expand aggregate bounds
            aggLeft = Math.min(aggLeft, rect.left);
            aggTop = Math.min(aggTop, rect.top);
            aggRight = Math.max(aggRight, rect.right);
            aggBottom = Math.max(aggBottom, rect.bottom);
        }
    }

    // Commit final line
    commitLine(content.length);

    range.detach?.();
    return segments;
};

const isRenderable = (style: CSSStyleDeclaration): boolean => {
    if (style.display === 'none') {
        return false;
    }
    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
    }
    const opacity = parseFloat(style.opacity);
    return opacity > 0;
};

const parseFill = (style: CSSStyleDeclaration): Fill | null => {
    if (style.backgroundImage && style.backgroundImage !== 'none') {
        const gradient = parseLinearGradient(style.backgroundImage);
        if (gradient) {
            return gradient;
        }
    }

    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
        const { color, opacity } = parseColor(style.backgroundColor);
        return { kind: 'solid', color, opacity };
    }

    return null;
};

const parseLinearGradient = (value: string): LinearGradientFill | null => {
    const segment = extractLinearGradientSegment(value);
    if (!segment) {
        return null;
    }
    const inner = segment.slice(segment.indexOf('(') + 1, -1);
    const tokens = splitGradientArgs(inner);
    if (!tokens.length) {
        return null;
    }

    let angle = 180;
    let startIndex = 0;
    if (tokens[0].includes('deg') || tokens[0].includes('rad') || tokens[0].startsWith('to ')) {
        angle = parseGradientAngle(tokens[0]);
        startIndex = 1;
    }

    if (tokens.length - startIndex < 2) {
        return null;
    }

    const stops: GradientStop[] = [];
    tokens.slice(startIndex).forEach((token, index, arr) => {
        const stop = parseGradientStop(token.trim(), index, arr.length);
        if (stop) {
            stops.push(stop);
        }
    });

    if (stops.length < 2) {
        return null;
    }

    return { kind: 'linear-gradient', angle, stops };
};

const extractLinearGradientSegment = (value: string): string | null => {
    const index = value.indexOf('linear-gradient');
    if (index === -1) {
        return null;
    }
    const start = value.indexOf('(', index);
    if (start === -1) {
        return null;
    }
    let depth = 1;
    for (let i = start + 1; i < value.length; i += 1) {
        const char = value[i];
        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
            if (depth === 0) {
                return value.slice(index, i + 1);
            }
        }
    }
    return null;
};

const splitGradientArgs = (input: string): string[] => {
    const result: string[] = [];
    let buffer = '';
    let depth = 0;
    for (const char of input) {
        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth = Math.max(depth - 1, 0);
        }

        if (char === ',' && depth === 0) {
            result.push(buffer.trim());
            buffer = '';
            continue;
        }
        buffer += char;
    }
    if (buffer.trim()) {
        result.push(buffer.trim());
    }
    return result;
};

const parseGradientAngle = (token: string): number => {
    const trimmed = token.trim().toLowerCase();
    if (trimmed.endsWith('deg')) {
        return clampNumber(parseFloat(trimmed), 180);
    }
    if (trimmed.endsWith('rad')) {
        return clampNumber((parseFloat(trimmed) * 180) / Math.PI, 180);
    }
    switch (trimmed) {
        case 'to top':
            return 0;
        case 'to right':
            return 90;
        case 'to bottom':
            return 180;
        case 'to left':
            return 270;
        case 'to top right':
            return 45;
        case 'to top left':
            return 315;
        case 'to bottom right':
            return 135;
        case 'to bottom left':
            return 225;
        default:
            return 180;
    }
};

const parseGradientStop = (token: string, index: number, total: number): GradientStop | null => {
    if (!token) {
        return null;
    }
    let colorToken = token;
    let offsetValue: number | null = null;

    const parts = token.split(/\s+(?![^()]*\))/);
    if (parts.length > 1) {
        const maybeOffset = parts[parts.length - 1];
        if (maybeOffset.endsWith('%')) {
            offsetValue = clampNumber(parseFloat(maybeOffset) / 100, index / Math.max(total - 1, 1));
            parts.pop();
            colorToken = parts.join(' ');
        }
    }

    const { color, opacity } = parseColor(colorToken);
    const offset = offsetValue ?? (index / Math.max(total - 1, 1));
    return { color, opacity, offset };
};

const parseBorderRadius = (style: CSSStyleDeclaration): BorderRadius => {
    const parseValue = (value: string): number => (value && value !== '0px' ? parsePx(value, 0) : 0);
    return {
        topLeft: parseValue(style.borderTopLeftRadius),
        topRight: parseValue(style.borderTopRightRadius),
        bottomRight: parseValue(style.borderBottomRightRadius),
        bottomLeft: parseValue(style.borderBottomLeftRadius),
    };
};

const parseBorders = (style: CSSStyleDeclaration): BorderSet | null => {
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    const result: Partial<Record<(typeof sides)[number], BorderSide>> = {};
    sides.forEach((side) => {
        const widthValue = style[`border${side}Width` as keyof CSSStyleDeclaration] as string | null;
        const styleValue = style[`border${side}Style` as keyof CSSStyleDeclaration] as string | null;
        const colorValue = style[`border${side}Color` as keyof CSSStyleDeclaration] as string | null;
        const width = parsePx(widthValue, 0);
        if (width <= 0 || styleValue === 'none') {
            return;
        }
        const { color, opacity } = parseColor(colorValue ?? '#000000');
        result[side] = {
            width,
            style: styleValue ?? 'solid',
            color,
            opacity,
        } satisfies BorderSide;
    });

    if (!result.Top && !result.Right && !result.Bottom && !result.Left) {
        return null;
    }

    const fallback: BorderSide = { ...defaultBorderSide };
    return {
        top: result.Top ?? fallback,
        right: result.Right ?? fallback,
        bottom: result.Bottom ?? fallback,
        left: result.Left ?? fallback,
    };
};

const defaultBorderSide: BorderSide = {
    width: 0,
    color: '#000000',
    opacity: 1,
    style: 'solid',
};

const parseBoxShadows = (style: CSSStyleDeclaration): BoxShadow[] => {
    const value = style.boxShadow;
    if (!value || value === 'none') {
        return [];
    }

    const shadowStrings = splitShadowValue(value);
    const shadows: BoxShadow[] = [];
    shadowStrings.forEach((shadow) => {
        const parsed = parseSingleShadow(shadow.trim());
        if (parsed) {
            shadows.push(parsed);
        }
    });
    return shadows;
};

const splitShadowValue = (value: string): string[] => {
    const result: string[] = [];
    let buffer = '';
    let depth = 0;
    for (const char of value) {
        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth = Math.max(depth - 1, 0);
        }
        if (char === ',' && depth === 0) {
            result.push(buffer.trim());
            buffer = '';
            continue;
        }
        buffer += char;
    }
    if (buffer.trim()) {
        result.push(buffer.trim());
    }
    return result;
};

const parseSingleShadow = (value: string): BoxShadow | null => {
    if (!value) {
        return null;
    }
    const inset = /(^|\s)inset(\s|$)/i.test(value);
    const cleaned = value.replace(/(^|\s)inset(\s|$)/gi, ' ').trim();
    const colorMatch = cleaned.match(SHADOW_COLOR_REGEX);
    let colorToken = 'rgba(0, 0, 0, 0.25)';
    let numericPart = cleaned;
    if (colorMatch && colorMatch.index !== undefined) {
        colorToken = colorMatch[0];
        numericPart = (cleaned.slice(0, colorMatch.index) + cleaned.slice(colorMatch.index + colorToken.length)).trim();
    }
    const tokens = numericPart.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
        return null;
    }
    const [offsetX, offsetY, blur = '0px', spread = '0px'] = tokens;
    const { color, opacity } = parseColor(colorToken);
    return {
        inset,
        offsetX: parsePx(offsetX, 0),
        offsetY: parsePx(offsetY, 0),
        blur: Math.max(0, parsePx(blur, 0)),
        spread: parsePx(spread, 0),
        color,
        opacity,
    };
};

const parseColor = (value: string | null | undefined): RgbaColor => {
    if (!value) {
        return { color: '#000000', opacity: 1 };
    }
    const trimmed = value.trim();

    const rgbaMatch = trimmed.match(RGBA_REGEX);
    if (rgbaMatch) {
        const r = clampChannel(parseInt(rgbaMatch[1], 10));
        const g = clampChannel(parseInt(rgbaMatch[2], 10));
        const b = clampChannel(parseInt(rgbaMatch[3], 10));
        const a = rgbaMatch[4] !== undefined ? clampNumber(parseFloat(rgbaMatch[4]), 1) : 1;
        return { color: rgbToHex(r, g, b), opacity: a };
    }

    const hexMatch = trimmed.match(HEX_REGEX);
    if (hexMatch) {
        const normalized = normalizeHex(hexMatch[1]);
        const opacity = normalized.length === 8 ? parseInt(normalized.slice(6), 16) / 255 : 1;
        return { color: `#${normalized.slice(0, 6)}`, opacity };
    }

    return { color: trimmed, opacity: 1 };
};

const normalizeHex = (value: string): string => {
    if (value.length === 3) {
        return value.split('').map((char) => char + char).join('') + 'ff';
    }
    if (value.length === 4) {
        return value
            .split('')
            .map((char) => char + char)
            .join('');
    }
    if (value.length === 6) {
        return `${value}ff`;
    }
    return value;
};

const rgbToHex = (r: number, g: number, b: number): string => {
    const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const clampChannel = (value: number): number => Math.min(255, Math.max(0, value));

const clampNumber = (value: number, fallback = 0): number => {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
        return fallback;
    }
    return value;
};

const parsePx = (value: string | null | undefined, fallback = 0): number => {
    if (!value) {
        return fallback;
    }
    const match = value.match(PX_REGEX);
    if (match) {
        return parseFloat(match[1]);
    }
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
};

const parseLineHeight = (value: string, fontSize: number): number => {
    if (!value || value === 'normal') {
        return fontSize * 1.2;
    }
    if (value.endsWith('%')) {
        return (parseFloat(value) / 100) * fontSize;
    }
    if (value.endsWith('px')) {
        return parsePx(value, fontSize);
    }
    const numeric = parseFloat(value);
    if (!Number.isNaN(numeric)) {
        return numeric * fontSize;
    }
    return fontSize * 1.2;
};

const sanitizeFontFamily = (value: string): string => {
    if (!value) {
        return 'sans-serif';
    }
    return value
        .split(',')
        .map((family) => family.trim().replace(/"|'/g, ''))
        .join(', ');
};

const toTextAnchor = (textAlign: string): 'start' | 'middle' | 'end' => {
    switch (textAlign) {
        case 'center':
            return 'middle';
        case 'right':
        case 'end':
            return 'end';
        default:
            return 'start';
    }
};

const renderNode = (node: SimpleNode, context: RenderContext): string => {
    if (node.kind === 'text') {
        return renderTextNode(node);
    }
    if (node.kind === 'icon') {
        return renderIconNode(node);
    }
    return renderBoxNode(node, context);
};

const createStyleDef = (css: string): string => {
    const safeCss = css.replace(/]]>/g, ']]]]><![CDATA[>');
    return `<style type="text/css"><![CDATA[${safeCss}]]></style>`;
};

const renderBoxNode = (node: BoxNode, context: RenderContext): string => {
    const path = roundedRectPath(node.x, node.y, node.width, node.height, node.borderRadius);
    const fillAttr = resolveFill(node.background, context);
    const strokeAttr = resolveStroke(node.borders);
    const filterAttr = resolveShadows(node.shadows, context);
    const opacityAttr = node.opacity !== 1 ? ` opacity="${formatNumber(node.opacity)}"` : '';
    const classAttr = node.className ? ` class="${escapeAttribute(node.className)}"` : '';
    const dataTagAttr = ` data-tag="${escapeAttribute(node.tagName)}"`;

    // Optional clipPath for overflow: hidden boxes
    const clipId = node.overflowHidden ? ensureClipPath(node, context) : null;
    const clipAttr = clipId ? ` clip-path="url(#${clipId})"` : '';

    const childrenContent = node.children.map((child) => renderNode(child, context)).join('');

    const filterString = filterAttr ? ` filter="url(#${filterAttr})"` : '';
    const strokeString = strokeAttr ? ` ${strokeAttr}` : '';

    // Duplicate the class onto the shape so class-based selectors can target the geometry directly.
    const shapeClassAttr = node.className ? ` class="${escapeAttribute(node.className)}"` : '';
    return `<g${opacityAttr}${classAttr}${dataTagAttr}${clipAttr}>` +
        `<path d="${path}" fill="${fillAttr}"${strokeString}${filterString}${shapeClassAttr} />` +
        `${childrenContent}</g>`;
};

const renderTextNode = (node: TextNode): string => {
    const { text } = node;
    const combinedOpacity = node.opacity * text.opacity;
    const opacityAttr = combinedOpacity !== 1 ? ` fill-opacity="${formatNumber(combinedOpacity)}"` : '';
    const letterSpacingAttr = text.letterSpacing ? ` letter-spacing="${formatNumber(text.letterSpacing)}"` : '';
    const classAttr = node.className ? ` class="${escapeAttribute(node.className)}"` : '';
    const dataTagAttr = ` data-tag="${escapeAttribute(node.tagName)}"`;
    const fontWeightAttr = normalizeFontWeight(text.fontWeight);
    return `<text x="${formatNumber(node.x)}" y="${formatNumber(node.y)}" font-family="${escapeAttribute(text.fontFamily)}" font-size="${formatNumber(text.fontSize)}" ${fontWeightAttr} font-style="${escapeAttribute(text.fontStyle)}" text-anchor="${text.textAnchor}" dominant-baseline="alphabetic" xml:space="preserve" fill="${text.color}"${opacityAttr}${letterSpacingAttr}${classAttr}${dataTagAttr}>${escapeText(text.content)}</text>`;
};

const renderIconNode = (node: IconNode): string => {
    const opacityAttr = node.opacity !== 1 ? ` opacity="${formatNumber(node.opacity)}"` : '';
    const classAttr = node.className ? ` class="${escapeAttribute(node.className)}"` : '';
    const dataTagAttr = ` data-tag="${escapeAttribute(node.tagName)}"`;
    const dataIconAttr = ` data-icon="${escapeAttribute(node.iconName)}"`;

    // Parse viewBox to get original dimensions
    const viewBoxParts = node.viewBox.split(' ').map(Number);
    const origWidth = viewBoxParts[2] || 24;
    const origHeight = viewBoxParts[3] || 24;

    // Calculate scale to fit icon in the allocated space
    const scaleX = node.width / origWidth;
    const scaleY = node.height / origHeight;
    const scale = Math.min(scaleX, scaleY);

    // Center the icon in the allocated space
    const scaledWidth = origWidth * scale;
    const scaledHeight = origHeight * scale;
    const offsetX = node.x + (node.width - scaledWidth) / 2;
    const offsetY = node.y + (node.height - scaledHeight) / 2;

    return `<g transform="translate(${formatNumber(offsetX)},${formatNumber(offsetY)}) scale(${formatNumber(scale)})"${opacityAttr}${classAttr}${dataTagAttr}${dataIconAttr}><path d="${node.svgPath}" fill="${node.color}"/></g>`;
};

const resolveFill = (fill: Fill | null, context: RenderContext): string => {
    if (!fill) {
        return 'transparent';
    }
    if (fill.kind === 'solid') {
        if (fill.opacity === 1) {
            return fill.color;
        }
        return applyAlpha(fill.color, fill.opacity);
    }
    const id = ensureGradient(fill, context);
    return `url(#${id})`;
};

const applyAlpha = (hexColor: string, alpha: number): string => {
    if (hexColor.startsWith('#') && hexColor.length >= 7) {
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hexColor;
};

const resolveStroke = (borders: BorderSet | null): string => {
    if (!borders) {
        return '';
    }
    const widths = [borders.top.width, borders.right.width, borders.bottom.width, borders.left.width];
    const colors = [borders.top.color, borders.right.color, borders.bottom.color, borders.left.color];
    const opacities = [borders.top.opacity, borders.right.opacity, borders.bottom.opacity, borders.left.opacity];

    const uniformWidth = widths.every((width) => width === widths[0]);
    const uniformColor = colors.every((color) => color === colors[0]);
    const uniformOpacity = opacities.every((opacity) => opacity === opacities[0]);

    if (!uniformWidth || !uniformColor || !uniformOpacity) {
        return '';
    }

    if (widths[0] === 0) {
        return '';
    }

    const strokeColor = opacities[0] === 1 ? colors[0] : applyAlpha(colors[0], opacities[0]);
    return `stroke="${strokeColor}" stroke-width="${formatNumber(widths[0])}" shape-rendering="geometricPrecision"`;
};

const resolveShadows = (shadows: BoxShadow[], context: RenderContext): string | null => {
    const usable = shadows.filter((shadow) => !shadow.inset);
    if (!usable.length) {
        return null;
    }
    const id = `shadow-${context.filterIndex++}`;
    const shadowContent = usable
        .map((shadow) => `<feDropShadow dx="${formatNumber(shadow.offsetX)}" dy="${formatNumber(shadow.offsetY)}" stdDeviation="${formatNumber(Math.max(shadow.blur, 0) / 2)}" flood-color="${shadow.color}" flood-opacity="${formatNumber(shadow.opacity)}" />`)
        .join('');
    context.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${shadowContent}</filter>`);
    return id;
};

const ensureGradient = (gradient: LinearGradientFill, context: RenderContext): string => {
    const id = `gradient-${context.gradientIndex++}`;
    const { x1, y1, x2, y2 } = gradientVector(gradient.angle);
    const stops = gradient.stops
        .map((stop) => `<stop offset="${formatPercentage(stop.offset)}" stop-color="${stop.color}" stop-opacity="${formatNumber(stop.opacity)}" />`)
        .join('');
    context.defs.push(`<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="${formatNumber(x1)}" y1="${formatNumber(y1)}" x2="${formatNumber(x2)}" y2="${formatNumber(y2)}">${stops}</linearGradient>`);
    return id;
};

const gradientVector = (angle: number): { x1: number; y1: number; x2: number; y2: number } => {
    const rad = (angle * Math.PI) / 180;
    const x = Math.cos(rad);
    const y = Math.sin(rad);
    const x1 = (1 - x) / 2;
    const y1 = (1 - y) / 2;
    const x2 = (1 + x) / 2;
    const y2 = (1 + y) / 2;
    return { x1, y1, x2, y2 };
};

const roundedRectPath = (x: number, y: number, width: number, height: number, radii: BorderRadius): string => {
    const tl = Math.min(radii.topLeft, width / 2, height / 2);
    const tr = Math.min(radii.topRight, width / 2, height / 2);
    const br = Math.min(radii.bottomRight, width / 2, height / 2);
    const bl = Math.min(radii.bottomLeft, width / 2, height / 2);

    return [
        `M ${formatNumber(x + tl)} ${formatNumber(y)}`,
        `H ${formatNumber(x + width - tr)}`,
        `Q ${formatNumber(x + width)} ${formatNumber(y)} ${formatNumber(x + width)} ${formatNumber(y + tr)}`,
        `V ${formatNumber(y + height - br)}`,
        `Q ${formatNumber(x + width)} ${formatNumber(y + height)} ${formatNumber(x + width - br)} ${formatNumber(y + height)}`,
        `H ${formatNumber(x + bl)}`,
        `Q ${formatNumber(x)} ${formatNumber(y + height)} ${formatNumber(x)} ${formatNumber(y + height - bl)}`,
        `V ${formatNumber(y + tl)}`,
        `Q ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(x + tl)} ${formatNumber(y)}`,
        'Z',
    ].join(' ');
};

const ensureClipPath = (node: BoxNode, context: RenderContext): string => {
    const id = `clip-${context.filterIndex++}`;
    const d = roundedRectPath(node.x, node.y, node.width, node.height, node.borderRadius);
    context.defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${d}" /></clipPath>`);
    return id;
};

const normalizeFontWeight = (weight: number | string): string => {
    const w = String(weight).trim().toLowerCase();
    // Map common Tailwind numeric weights to valid SVG values
    if (/^(100|200|300|400|500|600|700|800|900)$/.test(w)) {
        return `font-weight="${w}"`;
    }
    if (w === 'bold') return 'font-weight="700"';
    if (w === 'normal') return 'font-weight="400"';
    return `font-weight="${escapeAttribute(String(weight))}"`;
};

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const escapeText = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const formatNumber = (value: number): string => {
    const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

const formatPercentage = (value: number): string => `${Math.round(value * 10000) / 100}%`;
