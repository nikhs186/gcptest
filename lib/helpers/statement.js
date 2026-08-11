"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWalletStatementPdf = void 0;
const pdf_lib_1 = require("pdf-lib");
const logo_1 = require("./logo");
/**
 * Generates a wallet statement PDF using the supplied data and returns
 * the document as a base64-encoded string for easy transport/storage.
 *
 * @param {StatementData} data Structured dealership and transaction information to render.
 * @return {Promise<string>} Base64-encoded PDF document.
 */
const generateWalletStatementPdf = async (data) => {
    try {
        const pdfDoc = await pdf_lib_1.PDFDocument.create();
        const createPage = () => {
            const newPage = pdfDoc.addPage([595.28, 841.89]); // A4 portrait.
            const size = newPage.getSize();
            return { page: newPage, size };
        };
        let { page: currentPage, size: currentSize } = createPage();
        let { width, height } = currentSize;
        const titleFont = await pdfDoc.embedFont(pdf_lib_1.StandardFonts.TimesRomanBold);
        const bodyFont = await pdfDoc.embedFont(pdf_lib_1.StandardFonts.TimesRoman);
        const titleSize = 26;
        const bodySize = 11;
        const headerSize = 12.5;
        const marginY = 64;
        const cellPadding = 8;
        const verticalPadding = 6;
        const lineSpacing = 3;
        const lineColor = (0, pdf_lib_1.rgb)(0.75, 0.76, 0.8);
        let cursorY = height - marginY;
        const columnConfig = [
            { label: "Dato", width: 70, align: "center" },
            { label: "Detaljer", width: 224, align: "left" },
            { label: "Beløp", width: 82, align: "right" },
            { label: "DR/CR", width: 60, align: "center" },
            { label: "Saldo", width: 82, align: "right" },
        ];
        const tableWidth = columnConfig.reduce((sum, column) => sum + column.width, 0);
        let tableLeftX = Math.max(52, (width - tableWidth) / 2);
        const titleText = data.heading;
        const titleWidth = titleFont.widthOfTextAtSize(titleText, titleSize);
        const logoBytes = Buffer.from(logo_1.DEALERSHIP_LOGO_BASE64, "base64");
        const logo = await pdfDoc.embedPng(logoBytes);
        const logoDisplayWidth = 70; // Reduced by 50% from 140
        const logoDisplayHeight = (logo.height / logo.width) * logoDisplayWidth;
        currentPage.drawImage(logo, {
            x: (width - logoDisplayWidth) / 2,
            y: cursorY - logoDisplayHeight,
            width: logoDisplayWidth,
            height: logoDisplayHeight,
        });
        cursorY -= logoDisplayHeight + 36;
        currentPage.drawText(titleText, {
            x: (width - titleWidth) / 2,
            y: cursorY,
            size: titleSize,
            font: titleFont,
            color: (0, pdf_lib_1.rgb)(0.12, 0.12, 0.18),
        });
        cursorY -= titleSize + 12;
        currentPage.drawText(`Forhandler: ${data.dealership.name}`, {
            x: tableLeftX,
            y: cursorY,
            size: 12,
            font: bodyFont,
            color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.23),
        });
        cursorY -= 16;
        currentPage.drawText(`E-post: ${data.dealership.email}`, {
            x: tableLeftX,
            y: cursorY,
            size: 11,
            font: bodyFont,
            color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.23),
        });
        cursorY -= 20;
        const drawHorizontalLine = (y) => {
            currentPage.drawLine({
                start: { x: tableLeftX, y },
                end: { x: tableLeftX + tableWidth, y },
                color: lineColor,
                thickness: 0.75,
            });
        };
        const drawVerticalLines = (topY, bottomY) => {
            let x = tableLeftX;
            currentPage.drawLine({
                start: { x, y: topY },
                end: { x, y: bottomY },
                color: lineColor,
                thickness: 0.75,
            });
            for (const column of columnConfig) {
                x += column.width;
                currentPage.drawLine({
                    start: { x, y: topY },
                    end: { x, y: bottomY },
                    color: lineColor,
                    thickness: 0.75,
                });
            }
        };
        const wrapText = (text, font, size, maxWidth) => {
            const words = text.split(/\s+/);
            const lines = [];
            let currentLine = "";
            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const testWidth = font.widthOfTextAtSize(testLine, size);
                if (testWidth <= maxWidth || !currentLine) {
                    currentLine = testLine;
                }
                else {
                    lines.push(currentLine);
                    currentLine = word;
                }
            }
            if (currentLine) {
                lines.push(currentLine);
            }
            return lines.length ? lines : [""];
        };
        const measureRow = (values, options) => {
            const font = (options === null || options === void 0 ? void 0 : options.bold) ? titleFont : bodyFont;
            const size = (options === null || options === void 0 ? void 0 : options.bold) ? headerSize : bodySize;
            const columnLines = values.map((value, index) => {
                const column = columnConfig[index];
                const maxLineWidth = column.width - 2 * cellPadding;
                return wrapText(value, font, size, Math.max(maxLineWidth, size));
            });
            const maxLines = columnLines.reduce((max, lines) => Math.max(max, lines.length), 1);
            const rowHeight = maxLines * size + (maxLines - 1) * lineSpacing + 2 * verticalPadding;
            return { columnLines, font, size, rowHeight };
        };
        const renderMeasuredRow = (metrics) => {
            const { columnLines, font, size, rowHeight } = metrics;
            const rowBottomY = cursorY - rowHeight;
            let xCursor = tableLeftX;
            columnLines.forEach((lines, index) => {
                const column = columnConfig[index];
                lines.forEach((line, lineIndex) => {
                    const textWidth = font.widthOfTextAtSize(line, size);
                    let textX = xCursor + cellPadding;
                    if (column.align === "center") {
                        textX = xCursor + (column.width - textWidth) / 2;
                    }
                    else if (column.align === "right") {
                        textX = xCursor + column.width - textWidth - cellPadding;
                    }
                    const textY = cursorY - verticalPadding - size - lineIndex * (size + lineSpacing);
                    currentPage.drawText(line, {
                        x: textX,
                        y: textY,
                        size,
                        font,
                        color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.23),
                    });
                });
                xCursor += column.width;
            });
            drawHorizontalLine(rowBottomY);
            cursorY = rowBottomY;
        };
        const items = data.transactions.items;
        if (items.length === 0) {
            cursorY -= bodySize + verticalPadding * 2;
            currentPage.drawText("No transactions for this period.", {
                x: tableLeftX,
                y: cursorY,
                size: bodySize,
                font: bodyFont,
                color: (0, pdf_lib_1.rgb)(0.3, 0.3, 0.35),
            });
        }
        else {
            let pageTableTopY = cursorY;
            const headerValues = columnConfig.map((column) => column.label);
            const renderTableHeader = () => {
                tableLeftX = Math.max(52, (width - tableWidth) / 2);
                pageTableTopY = cursorY;
                drawHorizontalLine(cursorY);
                const headerMetrics = measureRow(headerValues, { bold: true });
                renderMeasuredRow(headerMetrics);
            };
            const startNewPage = () => {
                const next = createPage();
                currentPage = next.page;
                const nextSize = next.size;
                width = nextSize.width;
                height = nextSize.height;
                cursorY = height - marginY;
                renderTableHeader();
            };
            renderTableHeader();
            items.forEach((transaction, index) => {
                var _a;
                const rowValues = [
                    transaction.date,
                    transaction.details,
                    transaction.amount,
                    transaction.type,
                    (_a = transaction.balance) !== null && _a !== void 0 ? _a : "",
                ];
                let rowMetrics = measureRow(rowValues);
                if (cursorY - rowMetrics.rowHeight < marginY) {
                    drawVerticalLines(pageTableTopY, cursorY);
                    startNewPage();
                    rowMetrics = measureRow(rowValues);
                }
                renderMeasuredRow(rowMetrics);
                const isLastItem = index === items.length - 1;
                if (isLastItem) {
                    drawVerticalLines(pageTableTopY, cursorY);
                }
            });
            const minimumSpaceForTotals = headerSize * 2 + bodySize + verticalPadding * 2 + lineSpacing + 20;
            if (cursorY - minimumSpaceForTotals <= marginY) {
                const next = createPage();
                currentPage = next.page;
                const nextSize = next.size;
                width = nextSize.width;
                height = nextSize.height;
                cursorY = height - marginY;
                tableLeftX = Math.max(52, (width - tableWidth) / 2);
            }
            const totalDebits = data.transactions.total_debit;
            const openingBalance = data.transactions.opening_balance;
            const closingBalance = data.transactions.closing_balance;
            cursorY -= bodySize + verticalPadding * 2 + lineSpacing;
            currentPage.drawText(`Åpningssaldo: ${openingBalance}`, {
                x: tableLeftX,
                y: cursorY,
                size: headerSize,
                font: titleFont,
            });
            cursorY -= headerSize + 8;
            currentPage.drawText(`Lisi poeng brukt: ${totalDebits}`, {
                x: tableLeftX,
                y: cursorY,
                size: headerSize,
                font: titleFont,
            });
            cursorY -= headerSize + 8;
            currentPage.drawText(`Sluttsaldo: ${closingBalance}`, {
                x: tableLeftX,
                y: cursorY,
                size: headerSize,
                font: titleFont,
            });
        }
        const pdfBytes = await pdfDoc.save();
        return Buffer.from(pdfBytes).toString("base64");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to generate wallet statement PDF: ${message}`);
    }
};
exports.generateWalletStatementPdf = generateWalletStatementPdf;
//# sourceMappingURL=statement.js.map