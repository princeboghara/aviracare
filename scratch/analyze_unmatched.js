const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

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

function normalizeName(name) {
    if (!name) return '';
    let n = String(name).toUpperCase().trim();
    n = n.replace(/[^A-Z\s]/g, ' ');
    n = n.replace(/\b(MR|MRS|MS|SMT|SH|SHRI|DR|MISS|BEN|BHAI|KUMAR|KUMARI|DEVI)\b/g, ' ');
    n = n.replace(/\s+/g, ' ').trim();
    return n;
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function nameSimilarity(name1, name2) {
    const raw1 = String(name1).toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const raw2 = String(name2).toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (raw1 === raw2) return 1.0;

    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);
    if (!n1 || !n2) return 0;
    if (n1 === n2) return 0.98;

    // Check if one contains the other (e.g. "BHANUBEN J GORASIYA" contains "GORASIYA")
    const words1 = n1.split(' ').filter(w => w.length >= 3);
    const words2 = n2.split(' ').filter(w => w.length >= 3);

    // If both share a unique distinctive word of 5+ chars (like surname GORASIYA or CHOTHANI)
    let commonDistinctive = 0;
    for (const w of words1) {
        if (words2.includes(w)) commonDistinctive++;
    }
    const tokenScore = (words1.length && words2.length) ? (2 * commonDistinctive) / (words1.length + words2.length) : 0;

    const maxLen = Math.max(n1.length, n2.length);
    const dist = levenshtein(n1, n2);
    const levScore = (maxLen - dist) / maxLen;

    return Math.max(tokenScore, levScore);
}

async function run() {
    const { rows: pendingEntries } = await pool.query("SELECT * FROM pending_entries WHERE consignment_id IS NULL ORDER BY id ASC");
    const { rows: mainDbTracking } = await pool.query("SELECT UPPER(tracking) as tracking FROM main_database WHERE tracking IS NOT NULL AND tracking != ''");
    const existingMainSet = new Set(mainDbTracking.map(r => r.tracking));

    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    const barcodeMap = new Map();

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const dateInfo = parseDateFromFilename(file);
        if (!dateInfo) continue;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        const headerRow = sheet.getRow(1);
        let barcodeCol = 2, nameCol = 19, mobileCol = 27, pincodeCol = 24, addCol = 20, cityCol = 22, stateCol = 23, weightCol = 3, lCol = 5, bCol = 6, hCol = 7;

        headerRow.eachCell((cell, colNum) => {
            const v = String(cell.value || '').toUpperCase();
            if (v.includes('BARCODE')) barcodeCol = colNum;
            if (v.includes('RECEIVER NAME')) nameCol = colNum;
            if (v.includes('MOBILE') || v.includes('PHONE')) mobileCol = colNum;
            if (v.includes('PIN')) pincodeCol = colNum;
            if (v.includes('ADD LINE 1') || v.includes('ADDRESS')) addCol = colNum;
            if (v.includes('CITY')) cityCol = colNum;
            if (v.includes('STATE')) stateCol = colNum;
            if (v.includes('WEIGHT')) weightCol = colNum;
            if (v.includes('LENGTH')) lCol = colNum;
            if (v.includes('BREADTH')) bCol = colNum;
            if (v.includes('HEIGHT')) hCol = colNum;
        });

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = String(row.getCell(barcodeCol).value || '').trim();
            const name = String(row.getCell(nameCol).value || '').trim();
            if (!barcode || barcode === 'null' || barcode === 'undefined') continue;

            const rec = {
                file,
                dateInfo,
                barcode,
                name,
                mobile: String(row.getCell(mobileCol).value || '').trim(),
                pincode: String(row.getCell(pincodeCol).value || '').trim(),
                address: String(row.getCell(addCol).value || '').trim(),
                city: String(row.getCell(cityCol).value || '').trim(),
                state: String(row.getCell(stateCol).value || '').trim(),
                weight: parseFloat(row.getCell(weightCol).value) || null,
                length: parseFloat(row.getCell(lCol).value) || null,
                breadth: parseFloat(row.getCell(bCol).value) || null,
                height: parseFloat(row.getCell(hCol).value) || null
            };

            if (!barcodeMap.has(barcode)) {
                barcodeMap.set(barcode, []);
            }
            barcodeMap.get(barcode).push(rec);
        }
    }

    const uniqueExcelRecords = [];
    for (const [barcode, list] of barcodeMap.entries()) {
        list.sort((a, b) => a.dateInfo.dateObj - b.dateInfo.dateObj);
        uniqueExcelRecords.push(list[0]);
    }

    // Check how many Excel barcodes are already in main_database
    let alreadyInMain = 0;
    for (const ex of uniqueExcelRecords) {
        if (existingMainSet.has(ex.barcode.toUpperCase())) {
            alreadyInMain++;
        }
    }
    console.log(`Excel records already dispatched in main_database: ${alreadyInMain}`);

    // High confidence matches first (score >= 0.85)
    const matchedPending = new Map(); // peId -> exRecord
    const usedBarcodes = new Set();

    // Round 1: High confidence exact or near-exact matches
    for (const pe of pendingEntries) {
        const orderDate = parseOrderDate(pe.order_date);
        let best = null, bestScore = 0;
        for (const ex of uniqueExcelRecords) {
            if (usedBarcodes.has(ex.barcode)) continue;
            if (orderDate && ex.dateInfo.dateObj < orderDate) continue;

            const sim = nameSimilarity(pe.name, ex.name);
            if (sim > bestScore) {
                bestScore = sim;
                best = ex;
            }
        }
        if (best && bestScore >= 0.80) {
            matchedPending.set(pe.id, { pe, ex: best, score: bestScore });
            usedBarcodes.add(best.barcode);
        }
    }

    console.log(`Round 1 (score >= 0.80) matched: ${matchedPending.size}`);

    // Round 2: Relaxed fuzzy matching for remaining (score >= 0.60)
    let round2Matched = 0;
    for (const pe of pendingEntries) {
        if (matchedPending.has(pe.id)) continue;
        const orderDate = parseOrderDate(pe.order_date);
        let best = null, bestScore = 0;
        for (const ex of uniqueExcelRecords) {
            if (usedBarcodes.has(ex.barcode)) continue;
            if (orderDate && ex.dateInfo.dateObj < orderDate) continue;

            const sim = nameSimilarity(pe.name, ex.name);
            if (sim > bestScore) {
                bestScore = sim;
                best = ex;
            }
        }
        if (best && bestScore >= 0.60) {
            matchedPending.set(pe.id, { pe, ex: best, score: bestScore });
            usedBarcodes.add(best.barcode);
            round2Matched++;
        }
    }
    console.log(`Round 2 (score 0.60 - 0.79) matched: ${round2Matched}`);
    console.log(`Total matched so far: ${matchedPending.size} / ${pendingEntries.length}`);

    // Inspect remaining unmatched Excel barcodes
    const unusedExcel = uniqueExcelRecords.filter(ex => !usedBarcodes.has(ex.barcode));
    console.log(`Unused Excel records: ${unusedExcel.length}`);

    // Inspect remaining unmatched pending entries
    const unmatchedPe = pendingEntries.filter(pe => !matchedPending.has(pe.id));
    console.log(`Unmatched Pending entries: ${unmatchedPe.length}`);

    console.log('\n--- SAMPLE UNMATCHED PENDING ENTRIES ---');
    for (const pe of unmatchedPe.slice(0, 15)) {
        console.log(`[PE ${pe.id}] Name: "${pe.name}", OrderDate: "${pe.order_date}", MemberID: "${pe.member_id}"`);
    }

    console.log('\n--- SAMPLE UNUSED EXCEL RECORDS ---');
    for (const ex of unusedExcel.slice(0, 15)) {
        console.log(`[EX ${ex.file}] Name: "${ex.name}", Date: "${ex.dateInfo.dateStr}", Barcode: "${ex.barcode}"`);
    }

    await pool.end();
}

run().catch(console.error);
