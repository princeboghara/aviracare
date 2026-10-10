const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

function getCellValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    let val = cell.value;
    if (typeof val === 'object') {
        if (val.result !== undefined && val.result !== null) {
            val = val.result;
        } else if (val.text !== undefined && val.text !== null) {
            val = val.text;
        } else if (Array.isArray(val.richText)) {
            val = val.richText.map(t => t.text).join('');
        }
    }
    return String(val || '').trim();
}

async function fixCellValues() {
    console.log("🔧 Fixing formula object cell values (city, state, etc.) in database...");

    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    const barcodeDetails = new Map();

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        const headerRow = sheet.getRow(1);

        let barcodeCol = 2, cityCol = 22, stateCol = 23, addCol = 20, pinCol = 24, mobCol = 27;
        headerRow.eachCell((cell, colNum) => {
            const v = String(cell.value || '').toUpperCase();
            if (v.includes('BARCODE')) barcodeCol = colNum;
            if (v.includes('CITY')) cityCol = colNum;
            if (v.includes('STATE')) stateCol = colNum;
            if (v.includes('ADD LINE 1') || v.includes('ADDRESS')) addCol = colNum;
            if (v.includes('PIN')) pinCol = colNum;
            if (v.includes('MOBILE') || v.includes('PHONE')) mobCol = colNum;
        });

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = getCellValue(row.getCell(barcodeCol));
            if (!barcode || !barcode.startsWith('CG')) continue;

            const city = getCellValue(row.getCell(cityCol));
            const state = getCellValue(row.getCell(stateCol));
            const address = getCellValue(row.getCell(addCol));
            const pincode = getCellValue(row.getCell(pinCol));
            const mobile = getCellValue(row.getCell(mobCol));

            if (!barcodeDetails.has(barcode) || (city && city !== '[object Object]')) {
                barcodeDetails.set(barcode, { city, state, address, pincode, mobile });
            }
        }
    }

    console.log(`Parsed ${barcodeDetails.size} barcodes with clean text values.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let peFixed = 0;
        for (const [barcode, details] of barcodeDetails.entries()) {
            const res = await client.query(`
                UPDATE pending_entries
                SET city = $1, state = $2, address = $3, pincode = $4, mobile = $5
                WHERE UPPER(tracking) = $6
            `, [
                details.city || null,
                details.state || null,
                details.address || null,
                details.pincode || null,
                details.mobile || null,
                barcode.toUpperCase()
            ]);
            peFixed += res.rowCount;

            await client.query(`
                UPDATE consignment_parcels
                SET city = $1, state = $2, address = $3, pincode = $4, mobile = $5
                WHERE UPPER(tracking) = $6
            `, [
                details.city || null,
                details.state || null,
                details.address || null,
                details.pincode || null,
                details.mobile || null,
                barcode.toUpperCase()
            ]);
        }

        await client.query('COMMIT');
        console.log(`✅ Successfully updated ${peFixed} pending_entries records with clean city and state text!`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error updating cell text values:", e);
    } finally {
        client.release();
    }

    // Verify sample
    const sample = await pool.query(`SELECT id, name, tracking, city, state FROM pending_entries WHERE tracking IS NOT NULL AND tracking != '' ORDER BY id DESC LIMIT 5`);
    console.table(sample.rows);

    await pool.end();
}

fixCellValues().catch(console.error);
