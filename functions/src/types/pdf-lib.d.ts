declare module "pdf-lib" {
    export type RGB = { r: number; g: number; b: number };

    export function rgb(r: number, g: number, b: number): RGB;

    export interface PDFFont {
        widthOfTextAtSize(text: string, size: number): number;
    }

    export interface DrawTextOptions {
        x?: number;
        y?: number;
        size?: number;
        font?: PDFFont;
        color?: RGB;
    }

    export interface DrawRectangleOptions {
        x?: number;
        y?: number;
        width: number;
        height: number;
        color?: RGB;
        borderColor?: RGB;
        borderWidth?: number;
    }

    export interface DrawLineOptions {
        start: { x: number; y: number };
        end: { x: number; y: number };
        color?: RGB;
        thickness?: number;
    }

    export interface PDFPageSize {
        width: number;
        height: number;
    }

    export interface PDFImage {
        width: number;
        height: number;
    }

    export interface DrawImageOptions {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    }

    /** Represents a page within a PDF document. */
    export class PDFPage {
      getSize(): PDFPageSize;
      drawText(text: string, options?: DrawTextOptions): void;
      drawRectangle(options: DrawRectangleOptions): void;
      drawLine(options: DrawLineOptions): void;
      drawImage(image: PDFImage, options?: DrawImageOptions): void;
    }

    /** Factory and mutator methods for building PDF documents. */
    export class PDFDocument {
      static create(): Promise<PDFDocument>;
      addPage(size?: [number, number]): PDFPage;
      embedFont(font: string): Promise<PDFFont>;
      embedPng(png: Uint8Array | ArrayBuffer | Buffer): Promise<PDFImage>;
      embedJpg(jpg: Uint8Array | ArrayBuffer | Buffer): Promise<PDFImage>;
      save(): Promise<Uint8Array>;
    }

    export const StandardFonts: {
        Helvetica: string;
        HelveticaBold: string;
        [key: string]: string;
    };
}

