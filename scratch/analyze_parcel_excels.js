const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

function parseDateFromFilename(filename) {
    // Examples: '1-10-26.xlsx', '11-9-26.xlsx', '30-9-26 (1).xlsx', '5-9-26 2.xlsx', '5-9-26.xlsx1.xlsx'
    const clean = filename.replace(/\s*\(\d+\)/g, '').replace(/\s+\d+/g, '').replace(/\.xlsx.*$/i, '');
    const parts = clean.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        return new Date(year, month - 1, day);
    }
    return null;
}

async function run() {
    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    console.log(`Analyzing ${files.length} files...\n`);

    const summary = [];

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const d = parseDateFromFilename(file);
        const stat = fs.statSync(filePath);
        
        let rowCount = 0;
        let barcodes = [];
        let names = [];

        try {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(filePath);
            const sheet = workbook.worksheets[0];
            
            // Find header columns
            const headerRow = sheet.getRow(1);
            let barcodeCol = 2;
            let nameCol = 19;
            
            headerRow.eachCell((cell, colNum) => {
                const val = String(cell.value || '').toUpperCase();
                if (val.includes('BARCODE')) barcodeCol = colNum;
                if (val.includes('RECEIVER NAME')) nameCol = colNum;
            });

            for (let r = 2; r <= sheet.rowCount; r++) {
                const row = sheet.getRow(r);
                const barcode = String(row.getCell(barcodeCol).value || '').trim();
                const name = String(row.getCell(nameCol).value || '').trim();
                if (barcode && barcode !== 'null' && barcode !== 'undefined') {
                    barcodes.push(barcode);
                    names.push(name);
                }
            }
            rowCount = barcodes.length;
        } catch(e) {
            console.error(`Error reading ${file}:`, e.message);
        }

        summary.push({
            file,
            date: d ? d.toISOString().split('T')[0] : 'UNKNOWN',
            sizeBytes: stat.size,
            rowCount,
            sampleBarcode: barcodes[0],
            sampleName: names[0]
        });
    }

    summary.sort((a, b) => (a.date > b.date ? 1 : -1));
    console.table(summary);
}

run().catch(console.error);
