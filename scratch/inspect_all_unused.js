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

async function run() {
    const { rows: mainDb } = await pool.query('SELECT UPPER(tracking) as t FROM main_database');
    const mainSet = new Set(mainDb.map(r => r.t));

    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx'));
    const unusedParcels = [];

    for (const f of files) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(path.join(parcelDir, f));
        const sheet = wb.worksheets[0];
        const headerRow = sheet.getRow(1);
        let barcodeCol = 2, nameCol = 19, cityCol = 22, mobCol = 27, pinCol = 24, addCol = 20;

        headerRow.eachCell((cell, colNum) => {
            const v = getCellValue(cell).toUpperCase();
            if (v.includes('BARCODE')) barcodeCol = colNum;
            if (v.includes('RECEIVER NAME')) nameCol = colNum;
            if (v.includes('RECEIVER CITY') || (cityCol === 22 && v.includes('CITY'))) cityCol = colNum;
            if (v.includes('RECEIVER MOBILE') || (mobCol === 27 && (v.includes('MOBILE') || v.includes('PHONE')))) mobCol = colNum;
            if (v.includes('RECEIVER PINCODE') || (pinCol === 24 && v.includes('PIN'))) pinCol = colNum;
            if (v.includes('RECEIVER ADD LINE 1') || (addCol === 20 && v.includes('ADD LINE 1'))) addCol = colNum;
        });

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = getCellValue(row.getCell(barcodeCol)).toUpperCase();
            const name = getCellValue(row.getCell(nameCol));
            const city = getCellValue(row.getCell(cityCol));
            const mob = getCellValue(row.getCell(mobCol));
            const pin = getCellValue(row.getCell(pinCol));
            const add = getCellValue(row.getCell(addCol));

            if (barcode && barcode.startsWith('CG') && !mainSet.has(barcode)) {
                unusedParcels.push({
                    file: f,
                    barcode,
                    name,
                    city,
                    mob,
                    pin,
                    add
                });
            }
        }
    }

    console.log(`Unused Excel Parcels (not in Master DB): ${unusedParcels.length}`);
    console.table(unusedParcels);

    const { rows: pending } = await pool.query('SELECT id, member_id, name, order_date, amount, pv FROM pending_entries ORDER BY id ASC');
    console.log(`Remaining Pending Entries: ${pending.length}`);
    console.table(pending);

    await pool.end();
}

run().catch(console.error);
