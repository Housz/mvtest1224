import { Color } from 'three';

const EXPORT_HAN_PATTERN = /\p{Script=Han}/u;

function decodeEscapedUnicode(value) {
    return String(value ?? '').replace(/\\u([0-9a-f]{4})/gi, (_, code) =>
        String.fromCharCode(Number.parseInt(code, 16))
    );
}

function findCjkExportIssue(fileName, text) {
    const decodedFileName = decodeEscapedUnicode(fileName);
    if (EXPORT_HAN_PATTERN.test(decodedFileName)) {
        return { location: 'filename', value: decodedFileName.match(EXPORT_HAN_PATTERN)?.[0] ?? '' };
    }

    const lines = decodeEscapedUnicode(text).split(/\r?\n/);
    const lineIndex = lines.findIndex((line) => EXPORT_HAN_PATTERN.test(line));
    if (lineIndex < 0) return null;

    return {
        location: `line ${lineIndex + 1}`,
        value: lines[lineIndex].match(EXPORT_HAN_PATTERN)?.[0] ?? ''
    };
}

function assertEnglishExport(fileName, text) {
    const issue = findCjkExportIssue(fileName, text);
    if (!issue) return;

    const message = `Export blocked: "${fileName}" contains CJK text at ${issue.location}: ${issue.value}`;
    if (typeof alert === 'function') alert(message);
    throw new Error(message);
}

// 文本下载
export function downloadString(text, fileName, mimeType) {
    assertEnglishExport(fileName, text);
    const blob = new Blob([text], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 简单的 CSV 行解析
export function parseCsvLine(line) {
    const regex = /(?:\"(.*?)\"|([^,]+))/g;
    let matches = [];
    let match;
    while (match = regex.exec(line)) {
        matches.push(match[1] !== undefined ? match[1] : match[2]);
    }
    return matches.map(s => s.trim());
}

// 数值映射为热力图颜色 (蓝 -> 红)
export function getHeatmapColor(val, min, max) {
    let t = (val - min) / (max - min);
    t = Math.max(0, Math.min(1, t)); // Clamp 0~1
    const hue = (1.0 - t) * 0.66; // Blue(0.66) -> Red(0.0)
    const color = new Color();
    color.setHSL(hue, 1.0, 0.5);
    return color;
}

// 计算点到线段的最近点 (2D)
export function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}