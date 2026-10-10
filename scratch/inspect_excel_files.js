const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

async function inspect() {
    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    console.log(`Found ${files.length} Excel files in ${parcelDir}`);

    for (const file of files.slice(0, 3)) {
        console.log(`\n=================== FILE: ${file} ===================`);
        const filePath = path.join(parcelDir, file);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        
        console.log(`Worksheets: ${workbook.worksheets.map(w => w.name).join(', ')}`);
        const worksheet = workbook.worksheets[0];
        console.log(`Total rows in ${worksheet.name}: ${worksheet.rowCount}`);
        
        // Print first 5 rows
        for (let r = 1; r <= Math.min(6, worksheet.rowCount); r++) {
            const rowValues = worksheet.getRow(r).values;
            console.log(`Row ${r}:`, JSON.stringify(rowValues));
        }
    }
}

inspect().catch(console.error);
