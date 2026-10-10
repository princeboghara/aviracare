const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

function getCellValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    let val = cell.value;
    if (typeof val === 'object') {
        if (val.result !== undefined && val.result !== null) val = val.result;
        else if (val.text !== undefined && val.text !== null) val = val.text;
        else if (Array.isArray(val.richText)) val = val.richText.map(t => t.text).join('');
    }
    return String(val || '').trim();
}

async function inspect() {
    // 1. Get current 63 pending entries
    const { rows: pending } = await pool.query('SELECT * FROM pending_entries ORDER BY id ASC');
    console.log(`Current Pending Entries count: ${pending.length}`);

    // 2. Get all barcodes already in main_database
    const { rows: mainRows } = await pool.query('SELECT UPPER(tracking) as tracking FROM main_database WHERE tracking IS NOT NULL AND tracking != \'\'');
    const inMainDb = new Set(mainRows.map(r => r.tracking));
    console.log(`Master DB barcodes: ${inMainDb.size}`);

    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    
    // Collect all unassigned Excel rows across ALL files
    const unassignedExcelRows = [];

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(filePath);
        const sheet = wb.worksheets[0];
        const headerRow = sheet.getRow(1);

        let barcodeCol = -1, nameCol = -1, cityCol = -1, stateCol = -1, pinCol = -1, mobCol = -1, addCol = -1;
        let weightCol = -1, lCol = -1, bCol = -1, hCol = -1;

        headerRow.eachCell((cell, colNum) => {
            const v = getCellValue(cell).toUpperCase();
            if (v.includes('BARCODE')) barcodeCol = colNum;
            if (v.includes('RECEIVER NAME')) nameCol = colNum;
            if (v.includes('RECEIVER CITY') || (cityCol === -1 && v.includes('CITY'))) cityCol = colNum;
            if (v.includes('RECEIVER STATE') || (stateCol === -1 && v.includes('STATE'))) stateCol = colNum;
            if (v.includes('RECEIVER PINCODE') || (pinCol === -1 && (v.includes('PINCODE') || v.includes('PIN')))) pinCol = colNum;
            if (v.includes('RECEIVER MOBILE') || (mobCol === -1 && (v.includes('MOBILE') || v.includes('PHONE')))) mobCol = colNum;
            if (v.includes('RECEIVER ADD LINE 1') || (addCol === -1 && v.includes('ADD LINE 1'))) addCol = colNum;
            if (v.includes('PHYSICAL WEIGHT') || (weightCol === -1 && v.includes('WEIGHT'))) weightCol = colNum;
            if (v.includes('LENGTH')) lCol = colNum;
            if (v.includes('BREADTH')) bCol = colNum;
            if (v.includes('HEIGHT')) hCol = colNum;
        });

        // Fallback default column indices if headers weren't found
        if (barcodeCol === -1) barcodeCol = 2;
        if (nameCol === -1) nameCol = 19;

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = getCellValue(row.getCell(barcodeCol)).toUpperCase();
            const name = getCellValue(row.getCell(nameCol));
            const city = cityCol !== -1 ? getCellValue(row.getCell(cityCol)) : '';
            const state = stateCol !== -1 ? getCellValue(row.getCell(stateCol)) : '';
            const pincode = pinCol !== -1 ? getCellValue(row.getCell(pinCol)) : '';
            const mobile = mobCol !== -1 ? getCellValue(row.getCell(mobCol)) : '';
            const address = addCol !== -1 ? getCellValue(row.getCell(addCol)) : '';
            const weight = weightCol !== -1 ? parseFloat(getCellValue(row.getCell(weightCol))) : null;
            const length = lCol !== -1 ? parseFloat(getCellValue(row.getCell(lCol))) : null;
            const breadth = bCol !== -1 ? parseFloat(getCellValue(row.getCell(bCol))) : null;
            const height = hCol !== -1 ? parseFloat(getCellValue(row.getCell(hCol))) : null;

            if (!barcode || !barcode.startsWith('CG')) continue;

            if (!inMainDb.has(barcode)) {
                unassignedExcelRows.push({
                    file,
                    rowNum: r,
                    barcode,
                    name,
                    city,
                    state,
                    pincode,
                    mobile,
                    address,
                    weight,
                    length,
                    breadth,
                    height
                });
            }
        }
    }

    // Dedup by barcode
    const uniqueUnassignedExcel = [];
    const seen = new Set();
    for (const item of unassignedExcelRows) {
        if (!seen.has(item.barcode)) {
            seen.add(item.barcode);
            uniqueUnassignedExcel.push(item);
        }
    }

    console.log(`Total unique unassigned Excel parcels: ${uniqueUnassignedExcel.length}`);
    console.log('\n--- ALL UNASSIGNED EXCEL ROWS ---');
    console.table(uniqueUnassignedExcel.map(u => ({
        file: u.file,
        barcode: u.barcode,
        name: u.name,
        city: u.city,
        pin: u.pincode,
        mob: u.mobile
    })));

    console.log('\n--- ALL REMAINING PENDING ENTRIES ---');
    console.table(pending.map(p => ({
        id: p.id,
        member: p.member_id,
        name: p.name,
        orderDate: p.order_date
    })));

    await pool.end();
}

inspect().catch(console.error);
