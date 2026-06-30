/**
 * PDFKit-based PDF generation for Azure compatibility
 *
 * WHY PDFKIT OVER PLAYWRIGHT/CHROMIUM:
 * - No browser dependencies: Runs pure Node.js, works on Azure App Service
 * - Lightweight: ~500KB vs 200MB+ for Chromium
 * - Server-side only: No rendering engine overhead
 * - Reliable: Doesn't depend on system libraries (Chrome, X11, fonts)
 * - Fast: Direct PDF generation without headless browser overhead
 * - Azure-safe: No sandboxing issues, no system package requirements
 *
 * VALIDATION & ERROR HANDLING:
 * - Validates all input parameters before processing
 * - Handles large documents with page breaks
 * - Gracefully handles image loading failures
 * - Provides clear error messages for debugging
 * - Supports streaming for memory efficiency
 *
 * FONT HANDLING:
 * - Uses custom embedded TrueType fonts (LiberationSans)
 * - Works on Azure App Service Linux (no system fonts)
 * - Validates font file existence before PDF generation
 * - Fails with clear error if font is missing
 */

// @ts-ignore - PDFKit may not be installed yet
import PDFDocument from 'pdfkit';
import type * as PDFKit from 'pdfkit';
import { Readable } from 'stream';
import * as path from 'path';
import * as fs from 'fs';
import { getLogoBuffer } from './brandLogo';

/** Page margin in points (72pt = 1 inch). Ensures proper right/left padding to prevent text truncation. */
const PAGE_MARGIN = 72;
/** Extra buffer for text width to prevent right-edge truncation in PDF viewers. */
const TEXT_WIDTH_BUFFER = 24;

/**
 * Resolve the font directory with Azure-safe path detection
 * Tries multiple locations in order:
 * 1. /home/site/wwwroot/server/assets/fonts (Azure production)
 * 2. /home/site/wwwroot/dist/server/assets/fonts (Azure with dist build)
 * 3. {process.cwd()}/server/assets/fonts (local development)
 * 4. {process.cwd()}/dist/server/assets/fonts (local after build)
 * 
 * @throws Error if no valid font directory found
 * @returns Absolute path to font directory
 */
function resolveFontDir(): string {
    const candidates = [
        // Azure production paths
        '/home/site/wwwroot/server/assets/fonts',
        '/home/site/wwwroot/dist/server/assets/fonts',
        // Local development paths
        path.join(process.cwd(), 'server', 'assets', 'fonts'),
        path.join(process.cwd(), 'dist', 'server', 'assets', 'fonts'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            console.log(`[PDF Font] Using font directory: ${candidate}`);
            return candidate;
        }
    }

    // No valid font directory found
    throw new Error(
        `[PDF Font] No font directory found. Tried paths:\n` +
        candidates.map(c => `  - ${c}`).join('\n') + '\n' +
        `PDFKit requires LiberationSans-Regular.ttf (cannot use system fonts on Azure Linux).\n` +
        `Ensure fonts are copied to dist/ during build: cp -r server/assets/fonts dist/server/assets/`
    );
}

/**
 * Initialize fonts for PDFKit
 * Registers custom TrueType fonts to avoid system font dependency on Azure
 * 
 * CRITICAL: Call this immediately after creating PDFDocument, before any text operations
 * 
 * @param doc - PDFKit document instance
 * @throws Error if custom font file is not found
 */
function initializeFonts(doc: PDFKit.PDFDocument): void {
    const fontDir = resolveFontDir();
    const regular = path.join(fontDir, 'LiberationSans-Regular.ttf');
    const bold = path.join(fontDir, 'LiberationSans-Bold.ttf');

    // Regular font is REQUIRED
    if (!fs.existsSync(regular)) {
        throw new Error(
            `[PDF Font] LiberationSans-Regular.ttf not found at ${regular}. ` +
            `This font is required for PDF generation on Azure App Service Linux ` +
            `(system fonts like Helvetica are not available). ` +
            `Ensure the font file exists in server/assets/fonts/ and is copied to dist/ during build.`
        );
    }

    // Register regular font
    doc.registerFont('LiberationSans', regular);
    console.log(`[PDF Font] Registered LiberationSans from ${regular}`);

    // Register bold variant. If missing, map bold to regular so calls to
    // "LiberationSans-Bold" still work without falling back to system fonts.
    if (fs.existsSync(bold)) {
        doc.registerFont('LiberationSans-Bold', bold);
        console.log(`[PDF Font] Registered LiberationSans-Bold from ${bold}`);
    } else {
        doc.registerFont('LiberationSans-Bold', regular);
        console.log(`[PDF Font] Bold not found, mapping LiberationSans-Bold to regular`);
    }

    // Set default font for entire document
    // This ensures ANY text operation uses our registered font
    doc.font('LiberationSans');
}

/**
 * Validate PDF generation options
 * @throws Error if validation fails
 */
function validatePDFOptions(options: PDFGenerationOptions): void {
    // Validate required fields
    if (!options.title || typeof options.title !== 'string') {
        throw new Error('Title is required and must be a string');
    }

    if (!options.version || typeof options.version !== 'string') {
        throw new Error('Version is required and must be a string');
    }

    // Require either rawMarkdown or sections
    if (!options.rawMarkdown && (!options.sections || options.sections.length === 0)) {
        throw new Error('Either rawMarkdown or sections array is required');
    }

    // Validate optional fields
    if (options.sections && !Array.isArray(options.sections)) {
        throw new Error('Sections must be an array if provided');
    }

    if (options.tables && !Array.isArray(options.tables)) {
        throw new Error('Tables must be an array if provided');
    }

    if (options.images && !Array.isArray(options.images)) {
        throw new Error('Images must be an array if provided');
    }

    // Validate sections format
    if (options.sections) {
        options.sections.forEach((section, index) => {
            if (!section.title || typeof section.title !== 'string') {
                throw new Error(
                    `Section ${index} must have a non-empty title string`
                );
            }
            if (typeof section.content !== 'string') {
                throw new Error(
                    `Section ${index} content must be a string`
                );
            }
        });
    }

    // Validate legacy tables format
    if (options.tables) {
        options.tables.forEach((table, index) => {
            if (!table.title || typeof table.title !== 'string') {
                throw new Error(
                    `Table ${index} must have a non-empty title string`
                );
            }
            if (!Array.isArray(table.columns) || table.columns.length === 0) {
                throw new Error(
                    `Table ${index} must have at least one column`
                );
            }
            if (!Array.isArray(table.rows)) {
                throw new Error(
                    `Table ${index} rows must be an array`
                );
            }
        });
    }

    // Validate approval matrix if provided
    if (options.approvalMatrix) {
        const matrix = options.approvalMatrix;

        if (!Array.isArray(matrix.headers) || matrix.headers.length === 0) {
            throw new Error('Approval matrix headers must be a non-empty array');
        }

        if (!Array.isArray(matrix.rows)) {
            throw new Error('Approval matrix rows must be an array');
        }

        // Validate each row has correct number of columns
        matrix.rows.forEach((row, rowIndex) => {
            if (!Array.isArray(row) || row.length !== matrix.headers.length) {
                throw new Error(
                    `Approval matrix row ${rowIndex} must have ${matrix.headers.length} columns`
                );
            }
            // Validate each cell is a string
            row.forEach((cell, colIndex) => {
                if (typeof cell !== 'string') {
                    throw new Error(
                        `Approval matrix row ${rowIndex}, col ${colIndex} must be a string`
                    );
                }
            });
        });

        // Validate column widths if provided
        if (matrix.columnWidths) {
            if (!Array.isArray(matrix.columnWidths) || matrix.columnWidths.length !== matrix.headers.length) {
                throw new Error(
                    `Column widths must match number of headers (${matrix.headers.length})`
                );
            }
            matrix.columnWidths.forEach((width, index) => {
                if (typeof width !== 'number' || width <= 0) {
                    throw new Error(`Column width ${index} must be a positive number`);
                }
            });
        }
    }

    // Validate images format
    if (options.images) {
        options.images.forEach((image, index) => {
            if (!image.label || typeof image.label !== 'string') {
                throw new Error(
                    `Image ${index} must have a non-empty label string`
                );
            }
            if (!image.imageBase64 || typeof image.imageBase64 !== 'string') {
                throw new Error(
                    `Image ${index} must have a valid base64 string`
                );
            }
            // Try to validate base64
            try {
                Buffer.from(image.imageBase64, 'base64');
            } catch {
                throw new Error(
                    `Image ${index} has invalid base64 encoding`
                );
            }
        });
    }
}

export interface TableColumn {
    key: string;
    label: string;
    width?: number;
}

export interface TableRow {
    [key: string]: string | number | boolean | null;
}

/**
 * Structured table with headers and rows as arrays
 * This is the CORRECT way to pass table data to PDFKit
 * 
 * WHY NOT MARKDOWN TABLES:
 * - Markdown uses pipes (|) and dashes (-) as plain text
 * - PDFKit doesn't know they're table delimiters - just renders as text
 * - Results in misaligned columns, no proper cell layout
 * - Text spacing doesn't translate to PDF layout
 * 
 * CORRECT APPROACH:
 * - Headers: string[] (e.g., ["Role", "Name", "Approval", "Signature"])
 * - Rows: string[][] (e.g., [["CEO", "John Doe", "Final approval", "____"]])
 * - Widths: number[] (e.g., [100, 140, 220, 100])
 * - Render using doc.rect() for cells, doc.text() for positioned text
 */
export interface StructuredTable {
    headers: string[];
    rows: string[][];
    columnWidths?: number[]; // Optional: use fixed widths. If not provided, distributed equally
    title?: string;
}

export interface PDFGenerationOptions {
    title: string;
    version: string;
    rawMarkdown?: string; // Optional: raw markdown with all tables and formatting
    sections?: Array<{
        title: string;
        content: string;
    }>;
    tables?: Array<{
        title: string;
        columns: TableColumn[];
        rows: TableRow[];
    }>;
    /**
     * Approval matrix table with fixed column layout
     * Example:
     * {
     *   headers: ["Role", "Name / Title", "Approval Responsibility", "Signature / Date"],
     *   rows: [
     *     ["CEO", "John Smith", "Overall approval", "_____________"],
     *     ["CTO", "Jane Doe", "Technical approval", "_____________"]
     *   ],
     *   columnWidths: [100, 140, 220, 100]
     * }
     * 
     * Azure-safe: Pure PDFKit rendering, no HTML, no browser, no Chromium
     */
    approvalMatrix?: StructuredTable;
    images?: Array<{
        label: string;
        imageBase64: string;
        imageType?: 'png' | 'jpeg' | 'svg';
    }>;
}

/**
 * Simple markdown to text converter (basic support)
 * Handles: bold, italic, headers, lists, code blocks
 */
function markdownToText(markdown: string): string {
    let text = markdown
        // Remove markdown link syntax [text](url)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove markdown image syntax ![alt](url)
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        // Convert bold **text** to text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        // Convert italic *text* or _text_ to text
        .replace(/[*_]([^*_]+)[*_]/g, '$1')
        // Convert headers to text (remove # symbols)
        .replace(/^#+\s+(.+)$/gm, '$1')
        // Keep unordered lists but remove markers
        .replace(/^\s*[-*+]\s+(.+)$/gm, '  • $1')
        // Keep ordered lists but simplify
        .replace(/^\s*\d+\.\s+(.+)$/gm, '  - $1')
        // Remove inline code markers
        .replace(/`([^`]+)`/g, '$1')
        // Remove code block markers
        .replace(/```[\s\S]*?```/gm, '[Code Block]')
        // Remove extra whitespace
        .replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

/**
 * Parse markdown table and convert to StructuredTable format
 * 
 * Detects markdown tables like:
 * | Role | Name | Responsibility |
 * |----|----|----|
 * | PM | John | Approve reqs |
 * 
 * Converts to:
 * {
 *   headers: ["Role", "Name", "Responsibility"],
 *   rows: [["PM", "John", "Approve reqs"]]
 * }
 * 
 * @param markdown The markdown content
 * @returns StructuredTable if a table is found, undefined otherwise
 */
export function parseMarkdownTable(markdown: string): StructuredTable | undefined {
    // Look for markdown table pattern with more flexible matching
    // Matches:
    // | Header 1 | Header 2 |
    // |----------|----------|
    // | Cell 1   | Cell 2   |

    const lines = markdown.split('\n');
    let headerIndex = -1;
    let separatorIndex = -1;

    // Find header row (must start with |)
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('|')) {
            headerIndex = i;
            // Check if next line is a separator
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                // Separator line should have pipes and dashes
                if (nextLine.includes('|') && nextLine.includes('-')) {
                    separatorIndex = i + 1;
                    break;
                }
            }
        }
    }

    if (headerIndex === -1 || separatorIndex === -1) {
        return undefined;
    }

    // Parse header row
    const headerLine = lines[headerIndex].trim();
    const headers = headerLine
        .split('|')
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0); // Remove empty cells from leading/trailing pipes

    if (headers.length === 0) {
        return undefined;
    }

    // Parse data rows (all lines after separator)
    const rows: string[][] = [];
    for (let i = separatorIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();

        // Stop if we hit a non-table line
        if (!line.startsWith('|')) {
            break;
        }

        const cells = line
            .split('|')
            .map(cell => cell.trim())
            .filter(cell => cell.length > 0); // Remove empty cells from leading/trailing pipes

        // Only add row if it has same number of columns as headers
        if (cells.length === headers.length) {
            rows.push(cells);
        }
    }

    // Return structured table if we have data
    if (headers.length > 0 && rows.length > 0) {
        return {
            headers,
            rows,
            columnWidths: undefined, // Will be auto-calculated
            title: ''
        };
    }

    return undefined;
}

/** Result of parsing a markdown table with its line range in the source */
export interface ParsedTableWithRange {
    table: StructuredTable;
    startLineIndex: number;
    endLineIndex: number;
}

/**
 * Parse the first markdown table in content and return it with start/end line indices.
 * Used to split section content into text + table segments so all content is rendered.
 */
function parseMarkdownTableWithRange(markdown: string): ParsedTableWithRange | undefined {
    const lines = markdown.split('\n');
    let headerIndex = -1;
    let separatorIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('|')) {
            headerIndex = i;
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                if (nextLine.includes('|') && nextLine.includes('-')) {
                    separatorIndex = i + 1;
                    break;
                }
            }
        }
    }

    if (headerIndex === -1 || separatorIndex === -1) return undefined;

    const headerLine = lines[headerIndex].trim();
    const headers = headerLine
        .split('|')
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0);
    if (headers.length === 0) return undefined;

    const rows: string[][] = [];
    let endLineIndex = separatorIndex;
    for (let i = separatorIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) break;
        const cells = line
            .split('|')
            .map(cell => cell.trim())
            .filter(cell => cell.length > 0);
        if (cells.length === headers.length) {
            rows.push(cells);
            endLineIndex = i;
        }
    }

    if (headers.length > 0 && rows.length > 0) {
        return {
            table: { headers, rows, columnWidths: undefined, title: '' },
            startLineIndex: headerIndex,
            endLineIndex,
        };
    }
    return undefined;
}

export type SectionContentSegment =
    | { type: 'text'; content: string }
    | { type: 'table'; table: StructuredTable };

/**
 * Split section content into alternating text and table segments so PDF renders
 * all content (paragraphs, lists, then tables) matching the UI preview.
 */
export function splitSectionContentIntoBlocks(markdown: string): SectionContentSegment[] {
    const segments: SectionContentSegment[] = [];
    let remaining = markdown;

    while (remaining.trim()) {
        const parsed = parseMarkdownTableWithRange(remaining);
        if (!parsed) {
            segments.push({ type: 'text', content: remaining });
            break;
        }
        const lines = remaining.split('\n');
        const textBefore = lines.slice(0, parsed.startLineIndex).join('\n').trim();
        if (textBefore) {
            segments.push({ type: 'text', content: textBefore });
        }
        segments.push({ type: 'table', table: parsed.table });
        remaining = lines.slice(parsed.endLineIndex + 1).join('\n');
    }

    return segments;
}

/**
 * Calculate column widths for table
 */
function calculateColumnWidths(
    columns: TableColumn[],
    availableWidth: number
): number[] {
    const totalSpecified = columns.reduce((sum, col) => sum + (col.width || 0), 0);

    if (totalSpecified > 0) {
        // Use specified widths
        return columns.map(col => {
            const ratio = (col.width || availableWidth / columns.length) / totalSpecified;
            return ratio * availableWidth;
        });
    }

    // Distribute equally
    return columns.map(() => availableWidth / columns.length);
}

/**
 * Draw a structured table using PDFKit primitives
 * 
 * This is the CORRECT way to render tables in PDFKit:
 * - Headers: array of column names
 * - Rows: array of row data (each row is array of cell values)
 * - Uses doc.rect() to draw cell borders
 * - Uses doc.text() at specific coordinates for cell content
 * - Handles text wrapping within column width
 * - Handles page breaks with header repetition
 * 
 * IMPROVEMENTS:
 * - Auto-calculates row height based on actual text wrapping
 * - Vertically centers text in cells
 * - Draws signature boxes (empty rectangles) in last column
 * - Light background color for header row
 * - Proper cell borders and padding
 * 
 * WHY THIS WORKS ON AZURE:
 * - Pure JavaScript, no HTML rendering
 * - No browser/Chromium needed
 * - Works in Node.js only runtime
 * - Direct PDF primitives (rectangles + text)
 * 
 * @param doc PDFKit document
 * @param table StructuredTable with headers, rows, and optional columnWidths
 * @param startY Y position to start drawing table
 * @param pageWidth A4 page width in points (595)
 * @returns Y position after table (for next content)
 */

/**
 * REUSABLE TABLE UTILITY FOR PDFKIT
 * 
 * This utility provides professional table rendering with:
 * - Fixed column widths based on page width
 * - Automatic row height calculation using doc.heightOfString()
 * - Manual border drawing with doc.rect()
 * - Proper text wrapping within column width
 * - Page break prevention (moves entire row to new page if needed)
 * - Bold headers with consistent padding
 * - No underscore placeholders - clean empty cells
 * - Professional styling with alternating row colors
 */

interface PDFTableOptions {
    doc: any; // PDFKit document
    headers: string[];
    rows: string[][];
    columnWidths?: number[]; // If not provided, distributed equally
    startY: number;
    pageWidth?: number;
    margin?: number;
    cellPadding?: number;
    headerBackgroundColor?: string;
    alternateRowColor?: string;
    borderColor?: string;
    fontSize?: number;
    headerFontSize?: number;
}

interface PDFTableResult {
    endY: number;
    rowsDrawn: number;
}

/**
 * Calculate optimal column widths
 * If columnWidths provided, use them; otherwise use proportional widths for
 * 2-column tables (e.g., Data Entity | Attributes) where the second column
 * typically has more content, or distribute equally for other cases.
 */
function calculateTableColumnWidths(
    columnCount: number,
    availableWidth: number,
    fixedWidths?: number[],
    headers?: string[]
): number[] {
    if (fixedWidths && fixedWidths.length === columnCount) {
        // Normalize fixed widths to available width
        const totalFixed = fixedWidths.reduce((a, b) => a + b, 0);
        if (totalFixed > 0) {
            return fixedWidths.map(w => (w / totalFixed) * availableWidth);
        }
    }

    // For 2-column tables like "Data Entity | Attributes", give 35% to first column
    // and 65% to second to prevent truncation of long attribute lists
    if (columnCount === 2 && headers) {
        const first = headers[0]?.toLowerCase() ?? '';
        const second = headers[1]?.toLowerCase() ?? '';
        const isLabelValueTable =
            first.includes('entity') || first.includes('role') || first.includes('item') ||
            second.includes('attribute') || second.includes('description') || second.includes('detail');
        if (isLabelValueTable) {
            return [availableWidth * 0.35, availableWidth * 0.65];
        }
    }

    // Distribute equally
    return Array(columnCount).fill(availableWidth / columnCount);
}

/**
 * Calculate the height a text will occupy in a cell
 * Uses PDFKit's heightOfString() for accurate measurement
 */
function calculateCellHeight(
    doc: any,
    text: string,
    cellWidth: number,
    cellPadding: number,
    fontSize: number
): number {
    if (!text || text.trim().length === 0) {
        return 20; // Minimum height for empty cell
    }

    doc.fontSize(fontSize);
    doc.font('LiberationSans');

    const textWidth = cellWidth - (2 * cellPadding);
    const height = doc.heightOfString(text, {
        width: textWidth,
        align: 'left'
    });

    return Math.max(20, height + (2 * cellPadding)); // Min 20 points
}

/**
 * Draw a single table cell with border and text
 */
function drawTableCell(
    doc: any,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    options: {
        fontSize: number;
        isBold: boolean;
        backgroundColor?: string;
        borderColor?: string;
        cellPadding: number;
    }
): void {
    // Draw cell background
    if (options.backgroundColor) {
        doc.rect(x, y, width, height).fill(options.backgroundColor);
    }

    // Draw cell border
    doc.strokeColor(options.borderColor || '#000000');
    doc.lineWidth(1);
    doc.rect(x, y, width, height).stroke();

    // Draw cell text
    doc.fillColor('#000000');
    doc.fontSize(options.fontSize);
    doc.font('LiberationSans');

    doc.text(text || '', x + options.cellPadding, y + options.cellPadding, {
        width: width - (2 * options.cellPadding),
        height: height - (2 * options.cellPadding),
        align: 'left',
        valign: 'top'
    });
}

/**
 * Draw a complete table with proper layout
 * 
 * @returns Object with endY position and number of rows drawn
 */
function drawPDFTable(options: PDFTableOptions): PDFTableResult {
    const {
        doc,
        headers,
        rows,
        startY,
        pageWidth = 595,
        margin = PAGE_MARGIN,
        cellPadding = 6,
        headerBackgroundColor = '#e0e0e0',
        alternateRowColor = '#f9f9f9',
        borderColor = '#333333',
        fontSize = 10,
        headerFontSize = 11
    } = options;

    const availableWidth = pageWidth - (2 * margin);
    const columnWidths = calculateTableColumnWidths(
        headers.length,
        availableWidth,
        options.columnWidths,
        headers
    );

    const pageHeight = doc.page.height;
    const bottomMargin = PAGE_MARGIN;
    let currentY = startY;
    let rowsDrawn = 0;

    // Calculate header height
    let headerHeight = 20;
    headers.forEach((header, idx) => {
        const cellHeight = calculateCellHeight(
            doc,
            header,
            columnWidths[idx],
            cellPadding,
            headerFontSize
        );
        headerHeight = Math.max(headerHeight, cellHeight);
    });

    // Draw header row
    if (currentY + headerHeight > pageHeight - bottomMargin) {
        doc.addPage();
        currentY = margin;
    }

    let cellX = margin;
    headers.forEach((header, idx) => {
        drawTableCell(doc, cellX, currentY, columnWidths[idx], headerHeight, header, {
            fontSize: headerFontSize,
            isBold: true,
            backgroundColor: headerBackgroundColor,
            borderColor,
            cellPadding
        });
        cellX += columnWidths[idx];
    });

    currentY += headerHeight;

    // Draw data rows
    rows.forEach((rowData, rowIndex) => {
        // Calculate row height based on tallest cell in this row
        let rowHeight = 20;
        rowData.forEach((cell, colIdx) => {
            const cellHeight = calculateCellHeight(
                doc,
                cell,
                columnWidths[colIdx],
                cellPadding,
                fontSize
            );
            rowHeight = Math.max(rowHeight, cellHeight);
        });

        // Check if row fits on current page, if not, start new page
        if (currentY + rowHeight > pageHeight - bottomMargin) {
            doc.addPage();
            currentY = margin;

            // Redraw header on new page
            cellX = margin;
            headers.forEach((header, idx) => {
                drawTableCell(doc, cellX, currentY, columnWidths[idx], headerHeight, header, {
                    fontSize: headerFontSize,
                    isBold: true,
                    backgroundColor: headerBackgroundColor,
                    borderColor,
                    cellPadding
                });
                cellX += columnWidths[idx];
            });

            currentY += headerHeight;
        }

        // Draw row cells
        cellX = margin;
        rowData.forEach((cell, colIdx) => {
            const bgColor = rowIndex % 2 === 0 ? alternateRowColor : undefined;
            drawTableCell(doc, cellX, currentY, columnWidths[colIdx], rowHeight, cell, {
                fontSize,
                isBold: false,
                backgroundColor: bgColor,
                borderColor,
                cellPadding
            });
            cellX += columnWidths[colIdx];
        });

        currentY += rowHeight;
        rowsDrawn++;
    });

    return {
        endY: currentY, // Return exact end position, caller adds spacing
        rowsDrawn
    };
}

/**
 * Draw a structured table using the new reusable utility
 * This replaces the old drawStructuredTable function
 * 
 * CRITICAL: Returns exact Y position after last table row
 * Caller MUST explicitly reset doc.y: doc.y = tableEndY + spacing
 * PDFKit does NOT auto-sync cursor with absolute positioning
 */
function drawStructuredTable(
    doc: any,
    table: StructuredTable,
    startY: number,
    pageWidth: number = 595
): number {
    const result = drawPDFTable({
        doc,
        headers: table.headers,
        rows: table.rows,
        columnWidths: table.columnWidths,
        startY,
        pageWidth,
        margin: PAGE_MARGIN,
        cellPadding: 6,
        headerBackgroundColor: '#e0e0e0',
        alternateRowColor: '#f9f9f9',
        borderColor: '#333333',
        fontSize: 10,
        headerFontSize: 11
    });

    return result.endY;
}

/**
 * Draw a legacy table using TableColumn interface
 * Uses the new reusable utility internally
 * 
 * CRITICAL: Returns exact Y position after last table row
 * Caller MUST explicitly reset doc.y: doc.y = tableEndY + spacing
 * PDFKit does NOT auto-sync cursor with absolute positioning
 */
function drawTable(
    doc: any,
    columns: TableColumn[],
    rows: TableRow[],
    startY: number,
    pageWidth: number = 595
): number {
    const availableWidth = pageWidth - (2 * PAGE_MARGIN);
    const columnWidths = calculateColumnWidths(columns, availableWidth);

    // Convert to string rows for new utility
    const headers = columns.map(col => col.label);
    const stringRows = rows.map(row =>
        columns.map(col => String(row[col.key] || ''))
    );

    const result = drawPDFTable({
        doc,
        headers,
        rows: stringRows,
        columnWidths,
        startY,
        pageWidth,
        margin: PAGE_MARGIN,
        cellPadding: 6,
        headerBackgroundColor: '#f0f0f0',
        alternateRowColor: '#fafafa',
        borderColor: '#000000',
        fontSize: 9,
        headerFontSize: 10
    });

    return result.endY;
}

/**
 * Render raw markdown content to PDF with proper text and table formatting
 * Uses consistent margins, proper text wrapping, and professional spacing
 * Mimics the DOCX export formatting for consistency
 * Strips markdown symbols and renders formatted text appropriately
 * 
 * @param doc - PDFKit document instance
 * @param markdown - Raw markdown content
 */
function renderMarkdownToPDF(
    doc: PDFKit.PDFDocument,
    markdown: string
): void {
    const lines = markdown.split('\n');
    let i = 0;
    
    // Page layout constants (matching A4)
    const PAGE_WIDTH = doc.page.width;      // 595 points
    const PAGE_HEIGHT = doc.page.height;    // 842 points
    const LEFT_MARGIN = 72;                 // 1 inch = 72 points
    const RIGHT_MARGIN = 72;
    const TOP_MARGIN = 72;
    const BOTTOM_MARGIN = 72;
    const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN; // ~451 points

    // Use current document position (don't reset to TOP_MARGIN)
    // This allows proper spacing when called after header information
    while (i < lines.length) {
        let line = lines[i];
        let trimmed = line.trim();

        // Check if we need a new page (leave 60 points for safety)
        if (doc.y > PAGE_HEIGHT - BOTTOM_MARGIN - 60) {
            doc.addPage();
            doc.x = LEFT_MARGIN;
            doc.y = TOP_MARGIN;
        }

        // Skip empty lines but preserve spacing
        if (!trimmed) {
            doc.moveDown(0.2);
            i++;
            continue;
        }

        // Handle markdown headings (H1, H2, H3, H4)
        if (trimmed.startsWith('# ')) {
            doc.x = LEFT_MARGIN;
            doc.fontSize(18).font('LiberationSans-Bold');
            doc.text(trimmed.substring(2), {
                width: CONTENT_WIDTH,
                align: 'left'
            });
            doc.moveDown(0.5);
            i++;
            continue;
        }

        if (trimmed.startsWith('## ')) {
            doc.x = LEFT_MARGIN;
            doc.fontSize(16).font('LiberationSans-Bold');
            doc.text(trimmed.substring(3), {
                width: CONTENT_WIDTH,
                align: 'left'
            });
            doc.moveDown(0.4);
            i++;
            continue;
        }

        if (trimmed.startsWith('### ')) {
            doc.x = LEFT_MARGIN;
            doc.fontSize(14).font('LiberationSans-Bold');
            doc.text(trimmed.substring(4), {
                width: CONTENT_WIDTH,
                align: 'left'
            });
            doc.moveDown(0.3);
            i++;
            continue;
        }

        if (trimmed.startsWith('#### ')) {
            doc.x = LEFT_MARGIN;
            doc.fontSize(12).font('LiberationSans-Bold');
            doc.text(trimmed.substring(5), {
                width: CONTENT_WIDTH,
                align: 'left'
            });
            doc.moveDown(0.3);
            i++;
            continue;
        }

        // Handle markdown tables (|...|)
        if (trimmed.startsWith('|')) {
            const tableLines = [];

            // Collect all consecutive table lines
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }

            if (tableLines.length >= 3) {
                try {
                    // Parse header row
                    const headerCells = tableLines[0]
                        .split('|')
                        .map(cell => cell.trim())
                        .filter(cell => cell && cell !== '');
                    
                    // Parse data rows (skip separator row at index 1)
                    const dataRows = tableLines
                        .slice(2)
                        .map(rowLine => {
                            const cells = rowLine
                                .split('|')
                                .map(cell => cell.trim())
                                .filter(cell => cell !== '');
                            // Ensure each row has the same number of columns as header
                            while (cells.length < headerCells.length) {
                                cells.push('');
                            }
                            return cells.slice(0, headerCells.length);
                        })
                        .filter(row => row.length === headerCells.length);

                    if (headerCells.length > 0 && dataRows.length > 0) {
                        // Check if we need a new page for the table
                        if (doc.y > PAGE_HEIGHT - BOTTOM_MARGIN - 150) {
                            doc.addPage();
                            doc.x = LEFT_MARGIN;
                            doc.y = TOP_MARGIN;
                        }

                        // Use the robust drawPDFTable function with smart column widths
                        const tableResult = drawPDFTable({
                            doc,
                            headers: headerCells,
                            rows: dataRows,
                            columnWidths: calculateTableColumnWidths(
                                headerCells.length,
                                CONTENT_WIDTH,
                                undefined,
                                headerCells
                            ),
                            startY: doc.y,
                            pageWidth: PAGE_WIDTH,
                            margin: LEFT_MARGIN,
                            cellPadding: 6,
                            headerBackgroundColor: '#e0e0e0',
                            alternateRowColor: '#f9f9f9',
                            borderColor: '#333333',
                            fontSize: 10,
                            headerFontSize: 11
                        });

                        // Move doc position after table with proper spacing
                        doc.y = tableResult.endY + 12;
                        continue;
                    }
                } catch (err) {
                    console.warn('[PDF] Failed to render markdown table:', err);
                    // Fallback: skip this table and continue
                    continue;
                }
            }
        }

        // Strip and handle inline markdown formatting
        // Remove bold, italic, code markers but keep the text
        trimmed = trimmed
            .replace(/\*\*\*(.*?)\*\*\*/g, '$1')  // ***text*** -> text
            .replace(/\*\*(.*?)\*\*/g, '$1')      // **text** -> text
            .replace(/\*(.*?)\*/g, '$1')          // *text* -> text
            .replace(/__(.*?)__/g, '$1')          // __text__ -> text
            .replace(/_(.*?)_/g, '$1')            // _text_ -> text
            .replace(/`(.*?)`/g, '$1');           // `text` -> text

        // Handle bullet points (-, *)
        if (line.trim().match(/^[\s]*[-*]\s/)) {
            doc.x = LEFT_MARGIN + 18;  // Indent bullets
            doc.fontSize(11).font('LiberationSans');
            const bulletText = line.trim().replace(/^[-*]\s/, '');
            doc.text('• ' + bulletText, {
                width: CONTENT_WIDTH - 18,
                align: 'left'
            });
            doc.moveDown(0.25);
            i++;
            continue;
        }

        // Handle numbered lists (1., 2., etc.)
        if (/^\s*\d+\.\s/.test(line)) {
            doc.x = LEFT_MARGIN + 18;  // Indent numbers
            doc.fontSize(11).font('LiberationSans');
            doc.text(trimmed, {
                width: CONTENT_WIDTH - 18,
                align: 'left'
            });
            doc.moveDown(0.25);
            i++;
            continue;
        }

        // Regular paragraph text
        doc.x = LEFT_MARGIN;
        doc.fontSize(11).font('LiberationSans');
        doc.text(trimmed, {
            width: CONTENT_WIDTH,
            align: 'left'
        });
        doc.moveDown(0.35);
        i++;
    }
}

/**
 * Generate PDF as a buffer using PDFKit
 * This function creates a PDF document in memory and returns it as a Buffer
 *
 * @param options PDF generation options (title, version, sections, tables, images)
 * @returns Promise<Buffer> containing the PDF binary data
 * @throws Error if validation fails or generation encounters issues
 */
export async function generatePDFBuffer(
    options: PDFGenerationOptions
): Promise<Buffer> {
    // Validate all input parameters before processing
    validatePDFOptions(options);

    return new Promise((resolve, reject) => {
        try {
            // Initialize fonts before creating document
            // This ensures custom fonts are available for all text operations
            const doc = new PDFDocument({
                size: 'A4',
                margin: PAGE_MARGIN,
                bufferPages: true,
            });

            // Register custom fonts immediately after document creation
            initializeFonts(doc);

            const chunks: Buffer[] = [];

            // Capture PDF output
            doc.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                resolve(pdfBuffer);
            });

            doc.on('error', (err: any) => {
                reject(new Error(`PDF generation error: ${err.message}`));
            });

            // Document title and version - ensure left margin and conservative width
            const contentWidth = doc.page.width - 2 * PAGE_MARGIN - TEXT_WIDTH_BUFFER;

            // Brand logo (ASTRA) above the title. Rendered gracefully — a missing
            // asset never blocks PDF generation.
            try {
                const logoBuffer = getLogoBuffer();
                if (logoBuffer) {
                    const LOGO_WIDTH = 130; // points
                    const LOGO_ASPECT = 121 / 752; // height / width of the asset
                    const logoTop = doc.y;
                    // Absolute placement does not advance the text cursor, so
                    // restore doc.y manually below the rendered logo.
                    doc.image(logoBuffer, PAGE_MARGIN, logoTop, { width: LOGO_WIDTH });
                    doc.y = logoTop + LOGO_WIDTH * LOGO_ASPECT + 16;
                }
            } catch (logoError) {
                console.error('[PDF] Failed to render brand logo:', logoError);
            }

            doc.x = PAGE_MARGIN;
            doc.fontSize(24).font('LiberationSans-Bold');
            doc.text(options.title, { width: contentWidth, align: 'left' });
            doc.fontSize(11).font('LiberationSans');
            (doc as any).fillColor('#666666');
            doc.text(`Version: ${options.version}`, { width: contentWidth, align: 'left' });
            (doc as any).fillColor('black');
            doc.moveDown(2);  // Add extra space between header and content

            // Use raw markdown if provided (ensures complete content with all tables and formatting)
            // Otherwise fall back to parsed sections
            if (options.rawMarkdown && options.rawMarkdown.trim()) {
                // Strip any title from the markdown since we're rendering it explicitly in the header
                let cleanMarkdown = options.rawMarkdown;
                const lines = cleanMarkdown.split('\n');
                let startIndex = 0;

                // Skip the first H1 heading if it exists (we're rendering title separately)
                for (let i = 0; i < lines.length; i++) {
                    const trimmed = lines[i].trim();
                    if (!trimmed) continue;

                    // Found H1 heading - skip it
                    if (trimmed.match(/^#\s+(.+)$/)) {
                        startIndex = i + 1;
                        break;
                    }

                    // Not a heading, stop looking
                    break;
                }

                // Skip empty lines and version lines after title
                while (startIndex < lines.length) {
                    const trimmed = lines[startIndex].trim();
                    if (!trimmed || trimmed.match(/^version\s*:/i) || trimmed.match(/^\*\*version\*\*/i)) {
                        startIndex++;
                    } else {
                        break;
                    }
                }

                cleanMarkdown = lines.slice(startIndex).join('\n').trim();

                // Render raw markdown directly (preserves all tables, formatting, and content)
                if (cleanMarkdown) {
                    renderMarkdownToPDF(doc, cleanMarkdown);
                }
            } else if (options.sections && options.sections.length > 0) {
                // Add sections as fallback
                options.sections.forEach((section) => {
                    // Check if we need a new page
                    if (doc.y > doc.page.height - 150) {
                        doc.addPage();
                    }

                    // Section title - reset x to left margin for proper alignment
                    doc.x = PAGE_MARGIN;
                    doc.fontSize(14).font('LiberationSans-Bold');
                    doc.text(section.title, { width: contentWidth, align: 'left' });
                    doc.moveDown(0.5);

                    // Split content into text and table segments so all content is rendered (matches UI preview)
                    const blocks = splitSectionContentIntoBlocks(section.content);

                    for (const block of blocks) {
                        if (block.type === 'text') {
                            const plainText = markdownToText(block.content);
                            if (!plainText.trim()) continue;
                            doc.x = PAGE_MARGIN;
                            doc.fontSize(11).font('LiberationSans');
                            doc.text(plainText, {
                                width: contentWidth,
                                align: 'left',
                            });
                            doc.moveDown(1);
                        } else {
                            if (doc.y > doc.page.height - 200) {
                                doc.addPage();
                            }
                            const tableEndY = drawStructuredTable(doc, block.table, doc.y);
                            doc.y = tableEndY + 35;
                            doc.x = PAGE_MARGIN;
                            doc.text('', { width: contentWidth, align: 'left', continued: false });
                            doc.moveDown(2);
                        }
                    }
                });
            }

            // Add tables if provided
            if (options.tables && options.tables.length > 0) {
                options.tables.forEach((table) => {
                    // Check if we need a new page
                    if (doc.y > doc.page.height - 200) {
                        doc.addPage();
                    }

                    // Table title
                    doc.x = PAGE_MARGIN;
                    doc.fontSize(12).font('LiberationSans-Bold');
                    doc.text(table.title, { width: contentWidth, align: 'left' });
                    doc.moveDown(0.5);

                    // Draw table
                    const tableEndY = drawTable(
                        doc,
                        table.columns,
                        table.rows,
                        doc.y,
                        doc.page.width
                    );
                    // CRITICAL: Explicitly reset doc.y to table end + generous spacing
                    // PDFKit does NOT auto-sync cursor with absolute positioning
                    doc.y = tableEndY + 35; // Spacing after table so next section/title aligns properly

                    // CRITICAL: Reset text state to prevent width/align constraints from leaking
                    doc.x = PAGE_MARGIN;
                    doc.text('', { width: contentWidth, align: 'left', continued: false });

                    // New line / vertical space after data table for proper alignment
                    doc.moveDown(2);
                });
            }

            // Add approval matrix if provided
            // This renders a structured table with fixed column widths
            if (options.approvalMatrix) {
                // Check if we need a new page
                if (doc.y > doc.page.height - 200) {
                    doc.addPage();
                }

                // Table title
                doc.x = PAGE_MARGIN;
                doc.fontSize(12).font('LiberationSans-Bold');
                doc.text(options.approvalMatrix.title || 'Approval Matrix', { width: contentWidth, align: 'left' });
                doc.moveDown(0.5);

                // Draw structured table with fixed widths
                const tableEndY = drawStructuredTable(doc, options.approvalMatrix, doc.y);
                // CRITICAL: Explicitly reset doc.y to table end + generous spacing
                doc.y = tableEndY + 35; // Spacing after table so next section aligns properly
                doc.x = PAGE_MARGIN;
                doc.text('', { width: contentWidth, align: 'left', continued: false });
                doc.moveDown(2);
            }

            // Add images if provided
            if (options.images && options.images.length > 0) {
                options.images.forEach((image) => {
                    // Check if we need a new page
                    if (doc.y > doc.page.height - 300) {
                        doc.addPage();
                    }

                    // Image title
                    doc.x = PAGE_MARGIN;
                    doc.fontSize(12).font('LiberationSans-Bold');
                    doc.text(image.label, { width: contentWidth, align: 'left' });
                    doc.moveDown(0.5);

                    try {
                        // Decode base64 image
                        const imageBuffer = Buffer.from(image.imageBase64, 'base64');
                        const imageType = image.imageType || 'png';

                        // Add image to PDF
                        doc.image(imageBuffer, {
                            fit: [500, 300],
                            align: 'center',
                        });

                        doc.moveDown(0.5);
                    } catch (error) {
                        console.error(`[PDF] Failed to add image "${image.label}":`, error);
                        doc.fontSize(10).fillColor('#ff0000');
                        doc.text(`[Image failed to load: ${image.label}]`, { width: contentWidth, align: 'left' });
                        doc.moveDown(0.5);
                    }
                });
            }

            // Finalize PDF
            doc.end();
        } catch (error) {
            reject(
                new Error(
                    `PDF generation failed: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    });
}

/**
 * Generate PDF and return as a stream
 * Useful for streaming directly to response without buffering entire PDF in memory
 */
export function generatePDFStream(
    options: PDFGenerationOptions
): Readable {
    const doc = new PDFDocument({
        size: 'A4',
        margin: PAGE_MARGIN,
        bufferPages: true,
    });

    // Register custom fonts immediately after document creation
    initializeFonts(doc);

    // Set up stream to pipe to (will be returned to caller)
    const stream = doc as any as Readable;

    // Handle errors
    doc.on('error', (err: any) => {
        console.error('[PDF Stream] Generation error:', err);
    });

    // Document title and version - ensure left margin and conservative width
    const contentWidth = doc.page.width - 2 * PAGE_MARGIN - TEXT_WIDTH_BUFFER;
    doc.x = PAGE_MARGIN;
    doc.fontSize(24).font('LiberationSans-Bold');
    doc.text(options.title, { width: contentWidth, align: 'left' });
    doc.fontSize(11).font('LiberationSans');
    (doc as any).fillColor('#666666');
    doc.text(`Version: ${options.version}`, { width: contentWidth, align: 'left' });
    (doc as any).fillColor('black');
    doc.moveDown(1);

    // Add sections
    if (options.sections && options.sections.length > 0) {
        options.sections.forEach((section) => {
            // Check if we need a new page
            if (doc.y > doc.page.height - 150) {
                doc.addPage();
            }

            // Section title
            doc.x = PAGE_MARGIN;
            doc.fontSize(14).font('LiberationSans-Bold');
            doc.text(section.title, { width: contentWidth, align: 'left' });
            doc.moveDown(0.5);

            // Split content into text and table segments (matches UI preview)
            const blocks = splitSectionContentIntoBlocks(section.content);

            for (const block of blocks) {
                if (block.type === 'text') {
                    const plainText = markdownToText(block.content);
                    if (!plainText.trim()) continue;
                    doc.x = PAGE_MARGIN;
                    doc.fontSize(11).font('LiberationSans');
                    doc.text(plainText, {
                        width: contentWidth,
                        align: 'left',
                    });
                    doc.moveDown(1);
                } else {
                    if (doc.y > doc.page.height - 200) {
                        doc.addPage();
                    }
                    const tableEndY = drawStructuredTable(doc, block.table, doc.y);
                    doc.y = tableEndY + 35;
                    doc.x = PAGE_MARGIN;
                    doc.text('', { width: contentWidth, align: 'left', continued: false });
                    doc.moveDown(2);
                }
            }
        });
    }

    // Add tables
    if (options.tables && options.tables.length > 0) {
        options.tables.forEach((table) => {
            if (doc.y > doc.page.height - 200) {
                doc.addPage();
            }

            doc.fontSize(12).font('LiberationSans-Bold');
            doc.text(table.title, { width: doc.page.width - 2 * PAGE_MARGIN, align: 'left' });
            doc.moveDown(0.5);

            const tableEndY = drawTable(
                doc,
                table.columns,
                table.rows,
                doc.y,
                doc.page.width
            );
            // CRITICAL: Explicitly reset doc.y to table end + generous spacing
            // PDFKit does NOT auto-sync cursor with absolute positioning
            doc.y = tableEndY + 35;
            doc.x = PAGE_MARGIN;
            doc.text('', { width: contentWidth, align: 'left', continued: false });
            doc.moveDown(2);
        });
    }

    // End document
    doc.end();

    return stream;
}

/**
 * Create a safe filename from title and version
 */
export function createSafeFilename(
    title: string,
    version: string,
    ext: string
): string {
    const safeTitle = title
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
    return `BRD-${safeTitle}-${version}.${ext}`;
}
