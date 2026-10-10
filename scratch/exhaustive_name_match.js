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

function parseDateFromFilename(filename) {
    const clean = filename.replace(/\s*\(\d+\)/g, '').replace(/\s+\d+/g, '').replace(/\.xlsx.*$/i, '');
    const parts = clean.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        return {
            day,
            month,
            year,
            dateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            dateObj: new Date(year, month - 1, day)
        };
    }
    return null;
}

function parseOrderDate(orderDateStr) {
    if (!orderDateStr || !orderDateStr.trim()) return null;
    const d = new Date(orderDateStr.trim());
    return isNaN(d.getTime()) ? null : d;
}

function cleanTokens(str) {
    if (!str) return [];
    return String(str)
        .toUpperCase()
        .replace(/[^A-Z\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .filter(w => !['MR', 'MRS', 'MS', 'SMT', 'SH', 'SHRI', 'DR', 'MISS'].includes(w));
}

function isRelated(peName, exName) {
    const peTokens = cleanTokens(peName);
    const exTokens = cleanTokens(exName);
    if (peTokens.length === 0 || exTokens.length === 0) return { related: false, score: 0 };

    // Full match
    const normPe = peTokens.join(' ');
    const normEx = exTokens.join(' ');
    if (normPe === normEx) return { related: true, score: 1.0, reason: 'EXACT' };

    // Check shared tokens
    let shared = 0;
    for (const pt of peTokens) {
        for (const et of exTokens) {
            if (pt === et) {
                shared++;
                break;
            } else if (pt.startsWith(et) || et.startsWith(pt)) {
                if (Math.min(pt.length, et.length) >= 4) {
                    shared += 0.8;
                    break;
                }
            }
        }
    }

    // Direct substring or concatenation check (e.g. CHAMPABRAJPUT contains CHAMPA and RAJPUT)
    const rawPe = String(peName).toUpperCase().replace(/[^A-Z]/g, '');
    const rawEx = String(exName).toUpperCase().replace(/[^A-Z]/g, '');
    if (rawPe.includes(rawEx) || rawEx.includes(rawPe)) {
        return { related: true, score: 0.9, reason: 'SUBSTRING' };
    }

    const tokenRatio = (2 * shared) / (peTokens.length + exTokens.length);
    if (tokenRatio >= 0.4 || shared >= 1) {
        return { related: true, score: tokenRatio, reason: `TOKEN_SHARED (${shared})` };
    }

    return { related: false, score: 0 };
}

async function run() {
    const { rows: pending } = await pool.query('SELECT * FROM pending_entries ORDER BY id ASC');
    console.log(`Analyzing ${pending.length} remaining pending entries...`);

    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    const allExcelRows = [];

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const dateInfo = parseDateFromFilename(file);
        if (!dateInfo) continue;

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

        if (barcodeCol === -1) barcodeCol = 2;
        if (nameCol === -1) nameCol = 19;

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = getCellValue(row.getCell(barcodeCol)).toUpperCase();
            const name = getCellValue(row.getCell(nameCol));
            if (!barcode || !barcode.startsWith('CG')) continue;

            allExcelRows.push({
                file,
                dateInfo,
                rowNum: r,
                barcode,
                name,
                city: cityCol !== -1 ? getCellValue(row.getCell(cityCol)) : '',
                state: stateCol !== -1 ? getCellValue(row.getCell(stateCol)) : '',
                pincode: pinCol !== -1 ? getCellValue(row.getCell(pinCol)) : '',
                mobile: mobCol !== -1 ? getCellValue(row.getCell(mobCol)) : '',
                address: addCol !== -1 ? getCellValue(row.getCell(addCol)) : '',
                weight: weightCol !== -1 ? parseFloat(getCellValue(row.getCell(weightCol))) : null,
                length: lCol !== -1 ? parseFloat(getCellValue(row.getCell(lCol))) : null,
                breadth: bCol !== -1 ? parseFloat(getCellValue(row.getCell(bCol))) : null,
                height: hCol !== -1 ? parseFloat(getCellValue(row.getCell(hCol))) : null
            });
        }
    }

    console.log(`Loaded ${allExcelRows.length} total rows from Excels.`);

    // Check which barcodes are already in main_database
    const { rows: mainDbTracking } = await pool.query('SELECT UPPER(tracking) as t FROM main_database');
    const mainSet = new Set(mainDbTracking.map(r => r.t));

    const matchesFound = [];

    for (const pe of pending) {
        const peOrderDate = parseOrderDate(pe.order_date);
        
        let candidates = [];
        for (const ex of allExcelRows) {
            // Check relationship
            const check = isRelated(pe.name, ex.name);
            if (check.related) {
                // Check date condition:
                // If peOrderDate exists, we prefer ex.dateObj >= peOrderDate,
                // but if order date was within 1-2 days before/after, calculate difference
                let daysDiff = null;
                if (peOrderDate) {
                    daysDiff = Math.round((ex.dateInfo.dateObj - peOrderDate) / (1000 * 60 * 60 * 24));
                }
                candidates.push({
                    ex,
                    check,
                    daysDiff,
                    alreadyInMain: mainSet.has(ex.barcode)
                });
            }
        }

        if (candidates.length > 0) {
            // Sort by: not already in main first, then date >= order_date, then score desc
            candidates.sort((a, b) => {
                if (a.alreadyInMain !== b.alreadyInMain) return a.alreadyInMain ? 1 : -1;
                // prefer daysDiff >= -1 (allow up to 1 day before due to dispatch timing)
                const aDateValid = a.daysDiff === null || a.daysDiff >= -1;
                const bDateValid = b.daysDiff === null || b.daysDiff >= -1;
                if (aDateValid !== bDateValid) return aDateValid ? -1 : 1;
                return b.check.score - a.check.score;
            });

            matchesFound.push({
                pe,
                topCandidate: candidates[0],
                allCandidatesCount: candidates.length
            });
        }
    }

    console.log(`\nFound potential matches for ${matchesFound.length} / ${pending.length} pending entries!`);
    
    for (const m of matchesFound) {
        const pe = m.pe;
        const c = m.topCandidate;
        console.log(`\n--------------------------------------------------`);
        console.log(`[PE ID ${pe.id}] Member: ${pe.member_id} | Name: "${pe.name}" | OrderDate: "${pe.order_date}"`);
        console.log(`--> Match in ${c.ex.file} (Date: ${c.ex.dateInfo.dateStr})`);
        console.log(`    Excel Name: "${c.ex.name}" | Barcode: ${c.ex.barcode}`);
        console.log(`    City: "${c.ex.city}" | Pin: "${c.ex.pincode}" | Mobile: "${c.ex.mobile}"`);
        console.log(`    Score: ${c.check.score.toFixed(2)} (${c.check.reason}) | Days diff: ${c.daysDiff} | In Master DB already: ${c.alreadyInMain}`);
    }

    await pool.end();
}

run().catch(console.error);
