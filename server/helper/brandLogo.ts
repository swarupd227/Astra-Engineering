/**
 * Brand logo resolution for generated documents (BRD PDF / DOCX).
 *
 * The ASTRA logo lives in `server/assets/branding/` which is copied to
 * `dist/server/assets/` during the build (see package.json build script),
 * so the same Azure-safe path detection used for fonts applies here.
 */

import * as path from 'path';
import * as fs from 'fs';

const LOGO_FILENAME = 'astra-logo.png';

/**
 * Resolve the branding asset directory with Azure-safe path detection.
 * Mirrors the strategy used for PDF fonts so the logo is found both in
 * local development and in the bundled `dist/` deployment on Azure.
 *
 * @returns Absolute path to the logo file, or null if it cannot be located.
 */
export function resolveLogoPath(): string | null {
    const candidates = [
        // Azure production paths
        '/home/site/wwwroot/server/assets/branding',
        '/home/site/wwwroot/dist/server/assets/branding',
        // Local development paths
        path.join(process.cwd(), 'server', 'assets', 'branding'),
        path.join(process.cwd(), 'dist', 'server', 'assets', 'branding'),
    ];

    for (const dir of candidates) {
        const candidate = path.join(dir, LOGO_FILENAME);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Read the brand logo as a Buffer (for PDFKit `doc.image()`).
 *
 * @returns The logo image buffer, or null if the asset is missing.
 */
export function getLogoBuffer(): Buffer | null {
    const logoPath = resolveLogoPath();
    if (!logoPath) return null;
    try {
        return fs.readFileSync(logoPath);
    } catch {
        return null;
    }
}

/**
 * Read the brand logo as a base64 `data:` URI (for embedding in HTML → DOCX).
 *
 * @returns A data URI string, or null if the asset is missing.
 */
export function getLogoDataUri(): string | null {
    const buffer = getLogoBuffer();
    if (!buffer) return null;
    return `data:image/png;base64,${buffer.toString('base64')}`;
}
